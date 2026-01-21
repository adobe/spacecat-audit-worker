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

// Reduced delays to prevent Lambda timeout (15 min limit)
const SCRAPE_FETCH_DELAY_MS = 20; // 20ms delay between S3 fetches
const LINK_CHECK_BATCH_SIZE = 5; // Check 5 links at a time per page
const LINK_CHECK_DELAY_MS = 20; // 20ms delay between link check batches

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
    s3Client, env, log, site,
  } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const baseURL = site.getBaseURL();
  const baseHostname = new URL(baseURL).hostname.replace(/^www\./, '');

  log.info(`[broken-internal-links-crawl] Processing ${scrapeResultPaths.size} scraped pages`);

  const brokenLinksMap = new Map();
  const brokenUrlsCache = new Set();
  const workingUrlsCache = new Set();
  const allValidationResults = []; // Collect all results for final stats
  let pagesProcessed = 0;
  let pagesSkipped = 0;

  for (const [url, s3Key] of scrapeResultPaths) {
    try {
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
            const isBroken = await isLinkInaccessible(link.url, log);
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

      pagesProcessed += 1;
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

  // Summary logging
  log.info('[broken-internal-links-crawl] ========== CRAWL DETECTION SUMMARY ==========');
  log.info(`[broken-internal-links-crawl] Pages: ${pagesProcessed} processed, ${pagesSkipped} skipped`);
  log.info(`[broken-internal-links-crawl] Links: ${totalLinksAnalyzed} total analyzed`);
  log.info(`[broken-internal-links-crawl] API Calls: ${linksCheckedViaAPI} (${apiCallRate}%)`);
  log.info(`[broken-internal-links-crawl] Cache Hits: ${totalCacheHits} (${cacheHitRate}%) - ${cacheHitsBroken} broken, ${cacheHitsWorking} working`);
  log.info(`[broken-internal-links-crawl] Results: ${brokenUrlsCache.size} unique broken URLs, ${result.length} total instances`);
  log.info(`[broken-internal-links-crawl] Efficiency: Avoided ${totalCacheHits} duplicate checks via caching`);
  log.info('[broken-internal-links-crawl] =============================================');

  return result;
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
  log.info(`[broken-internal-links-merge] Merged: ${rumLinks.length} RUM + ${crawlOnlyCount} crawl-only = ${merged.length} total`);

  return merged;
}
