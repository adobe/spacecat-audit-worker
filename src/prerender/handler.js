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
import { getTopAgenticUrlsFromAthena, getPreferredBaseUrl } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import { isPaidLLMOCustomer, mergeAndGetUniqueHtmlUrls } from './utils/utils.js';
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
  MODE_AI_ONLY,
  MYSTIQUE_BATCH_SIZE,
} from './utils/constants.js';

function rebaseUrl(url, preferredBase, log) {
  try {
    const { pathname, search, hash } = new URL(url);
    return new URL(pathname + search + hash, preferredBase).toString();
  } catch (e) {
    log?.warn?.(`rebaseUrl failed url=${url} base=${preferredBase}: ${e.message}`);
    return url;
  }
}

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_ERROR_MESSAGE = 'Audit failed';

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
 * Diagnostic: detects and warns if any non-NEW suggestions have edgeDeployed set.
 * This should never happen — edgeDeployed is set when a URL is deployed at the CDN edge,
 * and the suggestion status should not be changed away from NEW after that point.
 * @param {Object} dataAccess - Data access layer
 * @param {string} siteId - Site ID to look up the opportunity
 * @param {string} auditUrl - Base URL for log context
 * @param {Object} log - Logger
 */
async function detectWrongEdgeDeployedStatus(dataAccess, siteId, auditUrl, log) {
  const opportunities = await dataAccess?.Opportunity?.allBySiteIdAndStatus?.(siteId, 'NEW') ?? [];
  const opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
  if (!opportunity) {
    return;
  }
  const suggestions = await opportunity.getSuggestions?.() ?? [];
  const count = suggestions.filter(
    (s) => s.getStatus() !== Suggestion.STATUSES.NEW && s.getData()?.edgeDeployed,
  ).length;
  if (count > 0) {
    log.warn(`${LOG_PREFIX} Unexpected non-NEW suggestions with edgeDeployed set. baseUrl=${auditUrl}, siteId=${siteId}, nonNewEdgeDeployedCount=${count}`);
  }
}

/**
 * Checks if the domain-wide suggestion (isDomainWide=true) has edgeDeployed set.
 * @param {Object} opportunity - The opportunity object
 * @returns {Promise<boolean>}
 */
async function getDomainWideSuggestionDeployedAtEdge(opportunity) {
  if (!opportunity || typeof opportunity.getSuggestions !== 'function') {
    return null;
  }
  const suggestions = await opportunity.getSuggestions();
  return suggestions.find((s) => {
    const d = s.getData();
    return s.getStatus() !== Suggestion.STATUSES.OUTDATED
      && isDomainWideSuggestionData(d) && !!d?.edgeDeployed;
  }) ?? null;
}

/**
 * Sets coveredByDomainWide on NEW suggestions whose URLs are confirmed deployed at edge,
 * instead of moving them to SKIPPED. This allows rollback to naturally restore them to
 * the Current tab when the backend clears coveredByDomainWide on domain-wide rollback.
 * @param {Object} opportunity - The opportunity object
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Set<string>} deployedAtEdgeUrls - URLs confirmed deployed at edge in this audit
 * @param {string} domainWideSuggestionId - ID of the deployed domain-wide suggestion
 * @returns {Promise<void>}
 */
async function markDeployedUrlSuggestionsAsCovered(
  opportunity,
  context,
  deployedAtEdgeUrls,
  domainWideSuggestionId,
) {
  const { dataAccess, log, site } = context;
  const SuggestionDA = dataAccess?.Suggestion;

  const baseUrl = site?.getBaseURL?.() || '';
  const siteId = site?.getId?.() || '';

  if (!SuggestionDA?.allByOpportunityIdAndStatus || !SuggestionDA?.saveMany) {
    return;
  }

  const newSuggestions = await SuggestionDA.allByOpportunityIdAndStatus(
    opportunity.getId(),
    Suggestion.STATUSES.NEW,
  );

  if (newSuggestions.length === 0) {
    log.info(`${LOG_PREFIX} markDeployedUrlSuggestionsAsCovered: no NEW suggestions found. baseUrl=${baseUrl}, siteId=${siteId}`);
    return;
  }

  const suggestionsToCover = deployedAtEdgeUrls?.size > 0
    ? newSuggestions.filter((s) => {
      const data = s.getData();
      return deployedAtEdgeUrls.has(data?.url) && !data?.edgeDeployed;
    })
    : [];

  if (suggestionsToCover.length === 0) {
    log.info(`${LOG_PREFIX} markDeployedUrlSuggestionsAsCovered: no NEW suggestions matched deployed URLs. baseUrl=${baseUrl}, siteId=${siteId}`);
    return;
  }

  suggestionsToCover.forEach((s) => {
    s.setData({ ...s.getData(), coveredByDomainWide: domainWideSuggestionId });
  });

  log.info(`${LOG_PREFIX} All domain deployed: marking ${suggestionsToCover.length} NEW suggestions as coveredByDomainWide. baseUrl=${baseUrl}, siteId=${siteId}`);
  await SuggestionDA.saveMany(suggestionsToCover);
}

