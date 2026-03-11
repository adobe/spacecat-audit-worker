/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit, Opportunity as Oppty, Suggestion as SuggestionDataAccess }
  from '@adobe/spacecat-shared-data-access';
import { hasText, isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/base-audit.js';
import { isUnscrapeable, filterBrokenSuggestedUrls } from '../utils/url-utils.js';
import { syncBrokenInternalLinksSuggestions } from './suggestions-generator.js';
import {
  isLinkInaccessible,
  calculatePriority, calculateKpiDeltasForAudit,
} from './helpers.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { filterByAuditScope, isWithinAuditScope, extractPathPrefix } from './subpath-filter.js';
import {
  detectBrokenLinksFromCrawlBatch,
  mergeAndDeduplicate,
  PAGES_PER_BATCH,
} from './crawl-detection.js';
import {
  saveBatchResults,
  updateCache,
  loadCache,
  markBatchCompleted,
  isBatchCompleted,
  loadFinalResults,
  cleanupBatchState,
  getTimeoutStatus,
} from './batch-state.js';
import {
  buildLinkCheckerQuery,
  submitSplunkJob,
  pollJobStatus,
  fetchJobResults,
} from './linkchecker-splunk.js';
import { createAuditLogger, createContextLogger } from '../common/context-logger.js';
import BrightDataClient, { buildLocaleSearchUrl, extractLocaleFromUrl, localesMatch } from '../support/bright-data-client.js';
import { sleep } from '../support/utils.js';
import { createSplunkClient } from '../support/splunk-client-loader.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const INTERVAL = 30; // days
const AUDIT_TYPE = Audit.AUDIT_TYPES.BROKEN_INTERNAL_LINKS;
const MAX_URLS_TO_PROCESS = 100;
const DEFAULT_LINKCHECKER_MIN_TIME_NEEDED_MS = 5 * 60 * 1000;
/** Max broken links per Mystique batch (batching only) */
const MAX_BROKEN_LINKS = 100;
/** Max broken links to report in audit result and suggestions (backoffice/export limit) */
export const MAX_BROKEN_LINKS_REPORTED = 500;
/**
 * No filtering applied - includes all broken links (404, 5xx, timeouts, network errors).
 * @param {Array} links - Array of broken links
 * @returns {Array} Unfiltered links
 */
function filterByStatusIfNeeded(links) {
  return links; // Include all broken links
}

const BRIGHT_DATA_VALIDATE_URLS = 'BRIGHT_DATA_VALIDATE_URLS';
const BRIGHT_DATA_MAX_RESULTS = 'BRIGHT_DATA_MAX_RESULTS';
const BRIGHT_DATA_REQUEST_DELAY_MS = 'BRIGHT_DATA_REQUEST_DELAY_MS';

function getEnvBool(env, key, defaultValue) {
  if (env?.[key] === undefined) return defaultValue;
  return String(env[key]).toLowerCase() === 'true';
}

function getEnvInt(env, key, defaultValue) {
  const value = Number.parseInt(env?.[key], 10);
  return Number.isFinite(value) ? value : defaultValue;
}

function getLinkCheckerPollingConfig(env) {
  return {
    maxPollAttempts: getEnvInt(env, 'LINKCHECKER_MAX_POLL_ATTEMPTS', 10),
    pollIntervalMs: getEnvInt(env, 'LINKCHECKER_POLL_INTERVAL_MS', 60000),
  };
}

function getInternalLinksHandlerConfig(site) {
  return site?.getConfig?.()?.getHandlers?.()?.['broken-internal-links']?.config || {};
}

function getPositiveIntConfig(value, fallback) {
  const numericValue = Number.parseInt(value, 10);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function getBooleanConfig(value, fallback) {
  if (typeof value === 'boolean') return value;
  /* c8 ignore start - defensive support for string-based configs */
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  /* c8 ignore stop */
  return fallback;
}

function getEnumConfig(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function getMaxUrlsToProcess(site) {
  return getPositiveIntConfig(
    getInternalLinksHandlerConfig(site).maxUrlsToProcess,
    MAX_URLS_TO_PROCESS,
  );
}

function getBatchSize(site) {
  return getPositiveIntConfig(getInternalLinksHandlerConfig(site).batchSize, PAGES_PER_BATCH);
}

function getLinkCheckerMinTimeNeededMs(site) {
  return getPositiveIntConfig(
    getInternalLinksHandlerConfig(site).linkCheckerMinTimeNeededMs,
    DEFAULT_LINKCHECKER_MIN_TIME_NEEDED_MS,
  );
}

function getMaxBrokenLinksPerBatch(site) {
  return getPositiveIntConfig(
    getInternalLinksHandlerConfig(site).maxBrokenLinksPerSuggestionBatch,
    MAX_BROKEN_LINKS,
  );
}

function getMaxBrokenLinksReported(site) {
  return getPositiveIntConfig(
    getInternalLinksHandlerConfig(site).maxBrokenLinksReported,
    MAX_BROKEN_LINKS_REPORTED,
  );
}

function getBrightDataBatchSize(site) {
  return getPositiveIntConfig(getInternalLinksHandlerConfig(site).brightDataBatchSize, 10);
}

function getMaxAlternativeUrlsToSend(site) {
  return getPositiveIntConfig(getInternalLinksHandlerConfig(site).maxAlternativeUrlsToSend, 200);
}

function getBrightDataConfig(site, env) {
  const config = getInternalLinksHandlerConfig(site);
  return {
    validateUrls: config.validateBrightDataUrls
      ?? getEnvBool(env, BRIGHT_DATA_VALIDATE_URLS, false),
    maxResults: getPositiveIntConfig(
      config.brightDataMaxResults,
      getEnvInt(env, BRIGHT_DATA_MAX_RESULTS, 10),
    ),
    requestDelayMs: getPositiveIntConfig(
      config.brightDataRequestDelayMs,
      getEnvInt(env, BRIGHT_DATA_REQUEST_DELAY_MS, 500),
    ),
  };
}

function getLinkCheckerPollingConfigWithOverrides(site, env) {
  const handlerConfig = getInternalLinksHandlerConfig(site);
  const pollingConfig = getLinkCheckerPollingConfig(env);
  return {
    maxPollAttempts: getPositiveIntConfig(
      handlerConfig.linkCheckerMaxPollAttempts,
      pollingConfig.maxPollAttempts,
    ),
    pollIntervalMs: getPositiveIntConfig(
      handlerConfig.linkCheckerPollIntervalMs,
      pollingConfig.pollIntervalMs,
    ),
  };
}

function getScraperOptions(site) {
  const config = getInternalLinksHandlerConfig(site);
  const allowedWaitUntilValues = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'];
  const scrollDurationConfig = config.maxScrollDurationMs ?? config.scrollMaxDurationMs;
  return {
    enableJavascript: getBooleanConfig(config.enableJavascript, true),
    pageLoadTimeout: getPositiveIntConfig(config.pageLoadTimeout, 30000),
    evaluateTimeout: getPositiveIntConfig(config.evaluateTimeout, 10000),
    waitUntil: getEnumConfig(config.waitUntil, allowedWaitUntilValues, 'networkidle2'),
    networkIdleTimeout: getPositiveIntConfig(config.networkIdleTimeout, 2000),
    waitForSelector: config.waitForSelector || 'body',
    rejectRedirects: getBooleanConfig(config.rejectRedirects, false),
    expandShadowDOM: getBooleanConfig(config.expandShadowDOM, true),
    // Internal-links audit enables scrolling by default for better lazy-loaded link coverage.
    scrollToBottom: getBooleanConfig(config.scrollToBottom, true),
    // Hard stop for scrolling to avoid long-running/infinite lazy-load flows.
    maxScrollDurationMs: getPositiveIntConfig(scrollDurationConfig, 30000),
    // Internal-links audit enables load-more by default for lazy-content coverage.
    clickLoadMore: getBooleanConfig(config.clickLoadMore, true),
    loadMoreSelector: hasText(config.loadMoreSelector) ? config.loadMoreSelector : undefined,
    screenshotTypes: Array.isArray(config.screenshotTypes)
      ? config.screenshotTypes.filter((type) => typeof type === 'string')
      : [],
    hideConsentBanners: getBooleanConfig(config.hideConsentBanners, true),
  };
}

/**
 * Updates the audit result with prioritized broken internal links.
 *
 * @param {Object} audit - The audit object
 * @param {Object} auditResult - The current audit result
 * @param {Array} prioritizedLinks - Array of prioritized broken links
 * @param {Object} dataAccess - Data access object containing models
 * @param {Object} log - Logger instance
 */
export async function updateAuditResult(
  audit,
  auditResult,
  prioritizedLinks,
  dataAccess,
  log,
  siteId,
) {
  const updatedAuditResult = {
    ...auditResult,
    brokenInternalLinks: prioritizedLinks,
  };

  // Wrap logger with siteId context
  const contextLog = createAuditLogger(log, AUDIT_TYPE, siteId);

  try {
    const auditId = audit.getId ? audit.getId() : audit.id;

    // Try to update in-memory audit object first
    if (typeof audit.setAuditResult === 'function') {
      audit.setAuditResult(updatedAuditResult);
      await audit.save();
      contextLog.info(`Updated audit result with ${prioritizedLinks.length} prioritized broken links`);
    } else {
      // Fallback: Update via database lookup
      const { Audit: AuditModel } = dataAccess;
      contextLog.info(`Falling back to database lookup for auditId: ${auditId}`);

      const auditToUpdate = await AuditModel.findById(auditId);

      if (auditToUpdate) {
        auditToUpdate.setAuditResult(updatedAuditResult);
        await auditToUpdate.save();
        contextLog.info(`Updated audit result via database lookup with ${prioritizedLinks.length} prioritized broken links`);
      } else {
        contextLog.error(`Could not find audit with ID ${auditId} to update`);
      }
    }
  } catch (error) {
    contextLog.error(`Failed to update audit result: ${error.message}`);
  }

  // Return the updated result so caller can use it directly
  return updatedAuditResult;
}

/** itemTypes excluded from broken-internal-links (handled by canonical/hreflang audits) */
const EXCLUDED_ITEM_TYPES = new Set(['canonical', 'alternate']);

/**
 * Returns true if the link is from a canonical or hreflang tag.
 * Those are covered by dedicated canonical/hreflang audits and should not be
 * counted as broken internal links.
 * @param {Object} link - Link object (may have itemType)
 * @returns {boolean}
 */
function isCanonicalOrHreflangLink(link) {
  return link?.itemType && EXCLUDED_ITEM_TYPES.has(link.itemType);
}

/**
 * Perform an audit to check which internal links for domain are broken.
 * This is the RUM-based detection phase.
 *
 * @async
 * @param {string} auditUrl - The URL to run audit against
 * @param {Object} context - The context object
 * @returns {Object} - Returns audit result (without priority - calculated after merge)
 */
export async function internalLinksAuditRunner(auditUrl, context) {
  const { log: baseLog, site } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());
  const finalUrl = context?.finalUrl || await wwwUrlResolver(site, context);

  log.info('====== RUM Detection Phase ======');
  log.info(`Site: ${site.getId()}, Domain: ${finalUrl}`);

  try {
    // 1. Create RUM API client
    const rumAPIClient = context.rumApiClient || RUMAPIClient.createFrom(context);

    // 2. Prepare query options
    const options = {
      domain: finalUrl,
      interval: INTERVAL,
      granularity: 'hourly',
    };

    log.info(`Querying RUM API for 404 internal links (interval: ${INTERVAL} days)`);

    // 3. Query for 404 internal links
    const internal404Links = await rumAPIClient.query('404-internal-links', options);
    log.info(`Found ${internal404Links.length} 404 internal links from RUM data`);

    if (internal404Links.length === 0) {
      log.info('No 404 internal links found in RUM data');
      log.info('================================');
      return {
        auditResult: {
          brokenInternalLinks: [],
          fullAuditRef: auditUrl,
          finalUrl,
          auditContext: { interval: INTERVAL },
          success: true,
        },
        fullAuditRef: auditUrl,
      };
    }

    // 4. Check accessibility in parallel before transformation
    log.info(`Validating ${internal404Links.length} links to confirm they are still broken...`);

    const accessibilitySettled = await Promise.allSettled(
      internal404Links.map(async (link) => {
        const validation = await isLinkInaccessible(link.url_to, baseLog, site.getId());
        return {
          link,
          validation,
          inaccessible: validation.isBroken,
        };
      }),
    );

    const accessibilityResults = accessibilitySettled
      .filter((result) => {
        if (result.status === 'rejected') {
          log.error(`Link validation failed: ${result.reason}`);
          return false;
        }
        return true;
      })
      .map((result) => result.value);

    // Count validation results
    const stillBroken = accessibilityResults.filter((r) => r.inaccessible).length;
    const nowFixed = accessibilityResults.filter((r) => !r.inaccessible).length;
    const failed = accessibilitySettled.filter((r) => r.status === 'rejected').length;
    log.info(`Validation results: ${stillBroken} still broken, ${nowFixed} now fixed${failed > 0 ? `, ${failed} failed` : ''}`);

    // 5. Filter only inaccessible links and transform for further processing
    // Also filter by audit scope (subpath/locale) if baseURL has a subpath
    const baseURL = site.getBaseURL();

    const inaccessibleLinks = accessibilityResults
      .filter((result) => result.inaccessible)
      .filter((result) => (
        // Filter broken links to only include those within audit scope
        isWithinAuditScope(result.link.url_from, baseURL)
        && isWithinAuditScope(result.link.url_to, baseURL)
      ))
      .map((result) => ({
        // Store URLs as-is (same as crawl) so broken canonicals with wrong encoding are reported
        urlFrom: result.link.url_from,
        urlTo: result.link.url_to,
        trafficDomain: result.link.traffic_domain,
        detectionSource: 'rum',
        // Include HTTP metadata from validation
        httpStatus: result.validation.httpStatus,
        statusBucket: result.validation.statusBucket,
        contentType: result.validation.contentType,
      }));

    // Calculate total traffic impact
    const totalTraffic = inaccessibleLinks.reduce((sum, link) => sum + link.trafficDomain, 0);
    log.info(`RUM detection complete: ${inaccessibleLinks.length} broken links (total traffic: ${totalTraffic} views)`);
    log.info('================================');

    // 6. Prioritize links
    const prioritizedLinks = calculatePriority(inaccessibleLinks);

    // 7. Build and return audit result (cap applied later in opportunityAndSuggestionsStep)
    return {
      auditResult: {
        brokenInternalLinks: prioritizedLinks,
        fullAuditRef: auditUrl,
        finalUrl,
        auditContext: { interval: INTERVAL },
        success: true,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`audit failed with error: ${error.message}`, error);
    return {
      fullAuditRef: auditUrl,
      auditResult: {
        finalUrl: auditUrl,
        error: `audit failed with error: ${error.message}`,
        success: false,
      },
    };
  }
}

/**
 * Step 1: Run RUM detection and trigger import worker to fetch top pages.
 *
 * Returns `type: 'top-pages'` which signals the import worker to:
 * - Fetch Ahrefs top pages
 * - Store them in the database (SiteTopPage)
 * - Return control to next audit step
 */
export async function runAuditAndImportTopPagesStep(context) {
  const { site, log: baseLog, finalUrl } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());

  log.info('====== Step 1: RUM Detection + Import Top Pages ======');
  log.debug('Starting RUM detection audit');

  const internalLinksAuditRunnerResult = await internalLinksAuditRunner(
    finalUrl,
    context,
  );

  const { success } = internalLinksAuditRunnerResult.auditResult;

  if (!success) {
    log.error('RUM detection audit failed');
    throw new Error('Audit failed, skip scraping and suggestion generation');
  }

  log.info(`RUM detection complete. Found ${internalLinksAuditRunnerResult.auditResult.brokenInternalLinks?.length || 0} broken links`);
  log.info('Triggering import worker to fetch Ahrefs top pages');
  log.info('=====================================================');

  return {
    auditResult: internalLinksAuditRunnerResult.auditResult,
    fullAuditRef: finalUrl,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Step 2: Submit URLs for scraping (after import worker has fetched top pages).
 *
 * Flow:
 * 1. Read Ahrefs top pages from database (imported by worker)
 * 2. Get includedURLs from siteConfig
 * 3. Merge, deduplicate, filter by scope, and submit for scraping
 */
export async function submitForScraping(context) {
  const {
    site, dataAccess, log: baseLog, audit,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), audit.getId());
  const { SiteTopPage } = dataAccess;

  const { success } = audit.getAuditResult();

  if (!success) {
    log.error('Audit failed, skip scraping and suggestion generation');
    throw new Error('Audit failed, skip scraping and suggestion generation');
  }

  log.info('====== Step 2: Submit For Scraping ======');

  let topPagesUrls = [];
  try {
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    topPagesUrls = topPages.map((page) => page.getUrl());
    log.info(`Found ${topPagesUrls.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`Failed to fetch Ahrefs top pages from database: ${error.message}`);
    topPagesUrls = [];
  }

  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`Found ${includedURLs.length} includedURLs from siteConfig`);
  const maxUrlsToProcess = getMaxUrlsToProcess(site);

  let finalUrls = [...new Set([...topPagesUrls, ...includedURLs])];
  log.info(`Merged URLs: ${topPagesUrls.length} (Ahrefs) + ${includedURLs.length} (manual) = ${finalUrls.length} unique`);

  const baseURL = site.getBaseURL();
  finalUrls = finalUrls.filter((url) => isWithinAuditScope(url, baseURL));
  log.info(`After audit scope filtering: ${finalUrls.length} URLs`);

  if (finalUrls.length > maxUrlsToProcess) {
    log.warn(`Capping URLs from ${finalUrls.length} to ${maxUrlsToProcess}`);
    finalUrls = finalUrls.slice(0, maxUrlsToProcess);
  }

  const beforeFilter = finalUrls.length;
  finalUrls = finalUrls.filter((url) => !isUnscrapeable(url));
  if (beforeFilter > finalUrls.length) {
    log.info(`Filtered out ${beforeFilter - finalUrls.length} unscrape-able files`);
  }

  if (finalUrls.length === 0) {
    log.warn('No URLs available for scraping');
    log.info('==========================================');
    return {
      auditResult: audit.getAuditResult(),
      fullAuditRef: audit.getFullAuditRef(),
      urls: [],
      siteId: site.getId(),
      type: 'broken-internal-links',
    };
  }

  log.info(`Submitting ${finalUrls.length} URLs for scraping (cache enabled)`);
  log.info('==========================================');

  const scraperOptions = getScraperOptions(site);

  return {
    auditResult: audit.getAuditResult(),
    fullAuditRef: audit.getFullAuditRef(),
    urls: finalUrls.map((url) => ({ url })),
    siteId: site.getId(),
    type: 'broken-internal-links',
    processingType: 'default',
    options: scraperOptions,
  };
}

export const opportunityAndSuggestionsStep = async (context) => {
  const {
    log: baseLog, site, finalUrl, sqs, env, dataAccess, audit, updatedAuditResult,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId());
  const { Suggestion, SiteTopPage } = dataAccess;
  const maxBrokenLinksReported = getMaxBrokenLinksReported(site);
  const maxBrokenLinksPerBatch = getMaxBrokenLinksPerBatch(site);
  const brightDataBatchSize = getBrightDataBatchSize(site);
  const maxAlternativeUrlsToSend = getMaxAlternativeUrlsToSend(site);
  const brightDataConfig = getBrightDataConfig(site, env);

  // Use updated result if passed (from crawl detection), otherwise read from audit
  const auditResultToUse = updatedAuditResult || audit.getAuditResult();
  const { brokenInternalLinks, success } = auditResultToUse;

  if (!success) {
    log.info('Audit failed, skipping suggestions generation');
    return { status: 'complete' };
  }
  // Exclude canonical and hreflang/alternate links; they are covered by dedicated audits
  const brokenInternalLinksFiltered = (brokenInternalLinks || []).filter(
    (link) => !isCanonicalOrHreflangLink(link),
  );

  // Cap here (before suggestions + Mystique); persist for audit/backoffice limit
  const reportedLinks = brokenInternalLinksFiltered.length > maxBrokenLinksReported
    ? brokenInternalLinksFiltered.slice(0, maxBrokenLinksReported)
    : brokenInternalLinksFiltered;
  if (brokenInternalLinksFiltered.length > maxBrokenLinksReported) {
    log.warn(`Capping reported broken links from ${brokenInternalLinksFiltered.length} to ${maxBrokenLinksReported} (priority order)`);
    await updateAuditResult(
      audit,
      auditResultToUse,
      reportedLinks,
      dataAccess,
      baseLog,
      site.getId(),
    );
  }

  if (!isNonEmptyArray(reportedLinks)) {
    // no broken internal links found
    // fetch opportunity
    const { Opportunity } = dataAccess;
    let opportunity;
    try {
      const opportunities = await Opportunity
        .allBySiteIdAndStatus(site.getId(), Oppty.STATUSES.NEW);
      opportunity = opportunities.find((oppty) => oppty.getType() === AUDIT_TYPE);
    } catch (e) {
      log.error(`Fetching opportunities failed with error: ${e.message}`);
      throw new Error(`Failed to fetch opportunities for siteId ${site.getId()}: ${e.message}`);
    }

    if (!opportunity) {
      log.info('no broken internal links found, skipping opportunity creation');
    } else {
      log.info('no broken internal links found, updating opportunity to RESOLVED');
      await opportunity.setStatus(Oppty.STATUSES.RESOLVED);
      const suggestions = await opportunity.getSuggestions();
      if (isNonEmptyArray(suggestions)) {
        await Suggestion.bulkUpdateStatus(suggestions, SuggestionDataAccess.STATUSES.OUTDATED);
      }
      opportunity.setUpdatedBy('system');
      await opportunity.save();
    }
    return { status: 'complete' };
  }

  const kpiDeltas = calculateKpiDeltasForAudit(reportedLinks);

  const opportunity = await convertToOpportunity(
    finalUrl,
    { siteId: site.getId(), id: audit.getId() },
    context,
    createOpportunityData,
    AUDIT_TYPE,
    { kpiDeltas },
  );

  await syncBrokenInternalLinksSuggestions({
    opportunity,
    brokenInternalLinks: reportedLinks,
    context,
    opportunityId: opportunity.getId(),
    log,
  });

  // Fetch Ahrefs top pages with error handling
  let ahrefsTopPages = [];
  try {
    ahrefsTopPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
    log.info(`Found ${ahrefsTopPages.length} top pages from Ahrefs`);
  } catch (error) {
    log.warn(`Failed to fetch Ahrefs top pages: ${error.message}`);
  }

  // Get includedURLs from siteConfig
  const includedURLs = site?.getConfig()?.getIncludedURLs?.('broken-internal-links') || [];
  log.info(`Found ${includedURLs.length} includedURLs from siteConfig`);
  const maxUrlsToProcess = getMaxUrlsToProcess(site);

  // Merge Ahrefs + includedURLs for alternatives
  const includedTopPages = includedURLs.map((url) => ({ getUrl: () => url }));
  let topPages = [...ahrefsTopPages, ...includedTopPages];

  // Limit total pages
  if (topPages.length > maxUrlsToProcess) {
    log.warn(`Capping URLs from ${topPages.length} to ${maxUrlsToProcess}`);
    topPages = topPages.slice(0, maxUrlsToProcess);
  }

  // Filter by audit scope
  const baseURL = site.getBaseURL();
  const filteredTopPages = filterByAuditScope(topPages, baseURL, { urlProperty: 'getUrl' }, log);
  log.info(`After audit scope filtering: ${filteredTopPages.length} top pages available`);

  // Auto-suggest enabled for all sites
  const suggestions = await Suggestion.allByOpportunityIdAndStatus(
    opportunity.getId(),
    SuggestionDataAccess.STATUSES.NEW,
  );

  // Build broken links array for Mystique
  const brokenLinks = suggestions
    .map((suggestion) => ({
      urlFrom: suggestion?.getData()?.urlFrom,
      urlTo: suggestion?.getData()?.urlTo,
      suggestionId: suggestion?.getId(),
    }))
    .filter((link) => link.urlFrom && link.urlTo && link.suggestionId);

  if (brokenLinks.length === 0) {
    log.warn('No valid broken links to process. Skipping.');
    return { status: 'complete' };
  }

  // Bright Data: resolve suggestions first, then fallback to Mystique
  const useBrightData = Boolean(env.BRIGHT_DATA_API_KEY && env.BRIGHT_DATA_ZONE);
  const validateBrightDataUrls = brightDataConfig.validateUrls;
  const brightDataMaxResults = brightDataConfig.maxResults;
  const brightDataRequestDelayMs = brightDataConfig.requestDelayMs;

  const resolvedByBrightData = new Set();
  if (useBrightData && brokenLinks.length > 0) {
    log.info(`Bright Data enabled. Resolving ${brokenLinks.length} broken links (maxResults=${brightDataMaxResults}).`);
    const brightDataClient = BrightDataClient.createFrom(context);

    const processBrokenLink = async (brokenLink) => {
      const searchUrl = buildLocaleSearchUrl(finalUrl || site.getBaseURL(), brokenLink.urlTo);

      const {
        results, keywords,
      } = await brightDataClient.googleSearchWithFallback(
        searchUrl,
        brokenLink.urlTo,
        brightDataMaxResults,
        {
          // Keep common prefixes like "blog" by default (do not strip)
          stripCommonPrefixes: false,
        },
      );

      if (!results || results.length === 0) {
        return;
      }

      // Post-filter: pick the first result whose locale matches the broken link
      const brokenLinkLocale = extractLocaleFromUrl(brokenLink.urlTo);
      const best = results.find((r) => {
        if (!r?.link) return false;
        const suggestedLocale = extractLocaleFromUrl(r.link);
        return localesMatch(brokenLinkLocale, suggestedLocale);
      }) || results[0]; // fall back to first result if no locale match

      if (!best?.link) {
        return;
      }

      let urlsSuggested = [best.link];
      if (validateBrightDataUrls) {
        const validated = await filterBrokenSuggestedUrls(urlsSuggested, site.getBaseURL());
        if (validated.length === 0) {
          return;
        }
        urlsSuggested = validated;
      }

      const suggestion = await Suggestion.findById(brokenLink.suggestionId);
      if (!suggestion) {
        log.warn(`Bright Data: suggestion not found for ${brokenLink.suggestionId}`);
        return;
      }

      suggestion.setData({
        ...suggestion.getData(),
        urlsSuggested,
        aiRationale: `The suggested URL is chosen based on top search results for closely matching keywords from the broken URL. Keywords used: "${keywords}".`,
      });

      await suggestion.save();
      resolvedByBrightData.add(brokenLink.suggestionId);
    };

    for (let i = 0; i < brokenLinks.length; i += brightDataBatchSize) {
      const batch = brokenLinks.slice(i, i + brightDataBatchSize);
      // eslint-disable-next-line no-await-in-loop
      await Promise.allSettled(batch.map((brokenLink) => processBrokenLink(brokenLink)
        .catch((error) => {
          log.warn(`Bright Data failed for ${brokenLink.urlTo}:`, error);
        })));
      if (i + brightDataBatchSize < brokenLinks.length
        && Number.isFinite(brightDataRequestDelayMs)
        && brightDataRequestDelayMs > 0) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(brightDataRequestDelayMs);
      }
    }
  }

  const brokenLinksForMystique = brokenLinks.filter(
    (link) => !resolvedByBrightData.has(link.suggestionId),
  );

  // Filter alternatives by locales present in broken links
  // URLs are already normalized at audit time (step 5 in internalLinksAuditRunner)
  const allTopPageUrls = filteredTopPages.map((page) => page.getUrl());
  const brokenLinkLocales = new Set();
  brokenLinksForMystique.forEach((link) => {
    const locale = extractPathPrefix(link.urlTo);
    if (locale) brokenLinkLocales.add(locale);
  });

  let alternativeUrls = [];
  if (brokenLinkLocales.size > 0) {
    alternativeUrls = allTopPageUrls.filter((url) => {
      const urlLocale = extractPathPrefix(url);
      return !urlLocale || brokenLinkLocales.has(urlLocale);
    });
  } else {
    alternativeUrls = allTopPageUrls;
  }

  // Filter out unscrape-able files
  const originalCount = alternativeUrls.length;
  alternativeUrls = alternativeUrls.filter((url) => !isUnscrapeable(url));
  if (alternativeUrls.length < originalCount) {
    log.info(`Filtered out ${originalCount - alternativeUrls.length} unscrape-able file URLs`);
  }
  /* c8 ignore start - activated for exceptionally large alternative URL sets */
  if (alternativeUrls.length > maxAlternativeUrlsToSend) {
    log.warn(`Capping alternative URLs from ${alternativeUrls.length} to ${maxAlternativeUrlsToSend}`);
    alternativeUrls = alternativeUrls.slice(0, maxAlternativeUrlsToSend);
  }
  /* c8 ignore stop */

  // Validate before sending to Mystique
  if (brokenLinksForMystique.length === 0) {
    log.info('All broken links resolved via Bright Data. Skipping Mystique.');
    return { status: 'complete' };
  }

  if (!opportunity?.getId()) {
    log.error('Opportunity ID is missing. Cannot send to Mystique.');
    return { status: 'complete' };
  }

  if (alternativeUrls.length === 0) {
    log.warn('No alternative URLs available. Skipping message to Mystique.');
    return { status: 'complete' };
  }

  // Batch broken links to stay within SQS message size limit (256KB)
  // Each batch gets its own message with batch metadata for Mystique to reassemble
  const totalBatches = Math.ceil(brokenLinksForMystique.length / maxBrokenLinksPerBatch);

  log.info(`Sending ${brokenLinksForMystique.length} broken links in ${totalBatches} batch(es) to Mystique`);

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
    const batchStart = batchIndex * maxBrokenLinksPerBatch;
    const batchEnd = Math.min(batchStart + maxBrokenLinksPerBatch, brokenLinksForMystique.length);
    const batchLinks = brokenLinksForMystique.slice(batchStart, batchEnd);

    const alternativeUrlsForMessage = [...alternativeUrls];
    let message = {
      type: 'guidance:broken-links',
      siteId: site.getId(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        alternativeUrls: alternativeUrlsForMessage,
        opportunityId: opportunity.getId(),
        brokenLinks: batchLinks,
        // Include canonical domain for Mystique to use when looking up content
        // This ensures Mystique uses the same domain as the normalized URLs
        siteBaseURL: `https://${finalUrl}`,
        // Batch metadata for Mystique to handle multiple messages
        batchInfo: {
          batchIndex,
          totalBatches,
          totalBrokenLinks: brokenLinksForMystique.length,
          batchSize: batchLinks.length,
        },
      },
    };

    /* c8 ignore start - defensive payload-size backoff path */
    while (JSON.stringify(message).length > 240000 && alternativeUrlsForMessage.length > 1) {
      alternativeUrlsForMessage.pop();
      message = {
        ...message,
        data: {
          ...message.data,
          alternativeUrls: alternativeUrlsForMessage,
        },
      };
    }
    /* c8 ignore stop */
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(`Batch ${batchIndex + 1}/${totalBatches} sent to Mystique (${batchLinks.length} links)`);
  }

  log.info(`Successfully sent all ${totalBatches} batch(es) to Mystique`);

  return { status: 'complete' };
};

/**
 * Internal function: Merge all batch results with RUM data and generate opportunities/suggestions.
 * Called by runCrawlDetectionBatch when all batches are complete.
 *
 * @param {Object} context - Audit context
 * @param {Object} options - Options
 * @param {boolean} options.skipCrawlDetection - Whether crawl detection was skipped
 * @param {number} startTime - Lambda start time for timeout tracking
 * @returns {Promise<Object>} Result of opportunityAndSuggestionsStep
 */
export async function finalizeCrawlDetection(
  context,
  { skipCrawlDetection = false },
  startTime = Date.now(),
) {
  const {
    log: baseLog, site, audit, dataAccess,
  } = context;
  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), audit.getId());

  const auditId = audit.getId();
  const shouldCleanup = !skipCrawlDetection;

  // Log timeout status at finalization
  const timeoutStatus = getTimeoutStatus(startTime);
  log.info('====== Finalize: Merge and Generate Suggestions ======');
  log.info(`auditId: ${auditId}`);
  log.info(`Timeout status: ${timeoutStatus.percentUsed.toFixed(1)}% used, ${Math.floor(timeoutStatus.safeTimeRemaining / 1000)}s safe time remaining`);

  /* c8 ignore next 4 - Defensive timeout warning path depends on invocation timing */
  if (timeoutStatus.isApproachingTimeout) {
    log.warn('Limited time for finalization, but all batch data is saved - proceeding with merge');
    log.warn('If timeout occurs, SQS retry will complete finalization (all data persisted)');
  }

  // Get RUM results from audit
  const auditResult = audit.getAuditResult();
  if (auditResult?.internalLinksFinalizedAt) {
    log.info(`Audit already finalized at ${auditResult.internalLinksFinalizedAt}, skipping duplicate finalization`);
    return { status: 'already-finalized' };
  }
  const rumLinks = auditResult.brokenInternalLinks ?? [];
  log.info(`RUM detection results: ${rumLinks.length} broken links`);

  // Get LinkChecker results from context (if available)
  const linkCheckerResults = context.linkCheckerResults ?? [];
  log.info(`LinkChecker detection results: ${linkCheckerResults.length} broken links`);

  let finalLinks = rumLinks;

  try {
    if (!skipCrawlDetection) {
      // Load final results from S3 (loads and merges all batch files)
      const crawlLinks = await loadFinalResults(auditId, context, startTime);
      log.info(`Crawl detected ${crawlLinks.length} broken links`);

      // Transform LinkChecker results to standard format
      /* c8 ignore start - defensive normalization defaults */
      const linkCheckerLinks = linkCheckerResults.map((lc) => ({
        urlFrom: lc.urlFrom,
        urlTo: lc.urlTo,
        anchorText: lc.anchorText || '[no text]',
        itemType: lc.itemType || 'link',
        detectionSource: 'linkchecker',
        trafficDomain: 0, // LinkChecker has no traffic data
        httpStatus: lc.httpStatus,
        statusBucket: lc.httpStatus === '404' || lc.httpStatus === 404 ? '4xx' : 'unknown',
      })).filter((link) => link.urlFrom && link.urlTo);
      /* c8 ignore stop */

      log.info(`LinkChecker links transformed: ${linkCheckerLinks.length} broken links`);

      // 3-way merge: Crawl + LinkChecker + RUM (RUM takes priority for traffic data)
      // First merge crawl + LinkChecker
      const crawlAndLinkCheckerMerged = mergeAndDeduplicate(crawlLinks, linkCheckerLinks, log);
      log.info(`After crawl+LinkChecker merge: ${crawlAndLinkCheckerMerged.length} unique broken links`);

      // Then merge with RUM (RUM overrides traffic data)
      finalLinks = mergeAndDeduplicate(crawlAndLinkCheckerMerged, rumLinks, log);
      log.info(`After 3-way merge (crawl+linkchecker+RUM): ${finalLinks.length} unique broken links`);
    } else {
      log.info('No crawl results to merge, using RUM-only results');
    }

    // No filtering applied - include all broken links
    finalLinks = filterByStatusIfNeeded(finalLinks);

    // Calculate priority for all links (already sorted by traffic; high → medium → low)
    const prioritizedLinks = calculatePriority(finalLinks);

    // Count by priority
    const highPriority = prioritizedLinks.filter((link) => link.priority === 'high').length;
    const mediumPriority = prioritizedLinks.filter((link) => link.priority === 'medium').length;
    const lowPriority = prioritizedLinks.filter((link) => link.priority === 'low').length;
    log.info(`Priority: ${highPriority} high, ${mediumPriority} medium, ${lowPriority} low`);

    // Update audit result with full list; cap applied in opportunityAndSuggestionsStep
    const updatedAuditResult = await updateAuditResult(
      audit,
      {
        ...auditResult,
        internalLinksFinalizedAt: new Date().toISOString(),
      },
      prioritizedLinks,
      dataAccess,
      baseLog,
      site.getId(),
    );

    log.info('=====================================================');

    // Generate opportunities and suggestions (cap applied inside step)
    return opportunityAndSuggestionsStep({ ...context, updatedAuditResult });
  } finally {
    // Always cleanup S3 state file, even if an error occurred
    if (shouldCleanup) {
      await cleanupBatchState(auditId, context).catch((err) => log.warn(`Cleanup failed: ${err.message}`));
    }
  }
}

