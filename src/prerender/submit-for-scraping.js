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
import { filterBySiteScope } from '@adobe/spacecat-shared-utils';
import { subDays } from 'date-fns';
import { getTopAgenticLiveUrlsFromAthena, getPreferredBaseUrl } from '../utils/agentic-urls.js';
import {
  getActiveSuggestionStats,
  mergeAndGetUniqueHtmlUrls,
  normalizePathnameWithQuery,
  readSiteStatusJson,
} from './utils/utils.js';
import {
  DAILY_BATCH_SIZE,
  MAX_ACTIVE_SUGGESTIONS,
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
} from './utils/constants.js';
import { isAiOnlyMode, getModeFromData } from './mode-selector.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/** Skip re-scraping when status.json records a confirmed sticky block within this window. */
const DOMAIN_STICKY_BOT_SKIP_MS = 3 * 24 * 60 * 60 * 1000;

function rebaseUrl(url, preferredBase, log) {
  try {
    const { pathname, search, hash } = new URL(url);
    return new URL(pathname + search + hash, preferredBase).toString();
  } catch (e) {
    log?.warn?.(`rebaseUrl failed url=${url} base=${preferredBase}: ${e.message}`);
    return url;
  }
}

/**
 * @param {Object} status - Parsed status.json
 * @returns {boolean}
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
 * @param {Object} status - Parsed status.json
 * @returns {Set<string>}
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
 * Builds the standard Step 2 return shape shared by every exit path (explicit CSV list,
 * sticky-bot-block, and the normal organic/included/agentic flow).
 * @param {Array<{url: string}>} urls - URLs to submit for scraping
 * @param {string} siteId - Site ID
 * @param {Object} auditContext - auditContext to forward to the scrape-client step
 * @returns {Object}
 */
function buildScrapeStepResult(urls, siteId, auditContext) {
  return {
    urls,
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: {
      pageLoadTimeout: 20000,
      storagePrefix: AUDIT_TYPE,
    },
    auditContext,
  };
}

/**
 * Gate: explicit CSV/Slack-command URL list (auditContext.urls). When present, this is the
 * only URL source considered — every gate below (sticky bot block, suggestion cap) and every
 * other source (organic/included/agentic) is bypassed.
 * @param {Object} context - Audit context (uses auditContext, log)
 * @param {{preferredBase: string, siteBaseUrl: string, siteId: string}} derived
 * @returns {Object|null} Step 2 result, or null if there is no explicit URL list
 */
