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
import { detectBotBlocker } from '@adobe/spacecat-shared-utils';
import { subDays } from 'date-fns';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { getTopAgenticLiveUrlsFromAthena, getPreferredBaseUrl } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import {
  buildSuggestionKey,
  getS3Path,
  isPaidLLMOCustomer,
  mergeAndGetUniqueHtmlUrls,
  normalizePathnameWithQuery,
  readSiteStatusJson,
  toPathname,
} from './utils/utils.js';
import {
  CONTENT_GAIN_THRESHOLD,
  DAILY_BATCH_SIZE,
  DOMAIN_WIDE_SUGGESTION_KEY,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
} from './utils/constants.js';
import { isAiOnlyMode, getModeFromData } from './mode-selector.js';
import { handleAiOnlyMode } from './ai-only-handler.js';
import { sendPrerenderGuidanceRequestToMystique } from './guidance-request.js';

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

/** Skip re-scraping when status.json records a confirmed sticky block within this window. */
const DOMAIN_STICKY_BOT_SKIP_MS = 3 * 24 * 60 * 60 * 1000;
const STICKY_BOT_FORBIDDEN_RATIO = 0.5;

/** CDN bot blockers (aligned with content-scraper detectBotProtection). */
const KNOWN_BOT_BLOCKER_TYPES = ['cloudflare', 'imperva', 'akamai', 'fastly', 'cloudfront'];

/**
 * @param {{ crawlable: boolean, confidence: number, type?: string }} result
 * @returns {boolean}
 */
function isKnownBotBlockerResult({ crawlable, confidence, type }) {
  return !crawlable
    && confidence >= 0.99
    && KNOWN_BOT_BLOCKER_TYPES.includes(type);
}

/**
 * @param {string} siteId
 * @param {Object} context
 * @returns {Promise<boolean>}
 */
function isStickyBotBlocked(status) {
  if (!status.scrapeForbidden || !status.scrapeForbiddenSince) {
    return false;
  }
  const sinceMs = Date.parse(status.scrapeForbiddenSince);
  if (Number.isNaN(sinceMs)) {
    return false;
  }
  return (Date.now() - sinceMs) < DOMAIN_STICKY_BOT_SKIP_MS;
}

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
    return s.getStatus() === Suggestion.STATUSES.NEW
      && isDomainWideSuggestionData(d) && !!d?.edgeDeployed;
  }) ?? null;
}

/**
 * Sets coveredByDomainWide on NEW suggestions whose URLs are confirmed deployed at edge,
 * instead of moving them to SKIPPED. This allows rollback to naturally restore them to
 * the Current tab when the backend clears coveredByDomainWide on domain-wide rollback.
 * @param {Object} opportunity - The opportunity object
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Set<string>} deployedAtEdgePathnames - Pathnames confirmed deployed at edge in this audit
 * @param {string} domainWideSuggestionId - ID of the deployed domain-wide suggestion
 * @returns {Promise<void>}
 */
