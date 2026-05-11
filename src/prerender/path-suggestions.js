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

import { getAgenticHitsMapFromAthena } from '../utils/agentic-urls.js';
import {
  PATH_TYPE_MIN_URLS,
  PATH_TYPE_MIN_VALUABLE_PCT,
  PATH_TYPE_SCORE_THRESHOLD,
  PATH_TYPE_SUGGESTION_RANK,
} from './utils/constants.js';

// Re-export so callers can reference without importing constants directly
export { PATH_TYPE_SUGGESTION_RANK };

const LOG_PREFIX = '[prerender][path-suggestions]';

// Statuses considered active/preservable for path suggestions
const PRESERVABLE_STATUSES = ['NEW', 'FIXED', 'PENDING_VALIDATION', 'SKIPPED'];
// Statuses of per-URL suggestions eligible for path scoring
const ELIGIBLE_STATUSES = new Set(['NEW', 'FIXED']);

/**
 * Extracts the first-segment path pattern from a URL.
 * e.g. https://example.com/products/shoes → '/products/*'
 * Returns null for root-level URLs or invalid URLs.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function extractPathType(url) {
  try {
    const { pathname } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    return parts.length > 0 ? `/${parts[0]}/*` : null;
  } catch {
    return null;
  }
}

/**
 * Qualification strategy that mirrors rcv-scoring-dashboard's computeScore formula exactly.
 * Pluggable: swap in any object with qualify(pathPattern, urls, log) → { qualifies, score, ... }
 */
export class RcvPathQualificationStrategy {
  constructor({
    minUrls = PATH_TYPE_MIN_URLS,
    minValuablePct = PATH_TYPE_MIN_VALUABLE_PCT,
    scoreThreshold = PATH_TYPE_SCORE_THRESHOLD,
  } = {}) {
    this.minUrls = minUrls;
    this.minValuablePct = minValuablePct;
    this.scoreThreshold = scoreThreshold;
  }

  qualify(pathPattern, urls) {
    if (urls.length < this.minUrls) {
      return { qualifies: false, score: 0, reason: `urlCount ${urls.length} < minUrls ${this.minUrls}` };
    }

    const valuableCount = urls.filter((u) => u.valuable === true).length;
    const valuablePercent = (valuableCount / urls.length) * 100;
    if (valuablePercent < this.minValuablePct) {
      return {
        qualifies: false,
        score: 0,
        reason: `valuablePercent ${valuablePercent.toFixed(1)}% < minValuablePct ${this.minValuablePct}%`,
      };
    }

    const totalAgenticTraffic = urls.reduce((sum, u) => sum + (u.agenticTraffic || 0), 0);
    let weightedValuableTraffic = 0;
    if (totalAgenticTraffic > 0) {
      for (const u of urls) {
        weightedValuableTraffic += (u.agenticTraffic / totalAgenticTraffic) * (u.valuable ? 1 : 0);
      }
    }
    const avgContentGainRatio = urls.reduce((sum, u) => sum + (u.contentGainRatio || 0), 0)
      / urls.length;
    const score = parseFloat((weightedValuableTraffic + avgContentGainRatio).toFixed(4));

    if (score < this.scoreThreshold) {
      return { qualifies: false, score, reason: `score ${score} < scoreThreshold ${this.scoreThreshold}` };
    }

    return {
      qualifies: true,
      score,
      valuableCount,
      valuablePercent: parseFloat(valuablePercent.toFixed(1)),
    };
  }
}

/**
 * Determines if an existing path suggestion should be preserved across re-audits.
 *
 * @param {Object} suggestion
 * @returns {boolean}
 */
function shouldPreservePathSuggestion(suggestion) {
  const status = suggestion.getStatus();
  const data = suggestion.getData();
  return PRESERVABLE_STATUSES.includes(status) || !!data?.edgeDeployed;
}

/**
 * Finds existing path suggestions that should be preserved (not overwritten).
 *
 * @param {Object} opportunity - SpaceCat opportunity entity
 * @param {Object} log - Logger
 * @returns {Promise<Array>}
 */
