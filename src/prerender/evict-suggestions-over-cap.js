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
import { MAX_ACTIVE_SUGGESTIONS } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';

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
 * Statuses protected from cap eviction, beyond OUTDATED/FIXED (checked separately below).
 * Mirrors handleOutdatedSuggestions' excludedStatuses in ../utils/data-access.js — the
 * "disappeared URL" outdating path already refuses to touch these because they represent an
 * operator/customer decision (SKIPPED, REJECTED, APPROVED) or active work in flight
 * (IN_PROGRESS, ERROR-pending-retry). The cap-based eviction path must not be looser than
 * that: it should never force-outdate a suggestion the normal sync logic would leave alone.
 */
const CAP_PROTECTED_STATUSES = [
  Suggestion.STATUSES.ERROR,
  Suggestion.STATUSES.SKIPPED,
  Suggestion.STATUSES.REJECTED,
  Suggestion.STATUSES.APPROVED,
  Suggestion.STATUSES.IN_PROGRESS,
];

/**
 * Determines whether a suggestion counts toward the active-suggestion cap and is eligible
 * for eviction (LLMO-6533/LLMO-6638): an individual per-URL suggestion (not domain-wide or
 * path-type) that is not already OUTDATED or FIXED, not deployed at the edge, not covered by
 * an active domain-wide deployment, not in a protected status (see CAP_PROTECTED_STATUSES),
 * and not manually edited by a customer. Those states are either already resolved, off the
 * Current tab, reflect a deliberate decision, or are otherwise protected — excluded from
 * both the count and eviction.
 * @param {Object} suggestion - Suggestion entity
 * @returns {boolean}
 */
function isCapEligibleSuggestion(suggestion) {
  const data = suggestion.getData();
  const status = suggestion.getStatus();
  return !!data?.url
    && !isDomainWideSuggestionData(data)
    && !isPathSuggestionData(data)
    && status !== Suggestion.STATUSES.OUTDATED
    && status !== Suggestion.STATUSES.FIXED
    && !CAP_PROTECTED_STATUSES.includes(status)
    && !data.edgeDeployed
    && !data.coveredByDomainWide
    && !isManuallyEditedSuggestion(suggestion);
}

/**
 * Enforces the domain-wide active-suggestion cap (LLMO-6533/LLMO-6638) by evicting the
 * least-recently-scraped suggestions once the count exceeds MAX_ACTIVE_SUGGESTIONS.
 *
 * Recency comes from status.json's per-URL scrapedAt (the mergedPages returned by
 * uploadStatusSummaryToS3), which is stamped on every run regardless of whether that URL's
 * analysis output changed. A URL that keeps showing up in agentic/organic/included traffic
 * naturally stays "fresh" and is never evicted; only URLs that stop appearing in the daily
 * batch age out — so the active set is always the most recently-scraped
 * MAX_ACTIVE_SUGGESTIONS URLs, a rolling window driven by the live input source.
 *
 * Non-critical post-processing, same as uploadStatusSummaryToS3: an empty mergedPages
 * (e.g. that upload failed this run) means we have no reliable recency signal, so eviction
 * is skipped entirely rather than evicting in an arbitrary order; and any failure here is
 * caught and logged rather than allowed to fail an otherwise-successful audit run.
 *
 * @param {Object|null} opportunity - The opportunity object (no-op if null)
 * @param {Object} context - Audit context with dataAccess and log
 * @param {Array<{url: string, scrapedAt: string}>} mergedPages - status.json pages array
 * @returns {Promise<void>}
 */
export async function evictOldestSuggestionsOverCap(opportunity, context, mergedPages) {
  const { log, site, dataAccess } = context;
  if (!opportunity || typeof opportunity.getSuggestions !== 'function') {
    return;
  }
  if (mergedPages.length === 0) {
    log.warn(`${LOG_PREFIX} Skipping suggestion cap eviction: no status.json page data available this run. baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`);
    return;
  }

  try {
    const scrapedAtByUrl = new Map(
      mergedPages
        .filter((p) => p.url && p.scrapedAt)
        .map((p) => [normalizePathnameWithQuery(p.url), p.scrapedAt]),
    );

    const suggestions = await opportunity.getSuggestions();
    const eligible = suggestions.filter(isCapEligibleSuggestion);

    const overflow = eligible.length - MAX_ACTIVE_SUGGESTIONS;
    if (overflow <= 0) {
      return;
    }

    // Missing scrapedAt (shouldn't normally happen, since status.json pages only grow) sorts
    // first via '' — treated as the oldest, so it's evicted before any dated entry.
    const getScrapedAt = (s) => scrapedAtByUrl.get(normalizePathnameWithQuery(s.getData().url)) ?? '';
    const toEvict = [...eligible]
      .sort((a, b) => getScrapedAt(a).localeCompare(getScrapedAt(b)))
      .slice(0, overflow);

    await dataAccess.Suggestion.bulkUpdateStatus(toEvict, Suggestion.STATUSES.OUTDATED);

    log.info(`${LOG_PREFIX} Active suggestion cap exceeded: eligible=${eligible.length}, `
      + `cap=${MAX_ACTIVE_SUGGESTIONS}, evicted=${toEvict.length}, `
      + `baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to enforce active-suggestion cap: ${error.message}. baseUrl=${site.getBaseURL()}, siteId=${site.getId()}`, error);
    // Don't throw - this is a non-critical post-processing step; the audit itself succeeded.
  }
}
