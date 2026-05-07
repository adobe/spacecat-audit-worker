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
import { convertToOpportunity } from '../../common/opportunity.js';
import { createOpportunityData } from '../opportunity-data-mapper.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

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
export function shouldPreserveDomainWideSuggestion(suggestion) {
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

/**
 * Checks if the domain-wide suggestion (isDomainWide=true) has edgeDeployed set.
 * @param {Object} opportunity - The opportunity object
 * @returns {Promise<boolean>}
 */
export async function getDomainWideSuggestionDeployedAtEdge(opportunity) {
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
export async function markDeployedUrlSuggestionsAsCovered(
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
export async function markNewSuggestionsAsCovered(opportunity, context, deployedAtEdgeUrls) {
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
export async function findPreservableDomainWideSuggestion(opportunity, log) {
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
export async function prepareDomainWideAggregateSuggestion(
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
