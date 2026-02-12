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
import { createAuditLogger } from '../common/context-logger.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const MAX_URLS_TO_PROCESS = 100;
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
export async function updateAuditResult(
  audit,
  auditResult,
  prioritizedLinks,
  dataAccess,
  log,
  siteId,
) {
  const updatedAuditResult = {
    ...auditResult,
    brokenInternalLinks: prioritizedLinks,
  };

  // Wrap logger with siteId context
  const contextLog = createAuditLogger(log, AUDIT_TYPE, siteId);

  try {
    const auditId = audit.getId ? audit.getId() : audit.id;

    // Try to update in-memory audit object first
    if (typeof audit.setAuditResult === 'function') {
      audit.setAuditResult(updatedAuditResult);
      await audit.save();
      contextLog.info(`Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
    } else {
      // Fallback: Update via database lookup
      const { Audit: AuditModel } = dataAccess;
      contextLog.info(`Falling back to database lookup for auditId: ${auditId}`);

      const auditToUpdate = await AuditModel.findById(auditId);

      if (auditToUpdate) {
        auditToUpdate.setAuditResult(updatedAuditResult);
        await auditToUpdate.save();
        contextLog.info(`Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
      } else {
        contextLog.error(`Could not find audit with ID ${auditId} to update`);
      }
    }
  } catch (error) {
    contextLog.error(`Failed to update audit result: ${error.message}`);
  }

  // Return the updated result so caller can use it directly
  return updatedAuditResult;
}

/** itemTypes excluded from broken-internal-links (handled by canonical/hreflang audits) */
const EXCLUDED_ITEM_TYPES = new Set(['canonical', 'alternate']);

/**
 * Returns true if the link is from a canonical or hreflang tag.
 * Those are covered by dedicated canonical/hreflang audits and should not be
 * counted as broken internal links.
 * @param {Object} link - Link object (may have itemType)
 * @returns {boolean}
 */
