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
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess }
  from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { isUnscrapeable } from '../utils/url-utils.js';
import { syncBrokenInternalLinksSuggestions } from './suggestions-generator.js';
import {
  isLinkInaccessible,
  calculatePriority, calculateKpiDeltasForAudit,
} from './helpers.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { filterByAuditScope, isWithinAuditScope, extractPathPrefix } from './subpath-filter.js';
import {
  detectBrokenLinksFromCrawl,
  detectBrokenLinksFromCrawlBatch,
  mergeAndDeduplicate,
  PAGES_PER_BATCH,
} from './crawl-detection.js';
import {
  loadBatchState,
  saveBatchState,
  loadFinalResults,
  cleanupBatchState,
} from './batch-state.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const MAX_URLS_TO_PROCESS = 1000;
const MAX_BROKEN_LINKS = 100;

/**
 * Updates the audit result with prioritized broken internal links.
 *
 * @param {Object} audit - The audit object
 * @param {Object} auditResult - The current audit result
 * @param {Array} prioritizedLinks - Array of prioritized broken links
 * @param {Object} dataAccess - Data access object containing models
 * @param {Object} log - Logger instance
 */
export async function updateAuditResult(audit, auditResult, prioritizedLinks, dataAccess, log) {
  const updatedAuditResult = {
    ...auditResult,
    brokenInternalLinks: prioritizedLinks,
  };

  try {
    const auditId = audit.getId ? audit.getId() : audit.id;

    // Try to update in-memory audit object first
    if (typeof audit.setAuditResult === 'function') {
      audit.setAuditResult(updatedAuditResult);
      await audit.save();
      log.info(`[${AUDIT_TYPE}] Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
    } else {
      // Fallback: Update via database lookup
      const { Audit: AuditModel } = dataAccess;
      log.info(`[${AUDIT_TYPE}] Falling back to database lookup for auditId: ${auditId}`);

      const auditToUpdate = await AuditModel.findById(auditId);

      if (auditToUpdate) {
        auditToUpdate.setAuditResult(updatedAuditResult);
        await auditToUpdate.save();
        log.info(`[${AUDIT_TYPE}] Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
      } else {
        log.error(`[${AUDIT_TYPE}] Could not find audit with ID ${auditId} to update`);
      }
    }
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] Failed to update audit result: ${error.message}`);
  }

  // Return the updated result so caller can use it directly
  return updatedAuditResult;
}

/**
 * Normalize URL to match site's canonical baseURL (handles www/non-www variations).
 * @param {string} url - The URL to normalize
 * @param {string} canonicalDomain - The site's canonical domain (e.g., 'hdfc.bank.in')
 * @returns {string} Normalized URL
 */
export function normalizeUrlToDomain(url, canonicalDomain) {
  try {
    const urlObj = new URL(url);
    const canonicalHostname = new URL(`https://${canonicalDomain}`).hostname;

    // Replace hostname with canonical hostname (handles www/non-www)
    urlObj.hostname = canonicalHostname;

    return urlObj.toString();
  } catch (e) {
    // If URL parsing fails, return original
    return url;
  }
}

