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

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import {
  generateReportingPeriods,
  getS3Config,
  weeklyBreakdownQueries,
  loadLatestAgenticSheet,
  buildSheetHitsMap,
} from './utils/shared.js';
import {
  CONTENT_GAIN_THRESHOLD,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  MODE_AI_ONLY,
} from './utils/constants.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const LOG_PREFIX = 'Prerender -';

async function getTopOrganicUrlsFromAhrefs(context, limit = TOP_ORGANIC_URLS_LIMIT) {
  const { dataAccess, log, site } = context;
  let topPagesUrls = [];
  try {
    const { SiteTopPage } = dataAccess || {};
    if (SiteTopPage?.allBySiteIdAndSourceAndGeo) {
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
      topPagesUrls = (topPages || []).map((p) => p.getUrl()).slice(0, limit);
    }
  } catch (error) {
    log.warn(`Prerender - Failed to load top pages for fallback: ${error.message}. baseUrl=${site.getBaseURL()}`);
  }
  return topPagesUrls;
}

/**
 * Fetch top Agentic URLs using Athena (preferred).
 * Find last week's top agentic URLs, filters out pooled 'Other',
 * groups by URL, and returns the top URLs by total hits.
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<Array<string>>}
 */
async function getTopAgenticUrlsFromAthena(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  const { log } = context;
  try {
    const s3Config = await getS3Config(site, context);
    const periods = generateReportingPeriods();
    const recentWeeks = periods.weeks;
    const oneWeekPeriods = { weeks: [recentWeeks[0]] };
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());
    const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit({
      periods: oneWeekPeriods,
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      site,
      limit,
    });
    log.info(`Prerender - Executing Athena query for top agentic URLs... baseUrl=${site.getBaseURL()}`);
    const results = await athenaClient.query(
      query,
      s3Config.databaseName,
      '[Athena Query] Prerender - Top Agentic URLs',
    );

    if (!Array.isArray(results) || results.length === 0) {
      log.warn(`Prerender - Athena returned no agentic rows. baseUrl=${site.getBaseURL()}`);
      return [];
    }

    const baseUrl = site.getBaseURL?.() || '';
    const topUrls = results
      .filter((row) => typeof row?.url === 'string' && row.url.length > 0)
      .map((row) => {
        const path = row.url;
        try {
          return new URL(path, baseUrl).toString();
        } catch {
          return path;
        }
      });

    log.info(`Prerender - Selected ${topUrls.length} top agentic URLs via Athena. baseUrl=${site.getBaseURL()}`);
    return topUrls;
  } catch (e) {
    log?.warn?.(`Prerender - Athena agentic URL fetch failed: ${e.message}. baseUrl=${site.getBaseURL()}`);
    return [];
  }
}

/**
 * Fetch top Agentic URLs from the weekly Excel sheet (fallback).
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<Array<string>>}
 */
async function getTopAgenticUrlsFromSheet(site, context, limit = 200) {
  const { log } = context;
  try {
    const { weekId, baseUrl, rows } = await loadLatestAgenticSheet(site, context);

    if (!rows || rows.length === 0) {
      log.warn(`Prerender - No agentic traffic rows found in sheet for ${weekId}. baseUrl=${baseUrl}`);
      return [];
    }

    const byUrl = buildSheetHitsMap(rows);
    const top = Array.from(byUrl.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path]) => {
        try {
          return new URL(path, baseUrl).toString();
        } catch {
          return path;
        }
      });

    log.info(`Prerender - Selected ${top.length} top agentic URLs via Sheet (${weekId}). baseUrl=${baseUrl}`);
    return top;
  } catch (e) {
    log?.warn?.(`Prerender - Sheet-based agentic URL fetch failed: ${e?.message || e}. baseUrl=${site.getBaseURL()}`);
    return [];
  }
}

/**
 * Wrapper: Try Athena first, then fall back to sheet if needed.
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<Array<string>>}
 */
