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

import { getPrompt, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { syncSuggestions } from '../utils/data-access.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getScrapedDataForSiteId } from '../support/utils.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import calculateKpiDeltasForAudit from './kpi-metrics.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const auditType = Audit.AUDIT_TYPES.BROKEN_BACKLINKS;
const TIMEOUT = 3000;

async function filterOutValidBacklinks(backlinks, log) {
  const fetchWithTimeout = async (url, timeout) => {
    try {
      return await fetch(url, { timeout });
    } catch (error) {
      if (error.code === 'ETIMEOUT') {
        log.warn(`Request to ${url} timed out after ${timeout}ms`);
        return { ok: false, status: 408 };
      } else {
        log.warn(`Request to ${url} failed with error: ${error.message}`);
      }
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

  const backlinkStatuses = [];
  for (const backlink of backlinks) {
    log.info(`Checking backlink: ${backlink.url_to}`);

    // eslint-disable-next-line no-await-in-loop
    const result = await isStillBrokenBacklink(backlink);
    backlinkStatuses.push(result);
  }

  // const backlinkStatuses = await Promise.all(backlinks.map(isStillBrokenBacklink));
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
        finalUrl: auditUrl,
        brokenBacklinks: await filterOutValidBacklinks(filteredBacklinks, log),
      },
    };
  } catch (e) {
    log.error(`Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`, e);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `Broken Backlinks audit for ${siteId} with url ${auditUrl} failed with error: ${e.message}`,
        success: false,
      },
    };
  }
}

export async function runAuditAndImportTopPages(context) {
  const { site, finalUrl } = context;
  const result = await brokenBacklinksAuditRunner(finalUrl, context, site);

  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: result.auditResult,
    fullAuditRef: result.fullAuditRef,
  };
}

export async function submitForScraping(context) {
  const { site, dataAccess } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'broken-backlinks',
  };
}

export const generateSuggestionData = async (context) => {
  const {
    site, audit, finalUrl, dataAccess, log,
  } = context;
  const { Configuration, SiteTopPage } = dataAccess;
  const { FIREFALL_MODEL } = context.env;

  if (audit.getAuditResult().success === false) {
    log.info('Audit failed, skipping suggestions generation');
    throw new Error('Audit failed, skipping suggestions generation');
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-backlinks-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    throw new Error('Auto-suggest is disabled for site');
  }

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  if (topPages.length === 0) {
    log.error('No top pages found for site, will not be able to generate suggestions');
    throw new Error('No top pages found for site, will not be able to generate suggestions');
  }

  log.info(`Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);
  const firefallOptions = { responseFormat: 'json_object', model: FIREFALL_MODEL };
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
      const requestBody = await getPrompt(
        { alternative_urls: batch, broken_url: urlTo },
        'broken-backlinks',
        log,
      );
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
    const batchPromises = dataBatches.map((batch) => processBatch(batch, backlink.url_to));
    const batchResults = await Promise.all(batchPromises);
    const suggestions = batchResults.filter((result) => result !== null);

    if (totalBatches > 1) {
      log.info(`Compiling final suggestions for: ${backlink.url_to}`);
      try {
        const finalRequestBody = await getPrompt(
          {
            suggested_urls: suggestions,
            header_links: headerSuggestions,
            broken_url: backlink.url_to,
          },
          'broken-backlinks-followup',
          log,
        );
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
          urlsSuggested: answer.suggested_urls?.length > 0 ? answer.suggested_urls : [finalUrl],
          aiRationale: answer.aiRationale?.length > 0 ? answer.aiRationale : 'No suitable suggestions found',
        };
      } catch (error) {
        log.error(`Final suggestion error for ${backlink.url_to}: ${error.message}`);
        return { ...backlink };
      }
    }

    log.info(`Suggestions for ${backlink.url_to}: ${JSON.stringify(suggestions[0]?.suggested_urls)}`);
    return {
      ...backlink,
      urlsSuggested:
        suggestions[0]?.suggested_urls?.length > 0 ? suggestions[0]?.suggested_urls : [finalUrl],
      aiRationale:
        suggestions[0]?.aiRationale?.length > 0 ? suggestions[0]?.aiRationale : 'No suitable suggestions found',
    };
  };

  const headerSuggestionsPromises = audit.getAuditResult().brokenBacklinks.map(async (backlink) => {
    try {
      const requestBody = await getPrompt(
        { alternative_urls: headerLinks, broken_url: backlink.url_to },
        'broken-backlinks',
        log,
      );
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
  });
  const headerSuggestionsResults = await Promise.all(headerSuggestionsPromises);

  const updatedBacklinkPromises = audit.getAuditResult().brokenBacklinks.map(
    (backlink, index) => processBacklink(backlink, headerSuggestionsResults[index]),
  );
  const updatedBacklinks = await Promise.all(updatedBacklinkPromises);

  log.info(`Broken backlinks suggestions generation for ${site.getId()} complete.`);

  const kpiDeltas = await calculateKpiDeltasForAudit(audit, context, site);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    auditType,
    kpiDeltas,
  );

  const buildKey = (backlink) => `${backlink.url_from}|${backlink.url_to}`;

  await syncSuggestions({
    opportunity,
    newData: updatedBacklinks,
    buildKey,
    context,
    mapNewSuggestion: (backlink) => ({
      opportunityId: opportunity.getId(),
      type: 'REDIRECT_UPDATE',
      rank: backlink.traffic_domain,
      data: {
        title: backlink.title,
        url_from: backlink.url_from,
        url_to: backlink.url_to,
        urlsSuggested: backlink.urlsSuggested || [],
        aiRationale: backlink.aiRationale || '',
        traffic_domain: backlink.traffic_domain,
      },
    }),
    log,
  });
  return {
    status: 'complete',
  };
};

export default new AuditBuilder()
  .withUrlResolver((site) => site.resolveFinalURL())
  .addStep('audit-and-import-top-pages', runAuditAndImportTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('generate-suggestions', generateSuggestionData)
  .build();