/**
 * Perform an audit to check which internal links for domain are broken.
 * This is the RUM-based detection phase.
 *
 * @async
 * @param {string} auditUrl - The URL to run audit against
 * @param {Object} context - The context object
 * @returns {Object} - Returns audit result (without priority - calculated after merge)
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log, site } = context;
  const finalUrl = await wwwUrlResolver(site, context);

  log.info(`[${AUDIT_TYPE}] ====== RUM Detection Phase ======`);
  log.info(`[${AUDIT_TYPE}] ✓ BATCHED CRAWL DETECTION CODE ACTIVE (v2 with S3 state management)`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, Domain: ${finalUrl}`);

  try {
    // 1. Create RUM API client
    const rumAPIClient = RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    log.info(`[${AUDIT_TYPE}] Querying RUM API for 404 internal links (interval: ${INTERVAL} days)`);

    // 3. Query for 404 internal links
    const internal404Links = await rumAPIClient.query('404-internal-links', options);
    log.info(`[${AUDIT_TYPE}] Found ${internal404Links.length} 404 internal links from RUM data`);

    if (internal404Links.length === 0) {
      log.info(`[${AUDIT_TYPE}] No 404 internal links found in RUM data`);
      log.info(`[${AUDIT_TYPE}] ================================`);
      return {
        auditResult: {
          brokenInternalLinks: [],
          fullAuditRef: auditUrl,
          finalUrl,
          auditContext: { interval: INTERVAL },
          success: true,
        },
        fullAuditRef: auditUrl,
      };
    }

    // 4. Check accessibility in parallel before transformation
    log.info(`[${AUDIT_TYPE}] Validating ${internal404Links.length} links to confirm they are still broken...`);

    const accessibilityResults = await Promise.all(
      internal404Links.map(async (link) => ({
        link,
        inaccessible: await isLinkInaccessible(link.url_to, log),
      })),
    );

    // Count validation results
    const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
    const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
    log.info(`[${AUDIT_TYPE}] Validation results: ${stillBroken} still broken, ${nowFixed} now fixed`);

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();
    // Use finalUrl as canonical domain - it respects overrideBaseURL from wwwUrlResolver
    // finalUrl is just hostname, so add protocol for URL parsing
    const canonicalDomain = finalUrl;

    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => (
        // Filter broken links to only include those within audit scope
        isWithinAuditScope(result.link.url_from, baseURL)
        && isWithinAuditScope(result.link.url_to, baseURL)
      ))
      .map((result) => ({
        // Normalize URLs to match site's canonical domain (respects overrideBaseURL)
        // This ensures consistency: RUM may have www.example.com but site is example.com
        // All stored URLs will match the resolved canonical domain
        urlFrom: normalizeUrlToDomain(result.link.url_from, canonicalDomain),
        urlTo: normalizeUrlToDomain(result.link.url_to, canonicalDomain),
        trafficDomain: result.link.traffic_domain,
      }));

    // Calculate total traffic impact
    const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
    log.info(`[${AUDIT_TYPE}] RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
    log.info(`[${AUDIT_TYPE}] ================================`);

    // 6. Prioritize links
    const prioritizedLinks = calculatePriority(inaccessibleLinks);

    // 7. Build and return audit result
    return {
      auditResult: {
        brokenInternalLinks: prioritizedLinks,
        fullAuditRef: auditUrl,
        finalUrl,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`, error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `[${AUDIT_TYPE}] [Site: ${site.getId()}] audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

export async function runAuditAndImportTopPagesStep(context) {
  const { site, log, finalUrl } = context;
  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] starting audit`);
  const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
    finalUrl,
    context,
  );

  return {
    auditResult: internalLinksAuditRunnerResult.auditResult,
    fullAuditRef: finalUrl,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Submit URLs for scraping (for crawl-based detection).
 * Combines Ahrefs top pages + includedURLs from siteConfig.
 */