/**
 * Step: Fetch LinkChecker logs from Splunk.
 * This step runs AFTER crawl detection completes and BEFORE final merge.
 * It submits an async Splunk job, polls until complete or timeout, and stores results.
 *
 * If timeout approaches, it sends an SQS continuation message to resume polling.
 *
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Status object
 */
export async function fetchLinkCheckerLogsStep(context) {
  const startTime = Date.now();
  const {
    log: baseLog, site, audit, sqs, env, skipCrawlDetection = false,
  } = context;

  const auditId = audit.getId();
  const internalLinksConfig = getInternalLinksHandlerConfig(site);
  const enableLinkCheckerDetection = internalLinksConfig.enableLinkCheckerDetection ?? false;

  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), auditId);

  log.info('====== LinkChecker Detection Step ======');
  log.info(`auditId: ${auditId}, enableLinkCheckerDetection: ${enableLinkCheckerDetection}`);

  // Feature flag check
  if (!enableLinkCheckerDetection) {
    log.info('LinkChecker detection disabled in site config, skipping');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }

  // Get AEM program/environment from site config
  const programId = internalLinksConfig.aemProgramId;
  const environmentId = internalLinksConfig.aemEnvironmentId;

  if (!programId || !environmentId) {
    log.warn('Missing AEM programId or environmentId in site config, skipping LinkChecker detection');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }

  /* c8 ignore next - fallback branch when lookback is missing */
  const lookbackMinutes = internalLinksConfig.linkCheckerLookbackMinutes ?? 1440;

  log.info(`Starting LinkChecker detection: programId=${programId}, environmentId=${environmentId}, lookback=${lookbackMinutes}m`);

  try {
    // Build query
    const searchQuery = buildLinkCheckerQuery({
      programId,
      environmentId,
      lookbackMinutes,
    });

    log.info('Submitting Splunk job for LinkChecker logs');

    // Submit job
    const client = await createSplunkClient(context);
    await client.login();

    const sid = await submitSplunkJob(client, searchQuery, log);

    log.info(`Splunk job submitted successfully: sid=${sid}`);

    // Store job ID in audit context for resumption
    const auditContextWithJob = {
      ...context.auditContext,
      linkCheckerJobId: sid,
      linkCheckerStartTime: Date.now(),
    };

    // Poll with timeout awareness
    const { maxPollAttempts, pollIntervalMs } = getLinkCheckerPollingConfigWithOverrides(site, env);

    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      // Check timeout before polling
      const timeoutStatus = getTimeoutStatus(startTime);
      if (timeoutStatus.isApproachingTimeout) {
        log.warn(`Approaching Lambda timeout (${timeoutStatus.percentUsed.toFixed(1)}% used), sending continuation for polling`);

        // Send continuation message
        const continuationPayload = {
          type: AUDIT_TYPE,
          siteId: site.getId(),
          auditContext: {
            next: 'runCrawlDetectionBatch',
            resumePolling: true, // Flag to route to resumeLinkCheckerPollingStep
            auditId,
            auditType: audit.getAuditType(),
            fullAuditRef: audit.getFullAuditRef(),
            ...auditContextWithJob,
            skipCrawlDetection,
          },
        };

        // eslint-disable-next-line no-await-in-loop
        await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
        log.info('Continuation message sent for LinkChecker polling');
        return { status: 'linkchecker-polling-continuation' };
      }

      // Poll status
      // eslint-disable-next-line no-await-in-loop
      const status = await pollJobStatus(client, sid, log);

      if (status.isFailed) {
        log.error(`Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`);
        log.warn('Proceeding to finalization without LinkChecker data');
        return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
      }

      if (status.isDone) {
        log.info(`Splunk job completed after ${attempt} poll(s), fetching results`);
        // eslint-disable-next-line no-await-in-loop
        const linkCheckerResults = await fetchJobResults(client, sid, log);
        log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

        // Store results in context for merge
        const contextWithLinkChecker = {
          ...context,
          linkCheckerResults,
        };

        return finalizeCrawlDetection(contextWithLinkChecker, { skipCrawlDetection }, startTime);
      }

      log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }

    // Max polls reached without completion - send continuation
    log.warn(`Max poll attempts (${maxPollAttempts}) reached, job still running. Sending continuation.`);
    const continuationPayload = {
      type: AUDIT_TYPE,
      siteId: site.getId(),
      auditContext: {
        next: 'runCrawlDetectionBatch',
        resumePolling: true, // Flag to route to resumeLinkCheckerPollingStep
        auditId,
        auditType: audit.getAuditType(),
        fullAuditRef: audit.getFullAuditRef(),
        ...auditContextWithJob,
      },
    };

    await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
    log.info('Continuation message sent for LinkChecker polling (max attempts reached)');
    return { status: 'linkchecker-polling-continuation' };
  } catch (error) {
    log.error(`LinkChecker detection failed: ${error.message}`, error);
    log.warn('Proceeding to finalization without LinkChecker data');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }
}