/**
 * Marks NEW suggestions as coveredByDomainWide when the domain-wide suggestion has edgeDeployed,
 * restricting to URLs confirmed deployed at edge in the current audit run.
 * @param {Object|null} opportunity - The opportunity object (no-op if null)
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Set<string>} deployedAtEdgeUrls - URLs confirmed deployed at edge in this audit
 * @returns {Promise<void>}
 */
async function markNewSuggestionsAsCovered(opportunity, context, deployedAtEdgeUrls) {
  const { log, site } = context;
  const baseUrl = site?.getBaseURL?.() || '';
  const domainWideSuggestion = await getDomainWideSuggestionDeployedAtEdge(opportunity);
  log.info(`${LOG_PREFIX} markNewSuggestionsAsCovered: isAllDomainDeployedAtEdge=${!!domainWideSuggestion}, baseUrl=${baseUrl}`);
  if (!domainWideSuggestion) {
    return;
  }
  await markDeployedUrlSuggestionsAsCovered(
    opportunity,
    context,
    deployedAtEdgeUrls,
    domainWideSuggestion.getId(),
  );
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
    log.info(`${LOG_PREFIX} Found existing domain-wide suggestion to preserve: status=${status}, edgeDeployed=${data?.edgeDeployed}`);
  }

  return preservable || null;
}

async function getTopOrganicUrlsFromSeo(context, limit = TOP_ORGANIC_URLS_LIMIT) {
  const { dataAccess, log, site } = context;
  let topPagesUrls = [];
  try {
    const { SiteTopPage } = dataAccess || {};
    if (SiteTopPage?.allBySiteIdAndSourceAndGeo) {
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
      topPagesUrls = (topPages || []).map((p) => p.getUrl()).slice(0, limit);
    }
  } catch (error) {
    log.warn(`${LOG_PREFIX} Failed to load top pages for fallback: ${error.message}. baseUrl=${site.getBaseURL()}`);
  }
  return topPagesUrls;
}

