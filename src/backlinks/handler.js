/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { composeAuditURL, getPrompt, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { AbortController, AbortError } from '@adobe/fetch';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getScrapedDataForSiteId, sleep } from '../support/utils.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const auditType = Audit.AUDIT_TYPES.BROKEN_BACKLINKS;
const TIMEOUT = 3000;

async function filterOutValidBacklinks(backlinks, log) {
  const fetchWithTimeout = async (url, timeout) => {
    const controller = new AbortController();
    const { signal } = controller;
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, { signal });
      clearTimeout(id);
      return response;
    } catch (error) {
      if (error instanceof AbortError) {
        log.warn(`Request to ${url} timed out after ${timeout}ms`);
        return { ok: false, status: 408 };
      } else {
        log.warn(`Request to ${url} failed with error: ${error.message}`);
      }
    } finally {
      clearTimeout(id);
    }
    return { ok: false, status: 500 };
  };

  const isStillBrokenBacklink = async (backlink) => {
    const response = await fetchWithTimeout(backlink.url_to, TIMEOUT);
    if (!response.ok && response.status !== 404
        && response.status >= 400 && response.status < 500) {
      log.warn(`Backlink ${backlink.url_to} returned status ${response.status}`);
    }
    return !response.ok;
  };

  const backlinkStatuses = await Promise.all(backlinks.map(isStillBrokenBacklink));
  return backlinks.filter((_, index) => backlinkStatuses[index]);
}

export async function brokenBacklinksAuditRunner(auditUrl, context, site) {
  const { log } = context;
  const siteId = site.getId();

  try {
    const ahrefsAPIClient = AhrefsAPIClient.createFrom(context);
    const {
      result,
      fullAuditRef,
    } = await ahrefsAPIClient.getBrokenBacklinks(auditUrl);
    log.info(`Found ${result?.backlinks?.length} broken backlinks for siteId: ${siteId} and url ${auditUrl}`);
    const excludedURLs = site.getConfig().getExcludedURLs('broken-backlinks');
    const filteredBacklinks = result?.backlinks?.filter(
      (backlink) => !excludedURLs?.includes(backlink.url_to),
    );

    return {
      fullAuditRef,
      auditResult: {
        brokenBacklinks: await filterOutValidBacklinks(filteredBacklinks, log),
      },
    };
  } catch (e) {
    log.error(`Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`, e);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        error: `Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`,
        success: false,
      },
    };
  }
}

export const generateSuggestionData = async (finalUrl, auditData, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;

  if (auditData.auditResult.success === false) {
    log.info('Audit failed, skipping suggestions generation');
    return { ...auditData };
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-backlinks-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  log.info(`Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object' };
  const BATCH_SIZE = 300;

  const data = await getScrapedDataForSiteId(site, context);
  const { siteData, headerLinks } = data;
  const totalBatches = Math.ceil(siteData.length / BATCH_SIZE);
  const dataBatches = Array.from(
    { length: totalBatches },
    (_, i) => siteData.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  log.info(`Processing ${siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const processBatch = async (batch, urlTo) => {
    try {
      const requestBody = await getPrompt({ alternative_urls: batch, broken_url: urlTo }, 'broken-backlinks', log);
      await sleep(1000);
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`No suggestions found for ${urlTo}`);
        return null;
      }

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      log.error(`Batch processing error: ${error.message}`);
      return null;
    }
  };

  const processBacklink = async (backlink, headerSuggestions) => {
    log.info(`Processing backlink: ${backlink.url_to}`);
    const suggestions = [];
    for (const batch of dataBatches) {
      // eslint-disable-next-line no-await-in-loop
      const result = await processBatch(batch, backlink.url_to);
      if (result) {
        suggestions.push(result);
      }
    }

    if (totalBatches > 1) {
      log.info(`Compiling final suggestions for: ${backlink.url_to}`);
      try {
        const finalRequestBody = await getPrompt({ suggested_urls: suggestions, header_links: headerSuggestions, broken_url: backlink.url_to }, 'broken-backlinks-followup', log);
        await sleep(1000);
        const finalResponse = await firefallClient
          .fetchChatCompletion(finalRequestBody, firefallOptions);

        if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
          log.error(`No final suggestions found for ${backlink.url_to}`);
          return { ...backlink };
        }

        const answer = JSON.parse(finalResponse.choices[0].message.content);
        log.info(`Final suggestion for ${backlink.url_to}: ${JSON.stringify(answer)}`);
        return {
          ...backlink,
          urls_suggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          ai_rationale: answer.ai_rationale?.length > 0 ? answer.ai_rationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`Final suggestion error for ${backlink.url_to}: ${error.message}`);
        return { ...backlink };
      }
    }

    log.info(`Suggestions for ${backlink.url_to}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...backlink,
      urls_suggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      ai_rationale:
        suggestions[0]?.ai_rationale?.length > 0 ? suggestions[0]?.ai_rationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsResults = [];
  for (const backlink of auditData.auditResult.brokenBacklinks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const requestBody = await getPrompt({ alternative_urls: headerLinks, broken_url: backlink.url_to }, 'broken-backlinks', log);
      // eslint-disable-next-line no-await-in-loop
      const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

      if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
        log.error(`No header suggestions for ${backlink.url_to}`);
        headerSuggestionsResults.push(null);
        // eslint-disable-next-line no-continue
        continue;
      }

      headerSuggestionsResults.push(JSON.parse(response.choices[0].message.content));
    } catch (error) {
      log.error(`Header suggestion error: ${error.message}`);
      headerSuggestionsResults.push(null);
    }
  }

  const updatedBacklinks = [];
  for (let index = 0; index < auditData.auditResult.brokenBacklinks.length; index += 1) {
    const backlink = auditData.auditResult.brokenBacklinks[index];
    const headerSuggestions = headerSuggestionsResults[index];
    // eslint-disable-next-line no-await-in-loop
    const updatedBacklink = await processBacklink(backlink, headerSuggestions);
    updatedBacklinks.push(updatedBacklink);
  }

  log.info('Suggestions generation complete.');
  return {
    ...auditData,
    auditResult: {
      brokenBacklinks: updatedBacklinks,
    },
  };
};

/**
  * Converts audit data to an opportunity and synchronizes suggestions.
  *
  * @param {string} auditUrl - The URL of the audit.
  * @param {Object} auditData - The data from the audit.
  * @param {Object} context - The context contains logging and data access utilities.
  */

export async function opportunityAndSuggestions(auditUrl, auditData, context) {
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    auditType,
  );
  const { log } = context;

  const buildKey = (data) => `${data.url_from}|${data.url_to}`;

  await syncSuggestions({
    opportunity,
    newData: auditData.auditResult.brokenBacklinks,
    buildKey,
    mapNewSuggestion: (backlink) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: backlink.traffic_domain,
      data: {
        title: backlink.title,
        url_from: backlink.url_from,
        url_to: backlink.url_to,
        urls_suggested: backlink.urls_suggested || [],
        ai_rationale: backlink.ai_rationale || '',
        traffic_domain: backlink.traffic_domain,
      },
    }),
    log,
  });
}

export default new AuditBuilder()
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL()))
  .withRunner(brokenBacklinksAuditRunner)
  .withPostProcessors([generateSuggestionData, opportunityAndSuggestions])
  .build();