/**
 * Step: Resume polling for LinkChecker Splunk job.
 * This step is called via SQS continuation when the initial polling times out.
 *
 * @param {Object} context - Lambda context
 * @returns {Promise<Object>} Status object
 */
export async function resumeLinkCheckerPollingStep(context) {
  const startTime = Date.now();
  const {
    log: baseLog, site, audit, auditContext, sqs, env,
  } = context;

  const auditId = audit.getId();
  const sid = auditContext?.linkCheckerJobId;
  /* c8 ignore next - fallback for legacy continuations without timestamp */
  const jobStartTime = auditContext?.linkCheckerStartTime || Date.now();
  const skipCrawlDetection = auditContext?.skipCrawlDetection ?? false;

  const log = createAuditLogger(baseLog, AUDIT_TYPE, site.getId(), auditId);

  log.info('====== LinkChecker Polling Continuation ======');
  log.info(`auditId: ${auditId}, sid: ${sid}`);

  if (!sid) {
    log.error('Missing linkCheckerJobId in auditContext, cannot resume polling');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }

  // Check if job has been running too long (configurable safety limit)
  const totalJobDuration = Date.now() - jobStartTime;
  const maxJobDurationMinutes = (
    getInternalLinksHandlerConfig(site).linkCheckerMaxJobDurationMinutes ?? 60
  );
  const maxJobDuration = maxJobDurationMinutes * 60 * 1000;

  if (totalJobDuration > maxJobDuration) {
    log.warn(`LinkChecker job has been running for ${Math.floor(totalJobDuration / 1000)}s (max ${Math.floor(maxJobDuration / 1000)}s), aborting`);
    log.warn('Proceeding to finalization without LinkChecker data');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }

  try {
    const client = await createSplunkClient(context);
    await client.login();

    // Poll with timeout awareness
    const { maxPollAttempts, pollIntervalMs } = getLinkCheckerPollingConfigWithOverrides(site, env);

    for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
      // Check timeout before polling
      const timeoutStatus = getTimeoutStatus(startTime);
      if (timeoutStatus.isApproachingTimeout) {
        log.warn('Approaching Lambda timeout, sending another continuation for polling');

        // Send continuation message
        const continuationPayload = {
          type: AUDIT_TYPE,
          siteId: site.getId(),
          auditContext: {
            next: 'runCrawlDetectionBatch',
            resumePolling: true, // Flag to route to resumeLinkCheckerPollingStep
            auditId,
            auditType: audit.getAuditType(),
            fullAuditRef: audit.getFullAuditRef(),
            linkCheckerJobId: sid,
            linkCheckerStartTime: jobStartTime,
            skipCrawlDetection,
          },
        };

        // eslint-disable-next-line no-await-in-loop
        await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
        log.info('Continuation message sent for continued polling');
        return { status: 'linkchecker-polling-continuation' };
      }

      // Poll status
      // eslint-disable-next-line no-await-in-loop
      const status = await pollJobStatus(client, sid, log);

      if (status.isFailed) {
        log.error(`Splunk job failed: sid=${sid}, dispatchState=${status.dispatchState}`);
        log.warn('Proceeding to finalization without LinkChecker data');
        return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
      }

      if (status.isDone) {
        log.info(`Splunk job completed after ${attempt} poll(s) in continuation, fetching results`);
        // eslint-disable-next-line no-await-in-loop
        const linkCheckerResults = await fetchJobResults(client, sid, log);
        log.info(`LinkChecker detection found ${linkCheckerResults.length} broken links`);

        // Store results in context for merge
        const contextWithLinkChecker = {
          ...context,
          linkCheckerResults,
        };

        return finalizeCrawlDetection(contextWithLinkChecker, { skipCrawlDetection }, startTime);
      }

      log.info(`Job not ready (attempt ${attempt}/${maxPollAttempts}), waiting ${pollIntervalMs}ms`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, pollIntervalMs);
      });
    }

    // Max polls reached again - send another continuation
    log.warn(`Max poll attempts (${maxPollAttempts}) reached in continuation. Sending another continuation.`);
    const continuationPayload = {
      type: AUDIT_TYPE,
      siteId: site.getId(),
      auditContext: {
        next: 'runCrawlDetectionBatch',
        resumePolling: true, // Flag to route to resumeLinkCheckerPollingStep
        auditId,
        auditType: audit.getAuditType(),
        fullAuditRef: audit.getFullAuditRef(),
        linkCheckerJobId: sid,
        linkCheckerStartTime: jobStartTime,
        skipCrawlDetection,
      },
    };

    await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
    log.info('Continuation message sent for continued polling');
    return { status: 'linkchecker-polling-continuation' };
  } catch (error) {
    log.error(`LinkChecker polling continuation failed: ${error.message}`, error);
    log.warn('Proceeding to finalization without LinkChecker data');
    return finalizeCrawlDetection(context, { skipCrawlDetection }, startTime);
  }
}

