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

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getRUMUrl } from '../support/utils.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { noopUrlResolver } from '../common/index.js';
import { getTopPagesForSiteId } from '../canonical/handler.js';
import { syncSuggestions } from '../utils/data-access.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { generateSuggestionData } from './suggestions-generator.js';
import {
  calculateKpiDeltasForAudit,
  isLinkInaccessible,
  calculatePriority,
} from './helpers.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;

/**
 * Perform an audit to check which internal links for domain are broken.
 *
 * @async
 * @param {string} baseURL - The URL to run audit against
 * @param {Object} context - The context object containing configurations, services,
 * and environment variables.
 * @returns {Response} - Returns a response object indicating the result of the audit process.
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log, site } = context;
  const finalUrl = await getRUMUrl(auditUrl);

  const rumAPIClient = RUMAPIClient.createFrom(context);

  const options = {
    domain: finalUrl,
    interval: INTERVAL,
    granularity: 'hourly',
  };

  log.info(
    `[${AUDIT_TYPE}] [Site Id: ${site.getId()}] Options for RUM call: `,
    JSON.stringify(options),
  );

  const internal404Links = await rumAPIClient.query(
    '404-internal-links',
    options,
  );
  const transformedLinks = internal404Links.map((link) => ({
    urlFrom: link.url_from,
    urlTo: link.url_to,
    trafficDomain: link.traffic_domain,
  }));

  let finalLinks = calculatePriority(transformedLinks);

  finalLinks = finalLinks.filter(async (link) => isLinkInaccessible(link.urlTo, log));

  const auditResult = {
    brokenInternalLinks: finalLinks,
    fullAuditRef: auditUrl,
    finalUrl,
    auditContext: {
      interval: INTERVAL,
    },
  };

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function runAuditAndImportTopPagesStep(context) {
  const { site, log, finalUrl } = context;

  log.info(`[${AUDIT_TYPE}] [Site Id: ${site.getId()}] starting audit`);
  const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
    finalUrl,
    context,
  );

  // const uniqueUrls = new Set();
  const result = {
    auditResult: internalLinksAuditRunnerResult.auditResult,
    fullAuditRef: internalLinksAuditRunnerResult.fullAuditRef,
    type: 'top-pages',
    siteId: site.getId(),
    jobId: site.getId(),
  };

  log.info(
    `[${AUDIT_TYPE}] [Site Id: ${site.getId()}] finished audit, now scraping top urls`,
  );
  return result;
}

export async function prepareScrapingStep(context) {
  const { site, log, dataAccess } = context;

  // fetch top pages for site
  const topPages = await getTopPagesForSiteId(
    dataAccess,
    site.getId(),
    context,
    log,
  );

  log.info(
    `[${AUDIT_TYPE}] [Site Id: ${site.getId()}] preparing scraping step`,
  );

  return {
    processingType: 'broken-internal-links',
    jobId: site.getId(),
    urls: topPages.map((page) => ({ url: page.url })),
    siteId: site.getId(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function opportunityAndSuggestionsStep(context) {
  const { log, site, finalUrl } = context;
  log.info(
    `broken-internal-links audit: [Site Id: ${site.getId()}] starting audit`,
  );

  const latestAuditData = await site.getLatestAuditByAuditType(AUDIT_TYPE);

  // generate suggestions
  const auditDataWithSuggestions = await generateSuggestionData(
    finalUrl,
    latestAuditData,
    context,
    site,
  );

  const kpiDeltas = calculateKpiDeltasForAudit(auditDataWithSuggestions);
  const opportunity = await convertToOpportunity(
    finalUrl,
    auditDataWithSuggestions,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    {
      kpiDeltas,
    },
  );
  const buildKey = (item) => `${item.urlFrom}-${item.urlTo}`;
  await syncSuggestions({
    opportunity,
    newData: auditDataWithSuggestions?.auditResult?.brokenInternalLinks,
    context,
    buildKey,
    mapNewSuggestion: (entry) => ({
      opportunityId: opportunity.getId(),
      type: 'CONTENT_UPDATE',
      rank: entry.trafficDomain,
      data: {
        title: entry.title,
        urlFrom: entry.urlFrom,
        urlTo: entry.urlTo,
        urlsSuggested: entry.urlsSuggested || [],
        aiRationale: entry.aiRationale || '',
        trafficDomain: entry.trafficDomain,
      },
    }),
    log,
  });
  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .addStep(
    'runAuditAndImportTopPages',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'prepareScraping',
    prepareScrapingStep,
    AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER,
  )
  .addStep('opportunityAndSuggestions', opportunityAndSuggestionsStep)
  .build();
