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
import { fetchUrls } from './url-fetcher.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { resolveMode } from './mode-resolver.js';
import { getScrapeJobStats } from './scrape-stats.js';
import { isPaidLLMOCustomer, toPathname } from './utils/utils.js';
import { writeToCitabilityRecords } from './citability-writer.js';
import { compareHtmlContent } from './html-comparator.js';
import {
  detectWrongEdgeDeployedStatus,
  createScrapeForbiddenOpportunity,
  processOpportunityAndSuggestions,
  markNewSuggestionsAsCovered,
} from './opportunity-syncer.js';
import { sendPrerenderGuidanceRequestToMystique } from './mystique-sender.js';
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
  const {
    csvUrls, topPagesUrls, agenticUrls, includedURLs,
  } = rawUrls;

  const { urls: finalUrls, filteredCount, metrics } = await filterUrls(
    context,
    mode,
    rawUrls,
    siteStatus,
  );

  log.info([
    `${LOG_PREFIX} prerender_submit_scraping_metrics:`,
    `submittedUrls=${finalUrls.length}`,
    `csvUrls=${csvUrls.length}`,
    `agenticUrls=${agenticUrls.length}`,
    `topPagesUrls=${topPagesUrls.length}`,
    `includedURLs=${includedURLs.length}`,
    `filteredOutUrls=${filteredCount}`,
    ...(!mode.isCsv ? [
      `currentAgentic=${metrics.currentAgentic}`,
      `currentOrganic=${metrics.currentOrganic}`,
      `currentIncludedUrls=${metrics.currentIncludedUrls}`,
      `isFirstRunOfCycle=${metrics.isFirstRunOfCycle}`,
      `agenticNewThisCycle=${metrics.agenticNewThisCycle}`,
      `edgeDeployedUrls=${metrics.edgeDeployedCount}`,
    ] : []),
    `baseUrl=${site.getBaseURL()}`,
    `siteId=${siteId}`,
  ].join(', '));

  return {
    urls: finalUrls.map((url) => ({ url })),
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
    site, audit, log, scrapeResultPaths, dataAccess, auditContext,
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

  // Check if this is a paid LLMO customer early so we can use it in all logs
  const isPaid = await isPaidLLMOCustomer(context);

  if (isDomainBlocked) {
    log.info(`${LOG_PREFIX} Domain is bot-blocked, treating as fully forbidden scrape. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
  }

  log.info(`${LOG_PREFIX} Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}`);

  try {
    let urlsToCheck = [];

    // Skip expensive URL fetching and comparison when domain is known to be bot-blocked
    if (!isDomainBlocked) {
      if (scrapeResultPaths?.size > 0) {
        urlsToCheck = Array.from(context.scrapeResultPaths.keys());
        log.info(`${LOG_PREFIX} Found ${urlsToCheck.length} URLs from scrape results`);
      } else {
        // scrapeResultPaths is empty — all submitted URLs had FAILED status in the scraper.
        // getScrapeJobStats reads the ScrapeUrl DB and populates missingPages so status.json
        // records the correct failed URLs. Running a top-page fallback here would write phantom
        // 'error' entries for URLs that were never submitted to this scrape job.
        log.warn(`${LOG_PREFIX} No COMPLETE scrape results for baseUrl=${site.getBaseURL()}, `
          + `siteId=${siteId}, scrapeJobId=${auditContext?.scrapeJobId ?? 'unknown'}. `
          + 'Skipping comparison; failed URLs recorded via ScrapeUrl DB.');
      }
    }

    const comparisonResults = isDomainBlocked
      ? []
      : await Promise.all(urlsToCheck.map((url) => compareHtmlContent(url, context)));

    // Phase 2c: write citability metrics to PageCitability entity.
    await writeToCitabilityRecords(comparisonResults, siteId, context);

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    log.info(`${LOG_PREFIX} Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped. isPaidLLMOCustomer=${isPaid}`);

    const { scrapeJobId } = auditContext || {};
    // getScrapeJobStats combines 403s from COMPLETE-status URLs (already in comparisonResults)
    // and FAILED-status URLs (absent from comparisonResults, fetched from ScrapeUrl table).
    // missingPages is reused by uploadStatusSummaryToS3 to avoid a redundant DB + S3 round-trip.
    const urlCount = urlsToCheck.length;
    const {
      urlsSubmittedForScraping,
      scrapeForbiddenCount,
      missingPages,
      submittedUrlSet,
    } = await getScrapeJobStats(scrapeJobId, comparisonResults, urlCount, context);

    log.info(`${LOG_PREFIX} Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${comparisonResults.length}, isPaidLLMOCustomer=${isPaid}`);

    const { scrapeForbidden, scrapeForbiddenSince } = await detectBotBlock(context, {
      isDomainBlocked, urlsSubmittedForScraping, scrapeForbiddenCount,
    });

    // Remove internal tracking fields from results before storing
    // eslint-disable-next-line
    const cleanResults = comparisonResults.map(({ hasScrapeMetadata, scrapeForbidden, ...result }) => result);

    const urlsNotNeedingPrerender = successfulComparisons.length - urlsNeedingPrerender.length;
    // Scraping error rate: % of submitted URLs that failed (base = urlsSubmittedForScraping)
    const failedCount = urlsSubmittedForScraping - successfulComparisons.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? Math.round((failedCount / urlsSubmittedForScraping) * 100)
      : 0;

    // Exclude deployed URLs — don't mark their suggestions outdated regardless of needsPrerender.
    // isDeployedAtEdge=true means prerender is already active at CDN level (via RCV, LLMO
    // side-effect, or domain-wide deployment); no authoritative "resolved" judgment applies.
    const scrapedUrlsSet = new Set(
      successfulComparisons
        .filter((r) => !r.isDeployedAtEdge)
        .map((r) => r.url),
    );

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      urlsScrapedSuccessfully: successfulComparisons.length,
      urlsSubmittedForScraping,
      urlsNotNeedingPrerender,
      scrapingErrorRate,
      results: cleanResults,
      missingPages,
      scrapeForbidden,
      scrapeForbiddenSince,
      scrapeForbiddenCount,
      lastAuditSuccess: true,
    };

    log.info(`${LOG_PREFIX} Scraping metrics for baseUrl=${site.getBaseURL()}, siteId=${siteId}. urlsSubmittedForScraping=${urlsSubmittedForScraping}, urlsScrapedSuccessfully=${successfulComparisons.length}, scrapeForbiddenCount=${scrapeForbiddenCount}, scrapingErrorRate=${scrapingErrorRate}%`);

    let opportunityWithSuggestions = null;

    /* c8 ignore next 16 - Opportunity processing branch, covered by integration tests */
    if (urlsNeedingPrerender.length > 0) {
      const { opportunity, auditRunCandidates } = await processOpportunityAndSuggestions(
        site.getBaseURL(),
        {
          siteId,
          id: audit.getId(),
          auditId: audit.getId(),
          auditResult,
          scrapeJobId,
          scrapedUrlsSet,
        },
        context,
        isPaid,
      );
      opportunityWithSuggestions = opportunity;
      await sendPrerenderGuidanceRequestToMystique(
        site.getBaseURL(),
        { siteId, auditId: audit.getId(), scrapeJobId },
        opportunity,
        context,
        auditRunCandidates,
      );
    } else if (scrapeForbidden) {
      // Create a dummy opportunity when scraping is forbidden (403)
      // This allows the UI to display proper messaging without suggestions
      await createScrapeForbiddenOpportunity(site.getBaseURL(), {
        siteId,
        id: audit.getId(),
        auditId: audit.getId(),
        auditResult,
        scrapeJobId,
      }, context, isPaid);
    } else {
      log.info(`${LOG_PREFIX} No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, isPaidLLMOCustomer=${isPaid}`);

      const { Opportunity } = dataAccess;
      const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
      const existingOpportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

      if (existingOpportunity) {
        // Normalize scraped URLs to pathnames so domain shifts don't prevent
        // outdating existing suggestions.
        const scrapedPathnames = new Set(
          [...scrapedUrlsSet].map(toPathname),
        );
        const scrapedUrlsForNoOppty = {
          has: (url) => scrapedPathnames.has(toPathname(url)),
        };
        await syncSuggestions({
          opportunity: existingOpportunity,
          newData: [],
          context,
          buildKey: (suggestionData) => toPathname(suggestionData.url),
          mapNewSuggestion: () => ({}),
          scrapedUrlsSet: scrapedUrlsForNoOppty,
        });
        opportunityWithSuggestions = existingOpportunity;
      }
    }

    // When domain-wide suggestion has edgeDeployed, mark NEW suggestions as coveredByDomainWide
    // Only mark suggestions for pathnames confirmed deployed at edge in this audit run
    const deployedAtEdgePathnames = new Set(
      successfulComparisons
        .filter((r) => r.isDeployedAtEdge)
        .map((r) => toPathname(r.url)),
    );
    await markNewSuggestionsAsCovered(opportunityWithSuggestions, context, deployedAtEdgePathnames);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`${LOG_PREFIX} Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
      submittedUrlSet,
    };

    // Upload status summary to S3 (post-processing)
    await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);

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
