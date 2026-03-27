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
import { subDays } from 'date-fns';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import { isPaidLLMOCustomer, mergeAndGetUniqueHtmlUrls } from './utils/utils.js';
import * as prerenderShared from './utils/shared.js';
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  MODE_AI_ONLY,
} from './utils/constants.js';

const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_ERROR_MESSAGE = 'Audit failed';

function logWithAuditPrefix(log, level, message, error) {
  const method = log?.[level];
  if (typeof method !== 'function') {
    return;
  }

  const prefixedMessage = `[${AUDIT_TYPE}] ${message}`;
  if (error) {
    method(prefixedMessage, error);
  } else {
    method(prefixedMessage);
  }
}

// Domain-wide suggestion URL format (sync scrapedUrlsSet + prepareDomainWideAggregateSuggestion)
const getDomainWideSuggestionUrl = (baseUrl) => `${baseUrl}/* (All Domain URLs)`;

const DOMAIN_WIDE_SUGGESTION_KEY = 'domain-wide-aggregate|prerender';

/**
 * Checks if a suggestion's data represents a domain-wide suggestion.
 * @param {Object} data - The suggestion data object.
 * @returns {boolean} True if this is a domain-wide suggestion.
 */
function isDomainWideSuggestionData(data) {
  return !!data?.isDomainWide;
}

/**
 * Checks if a domain-wide suggestion should be preserved (not replaced).
 * A suggestion should be preserved if it's in an active state or has been deployed.
 * @param {Object} suggestion - The suggestion object.
 * @returns {boolean} True if the suggestion should be preserved.
 */
function shouldPreserveDomainWideSuggestion(suggestion) {
  const status = suggestion.getStatus();
  const data = suggestion.getData();

  const ACTIVE_STATUSES = [
    Suggestion.STATUSES.NEW,
    Suggestion.STATUSES.FIXED,
    Suggestion.STATUSES.PENDING_VALIDATION,
    Suggestion.STATUSES.SKIPPED,
  ];

  return ACTIVE_STATUSES.includes(status) || !!data?.edgeDeployed;
}

/**
 * Checks if the domain-wide suggestion (isDomainWide=true) has edgeDeployed set.
 * @param {Object} opportunity - The opportunity object
 * @returns {Promise<boolean>}
 */
async function isAllDomainDeployedAtEdge(opportunity) {
  if (!opportunity || typeof opportunity.getSuggestions !== 'function') return false;
  const suggestions = await opportunity.getSuggestions();
  const domainWide = suggestions.find((s) => {
    const d = s.getData();
    return s.getStatus() !== Suggestion.STATUSES.OUTDATED
      && isDomainWideSuggestionData(d) && !!d?.edgeDeployed;
  });
  return !!domainWide;
}

/**
 * When all domain is deployed at edge, move suggestions with status=NEW to SKIPPED.
 * @param {Object} opportunity - The opportunity object
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<void>}
 */
async function moveNewSuggestionsToSkipped(opportunity, context) {
  const { dataAccess, log, site } = context;
  const SuggestionDA = dataAccess?.Suggestion;

  const baseUrl = site?.getBaseURL?.() || '';
  const siteId = site?.getId?.() || '';

  if (!SuggestionDA?.allByOpportunityIdAndStatus || !SuggestionDA?.bulkUpdateStatus) {
    return;
  }

  const newSuggestions = await SuggestionDA.allByOpportunityIdAndStatus(
    opportunity.getId(),
    Suggestion.STATUSES.NEW,
  );

  if (newSuggestions.length === 0) {
    logWithAuditPrefix(log, 'info', `moveNewSuggestionsToSkipped: no NEW suggestions found. baseUrl=${baseUrl}, siteId=${siteId}`);
    return;
  }
  logWithAuditPrefix(log, 'info', `All domain deployed: moving ${newSuggestions.length} NEW suggestions to SKIPPED. baseUrl=${baseUrl}, siteId=${siteId}`);
  await SuggestionDA.bulkUpdateStatus(newSuggestions, Suggestion.STATUSES.SKIPPED);
}

/**
 * Moves suggestions with status=NEW to SKIPPED when domain-wide suggestion has edgeDeployed.
 * @param {Object|null} opportunity - The opportunity object (no-op if null)
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<void>}
 */
async function skipNewSuggestionsWhenDeployed(opportunity, context) {
  const { log, site } = context;
  const baseUrl = site?.getBaseURL?.() || '';
  const isDeployed = await isAllDomainDeployedAtEdge(opportunity);
  logWithAuditPrefix(log, 'info', `skipNewSuggestionsWhenDeployed: isAllDomainDeployedAtEdge=${isDeployed}, baseUrl=${baseUrl}`);
  if (!isDeployed) return;
  await moveNewSuggestionsToSkipped(opportunity, context);
}

