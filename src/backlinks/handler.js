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

import { composeAuditURL, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { AbortController, AbortError } from '@adobe/fetch';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { syncSuggestions } from '../utils/data-access.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getScrapedDataForSiteId } from '../support/utils.js';
import { backlinksSuggestionPrompt, brokenBacklinksPrompt } from '../support/prompts/backlinks.js';

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
      }
    } finally {
      clearTimeout(id);
    }
    return null;
  };

  const isStillBrokenBacklink = async (backlink) => {
    try {
      const response = await fetchWithTimeout(backlink.url_to, TIMEOUT);
      if (!response.ok && response.status !== 404
        && response.status >= 400 && response.status < 500) {
        log.warn(`Backlink ${backlink.url_to} returned status ${response.status}`);
      }
      return !response.ok;
    } catch (error) {
      log.error(`Failed to check backlink ${backlink.url_to}: ${error.message}`);
      return true;
    }
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
      const requestBody = brokenBacklinksPrompt(batch, urlTo);
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

    const suggestions = (
      await Promise.all(dataBatches.map((batch) => processBatch(batch, backlink.url_to)))
    ).filter(Boolean);

    log.info(`Compiling final suggestions for: ${backlink.url_to}`);
    try {
      const finalRequestBody = backlinksSuggestionPrompt(
        backlink.url_to,
        suggestions,
        headerSuggestions,
      );
      const finalResponse = await firefallClient
        .fetchChatCompletion(finalRequestBody, firefallOptions);

      if (finalResponse.choices?.length >= 1 && finalResponse.choices[0].finish_reason !== 'stop') {
        log.error(`No final suggestions found for ${backlink.url_to}`);
        return { ...backlink };
      }

      const answer = JSON.parse(finalResponse.choices[0].message.content);
      return {
        ...backlink,
        urls_suggested: answer.suggested_urls || [],
        ai_rationale: answer.ai_rationale || '',
      };
    } catch (error) {
      log.error(`Final suggestion error for ${backlink.url_to}: ${error.message}`);
      return { ...backlink };
    }
  };

  const headerSuggestionsResults = await Promise.all(
    auditData.auditResult.brokenBacklinks.map(async (backlink) => {
      try {
        const requestBody = brokenBacklinksPrompt(headerLinks, backlink.url_to);
        const response = await firefallClient.fetchChatCompletion(requestBody, firefallOptions);

        if (response.choices?.length >= 1 && response.choices[0].finish_reason !== 'stop') {
          log.error(`No header suggestions for ${backlink.url_to}`);
          return null;
        }

        return JSON.parse(response.choices[0].message.content);
      } catch (error) {
        log.error(`Header suggestion error: ${error.message}`);
        return null;
      }
    }),
  );

  const updatedBacklinks = await Promise.all(
    auditData.auditResult.brokenBacklinks.map(
      (backlink, index) => processBacklink(backlink, headerSuggestionsResults[index]),
    ),
  );

  log.info('Suggestions generation complete.');
  const updatedAuditData = {
    ...auditData,
    auditResult: {
      brokenBacklinks: updatedBacklinks,
    },
  };
  log.info(`UPDATED AUDIT DATA: ${JSON.stringify(updatedAuditData)}`);
  return updatedAuditData;
};

export const convertToOpportunity = async (auditUrl, auditData, context) => {
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;

  const opportunities = await Opportunity.allBySiteIdAndStatus(auditData.siteId, 'NEW');
  let opportunity = opportunities.find((oppty) => oppty.getType() === 'broken-backlinks');

  if (!opportunity) {
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.id,
      runbook: 'https://adobe.sharepoint.com/:w:/r/sites/aemsites-engineering/_layouts/15/doc2.aspx?sourcedoc=%7BAC174971-BA97-44A9-9560-90BE6C7CF789%7D&file=Experience_Success_Studio_Broken_Backlinks_Runbook.docx&action=default&mobileredirect=true',
      type: 'broken-backlinks',
      origin: 'AUTOMATION',
      title: 'Authoritative Domains are linking to invalid URLs. This could impact your SEO.',
      description: 'Provide the correct target URL that each of the broken backlinks should be redirected to.',
      guidance: {
        steps: [
          'Review the list of broken target URLs and the suggested redirects.',
          'Manually override redirect URLs as needed.',
          'Copy redirects.',
          'Paste new entries in your website redirects file.',
          'Publish the changes.',
        ],
      },
      tags: ['Traffic acquisition'],
    };
    try {
      opportunity = await Opportunity.create(opportunityData);
    } catch (e) {
      log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.id}: ${e.message}`);
      throw e;
    }
  } else {
    opportunity.setAuditId(auditData.id);
    await opportunity.save();
  }

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
};

export default new AuditBuilder()
  .withUrlResolver((site) => composeAuditURL(site.getBaseURL()))
  .withRunner(brokenBacklinksAuditRunner)
  .withPostProcessors([generateSuggestionData, convertToOpportunity])
  .build();
