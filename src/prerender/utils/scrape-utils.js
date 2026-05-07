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

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { getObjectFromKey } from '../../utils/s3-utils.js';
import { analyzeHtmlForPrerender } from './html-comparator.js';
import { CONTENT_GAIN_THRESHOLD } from './constants.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * Sanitizes the import path by replacing special characters with hyphens
 * @param {string} importPath - The path to sanitize
 * @returns {string} The sanitized path
 */
export function sanitizeImportPath(importPath) {
  return importPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/[/._]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
* Transforms a URL into an S3 path for a given identifier and file type.
* The identifier can be either a scrape job id or a site id.
* @param {string} url - The URL to transform
* @param {string} id - The identifier - scrapeJobId
* @param {string} fileName - The file name (e.g., 'scrape.json', 'server-side.html',
* 'client-side.html')
* @returns {string} The S3 path to the file
*/
export function getS3Path(url, id, fileName) {
  const rawImportPath = new URL(url).pathname;
  const sanitizedImportPath = sanitizeImportPath(rawImportPath);
  const pathSegment = sanitizedImportPath ? `/${sanitizedImportPath}` : '';
  return `${AUDIT_TYPE}/scrapes/${id}${pathSegment}/${fileName}`;
}

/**
 * Gets scraped HTML content and metadata from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {Object} context - Audit context (must contain log, s3Client, env;
 * may contain auditContext, site)
 * @returns {Promise<Object>} - Object with serverSideHtml, clientSideHtml, and metadata
 */
export async function getScrapedHtmlFromS3(url, context) {
  const {
    log, s3Client, env, auditContext,
  } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const { scrapeJobId: storageId } = auditContext || {};
    const serverSideKey = getS3Path(url, storageId, 'server-side.html');
    const clientSideKey = getS3Path(url, storageId, 'client-side.html');
    const scrapeJsonKey = getS3Path(url, storageId, 'scrape.json');

    log.debug(`${LOG_PREFIX} Getting scraped content for URL: ${url}`);

    const results = await Promise.allSettled([
      getObjectFromKey(s3Client, bucketName, serverSideKey, log),
      getObjectFromKey(s3Client, bucketName, clientSideKey, log),
      getObjectFromKey(s3Client, bucketName, scrapeJsonKey, log),
    ]);

    // Extract values from settled promises
    const serverSideHtml = results[0].status === 'fulfilled' ? results[0].value : null;
    const clientSideHtml = results[1].status === 'fulfilled' ? results[1].value : null;
    const scrapeJsonData = results[2].status === 'fulfilled' ? results[2].value : null;

    // getObjectFromKey already parses JSON if ContentType is application/json
    // So scrapeJsonData is either null (not found), or an already-parsed object
    const metadata = scrapeJsonData || null;

    return {
      serverSideHtml,
      clientSideHtml,
      metadata,
    };
  } catch (error) {
    log.warn(`${LOG_PREFIX} Could not get scraped content for ${url}: ${error.message}`);
    return {
      serverSideHtml: null,
      clientSideHtml: null,
      metadata: null,
    };
  }
}

/**
 * Compares server-side HTML with client-side HTML and detects prerendering opportunities
 * @param {string} url - URL being analyzed
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
export async function compareHtmlContent(url, context) {
  const { log } = context;

  log.debug(`${LOG_PREFIX} Comparing HTML content for: ${url}`);

  const scrapedData = await getScrapedHtmlFromS3(url, context);

  const { serverSideHtml, clientSideHtml, metadata } = scrapedData;

  // Track if scrape.json exists and if it indicates 403
  const hasScrapeMetadata = metadata !== null;
  const scrapeForbidden = metadata?.error?.statusCode === 403;

  try {
    // Validate HTML data availability
    if (!serverSideHtml || !clientSideHtml) {
      throw new Error(`Missing HTML data for ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    }

    const analysis = await analyzeHtmlForPrerender(
      serverSideHtml,
      clientSideHtml,
      CONTENT_GAIN_THRESHOLD,
    );

    log.debug(`${LOG_PREFIX} Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

    return {
      url,
      ...analysis,
      hasScrapeMetadata, // Track if scrape.json exists on S3
      scrapeForbidden, // Track if original scrape was forbidden (403)
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge, // From scrape.json (content-scraper PR #784)
      usedEarlyClientSideHtml: !!metadata?.usedEarlyClientSideHtml, // From scrape.json
      /* c8 ignore next */
      scrapeError: metadata?.error, // Include error details from scrape.json
    };
  } catch (error) {
    log.debug(`${LOG_PREFIX} HTML analysis failed for ${url}: ${error.message}`);
    return {
      url,
      error: true,
      needsPrerender: false,
      hasScrapeMetadata,
      scrapeForbidden,
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge,
      usedEarlyClientSideHtml: !!metadata?.usedEarlyClientSideHtml,
      scrapeError: metadata?.error,
    };
  }
}