export async function prepareScraping(context) {
  const {
    site, dataAccess, log, audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  const { success } = audit.getAuditResult();

  if (!success) {
    throw new Error(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skip scraping and suggestion generation`);
  }

  log.info(`[${AUDIT_TYPE}] ====== Prepare Scraping Step ======`);
  log.info(`[${AUDIT_TYPE}] ✓ BATCHED CRAWL DETECTION CODE ACTIVE (Step: prepareScraping with cache enabled)`);

  // Fetch Ahrefs top pages with error handling
  let topPagesUrls = [];
  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPagesUrls = topPages.map((page) => page.getUrl());
    log.info(`[${AUDIT_TYPE}] Found ${topPagesUrls.length} Ahrefs top pages`);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}] Failed to fetch Ahrefs top pages: ${error.message}`);
    topPagesUrls = [];
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`[${AUDIT_TYPE}] Found ${includedURLs.length} includedURLs from siteConfig`);

  // Merge and deduplicate
  let finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`[${AUDIT_TYPE}] Merged URLs: ${topPagesUrls.length} (Ahrefs) + ${includedURLs.length} (manual) = ${finalUrls.length} unique`);

  // Filter by audit scope BEFORE capping to ensure all URLs are in scope
  const baseURL = site.getBaseURL();
  finalUrls = finalUrls.filter((url) => isWithinAuditScope(url, baseURL));
  log.info(`[${AUDIT_TYPE}] After audit scope filtering: ${finalUrls.length} URLs`);

  // Limit to max URLs (after scope filtering)
  if (finalUrls.length > MAX_URLS_TO_PROCESS) {
    log.warn(`[${AUDIT_TYPE}] Total URLs (${finalUrls.length}) exceeds limit. Capping at ${MAX_URLS_TO_PROCESS}`);
    finalUrls = finalUrls.slice(0, MAX_URLS_TO_PROCESS);
  }

  // Filter out unscrape-able files
  const beforeFilter = finalUrls.length;
  finalUrls = finalUrls.filter((url) => !isUnscrapeable(url));
  if (beforeFilter > finalUrls.length) {
    log.info(`[${AUDIT_TYPE}] Filtered out ${beforeFilter - finalUrls.length} unscrape-able files`);
  }

  if (finalUrls.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No URLs available for scraping`);
    log.info(`[${AUDIT_TYPE}] =======================================`);
    return {
      urls: [],
      siteId: site.getId(),
      type: 'broken-internal-links',
    };
  }

  // Skip redirect resolution to avoid delays and timeouts
  // Assume Ahrefs top pages and configured URLs are already valid
  log.info(`[${AUDIT_TYPE}] Skipping redirect resolution (assuming ${finalUrls.length} URLs are valid)`);
  const uniqueResolvedUrls = finalUrls;

  const scrapingPayload = {
    urls: uniqueResolvedUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'broken-internal-links',
  };

  log.info(`[${AUDIT_TYPE}] Submitting ${uniqueResolvedUrls.length} URLs for scraping (cache enabled)`);
  log.info(`[${AUDIT_TYPE}] Scraping job details: siteId=${site.getId()}, type=${scrapingPayload.type}, urlCount=${uniqueResolvedUrls.length}`);
  log.info(`[${AUDIT_TYPE}] =======================================`);

  return scrapingPayload;
}

export const opportunityAndSuggestionsStep = async (context) => {
  const {
    log, site, finalUrl, sqs, env, dataAccess, audit, updatedAuditResult,
  } = context;
  const { Suggestion, SiteTopPage } = dataAccess;

  // Use updated result if passed (from crawl detection), otherwise read from audit
  const auditResultToUse = updatedAuditResult || audit.getAuditResult();
  const { brokenInternalLinks, success } = auditResultToUse;

  if (!success) {
    log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Audit failed, skipping suggestions generation`);
    return { status: 'complete' };
  }

  if (!isNonEmptyArray(brokenInternalLinks)) {
    // no broken internal links found - handle existing opportunity
    const { Opportunity } = dataAccess;
    let opportunity;
    try {
      const opportunities = await Opportunity
        .allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW);
      opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities for siteId ${site.getId()} failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (!opportunity) {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, skipping opportunity creation`);
    } else {
      log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] no broken internal links found, updating opportunity to RESOLVED`);
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);
      const suggestions = await opportunity.getSuggestions();
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.FIXED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return { status: 'complete' };
  }

  const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinks);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { kpiDeltas },
  );

  await syncBrokenInternalLinksSuggestions({
    opportunity,
    brokenInternalLinks,
    context,
    opportunityId: opportunity.getId(),
    log,
  });

  // Fetch Ahrefs top pages with error handling
  let ahrefsTopPages = [];
  try {
    ahrefsTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`[${AUDIT_TYPE}] Found ${ahrefsTopPages.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`[${AUDIT_TYPE}] Failed to fetch Ahrefs top pages: ${error.message}`);
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`[${AUDIT_TYPE}] Found ${includedURLs.length} includedURLs from siteConfig`);

  // Merge Ahrefs + includedURLs for alternatives
  const includedTopPages = includedURLs.map((url) => ({ getUrl: () => url }));
  let topPages = [...ahrefsTopPages, ...includedTopPages];

  // Limit total pages
  if (topPages.length > MAX_URLS_TO_PROCESS) {
    log.warn(`[${AUDIT_TYPE}] Capping URLs from ${topPages.length} to ${MAX_URLS_TO_PROCESS}`);
    topPages = topPages.slice(0, MAX_URLS_TO_PROCESS);
  }

  // Filter by audit scope
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
  log.info(`[${AUDIT_TYPE}] After audit scope filtering: ${filteredTopPages.length} top pages available`);

  // Auto-suggest enabled for all sites
  const suggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionDataAccess.STATUSES.NEW,
  );

  // Build broken links array for Mystique
  const brokenLinks = suggestions
    .map((suggestion) => ({
      urlFrom: suggestion?.getData()?.urlFrom,
      urlTo: suggestion?.getData()?.urlTo,
      suggestionId: suggestion?.getId(),
    }))
    .filter((link) => link.urlFrom && link.urlTo && link.suggestionId);

  // Filter alternatives by locales present in broken links
  // URLs are already normalized at audit time (step 5 in internalLinksAuditRunner)
  const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());
  const brokenLinkLocales = new Set();
  brokenLinks.forEach((link) => {
    const locale = extractPathPrefix(link.urlTo);
    if (locale) brokenLinkLocales.add(locale);
  });

  let alternativeUrls = [];
  if (brokenLinkLocales.size > 0) {
    alternativeUrls = allTopPageUrls.filter((url) => {
      const urlLocale = extractPathPrefix(url);
      return !urlLocale || brokenLinkLocales.has(urlLocale);
    });
  } else {
    alternativeUrls = allTopPageUrls;
  }

  // Filter out unscrape-able files
  const originalCount = alternativeUrls.length;
  alternativeUrls = alternativeUrls.filter((url) => !isUnscrapeable(url));
  if (alternativeUrls.length < originalCount) {
    log.info(`[${AUDIT_TYPE}] Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs`);
  }

  // Note: alternativeUrls limit removed as it's unreachable
  // topPages is capped to MAX_URLS_TO_PROCESS, so alternativeUrls can't exceed it

  // Validate before sending to Mystique
  if (brokenLinks.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No valid broken links to send to Mystique. Skipping message.`);
    return { status: 'complete' };
  }

  if (!opportunity?.getId()) {
    log.error(`[${AUDIT_TYPE}] Opportunity ID is missing. Cannot send to Mystique.`);
    return { status: 'complete' };
  }

  if (alternativeUrls.length === 0) {
    log.warn(`[${AUDIT_TYPE}] No alternative URLs available. Skipping message to Mystique.`);
    return { status: 'complete' };
  }

  // Batch broken links to stay within SQS message size limit (256KB)
  // Each batch gets its own message with batch metadata for Mystique to reassemble
  const BATCH_SIZE = MAX_BROKEN_LINKS; // 100 links per batch
  const totalBatches = Math.ceil(brokenLinks.length / BATCH_SIZE);

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Sending ${brokenLinks.length} broken links in ${totalBatches} batch(es) to Mystique`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batchEnd = Math.min(batchStart + BATCH_SIZE, brokenLinks.length);
    const batchLinks = brokenLinks.slice(batchStart, batchEnd);

    const message = {
      type: 'guidance:broken-links',
      siteId: site.getId(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        alternativeUrls,
        opportunityId: opportunity.getId(),
        brokenLinks: batchLinks,
        // Include canonical domain for Mystique to use when looking up content
        // This ensures Mystique uses the same domain as the normalized URLs
        siteBaseURL: `https://${finalUrl}`,
        // Batch metadata for Mystique to handle multiple messages
        batchInfo: {
          batchIndex,
          totalBatches,
          totalBrokenLinks: brokenLinks.length,
          batchSize: batchLinks.length,
        },
      },
    };

    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(`[${AUDIT_TYPE}] Batch ${batchIndex + 1}/${totalBatches} sent to Mystique (${batchLinks.length} links)`);
  }

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Successfully sent all ${totalBatches} batch(es) to Mystique`);

  return { status: 'complete' };
};

/**
 * Internal function: Merge all batch results with RUM data and generate opportunities/suggestions.
 * Called by runCrawlDetectionBatch when all batches are complete.
 *
 * @param {Object} context - Audit context
 * @param {Object} options - Options
 * @param {boolean} options.skipCrawlDetection - Whether crawl detection was skipped
 * @returns {Promise<Object>} Result of opportunityAndSuggestionsStep
 */
export async function finalizeCrawlDetection(context, { skipCrawlDetection = false }) {
  const {
    log, site, audit, dataAccess,
  } = context;

  const auditId = audit.getId();
  const shouldCleanup = !skipCrawlDetection;

  log.info(`[${AUDIT_TYPE}] ====== Finalize: Merge and Generate Suggestions ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, auditId: ${auditId}`);

  // Get RUM results from audit
  const auditResult = audit.getAuditResult();
  const rumLinks = auditResult.brokenInternalLinks ?? [];
  log.info(`[${AUDIT_TYPE}] RUM detection results: ${rumLinks.length} broken links`);

  let finalLinks = rumLinks;

  try {
    if (!skipCrawlDetection) {
      // Load final results from S3 (single file contains all accumulated results)
      const crawlLinks = await loadFinalResults(auditId, context);
      log.info(`[${AUDIT_TYPE}] Crawl detected ${crawlLinks.length} broken links`);

      // Merge crawl + RUM results (RUM takes priority for traffic data)
      finalLinks = mergeAndDeduplicate(crawlLinks, rumLinks, log);
    } else {
      log.info(`[${AUDIT_TYPE}] No crawl results to merge, using RUM-only results`);
    }

    // Calculate priority for all links
    const prioritizedLinks = calculatePriority(finalLinks);

    // Count by priority
    const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
    const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
    const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
    log.info(`[${AUDIT_TYPE}] Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

    // Update audit result with prioritized links
    const updatedAuditResult = await updateAuditResult(
      audit,
      auditResult,
      prioritizedLinks,
      dataAccess,
      log,
    );

    log.info(`[${AUDIT_TYPE}] =====================================================`);

    // Generate opportunities and suggestions
    return opportunityAndSuggestionsStep({ ...context, updatedAuditResult });
  } finally {
    // Always cleanup S3 state file, even if an error occurred
    if (shouldCleanup) {
      await cleanupBatchState(auditId, context).catch((err) => log.warn(`[${AUDIT_TYPE}] Cleanup failed: ${err.message}`));
    }
  }
}

