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
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';
import { sendPrerenderGuidanceRequestToMystique } from './mystique-sender.js';
import { getS3Path, toPathname } from './utils/utils.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

const getDomainWideSuggestionUrl = (baseUrl) => `${baseUrl}/* (All Domain URLs)`;
const DOMAIN_WIDE_SUGGESTION_KEY = 'domain-wide-aggregate|prerender';

function isDomainWideSuggestionData(data) {
  return !!data?.isDomainWide;
}

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
 * @param {Object} dataAccess - Data access layer
 * @param {string} siteId - Site ID to look up the opportunity
 * @param {string} auditUrl - Base URL for log context
 * @param {Object} log - Logger
 */
export async function detectWrongEdgeDeployedStatus(dataAccess, siteId, auditUrl, log) {
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
 * Marks NEW suggestions as coveredByDomainWide when the domain-wide suggestion has edgeDeployed.
 * @param {Object|null} opportunity - The opportunity object (no-op if null)
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Set<string>} deployedAtEdgePathnames - Pathnames confirmed deployed at edge in this run
 * @returns {Promise<void>}
 */
export async function markNewSuggestionsAsCovered(opportunity, context, deployedAtEdgePathnames) {
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

async function prepareDomainWideAggregateSuggestion(preRenderSuggestions, baseUrl, context) {
  const { log } = context;

  const auditedUrls = preRenderSuggestions.map((s) => s.url);
  const auditedUrlCount = auditedUrls.length;

  const totalContentGainRatio = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.contentGainRatio || 0),
    0,
  );
  const totalWordCountBefore = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.wordCountBefore || 0),
    0,
  );
  const totalWordCountAfter = preRenderSuggestions.reduce(
    (sum, s) => sum + (s.wordCountAfter || 0),
    0,
  );
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

  const allowedRegexPatterns = ['/*'];

  const domainWideSuggestionData = {
    url: getDomainWideSuggestionUrl(baseUrl),
    contentGainRatio: totalContentGainRatio > 0 ? Number(totalContentGainRatio.toFixed(2)) : 0,
    wordCountBefore: totalWordCountBefore,
    wordCountAfter: totalWordCountAfter,
    aiReadablePercent: totalAiReadablePercent,
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
 * Clears outdated suggestions when no URLs need prerendering (Branch C of the 3-way branch).
 * Finds an existing NEW prerender opportunity and calls syncSuggestions with empty newData
 * so suggestions for scraped URLs are marked OUTDATED.
 *
 * @param {string} siteId - Site ID
 * @param {Set<string>} scrapedUrlsSet - Set of successfully-scraped URL strings
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<Object|null>} The existing opportunity, or null if none found
 */
export async function clearOutdatedSuggestions(siteId, scrapedUrlsSet, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  const existingOpportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

  if (!existingOpportunity) {
    return null;
  }

  // Normalize scraped URLs to pathnames so domain shifts don't prevent outdating suggestions.
  const scrapedPathnames = new Set([...scrapedUrlsSet].map(toPathname));
  const scrapedUrlsForNoOppty = {
    has: (url) => scrapedPathnames.has(toPathname(url)),
  };
  await syncSuggestions({
    opportunity: existingOpportunity,
    newData: [],
    context,
    buildKey: (suggestionData) => toPathname(suggestionData.url),
    mapNewSuggestion: () => ({}),
    scrapedUrlsSet: scrapedUrlsForNoOppty,
  });

  log.info(`${LOG_PREFIX} clearOutdatedSuggestions: synced with empty newData. siteId=${siteId}`);
  return existingOpportunity;
}

