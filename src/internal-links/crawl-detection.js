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
import { isWithinAuditScope } from './subpath-filter.js';
import { createAuditLogger } from '../common/context-logger.js';
import { isLinkInaccessible } from './helpers.js';

const AUDIT_TYPE = 'broken-internal-links';

/**
 * Default traffic value for crawl-detected broken links (no RUM data).
 * Override via env BROKEN_LINKS_CRAWL_TRAFFIC_DOMAIN (e.g. 1–100).
 * RUM links keep their traffic_domain (e.g. 200, 400).
 */
const CRAWL_DEFAULT_TRAFFIC = Number(process.env.BROKEN_LINKS_CRAWL_TRAFFIC_DOMAIN) || 1;

// Optimized for speed while respecting target server
const SCRAPE_FETCH_DELAY_MS = 50;
const LINK_CHECK_BATCH_SIZE = 10;
const LINK_CHECK_DELAY_MS = 300;

export const PAGES_PER_BATCH = 10;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Extracts internal links from HTML using cheerio
 * @param {Object} $ - Cheerio instance
 * @param {string} pageUrl - The page URL for resolving relative links
 * @param {string} baseHostname - The base hostname to match against
 * @param {Object} log - Logger instance
 * @returns {Array} Array of internal link objects with url, anchorText, type
 */