/**
 * Run crawl-based detection in batches to avoid Lambda timeout.
 * This is the terminal step that processes PAGES_PER_BATCH pages at a time,
 * loops back to itself via SQS until all pages are processed, then completes
 * the audit by merging results and generating opportunities.
 *
 * State is stored in a SINGLE S3 file that accumulates:
 * - results: All broken links found so far
 * - brokenUrlsCache: All known broken URLs (for cache efficiency)
 * - workingUrlsCache: All known working URLs (for cache efficiency)
 * - lastBatchNum: Last completed batch number
 * - totalPagesProcessed: Total pages processed so far
 *
 * SQS message only contains minimal info (batchStartIndex), caches are loaded from S3.
 */
export async function runCrawlDetectionBatch(context) {
  const {
    log, site, audit, auditContext, sqs, env,
  } = context;

  const scrapeResultPaths = context.scrapeResultPaths ?? new Map();
  const scrapeJobId = context.scrapeJobId || 'N/A';
  const auditId = audit.getId();

  // Extract batch index from auditContext (minimal state in SQS)
  const batchStartIndex = auditContext?.batchStartIndex || 0;

  const totalPages = scrapeResultPaths.size;
  const estimatedTotalBatches = Math.ceil(totalPages / PAGES_PER_BATCH);
  const currentBatchNum = Math.floor(batchStartIndex / PAGES_PER_BATCH);

  log.info(`[${AUDIT_TYPE}] ====== Crawl Detection Batch ${currentBatchNum + 1}/${estimatedTotalBatches || 1} ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, scrapeJobId: ${scrapeJobId}`);
  log.info(`[${AUDIT_TYPE}] Total pages: ${totalPages}, Batch size: ${PAGES_PER_BATCH}`);

  // Handle case with no scraped content - go directly to merge step
  if (scrapeResultPaths.size === 0) {
    log.info(`[${AUDIT_TYPE}] No scraped content available, proceeding to merge step`);
    return finalizeCrawlDetection(context, { skipCrawlDetection: true });
  }

  // Check if batchStartIndex is already beyond total pages
  if (batchStartIndex >= totalPages) {
    log.info(`[${AUDIT_TYPE}] Batch start index (${batchStartIndex}) >= total pages (${totalPages}), all batches already complete`);
    return finalizeCrawlDetection(context, { skipCrawlDetection: false });
  }

  // Load existing state from S3 (includes accumulated results + caches)
  const existingState = await loadBatchState(auditId, context);
  const initialBrokenUrls = existingState.brokenUrlsCache;
  const initialWorkingUrls = existingState.workingUrlsCache;
  const accumulatedResults = existingState.results;

  log.info(`[${AUDIT_TYPE}] Loaded state: ${accumulatedResults.length} existing results, caches: ${initialBrokenUrls.length} broken, ${initialWorkingUrls.length} working`);

  // Process this batch
  const batchResult = await detectBrokenLinksFromCrawlBatch({
    scrapeResultPaths,
    batchStartIndex,
    batchSize: PAGES_PER_BATCH,
    initialBrokenUrls,
    initialWorkingUrls,
  }, context);

  // Accumulate results (append new results to existing)
  const allResults = [...accumulatedResults, ...batchResult.results];
  const totalPagesProcessed = (existingState.totalPagesProcessed || 0) + batchResult.pagesProcessed;

  // Save accumulated state to S3 (single file)
  await saveBatchState({
    auditId,
    results: allResults,
    brokenUrlsCache: batchResult.brokenUrlsCache,
    workingUrlsCache: batchResult.workingUrlsCache,
    batchNum: currentBatchNum,
    totalPagesProcessed,
  }, context);

  log.info(`[${AUDIT_TYPE}] Batch ${currentBatchNum + 1} complete: ${batchResult.results.length} new broken links, ${allResults.length} total`);

  // Check if more pages remain
  if (batchResult.hasMorePages) {
    log.info(`[${AUDIT_TYPE}] ${batchResult.totalPages - batchResult.nextBatchStartIndex} pages remaining, sending continuation message`);

    // Send continuation message back to AUDIT_JOBS_QUEUE
    // Note: Caches are in S3 now, so SQS message is minimal
    const continuationPayload = {
      type: AUDIT_TYPE,
      siteId: site.getId(),
      auditContext: {
        next: 'runCrawlDetectionBatch', // Loop back to same step
        auditId,
        auditType: audit.getAuditType(),
        fullAuditRef: audit.getFullAuditRef(),
        scrapeJobId,
        // Only pass the index - caches are loaded from S3
        batchStartIndex: batchResult.nextBatchStartIndex,
      },
    };

    // Log the continuation payload for debugging
    log.info(`[${AUDIT_TYPE}] Continuation payload: ${JSON.stringify(continuationPayload, null, 2)}`);

    await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
    log.info(`[${AUDIT_TYPE}] Continuation message sent to AUDIT_JOBS_QUEUE for batch ${currentBatchNum + 2}`);

    // Return - this Lambda invocation is complete, next batch will continue
    return { status: 'batch-continuation' };
  }
  log.info(`[${AUDIT_TYPE}] All ${currentBatchNum + 1} batches complete, proceeding to merge step`);
  return finalizeCrawlDetection(context, { skipCrawlDetection: false });
}

