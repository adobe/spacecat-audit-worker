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

import { getAgenticHitsMapFromAthena } from '../../../utils/agentic-urls.js';
import {
  isPathSuggestionData,
  extractPathType,
  shouldPreservePathSuggestion,
  isEligibleStatus,
  toPathname,
} from '../../utils/utils.js';
import { RcvPathQualificationStrategy } from './strategies/rcv-path-qualification-strategy.js';

// Re-export so callers can import strategy alongside suggestion functions
export { RcvPathQualificationStrategy, extractPathType };

const LOG_PREFIX = '[prerender][path-suggestions]';

/**
 * Finds existing path suggestions that should be preserved (not overwritten).
 *
 * @param {Object} opportunity - SpaceCat opportunity entity
 * @param {Object} log - Logger
 * @param {Array} [suggestions] - Pre-fetched suggestions (avoids redundant DB call)
 * @returns {Promise<Array>}
 */
export async function findPreservablePathSuggestions(opportunity, log, suggestions) {
  const existingSuggestions = suggestions ?? await opportunity.getSuggestions();
  const preservable = existingSuggestions.filter((s) => {
    const d = s.getData();
    return isPathSuggestionData(d) && shouldPreservePathSuggestion(s);
  });
  log.debug(`${LOG_PREFIX} Found ${preservable.length} preservable path suggestions`);
  return preservable;
}

/**
 * Builds path-level suggestions from per-URL audit results.
 * Only URLs with an existing NEW or FIXED suggestion in the DB are eligible for scoring.
 *
 * @param {Array} preRenderSuggestions - Raw audit results (url, contentGainRatio, wordCount*)
 * @param {Object} opportunity - SpaceCat opportunity entity
 * @param {Object} site - SpaceCat site entity
 * @param {Object} context - Audit context (log, etc.)
 * @param {Object} [options] - Optional overrides
 * @param {Object} [options.strategy] - Qualification strategy
 *   (default: RcvPathQualificationStrategy)
 * @param {Array} [options.suggestions] - Pre-fetched suggestions (avoids redundant DB call)
 * @returns {Promise<Array>} Array of { key, data } path suggestion objects
 */
export async function buildPathTypeSuggestions(
  preRenderSuggestions,
  opportunity,
  site,
  context,
  { strategy = new RcvPathQualificationStrategy(), suggestions } = {},
) {
  const { log } = context;

  // 1. Fetch agentic hits map from Athena (4-week window)
  const agenticHitsMap = await getAgenticHitsMapFromAthena(site, context).catch((e) => {
    log.warn(`${LOG_PREFIX} Failed to fetch agentic hits for path scoring: ${e.message}`);
    return new Map();
  });

  // 2. Read existing suggestions — only NEW or FIXED per-URL suggestions are eligible
  const existingSuggestions = suggestions ?? await opportunity.getSuggestions();
  const eligibleSuggestions = existingSuggestions.filter((s) => {
    const d = s.getData();
    if (isPathSuggestionData(d) || d?.isDomainWide) {
      return false;
    }
    return isEligibleStatus(s.getStatus());
  });

  const { eligiblePathnames, valuableByPathname } = eligibleSuggestions.reduce(
    (acc, s) => {
      const pathname = toPathname(s.getData().url);
      if (pathname) {
        acc.eligiblePathnames.add(pathname);
        acc.valuableByPathname.set(pathname, s.getData().valuable ?? true);
      }
      return acc;
    },
    { eligiblePathnames: new Set(), valuableByPathname: new Map() },
  );

  // 3. Enrich preRenderSuggestions with agenticTraffic + valuable — only eligible URLs
  const baseUrl = site.getBaseURL().replace(/\/$/, '');
  const enriched = preRenderSuggestions
    .filter((s) => eligiblePathnames.has(toPathname(s.url)))
    .map((s) => {
      const pathname = toPathname(s.url);
      return {
        ...s,
        agenticTraffic: agenticHitsMap.get(pathname) || 0,
        valuable: valuableByPathname.get(pathname),
      };
    });

  // 4. Group by first path segment
  const groups = new Map();
  for (const s of enriched) {
    const pt = extractPathType(s.url);
    if (pt) {
      if (!groups.has(pt)) {
        groups.set(pt, []);
      }
      groups.get(pt).push(s);
    }
  }

  // 5. Qualify and score each path group
  const results = [];
  for (const [pathPattern, urls] of groups) {
    const result = strategy.qualify(pathPattern, urls);
    if (result.qualifies) {
      const { score, contentGainRatio } = result;
      const wordCountBefore = urls.reduce((sum, u) => sum + (u.wordCountBefore || 0), 0);
      const wordCountAfter = urls.reduce((sum, u) => sum + (u.wordCountAfter || 0), 0);
      const aiReadableCount = urls.filter((u) => u.aiReadable === true).length;
      const aiReadablePercent = parseFloat(((aiReadableCount / urls.length) * 100).toFixed(1));

      log.debug(`${LOG_PREFIX} Qualified path: ${pathPattern}, urls=${urls.length}, score=${score}`);
      results.push({
        key: `${pathPattern}|prerender`,
        data: {
          url: `${baseUrl}${pathPattern}`,
          allowedRegexPatterns: [pathPattern],
          score,
          contentGainRatio,
          wordCountBefore,
          wordCountAfter,
          aiReadablePercent,
        },
      });
    } else {
      log.debug(`${LOG_PREFIX} Skipping path ${pathPattern}: ${result.reason}`);
    }
  }

  results.sort((a, b) => b.data.score - a.data.score);
  log.info(`${LOG_PREFIX} Built ${results.length} path suggestions`);
  return results;
}