/**
 * Finds an existing domain-wide suggestion that should be preserved.
 * @param {Object} opportunity - The opportunity object.
 * @param {Object} log - Logger instance.
 * @returns {Promise<Object|null>} The existing suggestion to preserve, or null if none found.
 */
async function findPreservableDomainWideSuggestion(opportunity, log) {
  const existingSuggestions = await opportunity.getSuggestions();
  const domainWideSuggestions = existingSuggestions.filter(
    (s) => isDomainWideSuggestionData(s.getData()),
  );

  if (domainWideSuggestions.length === 0) {
    return null;
  }

  const preservable = domainWideSuggestions.find(shouldPreserveDomainWideSuggestion);

  if (preservable) {
    const status = preservable.getStatus();
    const data = preservable.getData();
    logWithAuditPrefix(log, 'info', `Found existing domain-wide suggestion to preserve: status=${status}, edgeDeployed=${data?.edgeDeployed}`);
  }

  return preservable || null;
}

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
    logWithAuditPrefix(log, 'warn', `Failed to load top pages for fallback: ${error.message}. baseUrl=${site.getBaseURL()}`);
  }
  return topPagesUrls;
}

/**
 * Fetch top Agentic URLs from Athena.
 * @param {any} site
 * @param {any} context
 * @param {number} limit
 * @returns {Promise<Array<string>>}
 */
async function getTopAgenticUrls(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  const athenaUrls = await getTopAgenticUrlsFromAthena(site, context, limit);
  if (athenaUrls.length > 0) {
    return athenaUrls;
  }

  const { log } = context;
  const overrideBaseUrl = site.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL;
  const effectiveBaseUrl = overrideBaseUrl || site.getBaseURL?.() || '';

  try {
    const sheetContext = {
      ...context,
      finalUrl: effectiveBaseUrl,
    };
    const { rows } = await prerenderShared.loadLatestAgenticSheet(site, sheetContext);
    const hitsMap = prerenderShared.buildSheetHitsMap(rows);

    const sheetUrls = [...hitsMap.entries()]
      .filter(([path]) => typeof path === 'string' && path.length > 0)
      // Ignore sheet bucket labels like "Other" that are not URL paths.
      .filter(([path]) => path.startsWith('/') || /^https?:\/\//.test(path))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([path]) => {
        if (/^https?:\/\//.test(path)) {
          return path;
        }
        try {
          return new URL(path, effectiveBaseUrl).toString();
        } catch {
          return path;
        }
      });

    logWithAuditPrefix(log, 'info', `Selected ${sheetUrls.length} top agentic URLs via sheet fallback. baseUrl=${effectiveBaseUrl || site.getBaseURL?.() || ''}`);
    return sheetUrls;
  } catch (e) {
    logWithAuditPrefix(log, 'warn', `Sheet-based agentic URL fetch failed: ${e?.message || e}. baseUrl=${effectiveBaseUrl || site.getBaseURL?.() || ''}`);
    return [];
  }
}

/**
 * Returns pathnames from PageCitability records updated within 7 days.
 * @param {Object} context
 * @param {string} siteId
 * @returns {Promise<Set<string>>}
 */
