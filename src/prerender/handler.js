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
import { detectBotBlocker } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getPreferredBaseUrl } from '../utils/agentic-urls.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { isPaidLLMOCustomer, mergeAndGetUniqueHtmlUrls, normalizePathname } from './utils/utils.js';
import { readSiteStatusJson, uploadStatusSummaryToS3 } from './utils/status-json.js';
import { DAILY_BATCH_SIZE, MODE_AI_ONLY } from './utils/constants.js';
import {
  createScrapeForbiddenOpportunity,
  detectWrongEdgeDeployedStatus,
  markNewSuggestionsAsCovered,
  findPreservableDomainWideSuggestion,
  prepareDomainWideAggregateSuggestion,
} from './utils/opportunity-utils.js';
import {
  rebaseUrl,
  getTopOrganicUrlsFromSeo,
  getTopAgenticUrls,
  getRecentlyProcessedPathnames,
  isNotRecentUrl,
} from './utils/url-selector.js';
import {
  getS3Path,
  compareHtmlContent,
  getModeFromData,
  getScrapeJobStats,
} from './utils/scrape-utils.js';
import { writeToCitabilityRecords } from './utils/citability.js';
import { handleAiOnlyMode } from './ai-only-handler.js';
import { sendPrerenderGuidanceRequestToMystique } from './guidance-handler.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_ERROR_MESSAGE = 'Audit failed';

// Domain-wide suggestion URL format (sync scrapedUrlsSet + prepareDomainWideAggregateSuggestion)
const getDomainWideSuggestionUrl = (baseUrl) => `${baseUrl}/* (All Domain URLs)`;

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

function buildScrapeResult(urls, siteId) {
  return {
    urls: urls.map((url) => ({ url })),
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: { pageLoadTimeout: 20000, storagePrefix: AUDIT_TYPE },
  };
}

function buildSlackBatch(rebasedTopPagesUrls, rebasedIncludedURLs) {
  const { urls: finalUrls, filteredCount } = mergeAndGetUniqueHtmlUrls([
    ...rebasedTopPagesUrls,
    ...rebasedIncludedURLs,
  ]);
  return {
    finalUrls,
    filteredCount,
    agenticUrlsCount: 0,
    currentAgentic: 0,
    currentOrganic: rebasedTopPagesUrls.length,
    currentIncludedUrls: rebasedIncludedURLs.length,
    isFirstRunOfCycle: true,
    agenticNewThisCycle: 0,
    goneUrlsCount: 0,
  };
}

async function buildDailyBatch(
  site,
  context,
  rebasedTopPagesUrls,
  rebasedIncludedURLs,
  topPagesUrls,
) {
  const { log, s3Client, env } = context;
  const siteId = site.getId();

  // Fix 2 — permanent 410 exclusion: build set of URLs to exclude from all future batches
  const { existingPages } = await readSiteStatusJson(
    s3Client,
    env.S3_SCRAPER_BUCKET_NAME,
    siteId,
    log,
  );
  const gonePathnames = new Set(
    existingPages.filter((p) => p.gone).map((p) => normalizePathname(p.url)),
  );

  const agenticUrls = await getTopAgenticUrls(site, context);
  const recentPathnames = await getRecentlyProcessedPathnames(context, siteId);

  const filteredOrganicUrls = rebasedTopPagesUrls
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !gonePathnames.has(normalizePathname(url)));
  const filteredIncludedURLs = rebasedIncludedURLs
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !gonePathnames.has(normalizePathname(url)));
  const filteredAgenticUrls = agenticUrls
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !gonePathnames.has(normalizePathname(url)));

  const orderedCandidateUrls = [
    ...filteredOrganicUrls,
    ...filteredIncludedURLs,
    ...filteredAgenticUrls,
  ];
  const batchedUrls = orderedCandidateUrls.slice(0, DAILY_BATCH_SIZE);

  const organicUrlSet = new Set(filteredOrganicUrls);
  const includedUrlSet = new Set(filteredIncludedURLs);
  const { urls: finalUrls, filteredCount } = mergeAndGetUniqueHtmlUrls(batchedUrls);

  return {
    finalUrls,
    filteredCount,
    agenticUrlsCount: agenticUrls.length,
    currentOrganic: batchedUrls.filter((url) => organicUrlSet.has(url)).length,
    currentIncludedUrls: batchedUrls.filter((url) => includedUrlSet.has(url)).length,
    currentAgentic: batchedUrls.filter(
      (url) => !organicUrlSet.has(url) && !includedUrlSet.has(url),
    ).length,
    isFirstRunOfCycle: filteredOrganicUrls.length === topPagesUrls.length,
    agenticNewThisCycle: filteredAgenticUrls.length,
    goneUrlsCount: gonePathnames.size,
  };
}

/**
 * Step 2: Submit URLs for scraping OR skip if in ai-only mode
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata OR ai-only result
 */
export async function submitForScraping(context) {
  const {
    site, log, data, auditContext,
  } = context;

  // Check for AI-only mode - skip scraping step (step 1 already triggered Mystique)
  const mode = getModeFromData(data);
  if (mode === MODE_AI_ONLY) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();

  // CSV explicit URLs path (triggered via audit context override)
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
    return buildScrapeResult(explicitUrls, siteId);
  }

  // When triggered from Slack, skip agentic sources, daily batching, and domain block check
  const isSlackTriggered = !!(auditContext?.slackContext?.channelId);

  // Fix 3 — proactive bot-block check before expensive URL fetches (not applicable for Slack)
  if (!isSlackTriggered) {
    const { crawlable, confidence } = await detectBotBlocker({ baseUrl: site.getBaseURL() });
    if (!crawlable && confidence >= 0.95) {
      log.info(`${LOG_PREFIX} Domain blocked (confidence=${confidence}), skipping siteId=${siteId}, baseUrl=${site.getBaseURL()}`);
      return { ...buildScrapeResult([], siteId), skippedReason: 'domainBlocked' };
    }
  }

  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  const preferredBase = getPreferredBaseUrl(site, context);
  const rebasedTopPagesUrls = topPagesUrls.map((url) => rebaseUrl(url, preferredBase, log));
  const rebasedIncludedURLs = ((await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [])
    .map((url) => rebaseUrl(url, preferredBase, log));

  const batch = isSlackTriggered
    ? buildSlackBatch(rebasedTopPagesUrls, rebasedIncludedURLs)
    : await buildDailyBatch(site, context, rebasedTopPagesUrls, rebasedIncludedURLs, topPagesUrls);

  const {
    finalUrls, filteredCount, agenticUrlsCount, currentAgentic,
    currentOrganic, currentIncludedUrls, isFirstRunOfCycle, agenticNewThisCycle, goneUrlsCount,
  } = batch;

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
    goneUrls=${goneUrlsCount},
    baseUrl=${site.getBaseURL()},
    siteId=${siteId}`);

  if (finalUrls.length === 0) {
    // Fallback to base URL if no URLs found
    const baseURL = getPreferredBaseUrl(site, context);
    log.info(`${LOG_PREFIX} No URLs found, falling back to baseUrl=${baseURL}, siteId=${site.getId()}`);
    finalUrls.push(baseURL);
  }

  return buildScrapeResult(finalUrls, siteId);
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
