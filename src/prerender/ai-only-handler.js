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
 * runs — it resolves the opportunity, scopes suggestions for the mode, builds the candidate list,
 * and dispatches a `guidance:prerender` request to Mystique (via guidance-request.js), bypassing
 * the normal import/scrape/process steps.
 */

import { Audit } from '@adobe/spacecat-shared-data-access';
import { fetchLatestScrapeJobId, getS3Path } from './utils/utils.js';
import { MODE_AI_ONLY } from './utils/constants.js';
import { buildUrlScopeForMode, getModeFromData } from './mode-selector.js';
import { sendPrerenderGuidanceRequestToMystique } from './guidance-request.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

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

  // Resolve mode early so error returns use the correct value in fullAuditRef.
  // Default to MODE_AI_ONLY when data is malformed — the caller (importTopPages)
  // already verified isAiOnlyMode before dispatching here.
  const mode = getModeFromData(data) || MODE_AI_ONLY;

  // Parse optional params from data field (opportunityId, scrapeJobId, generatePrompts)
  let opportunityId = null;
  let scrapeJobId = null;
  let generatePrompts = false;
  try {
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    if (parsedData) {
      opportunityId = parsedData.opportunityId;
      scrapeJobId = parsedData.scrapeJobId;
      generatePrompts = !!parsedData.generatePrompts;
    }
  } catch (e) {
    // Ignore parse errors
    // Non-JSON data — graceful degradation, values stay at defaults
    log.warn(`${LOG_PREFIX} Failed to parse context.data for opportunityId, scrapeJobId, generatePrompts, defaulting to null, null, false: ${e.message}`);
  }

  log.info(`${LOG_PREFIX} ai-only: Processing AI summary request for baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunityId || 'latest'}, generatePrompts=${generatePrompts}`);

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
        fullAuditRef: `${mode}/failed-${siteId}`,
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
        fullAuditRef: `${mode}/failed-${siteId}`,
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
        fullAuditRef: `${mode}/failed-${siteId}`,
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
      fullAuditRef: `${mode}/failed-${siteId}`,
      auditResult: { error },
    };
  }

  // Fetch suggestions once and build candidates directly — avoids a redundant
  // DB fetch inside sendPrerenderGuidanceRequestToMystique and ensures mode-specific
  // filtering (e.g. including FIXED suggestions for ai-only-missing) is respected.
  const allSuggestions = await opportunity.getSuggestions();

  // Determine which URLs are in scope via explicit CSV or mode-based filter.
  let urlScope = null;
  if (Array.isArray(auditContext?.urls) && auditContext.urls.length > 0) {
    urlScope = new Set(auditContext.urls);
    log.info(`${LOG_PREFIX} ai-only: Scoping to ${urlScope.size} explicit URLs from auditContext. baseUrl=${baseUrl}, siteId=${siteId}`);
  } else {
    urlScope = buildUrlScopeForMode(mode, allSuggestions);
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
    log.info(`${LOG_PREFIX} ai-only: Scoping to ${urlScope.size} URLs from DB suggestions (mode=${mode}). baseUrl=${baseUrl}, siteId=${siteId}`);
  }

  // Build candidates from the already-fetched suggestions so the downstream
  // function receives them as preBuiltCandidates and skips its own filter.
  const candidates = [];
  for (const s of allSuggestions) {
    const d = s.getData();
    if (!d?.url || d.isDomainWide || !urlScope.has(d.url)) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const suggestionId = s.getId?.();

    // Resolve the scrapeJobId in priority order:
    //   1. data.scrapeJobId — stamped at suggestion-creation time
    //   2. data.originalHtmlKey — extract the job segment from the S3 path
    //   3. Neither available → skip
    let effectiveScrapeJobId = d.scrapeJobId;
    if (!effectiveScrapeJobId && d.originalHtmlKey) {
      const parts = d.originalHtmlKey.split('/');
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
      // eslint-disable-next-line no-continue
      continue;
    }

    candidates.push({
      suggestionId,
      url: d.url,
      originalHtmlMarkdownKey: getS3Path(d.url, effectiveScrapeJobId, 'server-side-html.md'),
      markdownDiffKey: getS3Path(d.url, effectiveScrapeJobId, 'markdown-diff.md'),
      hasPrompts: Array.isArray(d.prompts) && d.prompts.length > 0,
    });
  }

  const auditData = {
    siteId,
    auditId: opportunity.getAuditId() || `prerender-ai-only-${siteId}`,
    scrapeJobId,
  };

  let suggestionCount;
  try {
    suggestionCount = await sendPrerenderGuidanceRequestToMystique(
      site.getBaseURL(),
      auditData,
      opportunity,
      context,
      candidates,
      generatePrompts,
    );
  } catch (dispatchError) {
    const error = `Mystique dispatch failed: ${dispatchError.message}`;
    log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
    return {
      error,
      status: 'failed',
      fullAuditRef: `${mode}/failed-${siteId}`,
      auditResult: { error },
    };
  }

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