/**
 * Marks NEW per-URL suggestions as coveredByPattern for each deployed path suggestion.
 * Also self-heals: clears stale coveredByPattern refs where the referenced path is no
 * longer deployed (handles partial-failure cleanup, manual DB edits, deleted suggestions).
 *
 * Uses `coveredByPattern` — a dedicated field for path coverage, separate from
 * `coveredByDomainWide` which is reserved for domain-wide coverage. Rollback handlers
 * in the shared client clear only their own field.
 *
 * @param {Object} opportunity - SpaceCat opportunity entity
 * @param {Object} context - Audit context (must include dataAccess for bulk saves)
 * @returns {Promise<void>}
 */
export async function markSuggestionsAsCoveredByPaths(opportunity, context) {
  const { log, dataAccess } = context;
  const suggestions = await opportunity.getSuggestions();

  // Find deployed path suggestions
  const deployedPaths = suggestions.filter((s) => {
    const d = s.getData();
    return isPathSuggestionData(d) && !!d?.edgeDeployed && s.getStatus() !== 'OUTDATED';
  });

  const deployedPathIds = new Set(deployedPaths.map((s) => s.getId()));

  // Self-heal: clear stale coveredByPattern references pointing to undeployed paths
  const stale = suggestions.filter((s) => {
    const covId = s.getData()?.coveredByPattern;
    return covId && !deployedPathIds.has(covId);
  });

  if (stale.length > 0) {
    stale.forEach((s) => {
      const d = { ...s.getData() };
      delete d.coveredByPattern;
      s.setData(d);
    });
    try {
      await dataAccess.Suggestion.saveMany(stale);
      log.info(`${LOG_PREFIX} Cleared ${stale.length} stale coveredByPattern references`);
    } catch (e) {
      log.error(`${LOG_PREFIX} Failed to clear ${stale.length} stale coveredByPattern refs: ${e.message}`);
    }
  }

  if (deployedPaths.length === 0) {
    return;
  }

  const newSuggestions = suggestions.filter(
    (s) => s.getStatus() === 'NEW'
      && !isPathSuggestionData(s.getData())
      && !s.getData()?.isDomainWide
      && !s.getData()?.edgeDeployed,
  );

  for (const pathSuggestion of deployedPaths) {
    const pathPat = pathSuggestion.getData().allowedRegexPatterns?.[0];
    const prefix = pathPat.replace('/*', '');
    const pathId = pathSuggestion.getId();

    const toCover = newSuggestions.filter((s) => {
      const d = s.getData();
      if (d?.coveredByPattern || d?.coveredByDomainWide) {
        return false;
      }
      try {
        const p = new URL(d.url).pathname;
        return p === prefix || p.startsWith(`${prefix}/`);
      } catch {
        return false;
      }
    });

    if (toCover.length > 0) {
      toCover.forEach((s) => s.setData({ ...s.getData(), coveredByPattern: pathId }));
      try {
        // eslint-disable-next-line no-await-in-loop
        await dataAccess.Suggestion.saveMany(toCover);
        log.info(
          `${LOG_PREFIX} Path ${pathPat}: marked ${toCover.length} suggestions as coveredByPattern=${pathId}`,
        );
      } catch (e) {
        log.error(`${LOG_PREFIX} Failed to mark ${toCover.length} suggestions as covered by ${pathPat}: ${e.message}`);
      }
    }
  }
}