/**
 * Parses the mode from the data field
 * @param {string|Object} data - The data field from the message
 * @returns {string|null} - The mode value or null
 */
export function getModeFromData(data) {
  if (!data) {
    return null;
  }

  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    return parsedData.mode || null;
  } catch (e) {
    // Ignore parse errors
    return null;
  }
}

/**
 * Fetches the latest scrapeJobId from the status.json file in S3
 * @param {string} siteId - The site ID
 * @param {Object} context - Audit context with s3Client and env
 * @returns {Promise<string|null>} - The scrapeJobId or null if not found
 */
export async function fetchLatestScrapeJobId(siteId, context) {
  const { log, s3Client, env } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;

    log.info(`${LOG_PREFIX} ai-only: Fetching status.json from s3://${bucketName}/${statusKey}`);

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: statusKey,
    }));

    const statusContent = await response.Body.transformToString();
    const statusData = JSON.parse(statusContent);

    if (statusData.scrapeJobId) {
      log.info(`${LOG_PREFIX} ai-only: Found scrapeJobId: ${statusData.scrapeJobId}`);
      return statusData.scrapeJobId;
    }

    log.warn(`${LOG_PREFIX} ai-only: No scrapeJobId found in status.json`);
    return null;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      log.warn(`${LOG_PREFIX} ai-only: status.json not found for siteId=${siteId}`);
    } else {
      log.error(`${LOG_PREFIX} ai-only: Error fetching status.json: ${error.message}`);
    }
    return null;
  }
}

/**
 * Computes scrape job statistics by combining COMPLETE-status URLs (already in comparisonResults)
 * with FAILED-status URLs (absent from comparisonResults, queried from the ScrapeUrl table).
 *
 * getScrapeResultPaths only returns COMPLETE-status URLs, so 403s where the scraper set
 * status=FAILED never enter comparisonResults. This function covers that gap.
 *
 * @param {string|null} scrapeJobId - Scrape job ID
 * @param {Object[]} comparisonResults - Results from compareHtmlContent (COMPLETE-status URLs)
 * @param {number} urlsToCheckLength - Fallback count when ScrapeUrl is unavailable
 * @param {Object} context - Audit context with dataAccess, s3Client, env, log
 * @returns {Promise<{urlsSubmittedForScraping: number, scrapeForbiddenCount: number,
 *   scrapeForbidden: boolean, missingPages: Object[]}>}
 */
export async function getScrapeJobStats(
  scrapeJobId,
  comparisonResults,
  urlsToCheckLength,
  context,
) {
  const {
    log, dataAccess, s3Client, env,
  } = context;

  // Count 403s from COMPLETE-status URLs (already processed by compareHtmlContent)
  const urlsWithScrapeMetadata = comparisonResults.filter((r) => r.hasScrapeMetadata);
  const completeForbiddenCount = urlsWithScrapeMetadata.filter((r) => r.scrapeForbidden).length;

  if (!scrapeJobId || !dataAccess?.ScrapeUrl) {
    const totalUrlsWithScrapeInfo = urlsWithScrapeMetadata.length;
    return {
      urlsSubmittedForScraping: urlsToCheckLength,
      scrapeForbiddenCount: completeForbiddenCount,
      scrapeForbidden: totalUrlsWithScrapeInfo > 0
        && completeForbiddenCount === totalUrlsWithScrapeInfo,
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

    // Fetch scrape.json for each missing URL; track whether metadata was readable
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
    // Only count missing pages where scrape.json was actually readable in the denominator;
    // pages with no recoverable metadata are unknown status and don't contribute to the signal
    const missingWithMetadataCount = missingPagesRaw
      .filter(({ metadata }) => metadata !== null).length;
    const totalUrlsWithScrapeInfo = urlsWithScrapeMetadata.length + missingWithMetadataCount;
    const scrapeForbidden = totalUrlsWithScrapeInfo > 0
      && scrapeForbiddenCount === totalUrlsWithScrapeInfo;

    return {
      urlsSubmittedForScraping: allScrapeUrls.length,
      scrapeForbiddenCount,
      scrapeForbidden,
      missingPages,
      submittedUrlSet: new Set(allScrapeUrls.map((su) => su.getUrl())),
    };
  } catch (e) {
    log.warn(`${LOG_PREFIX} Failed to fetch ScrapeUrl stats for scrapeJobId=${scrapeJobId}, using fallback: ${e.message}`);
    const totalUrlsWithScrapeInfo = urlsWithScrapeMetadata.length;
    return {
      urlsSubmittedForScraping: urlsToCheckLength,
      scrapeForbiddenCount: completeForbiddenCount,
      scrapeForbidden: totalUrlsWithScrapeInfo > 0
        && completeForbiddenCount === totalUrlsWithScrapeInfo,
      missingPages: [],
      submittedUrlSet: null,
    };
  }
}
