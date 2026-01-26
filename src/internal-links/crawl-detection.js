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

import { load as cheerioLoad } from 'cheerio';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { isLinkInaccessible } from './helpers.js';
import { isWithinAuditScope } from './subpath-filter.js';
import { createContextLogger } from './logger-helper.js';

// Optimized settings for speed and reliability while respecting target server
const SCRAPE_FETCH_DELAY_MS = 50; // No delay between S3 fetches (S3 is fast)
const LINK_CHECK_BATCH_SIZE = 10; // Check 10 links at a time
const LINK_CHECK_DELAY_MS = 300; // 300ms delay between batches to be respectful to target server

// Batching configuration
export const PAGES_PER_BATCH = 10; // Process 10 pages per Lambda invocation

/**
 * Sleep utility to add delays between operations
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Extracts and validates broken internal links from scraped HTML content.
 * @param {Map} scrapeResultPaths - Map of URL to S3 path (url -> s3Key)
 * @param {Object} context - Context object with s3Client, log, env, site
 * @returns {Promise<Array>} Array of broken internal links with urlFrom, urlTo, trafficDomain=0
 */
export async function detectBrokenLinksFromCrawl(scrapeResultPaths, context) {
  const {
    s3Client, env, log: baseLog, site,
  } = context;
  const log = createContextLogger(baseLog, site.getId());
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const baseURL = site.getBaseURL();
  const baseHostname = new URL(baseURL).hostname.replace(/^www\./, '');

  const startTime = Date.now();
  const formatElapsed = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

  log.info(`[broken-internal-links-crawl] ${formatElapsed()} Processing ${scrapeResultPaths.size} scraped pages`);

  const brokenLinksMap = new Map();
  const brokenUrlsCache = new Set();
  const workingUrlsCache = new Set();
  const allValidationResults = []; // Collect all results for final stats
  let pagesProcessed = 0;
  let pagesSkipped = 0;

  log.info(`[broken-internal-links-crawl] ${formatElapsed()} Starting crawl detection for ${scrapeResultPaths.size} pages`);

  for (const [url, s3Key] of scrapeResultPaths) {
    try {
      pagesProcessed += 1;

      // Log progress every 2 pages with timestamp
      if (pagesProcessed % 2 === 1) {
        log.info(`[broken-internal-links-crawl] ${formatElapsed()} Progress: ${pagesProcessed}/${scrapeResultPaths.size} pages`);
      }

      // eslint-disable-next-line no-await-in-loop
      const s3Object = await getObjectFromKey(s3Client, bucketName, s3Key, log);

      if (!s3Object?.scrapeResult?.rawBody) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      const html = s3Object.scrapeResult.rawBody;
      const pageUrl = s3Object.finalUrl || url;

      if (!isWithinAuditScope(pageUrl, baseURL)) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      // Extract internal links (skip header/footer)
      const $ = cheerioLoad(html);
      const internalLinks = [];

      $('a[href]').each((_, el) => {
        const $a = $(el);
        if ($a.closest('header').length || $a.closest('footer').length) return;

        const href = $a.attr('href');
        if (!href || href.startsWith('#')) return;

        try {
          const absoluteUrl = new URL(href, pageUrl).toString();
          const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

          if (linkHostname === baseHostname) {
            internalLinks.push({
              url: absoluteUrl,
              anchorText: $a.text().trim() || '[no text]',
            });
          }
        } catch (urlError) {
          // Skip invalid URLs (malformed hrefs that can't be parsed)
          log.debug(`[broken-internal-links-crawl] Skipping invalid href on ${pageUrl}: ${href}`);
        }
      });

      // Validate links in batches to prevent overwhelming target server
      const validations = [];
      const totalBatches = Math.ceil(internalLinks.length / LINK_CHECK_BATCH_SIZE);
      if (internalLinks.length > 0) {
        log.debug(`[broken-internal-links-crawl] ${formatElapsed()} Checking ${internalLinks.length} links in ${totalBatches} batches of ${LINK_CHECK_BATCH_SIZE}`);
      }

      // eslint-disable-next-line no-await-in-loop
      for (let i = 0; i < internalLinks.length; i += LINK_CHECK_BATCH_SIZE) {
        const batch = internalLinks.slice(i, i + LINK_CHECK_BATCH_SIZE);

        // eslint-disable-next-line no-await-in-loop
        const batchResults = await Promise.all(
          batch.map(async (link) => {
            if (!isWithinAuditScope(link.url, baseURL)) return { type: 'out-of-scope' };

            // Check cache first - if already known broken, return immediately
            if (brokenUrlsCache.has(link.url)) {
              return {
                type: 'cache-hit-broken',
                urlFrom: pageUrl,
                urlTo: link.url,
                anchorText: link.anchorText,
                trafficDomain: 0,
              };
            }

            // Check if already validated as working
            if (workingUrlsCache.has(link.url)) {
              return { type: 'cache-hit-working' };
            }

            // Not in cache, need to check via API
            const isBroken = await isLinkInaccessible(link.url, baseLog, site.getId());
            if (isBroken) {
              brokenUrlsCache.add(link.url);
              return {
                type: 'api-broken',
                urlFrom: pageUrl,
                urlTo: link.url,
                anchorText: link.anchorText,
                trafficDomain: 0,
              };
            }
            workingUrlsCache.add(link.url);
            return { type: 'api-working' };
          }),
        );

        // Collect all results for stats (process after loop to avoid linter error)
        allValidationResults.push(...batchResults);
        validations.push(...batchResults);

        // Add delay between batches to prevent server overload
        if (i + LINK_CHECK_BATCH_SIZE < internalLinks.length) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(LINK_CHECK_DELAY_MS);
        }
      }

      // Collect broken links for result
      const brokenLinks = validations.filter((result) => result && (result.type === 'cache-hit-broken' || result.type === 'api-broken'));

      brokenLinks.forEach((link) => {
        const key = `${link.urlFrom}|${link.urlTo}`;
        if (!brokenLinksMap.has(key)) brokenLinksMap.set(key, link);
      });
    } catch (error) {
      log.error(`[broken-internal-links-crawl] Error processing ${url}: ${error.message}`);
      pagesSkipped += 1;
    }

    // Add delay between processing pages to prevent overwhelming target system
    // eslint-disable-next-line no-await-in-loop
    await sleep(SCRAPE_FETCH_DELAY_MS);
  }

  const result = Array.from(brokenLinksMap.values());

  // Calculate stats from collected results (avoids no-loop-func linter error)
  const totalLinksAnalyzed = allValidationResults.filter((r) => r && r.type !== 'out-of-scope').length;
  const cacheHitsBroken = allValidationResults.filter((r) => r?.type === 'cache-hit-broken').length;
  const cacheHitsWorking = allValidationResults.filter((r) => r?.type === 'cache-hit-working').length;
  const linksCheckedViaAPI = allValidationResults.filter((r) => r && (r.type === 'api-broken' || r.type === 'api-working')).length;

  const totalCacheHits = cacheHitsBroken + cacheHitsWorking;
  const cacheHitRate = totalLinksAnalyzed > 0
    ? ((totalCacheHits / totalLinksAnalyzed) * 100).toFixed(1)
    : 0;
  const apiCallRate = totalLinksAnalyzed > 0
    ? ((linksCheckedViaAPI / totalLinksAnalyzed) * 100).toFixed(1)
    : 0;

  // Summary logging with performance metrics
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const avgTimePerPage = pagesProcessed > 0 ? (totalTime / pagesProcessed).toFixed(2) : 0;
  const avgLinksPerPage = pagesProcessed > 0 ? (totalLinksAnalyzed / pagesProcessed).toFixed(1) : 0;

  log.info(`[broken-internal-links-crawl] [${totalTime}s] ========== CRAWL DETECTION SUMMARY ==========`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Time: ${totalTime}s total (${avgTimePerPage}s per page)`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Pages: ${pagesProcessed} processed, ${pagesSkipped} skipped`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Links: ${totalLinksAnalyzed} total analyzed (avg ${avgLinksPerPage} per page)`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] API Calls: ${linksCheckedViaAPI} (${apiCallRate}%)`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Cache Hits: ${totalCacheHits} (${cacheHitRate}%) - ${cacheHitsBroken} broken, ${cacheHitsWorking} working`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Cache Sizes: ${brokenUrlsCache.size} broken URLs, ${workingUrlsCache.size} working URLs cached`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Results: ${brokenUrlsCache.size} unique broken URLs, ${result.length} total instances`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Efficiency: Avoided ${totalCacheHits} duplicate checks (${totalLinksAnalyzed > 0 ? ((totalCacheHits / totalLinksAnalyzed) * 100).toFixed(1) : 0}% savings)`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] Performance: Batch size ${LINK_CHECK_BATCH_SIZE}, delays ${LINK_CHECK_DELAY_MS}ms/${SCRAPE_FETCH_DELAY_MS}ms`);
  log.info(`[broken-internal-links-crawl] [${totalTime}s] =============================================`);

  return result;
}

/**
 * Processes a single batch of pages for crawl-based broken link detection.
 * This function is designed for batched processing across multiple Lambda invocations.
 *
 * @param {Object} params - Parameters object
 * @param {Map} params.scrapeResultPaths - Full Map of URL to S3 path (url -> s3Key)
 * @param {number} params.batchStartIndex - Index to start processing from
 * @param {number} params.batchSize - Number of pages to process in this batch
 * @param {Array} params.initialBrokenUrls - Array of known broken URLs from previous batches
 * @param {Array} params.initialWorkingUrls - Array of known working URLs from previous batches
 * @param {Object} context - Context object with s3Client, log, env, site
 * @returns {Promise<Object>} Object containing:
 *   - results: Array of broken links found in this batch
 *   - brokenUrlsCache: Updated array of all known broken URLs
 *   - workingUrlsCache: Updated array of all known working URLs
 *   - pagesProcessed: Number of pages processed in this batch
 *   - hasMorePages: Boolean indicating if more pages remain
 *   - nextBatchStartIndex: Index to start the next batch from
 *   - stats: Object with processing statistics
 */
export async function detectBrokenLinksFromCrawlBatch({
  scrapeResultPaths,
  batchStartIndex = 0,
  batchSize = PAGES_PER_BATCH,
  initialBrokenUrls = [],
  initialWorkingUrls = [],
}, context) {
  const {
    s3Client, env, log: baseLog, site,
  } = context;
  const log = createContextLogger(baseLog, site.getId());
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const baseURL = site.getBaseURL();
  const baseHostname = new URL(baseURL).hostname.replace(/^www\./, '');

  const startTime = Date.now();
  const formatElapsed = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

  // Convert scrapeResultPaths to array and SORT by URL to ensure consistent ordering
  // across Lambda invocations (Map ordering may not be guaranteed when reloaded from scrape client)
  const allPaths = Array.from(scrapeResultPaths.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const totalPages = allPaths.length;
  const batchEndIndex = Math.min(batchStartIndex + batchSize, totalPages);
  const batchPaths = allPaths.slice(batchStartIndex, batchEndIndex);

  log.info(`${formatElapsed()} ====== BATCH PROCESSING START ======`);
  log.info(`${formatElapsed()} Processing pages ${batchStartIndex + 1}-${batchEndIndex} of ${totalPages}`);
  log.info(`${formatElapsed()} Initial cache: ${initialBrokenUrls.length} broken, ${initialWorkingUrls.length} working URLs`);

  // Initialize caches from previous batches
  const brokenUrlsCache = new Set(initialBrokenUrls);
  const workingUrlsCache = new Set(initialWorkingUrls);
  const brokenLinksMap = new Map();
  const allValidationResults = [];
  let pagesProcessed = 0;
  let pagesSkipped = 0;

  for (const [url, s3Key] of batchPaths) {
    try {
      pagesProcessed += 1;
      const globalPageNum = batchStartIndex + pagesProcessed;

      // Log progress every 5 pages
      if (pagesProcessed % 5 === 1 || pagesProcessed === batchPaths.length) {
        log.info(`${formatElapsed()} Progress: ${globalPageNum}/${totalPages} pages (batch ${pagesProcessed}/${batchPaths.length})`);
      }

      // eslint-disable-next-line no-await-in-loop
      const s3Object = await getObjectFromKey(s3Client, bucketName, s3Key, log);

      if (!s3Object?.scrapeResult?.rawBody) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      const html = s3Object.scrapeResult.rawBody;
      const pageUrl = s3Object.finalUrl || url;

      if (!isWithinAuditScope(pageUrl, baseURL)) {
        pagesSkipped += 1;
        // eslint-disable-next-line no-continue
        continue;
      }

      // Extract internal links (skip header/footer)
      const $ = cheerioLoad(html);
      const internalLinks = [];

      $('a[href]').each((_, el) => {
        const $a = $(el);
        if ($a.closest('header').length || $a.closest('footer').length) return;

        const href = $a.attr('href');
        if (!href || href.startsWith('#')) return;

        try {
          const absoluteUrl = new URL(href, pageUrl).toString();
          const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

          if (linkHostname === baseHostname) {
            internalLinks.push({
              url: absoluteUrl,
              anchorText: $a.text().trim() || '[no text]',
            });
          }
        } catch (urlError) {
          // Skip invalid URLs
          log.debug(`Skipping invalid href on ${pageUrl}: ${href}`);
        }
      });

      // Validate links in batches
      const validations = [];

      // eslint-disable-next-line no-await-in-loop
      for (let i = 0; i < internalLinks.length; i += LINK_CHECK_BATCH_SIZE) {
        const batch = internalLinks.slice(i, i + LINK_CHECK_BATCH_SIZE);

        // eslint-disable-next-line no-await-in-loop
        const batchResults = await Promise.all(
          batch.map(async (link) => {
            if (!isWithinAuditScope(link.url, baseURL)) return { type: 'out-of-scope' };

            // Check cache first - if already known broken, return immediately
            if (brokenUrlsCache.has(link.url)) {
              return {
                type: 'cache-hit-broken',
                urlFrom: pageUrl,
                urlTo: link.url,
                anchorText: link.anchorText,
                trafficDomain: 0,
              };
            }

            // Check if already validated as working
            if (workingUrlsCache.has(link.url)) {
              return { type: 'cache-hit-working' };
            }

            // Not in cache, need to check via API
            const isBroken = await isLinkInaccessible(link.url, baseLog, site.getId());
            if (isBroken) {
              brokenUrlsCache.add(link.url);
              return {
                type: 'api-broken',
                urlFrom: pageUrl,
                urlTo: link.url,
                anchorText: link.anchorText,
                trafficDomain: 0,
              };
            }
            workingUrlsCache.add(link.url);
            return { type: 'api-working' };
          }),
        );

        allValidationResults.push(...batchResults);
        validations.push(...batchResults);

        // Add delay between batches
        if (i + LINK_CHECK_BATCH_SIZE < internalLinks.length) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(LINK_CHECK_DELAY_MS);
        }
      }

      // Collect broken links for result
      const brokenLinks = validations.filter(
        (result) => result && (result.type === 'cache-hit-broken' || result.type === 'api-broken'),
      );

      brokenLinks.forEach((link) => {
        const key = `${link.urlFrom}|${link.urlTo}`;
        if (!brokenLinksMap.has(key)) brokenLinksMap.set(key, link);
      });
    } catch (error) {
      log.error(`Error processing ${url}: ${error.message}`);
      pagesSkipped += 1;
    }

    // eslint-disable-next-line no-await-in-loop
    await sleep(SCRAPE_FETCH_DELAY_MS);
  }

  const results = Array.from(brokenLinksMap.values());

  // Calculate stats
  const totalLinksAnalyzed = allValidationResults.filter((r) => r && r.type !== 'out-of-scope').length;
  const cacheHitsBroken = allValidationResults.filter((r) => r?.type === 'cache-hit-broken').length;
  const cacheHitsWorking = allValidationResults.filter((r) => r?.type === 'cache-hit-working').length;
  const linksCheckedViaAPI = allValidationResults.filter(
    (r) => r && (r.type === 'api-broken' || r.type === 'api-working'),
  ).length;

  const totalCacheHits = cacheHitsBroken + cacheHitsWorking;
  const cacheHitRate = totalLinksAnalyzed > 0
    ? ((totalCacheHits / totalLinksAnalyzed) * 100).toFixed(1)
    : 0;

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const hasMorePages = batchEndIndex < totalPages;

  // Summary logging
  log.info(`${formatElapsed()} ====== BATCH SUMMARY ======`);
  log.info(`${formatElapsed()} Time: ${totalTime}s for ${pagesProcessed} pages`);
  log.info(`${formatElapsed()} Links: ${totalLinksAnalyzed} analyzed, ${linksCheckedViaAPI} API calls`);
  log.info(`${formatElapsed()} Cache: ${totalCacheHits} hits (${cacheHitRate}%) - ${cacheHitsBroken} broken, ${cacheHitsWorking} working`);
  log.info(`${formatElapsed()} Results: ${results.length} broken links found in this batch`);
  log.info(`${formatElapsed()} Updated cache: ${brokenUrlsCache.size} broken, ${workingUrlsCache.size} working URLs`);
  log.info(`${formatElapsed()} Progress: ${hasMorePages ? `${totalPages - batchEndIndex} pages remaining` : 'ALL PAGES COMPLETE'}`);
  log.info(`${formatElapsed()} ===========================`);

  return {
    results,
    brokenUrlsCache: Array.from(brokenUrlsCache),
    workingUrlsCache: Array.from(workingUrlsCache),
    pagesProcessed,
    pagesSkipped,
    hasMorePages,
    nextBatchStartIndex: batchEndIndex,
    totalPages,
    stats: {
      totalLinksAnalyzed,
      linksCheckedViaAPI,
      cacheHitsBroken,
      cacheHitsWorking,
      cacheHitRate: parseFloat(cacheHitRate),
      processingTimeSeconds: parseFloat(totalTime),
    },
  };
}

/**
 * Merges crawl-detected and RUM-detected broken links, prioritizing RUM data.
 * RUM links take priority as they have traffic data.
 * @param {Array} crawlLinks - Links from crawl (trafficDomain: 0)
 * @param {Array} rumLinks - Links from RUM (have trafficDomain)
 * @param {Object} log - Logger instance
 * @returns {Array} - Merged and deduplicated array
 */
export function mergeAndDeduplicate(crawlLinks, rumLinks, log) {
  const linkMap = new Map();

  // RUM links first (priority - they have traffic data)
  rumLinks.forEach((link) => {
    linkMap.set(`${link.urlFrom}|${link.urlTo}`, link);
  });

  let crawlOnlyCount = 0;
  // Crawl links only if not in RUM
  crawlLinks.forEach((link) => {
    const key = `${link.urlFrom}|${link.urlTo}`;
    if (!linkMap.has(key)) {
      linkMap.set(key, link);
      crawlOnlyCount += 1;
    }
  });

  const merged = Array.from(linkMap.values());
  log.info(`Merged: ${rumLinks.length} RUM + ${crawlOnlyCount} crawl-only = ${merged.length} total`);

  return merged;
}