/**
 * Creates a notification opportunity when scraping is forbidden.
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
    auditData,
  );
}

/**
 * Processes opportunities and suggestions for prerender audit results.
 * Persists suggestions so they can later be enriched with AI guidance from Mystique.
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

  const scrapedUrlsSet = rawScrapedUrlsSet ? (() => {
    const pathnames = new Set(
      [...rawScrapedUrlsSet].map(toPathname),
    );
    return {
      has: (url) => pathnames.has(toPathname(url)),
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
    auditData,
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

  const buildKey = (data) => {
    if (data.key) {
      return data.key;
    }
    return toPathname(data.url);
  };

  const mapSuggestionData = (suggestion) => ({
    url: suggestion.url,
    contentGainRatio: suggestion.contentGainRatio,
    wordCountBefore: suggestion.wordCountBefore,
    wordCountAfter: suggestion.wordCountAfter,
    citabilityScore: suggestion.citabilityScore ?? null,
    scrapeJobId: auditData.scrapeJobId,
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
    mergeDataFunction: (existingData, newDataItem) => {
      if (newDataItem.key) {
        return { ...newDataItem.data };
      }
      /* c8 ignore next 5 */
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
 * Routes to the correct opportunity branch and marks edge-deployed suggestions.
 *
 * Branch A (urlsNeedingPrerender > 0): create/update opportunity + queue Mystique
 * Branch B (scrapeForbidden=true):     create dummy scrapeForbidden opportunity
 * Branch C (neither):                  clear outdated suggestions from any existing opportunity
 *
 * Calls markNewSuggestionsAsCovered after the branch to handle domain-wide edge deployment.
 *
 * @param {Object} context - Audit context (site, audit, log, dataAccess, ...)
 * @param {Object} opts
 * @param {Array}   opts.urlsNeedingPrerender   - Comparison results where needsPrerender=true
 * @param {Object}  opts.botBlockResult         - { scrapeForbidden, scrapeForbiddenSince }
 * @param {Object}  opts.auditResult            - Full audit result from buildAuditResult
 * @param {string}  opts.scrapeJobId            - Scrape job ID for this run
 * @param {Object}  opts.scrapedUrlsSet         - Pathname-normalised set from buildAuditResult
 * @param {Array}   opts.successfulComparisons  - Non-error comparison results
 * @param {number}  opts.scrapeForbiddenCount   - 403 count (used only for Branch C log)
 * @param {boolean} opts.isPaid                 - Whether the customer is a paid LLMO customer
 */
export async function routeOpportunityBranch(context, {
  urlsNeedingPrerender,
  botBlockResult,
  auditResult,
  scrapeJobId,
  scrapedUrlsSet,
  successfulComparisons,
  scrapeForbiddenCount,
  isPaid,
}) {
  const { site, audit, log } = context;
  const baseUrl = site.getBaseURL();
  const siteId = site.getId();
  const auditId = audit.getId();

  let opportunityWithSuggestions = null;

  if (urlsNeedingPrerender.length > 0) {
    const { opportunity, auditRunCandidates } = await processOpportunityAndSuggestions(
      baseUrl,
      {
        siteId,
        id: auditId,
        auditId,
        auditResult,
        scrapeJobId,
        scrapedUrlsSet,
      },
      context,
      isPaid,
    );
    opportunityWithSuggestions = opportunity;
    await sendPrerenderGuidanceRequestToMystique(
      baseUrl,
      { siteId, auditId, scrapeJobId },
      opportunity,
      context,
      auditRunCandidates,
    );
  } else if (botBlockResult.scrapeForbidden) {
    await createScrapeForbiddenOpportunity(
      baseUrl,
      {
        siteId,
        id: auditId,
        auditId,
        auditResult,
        scrapeJobId,
      },
      context,
      isPaid,
    );
  } else {
    log.info(`${LOG_PREFIX} No opportunity found. baseUrl=${baseUrl}, siteId=${siteId}, scrapeForbidden=${botBlockResult.scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, isPaidLLMOCustomer=${isPaid}`);
    opportunityWithSuggestions = await clearOutdatedSuggestions(siteId, scrapedUrlsSet, context);
  }

  const deployedAtEdgePathnames = new Set(
    successfulComparisons.filter((r) => r.isDeployedAtEdge).map((r) => toPathname(r.url)),
  );
  await markNewSuggestionsAsCovered(opportunityWithSuggestions, context, deployedAtEdgePathnames);
}