/**
 * Send continuation message with retry logic
 */
async function sendContinuationWithRetry({
  auditId,
  nextBatchIndex,
  batchSize = PAGES_PER_BATCH,
  site,
  audit,
  scrapeJobId,
  sqs,
  env,
  log,
}, maxRetries = 3) {
  const continuationPayload = {
    type: AUDIT_TYPE,
    siteId: site.getId(),
    auditContext: {
      next: 'runCrawlDetectionBatch',
      auditId,
      auditType: audit.getAuditType(),
      fullAuditRef: audit.getFullAuditRef(),
      scrapeJobId,
      batchStartIndex: nextBatchIndex,
    },
  };

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, continuationPayload);
      log.info(`Continuation message sent successfully for batch ${Math.floor(nextBatchIndex / batchSize)} (attempt ${attempt + 1})`);
      return;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        log.error(`Failed to send continuation after ${maxRetries} attempts: ${error.message}`);
        log.error(`MANUAL ACTION REQUIRED: Resume audit ${auditId} from batchIndex ${nextBatchIndex}`);
        log.error(`Batch ${Math.floor(nextBatchIndex / batchSize) - 1} is saved. Audit can be resumed.`);
        throw new Error(`Continuation message failed after retries: ${error.message}`);
      }
      log.warn(`Continuation message send failed (attempt ${attempt + 1}), retrying...`);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => {
        setTimeout(resolve, 1000 * (attempt + 1));
      }); // Exponential backoff
    }
  }
}

