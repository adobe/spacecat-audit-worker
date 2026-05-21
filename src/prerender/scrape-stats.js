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

import { getObjectFromKey } from '../utils/s3-utils.js';
import { getS3Path } from './utils/utils.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Builds the auditResult object and derived collections from comparison results,
 * scrape statistics, and bot-block detection output.
 *
 * @param {Array} comparisonResults - Per-URL results from compareAllUrls
 * @param {Object} scrapeStats - Output of getScrapeJobStats
 * @param {Object} botBlockResult - { scrapeForbidden, scrapeForbiddenSince } from detectBotBlock
 * @returns {{
 *   auditResult: Object,
 *   urlsNeedingPrerender: Array,
 *   successfulComparisons: Array,
 *   scrapedUrlsSet: Set<string>,
 * }}
 */
export function buildAuditResult(comparisonResults, scrapeStats, botBlockResult) {
  const { urlsSubmittedForScraping, scrapeForbiddenCount, missingPages } = scrapeStats;
  const { scrapeForbidden, scrapeForbiddenSince } = botBlockResult;

  const urlsNeedingPrerender = comparisonResults.filter((r) => r.needsPrerender);
  const successfulComparisons = comparisonResults.filter((r) => !r.error);

  const cleanResults = comparisonResults.map(
    // eslint-disable-next-line no-unused-vars
    ({ hasScrapeMetadata, scrapeForbidden: sf, ...result }) => result,
  );

  const urlsNotNeedingPrerender = successfulComparisons.length - urlsNeedingPrerender.length;
  const failedCount = urlsSubmittedForScraping - successfulComparisons.length;
  const scrapingErrorRate = urlsSubmittedForScraping > 0
    ? Math.round((failedCount / urlsSubmittedForScraping) * 100)
    : 0;

  // Exclude deployed URLs — don't mark their suggestions outdated regardless of needsPrerender.
  // isDeployedAtEdge=true means prerender is already active at CDN level.
  const scrapedUrlsSet = new Set(
    successfulComparisons
      .filter((r) => !r.isDeployedAtEdge)
      .map((r) => r.url),
  );

  return {
    auditResult: {
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
    },
    urlsNeedingPrerender,
    successfulComparisons,
    scrapedUrlsSet,
  };
}

/**
 * Collects scrape job statistics by combining data from the ScrapeUrl DB and S3 scrape.json
 * files for FAILED-status URLs.
 *
 * Returns early with zero counts if the domain is bot-blocked (no scraping was attempted).
 * Falls back to in-memory comparison results when ScrapeUrl DB is unavailable.
 *
 * @param {string} scrapeJobId
 * @param {Array} comparisonResults - Results from compareHtmlContent per URL
 * @param {number} urlsToCheckLength - Number of URLs submitted for scraping
 * @param {Object} context - Handler context (log, dataAccess, s3Client, env, auditContext)
 * @returns {Promise<{
 *   urlsSubmittedForScraping: number,
 *   scrapeForbiddenCount: number,
 *   missingPages: Array,
 *   submittedUrlSet: Set<string>|null,
 * }>}
 */
export async function getScrapeJobStats(
  scrapeJobId,
  comparisonResults,
  urlsToCheckLength,
  context,
) {
  const {
    log, dataAccess, s3Client, env, auditContext,
  } = context;

  if (auditContext?.domainBlocked === true) {
    return {
      urlsSubmittedForScraping: 0,
      scrapeForbiddenCount: 0,
      missingPages: [],
      submittedUrlSet: null,
    };
  }

  // Count 403s from COMPLETE-status URLs (already processed by compareHtmlContent)
  const urlsWithScrapeMetadata = comparisonResults.filter((r) => r.hasScrapeMetadata);
  const completeForbiddenCount = urlsWithScrapeMetadata.filter((r) => r.scrapeForbidden).length;

  if (!scrapeJobId || !dataAccess?.ScrapeUrl) {
    return {
      urlsSubmittedForScraping: urlsToCheckLength,
      scrapeForbiddenCount: completeForbiddenCount,
      missingPages: [],
      submittedUrlSet: null,
    };
  }

  try {
    const allScrapeUrls = await dataAccess.ScrapeUrl.allByScrapeJobId(scrapeJobId);
    log.debug(`${LOG_PREFIX} urlsSubmittedForScraping=${allScrapeUrls.length} from ScrapeUrl`
      + ` (scrapeJobId=${scrapeJobId}), urlsToCheck=${urlsToCheckLength}`);

    // Find FAILED-status URLs absent from comparisonResults and read their scrape.json
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const comparisonUrlSet = new Set(comparisonResults.map((r) => r.url));
    const missingUrls = allScrapeUrls.filter((su) => !comparisonUrlSet.has(su.getUrl()));

    const missingPagesRaw = await Promise.all(
      missingUrls.map(async (su) => {
        const url = su.getUrl();
        const scrapeJsonKey = getS3Path(url, scrapeJobId, 'scrape.json');
        const metadata = await getObjectFromKey(s3Client, bucketName, scrapeJsonKey, log)
          .catch(() => null);
        return { url, metadata };
      }),
    );

    const missingPages = missingPagesRaw.map(({ url, metadata }) => ({
      url,
      scrapingStatus: 'failed',
      needsPrerender: false,
      ...(metadata?.error && { scrapeError: metadata.error }),
    }));

    // Combine 403 counts from both COMPLETE and FAILED-status URLs
    const missingForbiddenCount = missingPages
      .filter((p) => p.scrapeError?.statusCode === 403).length;
    const scrapeForbiddenCount = completeForbiddenCount + missingForbiddenCount;

    return {
      urlsSubmittedForScraping: allScrapeUrls.length,
      scrapeForbiddenCount,
      missingPages,
      submittedUrlSet: new Set(allScrapeUrls.map((su) => su.getUrl())),
    };
  } catch (e) {
    log.warn(`${LOG_PREFIX} Failed to fetch ScrapeUrl stats for scrapeJobId=${scrapeJobId}, using fallback: ${e.message}`);
    return {
      urlsSubmittedForScraping: urlsToCheckLength,
      scrapeForbiddenCount: completeForbiddenCount,
      missingPages: [],
      submittedUrlSet: null,
    };
  }
}
