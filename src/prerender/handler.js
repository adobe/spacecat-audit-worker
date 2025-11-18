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

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './html-comparator-utils.js';
import {
  generateReportingPeriods,
  getS3Config,
} from '../llm-error-pages/utils.js';
import { weeklyBreakdownQueries } from '../cdn-logs-report/utils/query-builder.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;

const CONTENT_GAIN_THRESHOLD = 1.1;

/**
 * Fetch top Agentic URLs using Athena (preferred).
 * Groups by URL across agentic rows, filters out pooled 'Other', sorts by hits.
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function getTopAgenticUrlsFromAthena(site, context, limit = 200) {
  const { log } = context;
  try {
    const s3Config = await getS3Config(site, context);
    const periods = generateReportingPeriods();
    const latestWeek = periods.weeks[0];
    const weekId = `w${String(latestWeek.weekNumber).padStart(2, '0')}-${latestWeek.year}`;
    const query = await weeklyBreakdownQueries.createAgenticReportQuery({
      periods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
    });

    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());
    log.info('[PRERENDER] Executing Athena query for top agentic URLs...');
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      '[Athena Query] Prerender - Top Agentic URLs',
    );

    if (!Array.isArray(results) || results.length === 0) {
      log.warn('[PRERENDER] Athena returned no agentic rows.');
      return [];
    }

    // Aggregate by URL
    const byUrl = new Map();
    for (const row of results) {
      const url = row?.url || '';
      const hits = Number(row?.number_of_hits || 0) || 0;
      if (url && url !== 'Other') {
        const prev = byUrl.get(url) || 0;
        byUrl.set(url, prev + hits);
      }
    }

    const baseUrl = site.getBaseURL?.() || '';
    const topUrls = Array.from(byUrl.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path, hits]) => {
        try {
          return {
            url: new URL(path, baseUrl).toString(),
            agenticTraffic: hits,
            agenticTrafficDuration: weekId,
          };
        } catch {
          return {
            url: path,
            agenticTraffic: hits,
            agenticTrafficDuration: weekId,
          };
        }
      });

    log.info(`[PRERENDER] Selected ${topUrls.length} top agentic URLs via Athena.`);
    return topUrls;
  } catch (e) {
    log?.warn?.(`[PRERENDER] Athena agentic URL fetch failed: ${e.message}`);
    return [];
  }
}

/**
 * Wrapper: Try Athena first, then fall back to sheet if needed.
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<string[]>}
 */
async function getTopAgenticUrls(site, context, limit = 200) {
  // Keep it simple: use Athena only
  return getTopAgenticUrlsFromAthena(site, context, limit);
}

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

  // Fetch Top Agentic URLs from weekly sheet (best-effort)
  const agenticStats = await getTopAgenticUrls(site, context, 200);
  const agenticUrls = agenticStats.map((s) => s.url);

  const finalUrls = [...new Set([...topPagesUrls, ...includedURLs, ...agenticUrls])];

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
 * Processes opportunities and suggestions for prerender audit results
 * @param {string} auditUrl - Audited URL
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function processOpportunityAndSuggestions(auditUrl, auditData, context) {
  const { log } = context;

  const { auditResult } = auditData;
  const { urlsNeedingPrerender } = auditResult;

  if (urlsNeedingPrerender === 0) {
    log.info(`Prerender - No prerender opportunities found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return;
  }

  const preRenderSuggestions = auditResult.results
    .filter((result) => result.needsPrerender);

  if (preRenderSuggestions.length === 0) {
    log.info(`Prerender - No URLs needing prerender found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return;
  }

  log.debug(`Prerender - Generated ${preRenderSuggestions.length} prerender suggestions for baseUrl=${auditUrl}, siteId=${auditData.siteId}`);

  // Compute max organic traffic to offset agentic ranks so all agentic URLs come first
  const maxOrganicTraffic = preRenderSuggestions.reduce((max, s) => {
    const val = Number(s.organicTraffic);
    return Number.isFinite(val) && val > max ? val : max;
  }, 0);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    auditData, // Pass auditData as props so createOpportunityData receives it
  );

  const buildKey = (data) => `${data.url}|${AUDIT_TYPE}`;

  // Helper function to extract only the fields we want in suggestions
  const mapSuggestionData = (suggestion) => ({
    url: suggestion.url,
    organicTraffic: suggestion.organicTraffic,
    agenticTraffic: suggestion.agenticTraffic,
    organicTrafficDate: suggestion.organicTrafficDate ?? 'NA',
    agenticTrafficDuration: suggestion.agenticTrafficDuration ?? 'NA',
    contentGainRatio: suggestion.contentGainRatio,
    wordCountBefore: suggestion.wordCountBefore,
    wordCountAfter: suggestion.wordCountAfter,
    // S3 references to stored HTML content for comparison
    originalHtmlKey: getS3Path(suggestion.url, auditData.siteId, 'server-side.html'),
    prerenderedHtmlKey: getS3Path(suggestion.url, auditData.siteId, 'client-side.html'),
  });

  await syncSuggestions({
    opportunity,
    newData: preRenderSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: Suggestion.TYPES.CONFIG_UPDATE,
      // Rank: agentic-first by adding an offset (max organic) to agenticTraffic;
      // else use organicTraffic; else 0
      rank: (() => {
        const agentic = Number(suggestion.agenticTraffic);
        const organic = Number(suggestion.organicTraffic);
        if (Number.isFinite(agentic) && agentic > 0) {
          return agentic + maxOrganicTraffic;
        }
        return Number.isFinite(organic) ? organic : 0;
      })(),
      data: mapSuggestionData(suggestion),
    }),
    // Custom merge function: preserve existing fields, update with clean new data
    mergeDataFunction: (existingData, newDataItem) => ({
      ...existingData,
      ...mapSuggestionData(newDataItem),
    }),
  });

  log.info(`Prerender - Successfully synced suggestions=${preRenderSuggestions.length} for baseUrl: ${auditUrl}, siteId: ${auditData.siteId}`);
}

