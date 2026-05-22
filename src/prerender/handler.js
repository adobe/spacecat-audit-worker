/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { readSiteStatusJson, uploadStatusSummaryToS3 } from './status-writer.js';
import { isStickyBotBlocked, detectBotBlock, buildBotBlockedResult } from './bot-block.js';
import { filterUrls } from './url-filter.js';
import { logSubmitMetrics, logStep3Metrics } from './log-metrics.js';
import { fetchUrls } from './url-fetcher.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { resolveMode } from './mode-resolver.js';
import { getScrapeJobStats, buildAuditResult } from './scrape-stats.js';
import { isPaidLLMOCustomer } from './utils/utils.js';
import { writeToCitabilityRecords } from './citability-writer.js';
import { compareAllUrls } from './html-comparator.js';
import {
  detectWrongEdgeDeployedStatus,
  routeOpportunityBranch,
} from './opportunity-syncer.js';
import { MODE_AI_ONLY } from './utils/constants.js';
import { handleAiOnlyMode } from './ai-only.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_ERROR_MESSAGE = 'Audit failed';

/**
 * Step 1: Import top pages data OR handle ai-only mode
 * @param {Object} context - Audit context with site and finalUrl
 * @returns {Promise<Object>} - Import job configuration OR ai-summary result
 */
export async function importTopPages(context) {
  const {
    site, finalUrl, log, auditContext,
  } = context;

  const { isAiOnly } = resolveMode(context);
  if (isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 1, skipping import/scraping/processing`);
    return handleAiOnlyMode(context);
  }

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    ...(Array.isArray(auditContext?.urls) && auditContext.urls.length > 0
      ? {
        auditContext: {
          urls: auditContext.urls,
        },
      }
      : {}),
  };
}

/**
 * Step 2: Submit URLs for scraping OR skip if in ai-only mode
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata OR ai-only result
 */
export async function submitForScraping(context) {
  const { site, log } = context;

  const mode = resolveMode(context);
  if (mode.isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();

  const siteStatus = mode.isCsv ? {} : await readSiteStatusJson(siteId, context);

  if (isStickyBotBlocked(mode, siteStatus)) {
    return buildBotBlockedResult(context, siteStatus);
  }

  const rawUrls = await fetchUrls(context, mode);
  const filterResult = await filterUrls(context, mode, rawUrls, siteStatus);

  logSubmitMetrics(context, mode, rawUrls, filterResult);

  return {
    urls: filterResult.urls.map((url) => ({ url })),
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: {
      pageLoadTimeout: 20000,
      storagePrefix: AUDIT_TYPE,
    },
  };
}

/**
 * Step 3: Process scraped content and compare server-side vs client-side HTML
 * OR skip if ai-only mode
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities OR ai-only result
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, dataAccess, auditContext,
  } = context;

  const { isAiOnly } = resolveMode(context);
  if (isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 3, skipping processing (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();
  const isDomainBlocked = auditContext?.domainBlocked === true;

  // Diagnostic: detect non-NEW suggestions with edgeDeployed before syncing.
  // Runs unconditionally so audits with no prerender findings still catch pre-existing issues.
  await detectWrongEdgeDeployedStatus(dataAccess, siteId, site.getBaseURL(), log);

  const isPaid = await isPaidLLMOCustomer(context);

  log.info(`${LOG_PREFIX} Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}, isDomainBlocked=${isDomainBlocked}`);

  try {
    const comparisonResults = await compareAllUrls(context, isDomainBlocked);

    // Phase 2c: write citability metrics to PageCitability entity.
    await writeToCitabilityRecords(comparisonResults, siteId, context);

    const { scrapeJobId } = auditContext || {};
    // getScrapeJobStats combines 403s from COMPLETE-status URLs (already in comparisonResults)
    // and FAILED-status URLs (absent from comparisonResults, fetched from ScrapeUrl table).
    // missingPages is reused by uploadStatusSummaryToS3 to avoid a redundant DB + S3 round-trip.
    const scrapeStats = await getScrapeJobStats(
      scrapeJobId,
      comparisonResults,
      comparisonResults.length,
      context,
    );

    const botBlockResult = await detectBotBlock(context, {
      isDomainBlocked,
      urlsSubmittedForScraping: scrapeStats.urlsSubmittedForScraping,
      scrapeForbiddenCount: scrapeStats.scrapeForbiddenCount,
    });

    const {
      auditResult, urlsNeedingPrerender, successfulComparisons, scrapedUrlsSet,
    } = buildAuditResult(comparisonResults, scrapeStats, botBlockResult);

    logStep3Metrics(context, {
      scrapeStats,
      comparisonResults,
      auditResult,
      urlsNeedingPrerender,
      successfulComparisons,
      isPaid,
    });

    await routeOpportunityBranch(context, {
      urlsNeedingPrerender,
      botBlockResult,
      auditResult,
      scrapeJobId,
      scrapedUrlsSet,
      successfulComparisons,
      scrapeForbiddenCount: scrapeStats.scrapeForbiddenCount,
      isPaid,
    });

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`${LOG_PREFIX} Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    // Upload status summary to S3 (post-processing)
    await uploadStatusSummaryToS3(site.getBaseURL(), {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
      submittedUrlSet: scrapeStats.submittedUrlSet,
    }, context);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`${LOG_PREFIX} Audit failed for baseUrl=${site.getBaseURL()}, siteId=${siteId}: ${error.message}`, error);

    const errorAuditResult = {
      error: AUDIT_ERROR_MESSAGE,
      lastAuditSuccess: false,
      results: [],
    };

    // Upload status.json on error so UI can show audit status via S3 fallback
    await uploadStatusSummaryToS3(site.getBaseURL(), {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult: errorAuditResult,
      scrapeJobId: auditContext?.scrapeJobId,
    }, context);

    return {
      error: AUDIT_ERROR_MESSAGE,
      totalUrlsChecked: 0,
      urlsNeedingPrerender: 0,
      results: [],
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