async function getRecentlyProcessedPathnames(context, siteId) {
  const { dataAccess, log } = context;
  try {
    const { PageCitability } = dataAccess;
    if (!PageCitability?.allBySiteId) {
      return new Set();
    }
    const records = await PageCitability.allBySiteId(siteId);
    const sevenDaysAgo = subDays(new Date(), 7);
    return new Set(
      records
        .filter((r) => new Date(r.getUpdatedAt?.() || 0) > sevenDaysAgo)
        .map((r) => {
          try {
            return new URL(r.getUrl()).pathname;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
  } catch (e) {
    logWithAuditPrefix(log, 'warn', `Failed to load recently-processed pathnames: ${e.message}`);
    return new Set();
  }
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
    const { scrapeJobId: storageId } = auditContext || {};
    const serverSideKey = getS3Path(url, storageId, 'server-side.html');
    const clientSideKey = getS3Path(url, storageId, 'client-side.html');
    const scrapeJsonKey = getS3Path(url, storageId, 'scrape.json');

    logWithAuditPrefix(log, 'debug', `Getting scraped content for URL: ${url}`);

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
    logWithAuditPrefix(log, 'warn', `Could not get scraped content for ${url}: ${error.message}`);
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

  logWithAuditPrefix(log, 'debug', `Comparing HTML content for: ${url}`);

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

    logWithAuditPrefix(log, 'debug', `Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

    return {
      url,
      ...analysis,
      hasScrapeMetadata, // Track if scrape.json exists on S3
      scrapeForbidden, // Track if original scrape was forbidden (403)
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge, // From scrape.json (content-scraper PR #784)
      /* c8 ignore next */
      scrapeError: metadata?.error, // Include error details from scrape.json
    };
  } catch (error) {
    logWithAuditPrefix(log, 'error', `HTML analysis failed for ${url}: ${error.message}`);
    return {
      url,
      error: true,
      needsPrerender: false,
      hasScrapeMetadata,
      scrapeForbidden,
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge,
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

    logWithAuditPrefix(log, 'info', `ai-only: Fetching status.json from s3://${bucketName}/${statusKey}`);

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: statusKey,
    }));

    const statusContent = await response.Body.transformToString();
    const statusData = JSON.parse(statusContent);

    if (statusData.scrapeJobId) {
      logWithAuditPrefix(log, 'info', `ai-only: Found scrapeJobId: ${statusData.scrapeJobId}`);
      return statusData.scrapeJobId;
    }

    logWithAuditPrefix(log, 'warn', 'ai-only: No scrapeJobId found in status.json');
    return null;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      logWithAuditPrefix(log, 'warn', `ai-only: status.json not found for siteId=${siteId}`);
    } else {
      logWithAuditPrefix(log, 'error', `ai-only: Error fetching status.json: ${error.message}`);
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
    logWithAuditPrefix(log, 'warn', `SQS or Mystique queue not configured, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }

  if (!opportunity || !opportunity.getId) {
    logWithAuditPrefix(log, 'warn', `Opportunity entity not available, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
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
      logWithAuditPrefix(log, 'warn', `No existing suggestions found for opportunityId=${opportunityId}, skipping Mystique message. baseUrl=${baseUrl}, siteId=${siteId}`);
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
      const isDeployedOrFixed = status === Suggestion.STATUSES.FIXED || !!data?.edgeDeployed;
      if (status === Suggestion.STATUSES.OUTDATED || isDeployedOrFixed) {
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
      logWithAuditPrefix(log, 'info', `No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
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
    logWithAuditPrefix(
      log,
      'info',
      `Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${suggestionsPayload.length}`,
    );
    return suggestionsPayload.length;
  /* c8 ignore next 8 - Error handling for SQS failures when sending to Mystique,
   * difficult to test reliably */
  } catch (error) {
    logWithAuditPrefix(
      log,
      'error',
      `Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
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

  logWithAuditPrefix(log, 'info', `ai-only: Processing AI summary request for baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunityId || 'latest'}`);

  // Fetch scrapeJobId from status.json if not provided
  if (!scrapeJobId) {
    logWithAuditPrefix(log, 'info', `ai-only: scrapeJobId not provided, fetching from status.json for baseUrl=${baseUrl}, siteId=${siteId}`);
    scrapeJobId = await fetchLatestScrapeJobId(siteId, context);

    if (!scrapeJobId) {
      const error = 'scrapeJobId not found. Either provide it in data or ensure a prerender audit has run recently.';
      logWithAuditPrefix(log, 'error', `ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
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
      logWithAuditPrefix(log, 'error', `ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
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
      logWithAuditPrefix(log, 'error', `ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }

    logWithAuditPrefix(log, 'info', `ai-only: Found latest NEW opportunity: ${opportunity.getId()} for baseUrl=${baseUrl}, siteId=${siteId}`);
  }

  // Verify opportunity belongs to the site
  if (opportunity.getSiteId() !== siteId) {
    const error = `Opportunity ${opportunity.getId()} does not belong to site ${siteId}`;
    logWithAuditPrefix(log, 'error', `ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
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

  logWithAuditPrefix(log, 'info', `ai-only: Successfully queued AI summary request for ${suggestionCount} suggestion(s). baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunity.getId()}`);

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
    logWithAuditPrefix(log, 'info', 'Detected ai-only mode in step 1, skipping import/scraping/processing');
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
    logWithAuditPrefix(log, 'info', 'Detected ai-only mode in step 2, skipping scraping (already handled in step 1)');
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();

  const topPagesUrls = await getTopOrganicUrlsFromAhrefs(context);
  let agenticUrls = [];
  try {
    agenticUrls = await getTopAgenticUrls(site, context);
  } catch (e) {
    logWithAuditPrefix(log, 'warn', `Failed to fetch agentic URLs: ${e.message}. baseUrl=${site.getBaseURL()}`);
  }

  const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];

  // Daily batching: filter URLs recently processed within the last 7 days
  const recentPathnames = await getRecentlyProcessedPathnames(context, siteId);

  const filteredAgenticUrls = agenticUrls.filter((url) => {
    try {
      return !recentPathnames.has(new URL(url).pathname);
    } catch {
      return true;
    }
  });

  // Include organic URLs only when none were recently processed (first batch of the weekly cycle)
  const hasRecentOrganic = topPagesUrls.some((url) => {
    try {
      return recentPathnames.has(new URL(url).pathname);
    } catch {
      return false;
    }
  });
  const batchedOrganicUrls = hasRecentOrganic
    ? []
    : topPagesUrls.slice(0, TOP_ORGANIC_URLS_LIMIT);

  // includedURLs are only submitted on the first run of each weekly cycle (no recently processed
  // organic URLs means we're at the start of the cycle). On daily follow-up runs they are skipped.
  const isFirstRunOfCycle = !hasRecentOrganic;
  const batchedIncludedURLs = isFirstRunOfCycle ? includedURLs : [];

  // Cap combined organic + agentic batch to DAILY_BATCH_SIZE (includedURLs added outside the cap)
  const remainingSlots = Math.max(DAILY_BATCH_SIZE - batchedOrganicUrls.length, 0);
  const batchedAgenticUrls = filteredAgenticUrls.slice(0, remainingSlots);
  const batchedUrls = [...batchedOrganicUrls, ...batchedAgenticUrls];

  // Merge URLs ensuring uniqueness while handling www vs non-www differences
  // Also filters out non-HTML URLs (PDFs, images, etc.) in a single pass
  const { urls: finalUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
    batchedUrls,
    batchedIncludedURLs,
  );

  const currentAgentic = batchedAgenticUrls.length;
  const currentOrganic = batchedOrganicUrls.length;
  const currentIncludedUrls = batchedIncludedURLs.length;
  const currentTotal = finalUrls.length;

  logWithAuditPrefix(log, 'info', `
    prerender_submit_scraping_metrics:
    submittedUrls=${finalUrls.length},
    agenticUrls=${agenticUrls.length},
    topPagesUrls=${topPagesUrls.length},
    includedURLs=${includedURLs.length},
    filteredOutUrls=${filteredCount},
    currentTotal=${currentTotal},
    currentAgentic=${currentAgentic},
    currentOrganic=${currentOrganic},
    currentIncludedUrls=${currentIncludedUrls},
    isFirstRunOfCycle=${isFirstRunOfCycle},
    agenticNewThisCycle=${filteredAgenticUrls.length},
    baseUrl=${site.getBaseURL()},
    siteId=${siteId},`);

  logWithAuditPrefix(log, 'info', `prerender_url_details: siteId=${siteId}, organicUrls=[${batchedOrganicUrls.join(', ')}], agenticUrls=[${batchedAgenticUrls.join(', ')}], includedURLs=[${batchedIncludedURLs.join(', ')}], recentPathnames(${recentPathnames.size})=[${[...recentPathnames].join(', ')}], finalUrls=[${finalUrls.join(', ')}]`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = site.getBaseURL();
    logWithAuditPrefix(log, 'info', `No URLs found, falling back to baseUrl=${baseURL}, siteId=${site.getId()}`);
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
 * @param {boolean} isPaid - Whether the customer is a paid LLMO customer
 * @returns {Promise<void>}
 */
export async function createScrapeForbiddenOpportunity(auditUrl, auditData, context, isPaid) {
  const { log } = context;

  logWithAuditPrefix(log, 'info', `Creating dummy opportunity for forbidden scraping. baseUrl=${auditUrl}, siteId=${auditData.siteId}, isPaidLLMOCustomer=${isPaid}`);

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
    url: getDomainWideSuggestionUrl(baseUrl),
    contentGainRatio: totalContentGainRatio > 0 ? Number(totalContentGainRatio.toFixed(2)) : 0,
    wordCountBefore: totalWordCountBefore,
    wordCountAfter: totalWordCountAfter,
    aiReadablePercent: totalAiReadablePercent,
    // Domain-wide configuration metadata
    isDomainWide: true,
    allowedRegexPatterns,
    pathPattern: '/*',
  };

  logWithAuditPrefix(log, 'info', `Prepared domain-wide aggregate suggestion for entire domain with allowedRegexPatterns: ${JSON.stringify(allowedRegexPatterns)}. Based on ${auditedUrlCount} audited URL(s).`);

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
 * @param {boolean} isPaid - Whether the customer is a paid LLMO customer
 * @returns {Promise<Object>} The created/updated opportunity entity
 */
export async function processOpportunityAndSuggestions(
  auditUrl,
  auditData,
  context,
  isPaid,
) {
  const { log } = context;

  const { auditResult, scrapedUrlsSet } = auditData;
  const { urlsNeedingPrerender } = auditResult;

  /* c8 ignore next 4 */
  if (urlsNeedingPrerender === 0) {
    logWithAuditPrefix(log, 'info', `No prerender opportunities found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  const preRenderSuggestions = auditResult.results
    .filter((result) => result.needsPrerender);

  /* c8 ignore next 4 */
  if (preRenderSuggestions.length === 0) {
    logWithAuditPrefix(log, 'info', `No URLs needing prerender found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  logWithAuditPrefix(log, 'debug', `Generated ${preRenderSuggestions.length} prerender suggestions for baseUrl=${auditUrl}, siteId=${auditData.siteId}`);

  const opportunity = await convertToOpportunity(
    auditUrl,
    auditData,
    context,
    createOpportunityData,
    AUDIT_TYPE,
    auditData, // Pass auditData as props so createOpportunityData receives it
  );

  const existingPreservable = await findPreservableDomainWideSuggestion(opportunity, log);

  let domainWideSuggestion = null;
  if (existingPreservable) {
    logWithAuditPrefix(log, 'info', `Skipping domain-wide suggestion creation - existing one will be preserved. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
  } else {
    domainWideSuggestion = await prepareDomainWideAggregateSuggestion(
      preRenderSuggestions,
      auditUrl,
      context,
    );
  }

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

  const allSuggestions = domainWideSuggestion
    ? [...preRenderSuggestions, domainWideSuggestion]
    : [...preRenderSuggestions];

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
    scrapedUrlsSet,
    // Custom merge function: handle both types
    mergeDataFunction: (existingData, newDataItem) => {
      // Domain-wide suggestion: replace with new data
      if (newDataItem.key) {
        return { ...newDataItem.data };
      }
      /* c8 ignore next 5 - Individual suggestion merge logic, difficult to test in isolation */
      // Individual suggestions: merge with existing
      return {
        ...existingData,
        ...mapSuggestionData(newDataItem),
      };
    },
  });

  logWithAuditPrefix(log, 'info', `
    prerender_suggestions_sync_metrics:
    siteId=${auditData.siteId},
    baseUrl=${auditUrl},
    isPaidLLMOCustomer=${isPaid},
    suggestions=${preRenderSuggestions.length},
    totalSuggestions=${allSuggestions.length},`);

  return opportunity;
}

/**
 * Writes citability metrics to the PageCitability entity for all successfully scraped URLs.
 * This enables the page-citability audit to detect recently-processed URLs via its 7-day
 * staleness filter, avoiding duplicate scraping across both audits.
 *
 * @param {Array} comparisonResults - Results from compareHtmlContent (all scraped URLs)
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<void>}
 */
export async function writeToCitabilityRecords(comparisonResults, siteId, context) {
  const { dataAccess, log } = context;
  const { PageCitability } = dataAccess;

  if (!PageCitability?.allBySiteId) {
    logWithAuditPrefix(log, 'debug', 'PageCitability not available, skipping citability record writes');
    return;
  }

  const existingRecords = await PageCitability.allBySiteId(siteId);
  const existingRecordsMap = new Map(existingRecords.map((r) => [r.getUrl(), r]));

  const successful = comparisonResults.filter((r) => !r.error);
  const WRITE_BATCH_SIZE = 10;

  const writeOne = async (result) => {
    const {
      url,
      citabilityScore,
      contentGainRatio,
      wordDifference,
      wordCountBefore,
      wordCountAfter,
      isDeployedAtEdge,
    } = result;
    try {
      const existing = existingRecordsMap.get(url);
      if (existing) {
        existing.setCitabilityScore(citabilityScore ?? null);
        existing.setContentRatio(contentGainRatio ?? null);
        existing.setWordDifference(wordDifference ?? null);
        existing.setBotWords(wordCountBefore ?? null);
        existing.setNormalWords(wordCountAfter ?? null);
        existing.setIsDeployedAtEdge(isDeployedAtEdge ?? false);
        await existing.save();
      } else {
        await PageCitability.create({
          siteId,
          url,
          citabilityScore: citabilityScore ?? null,
          contentRatio: contentGainRatio ?? null,
          wordDifference: wordDifference ?? null,
          botWords: wordCountBefore ?? null,
          normalWords: wordCountAfter ?? null,
          isDeployedAtEdge: isDeployedAtEdge ?? false,
        });
      }
      return true;
    } catch (e) {
      logWithAuditPrefix(log, 'warn', `Failed to write PageCitability for ${url}: ${e.message}`);
      return false;
    }
  };

  let written = 0;
  for (let i = 0; i < successful.length; i += WRITE_BATCH_SIZE) {
    const batch = successful.slice(i, i + WRITE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map(writeOne));
    written += results.filter(Boolean).length;
  }

  logWithAuditPrefix(log, 'info', `Wrote PageCitability records: ${written}/${successful.length}`);
}

/**
 * Post processor to upload a status JSON file to S3 after audit completion
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data with results
 * @param {Object} context - Processing context
 * @returns {Promise<void>}
 */
export async function uploadStatusSummaryToS3(auditUrl, auditData, context) {
  const {
    log, s3Client, env, dataAccess,
  } = context;
  const {
    auditResult,
    siteId,
    auditedAt,
    scrapeJobId,
  } = auditData;

  try {
    if (!auditResult) {
      logWithAuditPrefix(log, 'warn', 'Missing auditResult, skipping status summary upload');
      return;
    }

    const scrapedAt = auditedAt || new Date().toISOString();
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;

    const currentPages = (auditResult.results ?? []).map((result) => ({
      url: result.url,
      scrapingStatus: result.error ? 'error' : 'success',
      needsPrerender: result.needsPrerender || false,
      isDeployedAtEdge: !!result.isDeployedAtEdge,
      wordCountBefore: result.wordCountBefore || 0,
      wordCountAfter: result.wordCountAfter || 0,
      contentGainRatio: result.contentGainRatio || 0,
      scrapedAt,
      ...(result.scrapeError && { scrapeError: result.scrapeError }),
    }));

    // Append URLs that were submitted to the scraper but produced no S3 result files.
    // For each, try to read their scrape.json to surface the error stored during scraping.
    if (scrapeJobId && dataAccess?.ScrapeUrl) {
      try {
        const allScrapeUrls = await dataAccess.ScrapeUrl.allByScrapeJobId(scrapeJobId);
        const auditResultUrlSet = new Set(currentPages.map((p) => p.url));

        const missingPages = await Promise.all(
          allScrapeUrls
            .filter((su) => !auditResultUrlSet.has(su.getUrl()))
            .map(async (su) => {
              const url = su.getUrl();
              const scrapeJsonKey = getS3Path(url, scrapeJobId, 'scrape.json');
              const metadata = await getObjectFromKey(s3Client, bucketName, scrapeJsonKey, log)
                .catch(() => null);
              return {
                url,
                scrapingStatus: 'failed',
                needsPrerender: false,
                scrapedAt,
                ...(metadata?.error && { scrapeError: metadata.error }),
              };
            }),
        );
        currentPages.push(...missingPages);
      } catch (e) {
        logWithAuditPrefix(log, 'warn', `Failed to append missing scrape URLs to status.json for scrapeJobId=${scrapeJobId}: ${e.message}`);
      }
    }

    // Read existing status.json and merge pages so previous runs are not lost.
    // Pages from the current run overwrite any prior entry for the same URL.
    let existingPages = [];
    try {
      const existing = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: statusKey,
      }));
      const existingData = JSON.parse(await existing.Body.transformToString());
      existingPages = Array.isArray(existingData.pages) ? existingData.pages : [];
    } catch (e) {
      if (e.name !== 'NoSuchKey') {
        logWithAuditPrefix(log, 'warn', `Could not read existing status.json for merge, starting fresh: ${e.message}`);
      }
    }

    const currentUrlSet = new Set(currentPages.map((p) => p.url));
    const mergedPages = [
      ...currentPages,
      ...existingPages.filter((p) => !currentUrlSet.has(p.url)),
    ];

    // Derive aggregate metrics from the full merged page set
    const totalUrlsChecked = mergedPages.length;
    const urlsNeedingPrerender = mergedPages.filter((p) => p.needsPrerender).length;
    const urlsScrapedSuccessfully = mergedPages.filter((p) => p.scrapingStatus === 'success').length;
    const urlsSubmittedForScraping = mergedPages
      .filter((p) => p.scrapingStatus !== undefined).length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? ((urlsSubmittedForScraping - urlsScrapedSuccessfully) / urlsSubmittedForScraping) * 100
      : null;
    const scrapeForbiddenCount = mergedPages.filter(
      (p) => p.scrapeError?.statusCode === 403,
    ).length;

    // Extract status information for all pages
    const statusSummary = {
      baseUrl: auditUrl,
      siteId,
      auditType: AUDIT_TYPE,
      scrapeJobId: scrapeJobId || null,
      lastUpdated: scrapedAt,
      totalUrlsChecked,
      urlsNeedingPrerender,
      urlsSubmittedForScraping,
      urlsScrapedSuccessfully,
      scrapingErrorRate,
      scrapeForbidden: scrapeForbiddenCount > 0,
      scrapeForbiddenCount,
      lastAuditSuccess: auditResult.lastAuditSuccess !== false,
      pages: mergedPages,
    };
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: statusKey,
      Body: JSON.stringify(statusSummary, null, 2),
      ContentType: 'application/json',
    }));

    const { pages: _, ...logSummary } = statusSummary;
    const logFields = Object.entries(logSummary).map(([k, v]) => `${k}=${v}`).join(', ');
    logWithAuditPrefix(log, 'info', `prerender_status_upload: statusKey=${statusKey}, pagesCount=${statusSummary.pages.length}, ${logFields}`);
  } catch (error) {
    logWithAuditPrefix(log, 'error', `Failed to upload status summary to S3: ${error.message}. baseUrl=${auditUrl}, siteId=${siteId}`, error);
    // Don't throw - this is a non-critical post-processing step
  }
}

/**
 * Fetches submitted URL count from ScrapeUrl table when scrape job exists.
 * scrapeResultPaths only contains COMPLETE URLs, so urlsToCheck undercounts when some URLs failed.
 * @param {string|null} scrapeJobId - Scrape job ID
 * @param {number} urlsToCheckLength - Fallback count (from scrapeResultPaths or fallback list)
 * @param {Object} dataAccess - Data access with ScrapeUrl
 * @param {Object} log - Logger
 * @returns {Promise<number>} - Submitted URL count
 */
async function getUrlsSubmittedForScrapingCount(scrapeJobId, urlsToCheckLength, dataAccess, log) {
  if (!scrapeJobId || !dataAccess?.ScrapeUrl) return urlsToCheckLength;
  try {
    const allScrapeUrls = await dataAccess.ScrapeUrl.allByScrapeJobId(scrapeJobId);
    logWithAuditPrefix(log, 'debug', `urlsSubmittedForScraping=${allScrapeUrls.length} from ScrapeUrl (scrapeJobId=${scrapeJobId}), urlsToCheck=${urlsToCheckLength}`);
    return allScrapeUrls.length;
  } catch (e) {
    logWithAuditPrefix(log, 'warn', `Failed to fetch ScrapeUrl count for scrapeJobId=${scrapeJobId}, using urlsToCheck.length: ${e.message}`);
    return urlsToCheckLength;
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
    site, audit, log, scrapeResultPaths, data, dataAccess,
  } = context;

  // Check for AI-only mode - skip processing step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    logWithAuditPrefix(log, 'info', 'Detected ai-only mode in step 3, skipping processing (already handled in step 1)');
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();

  // Check if this is a paid LLMO customer early so we can use it in all logs
  const isPaid = await isPaidLLMOCustomer(context);

  logWithAuditPrefix(log, 'info', `Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}`);

  try {
    let urlsToCheck = [];
    /* c8 ignore next */
    let agenticUrls = [];

    // Try to get URLs from the audit context first
    if (scrapeResultPaths?.size > 0) {
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      logWithAuditPrefix(log, 'info', `Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      /* c8 ignore start */
      // Fetch agentic URLs only for URL list fallback
      try {
        agenticUrls = await getTopAgenticUrls(site, context);
      } catch (e) {
        logWithAuditPrefix(log, 'warn', `Failed to fetch agentic URLs for fallback: ${e.message}. baseUrl=${site.getBaseURL()}`);
      }

      // Load top organic pages cache for fallback merging
      const topPagesUrls = await getTopOrganicUrlsFromAhrefs(context);

      const includedURLs = await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE) || [];
      // Use the same normalization and filtering logic for consistency
      const { urls: filteredUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
        topPagesUrls,
        agenticUrls,
        includedURLs,
      );
      urlsToCheck = filteredUrls;

      /* c8 ignore stop */
      const msg = `Fallback for baseUrl=${site.getBaseURL()}, siteId=${siteId}. `
        + `Using agenticURLs=${agenticUrls.length}, `
        + `topPages=${topPagesUrls.length}, `
        + `includedURLs=${includedURLs.length}, `
        + `filteredOutUrls=${filteredCount}, `
        + `total=${urlsToCheck.length}`;
      logWithAuditPrefix(log, 'info', msg);
    }

    /* c8 ignore next 5 - Edge case: empty URLs fallback, difficult to reach in tests */
    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [site.getBaseURL()];
      logWithAuditPrefix(log, 'info', `No URLs found for comparison. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
    }

    const comparisonResults = await Promise.all(
      urlsToCheck.map((url) => compareHtmlContent(url, context)),
    );

    // Phase 2c: write citability metrics to PageCitability entity.
    await writeToCitabilityRecords(comparisonResults, siteId, context);

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    logWithAuditPrefix(log, 'info', `Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped. isPaidLLMOCustomer=${isPaid}`);

    // Check if all scrape.json files on S3 have statusCode=403
    const urlsWithScrapeJson = comparisonResults.filter((result) => result.hasScrapeMetadata);
    const urlsWithForbiddenScrape = urlsWithScrapeJson.filter((result) => result.scrapeForbidden);
    const scrapeForbiddenCount = urlsWithForbiddenScrape.length;
    const scrapeForbidden = urlsWithScrapeJson.length > 0
      && scrapeForbiddenCount === urlsWithScrapeJson.length;

    logWithAuditPrefix(log, 'info', `Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}. scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${comparisonResults.length}, urlsWithScrapeJson=${urlsWithScrapeJson.length}, isPaidLLMOCustomer=${isPaid}`);

    // Remove internal tracking fields from results before storing
    // eslint-disable-next-line
    const cleanResults = comparisonResults.map(({ hasScrapeMetadata, scrapeForbidden, ...result }) => result);

    const urlsNotNeedingPrerender = successfulComparisons.length - urlsNeedingPrerender.length;

    const { auditContext } = context;
    const { scrapeJobId } = auditContext || {};
    const urlsSubmittedForScraping = await getUrlsSubmittedForScrapingCount(
      scrapeJobId,
      urlsToCheck.length,
      dataAccess,
      log,
    );
    // Scraping error rate: % of submitted URLs that failed (base = urlsSubmittedForScraping)
    const failedCount = urlsSubmittedForScraping - successfulComparisons.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? Math.round((failedCount / urlsSubmittedForScraping) * 100)
      : 0;

    // Exclude deployed URLs — don't mark their suggestions outdated regardless of needsPrerender.
    // isDeployedAtEdge=true means prerender is already active at CDN level (via RCV, LLMO
    // side-effect, or domain-wide deployment); no authoritative "resolved" judgment applies.
    const scrapedUrlsSet = new Set(
      successfulComparisons
        .filter((r) => !r.isDeployedAtEdge)
        .map((r) => r.url),
    );

    // Extend scrapedUrlsSet with URLs updated in PageCitability within the last 7 days.
    const { PageCitability } = dataAccess;
    if (PageCitability?.allBySiteId) {
      const citabilityRecords = await PageCitability.allBySiteId(siteId);
      const sevenDaysAgo = subDays(new Date(), 7);
      for (const record of citabilityRecords) {
        if (new Date(record.getUpdatedAt()) > sevenDaysAgo) {
          scrapedUrlsSet.add(record.getUrl());
        }
      }
    }

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      urlsScrapedSuccessfully: successfulComparisons.length,
      urlsSubmittedForScraping,
      urlsNotNeedingPrerender,
      scrapingErrorRate,
      results: cleanResults,
      scrapeForbidden,
      scrapeForbiddenCount,
      lastAuditSuccess: true,
    };

    logWithAuditPrefix(log, 'info', `Scraping metrics for baseUrl=${site.getBaseURL()}, siteId=${siteId}. urlsSubmittedForScraping=${urlsSubmittedForScraping}, urlsScrapedSuccessfully=${successfulComparisons.length}, scrapeForbiddenCount=${scrapeForbiddenCount}, scrapingErrorRate=${scrapingErrorRate}%`);

    let opportunityWithSuggestions = null;

    /* c8 ignore next 13 - Opportunity processing branch, covered by integration tests */
    if (urlsNeedingPrerender.length > 0) {
      const opportunity = await processOpportunityAndSuggestions(
        site.getBaseURL(),
        {
          siteId,
          id: audit.getId(),
          auditId: audit.getId(),
          auditResult,
          scrapeJobId,
          scrapedUrlsSet,
        },
        context,
        isPaid,
      );
      opportunityWithSuggestions = opportunity;
      await sendPrerenderGuidanceRequestToMystique(
        site.getBaseURL(),
        { siteId, auditId: audit.getId(), scrapeJobId },
        opportunity,
        context,
      );
      /* c8 ignore next 12 */
    } else if (scrapeForbidden) {
      // Create a dummy opportunity when scraping is forbidden (403)
      // This allows the UI to display proper messaging without suggestions
      await createScrapeForbiddenOpportunity(site.getBaseURL(), {
        siteId,
        id: audit.getId(),
        auditId: audit.getId(),
        auditResult,
        scrapeJobId,
      }, context, isPaid);
    } else {
      logWithAuditPrefix(log, 'info', `No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, isPaidLLMOCustomer=${isPaid}`);

      const { Opportunity } = dataAccess;
      const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
      const existingOpportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

      if (existingOpportunity) {
        // Include domain-wide URL so aggregate suggestion can be marked outdated when appropriate
        const scrapedUrlsForNoOppty = new Set(scrapedUrlsSet);
        scrapedUrlsForNoOppty.add(getDomainWideSuggestionUrl(site.getBaseURL()));
        await syncSuggestions({
          opportunity: existingOpportunity,
          newData: [],
          context,
          buildKey: (suggestionData) => suggestionData.url,
          mapNewSuggestion: () => ({}),
          scrapedUrlsSet: scrapedUrlsForNoOppty,
        });
        opportunityWithSuggestions = existingOpportunity;
      }
    }

    // When domain-wide suggestion has edgeDeployed, move NEW suggestions to SKIPPED
    await skipNewSuggestionsWhenDeployed(opportunityWithSuggestions, context);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    logWithAuditPrefix(log, 'info', `Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
    };

    // Upload status summary to S3 (post-processing)
    await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    logWithAuditPrefix(log, 'error', `Audit failed for baseUrl=${site.getBaseURL()}, siteId=${siteId}: ${error.message}`, error);

    const errorAuditResult = {
      error: AUDIT_ERROR_MESSAGE,
      lastAuditSuccess: false,
      results: [],
    };

    // Upload status.json on error so UI can show audit status via S3 fallback
    const { auditContext } = context;
    await uploadStatusSummaryToS3(site.getBaseURL(), {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult: errorAuditResult,
      scrapeJobId: auditContext?.scrapeJobId,
    }, context);

    return {
      error: AUDIT_ERROR_MESSAGE,
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