async function getTopAgenticUrls(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  const fromAthena = await getTopAgenticUrlsFromAthena(site, context, limit);
  if (Array.isArray(fromAthena) && fromAthena.length > 0) {
    return fromAthena;
  }
  context?.log?.info?.(`Prerender - No agentic URLs from Athena; attempting Sheet fallback. baseUrl=${site.getBaseURL()}`);
  return getTopAgenticUrlsFromSheet(site, context, limit);
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
* Transforms a URL into an S3 path for a given identifier and file type.
* The identifier can be either a scrape job id or a site id.
* @param {string} url - The URL to transform
* @param {string} id - The identifier - scrapeJobId
* @param {string} fileName - The file name (e.g., 'scrape.json', 'server-side.html',
* 'client-side.html')
* @returns {string} The S3 path to the file
*/
function getS3Path(url, id, fileName) {
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
async function getScrapedHtmlFromS3(url, context) {
  const {
    log, s3Client, env, auditContext,
  } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const { scrapeJobId: storageId } = auditContext;
    const serverSideKey = getS3Path(url, storageId, 'server-side.html');
    const clientSideKey = getS3Path(url, storageId, 'client-side.html');
    const scrapeJsonKey = getS3Path(url, storageId, 'scrape.json');

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
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
async function compareHtmlContent(url, context) {
  const { log } = context;

  log.debug(`Prerender - Comparing HTML content for: ${url}`);

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
 * Parses the mode from the data field
 * @param {string|Object} data - The data field from the message
 * @returns {string|null} - The mode value or null
 */
function getModeFromData(data) {
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
async function fetchLatestScrapeJobId(siteId, context) {
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
 * Sends a guidance:prerender message to Mystique with AI summary generation request
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data used to build the message
 * @param {Object} opportunity - The prerender opportunity entity
 * @param {Object} context - Processing context
 * @returns {Promise<number>} - Number of suggestions sent to Mystique
 */
async function sendPrerenderGuidanceRequestToMystique(auditUrl, auditData, opportunity, context) {
  const {
    log, sqs, env, site,
  } = context;
  /* c8 ignore start - Defensive checks and destructuring, tested in ai-only mode tests */
  const {
    siteId,
    auditId,
    scrapeJobId,
  } = auditData || {};

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`Prerender - SQS or Mystique queue not configured, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }

  if (!opportunity || !opportunity.getId) {
    log.warn(`Prerender - Opportunity entity not available, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }
  /* c8 ignore stop */

  const opportunityId = opportunity.getId();

  try {
    const baseUrl = auditUrl;

    // Load the suggestions we just synced so that we can:
    // - include real suggestion IDs
    // - filter out domain-wide aggregate suggestions
    const existingSuggestions = await opportunity.getSuggestions();

    if (!existingSuggestions || existingSuggestions.length === 0) {
      log.warn(`Prerender - No existing suggestions found for opportunityId=${opportunityId}, skipping Mystique message. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const suggestionsPayload = [];

    existingSuggestions.forEach((s) => {
      const data = s.getData();

      // Skip domain-wide aggregate suggestion and anything without URL
      if (!data?.url || data?.isDomainWide) {
        return;
      }

      // Skip OUTDATED suggestions (stale data from previous audit runs)
      const status = s.getStatus();
      if (status === 'OUTDATED') {
        return;
      }

      const suggestionId = s.getId();

      // Build markdown-based S3 keys for Mystique to consume
      const originalHtmlMarkdownKey = getS3Path(
        data.url,
        scrapeJobId,
        'server-side-html.md',
      );
      const markdownDiffKey = getS3Path(
        data.url,
        scrapeJobId,
        'markdown-diff.md',
      );

      suggestionsPayload.push({
        suggestionId,
        url: data.url,
        originalHtmlMarkdownKey,
        markdownDiffKey,
      });
    });

    if (suggestionsPayload.length === 0) {
      log.info(`Prerender - No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const deliveryType = site?.getDeliveryType?.() || 'unknown';

    const message = {
      type: 'guidance:prerender',
      siteId,
      auditId,
      deliveryType,
      time: new Date().toISOString(),
      data: {
        opportunityId,
        suggestions: suggestionsPayload,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(
      `Prerender - Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${suggestionsPayload.length}`,
    );
    return suggestionsPayload.length;
  /* c8 ignore next 8 - Error handling for SQS failures when sending to Mystique,
   * difficult to test reliably */
  } catch (error) {
    log.error(
      `Prerender - Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
      + `baseUrl=${auditUrl}, siteId=${siteId}: ${error.message}`,
      error,
    );
    return 0;
  }
}

/**
 * Handles AI-summary-only mode: sends existing suggestions to Mystique without running audit.
 * Called early in step 1 to bypass import/scraping/processing steps.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Result indicating success/failure
 */
export async function handleAiOnlyMode(context) {
  const {
    site, log, dataAccess, data,
  } = context;
  const { Opportunity } = dataAccess;
  const siteId = site.getId();
  const baseUrl = site.getBaseURL();

  // Parse optional params from data field (opportunityId, scrapeJobId)
  let opportunityId = null;
  let scrapeJobId = null;
  if (data) {
    try {
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      opportunityId = parsedData.opportunityId;
      scrapeJobId = parsedData.scrapeJobId;
    } catch (e) {
      // Ignore parse errors - graceful degradation for malformed JSON
    }
  }

  log.info(`${LOG_PREFIX} ai-only: Processing AI summary request for baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunityId || 'latest'}`);

  // Fetch scrapeJobId from status.json if not provided
  if (!scrapeJobId) {
    log.info(`${LOG_PREFIX} ai-only: scrapeJobId not provided, fetching from status.json for baseUrl=${baseUrl}, siteId=${siteId}`);
    scrapeJobId = await fetchLatestScrapeJobId(siteId, context);

    if (!scrapeJobId) {
      const error = 'scrapeJobId not found. Either provide it in data or ensure a prerender audit has run recently.';
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }
  }

  // Find the opportunity
  let opportunity;
  if (opportunityId) {
    opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      const error = `Opportunity not found: ${opportunityId}`;
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }
  } else {
    // Find latest NEW prerender opportunity for this site
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

    if (!opportunity) {
      const error = `No NEW prerender opportunity found for site: ${siteId}`;
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }

    log.info(`${LOG_PREFIX} ai-only: Found latest NEW opportunity: ${opportunity.getId()} for baseUrl=${baseUrl}, siteId=${siteId}`);
  }

  // Verify opportunity belongs to the site
  if (opportunity.getSiteId() !== siteId) {
    const error = `Opportunity ${opportunity.getId()} does not belong to site ${siteId}`;
    log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
    return {
      error,
      status: 'failed',
      fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
      auditResult: { error },
    };
  }

  // Send to Mystique using the existing function
  const auditData = {
    siteId,
    // Fallback to custom audit ID for ai-only mode (for old opportunities without auditId)
    auditId: opportunity.getAuditId() || `prerender-ai-only-${siteId}`,
    scrapeJobId,
  };

  const suggestionCount = await sendPrerenderGuidanceRequestToMystique(
    site.getBaseURL(),
    auditData,
    opportunity,
    context,
  );

  log.info(`${LOG_PREFIX} ai-only: Successfully queued AI summary request for ${suggestionCount} suggestion(s). baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunity.getId()}`);

  return {
    status: 'complete',
    mode: MODE_AI_ONLY,
    opportunityId: opportunity.getId(),
    fullAuditRef: `${MODE_AI_ONLY}/${opportunity.getId()}`,
    auditResult: {
      message: `AI summary generation queued successfully for ${suggestionCount} suggestion(s)`,
      suggestionCount,
    },
  };
}

/**
 * Step 1: Import top pages data OR handle ai-only mode
 * @param {Object} context - Audit context with site and finalUrl
 * @returns {Promise<Object>} - Import job configuration OR ai-summary result
 */
export async function importTopPages(context) {
  const {
    site, finalUrl, data, log,
  } = context;

  // Check for AI-only mode (from command like: audit:prerender mode:ai-only)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 1, skipping import/scraping/processing`);
    return handleAiOnlyMode(context);
  }

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
  };
}

/**
 * Step 2: Submit URLs for scraping OR skip if in ai-only mode
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata OR ai-only result
 */
export async function submitForScraping(context) {
  const {
    site,
    log,
    data,
  } = context;

  // Check for AI-only mode - skip scraping step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const topPagesUrls = await getTopOrganicUrlsFromAhrefs(context);
  const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];

  // Fetch Top Agentic URLs (limited by TOP_AGENTIC_URLS_LIMIT)
  const agenticUrls = await getTopAgenticUrls(site, context);

  const finalUrls = [...new Set([...topPagesUrls, ...agenticUrls, ...includedURLs])];

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
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
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
 * Prepares domain-wide aggregate suggestion data that covers all URLs
 * This is an additional suggestion (n+1) that acts as a superset
 * @param {Array} preRenderSuggestions - Array of individual suggestions
 * @param {string} baseUrl - Base URL of the site
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} Domain-wide suggestion object with key and data
 */
async function prepareDomainWideAggregateSuggestion(
  preRenderSuggestions,
  baseUrl,
  context,
) {
  const { log } = context;

  const auditedUrls = preRenderSuggestions.map((s) => s.url);
  const auditedUrlCount = auditedUrls.length;

  // Sum up contentGainRatio from all suggestions
  const totalContentGainRatio = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.contentGainRatio || 0),
    0,
  );

  // Sum up word counts from all suggestions
  const totalWordCountBefore = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.wordCountBefore || 0),
    0,
  );

  const totalWordCountAfter = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.wordCountAfter || 0),
    0,
  );

  // Sum up AI-readable percentages from all suggestions
  const totalAiReadablePercent = preRenderSuggestions.reduce(
    (sum, s) => {
      const wordCountBefore = s.wordCountBefore || 0;
      const wordCountAfter = s.wordCountAfter || 0;
      const percent = wordCountAfter > 0
        ? Math.round((wordCountBefore / wordCountAfter) * 100)
        : 0;
      return sum + percent;
    },
    0,
  );

  // Create domain-wide path pattern(s) for allowList
  // The allowList in metaconfig expects glob patterns (e.g., "/*")
  const allowedRegexPatterns = ['/*'];

  // This applies to ALL URLs in the domain
  // Note: agenticTraffic is calculated in the UI from fresh CDN logs data
  const domainWideSuggestionData = {
    url: `${baseUrl}/* (All Domain URLs)`,
    contentGainRatio: totalContentGainRatio > 0 ? Number(totalContentGainRatio.toFixed(2)) : 0,
    wordCountBefore: totalWordCountBefore,
    wordCountAfter: totalWordCountAfter,
    aiReadablePercent: totalAiReadablePercent,
    // Domain-wide configuration metadata
    isDomainWide: true,
    allowedRegexPatterns,
    pathPattern: '/*',
  };

  // Use a constant key to ensure only ONE domain-wide suggestion exists per opportunity
  const DOMAIN_WIDE_SUGGESTION_KEY = 'domain-wide-aggregate|prerender';

  log.info(`Prerender - Prepared domain-wide aggregate suggestion for entire domain with allowedRegexPatterns: ${JSON.stringify(allowedRegexPatterns)}. Based on ${auditedUrlCount} audited URL(s).`);

  return {
    key: DOMAIN_WIDE_SUGGESTION_KEY,
    data: domainWideSuggestionData,
  };
}