export async function findPreservablePathSuggestions(opportunity, log) {
  const existingSuggestions = await opportunity.getSuggestions();
  const preservable = existingSuggestions.filter((s) => {
    const d = s.getData();
    return d?.pathType === true && shouldPreservePathSuggestion(s);
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
 * @param {Object} [strategy] - Qualification strategy (default: RcvPathQualificationStrategy)
 * @returns {Promise<Array>} Array of { key, data } path suggestion objects
 */
export async function buildPathTypeSuggestions(
  preRenderSuggestions,
  opportunity,
  site,
  context,
  strategy = new RcvPathQualificationStrategy(),
) {
  const { log } = context;

  // 1. Fetch agentic hits map from Athena (4-week window)
  const agenticHitsMap = await getAgenticHitsMapFromAthena(site, context).catch((e) => {
    log.warn(`${LOG_PREFIX} Failed to fetch agentic hits for path scoring: ${e.message}`);
    return new Map();
  });

  // 2. Read existing suggestions — only NEW or FIXED per-URL suggestions are eligible
  const existingSuggestions = await opportunity.getSuggestions();
  const eligibleSuggestions = existingSuggestions.filter((s) => {
    const d = s.getData();
    if (d?.pathType || d?.isDomainWide) {
      return false;
    }
    return ELIGIBLE_STATUSES.has(s.getStatus());
  });

  const eligiblePathnames = new Set(
    eligibleSuggestions.map((s) => {
      try {
        return new URL(s.getData().url).pathname.replace(/\/$/, '') || '/';
      } catch {
        return null;
      }
    }).filter(Boolean),
  );

  const valuableByPathname = new Map(
    eligibleSuggestions.map((s) => {
      try {
        const pathname = new URL(s.getData().url).pathname.replace(/\/$/, '') || '/';
        return [pathname, s.getData().valuable ?? true];
      } catch {
        return null;
      }
    }).filter(Boolean),
  );

  // 3. Enrich preRenderSuggestions with agenticTraffic + valuable — only eligible URLs
  const baseUrl = site.getBaseURL().replace(/\/$/, '');
  const enriched = preRenderSuggestions.filter((s) => {
    try {
      const pathname = new URL(s.url).pathname.replace(/\/$/, '') || '/';
      return eligiblePathnames.has(pathname);
    } catch {
      return false;
    }
  }).map((s) => {
    let pathname;
    try {
      pathname = new URL(s.url).pathname.replace(/\/$/, '') || '/';
    /* c8 ignore next 3 */
    } catch {
      pathname = s.url;
    }
    return {
      ...s,
      agenticTraffic: agenticHitsMap.get(pathname) || 0,
      /* c8 ignore next */
      valuable: valuableByPathname.has(pathname) ? valuableByPathname.get(pathname) : true,
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
      const { score, valuableCount, valuablePercent } = result;
      const totalAgenticTraffic = urls.reduce((sum, u) => sum + (u.agenticTraffic || 0), 0);
      const totalWordCountBefore = urls.reduce((sum, u) => sum + (u.wordCountBefore || 0), 0);
      const totalWordCountAfter = urls.reduce((sum, u) => sum + (u.wordCountAfter || 0), 0);
      const avgContentGainRatio = parseFloat(
        (urls.reduce((sum, u) => sum + (u.contentGainRatio || 0), 0) / urls.length).toFixed(2),
      );

      results.push({
        key: `${pathPattern}|prerender`,
        data: {
          url: `${baseUrl}${pathPattern}`,
          pathType: true,
          pathPattern,
          allowedRegexPatterns: [pathPattern],
          urlCount: urls.length,
          valuableCount,
          valuablePercent,
          avgContentGainRatio,
          totalWordCountBefore,
          totalWordCountAfter,
          totalAgenticTraffic,
          pathScore: score,
        },
      });
    } else {
      log.debug(`${LOG_PREFIX} Skipping path ${pathPattern}: ${result.reason}`);
    }
  }

  results.sort((a, b) => b.data.pathScore - a.data.pathScore);
  log.info(`${LOG_PREFIX} Built ${results.length} path suggestions`);
  return results;
}

/**
 * Marks NEW per-URL suggestions as coveredByDomainWide for each deployed path suggestion.
 * Also self-heals: clears stale coveredByDomainWide refs where the path is no longer deployed.
 *
 * @param {Object} opportunity - SpaceCat opportunity entity
 * @param {Object} context - Audit context
 * @returns {Promise<void>}
 */
export async function markSuggestionsAsCoveredByPaths(opportunity, context) {
  const { log } = context;
  const suggestions = await opportunity.getSuggestions();

  // Find deployed path suggestions
  const deployedPaths = suggestions.filter((s) => {
    const d = s.getData();
    return d?.pathType === true && !!d?.edgeDeployed && s.getStatus() !== 'OUTDATED';
  });

  const deployedPathIds = new Set(deployedPaths.map((s) => s.getId()));

  // Self-heal: clear stale coveredByDomainWide references pointing to undeployed paths
  const stale = suggestions.filter((s) => {
    const covId = s.getData()?.coveredByDomainWide;
    if (!covId) {
      return false;
    }
    // Only clear refs that point to a path suggestion that is no longer deployed
    const ref = suggestions.find((r) => r.getId() === covId);
    return ref && ref.getData()?.pathType === true && !deployedPathIds.has(covId);
  });

  if (stale.length > 0) {
    await Promise.all(stale.map(async (s) => {
      const d = { ...s.getData() };
      delete d.coveredByDomainWide;
      s.setData(d);
      return s.save();
    }));
    log.info(`${LOG_PREFIX} Cleared ${stale.length} stale coveredByDomainWide references`);
  }

  if (deployedPaths.length === 0) {
    return;
  }

  const newSuggestions = suggestions.filter(
    (s) => s.getStatus() === 'NEW'
      && !s.getData()?.pathType
      && !s.getData()?.isDomainWide
      && !s.getData()?.edgeDeployed,
  );

  for (const pathSuggestion of deployedPaths) {
    const pathPat = pathSuggestion.getData().pathPattern;
    const prefix = pathPat.replace('/*', '');
    const pathId = pathSuggestion.getId();

    const toCover = newSuggestions.filter((s) => {
      if (s.getData()?.coveredByDomainWide) {
        return false;
      }
      try {
        return new URL(s.getData().url).pathname.startsWith(prefix);
      } catch {
        return false;
      }
    });

    if (toCover.length > 0) {
      toCover.forEach((s) => s.setData({ ...s.getData(), coveredByDomainWide: pathId }));
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(toCover.map((s) => s.save()));
      log.info(
        `${LOG_PREFIX} Path ${pathPat}: marked ${toCover.length} suggestions as coveredByDomainWide=${pathId}`,
      );
    }
  }
}