async function getTopAgenticUrls(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  try {
    return await getTopAgenticUrlsFromAthena(site, context, limit);
  } catch (e) {
    context.log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs: ${e.message}. baseUrl=${site.getBaseURL()}`);
    return [];
  }
}

/**
 * Returns pathnames from PageCitability records updated within the configured recent window.
 * @param {Object} context
 * @param {string} siteId
 * @returns {Promise<Set<string>>}
 */
async function getRecentlyProcessedPathnames(context, siteId) {
  const { dataAccess, log } = context;
  try {
    const { PageCitability } = dataAccess;
    if (!PageCitability?.allByIndexKeys) {
      return new Set();
    }
    const recentWindowStart = subDays(new Date(), PRERENDER_RECENT_PROCESSING_TIME_DAYS);
    const records = await PageCitability.allByIndexKeys(
      { siteId },
      { where: (attrs, op) => op.gte(attrs.updatedAt, recentWindowStart.toISOString()) },
    );
    return new Set(
      records
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
    log.warn(`${LOG_PREFIX} Failed to load recently-processed pathnames: ${e.message}`);
    return new Set();
  }
}

/**
 * Returns true when the URL's pathname is NOT in the set of recently processed pathnames.
 * URLs that cannot be parsed are treated as not recent (included by default).
 * @param {string} url
 * @param {Set<string>} recentPathnames
 * @returns {boolean}
 */
function isNotRecentUrl(url, recentPathnames) {
  try {
    return !recentPathnames.has(new URL(url).pathname);
  } catch {
    return true;
  }
}

function normalizePathname(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  } catch {
    return url;
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
async function compareHtmlContent(url, context) {
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
 * @param {Array|null} [preBuiltCandidates] - Pre-built candidate objects for normal audit runs.
 *   Each entry is { suggestionId, url, originalHtmlMarkdownKey, markdownDiffKey }.
 *   When null/omitted, candidates are derived from all DB suggestions (ai-only mode).
 * @returns {Promise<number>} - Number of suggestions sent to Mystique
 */
// eslint-disable-next-line max-len
async function sendPrerenderGuidanceRequestToMystique(auditUrl, auditData, opportunity, context, preBuiltCandidates) {
  const {
    log, sqs, env, site,
  } = context;
  /* c8 ignore start - Defensive checks and destructuring, tested in ai-only mode tests */
  const {
    siteId,
    auditId,
  } = auditData || {};

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }

  if (!opportunity || !opportunity.getId) {
    log.warn(`${LOG_PREFIX} Opportunity entity not available, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }
  /* c8 ignore stop */

  const opportunityId = opportunity.getId();

  try {
    const baseUrl = auditUrl;

    let suggestionsPayload;

    /* c8 ignore next 4 - Normal run path exercised via processContentAndGenerateOpportunities */
    if (preBuiltCandidates) {
      suggestionsPayload = preBuiltCandidates;
    } else {
      // ai-only mode: no URL list available, derive candidates from all DB suggestions.
      const existingSuggestions = await opportunity.getSuggestions();

      if (!existingSuggestions || existingSuggestions.length === 0) {
        log.debug(`${LOG_PREFIX} No existing suggestions found for opportunityId=${opportunityId}, skipping Mystique message. baseUrl=${baseUrl}, siteId=${siteId}`);
        return 0;
      }

      const candidates = [];

      existingSuggestions.forEach((s) => {
        const data = s.getData();

        // Skip domain-wide aggregate suggestion and anything without URL
        if (!data?.url || data?.isDomainWide) {
          return;
        }

        // Skip OUTDATED and SKIPPED suggestions (stale or user-dismissed)
        const status = s.getStatus();
        const isDeployedOrFixed = status === Suggestion.STATUSES.FIXED || !!data?.edgeDeployed;
        if (
          status === Suggestion.STATUSES.OUTDATED
          || status === Suggestion.STATUSES.SKIPPED
          || isDeployedOrFixed
        ) {
          return;
        }

        // Skip suggestions that already have a valid AI summary and are marked as valuable —
        // sending them to Mystique again would be wasteful with no benefit.
        const hasValidAiSummary = data?.aiSummary
          && data.aiSummary.toLowerCase() !== 'not available';
        if (hasValidAiSummary && data?.valuable === true) {
          log.debug(`${LOG_PREFIX} Skipping suggestion for url=${data.url}: already has a valid `
            + `AI summary. baseUrl=${baseUrl}, siteId=${siteId}`);
          return;
        }

        const suggestionId = s.getId();

        // Resolve the scrapeJobId in priority order:
        //   1. data.scrapeJobId — stamped at suggestion-creation time (most reliable)
        //   2. data.originalHtmlKey — extract the job segment from the stored S3 path
        //      (format: prerender/scrapes/{scrapeJobId}/...)
        //   3. Neither available → skip; we cannot build valid S3 keys without a job id
        let effectiveScrapeJobId = data.scrapeJobId;
        if (!effectiveScrapeJobId && data.originalHtmlKey) {
          // prerender/scrapes/{scrapeJobId}/...
          const parts = data.originalHtmlKey.split('/');
          effectiveScrapeJobId = parts[2] || null;
          if (effectiveScrapeJobId) {
            log.debug(`${LOG_PREFIX} Suggestion ${suggestionId} missing scrapeJobId; `
              + `derived from originalHtmlKey: ${effectiveScrapeJobId}. `
              + `baseUrl=${baseUrl}, siteId=${siteId}`);
          }
        }
        if (!effectiveScrapeJobId) {
          log.warn(`${LOG_PREFIX} Suggestion ${suggestionId} skipped: no scrapeJobId and no `
            + `originalHtmlKey to derive one from. baseUrl=${baseUrl}, siteId=${siteId}`);
          return;
        }

        candidates.push({
          suggestionId,
          url: data.url,
          originalHtmlMarkdownKey: getS3Path(data.url, effectiveScrapeJobId, 'server-side-html.md'),
          markdownDiffKey: getS3Path(data.url, effectiveScrapeJobId, 'markdown-diff.md'),
        });
      });

      suggestionsPayload = candidates;
    }

    if (suggestionsPayload.length === 0) {
      log.info(`${LOG_PREFIX} No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const deliveryType = site?.getDeliveryType?.() || 'unknown';

    // SQS has a 256 KB message size limit. Chunk suggestions into batches to stay safely under it.
    // TODO: send all batches once Mystique multi-batch handling is fully deployed.
    const firstBatch = suggestionsPayload.slice(0, MYSTIQUE_BATCH_SIZE);

    const time = new Date().toISOString();
    const queue = env.QUEUE_SPACECAT_TO_MYSTIQUE;
    await sqs.sendMessage(queue, {
      type: 'guidance:prerender',
      url: baseUrl,
      siteId,
      auditId,
      deliveryType,
      time,
      data: {
        opportunityId,
        suggestions: firstBatch,
        batchIndex: 0,
        totalBatches: 1,
      },
    });

    log.info(`${LOG_PREFIX} Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${firstBatch.length} (capped to 1 batch of ${MYSTIQUE_BATCH_SIZE})`);
    return firstBatch.length;
  /* c8 ignore next 8 - Error handling for SQS failures when sending to Mystique,
   * difficult to test reliably */
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
      + `baseUrl=${auditUrl}, siteId=${siteId}: ${error.message}`, error);
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
    site, finalUrl, data, log, auditContext,
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
    ...(Array.isArray(auditContext?.urls) && auditContext.urls.length > 0
      ? {
        auditContext: {
          urls: auditContext.urls,
        },
      }
      : {}),
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
    auditContext,
  } = context;

  // Check for AI-only mode - skip scraping step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  if (Array.isArray(auditContext?.urls) && auditContext.urls.length > 0) {
    const preferredBase = getPreferredBaseUrl(site, context);
    const rebasedCsvUrls = auditContext.urls.map((url) => rebaseUrl(url, preferredBase, log));
    const { urls: explicitUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(rebasedCsvUrls);

    log.info(`
    ${LOG_PREFIX} prerender_submit_scraping_metrics:
    submittedUrls=${explicitUrls.length},
    agenticUrls=0,
    topPagesUrls=0,
    includedURLs=0,
    filteredOutUrls=${filteredCount},
    baseUrl=${site.getBaseURL()},
    siteId=${siteId},
    csvUrls=${auditContext.urls.length},`);

    return {
      urls: explicitUrls.map((url) => ({ url })),
      siteId,
      processingType: AUDIT_TYPE,
      maxScrapeAge: 0,
      options: {
        pageLoadTimeout: 20000,
        storagePrefix: AUDIT_TYPE,
      },
    };
  }

  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  const preferredBase = getPreferredBaseUrl(site, context);
  const rebasedTopPagesUrls = topPagesUrls.map((url) => rebaseUrl(url, preferredBase, log));
  const rebasedIncludedURLs = ((await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [])
    .map((url) => rebaseUrl(url, preferredBase, log));

  // When triggered from Slack, skip agentic sources and daily batching
  const isSlackTriggered = !!(auditContext?.slackContext?.channelId);

  let finalUrls;
  let filteredCount;
  let agenticUrlsCount = 0;
  let currentAgentic = 0;
  let currentOrganic;
  let currentIncludedUrls;
  let isFirstRunOfCycle;
  let agenticNewThisCycle = 0;

  if (isSlackTriggered) {
    ({ urls: finalUrls, filteredCount } = mergeAndGetUniqueHtmlUrls([
      ...rebasedTopPagesUrls,
      ...rebasedIncludedURLs,
    ]));
    currentOrganic = rebasedTopPagesUrls.length;
    currentIncludedUrls = rebasedIncludedURLs.length;
    isFirstRunOfCycle = true;
  } else {
    // getTopAgenticUrls internally handles errors and returns [] on failure
    const agenticUrls = await getTopAgenticUrls(site, context);
    agenticUrlsCount = agenticUrls.length;

    // Daily batching: filter URLs recently processed within the rolling recent window
    const recentPathnames = await getRecentlyProcessedPathnames(context, siteId);

    const filteredOrganicUrls = rebasedTopPagesUrls
      .filter((url) => isNotRecentUrl(url, recentPathnames));
    const filteredIncludedURLs = rebasedIncludedURLs
      .filter((url) => isNotRecentUrl(url, recentPathnames));
    const filteredAgenticUrls = agenticUrls.filter((url) => isNotRecentUrl(url, recentPathnames));

    const hasRecentOrganic = filteredOrganicUrls.length !== topPagesUrls.length;
    isFirstRunOfCycle = !hasRecentOrganic;
    agenticNewThisCycle = filteredAgenticUrls.length;

    const orderedCandidateUrls = [
      ...filteredOrganicUrls,
      ...filteredIncludedURLs,
      ...filteredAgenticUrls,
    ];
    const batchedUrls = orderedCandidateUrls.slice(0, DAILY_BATCH_SIZE);

    const organicUrlSet = new Set(filteredOrganicUrls);
    const includedUrlSet = new Set(filteredIncludedURLs);
    currentOrganic = batchedUrls.filter((url) => organicUrlSet.has(url)).length;
    currentIncludedUrls = batchedUrls.filter((url) => includedUrlSet.has(url)).length;
    currentAgentic = batchedUrls.filter(
      (url) => !organicUrlSet.has(url) && !includedUrlSet.has(url),
    ).length;

    ({ urls: finalUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(batchedUrls));
  }

  log.info(`${LOG_PREFIX} prerender_submit_scraping_metrics:
    submittedUrls=${finalUrls.length},
    agenticUrls=${agenticUrlsCount},
    topPagesUrls=${topPagesUrls.length},
    includedURLs=${rebasedIncludedURLs.length},
    filteredOutUrls=${filteredCount},
    currentAgentic=${currentAgentic},
    currentOrganic=${currentOrganic},
    currentIncludedUrls=${currentIncludedUrls},
    isFirstRunOfCycle=${isFirstRunOfCycle},
    agenticNewThisCycle=${agenticNewThisCycle},
    baseUrl=${site.getBaseURL()},
    siteId=${siteId}`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = getPreferredBaseUrl(site, context);
    log.info(`${LOG_PREFIX} No URLs found, falling back to baseUrl=${baseURL}, siteId=${site.getId()}`);
    finalUrls.push(baseURL);
  }

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId,
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

  log.info(`${LOG_PREFIX} Creating dummy opportunity for forbidden scraping. baseUrl=${auditUrl}, siteId=${auditData.siteId}, isPaidLLMOCustomer=${isPaid}`);

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

  log.info(`${LOG_PREFIX} Prepared domain-wide aggregate suggestion for entire domain with allowedRegexPatterns: ${JSON.stringify(allowedRegexPatterns)}. Based on ${auditedUrlCount} audited URL(s).`);

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
    log.info(`${LOG_PREFIX} No prerender opportunities found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  const preRenderSuggestions = auditResult.results
    .filter((result) => result.needsPrerender);

  /* c8 ignore next 4 */
  if (preRenderSuggestions.length === 0) {
    log.info(`${LOG_PREFIX} No URLs needing prerender found, skipping opportunity creation. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
    return null;
  }

  log.debug(`${LOG_PREFIX} Generated ${preRenderSuggestions.length} prerender suggestions for baseUrl=${auditUrl}, siteId=${auditData.siteId}`);

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
    log.info(`${LOG_PREFIX} Skipping domain-wide suggestion creation - existing one will be preserved. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
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
    citabilityScore: suggestion.citabilityScore ?? null,
    // Persist the scrapeJobId so that downstream callers (e.g. Mystique key construction)
    // always use the job that produced the actual S3 artifacts for this suggestion,
    // even when the suggestion is re-queued in ai-only mode with a different job id.
    scrapeJobId: auditData.scrapeJobId,
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

  log.info(`${LOG_PREFIX}
    prerender_suggestions_sync_metrics:
    siteId=${auditData.siteId},
    baseUrl=${auditUrl},
    isPaidLLMOCustomer=${isPaid},
    suggestions=${preRenderSuggestions.length},
    totalSuggestions=${allSuggestions.length},`);

  // Build a set of URLs whose suggestions already carry a valid AI summary marked as valuable.
  // These do not need to be re-sent to Mystique — the summary is already present and useful.
  const syncedSuggestions = await opportunity.getSuggestions();
  const urlsWithValidAiSummary = new Set(
    syncedSuggestions
      .filter((s) => {
        const d = s.getData();
        const hasValidAiSummary = d?.aiSummary && d.aiSummary.toLowerCase() !== 'not available';
        return hasValidAiSummary && d?.valuable === true;
      })
      .map((s) => s.getData()?.url)
      .filter(Boolean),
  );

  if (urlsWithValidAiSummary.size > 0) {
    log.info(`${LOG_PREFIX} Skipping ${urlsWithValidAiSummary.size} suggestion(s) from Mystique request: already have a valid AI summary. baseUrl=${auditUrl}, siteId=${auditData.siteId}`);
  }

  // Build Mystique candidates from individual URLs (domain-wide excluded).
  // The guidance handler matches Mystique responses back to suggestions by URL,
  // so sending the URL as suggestionId is sufficient and avoids a post-sync DB fetch.
  const auditRunCandidates = preRenderSuggestions.reduce((acc, s) => {
    if (urlsWithValidAiSummary.has(s.url)) {
      return acc; // Already has a valid AI summary — skip re-generation
    }
    try {
      acc.push({
        suggestionId: s.url,
        url: s.url,
        originalHtmlMarkdownKey: getS3Path(s.url, auditData.scrapeJobId, 'server-side-html.md'),
        markdownDiffKey: getS3Path(s.url, auditData.scrapeJobId, 'markdown-diff.md'),
      });
    } catch {
      // skip malformed URLs — getS3Path throws if new URL(url) fails
    }
    return acc;
  }, []);

  return { opportunity, auditRunCandidates };
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
    log.debug(`${LOG_PREFIX} PageCitability not available, skipping citability record writes`);
    return;
  }

  const existingRecords = await PageCitability.allBySiteId(siteId);
  const existingRecordsMap = new Map(
    existingRecords.map((r) => [normalizePathname(r.getUrl()), r]),
  );

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
      const existing = existingRecordsMap.get(normalizePathname(url));
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
      log.warn(`${LOG_PREFIX} Failed to write PageCitability for ${url}: ${e.message}`);
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

  log.info(`${LOG_PREFIX} Wrote PageCitability records: ${written}/${successful.length}`);
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
    log, s3Client, env,
  } = context;
  const {
    auditResult,
    siteId,
    auditedAt,
    scrapeJobId,
    submittedUrlSet,
  } = auditData;

  try {
    if (!auditResult) {
      log.warn(`${LOG_PREFIX} Missing auditResult, skipping status summary upload`);
      return;
    }

    const scrapedAt = auditedAt || new Date().toISOString();
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;

    // Read existing status.json before building currentPages so we can look up prior scrapeJobIds.
    // Pages from the current run overwrite any prior entry for the same URL.
    let existingStatus = {};
    let existingPages = [];
    try {
      const existing = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key: statusKey,
      }));
      existingStatus = JSON.parse(await existing.Body.transformToString());
      existingPages = Array.isArray(existingStatus.pages) ? existingStatus.pages : [];
    } catch (e) {
      if (e.name !== 'NoSuchKey') {
        log.warn(`${LOG_PREFIX} Could not read existing status.json for merge, starting fresh: ${e.message}`);
      }
    }

    const existingPageMap = new Map(existingPages.map((p) => [normalizePathname(p.url), p]));

    const currentPages = (auditResult.results ?? []).map((result) => {
      // Only stamp the current scrapeJobId for URLs actually submitted to this job.
      // For fallback URLs that weren't submitted, preserve the existing scrapeJobId.
      const wasSubmitted = !submittedUrlSet || submittedUrlSet.has(result.url);
      return {
        url: result.url,
        scrapingStatus: result.error ? 'error' : 'success',
        needsPrerender: result.needsPrerender || false,
        isDeployedAtEdge: !!result.isDeployedAtEdge,
        usedEarlyClientSideHtml: !!result.usedEarlyClientSideHtml,
        wordCountBefore: result.wordCountBefore || 0,
        wordCountAfter: result.wordCountAfter || 0,
        contentGainRatio: result.contentGainRatio || 0,
        scrapedAt,
        scrapeJobId: wasSubmitted
          ? (scrapeJobId || null)
          : (existingPageMap.get(normalizePathname(result.url))?.scrapeJobId ?? null),
        ...(result.scrapeError && { scrapeError: result.scrapeError }),
      };
    });

    // missingPages should be precomputed by getScrapeJobStats and passed via auditResult.
    if (Array.isArray(auditResult.missingPages)) {
      currentPages.push(
        ...auditResult.missingPages.map((page) => ({
          ...page,
          scrapedAt: page.scrapedAt || scrapedAt,
          scrapeJobId: page.scrapeJobId || scrapeJobId || null,
        })),
      );
    }

    const currentUrlSet = new Set(currentPages.map((p) => normalizePathname(p.url)));
    const mergedPages = [
      ...currentPages,
      ...existingPages.filter((p) => !currentUrlSet.has(normalizePathname(p.url))),
    ];

    // Derive aggregate metrics from the full merged page set and latest audit metadata.
    const urlsNeedingPrerender = mergedPages.filter((p) => p.needsPrerender).length;
    const urlsScrapedSuccessfully = mergedPages.filter((p) => p.scrapingStatus === 'success').length;
    const urlsSubmittedForScraping = mergedPages.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? ((urlsSubmittedForScraping - urlsScrapedSuccessfully) / urlsSubmittedForScraping) * 100
      : null;
    const scrapeForbiddenCount = mergedPages.filter(
      (p) => p.scrapeError?.statusCode === 403,
    ).length;
    const latestScrapeForbidden = auditResult.scrapeForbidden
      ?? currentPages.some((p) => p.scrapeError?.statusCode === 403);

    const statusSummary = {
      baseUrl: auditUrl,
      siteId,
      auditType: AUDIT_TYPE,
      scrapeJobId: scrapeJobId || existingStatus.scrapeJobId || null,
      lastUpdated: scrapedAt,
      urlsNeedingPrerender,
      urlsSubmittedForScraping,
      urlsScrapedSuccessfully,
      scrapingErrorRate,
      scrapeForbidden: latestScrapeForbidden,
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
    log.info(`${LOG_PREFIX} prerender_status_upload: statusKey=${statusKey}, pagesCount=${statusSummary.pages.length}, ${logFields}`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to upload status summary to S3: ${error.message}. baseUrl=${auditUrl}, siteId=${siteId}`, error);
    // Don't throw - this is a non-critical post-processing step
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

/**
 * Step 3: Process scraped content and compare server-side vs client-side HTML
 * OR skip if ai-only mode
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities OR ai-only result
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, scrapeResultPaths, data, dataAccess, auditContext,
  } = context;

  // Check for AI-only mode - skip processing step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 3, skipping processing (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();
  const isSlackTriggered = !!(auditContext?.slackContext?.channelId);

  // Diagnostic: detect non-NEW suggestions with edgeDeployed before syncing.
  // Runs unconditionally so audits with no prerender findings still catch pre-existing issues.
  await detectWrongEdgeDeployedStatus(dataAccess, siteId, site.getBaseURL(), log);

  // Check if this is a paid LLMO customer early so we can use it in all logs
  const isPaid = await isPaidLLMOCustomer(context);

  log.info(`${LOG_PREFIX} Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}`);

  try {
    let urlsToCheck = [];
    /* c8 ignore next */
    let agenticUrls = [];

    // Try to get URLs from the audit context first
    if (scrapeResultPaths?.size > 0) {
      urlsToCheck = Array.from(context.scrapeResultPaths.keys());
      log.info(`${LOG_PREFIX} Found ${urlsToCheck.length} URLs from scrape results`);
    } else {
      /* c8 ignore start */
      // Fetch agentic URLs for URL list fallback (skipped for Slack-triggered runs)
      if (!isSlackTriggered) {
        try {
          agenticUrls = await getTopAgenticUrls(site, context);
        } catch (e) {
          log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs for fallback: ${e.message}. baseUrl=${site.getBaseURL()}`);
        }
      }

      // Load top organic pages cache for fallback merging
      const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
      const preferredBase = getPreferredBaseUrl(site, context);
      const rebasedFallbackOrganicUrls = topPagesUrls
        .map((url) => rebaseUrl(url, preferredBase, log));
      const fallbackIncludedURLs = (await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [];
      const rebasedFallbackIncludedURLs = fallbackIncludedURLs
        .map((url) => rebaseUrl(url, preferredBase, log));
      // Use the same normalization and filtering logic for consistency
      const { urls: filteredUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
        rebasedFallbackOrganicUrls,
        agenticUrls,
        rebasedFallbackIncludedURLs,
      );
      urlsToCheck = filteredUrls;

      /* c8 ignore stop */
      const msg = `Fallback for baseUrl=${site.getBaseURL()}, siteId=${siteId}. `
        + `Using agenticURLs=${agenticUrls.length}, `
        + `topPages=${rebasedFallbackOrganicUrls.length}, `
        + `includedURLs=${rebasedFallbackIncludedURLs.length}, `
        + `filteredOutUrls=${filteredCount}, `
        + `total=${urlsToCheck.length}`;
      log.info(`${LOG_PREFIX} ${msg}`);
    }

    /* c8 ignore next 5 - Edge case: empty URLs fallback, difficult to reach in tests */
    if (urlsToCheck.length === 0) {
      // Final fallback to base URL
      urlsToCheck = [getPreferredBaseUrl(site, context)];
      log.info(`${LOG_PREFIX} No URLs found for comparison. baseUrl=${getPreferredBaseUrl(site, context)}, siteId=${siteId}`);
    }

    const comparisonResults = await Promise.all(
      urlsToCheck.map((url) => compareHtmlContent(url, context)),
    );

    // Phase 2c: write citability metrics to PageCitability entity.
    await writeToCitabilityRecords(comparisonResults, siteId, context);

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    log.info(`${LOG_PREFIX} Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped. isPaidLLMOCustomer=${isPaid}`);

    const { scrapeJobId } = auditContext || {};
    // getScrapeJobStats combines 403s from COMPLETE-status URLs (already in comparisonResults)
    // and FAILED-status URLs (absent from comparisonResults, fetched from ScrapeUrl table).
    // missingPages is reused by uploadStatusSummaryToS3 to avoid a redundant DB + S3 round-trip.
    const {
      urlsSubmittedForScraping,
      scrapeForbiddenCount,
      scrapeForbidden,
      missingPages,
      submittedUrlSet,
    } = await getScrapeJobStats(scrapeJobId, comparisonResults, urlsToCheck.length, context);

    log.info(`${LOG_PREFIX} Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}. scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${comparisonResults.length}, isPaidLLMOCustomer=${isPaid}`);

    // Remove internal tracking fields from results before storing
    // eslint-disable-next-line
    const cleanResults = comparisonResults.map(({ hasScrapeMetadata, scrapeForbidden, ...result }) => result);

    const urlsNotNeedingPrerender = successfulComparisons.length - urlsNeedingPrerender.length;
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

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      urlsScrapedSuccessfully: successfulComparisons.length,
      urlsSubmittedForScraping,
      urlsNotNeedingPrerender,
      scrapingErrorRate,
      results: cleanResults,
      missingPages,
      scrapeForbidden,
      scrapeForbiddenCount,
      lastAuditSuccess: true,
    };

    log.info(`${LOG_PREFIX} Scraping metrics for baseUrl=${site.getBaseURL()}, siteId=${siteId}. urlsSubmittedForScraping=${urlsSubmittedForScraping}, urlsScrapedSuccessfully=${successfulComparisons.length}, scrapeForbiddenCount=${scrapeForbiddenCount}, scrapingErrorRate=${scrapingErrorRate}%`);

    let opportunityWithSuggestions = null;

    /* c8 ignore next 16 - Opportunity processing branch, covered by integration tests */
    if (urlsNeedingPrerender.length > 0) {
      const { opportunity, auditRunCandidates } = await processOpportunityAndSuggestions(
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
        auditRunCandidates,
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
      log.info(`${LOG_PREFIX} No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, isPaidLLMOCustomer=${isPaid}`);

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

    // When domain-wide suggestion has edgeDeployed, mark NEW suggestions as coveredByDomainWide
    // Only mark suggestions for URLs confirmed deployed at edge in this audit run
    const deployedAtEdgeUrls = new Set(
      successfulComparisons
        .filter((r) => r.isDeployedAtEdge)
        .map((r) => r.url),
    );
    await markNewSuggestionsAsCovered(opportunityWithSuggestions, context, deployedAtEdgeUrls);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`${LOG_PREFIX} Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
      submittedUrlSet,
    };

    // Upload status summary to S3 (post-processing)
    await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`${LOG_PREFIX} Audit failed for baseUrl=${site.getBaseURL()}, siteId=${siteId}: ${error.message}`, error);

    const errorAuditResult = {
      error: AUDIT_ERROR_MESSAGE,
      lastAuditSuccess: false,
      results: [],
    };

    // Upload status.json on error so UI can show audit status via S3 fallback
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
