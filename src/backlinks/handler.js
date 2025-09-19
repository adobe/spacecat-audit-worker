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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import AhrefsAPIClient from '@adobe/spacecat-shared-ahrefs-client';
import { Audit, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import calculateKpiMetrics from './kpi-metrics.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { syncSuggestions } from '../utils/data-access.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

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
    log.debug(`Found ${result?.backlinks?.length} broken backlinks for siteId: ${siteId} and url ${auditUrl}`);
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
    site, audit, dataAccess, log, sqs, env, finalUrl,
  } = context;
  const { Configuration, Suggestion, SiteTopPage } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.info('Audit failed, skipping suggestions generation');
    throw new Error('Audit failed, skipping suggestions generation');
  }

  const configuration = await Configuration.findLatest();
  if (!configuration.isHandlerEnabledForSite('broken-backlinks-auto-suggest', site)) {
    log.info('Auto-suggest is disabled for site');
    throw new Error('Auto-suggest is disabled for site');
  }

  const kpiDeltas = await calculateKpiMetrics(audit, context, site);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    Audit.AUDIT_TYPES.BROKEN_BACKLINKS,
    kpiDeltas,
  );

  const buildKey = (backlink) => `${backlink.url_from}|${backlink.url_to}`;
  await syncSuggestions({
    opportunity,
    newData: auditResult?.brokenBacklinks,
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
        traffic_domain: backlink.traffic_domain,
      },
    }),
  });
  const suggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionModel.STATUSES.NEW,
  );
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  const message = {
    type: 'guidance:broken-links',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      alternativeUrls: topPages.map((page) => page.getUrl()),
      opportunityId: opportunity?.getId(),
      brokenLinks: suggestions.map((suggestion) => ({
        urlFrom: suggestion?.getData()?.url_from,
        urlTo: suggestion?.getData()?.url_to,
        suggestionId: suggestion?.getId(),
      })),
    },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  return {
    status: 'complete',
  };
};

export default new AuditBuilder()
  .withUrlResolver((site) => site.resolveFinalURL())
  .addStep('audit-and-import-top-pages', runAuditAndImportTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('generate-suggestion-data', generateSuggestionData)
  .build();