async function markDeployedUrlSuggestionsAsCovered(
  opportunity,
  context,
  deployedAtEdgePathnames,
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

  const suggestionsToCover = deployedAtEdgePathnames?.size > 0
    ? newSuggestions.filter((s) => {
      const data = s.getData();
      return deployedAtEdgePathnames.has(toPathname(data?.url)) && !data?.edgeDeployed;
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
 * @param {Set<string>} deployedAtEdgePathnames - Pathnames confirmed deployed at edge in this audit
 * @returns {Promise<void>}
 */
async function markNewSuggestionsAsCovered(opportunity, context, deployedAtEdgePathnames) {
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
    deployedAtEdgePathnames,
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
    return await getTopAgenticLiveUrlsFromAthena(site, context, limit);
  } catch (e) {
    context.log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs: ${e.message}. baseUrl=${site.getBaseURL()}`);
    return [];
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
 * Returns pathnames from siteStatus pages processed within the configured recent window.
 * @param {Object} siteStatus - siteStatus object with a pages array
 * @returns {Set<string>}
 */
function getRecentlyProcessedPathnames(siteStatus) {
  const pages = Array.isArray(siteStatus?.pages) ? siteStatus.pages : [];
  const recentWindowStart = subDays(new Date(), PRERENDER_RECENT_PROCESSING_TIME_DAYS);
  const pathnames = new Set();
  for (const p of pages) {
    if (p.scrapedAt && new Date(p.scrapedAt) >= recentWindowStart && p.url) {
      const pathname = normalizePathnameWithQuery(p.url);
      if (pathname) {
        pathnames.add(pathname);
      }
    }
  }
  return pathnames;
}

/**
 * Returns a Set of URL pathnames whose suggestions are already deployed at the CDN edge
 * (individual `edgeDeployed` timestamp) or covered by an active domain-wide deployment
 * (`coveredByDomainWide` pointing to a domain-wide suggestion that still has `edgeDeployed`).
 * These URLs gain nothing from re-scraping and are excluded from the daily batch.
 * @param {Object} context - Audit context with dataAccess and log
 * @param {string} siteId - Site identifier
 * @returns {Promise<Set<string>>}
 */
function getEdgeDeployedPathnames(status) {
  const pages = Array.isArray(status.pages) ? status.pages : [];
  const pathnames = new Set();
  for (const p of pages) {
    if (p.isDeployedAtEdge && p.url) {
      try {
        const { pathname } = new URL(p.url);
        pathnames.add(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
      } catch { /* skip malformed URLs */ }
    }
  }
  return pathnames;
}

/**
 * Returns true when the URL's pathname is NOT in the set of recently processed pathnames.
 * URLs that cannot be parsed are treated as not recent (included by default).
 * @param {string} url
 * @param {Set<string>} recentPathnames
 * @returns {boolean}
 */
function isNotRecentUrl(url, recentPathnames) {
  return !recentPathnames.has(normalizePathnameWithQuery(url));
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

  // Fields derived from scrape.json, shared across all return paths
  const scrapeContext = {
    url,
    hasScrapeMetadata: metadata !== null,
    scrapeForbidden: metadata?.error?.statusCode === 403,
    isDeployedAtEdge: !!metadata?.isDeployedAtEdge,
    usedEarlyClientSideHtml: !!metadata?.usedEarlyClientSideHtml,
    /* c8 ignore next */
    scrapeError: metadata?.error,
  };

  // error: true keeps URL out of scrapedUrlsSet so syncSuggestions won't resolve its suggestions.
  if (metadata?.isErrorPage) {
    log.info(`${LOG_PREFIX} Error/maintenance page detected for ${url} — skipping HTML comparison`);
    return {
      ...scrapeContext, error: true, needsPrerender: false, isErrorPage: true,
    };
  }

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

    // analysis fields intentionally override scrapeContext on key collision
    return { ...scrapeContext, ...analysis };
  } catch (error) {
    log.debug(`${LOG_PREFIX} HTML analysis failed for ${url}: ${error.message}`);
    return { ...scrapeContext, error: true, needsPrerender: false };
  }
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
  if (isAiOnlyMode(mode)) {
    log.info(`${LOG_PREFIX} Detected ${mode} mode in step 1, skipping import/scraping/processing`);
    return handleAiOnlyMode(context);
  }

  // Extract generatePrompts so it can be forwarded to downstream steps via auditContext.
  // context.data is only populated on the SQS message that triggers Step 1 (the original
  // Slack command payload) — it is NOT automatically forwarded to Steps 2 and 3.
  let generatePromptsFlag = false;
  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    generatePromptsFlag = !!parsedData?.generatePrompts;
  } catch (e) {
    log.warn(`${LOG_PREFIX} Failed to parse context.data for generatePrompts flag, defaulting to false: ${e.message}`);
  }

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    auditContext: {
      ...(Array.isArray(auditContext?.urls) && auditContext.urls.length > 0
        ? { urls: auditContext.urls }
        : {}),
      generatePrompts: generatePromptsFlag,
    },
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
  if (isAiOnlyMode(mode)) {
    log.info(`${LOG_PREFIX} Detected ${mode} mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode };
  }

  const siteId = site.getId();
  const isSlackTriggered = !!(auditContext?.slackContext?.channelId);

  if (Array.isArray(auditContext?.urls) && auditContext.urls.length > 0) {
    const preferredBase = getPreferredBaseUrl(site, context);
    const rebasedCsvUrls = auditContext.urls.map((url) => rebaseUrl(url, preferredBase, log));
    const { urls: explicitUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
      rebasedCsvUrls,
      { includeQueryParams: true },
    );

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
      auditContext: { ...auditContext, generatePrompts: !!auditContext?.generatePrompts },
    };
  }

  const siteStatus = await readSiteStatusJson(siteId, context);

  // Sticky domain bot-block from status.json (Slack runs bypass so operators can force a re-scrape)
  if (!isSlackTriggered && isStickyBotBlocked(siteStatus)) {
    log.info(`${LOG_PREFIX} Sticky scrapeForbidden within ${DOMAIN_STICKY_BOT_SKIP_MS / 86400000}d window, skipping. baseUrl=${site.getBaseURL()}, siteId=${siteId}, blockedSince=${siteStatus.scrapeForbiddenSince}`);
    return {
      urls: [],
      siteId,
      processingType: AUDIT_TYPE,
      maxScrapeAge: 0,
      options: { pageLoadTimeout: 20000, storagePrefix: AUDIT_TYPE },
      auditContext: { domainBlocked: true },
    };
  }

  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  const preferredBase = getPreferredBaseUrl(site, context);
  const rebasedTopPagesUrls = topPagesUrls.map((url) => rebaseUrl(url, preferredBase, log));
  const rebasedIncludedURLs = ((await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [])
    .map((url) => rebaseUrl(url, preferredBase, log));

  let finalUrls;
  let filteredCount;
  let agenticUrlsCount = 0;
  let currentAgentic = 0;
  let currentOrganic;
  let currentIncludedUrls;
  let isFirstRunOfCycle;
  let agenticNewThisCycle = 0;
  let edgeDeployedPathnames = new Set();

  if (isSlackTriggered) {
    // Dedup each source independently: organic uses pathname-only dedup (tracking params stay
    // collapsed), included uses pathname+search so CSV query-param variants are preserved.
    const {
      urls: organicSlackDeduped, filteredCount: organicSlackFiltered,
    } = mergeAndGetUniqueHtmlUrls(rebasedTopPagesUrls);
    const {
      urls: includedSlackDeduped,
      filteredCount: includedSlackFiltered,
    } = mergeAndGetUniqueHtmlUrls(rebasedIncludedURLs, { includeQueryParams: true });
    const { urls: crossSlackDeduped } = mergeAndGetUniqueHtmlUrls(
      [...organicSlackDeduped, ...includedSlackDeduped],
      { includeQueryParams: true },
    );
    finalUrls = crossSlackDeduped;
    filteredCount = organicSlackFiltered + includedSlackFiltered;
    currentOrganic = organicSlackDeduped.length;
    currentIncludedUrls = includedSlackDeduped.length;
    isFirstRunOfCycle = true;
  } else {
    // getTopAgenticUrls internally handles errors and returns [] on failure
    const agenticUrls = await getTopAgenticUrls(site, context);
    agenticUrlsCount = agenticUrls.length;

    // Daily batching: filter URLs recently processed within the rolling recent window
    const recentPathnames = getRecentlyProcessedPathnames(siteStatus);
    edgeDeployedPathnames = getEdgeDeployedPathnames(siteStatus);

    const filteredOrganicUrls = rebasedTopPagesUrls
      .filter((url) => isNotRecentUrl(url, recentPathnames))
      .filter((url) => !edgeDeployedPathnames.has(normalizePathname(url)));
    const filteredIncludedURLs = rebasedIncludedURLs
      .filter((url) => isNotRecentUrl(url, recentPathnames))
      .filter((url) => !edgeDeployedPathnames.has(normalizePathname(url)));
    const filteredAgenticUrls = agenticUrls
      .filter((url) => isNotRecentUrl(url, recentPathnames))
      .filter((url) => !edgeDeployedPathnames.has(normalizePathname(url)));

    const hasRecentOrganic = filteredOrganicUrls.length !== topPagesUrls.length;
    isFirstRunOfCycle = !hasRecentOrganic;
    agenticNewThisCycle = filteredAgenticUrls.length;

    // Dedup each source independently before merging: organic/agentic use pathname-only
    // dedup (tracking params get collapsed), included uses pathname+search so CSV
    // query-param variants (e.g. /page?filter=a vs /page?filter=b) are preserved.
    const {
      urls: organicDeduped, filteredCount: organicFiltered,
    } = mergeAndGetUniqueHtmlUrls(filteredOrganicUrls);
    const {
      urls: includedDeduped, filteredCount: includedFiltered,
    } = mergeAndGetUniqueHtmlUrls(filteredIncludedURLs, { includeQueryParams: true });
    const {
      urls: agenticDeduped, filteredCount: agenticFiltered,
    } = mergeAndGetUniqueHtmlUrls(filteredAgenticUrls);
    filteredCount = organicFiltered + includedFiltered + agenticFiltered;

    const { urls: crossDeduped } = mergeAndGetUniqueHtmlUrls(
      [...organicDeduped, ...includedDeduped, ...agenticDeduped],
      { includeQueryParams: true },
    );
    const batchedUrls = crossDeduped.slice(0, DAILY_BATCH_SIZE);

    const organicUrlSet = new Set(organicDeduped);
    const includedUrlSet = new Set(includedDeduped);
    currentOrganic = batchedUrls.filter((url) => organicUrlSet.has(url)).length;
    currentIncludedUrls = batchedUrls.filter((url) => includedUrlSet.has(url)).length;
    currentAgentic = batchedUrls.filter(
      (url) => !organicUrlSet.has(url) && !includedUrlSet.has(url),
    ).length;

    finalUrls = batchedUrls;
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
    edgeDeployedUrls=${edgeDeployedPathnames.size},
    baseUrl=${site.getBaseURL()},
    siteId=${siteId}`);

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: {
      pageLoadTimeout: 20000,
      storagePrefix: AUDIT_TYPE,
    },
    auditContext: { ...auditContext, generatePrompts: !!auditContext?.generatePrompts },
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

  const { auditResult, scrapedUrlsSet: rawScrapedUrlsSet } = auditData;
  const { urlsNeedingPrerender } = auditResult;

  // Normalize scrapedUrlsSet to pathname+search so query-param variants are treated
  // as distinct pages. Domain shifts only affect hostname so migration tolerance
  // (e.g. www.example.com → example.com) is preserved.
  const scrapedUrlsSet = rawScrapedUrlsSet ? (() => {
    const keys = new Set(
      [...rawScrapedUrlsSet].map(normalizePathnameWithQuery),
    );
    return {
      has: (url) => keys.has(normalizePathnameWithQuery(url)),
    };
  })() : null;

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
    buildKey: buildSuggestionKey,
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

  // Build Mystique candidates from individual URLs (domain-wide excluded).
  // The guidance handler matches Mystique responses back to suggestions by URL,
  // so sending the URL as suggestionId is sufficient and avoids a post-sync DB fetch.
  const auditRunCandidates = preRenderSuggestions.reduce((acc, s) => {
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
    const existingStatus = await readSiteStatusJson(siteId, context);
    const existingPages = Array.isArray(existingStatus.pages) ? existingStatus.pages : [];

    const existingPageMap = new Map(
      existingPages.map((p) => [normalizePathnameWithQuery(p.url), p]),
    );

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
          : (existingPageMap.get(normalizePathnameWithQuery(result.url))?.scrapeJobId ?? null),
        ...(result.isErrorPage && { isErrorPage: true }),
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

    const currentUrlSet = new Set(currentPages.map((p) => normalizePathnameWithQuery(p.url)));
    const mergedPages = [
      ...currentPages,
      ...existingPages.filter((p) => !currentUrlSet.has(normalizePathnameWithQuery(p.url))),
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
      scrapeForbidden: auditResult.scrapeForbidden ?? false,
      scrapeForbiddenCount,
      scrapeForbiddenSince: auditResult.scrapeForbiddenSince ?? existingStatus.scrapeForbiddenSince,
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
    log, dataAccess, s3Client, env, auditContext,
  } = context;

  const isDomainBlocked = auditContext?.domainBlocked === true;
  if (isDomainBlocked) {
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
  if (isAiOnlyMode(mode)) {
    log.info(`${LOG_PREFIX} Detected ${mode} mode in step 3, skipping processing (already handled in step 1)`);
    return { status: 'skipped', mode };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();
  const isDomainBlocked = auditContext?.domainBlocked === true;

  const generatePrompts = !!auditContext?.generatePrompts;

  // Diagnostic: detect non-NEW suggestions with edgeDeployed before syncing.
  // Runs unconditionally so audits with no prerender findings still catch pre-existing issues.
  await detectWrongEdgeDeployedStatus(dataAccess, siteId, site.getBaseURL(), log);

  // Check if this is a paid LLMO customer early so we can use it in all logs
  const isPaid = await isPaidLLMOCustomer(context);

  if (isDomainBlocked) {
    log.info(`${LOG_PREFIX} Domain is bot-blocked, treating as fully forbidden scrape. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
  }

  log.info(`${LOG_PREFIX} Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}`);

  try {
    let urlsToCheck = [];

    // Skip expensive URL fetching and comparison when domain is known to be bot-blocked
    if (!isDomainBlocked) {
      if (scrapeResultPaths?.size > 0) {
        urlsToCheck = Array.from(context.scrapeResultPaths.keys());
        log.info(`${LOG_PREFIX} Found ${urlsToCheck.length} URLs from scrape results`);
      } else {
        // scrapeResultPaths is empty — all submitted URLs had FAILED status in the scraper.
        // getScrapeJobStats reads the ScrapeUrl DB and populates missingPages so status.json
        // records the correct failed URLs. Running a top-page fallback here would write phantom
        // 'error' entries for URLs that were never submitted to this scrape job.
        log.warn(`${LOG_PREFIX} No COMPLETE scrape results for baseUrl=${site.getBaseURL()}, `
          + `siteId=${siteId}, scrapeJobId=${auditContext?.scrapeJobId ?? 'unknown'}. `
          + 'Skipping comparison; failed URLs recorded via ScrapeUrl DB.');
      }
    }

    const comparisonResults = isDomainBlocked
      ? []
      : await Promise.all(urlsToCheck.map((url) => compareHtmlContent(url, context)));

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    log.info(`${LOG_PREFIX} Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped. isPaidLLMOCustomer=${isPaid}`);

    const { scrapeJobId } = auditContext || {};
    // getScrapeJobStats combines 403s from COMPLETE-status URLs (already in comparisonResults)
    // and FAILED-status URLs (absent from comparisonResults, fetched from ScrapeUrl table).
    // missingPages is reused by uploadStatusSummaryToS3 to avoid a redundant DB + S3 round-trip.
    const urlCount = urlsToCheck.length;
    const {
      urlsSubmittedForScraping,
      scrapeForbiddenCount,
      missingPages,
      submittedUrlSet,
    } = await getScrapeJobStats(scrapeJobId, comparisonResults, urlCount, context);

    log.info(`${LOG_PREFIX} Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${comparisonResults.length}, isPaidLLMOCustomer=${isPaid}`);

    let scrapeForbidden = isDomainBlocked;
    let scrapeForbiddenSince;
    if (!isDomainBlocked && urlsSubmittedForScraping > 0) {
      const ratio403 = scrapeForbiddenCount / urlsSubmittedForScraping;
      if (ratio403 >= STICKY_BOT_FORBIDDEN_RATIO) {
        try {
          const botBlocker = await detectBotBlocker({ baseUrl: site.getBaseURL(), log });
          if (isKnownBotBlockerResult(botBlocker)) {
            scrapeForbidden = true;
            scrapeForbiddenSince = new Date().toISOString();
          }
        } catch (e) {
          log.warn(`${LOG_PREFIX} detectBotBlocker failed after high 403 ratio: ${e.message}. baseUrl=${site.getBaseURL()}`);
        }
        log.info(`${LOG_PREFIX} Bot-block detection result: ratio403=${ratio403}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenSince=${scrapeForbiddenSince ?? 'n/a'}. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
      }
    }

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
      scrapeForbiddenSince,
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
        generatePrompts,
      );
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
        // Normalize scraped URLs to pathname+search so query-param variants are treated
        // as distinct pages. Domain shifts only affect hostname so migration tolerance is
        // preserved.
        const scrapedKeys = new Set(
          [...scrapedUrlsSet].map(normalizePathnameWithQuery),
        );
        const scrapedUrlsForNoOppty = {
          has: (url) => scrapedKeys.has(normalizePathnameWithQuery(url)),
        };
        await syncSuggestions({
          opportunity: existingOpportunity,
          newData: [],
          context,
          buildKey: (suggestionData) => normalizePathnameWithQuery(suggestionData.url),
          mapNewSuggestion: () => ({}),
          scrapedUrlsSet: scrapedUrlsForNoOppty,
        });
        opportunityWithSuggestions = existingOpportunity;
      }
    }

    // When domain-wide suggestion has edgeDeployed, mark NEW suggestions as coveredByDomainWide
    // Only mark suggestions for pathnames confirmed deployed at edge in this audit run
    const deployedAtEdgePathnames = new Set(
      successfulComparisons
        .filter((r) => r.isDeployedAtEdge)
        .map((r) => toPathname(r.url)),
    );
    await markNewSuggestionsAsCovered(opportunityWithSuggestions, context, deployedAtEdgePathnames);

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
