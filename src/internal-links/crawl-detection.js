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

  log.info(`[broken-internal-links-crawl] Starting crawl detection for site: ${site.getId()}`);
  log.info(`[broken-internal-links-crawl] Processing ${scrapeResultPaths.size} scraped pages from S3 bucket: ${bucketName}`);
  log.info(`[broken-internal-links-crawl] Base hostname (normalized): ${baseHostname}, BaseURL: ${baseURL}`);

  const brokenLinksMap = new Map(); // Key: urlFrom|urlTo, Value: link object
  let totalLinksFound = 0;
  let totalLinksValidated = 0;
  let pagesProcessed = 0;
  let pagesSkipped = 0;
  let linksOutOfScope = 0;

  // Process each scraped page
  await Promise.all(
    [...scrapeResultPaths].map(async ([url, s3Key]) => {
      try {
        log.info(`[broken-internal-links-crawl] 📥 Fetching scraped content for ${url} from S3 key: ${s3Key}`);

        // Fetch scraped content from S3
        const object = await getObjectFromKey(s3Client, bucketName, s3Key, log);

        if (!object) {
          log.warn(`[broken-internal-links-crawl] ❌ No object returned from S3 for ${url} (key: ${s3Key})`);
          pagesSkipped += 1;
          return;
        }

        log.info(`[broken-internal-links-crawl] ✅ Object fetched for ${url}. Top-level keys: ${Object.keys(object).join(', ')}`);

        if (!object.scrapeResult) {
          log.warn(`[broken-internal-links-crawl] ❌ No scrapeResult in object for ${url}. Available keys: ${Object.keys(object).join(', ')}`);
          pagesSkipped += 1;
          return;
        }

        log.info(`[broken-internal-links-crawl] scrapeResult keys: ${Object.keys(object.scrapeResult).join(', ')}`);

        if (!object.scrapeResult.rawBody) {
          log.warn(`[broken-internal-links-crawl] ❌ No rawBody in scrapeResult for ${url}. scrapeResult keys: ${Object.keys(object.scrapeResult).join(', ')}`);
          pagesSkipped += 1;
          return;
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
        const internalLinks = new Set();
        const sampleHrefs = []; // Collect sample hrefs for debugging
        let headerFooterLinksSkipped = 0;
        let externalLinksSkipped = 0;
        let invalidHrefsSkipped = 0;

        anchors.each((i, a) => {
          const $a = $(a);

          // Skip links in header or footer (navigation)
          if ($a.closest('header').length || $a.closest('footer').length) {
            headerFooterLinksSkipped += 1;
            return;
          }

          try {
            const href = $a.attr('href');

            // Collect sample hrefs for debugging (first 10)
            if (sampleHrefs.length < 10) {
              sampleHrefs.push(href);
            }

            // Resolve relative links (e.g., /about, ../products) to absolute URLs
            // using pageUrl as base
            const absoluteUrl = new URL(href, pageUrl).toString();

            // Only include internal links (same hostname, ignoring www)
            const linkHostname = new URL(absoluteUrl).hostname.replace(/^www\./, '');
            if (linkHostname === baseHostname) {
              internalLinks.add(absoluteUrl);
            } else {
              externalLinksSkipped += 1;
            }
          } catch {
            // Skip invalid hrefs
            invalidHrefsSkipped += 1;
          }
        });

        totalLinksFound += internalLinks.size;

        log.info(`[broken-internal-links-crawl] Page ${pageUrl} - Found ${totalAnchors} total <a> tags`);

        // Log sample raw hrefs to show relative vs absolute links
        if (sampleHrefs.length > 0) {
          log.info(`[broken-internal-links-crawl] Sample raw href attributes: ${JSON.stringify(sampleHrefs)}`);
        }

        log.info(`[broken-internal-links-crawl] Page ${pageUrl} - Internal links: ${internalLinks.size}, Header/Footer skipped: ${headerFooterLinksSkipped}, External: ${externalLinksSkipped}, Invalid: ${invalidHrefsSkipped}`);

        // Log sample resolved internal links for investigation
        if (internalLinks.size > 0) {
          const linksList = Array.from(internalLinks);
          const sampleSize = Math.min(5, linksList.length);
          log.info(`[broken-internal-links-crawl] Sample resolved internal links: ${JSON.stringify(linksList.slice(0, sampleSize))}`);
          if (linksList.length > sampleSize) {
            log.info(`[broken-internal-links-crawl] ... and ${linksList.length - sampleSize} more internal links on this page`);
          }
        }

        if (internalLinks.size === 0) {
          log.info(`[broken-internal-links-crawl] No internal links to validate on ${pageUrl} - Total anchors=${totalAnchors}, Header/Footer=${headerFooterLinksSkipped}, External=${externalLinksSkipped}, Invalid=${invalidHrefsSkipped}`);
          pagesProcessed += 1;
          return;
        }

        // Validate each internal link in parallel
        log.info(`[broken-internal-links-crawl] Validating ${internalLinks.size} internal links from ${pageUrl}`);

        const linkValidations = await Promise.all(
          Array.from(internalLinks).map(async (linkUrl) => {
            // Filter by audit scope before validation
            const pageInScope = isWithinAuditScope(pageUrl, baseURL);
            const linkInScope = isWithinAuditScope(linkUrl, baseURL);

            if (!pageInScope || !linkInScope) {
              if (!pageInScope) {
                log.debug(`[broken-internal-links-crawl] Page ${pageUrl} is out of audit scope, skipping link validation`);
              }
              if (!linkInScope) {
                log.debug(`[broken-internal-links-crawl] Link ${linkUrl} is out of audit scope, skipping`);
              }
              linksOutOfScope += 1;
              return null;
            }

            totalLinksValidated += 1;
            const isBroken = await isLinkInaccessible(linkUrl, log);

            if (isBroken) {
              log.debug(`[broken-internal-links-crawl] ✗ BROKEN: ${linkUrl} (from ${pageUrl})`);
              return {
                urlFrom: pageUrl,
                urlTo: linkUrl,
                trafficDomain: 0, // Crawl-discovered links have no traffic data
              };
            }

            log.debug(`[broken-internal-links-crawl] ✓ OK: ${linkUrl}`);
            return null;
          }),
        );

        // Add broken links to map (deduplicate by urlFrom|urlTo)
        let brokenLinksOnPage = 0;
        linkValidations.forEach((link) => {
          if (link) {
            const key = `${link.urlFrom}|${link.urlTo}`;
            if (!brokenLinksMap.has(key)) {
              brokenLinksMap.set(key, link);
              brokenLinksOnPage += 1;
            }
          }
        });

        if (brokenLinksOnPage > 0) {
          log.info(`[broken-internal-links-crawl] Found ${brokenLinksOnPage} broken links on ${pageUrl}`);
        }

        pagesProcessed += 1;
      } catch (error) {
        log.error(`[broken-internal-links-crawl] Error processing ${url}: ${error.message}`, error);
        pagesSkipped += 1;
      }
    }),
  );

  const brokenLinks = Array.from(brokenLinksMap.values());

  // Log summary statistics
  log.info('[broken-internal-links-crawl] ====== Crawl Detection Summary ======');
  log.info(`[broken-internal-links-crawl] Pages processed: ${pagesProcessed}`);
  log.info(`[broken-internal-links-crawl] Pages skipped (errors/no content): ${pagesSkipped}`);
  log.info(`[broken-internal-links-crawl] Total internal links found: ${totalLinksFound}`);
  log.info(`[broken-internal-links-crawl] Links validated: ${totalLinksValidated}`);
  log.info(`[broken-internal-links-crawl] Links out of scope: ${linksOutOfScope}`);
  log.info(`[broken-internal-links-crawl] Broken links detected: ${brokenLinks.length}`);
  log.info('[broken-internal-links-crawl] =====================================');

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
  let rumLinksAdded = 0;
  let crawlOnlyCount = 0;
  let overlapCount = 0;

  // Step 1: Add RUM links first (they have traffic_domain)
  rumLinks.forEach((link) => {
    const key = `${link.urlFrom}|${link.urlTo}`;
    linkMap.set(key, link);
    rumLinksAdded += 1;
    log.debug(`[broken-internal-links-merge] RUM: ${link.urlTo} (traffic: ${link.trafficDomain}) from ${link.urlFrom}`);
  });

  log.info(`[broken-internal-links-merge] Added ${rumLinksAdded} RUM-detected links with traffic data`);

  // Step 2: Add crawl links (only if not already from RUM)
  crawlLinks.forEach((link) => {
    const key = `${link.urlFrom}|${link.urlTo}`;
    if (!linkMap.has(key)) {
      // Crawl-only links keep trafficDomain: 0 (lowest priority)
      linkMap.set(key, link);
      crawlOnlyCount += 1;
      log.debug(`[broken-internal-links-merge] CRAWL-ONLY: ${link.urlTo} (traffic: 0) from ${link.urlFrom}`);
    } else {
      overlapCount += 1;
      log.debug(`[broken-internal-links-merge] OVERLAP (skipped): ${link.urlTo} already found by RUM`);
    }
  });

  const mergedLinks = Array.from(linkMap.values());

  // Calculate traffic statistics
  const linksWithTraffic = mergedLinks.filter((link) => link.trafficDomain > 0).length;
  const linksWithoutTraffic = mergedLinks.filter((link) => link.trafficDomain === 0).length;
  const totalTraffic = mergedLinks.reduce((sum, link) => sum + (link.trafficDomain || 0), 0);

  // Log summary statistics
  log.info(`[broken-internal-links-merge] Crawl-only links: ${crawlOnlyCount} (not found by RUM)`);
  log.info(`[broken-internal-links-merge] Overlapping links: ${overlapCount} (found by both, using RUM data)`);
  log.info(`[broken-internal-links-merge] Total merged: ${mergedLinks.length} unique broken links`);
  log.info(`[broken-internal-links-merge] Links with traffic data: ${linksWithTraffic}`);
  log.info(`[broken-internal-links-merge] Links without traffic data: ${linksWithoutTraffic}`);
  log.info(`[broken-internal-links-merge] Total traffic affected: ${totalTraffic} views`);
  log.info('[broken-internal-links-merge] =================================');

  // Step 3: Return merged array
  return mergedLinks;
}
