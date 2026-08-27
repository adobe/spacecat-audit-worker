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

import { Suggestion } from '@adobe/spacecat-shared-data-access';
import {
  isDomainWideSuggestionData,
  isPathSuggestionData,
  normalizePathnameWithQuery,
} from './utils/utils.js';
import { SUGGESTION_STALENESS_DAYS } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';
const STALENESS_MS = SUGGESTION_STALENESS_DAYS * 24 * 60 * 60 * 1000;

/**
 * True when a suggestion was last touched by a non-system actor (typically a customer email
 * stamped by the PATCH API). Duplicated from isManuallyEditedSuggestion in
 * ../utils/data-access.js (small and stable enough not to warrant a cross-module import).
 * @param {Object} suggestion - Suggestion entity (or mock).
 * @returns {boolean}
 */
function isManuallyEditedSuggestion(suggestion) {
  const updatedBy = suggestion?.getUpdatedBy?.();
  return Boolean(updatedBy && updatedBy !== 'system');
}

/**
 * Statuses protected from stale eviction, beyond OUTDATED/FIXED (checked separately below).
 * Mirrors handleOutdatedSuggestions' excludedStatuses in ../utils/data-access.js — the
 * "disappeared URL" outdating path already refuses to touch these because they represent an
 * operator/customer decision (SKIPPED, REJECTED, APPROVED) or active work in flight
 * (IN_PROGRESS, ERROR-pending-retry). This path must not be looser than that.
 */
const EVICTION_PROTECTED_STATUSES = [
  Suggestion.STATUSES.ERROR,
  Suggestion.STATUSES.SKIPPED,
  Suggestion.STATUSES.REJECTED,
  Suggestion.STATUSES.APPROVED,
  Suggestion.STATUSES.IN_PROGRESS,
];

/**
 * True for an individual per-URL suggestion (not domain-wide/path-type) that is eligible for
 * stale eviction: not already OUTDATED/FIXED, not deployed at the edge, not covered by an
 * active domain-wide deployment, not in a protected status, and not manually edited.
 * @param {Object} suggestion - Suggestion entity
 * @returns {boolean}
 */
function isEligibleForStaleEviction(suggestion) {
  const data = suggestion.getData();
  const status = suggestion.getStatus();
  return !!data?.url
    && !isDomainWideSuggestionData(data)
    && !isPathSuggestionData(data)
    && status !== Suggestion.STATUSES.OUTDATED
    && status !== Suggestion.STATUSES.FIXED
    && !EVICTION_PROTECTED_STATUSES.includes(status)
    && !data.edgeDeployed
    && !data.coveredByDomainWide
    && !isManuallyEditedSuggestion(suggestion);
}

/**
 * Evicts (marks OUTDATED) eligible PRERENDER suggestions whose most recent scrape is more
 * than SUGGESTION_STALENESS_DAYS old (LLMO-7038) — consistent with the customer promise that
 * ABV runs weekly audits. Recency comes from status.json's per-URL scrapedAt (the mergedPages
 * returned by uploadStatusSummaryToS3), stamped on every run regardless of whether that URL's
 * analysis output changed. Missing scrapedAt is treated as stale.
 *
 * Non-critical post-processing, same as uploadStatusSummaryToS3: an empty mergedPages (e.g.
 * that upload failed this run) means we have no reliable recency signal, so eviction is
 * skipped entirely rather than evicting on stale/incomplete data; any failure here is caught
 * and logged rather than allowed to fail an otherwise-successful audit run.
 *
 * @param {Object|null} opportunity - The opportunity object (no-op if null)
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Array<{url: string, scrapedAt: string}>} mergedPages - status.json pages array
 * @returns {Promise<void>}
 */
export async function evictStaleSuggestions(opportunity, context, mergedPages) {
  const { log, site, dataAccess } = context;
  if (!opportunity || typeof opportunity.getSuggestions !== 'function') {
    return;
  }
  if (mergedPages.length === 0) {
    log.warn(`${LOG_PREFIX} Skipping stale suggestion eviction: no status.json page data available this run. baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`);
    return;
  }

  try {
    const scrapedAtByUrl = new Map(
      mergedPages
        .filter((p) => p.url && p.scrapedAt)
        .map((p) => [normalizePathnameWithQuery(p.url), p.scrapedAt]),
    );

    const suggestions = await opportunity.getSuggestions();
    const eligible = suggestions.filter(isEligibleForStaleEviction);

    const staleCutoffMs = Date.now() - STALENESS_MS;
    const toEvict = eligible.filter((s) => {
      const scrapedAt = scrapedAtByUrl.get(normalizePathnameWithQuery(s.getData().url));
      return !scrapedAt || new Date(scrapedAt).getTime() < staleCutoffMs;
    });

    if (toEvict.length === 0) {
      return;
    }

    await dataAccess.Suggestion.bulkUpdateStatus(toEvict, Suggestion.STATUSES.OUTDATED);

    log.info(`${LOG_PREFIX} Stale suggestions evicted: eligible=${eligible.length}, `
      + `staleAfterDays=${SUGGESTION_STALENESS_DAYS}, evicted=${toEvict.length}, `
      + `baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to evict stale suggestions: ${error.message}. baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`, error);
    // Don't throw - this is a non-critical post-processing step; the audit itself succeeded.
  }
}
