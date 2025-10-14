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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './html-comparator-utils.js';

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
 * Gets scraped HTML content from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Object with serverSideHtml and clientSideHtml (may be null)
 */
async function getScrapedHtmlFromS3(url, siteId, context) {
  const { log, s3Client, env } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const serverSideKey = getS3Path(url, siteId, 'server-side.html');
    const clientSideKey = getS3Path(url, siteId, 'client-side.html');

    log.debug(`Prerender - Getting scraped content for URL: ${url}`);

    const [serverSideHtml, clientSideHtml] = await Promise.all([
      getObjectFromKey(s3Client, bucketName, serverSideKey, log),
      getObjectFromKey(s3Client, bucketName, clientSideKey, log),
    ]);

    return {
      serverSideHtml,
      clientSideHtml,
    };
  } catch (error) {
    log.warn(`Prerender - Could not get scraped content for ${url}: ${error.message}`);
    return {
      serverSideHtml: null,
      clientSideHtml: null,
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

  const { serverSideHtml, clientSideHtml } = scrapedData;

  if (!serverSideHtml || !clientSideHtml) {
    log.error(`Prerender - Missing HTML data for ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    return {
      url,
      error: 'Missing HTML data for comparison',
      needsPrerender: false,
    };
  }

  // eslint-disable-next-line
  const analysis = analyzeHtmlForPrerender(serverSideHtml, clientSideHtml, CONTENT_GAIN_THRESHOLD);

  if (analysis.error) {
    log.error(`Prerender - HTML analysis failed for ${url}: ${analysis.error}`);
    return {
      url,
      error: analysis.error,
      needsPrerender: false,
    };
  }

  log.info(`Prerender - Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

  return {
    url,
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

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  const topPagesUrls = topPages.map((page) => page.getUrl());

  const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];

  log.debug(`Prerender - Submitting ${finalUrls.length} URLs for scraping (${topPagesUrls.length} top pages + ${includedURLs.length} included URLs)`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = site.getBaseURL();
    log.info(`Prerender - No URLs found, falling back to base URL: ${baseURL}`);
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
 * Processes opportunities and suggestions for prerender audit results
 * @param {string} auditUrl - Audited URL
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function processOpportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  if (auditData.auditResult.urlsNeedingPrerender === 0) {
    log.info('Prerender - No prerender opportunities found, skipping opportunity creation');
    return;
  }

  const preRenderSuggestions = auditData.auditResult.results
    .filter((result) => result.needsPrerender);

  if (preRenderSuggestions.length === 0) {
    log.info('Prerender - No URLs needing prerender found, skipping opportunity creation');
    return;
  }

  log.debug(`Prerender - Generated ${preRenderSuggestions.length} prerender suggestions for ${auditUrl}`);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
  );

  const buildKey = (data) => `${data.url}|${AUDIT_TYPE}`;

  await syncSuggestions({
    opportunity,
    newData: preRenderSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: Suggestion.TYPES.CONFIG_UPDATE,
      rank: suggestion.organicTraffic,
      data: {
        url: suggestion.url,
        organicTraffic: suggestion.organicTraffic,
        contentGainRatio: suggestion.contentGainRatio,
        wordCountBefore: suggestion.wordCountBefore,
        wordCountAfter: suggestion.wordCountAfter,
        // S3 references to stored HTML content for comparison
        originalHtmlKey: getS3Path(suggestion.url, auditData.siteId, 'server-side.html'),
        prerenderedHtmlKey: getS3Path(suggestion.url, auditData.siteId, 'client-side.html'),
      },
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
      log.info(`Prerender - Fallback: Using ${urlsToCheck.length} top pages for comparison`);
    }

    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      log.info('Prerender - No URLs found, using base URL for comparison');
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

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      results: comparisonResults,
    };

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
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
