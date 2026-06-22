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

/**
 * AI-only mode handling.
 *
 * `handleAiOnlyMode` is the entry point for `audit:prerender mode:ai-only[-current|-missing]`
 * runs — it resolves the opportunity, scopes suggestions for the mode, and dispatches a
 * `guidance:prerender` request to Mystique (via guidance-request.js), bypassing the normal
 * import/scrape/process steps.
 */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { fetchLatestScrapeJobId, getS3Path } from './utils/utils.js';
import { MODE_AI_ONLY } from './utils/constants.js';
import { buildUrlScopeForMode, getModeFromData } from './mode-selector.js';
import { sendPrerenderGuidanceRequestToMystique } from './guidance-request.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * Builds the Mystique candidate list for ai-only mode from the in-scope DB suggestions.
 *
 * Per-mode eligibility (e.g. excluding FIXED for ai-only, including FIXED-without-summary for
 * ai-only-missing) is already decided by buildUrlScopeForMode — or by the explicit CSV set — so
 * this only narrows to urlScope, skips domain-wide / URL-less suggestions, resolves each
 * suggestion's scrapeJobId (from data.scrapeJobId, else derived from data.originalHtmlKey), and
 * builds the S3 markdown keys.
 *
 * @param {Array} suggestions - The opportunity's DB suggestions
 * @param {Set<string>} urlScope - URLs eligible for this run (mode-derived or explicit CSV)
 * @param {Object} log - Logger
 * @param {string} siteId - Site ID (log context)
 * @param {string} baseUrl - Site base URL (log context)
 * @returns {Array} - Candidate objects to send to Mystique
 */
function buildAiOnlyCandidates(suggestions, urlScope, log, siteId, baseUrl) {
  const candidates = [];

  (suggestions || []).forEach((s) => {
    const data = s.getData();

    // Skip domain-wide aggregate, URL-less, and out-of-scope suggestions.
    if (!data?.url || data.isDomainWide || !urlScope.has(data.url)) {
      return;
    }

    const suggestionId = s.getId?.();

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
      // Signal whether this suggestion already has prompts so Mystique can skip re-generation
      hasPrompts: Array.isArray(data.prompts) && data.prompts.length > 0,
    });
  });

  return candidates;
}

/**
 * Parses the optional ai-only params (opportunityId, scrapeJobId, generatePrompts) from the
 * audit `data` field. Non-JSON data degrades gracefully to defaults with a warning.
 * @param {string|Object|null} data - The audit data field
 * @param {Object} log - Logger
 * @returns {{opportunityId: string|null, scrapeJobId: string|null, generatePrompts: boolean}}
 */
function parseAiOnlyParams(data, log) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (parsed) {
      return {
        opportunityId: parsed.opportunityId ?? null,
        scrapeJobId: parsed.scrapeJobId ?? null,
        generatePrompts: !!parsed.generatePrompts,
      };
    }
  } catch (e) {
    // Non-JSON data — graceful degradation, values stay at defaults
    log.warn(`${LOG_PREFIX} Failed to parse context.data for opportunityId, scrapeJobId, generatePrompts, defaulting to null, null, false: ${e.message}`);
  }
  return { opportunityId: null, scrapeJobId: null, generatePrompts: false };
}

/**
 * Resolves the target opportunity for an ai-only run: by explicit id when provided,
 * otherwise the latest NEW prerender opportunity for the site.
 * @returns {Promise<Object|null>} - The opportunity, or null when none is found
 */
async function resolveAiOnlyOpportunity(Opportunity, opportunityId, siteId, baseUrl, log) {
  if (opportunityId) {
    return Opportunity.findById(opportunityId);
  }
  const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  const opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);
  if (opportunity) {
    log.info(`${LOG_PREFIX} ai-only: Found latest NEW opportunity: ${opportunity.getId()} for baseUrl=${baseUrl}, siteId=${siteId}`);
  }
  return opportunity ?? null;
}

/**
 * Handles AI-summary-only mode: sends existing suggestions to Mystique without running audit.
 * Called early in step 1 to bypass import/scraping/processing steps.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Result indicating success/failure
 */