function isCanonicalOrHreflangLink(link) {
  return link?.itemType && EXCLUDED_ITEM_TYPES.has(link.itemType);
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
  const { log: baseLog, site } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());
  const finalUrl = await wwwUrlResolver(site, context);

  log.info('====== RUM Detection Phase ======');
  log.info(`Site: ${site.getId()}, Domain: ${finalUrl}`);

  try {
    // 1. Create RUM API client
    const rumAPIClient = RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    log.info(`Querying RUM API for 404 internal links (interval: ${INTERVAL} days)`);

    // 3. Query for 404 internal links
    const internal404Links = await rumAPIClient.query('404-internal-links', options);
    log.info(`Found ${internal404Links.length} 404 internal links from RUM data`);

    if (internal404Links.length === 0) {
      log.info('No 404 internal links found in RUM data');
      log.info('================================');
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
    log.info(`Validating ${internal404Links.length} links to confirm they are still broken...`);

    const accessibilitySettled = await Promise.allSettled(
      internal404Links.map(async (link) => ({
        link,
        inaccessible: await isLinkInaccessible(link.url_to, baseLog, site.getId()),
      })),
    );

    const accessibilityResults = accessibilitySettled
      .filter((result) => {
        if (result.status === 'rejected') {
          log.error(`Link validation failed: ${result.reason}`);
          return false;
        }
        return true;
      })
      .map((result) => result.value);

    // Count validation results
    const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
    const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
    const failed = accessibilitySettled.filter((r) => r.status === 'rejected').length;
    log.info(`Validation results: ${stillBroken} still broken, ${nowFixed} now fixed${failed > 0 ? `, ${failed} failed` : ''}`);

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();

    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => (
        // Filter broken links to only include those within audit scope
        isWithinAuditScope(result.link.url_from, baseURL)
        && isWithinAuditScope(result.link.url_to, baseURL)
      ))
      .map((result) => ({
        // Store URLs as-is (same as crawl) so broken canonicals with wrong encoding are reported
        urlFrom: result.link.url_from,
        urlTo: result.link.url_to,
        trafficDomain: result.link.traffic_domain,
      }));

    // Calculate total traffic impact
    const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
    log.info(`RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
    log.info('================================');

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
    log.error(`audit failed with error: ${error.message}`, error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

/**
 * Step 1: Run RUM detection and trigger import worker to fetch top pages.
 *
 * Returns `type: 'top-pages'` which signals the import worker to:
 * - Fetch Ahrefs top pages
 * - Store them in the database (SiteTopPage)
 * - Return control to next audit step
 */
export async function runAuditAndImportTopPagesStep(context) {
  const { site, log: baseLog, finalUrl } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());

  log.info('====== Step 1: RUM Detection + Import Top Pages ======');
  log.debug('Starting RUM detection audit');

  const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
    finalUrl,
    context,
  );

  const { success } = internalLinksAuditRunnerResult.auditResult;

  if (!success) {
    log.error('RUM detection audit failed');
    throw new Error('Audit failed, skip scraping and suggestion generation');
  }

  log.info(`RUM detection complete. Found ${internalLinksAuditRunnerResult.auditResult.brokenInternalLinks?.length || 0} broken links`);
  log.info('Triggering import worker to fetch Ahrefs top pages');
  log.info('=====================================================');

  return {
    auditResult: internalLinksAuditRunnerResult.auditResult,
    fullAuditRef: finalUrl,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Step 2: Submit URLs for scraping (after import worker has fetched top pages).
 *
 * Flow:
 * 1. Read Ahrefs top pages from database (imported by worker)
 * 2. Get includedURLs from siteConfig
 * 3. Merge, deduplicate, filter by scope, and submit for scraping
 */
export async function submitForScraping(context) {
  const {
    site, dataAccess, log: baseLog, audit,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), audit.getId());
  const { SiteTopPage } = dataAccess;

  const { success } = audit.getAuditResult();

  if (!success) {
    log.error('Audit failed, skip scraping and suggestion generation');
    throw new Error('Audit failed, skip scraping and suggestion generation');
  }

  log.info('====== Step 2: Submit For Scraping ======');

  let topPagesUrls = [];
  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPagesUrls = topPages.map((page) => page.getUrl());
    log.info(`Found ${topPagesUrls.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`Failed to fetch Ahrefs top pages from database: ${error.message}`);
    topPagesUrls = [];
  }

  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`Found ${includedURLs.length} includedURLs from siteConfig`);

  let finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`Merged URLs: ${topPagesUrls.length} (Ahrefs) + ${includedURLs.length} (manual) = ${finalUrls.length} unique`);

  const baseURL = site.getBaseURL();
  finalUrls = finalUrls.filter((url) => isWithinAuditScope(url, baseURL));
  log.info(`After audit scope filtering: ${finalUrls.length} URLs`);

  if (finalUrls.length > MAX_URLS_TO_PROCESS) {
    log.warn(`Capping URLs from ${finalUrls.length} to ${MAX_URLS_TO_PROCESS}`);
    finalUrls = finalUrls.slice(0, MAX_URLS_TO_PROCESS);
  }

  const beforeFilter = finalUrls.length;
  finalUrls = finalUrls.filter((url) => !isUnscrapeable(url));
  if (beforeFilter > finalUrls.length) {
    log.info(`Filtered out ${beforeFilter - finalUrls.length} unscrape-able files`);
  }

  if (finalUrls.length === 0) {
    log.warn('No URLs available for scraping');
    log.info('==========================================');
    return {
      auditResult: audit.getAuditResult(),
      fullAuditRef: audit.getFullAuditRef(),
      urls: [],
      siteId: site.getId(),
      type: 'broken-internal-links',
    };
  }

  log.info(`Submitting ${finalUrls.length} URLs for scraping (cache enabled)`);
  log.info('==========================================');

  // Configure scraper to capture lazy-loaded content
  // Many sites use Intersection Observers to load content (related articles, comments, etc.)
  // only when scrolled into view. scrollToBottom: true enables gradual scrolling with
  // safeguards against infinite scroll pages (10s max, height change detection).
  return {
    auditResult: audit.getAuditResult(),
    fullAuditRef: audit.getFullAuditRef(),
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'broken-internal-links',
    processingType: 'default',
    options: {
      // CRITICAL: Ensure JavaScript is enabled
      enableJavascript: true,
      // Increase from default 15s to 30s for slow sites
      pageLoadTimeout: 30000,
      // Wait for body element to be present
      waitForSelector: 'body',
      // Wait up to 5s for meta tags (legacy option)
      waitTimeoutForMetaTags: 5000,
      // Scroll to trigger lazy-loaded content like related blogs
      scrollToBottom: true,
    },
  };
}

