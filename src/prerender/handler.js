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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender, getHtmlFilterSelectors } from './html-comparator-utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const CONTENT_GAIN_THRESHOLD = 1.1;

/**
 * Sanitizes the import path by replacing special characters with hyphens
 * @param {string} importPath - The path to sanitize
 * @returns {string} The sanitized path
 */
function sanitizeImportPath(importPath) {
  return importPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/[/._]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Transforms a URL into an S3 path for a given site and file type
 * @param {string} url - The URL to transform
 * @param {string} siteId - The site ID (used as jobId)
 * @param {string} fileName - The file name (e.g., 'scrape.json', 'server-side.html',
 * 'client-side.html')
 * @returns {string} The S3 path to the file
 */
function getS3Path(url, siteId, fileName) {
  const rawImportPath = new URL(url).pathname;
  const sanitizedImportPath = sanitizeImportPath(rawImportPath);
  const pathSegment = sanitizedImportPath ? `/${sanitizedImportPath}` : '';
  return `${AUDIT_TYPE}/scrapes/${siteId}${pathSegment}/${fileName}`;
}

/**
 * Gets scraped HTML content and metadata from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Object with serverSideHtml, clientSideHtml, and metadata
 */
async function getScrapedHtmlFromS3(url, siteId, context) {
  const { log, s3Client, env } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const serverSideKey = getS3Path(url, siteId, 'server-side.html');
    const clientSideKey = getS3Path(url, siteId, 'client-side.html');
    const scrapeJsonKey = getS3Path(url, siteId, 'scrape.json');

    log.debug(`Prerender - Getting scraped content for URL: ${url}`);

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
    log.warn(`Prerender - Could not get scraped content for ${url}: ${error.message}`);
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
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
async function compareHtmlContent(url, siteId, context) {
  const { log } = context;

  log.debug(`Prerender - Comparing HTML content for: ${url}`);

  const scrapedData = await getScrapedHtmlFromS3(url, siteId, context);

  const { serverSideHtml, clientSideHtml, metadata } = scrapedData;

  // Track if scrape.json exists and if it indicates 403
  const hasScrapeMetadata = metadata !== null;
  const scrapeForbidden = metadata?.error?.statusCode === 403;

  try {
    // Validate HTML data availability
    if (!serverSideHtml || !clientSideHtml) {
      throw new Error(`Missing HTML data for ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    }

    // Even if original scrape was forbidden, we might have HTML uploaded from local scraping
    const analysis = await analyzeHtmlForPrerender(
      serverSideHtml,
      clientSideHtml,
      CONTENT_GAIN_THRESHOLD,
    );

    log.debug(`Prerender - Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

    return {
      url,
      ...analysis,
      hasScrapeMetadata, // Track if scrape.json exists on S3
      scrapeForbidden, // Track if original scrape was forbidden (403)
      /* c8 ignore next */
      scrapeError: metadata?.error, // Include error details from scrape.json
    };
  } catch (error) {
    log.error(`Prerender - HTML analysis failed for ${url}: ${error.message}`);
    return {
      url,
      error: true,
      needsPrerender: false,
      hasScrapeMetadata,
      scrapeForbidden,
      scrapeError: metadata?.error,
    };
  }
}

/**
 * Step 1: Import top pages data
 * @param {Object} context - Audit context with site and finalUrl
 * @returns {Promise<Object>} - Import job configuration
 */
export async function importTopPages(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };
}

/**
 * Step 2: Submit URLs for scraping
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata
 */
export async function submitForScraping(context) {
  const {
    site,
    dataAccess,
    log,
  } = context;

  const { SiteTopPage } = dataAccess;
  const siteId = site.getId();

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  const topPagesUrls = topPages.map((page) => page.getUrl());

  const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];

  log.info(`Prerender: Submitting ${finalUrls.length} URLs for scraping. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = site.getBaseURL();
    log.info(`Prerender - No URLs found, falling back to baseUrl=${baseURL}, siteId=${site.getId()}`);
    finalUrls.push(baseURL);
  }

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: AUDIT_TYPE,
    processingType: AUDIT_TYPE,
    allowCache: false,
    options: {
      pageLoadTimeout: 20000,
      storagePrefix: AUDIT_TYPE,
    },
  };
}

/**
 * Creates a notification opportunity when scraping is forbidden
 * @param {string} auditUrl - Audited URL
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function createScrapeForbiddenOpportunity(auditUrl, auditData, context) {
  const { log } = context;

  log.info(`Prerender - Creating dummy opportunity for forbidden scraping. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);

  await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    auditData, // Pass auditData as props so createOpportunityData receives it
  );
}

/**
 * Step 3: Process scraped content and compare server-side vs client-side HTML
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities
 */
export async function processContentAndSendToMystique(context) {
  const {
    site, audit, log, dataAccess, scrapeResultPaths, sqs, env,
  } = context;

  const siteId = site.getId();
  const startTime = process.hrtime();

  log.info(`Prerender - Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

  try {
    let urlsToCheck = [];
    const trafficMap = new Map();

    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

    topPages.forEach((page) => {
      trafficMap.set(page.getUrl(), page.getTraffic());
    });

    // Try to get URLs from the audit context first
    if (scrapeResultPaths?.size > 0) {
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      log.info(`Prerender - Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      // Fallback: get top pages and included URLs
      urlsToCheck = topPages.map((page) => page.getUrl());
      /* c8 ignore start */
      const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];
      urlsToCheck = [...new Set([...urlsToCheck, ...includedURLs])];
      /* c8 ignore stop */
      log.info(`Prerender - Fallback for baseUrl=${site.getBaseURL()}, siteId=${siteId}. Using topPages=${topPages.length}, includedURLs=${includedURLs.length}, total=${urlsToCheck.length}`);
    }

    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      log.info(`Prerender - No URLs found for comparison. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
    }

    const comparisonResults = await Promise.all(
      urlsToCheck.map(async (url) => {
        const result = await compareHtmlContent(url, siteId, context);
        const organicTraffic = trafficMap.get(url) || 0;
        return {
          ...result,
          organicTraffic,
        };
      }),
    );

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    log.info(`Prerender - Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped`);

    // Check if all scrape.json files on S3 have statusCode=403
    const urlsWithScrapeJson = comparisonResults.filter((result) => result.hasScrapeMetadata);
    const urlsWithForbiddenScrape = urlsWithScrapeJson.filter((result) => result.scrapeForbidden);
    const scrapeForbidden = urlsWithScrapeJson.length > 0
      && urlsWithForbiddenScrape.length === urlsWithScrapeJson.length;

    log.info(`Prerender - Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}. scrapeForbidden=${scrapeForbidden}, totalUrlsChecked=${comparisonResults.length}, urlsWithScrapeJson=${urlsWithScrapeJson.length}, urlsWithForbiddenScrape=${urlsWithForbiddenScrape.length}`);

    // Remove internal tracking fields from results before storing
    // eslint-disable-next-line
    const cleanResults = comparisonResults.map(({ hasScrapeMetadata, scrapeForbidden, ...result }) => result);

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      results: cleanResults,
      scrapeForbidden,
    };

    if (urlsNeedingPrerender.length > 0) {
      // Instead of saving suggestions now, send candidate suggestions to Mystique for AI summaries
      if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
        log.warn('Prerender - SQS or Mystique queue not configured, skipping Mystique message');
      } else {
        const message = {
          type: 'guidance:prerender',
          siteId,
          auditId: audit.getId(),
          url: site.getBaseURL(),
          deliveryType: site.getDeliveryType(),
          time: new Date().toISOString(),
          data: {
            // Send candidate suggestions; Mystique will enrich with AI summaries
            suggestions: urlsNeedingPrerender.map((result) => ({
              url: result.url,
              contentGainRatio: result.contentGainRatio,
              wordCountBefore: result.wordCountBefore,
              wordCountAfter: result.wordCountAfter,
              organicTraffic: result.organicTraffic,
              originalHtmlKey: getS3Path(result.url, siteId, 'server-side.html'),
              prerenderedHtmlKey: getS3Path(result.url, siteId, 'client-side.html'),
            })),
            excludedSelectors: getHtmlFilterSelectors().selectors,
          },
        };
        await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
        log.info(`Prerender - Sent ${urlsNeedingPrerender.length} candidate suggestions to Mystique for siteId=${siteId}`);
      }
    } else if (scrapeForbidden) {
      // Create a dummy opportunity when scraping is forbidden (403)
      // This allows the UI to display proper messaging without suggestions
      await createScrapeForbiddenOpportunity(site.getBaseURL(), {
        siteId,
        auditId: audit.getId(),
        auditResult,
      }, context);
    } else {
      log.info(`Prerender - No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}`);
    }

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`Prerender - Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`Prerender - Audit failed for baseUrl=${site.getBaseURL()}, siteId=${siteId}: ${error.message}`, error);

    return {
      error: error.message,
      totalUrlsChecked: 0,
      urlsNeedingPrerender: 0,
      results: [],
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.CONTENT_SCRAPER)
  .addStep('process-scrape-content-and-send-to-mystique', processContentAndSendToMystique)
  .build();