/**
 * Run crawl-based detection, merge with RUM results, and generate opportunities/suggestions.
 * @deprecated Use runCrawlDetectionBatch for batched processing
 */
export async function runCrawlDetectionAndGenerateSuggestions(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  const scrapeResultPaths = context.scrapeResultPaths ?? new Map();
  const scrapeJobId = context.scrapeJobId || 'N/A';

  log.info(`[${AUDIT_TYPE}] ====== Crawl Detection Step (Legacy) ======`);
  log.info(`[${AUDIT_TYPE}] Site: ${site.getId()}, scrapeJobId: ${scrapeJobId}, scrapeResultPaths: ${scrapeResultPaths.size}`);

  // Get RUM results from previous audit step
  const auditResult = audit.getAuditResult();
  const rumLinks = auditResult.brokenInternalLinks || [];

  log.info(`[${AUDIT_TYPE}] RUM detection results: ${rumLinks.length} broken links`);

  let finalLinks = rumLinks;

  if (scrapeResultPaths.size > 0) {
    // Run crawl detection
    const crawlLinks = await detectBrokenLinksFromCrawl(scrapeResultPaths, context);
    log.info(`[${AUDIT_TYPE}] Crawl detected ${crawlLinks.length} broken links`);

    // Merge crawl + RUM results (RUM takes priority for traffic data)
    finalLinks = mergeAndDeduplicate(crawlLinks, rumLinks, log);
  } else {
    log.info(`[${AUDIT_TYPE}] No scraped content available, using RUM-only results`);
  }

  // Calculate priority for all links
  const prioritizedLinks = calculatePriority(finalLinks);

  // Count by priority
  const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
  const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
  const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
  log.info(`[${AUDIT_TYPE}] Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

  // Update audit result with prioritized links
  const updatedAuditResult = await updateAuditResult(
    audit,
    auditResult,
    prioritizedLinks,
    dataAccess,
    log,
  );

  log.info(`[${AUDIT_TYPE}] ===================================`);

  // Now generate opportunities and suggestions
  return opportunityAndSuggestionsStep({ ...context, updatedAuditResult });
}

// Alias for backward compatibility with tests
export { prepareScraping as prepareScrapingStep, prepareScraping as submitForScraping };

/**
 * Audit builder with batched crawl detection.
 *
 * Flow:
 * 1. runAuditAndImportTopPages - RUM-based detection, triggers import worker
 * 2. prepareScraping - Submit URLs to scrape client for crawling
 * 3. runCrawlDetectionBatch - Process pages in batches (terminal step)
 *    - Processes PAGES_PER_BATCH pages per Lambda invocation
 *    - Passes broken/working URL caches via SQS message
 *    - Stores batch results in S3
 *    - Loops back to itself via AUDIT_JOBS_QUEUE until all pages processed
 *    - When complete, internally merges results and generates opportunities
 *
 * This batched approach prevents Lambda timeout (15 min limit) by splitting
 * work across multiple invocations, each getting a fresh 15-minute timer.
 */
export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPages',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'prepareScraping',
    prepareScraping,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('runCrawlDetectionBatch', runCrawlDetectionBatch) // Terminal step - manages own batching
  .build();