function extractInternalLinks($, pageUrl, baseHostname, log) {
  const internalLinks = [];

  // Extract links from anchor tags
  $('a[href]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href');
    if (!href || href.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: $a.text().trim() || '[no text]',
          type: 'link',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid href on ${pageUrl}: ${href}`);
    }
  });

  // Extract form action URLs
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    // eslint-disable-next-line no-script-url
    if (!action || action.startsWith('#') || action.startsWith('javascript:')) return;

    try {
      const absoluteUrl = new URL(action, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: '[form action]',
          type: 'form',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid form action on ${pageUrl}: ${action}`);
    }
  });

  // Extract canonical URLs
  $('link[rel="canonical"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        internalLinks.push({
          url: absoluteUrl,
          anchorText: '[canonical]',
          type: 'canonical',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid canonical on ${pageUrl}: ${href}`);
    }
  });

  // Extract alternate language/locale links
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (linkHostname === baseHostname) {
        const hreflang = $(el).attr('hreflang');
        internalLinks.push({
          url: absoluteUrl,
          anchorText: `[alternate:${hreflang}]`,
          type: 'alternate',
        });
      }
    } catch (urlError) {
      log.debug(`Skipping invalid alternate link on ${pageUrl}: ${href}`);
    }
  });

  return internalLinks;
}

/**
 * Extracts asset references (images, SVGs, CSS, JS) from HTML
 * @param {Object} $ - Cheerio instance
 * @param {string} pageUrl - The page URL for resolving relative links
 * @param {string} baseHostname - The base hostname to match against
 * @param {Object} log - Logger instance
 * @returns {Array} Array of asset reference objects with url and type
 */
function extractAssetReferences($, pageUrl, baseHostname, log) {
  const assetReferences = [];

  // Images and SVGs
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('data:') || src.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(src, pageUrl).toString();
      const assetHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (assetHostname === baseHostname || assetHostname.endsWith(`.${baseHostname}`)) {
        const path = new URL(absoluteUrl).pathname.toLowerCase();
        const type = path.endsWith('.svg') ? 'svg' : 'image';
        assetReferences.push({
          url: absoluteUrl,
          type,
        });
      }
      /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
    } catch (urlError) {
      log.debug(`Skipping invalid img src on ${pageUrl}: ${src}`);
    }
  });

  // CSS files
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(href, pageUrl).toString();
      const assetHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (assetHostname === baseHostname || assetHostname.endsWith(`.${baseHostname}`)) {
        assetReferences.push({
          url: absoluteUrl,
          type: 'css',
        });
      }
      /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
    } catch (urlError) {
      log.debug(`Skipping invalid link href on ${pageUrl}: ${href}`);
    }
  });

  // JavaScript files
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('#')) return;

    try {
      const absoluteUrl = new URL(src, pageUrl).toString();
      const assetHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');

      if (assetHostname === baseHostname || assetHostname.endsWith(`.${baseHostname}`)) {
        assetReferences.push({
          url: absoluteUrl,
          type: 'js',
        });
      }
      /* c8 ignore next 3 - Defensive: URL parsing rarely fails with valid HTML */
    } catch (urlError) {
      log.debug(`Skipping invalid script src on ${pageUrl}: ${src}`);
    }
  });

  return assetReferences;
}

/**
 * Validates a batch of links and updates caches
 * @param {Array} links - Array of link objects to validate
 * @param {string} pageUrl - The source page URL
 * @param {Set} brokenUrlsCache - Cache of known broken URLs
 * @param {Set} workingUrlsCache - Cache of known working URLs
 * @param {string} baseURL - Base URL for scope filtering
 * @param {Object} baseLog - Base logger
 * @param {string} siteId - Site ID for logging
 * @returns {Promise<Array>} Array of validation results
 */
async function validateLinksWithCache(
  links,
  pageUrl,
  brokenUrlsCache,
  workingUrlsCache,
  baseURL,
  baseLog,
  siteId,
) {
  return Promise.all(
    links.map(async (link) => {
      if (!isWithinAuditScope(link.url, baseURL)) return { type: 'out-of-scope' };

      if (brokenUrlsCache.has(link.url)) {
        return {
          type: 'cache-hit-broken',
          urlFrom: pageUrl,
          urlTo: link.url,
          anchorText: link.anchorText,
          /* c8 ignore next - Fallback tested via link detection */
          itemType: link.type || 'link',
          trafficDomain: CRAWL_DEFAULT_TRAFFIC,
        };
      }

      if (workingUrlsCache.has(link.url)) {
        return { type: 'cache-hit-working' };
      }

      const isBroken = await isLinkInaccessible(link.url, baseLog, siteId);
      if (isBroken) {
        brokenUrlsCache.add(link.url);
        return {
          type: 'api-broken',
          urlFrom: pageUrl,
          urlTo: link.url,
          anchorText: link.anchorText,
          /* c8 ignore next - Fallback tested via link detection */
          itemType: link.type || 'link',
          trafficDomain: CRAWL_DEFAULT_TRAFFIC,
        };
      }
      workingUrlsCache.add(link.url);
      return { type: 'api-working' };
    }),
  );
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
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const baseURL = site.getBaseURL();
  const baseHostname = new URL(baseURL).hostname.replace(/^www\./, '');

  const startTime = Date.now();
  const formatElapsed = () => `[${((Date.now() - startTime) / 1000).toFixed(1)}s]`;

  // Sort by URL for consistent ordering across Lambda invocations
  const allPaths = Array.from(scrapeResultPaths.entries())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const totalPages = allPaths.length;
  const batchEndIndex = Math.min(batchStartIndex + batchSize, totalPages);
  const batchPaths = allPaths.slice(batchStartIndex, batchEndIndex);

  log.info(`${formatElapsed()} ====== BATCH PROCESSING START ======`);
  log.info(`${formatElapsed()} Processing pages ${batchStartIndex + 1}-${batchEndIndex} of ${totalPages}`);
  log.info(`${formatElapsed()} Initial cache: ${initialBrokenUrls.length} broken, ${initialWorkingUrls.length} working URLs`);

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

      const $ = cheerioLoad(html);
      const internalLinks = extractInternalLinks($, pageUrl, baseHostname, log);
      const assetReferences = extractAssetReferences($, pageUrl, baseHostname, log);

      const allLinks = internalLinks.concat(assetReferences);

      const validations = [];

      // eslint-disable-next-line no-await-in-loop
      for (let i = 0; i < allLinks.length; i += LINK_CHECK_BATCH_SIZE) {
        const batch = allLinks.slice(i, i + LINK_CHECK_BATCH_SIZE);

        // eslint-disable-next-line no-await-in-loop
        const batchResults = await validateLinksWithCache(
          batch,
          pageUrl,
          brokenUrlsCache,
          workingUrlsCache,
          baseURL,
          baseLog,
          site.getId(),
        );

        allValidationResults.push(...batchResults);
        validations.push(...batchResults);

        if (i + LINK_CHECK_BATCH_SIZE < allLinks.length) {
          // eslint-disable-next-line no-await-in-loop
          await sleep(LINK_CHECK_DELAY_MS);
        }
      }

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
 * Merges crawl-detected and RUM-detected broken links.
 * RUM links take priority as they have traffic data.
 * @param {Array} crawlLinks - Links from crawl (trafficDomain: CRAWL_DEFAULT_TRAFFIC)
 * @param {Array} rumLinks - Links from RUM (have trafficDomain)
 * @param {Object} log - Logger instance
 * @returns {Array} - Merged and deduplicated array
 */
export function mergeAndDeduplicate(crawlLinks, rumLinks, log) {
  const linkMap = new Map();

  rumLinks.forEach((link) => {
    linkMap.set(`${link.urlFrom}|${link.urlTo}`, link);
  });

  let crawlOnlyCount = 0;
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