/**
 * Post processor to upload a status JSON file to S3 after audit completion
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function uploadStatusSummaryToS3(auditUrl, auditData, context) {
  const { log, s3Client, env } = context;
  const { auditResult, siteId, auditedAt } = auditData;

  try {
    if (!auditResult) {
      log.warn('Prerender - Missing auditResult, skipping status summary upload');
      return;
    }

    // Extract status information for all top pages
    const statusSummary = {
      baseUrl: auditUrl,
      siteId,
      auditType: AUDIT_TYPE,
      lastUpdated: auditedAt || new Date().toISOString(),
      totalUrlsChecked: auditResult.totalUrlsChecked || 0,
      urlsNeedingPrerender: auditResult.urlsNeedingPrerender || 0,
      scrapeForbidden: auditResult.scrapeForbidden || false,
      pages: auditResult.results?.map((result) => {
        const pageStatus = {
          url: result.url,
          scrapingStatus: result.error ? 'error' : 'success',
          needsPrerender: result.needsPrerender || false,
          wordCountBefore: result.wordCountBefore || 0,
          wordCountAfter: result.wordCountAfter || 0,
          contentGainRatio: result.contentGainRatio || 0,
          organicTraffic: result.organicTraffic ?? 'NA',
          agenticTraffic: result.agenticTraffic ?? 'NA',
          organicTrafficDate: result.organicTrafficDate ?? 'NA',
          agenticTrafficDuration: result.agenticTrafficDuration ?? 'NA',
        };

        // Include scrape error details if available
        if (result.scrapeError) {
          pageStatus.scrapeError = result.scrapeError;
        }

        return pageStatus;
      }) || [],
    };

    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: statusKey,
      Body: JSON.stringify(statusSummary, null, 2),
      ContentType: 'application/json',
    }));

    log.info(`Prerender - Successfully uploaded status summary to S3: ${statusKey}. baseUrl=${auditUrl}, siteId=${siteId}`);
  } catch (error) {
    log.error(`Prerender - Failed to upload status summary to S3: ${error.message}. baseUrl=${auditUrl}, siteId=${siteId}`, error);
    // Don't throw - this is a non-critical post-processing step
  }
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

  log.info(`Prerender - Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

  try {
    let urlsToCheck = [];
    const trafficMap = new Map(); // organic (Ahrefs) traffic
    const organicTrafficDateMap = new Map(); // organic traffic importedAt date
    const agenticTrafficMap = new Map(); // agentic traffic (Athena)
    const agenticTrafficDurationMap = new Map(); // agentic week id e.g. w45-2025
    let agenticWeekId = null; // single agentic duration for the audit

    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

    topPages.forEach((page) => {
      trafficMap.set(page.getUrl(), page.getTraffic());
      // Try to extract importedAt if exposed by data-access; fallback to 'NA'
      try {
        const importedAt = page.getImportedAt?.() || page.importedAt || null;
        if (importedAt) {
          organicTrafficDateMap.set(page.getUrl(), new Date(importedAt).toISOString());
        }
      } catch {
        // ignore
      }
    });

    // Build agentic traffic map (best-effort)
    try {
      const agenticStats = await getTopAgenticUrls(site, context, 200);
      agenticStats.forEach(({ url, agenticTraffic, agenticTrafficDuration }) => {
        agenticTrafficMap.set(url, Number(agenticTraffic || 0) || 0);
        if (agenticTrafficDuration) {
          agenticTrafficDurationMap.set(url, agenticTrafficDuration);
          agenticWeekId = agenticWeekId || agenticTrafficDuration;
        }
      });
    } catch (e) {
      log?.warn?.(`[PRERENDER] Failed to fetch agentic traffic for mapping: ${e.message}`);
    }

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
        const organicTraffic = trafficMap.has(url) ? trafficMap.get(url) : 'NA';
        const agenticTraffic = agenticTrafficMap.has(url) ? agenticTrafficMap.get(url) : 'NA';
        const organicTrafficDate = organicTrafficDateMap.has(url) ? organicTrafficDateMap.get(url) : 'NA';
        const agenticTrafficDuration = agenticTrafficDurationMap.has(url) ? agenticTrafficDurationMap.get(url) : 'NA';
        return {
          ...result,
          organicTraffic,
          agenticTraffic,
          organicTrafficDate,
          agenticTrafficDuration,
        };
      }),
    );

    // No server-side sorting; ranking is applied in suggestions and UI sorts client-side.

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
      await processOpportunityAndSuggestions(site.getBaseURL(), {
        siteId,
        auditId: audit.getId(),
        auditResult,
      }, context);
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

    // Upload status summary to S3 (post-processing)
    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
    };
    await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);

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
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