export const opportunityAndSuggestionsStep = async (context) => {
  const {
    log: baseLog, site, finalUrl, sqs, env, dataAccess, audit, updatedAuditResult,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());
  const { Suggestion, SiteTopPage } = dataAccess;

  // Use updated result if passed (from crawl detection), otherwise read from audit
  const auditResultToUse = updatedAuditResult || audit.getAuditResult();
  const { brokenInternalLinks, success } = auditResultToUse;

  if (!success) {
    log.info('Audit failed, skipping suggestions generation');
    return { status: 'complete' };
  }
  // Exclude canonical and hreflang/alternate links; they are covered by dedicated audits
  const brokenInternalLinksFiltered = (brokenInternalLinks || []).filter(
    (link) => !isCanonicalOrHreflangLink(link),
  );

  if (!isNonEmptyArray(brokenInternalLinksFiltered)) {
    // no broken internal links found
    // fetch opportunity
    const { Opportunity } = dataAccess;
    let opportunity;
    try {
      const opportunities = await Opportunity
        .allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW);
      opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (!opportunity) {
      log.info('no broken internal links found, skipping opportunity creation');
    } else {
      log.info('no broken internal links found, updating opportunity to RESOLVED');
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);
      const suggestions = await opportunity.getSuggestions();
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return { status: 'complete' };
  }

  const kpiDeltas = calculateKpiDeltasForAudit(brokenInternalLinksFiltered);

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
    brokenInternalLinks: brokenInternalLinksFiltered,
    context,
    opportunityId: opportunity.getId(),
    log,
  });

  // Fetch Ahrefs top pages with error handling
  let ahrefsTopPages = [];
  try {
    ahrefsTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`Found ${ahrefsTopPages.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`Failed to fetch Ahrefs top pages: ${error.message}`);
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`Found ${includedURLs.length} includedURLs from siteConfig`);

  // Merge Ahrefs + includedURLs for alternatives
  const includedTopPages = includedURLs.map((url) => ({ getUrl: () => url }));
  let topPages = [...ahrefsTopPages, ...includedTopPages];

  // Limit total pages
  if (topPages.length > MAX_URLS_TO_PROCESS) {
    log.warn(`Capping URLs from ${topPages.length} to ${MAX_URLS_TO_PROCESS}`);
    topPages = topPages.slice(0, MAX_URLS_TO_PROCESS);
  }

  // Filter by audit scope
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
  log.info(`After audit scope filtering: ${filteredTopPages.length} top pages available`);

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
    log.info(`Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs`);
  }

  // Validate before sending to Mystique
  if (brokenLinks.length === 0) {
    log.warn('No valid broken links to send to Mystique. Skipping message.');
    return { status: 'complete' };
  }

  if (!opportunity?.getId()) {
    log.error('Opportunity ID is missing. Cannot send to Mystique.');
    return { status: 'complete' };
  }

  if (alternativeUrls.length === 0) {
    log.warn('No alternative URLs available. Skipping message to Mystique.');
    return { status: 'complete' };
  }

  // Batch broken links to stay within SQS message size limit (256KB)
  // Each batch gets its own message with batch metadata for Mystique to reassemble
  const totalBatches = Math.ceil(brokenLinks.length / MAX_BROKEN_LINKS);

  log.info(`Sending ${brokenLinks.length} broken links in ${totalBatches} batch(es) to Mystique`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * MAX_BROKEN_LINKS;
    const batchEnd = Math.min(batchStart + MAX_BROKEN_LINKS, brokenLinks.length);
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
    log.debug(`Batch ${batchIndex + 1}/${totalBatches} sent to Mystique (${batchLinks.length} links)`);
  }

  log.info(`Successfully sent all ${totalBatches} batch(es) to Mystique`);

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
    log: baseLog, site, audit, dataAccess,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), audit.getId());

  const auditId = audit.getId();
  const shouldCleanup = !skipCrawlDetection;

  log.info('====== Finalize: Merge and Generate Suggestions ======');
  log.info(`auditId: ${auditId}`);

  // Get RUM results from audit
  const auditResult = audit.getAuditResult();
  const rumLinks = auditResult.brokenInternalLinks ?? [];
  log.info(`RUM detection results: ${rumLinks.length} broken links`);

  let finalLinks = rumLinks;

  try {
    if (!skipCrawlDetection) {
      // Load final results from S3 (single file contains all accumulated results)
      const crawlLinks = await loadFinalResults(auditId, context);
      log.info(`Crawl detected ${crawlLinks.length} broken links`);

      // Merge crawl + RUM results (RUM takes priority for traffic data)
      finalLinks = mergeAndDeduplicate(crawlLinks, rumLinks, log);
    } else {
      log.info('No crawl results to merge, using RUM-only results');
    }

    // Calculate priority for all links
    const prioritizedLinks = calculatePriority(finalLinks);

    // Count by priority
    const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
    const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
    const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
    log.info(`Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

    // Update audit result with prioritized links
    const updatedAuditResult = await updateAuditResult(
      audit,
      auditResult,
      prioritizedLinks,
      dataAccess,
      baseLog,
      site.getId(),
    );

    log.info('=====================================================');

    // Generate opportunities and suggestions
    return opportunityAndSuggestionsStep({ ...context, updatedAuditResult });
  } finally {
    // Always cleanup S3 state file, even if an error occurred
    if (shouldCleanup) {
      await cleanupBatchState(auditId, context).catch((err) => log.warn(`Cleanup failed: ${err.message}`));
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
    log: baseLog, site, audit, auditContext, sqs, env,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), audit.getId());

  const scrapeResultPaths = context.scrapeResultPaths ?? new Map();
  const scrapeJobId = context.scrapeJobId || 'N/A';
  const auditId = audit.getId();

  // Extract batch index from auditContext (minimal state in SQS)
  const batchStartIndex = auditContext?.batchStartIndex || 0;

  const totalPages = scrapeResultPaths.size;
  const estimatedTotalBatches = Math.ceil(totalPages / PAGES_PER_BATCH);
  const currentBatchNum = Math.floor(batchStartIndex / PAGES_PER_BATCH);

  log.info(`====== Crawl Detection Batch ${currentBatchNum + 1}/${estimatedTotalBatches || 1} ======`);
  log.info(`scrapeJobId: ${scrapeJobId}`);
  log.info(`Total pages: ${totalPages}, Batch size: ${PAGES_PER_BATCH}`);

  // Handle case with no scraped content - go directly to merge step
  if (scrapeResultPaths.size === 0) {
    log.info('No scraped content available, proceeding to merge step');
    return finalizeCrawlDetection(context, { skipCrawlDetection: true });
  }

  // Check if batchStartIndex is already beyond total pages
  if (batchStartIndex >= totalPages) {
    log.info(`Batch start index (${batchStartIndex}) >= total pages (${totalPages}), all batches already complete`);
    return finalizeCrawlDetection(context, { skipCrawlDetection: false });
  }

  // Load existing state from S3 (includes accumulated results + caches)
  const existingState = await loadBatchState(auditId, context);
  const initialBrokenUrls = existingState.brokenUrlsCache;
  const initialWorkingUrls = existingState.workingUrlsCache;
  const accumulatedResults = existingState.results;

  log.info(`Loaded state: ${accumulatedResults.length} existing results, caches: ${initialBrokenUrls.length} broken, ${initialWorkingUrls.length} working`);

  // Process this batch
  const batchResult = await detectBrokenLinksFromCrawlBatch({
    scrapeResultPaths,
    batchStartIndex,
    batchSize: PAGES_PER_BATCH,
    initialBrokenUrls,
    initialWorkingUrls,
  }, context);

  // Accumulate results (append new results to existing)
  const allResults = accumulatedResults.concat(batchResult.results);
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

  log.info(`Batch ${currentBatchNum + 1} complete: ${batchResult.results.length} new broken links, ${allResults.length} total`);

  // Check if more pages remain
  if (batchResult.hasMorePages) {
    log.info(`${batchResult.totalPages - batchResult.nextBatchStartIndex} pages remaining, sending continuation message`);

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

    log.info(`Continuation payload: ${JSON.stringify(continuationPayload, null, 2)}`);

    await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
    log.info(`Continuation message sent to AUDIT_JOBS_QUEUE for batch ${currentBatchNum + 2}`);

    // Return - this Lambda invocation is complete, next batch will continue
    return { status: 'batch-continuation' };
  }
  log.info(`All ${currentBatchNum + 1} batches complete, proceeding to merge step`);
  return finalizeCrawlDetection(context, { skipCrawlDetection: false });
}

/**
 * Audit builder with batched crawl detection.
 *
 * Flow:
 * 1. runAuditAndSubmitForScraping - RUM detection, fetches Ahrefs top pages directly,
 *    merges with includedURLs, submits to scrape client
 * 2. runCrawlDetectionBatch - Process pages in batches (terminal step)
 *    - Processes PAGES_PER_BATCH pages per Lambda invocation
 *    - Stores batch results in S3 with broken/working URL caches
 *    - Loops back to itself via AUDIT_JOBS_QUEUE until all pages processed
 *    - When complete, internally merges results and generates opportunities
 *
 * This batched approach prevents Lambda timeout (15 min limit) by splitting
 * work across multiple invocations, each getting a fresh 15-minute timer.
 */
export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPagesStep',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'submitForScraping',
    submitForScraping,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('runCrawlDetectionBatch', runCrawlDetectionBatch)
  .build();
