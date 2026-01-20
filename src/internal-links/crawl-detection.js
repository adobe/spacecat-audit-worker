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

/**
 * Sleep utility function to add delays between processing
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after the delay
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Extracts and validates broken internal links from scraped HTML content
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
  // Extract site hostname without www for flexible origin matching
  const baseURLObj = new URL(baseURL);
  const baseHostname = baseURLObj.hostname.replace(/^www\./, '');

  log.info(`[broken-internal-links-crawl] Starting crawl detection: ${scrapeResultPaths.size} pages to process`);

  const brokenLinksMap = new Map(); // Key: urlFrom|urlTo, Value: link object
  const brokenUrlsSet = new Set(); // Track URLs validated as broken
  const workingUrlsSet = new Set(); // Track URLs validated as working
  let pagesProcessed = 0;

  // Process each scraped page sequentially with sleep between pages
  for (const [url, s3Key] of scrapeResultPaths) {
    try {
      log.info(`[broken-internal-links-crawl] 📥 Fetching scraped content for ${url} from S3 key: ${s3Key}`);

      // Fetch scraped content from S3
      // eslint-disable-next-line no-await-in-loop
      const object = await getObjectFromKey(s3Client, bucketName, s3Key, log);

      if (!object) {
        log.warn(`[broken-internal-links-crawl] ❌ No object returned from S3 for ${url} (key: ${s3Key})`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
        // eslint-disable-next-line no-continue
        continue;
      }

      log.info(`[broken-internal-links-crawl] ✅ Object fetched for ${url}. Top-level keys: ${Object.keys(object).join(', ')}`);

      if (!object.scrapeResult) {
        log.warn(`[broken-internal-links-crawl] ❌ No scrapeResult in object for ${url}. Available keys: ${Object.keys(object).join(', ')}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
        // eslint-disable-next-line no-continue
        continue;
      }

      log.info(`[broken-internal-links-crawl] scrapeResult keys: ${Object.keys(object.scrapeResult).join(', ')}`);

      if (!object.scrapeResult.rawBody) {
        log.warn(`[broken-internal-links-crawl] ❌ No rawBody in scrapeResult for ${url}. scrapeResult keys: ${Object.keys(object.scrapeResult).join(', ')}`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
        // eslint-disable-next-line no-continue
        continue;
      }

      const html = object.scrapeResult.rawBody;
      const pageUrl = object.finalUrl || url;
      const htmlSize = html.length;

      // Parse HTML with Cheerio
      const $ = cheerioLoad(html);
      const anchors = $('a[href]');
      const totalAnchors = anchors.length;

      log.info(`[broken-internal-links-crawl] Processing page ${pageUrl} (HTML size: ${htmlSize} bytes, Total <a> tags: ${totalAnchors})`);

      // Extract internal links (skip header/footer like preflight does)
      // Store as array of objects with url and anchorText
      const internalLinks = [];

      anchors.each((i, a) => {
        const $a = $(a);

        // Skip links in header or footer (navigation)
        if ($a.closest('header').length || $a.closest('footer').length) {
          return;
        }

        try {
          const href = $a.attr('href');

          // Skip anchor-only links (page fragments like #section)
          // These are not broken links, just references to sections on the same page
          if (href && href.startsWith('#')) {
            return;
          }

          // Resolve relative links (e.g., /about, ../products) to absolute URLs
          // using pageUrl as base
          const absoluteUrl = new URL(href, pageUrl).toString();

          // Only include internal links (same hostname, ignoring www)
          const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');
          if (linkHostname === baseHostname) {
            const anchorText = $a.text().trim() || '[empty]';
            internalLinks.push({
              url: absoluteUrl,
              anchorText,
            });
          }
        } catch {
          // Skip invalid hrefs
        }
      });

      if (internalLinks.length === 0) {
        pagesProcessed += 1;
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
        // eslint-disable-next-line no-continue
        continue;
      }

      // Validate each internal link in parallel
      // Skip logging individual validation counts to reduce noise

      // eslint-disable-next-line no-await-in-loop
      const linkValidations = await Promise.all(
        internalLinks.map(async (link) => {
          const linkUrl = link.url;
          const { anchorText } = link;

          // Filter by audit scope before validation
          const pageInScope = isWithinAuditScope(pageUrl, baseURL);
          const linkInScope = isWithinAuditScope(linkUrl, baseURL);

          if (!pageInScope || !linkInScope) {
            return null;
          }

          // Check if URL is already cached as broken or working (avoid re-validation)
          if (brokenUrlsSet.has(linkUrl)) {
            return {
              urlFrom: pageUrl,
              urlTo: linkUrl,
              anchorText: link.anchorText,
              trafficDomain: 0, // Crawl-discovered links have no traffic data
            };
          }

          if (workingUrlsSet.has(linkUrl)) {
            return null; // Working links don't get added to broken links list
          }

          const isBroken = await isLinkInaccessible(linkUrl, log);

          if (isBroken) {
            // Add to set of known broken URLs to avoid future validations
            brokenUrlsSet.add(linkUrl);
            return {
              urlFrom: pageUrl,
              urlTo: linkUrl,
              anchorText,
              trafficDomain: 0, // Crawl-discovered links have no traffic data
            };
          } else {
            // Add to set of known working URLs to avoid future validations
            workingUrlsSet.add(linkUrl);
          }

          return null;
        }),
      );

      // Add broken links to map (deduplicate by urlFrom|urlTo)
      linkValidations.forEach((link) => {
        if (link) {
          const key = `${link.urlFrom}|${link.urlTo}`;
          if (!brokenLinksMap.has(key)) {
            brokenLinksMap.set(key, link);
          }
        }
      });

      pagesProcessed += 1;

      // Add delay between processing pages to avoid overloading target system
      // eslint-disable-next-line no-await-in-loop
      await sleep(30);
    } catch (error) {
      log.error(`[broken-internal-links-crawl] Error processing ${url}: ${error.message}`, error);

      // Still add delay even on error to avoid rapid-fire retries
      // eslint-disable-next-line no-await-in-loop
      await sleep(30);
    }
  }

  const brokenLinks = Array.from(brokenLinksMap.values());

  // Log essential summary only
  log.info(`[broken-internal-links-crawl] Completed: ${pagesProcessed} pages, ${brokenLinks.length} broken links found, ${brokenUrlsSet.size + workingUrlsSet.size} URLs cached`);

  return brokenLinks;
}

/**
 * Merges crawl-detected and RUM-detected broken links, prioritizing RUM data
 * @param {Array} crawlLinks - Links detected by crawl (trafficDomain=0)
 * @param {Array} rumLinks - Links detected by RUM (have trafficDomain)
 * @param {Object} log - Logger instance
 * @returns {Array} Merged and deduplicated array of broken links
 */
export function mergeAndDeduplicate(crawlLinks, rumLinks, log) {
  log.info('[broken-internal-links-merge] ====== Merge & Deduplicate ======');
  log.info(`[broken-internal-links-merge] Input - RUM links: ${rumLinks.length}, Crawl links: ${crawlLinks.length}`);

  const linkMap = new Map();

  // Step 1: Add RUM links first (they have traffic_domain)
  rumLinks.forEach((link) => {
    const key = `${link.urlFrom}|${link.urlTo}`;
    linkMap.set(key, link);
  });

  // Step 2: Add crawl links (only if not already from RUM)
  crawlLinks.forEach((link) => {
    const key = `${link.urlFrom}|${link.urlTo}`;
    if (!linkMap.has(key)) {
      // Crawl-only links keep trafficDomain: 0 (lowest priority)
      linkMap.set(key, link);
    }
  });

  const mergedLinks = Array.from(linkMap.values());

  // Step 3: Return merged array
  return mergedLinks;
}