/**
 * Processes opportunities and suggestions for prerender audit results.
 * Persists suggestions in the database so they can later be enriched
 * with AI guidance from Mystique.
 *
 * @param {string} auditUrl - Audited URL
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<Object>} The created/updated opportunity entity
 */
export async function processOpportunityAndSuggestions(
  auditUrl,
  auditData,
  context,
) {
  const { log } = context;

  const { auditResult } = auditData;
  const { urlsNeedingPrerender } = auditResult;

  /* c8 ignore next 4 */
  if (urlsNeedingPrerender === 0) {
    log.info(`Prerender - No prerender opportunities found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  const preRenderSuggestions = auditResult.results
    .filter((result) => result.needsPrerender);

  /* c8 ignore next 4 */
  if (preRenderSuggestions.length === 0) {
    log.info(`Prerender - No URLs needing prerender found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  log.debug(`Prerender - Generated ${preRenderSuggestions.length} prerender suggestions for baseUrl=${auditUrl}, siteId=${auditData.siteId}`);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    auditData, // Pass auditData as props so createOpportunityData receives it
  );

  // Prepare domain-wide suggestion data first
  const domainWideSuggestion = await prepareDomainWideAggregateSuggestion(
    preRenderSuggestions,
    auditUrl,
    context,
  );

  // Build key function that handles both individual and domain-wide suggestions
  /* c8 ignore next 7 */
  const buildKey = (data) => {
    // Domain-wide suggestion has a special key field
    if (data.key) {
      return data.key;
    }
    // Individual suggestions use URL-based key
    return `${data.url}|${AUDIT_TYPE}`;
  };

  // Helper function to extract only the fields we want in suggestions
  const mapSuggestionData = (suggestion) => ({
    url: suggestion.url,
    contentGainRatio: suggestion.contentGainRatio,
    wordCountBefore: suggestion.wordCountBefore,
    wordCountAfter: suggestion.wordCountAfter,
    // S3 references to stored HTML content for comparison
    originalHtmlKey: getS3Path(
      suggestion.url,
      auditData.scrapeJobId,
      'server-side.html',
    ),
    prerenderedHtmlKey: getS3Path(
      suggestion.url,
      auditData.scrapeJobId,
      'client-side.html',
    ),
  });

  const allSuggestions = [...preRenderSuggestions, domainWideSuggestion];

  await syncSuggestions({
    opportunity,
    newData: allSuggestions,
    context,
    buildKey,
    mapNewSuggestion: (suggestion) => ({
      opportunityId: opportunity.getId(),
      type: Suggestion.TYPES.CONFIG_UPDATE,
      rank: 0,
      data: suggestion.key ? suggestion.data : mapSuggestionData(suggestion),
    }),
    // Custom merge function: handle both types
    mergeDataFunction: (existingData, newDataItem) => {
      // Domain-wide suggestion: replace with new data
      if (newDataItem.key) {
        return { ...newDataItem.data };
      }
      // Individual suggestions: merge with existing
      return {
        ...existingData,
        ...mapSuggestionData(newDataItem),
      };
    },
  });

  log.info(`Prerender - Successfully synced ${allSuggestions.length} suggestions for baseUrl: ${auditUrl}, siteId: ${auditData.siteId}`);

  return opportunity;
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
  const {
    auditResult,
    siteId,
    auditedAt,
    scrapeJobId,
  } = auditData;

  try {
    if (!auditResult) {
      log.warn('Prerender - Missing auditResult, skipping status summary upload');
      return;
    }

    // Extract status information for all pages
    const statusSummary = {
      baseUrl: auditUrl,
      siteId,
      auditType: AUDIT_TYPE,
      scrapeJobId: scrapeJobId || null,
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
 * OR skip if ai-only mode
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities OR ai-only result
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, scrapeResultPaths, data,
  } = context;

  // Check for AI-only mode - skip processing step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 3, skipping processing (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();

  log.info(`Prerender - Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

  try {
    let urlsToCheck = [];
    /* c8 ignore next */
    let agenticUrls = [];

    // Try to get URLs from the audit context first
    if (scrapeResultPaths?.size > 0) {
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      log.info(`Prerender - Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      /* c8 ignore start */
      // Fetch agentic URLs only for URL list fallback
      try {
        agenticUrls = await getTopAgenticUrls(site, context);
      } catch (e) {
        log.warn(`Prerender - Failed to fetch agentic URLs for fallback: ${e.message}. baseUrl=${site.getBaseURL()}`);
      }

      // Load top organic pages cache for fallback merging
      const topPagesUrls = await getTopOrganicUrlsFromAhrefs(context);

      const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];
      const merged = [...agenticUrls, ...topPagesUrls];
      urlsToCheck = [...new Set([...merged, ...includedURLs])];
      /* c8 ignore stop */
      const msg = `Prerender - Fallback for baseUrl=${site.getBaseURL()}, siteId=${siteId}. `
        + `Using agenticURLs=${agenticUrls.length}, `
        + `topPages=${topPagesUrls.length}, `
        + `includedURLs=${includedURLs.length}, `
        + `total=${urlsToCheck.length}`;
      log.info(msg);
    }

    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      log.info(`Prerender - No URLs found for comparison. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
    }

    const comparisonResults = await Promise.all(
      urlsToCheck.map(async (url) => {
        const result = await compareHtmlContent(url, context);
        return {
          ...result,
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

    const { auditContext } = context;
    const { scrapeJobId } = auditContext;

    let opportunityForGuidance = null;

    if (urlsNeedingPrerender.length > 0) {
      opportunityForGuidance = await processOpportunityAndSuggestions(
        site.getBaseURL(),
        {
          siteId,
          auditId: audit.getId(),
          auditResult,
          scrapeJobId,
        },
        context,
      );
      /* c8 ignore next 12 */
    } else if (scrapeForbidden) {
      // Create a dummy opportunity when scraping is forbidden (403)
      // This allows the UI to display proper messaging without suggestions
      await createScrapeForbiddenOpportunity(site.getBaseURL(), {
        siteId,
        auditId: audit.getId(),
        auditResult,
        scrapeJobId,
      }, context);
    } else {
      log.info(`Prerender - No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}`);
    }

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`Prerender - Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
    };

    // After syncing suggestions, send a minimal guidance request to Mystique.
    if (opportunityForGuidance) {
      await sendPrerenderGuidanceRequestToMystique(
        site.getBaseURL(),
        auditData,
        opportunityForGuidance,
        context,
      );
    }

    // Upload status summary to S3 (post-processing)
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
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