function buildExplicitCsvResult(context, { preferredBase, siteBaseUrl, siteId }) {
  const { auditContext, log } = context;
  if (!Array.isArray(auditContext?.urls) || auditContext.urls.length === 0) {
    return null;
  }

  const rebasedCsvUrls = auditContext.urls.map((url) => rebaseUrl(url, preferredBase, log));
  const { urls: mergedCsvUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(
    rebasedCsvUrls,
    { includeQueryParams: true },
  );
  const explicitUrls = filterBySiteScope(mergedCsvUrls, siteBaseUrl);
  const scopeFilteredCount = mergedCsvUrls.length - explicitUrls.length;

  log.info(`
    ${LOG_PREFIX} prerender_submit_scraping_metrics:
    submittedUrls=${explicitUrls.length},
    agenticUrls=0,
    topPagesUrls=0,
    includedURLs=0,
    filteredOutUrls=${filteredCount},
    scopeFilteredUrls=${scopeFilteredCount},
    baseUrl=${siteBaseUrl},
    siteId=${siteId},
    csvUrls=${auditContext.urls.length},`);

  return buildScrapeStepResult(
    explicitUrls.map((url) => ({ url })),
    siteId,
    { ...auditContext, generatePrompts: !!auditContext?.generatePrompts },
  );
}

/**
 * Gate: sticky domain bot-block from status.json. Slack runs bypass this so operators can
 * force a re-scrape.
 * @param {Object} context - Audit context (uses log)
 * @param {{isSlackTriggered: boolean, siteStatus: Object, siteBaseUrl: string,
 *   siteId: string}} derived
 * @returns {Object|null} Step 2 result, or null if the domain is not sticky-blocked
 */
function buildStickyBotBlockResult(context, {
  isSlackTriggered, siteStatus, siteBaseUrl, siteId,
}) {
  if (isSlackTriggered || !isStickyBotBlocked(siteStatus)) {
    return null;
  }

  context.log.info(`${LOG_PREFIX} Sticky scrapeForbidden within ${DOMAIN_STICKY_BOT_SKIP_MS / 86400000}d window, skipping. baseUrl=${siteBaseUrl}, siteId=${siteId}, blockedSince=${siteStatus.scrapeForbiddenSince}`);
  return buildScrapeStepResult([], siteId, { domainBlocked: true });
}

/**
 * Slack-triggered candidate assembly: merges organic + included sources only (no agentic,
 * no daily-batch slicing, no recent/edge-deployed filtering) so operators always get the
 * full current set when forcing a run. Not subject to the suggestion cap (see
 * applySuggestionCapFilter) — Slack runs are an explicit operator action, same as CSV.
 * @param {{rebasedTopPagesUrls: string[], rebasedIncludedURLs: string[], siteBaseUrl: string}} args
 * @returns {{finalUrls: string[], metrics: Object}}
 */
function buildSlackTriggeredCandidates({
  rebasedTopPagesUrls, rebasedIncludedURLs, siteBaseUrl,
}) {
  // Dedup each source independently: organic uses pathname-only dedup (tracking params stay
  // collapsed), included uses pathname+search so CSV query-param variants are preserved.
  const {
    urls: organicDeduped, filteredCount: organicFiltered,
  } = mergeAndGetUniqueHtmlUrls(rebasedTopPagesUrls);
  const {
    urls: includedDeduped, filteredCount: includedFiltered,
  } = mergeAndGetUniqueHtmlUrls(rebasedIncludedURLs, { includeQueryParams: true });
  const { urls: crossDeduped } = mergeAndGetUniqueHtmlUrls(
    [...organicDeduped, ...includedDeduped],
    { includeQueryParams: true },
  );
  // Single site-scope filter on the merged candidate set (scoped here, not per-source).
  const finalUrls = filterBySiteScope(crossDeduped, siteBaseUrl);

  return {
    finalUrls,
    metrics: {
      agenticUrlsCount: 0,
      filteredCount: organicFiltered + includedFiltered,
      scopeFilteredCount: crossDeduped.length - finalUrls.length,
      currentOrganic: organicDeduped.length,
      currentIncludedUrls: includedDeduped.length,
      currentAgentic: 0,
      isFirstRunOfCycle: true,
      agenticNewThisCycle: 0,
      edgeDeployedCount: 0,
    },
  };
}

/**
 * Automatic (non-Slack) daily-batch candidate assembly: merges organic + included + agentic
 * sources, filters out URLs recently processed or already deployed at the edge, then slices
 * to DAILY_BATCH_SIZE. Subject to the suggestion cap (see applySuggestionCapFilter).
 * @param {Object} context - Audit context (uses site, and is forwarded to getTopAgenticUrls)
 * @param {{siteStatus: Object, rebasedTopPagesUrls: string[], rebasedIncludedURLs: string[],
 *   siteBaseUrl: string}} args
 * @returns {Promise<{finalUrls: string[], metrics: Object}>}
 */
async function buildAutomaticBatchCandidates(context, {
  siteStatus, rebasedTopPagesUrls, rebasedIncludedURLs, siteBaseUrl,
}) {
  const { site } = context;

  // getTopAgenticUrls internally handles errors and returns [] on failure
  const agenticUrls = await getTopAgenticUrls(site, context);

  // Daily batching: filter out URLs recently processed within the rolling recent window,
  // or already confirmed deployed at the CDN edge — neither gains anything from re-scraping.
  const recentPathnames = getRecentlyProcessedPathnames(siteStatus);
  const edgeDeployedPathnames = getEdgeDeployedPathnames(siteStatus);
  const isFreshCandidate = (url) => isNotRecentUrl(url, recentPathnames)
    && !edgeDeployedPathnames.has(normalizePathname(url));

  const filteredOrganicUrls = rebasedTopPagesUrls.filter(isFreshCandidate);
  const filteredIncludedURLs = rebasedIncludedURLs.filter(isFreshCandidate);
  const filteredAgenticUrls = agenticUrls.filter(isFreshCandidate);

  const isFirstRunOfCycle = filteredOrganicUrls.length === rebasedTopPagesUrls.length;

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

  const { urls: crossDeduped } = mergeAndGetUniqueHtmlUrls(
    [...organicDeduped, ...includedDeduped, ...agenticDeduped],
    { includeQueryParams: true },
  );
  // Single site-scope filter on the merged candidate set, applied before the daily-batch
  // slice so out-of-scope URLs don't consume batch slots and starve in-scope ones.
  const scopedUrls = filterBySiteScope(crossDeduped, siteBaseUrl);
  const finalUrls = scopedUrls.slice(0, DAILY_BATCH_SIZE);

  const organicUrlSet = new Set(organicDeduped);
  const includedUrlSet = new Set(includedDeduped);

  return {
    finalUrls,
    metrics: {
      agenticUrlsCount: agenticUrls.length,
      filteredCount: organicFiltered + includedFiltered + agenticFiltered,
      scopeFilteredCount: crossDeduped.length - scopedUrls.length,
      currentOrganic: finalUrls.filter((url) => organicUrlSet.has(url)).length,
      currentIncludedUrls: finalUrls.filter((url) => includedUrlSet.has(url)).length,
      currentAgentic: finalUrls.filter(
        (url) => !organicUrlSet.has(url) && !includedUrlSet.has(url),
      ).length,
      isFirstRunOfCycle,
      agenticNewThisCycle: filteredAgenticUrls.length,
      edgeDeployedCount: edgeDeployedPathnames.size,
    },
  };
}

/**
 * Domain-wide suggestion cap (LLMO-6533/LLMO-6638), applied only to the automatic daily
 * batch — CSV and Slack-triggered runs are explicit operator actions and are never capped.
 *
 * Once a domain has accumulated MAX_ACTIVE_SUGGESTIONS non-outdated suggestions, brand-new
 * URLs are dropped from the batch, but URLs that already have an active per-URL suggestion
 * keep being re-submitted so they can still be re-verified (and eventually go OUTDATED/FIXED,
 * letting the count fall back below the cap on its own).
 * @param {Object} context - Audit context (uses dataAccess, log)
 * @param {{siteBaseUrl: string, siteId: string, urls: string[]}} args
 * @returns {Promise<string[]>} The (possibly trimmed) URL list
 */
async function applySuggestionCapFilter(context, { siteBaseUrl, siteId, urls }) {
  const { dataAccess, log } = context;
  const { count, existingUrls } = await getActiveSuggestionStats(dataAccess, siteId);
  if (count < MAX_ACTIVE_SUGGESTIONS) {
    return urls;
  }

  const cappedUrls = urls.filter((url) => existingUrls.has(normalizePathnameWithQuery(url)));
  const droppedCount = urls.length - cappedUrls.length;
  if (droppedCount > 0) {
    log.info(`${LOG_PREFIX} Active suggestion count (${count}) has reached the limit of ${MAX_ACTIVE_SUGGESTIONS}: dropped ${droppedCount} new URL(s), letting ${cappedUrls.length} existing-suggestion URL(s) through. baseUrl=${siteBaseUrl}, siteId=${siteId}`);
  }
  return cappedUrls;
}

/**
 * Step 2: Submit URLs for scraping OR skip if in ai-only mode
 *
 * Checked in order, each an early exit: (1) AI-only mode, (2) explicit CSV/Slack-command
 * URL list, (3) sticky bot block. If neither applies, candidate URLs are assembled from
 * organic/included/agentic sources — Slack-triggered runs via buildSlackTriggeredCandidates,
 * automatic runs via buildAutomaticBatchCandidates. Only the automatic path is then subject
 * to the domain-wide suggestion cap (applySuggestionCapFilter); CSV and Slack runs are
 * explicit operator actions and are never capped.
 *
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata OR ai-only result
 */
export async function submitForScraping(context) {
  const {
    site, log, data, auditContext,
  } = context;

  // Check for AI-only mode - skip scraping step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (isAiOnlyMode(mode)) {
    log.info(`${LOG_PREFIX} Detected ${mode} mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode };
  }

  const siteId = site.getId();
  const siteBaseUrl = site.getBaseURL();
  const preferredBase = getPreferredBaseUrl(site, context);
  const isSlackTriggered = !!(auditContext?.slackContext?.channelId);
  const derived = {
    preferredBase, siteBaseUrl, siteId, isSlackTriggered,
  };

  const explicitResult = buildExplicitCsvResult(context, derived);
  if (explicitResult) {
    return explicitResult;
  }

  const siteStatus = await readSiteStatusJson(siteId, context);

  const stickyBlockResult = buildStickyBotBlockResult(context, { ...derived, siteStatus });
  if (stickyBlockResult) {
    return stickyBlockResult;
  }

  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  const rebasedTopPagesUrls = topPagesUrls.map((url) => rebaseUrl(url, preferredBase, log));
  const rebasedIncludedURLs = ((await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [])
    .map((url) => rebaseUrl(url, preferredBase, log));
  const candidateArgs = {
    siteStatus, rebasedTopPagesUrls, rebasedIncludedURLs, siteBaseUrl,
  };

  const { finalUrls, metrics } = isSlackTriggered
    ? buildSlackTriggeredCandidates(candidateArgs)
    : await buildAutomaticBatchCandidates(context, candidateArgs);

  log.info(`${LOG_PREFIX} prerender_submit_scraping_metrics:
    submittedUrls=${finalUrls.length},
    agenticUrls=${metrics.agenticUrlsCount},
    topPagesUrls=${rebasedTopPagesUrls.length},
    includedURLs=${rebasedIncludedURLs.length},
    filteredOutUrls=${metrics.filteredCount},
    scopeFilteredUrls=${metrics.scopeFilteredCount},
    currentAgentic=${metrics.currentAgentic},
    currentOrganic=${metrics.currentOrganic},
    currentIncludedUrls=${metrics.currentIncludedUrls},
    isFirstRunOfCycle=${metrics.isFirstRunOfCycle},
    agenticNewThisCycle=${metrics.agenticNewThisCycle},
    edgeDeployedUrls=${metrics.edgeDeployedCount},
    baseUrl=${siteBaseUrl},
    siteId=${siteId}`);

  const cappedUrls = isSlackTriggered
    ? finalUrls
    : await applySuggestionCapFilter(context, { siteBaseUrl, siteId, urls: finalUrls });

  return buildScrapeStepResult(
    cappedUrls.map((url) => ({ url })),
    siteId,
    { ...auditContext, generatePrompts: !!auditContext?.generatePrompts },
  );
}
