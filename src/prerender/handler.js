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
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './html-comparator-utils.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;

// Configuration constants
const CONTENT_INCREASE_THRESHOLD = 1.2; // Content increase ratio threshold

/**
 * Sanitizes the import path by replacing special characters with hyphens
 * @param {string} importPath - The path to sanitize
 * @returns {string} The sanitized path
 */
function sanitizeImportPath(importPath) {
  return importPath
    .replace(/^\/+|\/+$/g, '') // Remove leading/trailing slashes
    .replace(/[/.]/g, '-') // Replace forward slashes and dots with hyphens
    .replace(/-+/g, '-') // Replace multiple consecutive hyphens with single hyphen
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
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
  const rawImportPath = new URL(url).pathname.replace(/\/$/, '');
  const sanitizedImportPath = sanitizeImportPath(rawImportPath);
  const pathSegment = sanitizedImportPath ? `/${sanitizedImportPath}` : '';
  return `${AUDIT_TYPE}/scrapes/${siteId}${pathSegment}/${fileName}`;
}

/**
 * Gets scraped HTML content from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object|null>} - Object with serverSideHtml and clientSideHtml
 * or null if not found
 */
async function getScrapedHtmlFromS3(url, siteId, context) {
  const { log, s3Client, env } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const serverSideKey = getS3Path(url, siteId, 'server-side.html');
    const clientSideKey = getS3Path(url, siteId, 'client-side.html');

    log.info(`Prerender - Getting scraped content for URL: ${url}`);
    log.info(`Prerender - Server-side key: ${serverSideKey}`);
    log.info(`Prerender - Client-side key: ${clientSideKey}`);

    // Fetch both HTML files in parallel
    const [serverSideHtml, clientSideHtml] = await Promise.all([
      getObjectFromKey(s3Client, bucketName, serverSideKey, log),
      getObjectFromKey(s3Client, bucketName, clientSideKey, log),
    ]);

    if (serverSideHtml && clientSideHtml) {
      log.info(`Prerender - Found both server-side and client-side HTML for URL: ${url}`);
      return {
        serverSideHtml,
        clientSideHtml,
      };
    }

    log.warn(`Prerender - Missing HTML files for URL: ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    return null;
  } catch (error) {
    log.warn(`Prerender - Could not get scraped content for ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Compares server-side HTML with client-side HTML and detects client-side rendering
 * @param {string} url - URL being analyzed
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
async function compareHtmlContent(url, siteId, context) {
  const { log } = context;

  log.info(`Prerender - Comparing HTML content for: ${url}`);

  // Get both server-side and client-side HTML from S3
  const scrapedData = await getScrapedHtmlFromS3(url, siteId, context);

  if (!scrapedData) {
    log.error(`Prerender - No scraped data available for comparison for ${url}`);
    return {
      url,
      status: 'error',
      error: 'No scraped data available for comparison',
      needsPrerender: false,
    };
  }

  const { serverSideHtml, clientSideHtml } = scrapedData;

  if (!serverSideHtml || !clientSideHtml) {
    log.error(`Prerender - Missing HTML data for ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    return {
      url,
      status: 'error',
      error: 'Missing HTML data for comparison',
      needsPrerender: false,
    };
  }

  // eslint-disable-next-line
  const analysis = analyzeHtmlForPrerender(serverSideHtml, clientSideHtml, CONTENT_INCREASE_THRESHOLD);

  if (analysis.error) {
    log.error(`Prerender - HTML analysis failed for ${url}: ${analysis.error}`);
    return {
      url,
      status: 'error',
      error: analysis.error,
      needsPrerender: false,
    };
  }

  log.info(`Prerender - Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordDiff=${analysis.wordDiff}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

  return {
    url,
    status: 'compared',
    ...analysis,
  };
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

  // Get top pages for the site
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  const topPagesUrls = topPages.map((page) => page.getUrl());

  // Get any included URLs for prerender audit from site config
  const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];

  // Combine and deduplicate URLs
  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];

  log.info(`Prerender - Submitting ${finalUrls.length} URLs for scraping (${topPagesUrls.length} top pages + ${includedURLs.length} included URLs)`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = site.getBaseURL();
    log.info(`Prerender - No URLs found, falling back to base URL: ${baseURL}`);
    finalUrls.push(baseURL);
  }

  // The first step MUST return auditResult and fullAuditRef.
  // fullAuditRef could point to where the raw scraped data will be stored (e.g., S3 path).
  return {
    urls: finalUrls.slice(0, 1).map((url) => ({ url })),
    siteId: site.getId(),
    type: AUDIT_TYPE,
    processingType: AUDIT_TYPE,
    allowCache: false,
    options: {
      hideConsentBanners: true,
      pageLoadTimeout: 15000,
      waitForSelector: 'body',
      storagePrefix: AUDIT_TYPE,
    },
  };
}

/**
 * Processes opportunities and suggestions for prerender audit results
 * @param {string} auditUrl - Audited URL
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function processOpportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  if (auditData.auditResult.status !== 'OPPORTUNITIES_FOUND') {
    log.info('Prerender - No prerender opportunities found, skipping opportunity creation');
    return;
  }

  const preRenderSuggestions = auditData.auditResult.results
    .filter((result) => result.needsPrerender);

  if (preRenderSuggestions.length === 0) {
    log.info('Prerender - No URLs needing prerender found, skipping opportunity creation');
    return;
  }

  log.info(`Prerender - Generated ${preRenderSuggestions.length} prerender suggestions for ${auditUrl}`);

  // Create opportunity
  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  // Sync suggestions - use URL as unique key (one prerender suggestion per URL)
  const buildKey = (data) => `${data.url}|${AUDIT_TYPE}`;

  await syncSuggestions({
    opportunity,
    newData: preRenderSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: AUDIT_TYPE,
      data: suggestion,
    }),
  });

  log.info(`Prerender - Successfully synced opportunity and suggestions for site: ${auditData.siteId} and ${AUDIT_TYPE} audit type.`);
}

/**
 * Step 3: Process scraped content and compare server-side vs client-side HTML
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, dataAccess, scrapeResultPaths,
  } = context;

  const siteId = site.getId();
  const startTime = process.hrtime();

  log.info(`Prerender - Generate opportunities for site: ${siteId}`);

  try {
    // Get URLs that were scraped from the audit data or fallback to top pages
    let urlsToCheck = [];

    // Try to get URLs from the audit context first
    if (scrapeResultPaths?.size > 0) {
      // Extract URLs from scrape result paths
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      log.info(`Prerender - Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      // Fallback: get top pages
      const { SiteTopPage } = dataAccess;
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
      urlsToCheck = topPages.map((page) => page.getUrl());
      log.info(`Prerender - Fallback: Using ${urlsToCheck.length} top pages for comparison`);
    }

    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      log.info('Prerender - No URLs found, using base URL for comparison');
    }

    // limit to 1 for testing
    urlsToCheck = urlsToCheck.slice(0, 1);

    // Compare server-side vs client-side HTML for each URL
    const comparisonResults = await Promise.all(
      urlsToCheck.map((url) => compareHtmlContent(url, siteId, context)),
    );

    // Analyze results
    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => result.status === 'compared');

    log.info(`Prerender - Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender`);

    const auditResult = {
      status: urlsNeedingPrerender.length > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      summary: `Analyzed ${successfulComparisons.length} URLs, found ${urlsNeedingPrerender.length} with significant client-side rendering`,
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      results: comparisonResults,
    };

    // Generate suggestions and opportunities if needed
    if (urlsNeedingPrerender.length > 0) {
      await processOpportunityAndSuggestions(site.getBaseURL(), {
        siteId,
        auditId: audit.getId(),
        auditResult,
      }, context);
    }

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`Prerender - Audit completed in ${elapsedSeconds}s`);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`Prerender - Audit failed for site ${siteId}: ${error.message}`, error);

    return {
      status: 'ERROR',
      error: error.message,
      summary: 'Audit failed due to internal error',
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
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