/**
 * Run crawl-based detection in batches to avoid Lambda timeout.
 * This is the terminal step that processes batchSize pages at a time,
 * loops back to itself via SQS until all pages are processed, then completes
 * the audit by merging results and generating opportunities.
 *
 * State is stored across S3 keys:
 * - batches/batch-N.json: results per batch (idempotent)
 * - cache/urls.json: shared URL cache (atomic merge via ETag)
 * - completed.json: completed batches (atomic merge via ETag)
 *
 * SQS message only contains minimal info (batchStartIndex), caches are loaded from S3.
 */
export async function runCrawlDetectionBatch(context) {
  const startTime = Date.now(); // Track Lambda execution time
  const {
    log: baseLog, site, audit, auditContext, sqs, env,
  } = context;

  const scrapeResultPaths = context.scrapeResultPaths ?? new Map();
  const scrapeJobId = context.scrapeJobId || 'N/A';
  const auditId = audit.getId();
  const batchStartIndex = auditContext?.batchStartIndex || 0;
  const totalPages = scrapeResultPaths.size;
  const batchSize = getBatchSize(site);
  const minTimeNeeded = getLinkCheckerMinTimeNeededMs(site);
  const estimatedTotalBatches = Math.ceil(totalPages / batchSize);
  const currentBatchNum = Math.floor(batchStartIndex / batchSize);

  // Create logger with batch context for better log correlation
  const log = createContextLogger(baseLog, {
    auditType: AUDIT_TYPE,
    siteId: site.getId(),
    auditId,
    batchNum: currentBatchNum,
  });

  log.info(`====== Crawl Detection Batch ${currentBatchNum + 1}/${estimatedTotalBatches || 1} ======`);
  log.info(`scrapeJobId: ${scrapeJobId}, auditId: ${auditId}`);
  log.info(`Total pages: ${totalPages}, Batch size: ${batchSize}, Start index: ${batchStartIndex}`);

  // Log timeout status
  const timeoutStatus = getTimeoutStatus(startTime);
  log.debug(`Timeout status: ${timeoutStatus.percentUsed.toFixed(1)}% used, ${(timeoutStatus.safeTimeRemaining / 1000).toFixed(0)}s safe time remaining`);

  // Special mode: If triggered to start LinkChecker directly
  if (auditContext?.startLinkChecker) {
    log.info('Starting LinkChecker detection (triggered via SQS for fresh Lambda)');
    return fetchLinkCheckerLogsStep(context);
  }

  // Special mode: If triggered to resume LinkChecker polling
  if (auditContext?.resumePolling) {
    log.info('Resuming LinkChecker polling (continuation from previous Lambda)');
    return resumeLinkCheckerPollingStep(context);
  }

  // Handle case with no scraped content
  if (scrapeResultPaths.size === 0) {
    log.info('No scraped content available, proceeding to LinkChecker detection');
    // Direct call - sufficient time in this scenario (no batch processing done)
    return fetchLinkCheckerLogsStep({ ...context, skipCrawlDetection: true });
  }

  // Check if batchStartIndex is already beyond total pages
  if (batchStartIndex >= totalPages) {
    log.info(`Batch start index (${batchStartIndex}) >= total pages (${totalPages}), all batches complete`);
    // Check if we have enough time left for LinkChecker detection
    const currentTimeoutStatus = getTimeoutStatus(startTime);
    if (currentTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
      log.warn(`Only ${Math.floor(currentTimeoutStatus.safeTimeRemaining / 1000)}s remaining, deferring LinkChecker to fresh Lambda`);
      await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, {
        type: AUDIT_TYPE,
        siteId: site.getId(),
        auditContext: {
          ...auditContext,
          next: 'runCrawlDetectionBatch',
          startLinkChecker: true, // Flag to jump directly to LinkChecker
          auditId,
          scrapeJobId,
        },
      });
      return { status: 'linkchecker-deferred' };
    }

    log.info(`${Math.floor(currentTimeoutStatus.safeTimeRemaining / 1000)}s remaining, proceeding to LinkChecker in current Lambda`);
    return fetchLinkCheckerLogsStep(context);
  }

  // Check if this batch already completed (duplicate SQS message)
  if (await isBatchCompleted(auditId, currentBatchNum, context)) {
    log.info(`Batch ${currentBatchNum} already completed (duplicate message), checking for continuation...`);

    // Check if more batches remain
    const hasMorePages = batchStartIndex + batchSize < totalPages;

    if (hasMorePages) {
      log.info('More batches remain, re-sending continuation message (safe duplicate)');
      await sendContinuationWithRetry({
        auditId,
        nextBatchIndex: batchStartIndex + batchSize,
        batchSize,
        site,
        audit,
        scrapeJobId,
        sqs,
        env,
        log,
      });
      return { status: 'already-completed-continuation-sent' };
    }

    log.info('All batches complete (duplicate message), checking time for LinkChecker');
    // Check if we have enough time left for LinkChecker detection
    const duplicateTimeoutStatus = getTimeoutStatus(startTime);
    if (duplicateTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
      log.warn(`Only ${Math.floor(duplicateTimeoutStatus.safeTimeRemaining / 1000)}s remaining, deferring LinkChecker to fresh Lambda`);
      await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, {
        type: AUDIT_TYPE,
        siteId: site.getId(),
        auditContext: {
          ...auditContext,
          next: 'runCrawlDetectionBatch',
          startLinkChecker: true,
          auditId,
          scrapeJobId,
        },
      });
      return { status: 'linkchecker-deferred' };
    }

    log.info('All batches complete, proceeding to finalization');
    return fetchLinkCheckerLogsStep(context);
  }

  // Log timeout status before processing
  const preProcessTimeoutStatus = getTimeoutStatus(startTime);
  log.info(`Starting batch ${currentBatchNum} - time used: ${preProcessTimeoutStatus.percentUsed.toFixed(1)}%`);

  if (preProcessTimeoutStatus.isApproachingTimeout) {
    log.warn(`Starting batch ${currentBatchNum} with limited time remaining (${Math.floor(preProcessTimeoutStatus.safeTimeRemaining / 1000)}s)`);
    log.warn('If timeout occurs, SQS will retry this batch (idempotent processing)');
  }

  // Load cache for this batch
  const { brokenUrlsCache, workingUrlsCache } = await loadCache(auditId, context);
  log.info(`Loaded cache: ${brokenUrlsCache.length} broken, ${workingUrlsCache.length} working URLs`);

  // Process this batch
  log.info(`Processing batch ${currentBatchNum}...`);
  const batchResult = await detectBrokenLinksFromCrawlBatch({
    scrapeResultPaths,
    batchStartIndex,
    batchSize,
    initialBrokenUrls: brokenUrlsCache,
    initialWorkingUrls: workingUrlsCache,
  }, context);

  // Log timeout status after processing
  const postProcessTimeoutStatus = getTimeoutStatus(startTime);
  log.info(`Batch ${currentBatchNum} processing complete: ${batchResult.results.length} broken links, ${batchResult.pagesProcessed} pages`);
  log.info(`Time used: ${postProcessTimeoutStatus.percentUsed.toFixed(1)}% - proceeding to save results`);

  if (postProcessTimeoutStatus.isApproachingTimeout) {
    log.warn(`Limited time remaining (${Math.floor(postProcessTimeoutStatus.safeTimeRemaining / 1000)}s), but proceeding with save operations`);
    log.warn('S3 saves are fast and idempotent - if timeout occurs, retry will complete');
  }

  // Save results (idempotent - safe to overwrite if duplicate)
  await saveBatchResults(
    auditId,
    currentBatchNum,
    batchResult.results,
    batchResult.pagesProcessed,
    context,
  );

  // Update shared cache (atomic with ETag)
  await updateCache(
    auditId,
    batchResult.brokenUrlsCache,
    batchResult.workingUrlsCache,
    context,
  );

  // Mark batch as completed
  await markBatchCompleted(auditId, currentBatchNum, context);

  log.info(`Batch ${currentBatchNum} saved successfully`);

  // Check if more pages remain
  if (batchResult.hasMorePages) {
    const remainingPages = batchResult.totalPages - batchResult.nextBatchStartIndex;
    log.info(`${remainingPages} pages remaining, sending continuation for batch ${currentBatchNum + 1}`);

    await sendContinuationWithRetry({
      auditId,
      nextBatchIndex: batchResult.nextBatchStartIndex,
      batchSize,
      site,
      audit,
      scrapeJobId,
      sqs,
      env,
      log,
    });

    const finalTimeoutStatus = getTimeoutStatus(startTime);
    log.info(`Batch ${currentBatchNum} complete. Time used: ${(finalTimeoutStatus.elapsed / 1000).toFixed(1)}s (${finalTimeoutStatus.percentUsed.toFixed(1)}%)`);

    return { status: 'batch-continuation' };
  }

  log.info(`All ${currentBatchNum + 1} batches complete, checking time for LinkChecker detection`);

  // Check if we have enough time left for LinkChecker detection
  const postBatchTimeoutStatus = getTimeoutStatus(startTime);
  if (postBatchTimeoutStatus.safeTimeRemaining < minTimeNeeded) {
    log.warn(`Only ${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining after batch processing, deferring LinkChecker to fresh Lambda`);
    await sqs.sendMessage(env.AUDIT_JOBS_QUEUE_URL, {
      type: AUDIT_TYPE,
      siteId: site.getId(),
      auditContext: {
        ...auditContext,
        next: 'runCrawlDetectionBatch',
        startLinkChecker: true, // Special flag to jump to LinkChecker
        auditId,
        scrapeJobId,
      },
    });
    return { status: 'linkchecker-deferred' };
  }

  log.info(`All ${currentBatchNum + 1} batches complete, proceeding to finalization`);
  log.info(`${Math.floor(postBatchTimeoutStatus.safeTimeRemaining / 1000)}s remaining, proceeding to LinkChecker in current Lambda`);
  return fetchLinkCheckerLogsStep(context);
}

/**
 * Audit builder with batched crawl detection.
 *
 * Flow:
 * 1. runAuditAndSubmitForScraping - RUM detection, fetches Ahrefs top pages directly,
 *    merges with includedURLs, submits to scrape client
 * 2. runCrawlDetectionBatch - Process pages in batches (terminal step)
 *    - Processes configurable batch size per Lambda invocation
 *    - Stores batch results in S3 with broken/working URL caches
 *    - Loops back to itself via AUDIT_JOBS_QUEUE until all pages processed
 *    - When complete, internally merges results and generates opportunities
 *
 * This batched approach prevents Lambda timeout (15 min limit) by splitting
 * work across multiple invocations, each getting a fresh 15-minute timer.
 */
export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'runAuditAndImportTopPagesStep',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'submitForScraping',
    submitForScraping,
    AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT,
  )
  .addStep('runCrawlDetectionBatch', runCrawlDetectionBatch)
  .build();
