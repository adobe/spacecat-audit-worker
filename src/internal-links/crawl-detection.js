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

// Delay between fetching scrape results to prevent overwhelming target systems
const SCRAPE_FETCH_DELAY_MS = 100; // 100ms delay between S3 fetches

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

      // Validate links
      // eslint-disable-next-line no-await-in-loop
      const validations = await Promise.all(
        internalLinks.map(async (link) => {
          if (!isWithinAuditScope(link.url, baseURL)) return null;
          if (brokenUrlsCache.has(link.url)) {
            return {
              urlFrom: pageUrl,
              urlTo: link.url,
              anchorText: link.anchorText,
              trafficDomain: 0,
            };
          }
          if (workingUrlsCache.has(link.url)) return null;

          const isBroken = await isLinkInaccessible(link.url, log);
          if (isBroken) {
            brokenUrlsCache.add(link.url);
            return {
              urlFrom: pageUrl,
              urlTo: link.url,
              anchorText: link.anchorText,
              trafficDomain: 0,
            };
          }
          workingUrlsCache.add(link.url);
          return null;
        }),
      );

      validations.filter(Boolean).forEach((link) => {
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
  log.info(`[broken-internal-links-crawl] Processed ${pagesProcessed} pages, skipped ${pagesSkipped}`);
  log.info(`[broken-internal-links-crawl] Found ${result.length} broken links from crawl`);
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
