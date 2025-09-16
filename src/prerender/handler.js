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

import {
  SPACECAT_USER_AGENT,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';
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
 * Fetches HTML content directly from a URL
 * @param {string} url - URL to fetch
 * @param {Object} context - Audit context with logger
 * @returns {Promise<string|null>} - HTML content or null if failed
 */
export async function fetchDirectHtml(url, context) {
  const { log } = context;

  log.info(`Prerender -  Fetching HTML content for ${url}`);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': SPACECAT_USER_AGENT,
      },
    });

    if (!response.ok) {
      log.warn(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      log.warn(`Prerender - Non-HTML content type for ${url}: ${contentType}`);
      return null;
    }
    const html = await response.text();
    log.info(`Prerender -  Successfully fetched HTML content for ${url}`);
    return html;
  } catch (error) {
    log.warn(`Prerender - Error fetching ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Transforms a URL into a scrape.json path for a given site
 * @param {string} url - The URL to transform
 * @param {string} siteId - The site ID
 * @returns {string} The path to the scrape.json file
 */
function getScrapeJsonPath(url, siteId) {
  const pathname = new URL(url).pathname.replace(/\/$/, '');
  return `scrapes/${siteId}${pathname}/scrape.json`;
}

/**
 * Gets scraped HTML content from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<string|null>} - Scraped HTML content or null if not found
 */
async function getScrapedHtmlFromS3(url, siteId, context) {
  const { log, s3Client, env } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const key = getScrapeJsonPath(url, siteId);

    log.info(`Prerender -  Getting scraped content for URL: ${url} (key: ${key})`);
    const scrapeData = await getObjectFromKey(s3Client, bucketName, key, log);

    if (scrapeData?.scrapeResult?.rawBody) {
      log.info(`Prerender -  Found scraped content for URL: ${url} (key: ${key})`);
      return scrapeData.scrapeResult.rawBody;
    }

    log.warn(`Prerender -  No scraped content found for URL: ${url} (key: ${key})`);
    return null;
  } catch (error) {
    log.warn(`Prerender -  Could not get scraped content for ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Compares direct fetch HTML with scraped HTML and detects client-side rendering
 * @param {string} url - URL being analyzed
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
async function compareHtmlContent(url, siteId, context) {
  const { log } = context;

  log.info(`Comparing HTML content for: ${url}`);

  // Fetch both versions
  const [directHtml, scrapedHtml] = await Promise.all([
    fetchDirectHtml(url, context),
    getScrapedHtmlFromS3(url, siteId, context),
  ]);

  if (!directHtml) {
    log.error(`Prerender -  Could not fetch direct HTML for ${url}`);
    return {
      url,
      status: 'error',
      error: 'Could not fetch direct HTML',
      needsPrerender: false,
    };
  }

  if (!scrapedHtml) {
    log.error(`Prerender -  No scraped data available for comparison for ${url}`);
    return {
      url,
      status: 'error',
      error: 'No scraped data available for comparison',
      needsPrerender: false,
    };
  }

  // directHtml = server-side rendered, scrapedHtml = client-side rendered
  const analysis = analyzeHtmlForPrerender(directHtml, scrapedHtml, CONTENT_INCREASE_THRESHOLD);

  if (analysis.error) {
    log.error(`Prerender -  HTML analysis failed for ${url}: ${analysis.error}`);
    return {
      url,
      status: 'error',
      error: analysis.error,
      needsPrerender: false,
    };
  }

  log.info(`Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordDiff=${analysis.wordDiff}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

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

  log.info(`Submitting ${finalUrls.length} URLs for scraping (${topPagesUrls.length} top pages + ${includedURLs.length} included URLs)`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = site.getBaseURL();
    log.info(`No URLs found, falling back to base URL: ${baseURL}`);
    return {
      urls: [{ url: baseURL }],
      siteId,
      type: AUDIT_TYPE,
    };
  }

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId,
    type: AUDIT_TYPE,
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
    log.info('No prerender opportunities found, skipping opportunity creation');
    return;
  }

  const urlsNeedingPrerender = auditData.auditResult.results
    .filter((result) => result.needsPrerender);

  if (urlsNeedingPrerender.length === 0) {
    log.info('No URLs needing prerender found, skipping opportunity creation');
    return;
  }

  // Generate suggestions with essential analysis data
  const suggestions = urlsNeedingPrerender.map((result) => ({
    url: result.url,
    ...result,
  }));

  log.info(`Generated ${suggestions.length} prerender suggestions for ${auditUrl}`);

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
    newData: suggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: AUDIT_TYPE,
      data: suggestion,
    }),
  });

  log.info(`Successfully synced opportunity and suggestions for site: ${auditData.siteId} and ${AUDIT_TYPE} audit type.`);
}

/**
 * Step 3: Process scraped content and compare with direct fetch
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, dataAccess,
  } = context;

  const siteId = site.getId();
  const startTime = process.hrtime();

  log.info(`Processing prerender audit for site: ${siteId}`);

  try {
    // Get URLs that were scraped from the audit data or fallback to top pages
    let urlsToCheck = [];

    // Try to get URLs from the audit context first
    if (context.scrapeResultPaths?.size > 0) {
      // Extract URLs from scrape result paths
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      log.info(`Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      // Fallback: get top pages
      const { SiteTopPage } = dataAccess;
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
      urlsToCheck = topPages.map((page) => page.getUrl());
      log.info(`Fallback: Using ${urlsToCheck.length} top pages for comparison`);
    }

    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      log.info('No URLs found, using base URL for comparison');
    }

    // Compare HTML content for each URL
    const comparisonResults = await Promise.all(
      urlsToCheck.map((url) => compareHtmlContent(url, siteId, context)),
    );

    // Analyze results
    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => result.status === 'compared');

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`Prerender audit completed in ${elapsedSeconds}s. Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender`);

    const auditResult = {
      status: urlsNeedingPrerender.length > 0 ? 'OPPORTUNITIES_FOUND' : 'NO_OPPORTUNITIES',
      summary: `Analyzed ${successfulComparisons.length} URLs, found ${urlsNeedingPrerender.length} with significant client-side rendering`,
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      results: comparisonResults,
      elapsedSeconds: parseFloat(elapsedSeconds),
    };

    // Generate suggestions and opportunities if needed
    if (urlsNeedingPrerender.length > 0) {
      await processOpportunityAndSuggestions(site.getBaseURL(), {
        siteId,
        auditId: audit.getId(),
        auditResult,
      }, context);
    }

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`Prerender audit failed for site ${siteId}: ${error.message}`, error);

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
