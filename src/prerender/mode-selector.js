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

import {
  MODE_AI_ONLY,
  MODE_AI_ONLY_CURRENT,
  MODE_AI_ONLY_MISSING,
} from './utils/constants.js';

const AI_ONLY_MODES = new Set([MODE_AI_ONLY, MODE_AI_ONLY_CURRENT, MODE_AI_ONLY_MISSING]);

/**
 * Returns true when the mode is any AI-only variant (ai-only, ai-only-current, ai-only-missing).
 * @param {string|null} mode - The mode value from data
 * @returns {boolean}
 */
export function isAiOnlyMode(mode) {
  return AI_ONLY_MODES.has(mode);
}

const EXCLUDED_STATUSES = new Set(['OUTDATED', 'SKIPPED', 'FIXED']);

/**
 * Builds a Set of URLs to scope the AI-only request based on mode and DB suggestions.
 *
 * - MODE_AI_ONLY: Returns URLs from eligible suggestions — status is not
 *   OUTDATED, SKIPPED, or FIXED, and not edgeDeployed. This is the base filter
 *   that all AI-only modes share.
 * - MODE_AI_ONLY_CURRENT: Narrows to current-tab suggestions — status === 'NEW',
 *   not coveredByDomainWide, not edgeDeployed, not coveredByPattern.
 * - MODE_AI_ONLY_MISSING: Returns URLs from NEW or FIXED suggestions that have
 *   no aiSummary (falsy — empty string counts as missing).
 *
 * All modes skip suggestions without a URL, with a wildcard '*', or marked isDomainWide.
 *
 * @param {string} mode - The mode constant value
 * @param {Array} suggestions - Array of suggestion objects from opportunity.getSuggestions()
 * @returns {Set<string>} - Set of matching URLs (may be empty)
 */
export function buildUrlScopeForMode(mode, suggestions) {
  const scopeUrls = new Set();

  if (!suggestions) {
    return scopeUrls;
  }

  for (const s of suggestions) {
    const d = s.getData();
    const status = s.getStatus();

    // Common exclusions across all modes
    if (!d?.url || d.isDomainWide || d.url.includes('*')) {
      // eslint-disable-next-line no-continue
      continue;
    }

    if (mode === MODE_AI_ONLY) {
      // Base ai-only: eligible suggestions not stale/dismissed/fixed/deployed
      if (!EXCLUDED_STATUSES.has(status) && !d.edgeDeployed) {
        scopeUrls.add(d.url);
      }
    } else if (mode === MODE_AI_ONLY_CURRENT) {
      // Current-tab: NEW, not covered/deployed/pattern-matched
      if (status === 'NEW' && !d.coveredByDomainWide && !d.edgeDeployed && !d.coveredByPattern) {
        scopeUrls.add(d.url);
      }
    } else if (mode === MODE_AI_ONLY_MISSING) {
      // Missing AI summary: NEW or FIXED, no aiSummary
      if ((status === 'NEW' || status === 'FIXED') && !d.aiSummary) {
        scopeUrls.add(d.url);
      }
    }
  }

  return scopeUrls;
}