export async function handleAiOnlyMode(context) {
  const {
    site, log, dataAccess, data, auditContext,
  } = context;
  const { Opportunity } = dataAccess;
  const siteId = site.getId();
  const baseUrl = site.getBaseURL();
  // Default to MODE_AI_ONLY when data is malformed — we already know we're in ai-only
  // because the caller (importTopPages) verified isAiOnlyMode before dispatching here.
  const mode = getModeFromData(data) || MODE_AI_ONLY;

  // Shared failure result: log + the standard failed envelope.
  const failAiOnly = (error) => {
    log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
    return {
      error,
      status: 'failed',
      fullAuditRef: `${mode}/failed-${siteId}`,
      auditResult: { error },
    };
  };

  const {
    opportunityId, scrapeJobId: providedScrapeJobId, generatePrompts,
  } = parseAiOnlyParams(data, log);

  log.info(`${LOG_PREFIX} ai-only: Processing AI summary request for baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunityId || 'latest'}, generatePrompts=${generatePrompts}`);

  // Resolve scrapeJobId: from data, else from status.json.
  let scrapeJobId = providedScrapeJobId;
  if (!scrapeJobId) {
    log.info(`${LOG_PREFIX} ai-only: scrapeJobId not provided, fetching from status.json for baseUrl=${baseUrl}, siteId=${siteId}`);
    scrapeJobId = await fetchLatestScrapeJobId(siteId, context);
    if (!scrapeJobId) {
      return failAiOnly('scrapeJobId not found. Either provide it in data or ensure a prerender audit has run recently.');
    }
  }

  // Resolve the opportunity (by id, or latest NEW) and verify it belongs to the site.
  const opportunity = await resolveAiOnlyOpportunity(
    Opportunity,
    opportunityId,
    siteId,
    baseUrl,
    log,
  );
  if (!opportunity) {
    return failAiOnly(opportunityId
      ? `Opportunity not found: ${opportunityId}`
      : `No NEW prerender opportunity found for site: ${siteId}`);
  }
  if (opportunity.getSiteId() !== siteId) {
    return failAiOnly(`Opportunity ${opportunity.getId()} does not belong to site ${siteId}`);
  }

  // Build URL scope: explicit URLs (CSV batch) take priority, otherwise derive from the mode.
  // Fetch suggestions once and reuse them for both the scope and the candidate build.
  const suggestions = await opportunity.getSuggestions();
  const explicitUrls = Array.isArray(auditContext?.urls) ? auditContext.urls : [];
  const urlScope = explicitUrls.length > 0
    ? new Set(explicitUrls)
    : buildUrlScopeForMode(mode, suggestions);

  if (urlScope.size === 0) {
    log.info(`${LOG_PREFIX} ai-only: No suggestions match mode=${mode} for baseUrl=${baseUrl}, siteId=${siteId}`);
    return {
      status: 'complete',
      mode,
      opportunityId: opportunity.getId(),
      fullAuditRef: `${mode}/${opportunity.getId()}`,
      auditResult: { message: 'No suggestions match the requested mode', suggestionCount: 0 },
    };
  }

  const scopeSource = explicitUrls.length > 0 ? 'explicit auditContext' : `DB suggestions (mode=${mode})`;
  log.info(`${LOG_PREFIX} ai-only: Scoping to ${urlScope.size} URLs from ${scopeSource}. baseUrl=${baseUrl}, siteId=${siteId}`);

  const candidates = buildAiOnlyCandidates(suggestions, urlScope, log, siteId, baseUrl);

  // Dispatch the pre-built candidates to Mystique.
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
    candidates,
    generatePrompts,
  );

  log.info(`${LOG_PREFIX} ai-only: Successfully queued AI summary request for ${suggestionCount} suggestion(s). baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunity.getId()}`);

  return {
    status: 'complete',
    mode,
    opportunityId: opportunity.getId(),
    fullAuditRef: `${mode}/${opportunity.getId()}`,
    auditResult: {
      message: `AI summary generation queued successfully for ${suggestionCount} suggestion(s)`,
      suggestionCount,
    },
  };
}
