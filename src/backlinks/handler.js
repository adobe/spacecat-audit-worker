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

const generateSuggestionData = async (finalUrl, auditData, context, site) => {
  const { dataAccess, log } = context;
  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-backlinks-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    return { ...auditData };
  }

  log.info(`Generating suggestions for site ${finalUrl}`);

  const firefallClient = FirefallClient.createFrom(context);

  const BATCH_SIZE = 300;
  const data = await getScrapedDataForSiteId(site, context);
  const totalBatches = Math.ceil(data.siteData.length / BATCH_SIZE);
  log.info(`Processing ${data.siteData.length} alternative URLs in ${totalBatches} batches of ${BATCH_SIZE}...`);

  const dataBatches = [];
  for (let i = 0; i < data.siteData.length; i += BATCH_SIZE) {
    dataBatches.push(data.siteData.slice(i, i + BATCH_SIZE));
  }

  const headerSuggestionsResults = await Promise.all(
    auditData.auditResult.brokenBacklinks.map(async (backlink) => {
      const requestBody = brokenBacklinksPrompt(data.headerLinks, backlink.url_to);
      const response = await firefallClient.fetch(requestBody);
      log.info(`Found header suggestions: ${response}`);
      return JSON.parse(response);
    }),
  );

  const promises = await Promise.all(
    auditData.auditResult.brokenBacklinks.map(async (backlink, index) => {
      log.info(`Trying to find redirect for: ${backlink.url_to}`);
      const suggestions = [];

      const batchResults = await Promise.all(
        dataBatches.map(async (batch, batchIndex) => {
          log.info(`Processing batch ${batchIndex + 1}/${totalBatches}...`);
          log.info(`URLS: ${batch} ${JSON.stringify(batch)}`);
          const requestBody = brokenBacklinksPrompt(batch, backlink.url_to);
          const response = await firefallClient.fetch(requestBody);
          log.info(`Found suggestions: ${response}`);
          return JSON.parse(response);
        }),
      );
      suggestions.push(...batchResults);

      log.info(`Evaluating final suggestions for: ${backlink.url_to}`);
      const finalRequestBody = backlinksSuggestionPrompt(
        backlink.url_to,
        suggestions,
        headerSuggestionsResults[index],
      );
      const finalResponse = await firefallClient.fetch(finalRequestBody);
      const finalSuggestion = JSON.parse(finalResponse);

      const newBacklink = { ...backlink };
      newBacklink.urls_suggested = finalSuggestion.suggested_urls || [];
      return newBacklink;
    }),
  );
  // TODO maybe add verification step to check if the suggested URLs are valid (return 200)

  log.info(`Suggestions generated successfully: ${JSON.stringify(promises)}`);
  return {
    ...auditData,
    auditResult: {
      brokenBacklinks: promises,
    },
  };
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
