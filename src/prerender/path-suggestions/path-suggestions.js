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

import { getAgenticHitsMapFromAthena } from '../../utils/agentic-urls.js';
import {
  isPathSuggestionData,
  isDomainWideSuggestionData,
  extractPathType,
  shouldPreservePathSuggestion,
  isEligibleStatus,
  toPathname,
} from '../utils/utils.js';
import { PATH_TYPE_METRICS_FIELDS } from '../utils/constants.js';
import { createRcvQualifier } from './strategies/qualifier.js';

export { extractPathType, createRcvQualifier };

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
 * @param {Function} [options.qualify] - qualify(pathPattern, urls) function (default: rcv scorer)
 * @param {Array} [options.suggestions] - Pre-fetched suggestions (avoids redundant DB call)
 * @param {Map} [options.agenticHitsMap] - Pre-fetched pathname→hits map; if omitted, fetched
 *   from Athena. Callers should prefer passing this in to avoid a redundant Athena query.
 * @returns {Promise<Array>} Array of { key, data } path suggestion objects
 */
export async function buildPathTypeSuggestions(
  preRenderSuggestions,
  opportunity,
  site,
  context,
  { qualify = createRcvQualifier(), suggestions, agenticHitsMap: agenticHitsMapOpt } = {},
) {
  const { log } = context;

  // 1. Use caller-supplied hits map or fetch from Athena (4-week window)
  const agenticHitsMap = agenticHitsMapOpt
    ?? await getAgenticHitsMapFromAthena(site, context).catch((e) => {
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

  // 3. Enrich preRenderSuggestions with agenticTraffic + valuable — only eligible URLs.
  // Deduplicate by pathname (keeping highest contentGainRatio) to avoid inflating group
  // metrics when the scraper returns multiple entries for the same path.
  const baseUrl = site.getBaseURL().replace(/\/$/, '');
  const { origin } = new URL(baseUrl);
  const enrichedByPathname = preRenderSuggestions.reduce((acc, s) => {
    const pathname = toPathname(s.url);
    if (!eligiblePathnames.has(pathname)) {
      return acc;
    }
    const existing = acc.get(pathname);
    if (!existing || (s.contentGainRatio ?? 0) > (existing.contentGainRatio ?? 0)) {
      acc.set(pathname, {
        ...s,
        agenticTraffic: agenticHitsMap.get(pathname) || 0,
        valuable: valuableByPathname.get(pathname),
      });
    }
    return acc;
  }, new Map());
  const enriched = [...enrichedByPathname.values()];

  // 4. Group by first path segment (relative to site base URL)
  const groups = new Map();
  for (const s of enriched) {
    const pt = extractPathType(s.url, baseUrl);
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
    const result = qualify(pathPattern, urls);
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
          url: `${origin}${pathPattern}`,
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
 * Also marks NEW path suggestions as `coveredByDomainWide` when a domain-wide suggestion
 * is deployed — path-level rules are redundant while domain-wide (/*) is active.
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

  // Mark per-URL suggestions covered by each deployed path suggestion
  if (deployedPaths.length > 0) {
    const newSuggestions = suggestions.filter(
      (s) => s.getStatus() === 'NEW'
        && !isPathSuggestionData(s.getData())
        && !s.getData()?.isDomainWide
        && !s.getData()?.edgeDeployed,
    );

    const allToCover = [];
    for (const pathSuggestion of deployedPaths) {
      const pathPat = pathSuggestion.getData().allowedRegexPatterns?.[0];
      const prefix = pathPat.replace('/*', '');
      const pathId = pathSuggestion.getId();

      const toCover = newSuggestions.filter((s) => {
        const d = s.getData();
        if (d?.coveredByPattern) {
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
        log.info(
          `${LOG_PREFIX} Path ${pathPat}: marking ${toCover.length} suggestions as coveredByPattern=${pathId}`,
        );
        allToCover.push(...toCover);
      }
    }

    if (allToCover.length > 0) {
      try {
        await dataAccess.Suggestion.saveMany(allToCover);
      } catch (e) {
        log.error(`${LOG_PREFIX} Failed to mark ${allToCover.length} suggestions as coveredByPattern: ${e.message}`);
      }
    }
  }

  // Mark NEW path suggestions as coveredByDomainWide when domain-wide is deployed.
  // Path-level rules are redundant while the domain-wide /* rule is active.
  const deployedDomainWide = suggestions.find(
    (s) => isDomainWideSuggestionData(s.getData()) && !!s.getData().edgeDeployed,
  );
  if (!deployedDomainWide) {
    return;
  }
  const domainWideId = deployedDomainWide.getId();
  const pathsToCoverByDomainWide = suggestions.filter((s) => {
    const d = s.getData();
    return isPathSuggestionData(d)
      && s.getStatus() === 'NEW'
      && !d.edgeDeployed
      && !d.coveredByDomainWide;
  });
  if (pathsToCoverByDomainWide.length === 0) {
    return;
  }
  pathsToCoverByDomainWide.forEach(
    (s) => s.setData({ ...s.getData(), coveredByDomainWide: domainWideId }),
  );
  try {
    await dataAccess.Suggestion.saveMany(pathsToCoverByDomainWide);
    log.info(`${LOG_PREFIX} Marked ${pathsToCoverByDomainWide.length} path suggestions as coveredByDomainWide=${domainWideId}`);
  } catch (e) {
    log.error(`${LOG_PREFIX} Failed to mark ${pathsToCoverByDomainWide.length} path suggestions as coveredByDomainWide: ${e.message}`);
  }
}

/**
 * Refreshes metrics on preserved path suggestions from freshly-built data,
 * keeping status and edgeDeployed untouched.
 *
 * @param {Array} builtSuggestions - Freshly scored path suggestions ({ data })
 * @param {Map} preservableByPattern - pathPattern → existing suggestion entity
 * @param {Object} context - Audit context (dataAccess, log)
 * @returns {Promise<void>}
 */
export async function refreshPreservedPathMetrics(builtSuggestions, preservableByPattern, context) {
  const { dataAccess, log } = context;
  log.info(`${LOG_PREFIX} Refreshing metrics on ${preservableByPattern.size} preserved path suggestion(s) from ${builtSuggestions.length} freshly-built suggestion(s)`);
  const toSave = [];
  for (const p of builtSuggestions) {
    const pathPattern = p.data.allowedRegexPatterns?.[0];
    const existing = preservableByPattern.get(pathPattern);
    if (existing) {
      const currentData = existing.getData();
      const updatedData = { ...currentData };
      let changed = false;
      for (const field of PATH_TYPE_METRICS_FIELDS) {
        if (p.data[field] !== undefined && p.data[field] !== currentData[field]) {
          updatedData[field] = p.data[field];
          changed = true;
        }
      }
      if (changed) {
        log.info(`${LOG_PREFIX} Refreshing metrics for preserved path ${pathPattern}: ${PATH_TYPE_METRICS_FIELDS.filter((f) => p.data[f] !== undefined && p.data[f] !== currentData[f]).map((f) => `${f}=${currentData[f]}→${p.data[f]}`).join(', ')}`);
        existing.setData(updatedData);
        toSave.push(existing);
      } else {
        log.debug(`${LOG_PREFIX} No metric changes for preserved path ${pathPattern}`);
      }
    }
  }

  if (toSave.length > 0) {
    try {
      await dataAccess.Suggestion.saveMany(toSave);
    } catch (e) {
      log.error(`${LOG_PREFIX} Failed to refresh metrics on ${toSave.length} preserved path suggestions: ${e.message}`);
    }
  }

  log.info(`${LOG_PREFIX} Metrics refreshed on ${toSave.length}/${preservableByPattern.size} preserved path suggestion(s)`);
}

/**
 * Resolves path suggestions for an audit run.
 * Skips if path suggestions are disabled or domain-wide is deployed.
 * Otherwise, preserves existing suggestions and builds new ones.
 *
 * @param {Object} params
 * @param {boolean} params.pathSuggestionsEnabled
 * @param {boolean} params.domainWideDeployed
 * @param {Array} params.preRenderSuggestions - Raw audit results
 * @param {Object} params.opportunity - SpaceCat opportunity entity
 * @param {Object} params.site - SpaceCat site entity
 * @param {Object} params.context - Audit context (log, dataAccess, etc.)
 * @param {Array} params.cachedSuggestions - Pre-fetched suggestions
 * @param {string} params.auditUrl - Audit URL (for logging)
 * @param {string} params.siteId - Site ID (for logging)
 * @param {Map} [params.agenticHitsMap] - Pre-fetched pathname→hits map; avoids a second Athena
 *   query when the caller already has agentic data.
 * @returns {Promise<{ preservablePaths: Array, newPathSuggestions: Array }>}
 */
export async function resolvePathSuggestions({
  pathSuggestionsEnabled,
  domainWideDeployed,
  preRenderSuggestions,
  opportunity,
  site,
  context,
  cachedSuggestions,
  auditUrl,
  siteId,
  agenticHitsMap,
}) {
  const { log } = context;

  if (!pathSuggestionsEnabled || domainWideDeployed) {
    const reason = domainWideDeployed ? 'domain-wide is deployed' : 'not enabled';
    log.info(`${LOG_PREFIX} Path suggestions skipped for site ${siteId} — ${reason}`);
    return { preservablePaths: [], newPathSuggestions: [] };
  }

  // eslint-disable-next-line max-len
  const preservablePaths = await findPreservablePathSuggestions(opportunity, log, cachedSuggestions);
  const preservableByPattern = new Map(
    preservablePaths.map((s) => [s.getData().allowedRegexPatterns?.[0], s]),
  );

  const builtSuggestions = await buildPathTypeSuggestions(
    preRenderSuggestions,
    opportunity,
    site,
    context,
    { suggestions: cachedSuggestions, agenticHitsMap },
  );

  // Refresh metrics on preserved paths (keep status + edgeDeployed untouched)
  await refreshPreservedPathMetrics(builtSuggestions, preservableByPattern, context);

  const newPathSuggestions = builtSuggestions
    .filter((p) => !preservableByPattern.has(p.data.allowedRegexPatterns?.[0]));
  log.info(
    `${LOG_PREFIX} Path suggestions: ${preservablePaths.length} preserved, `
    + `${newPathSuggestions.length} new. baseUrl=${auditUrl}, siteId=${siteId}`,
  );
  return { preservablePaths, newPathSuggestions };
}

/**
 * Merges new path suggestion data onto existing data, preserving edgeDeployed and
 * coveredByDomainWide so that deployment state survives re-scoring across audit runs.
 *
 * @param {Object} existingData - Currently stored suggestion data
 * @param {Object} newData - Freshly scored suggestion data
 * @returns {Object} Merged data object
 */
export function mergePathSuggestionData(existingData, newData) {
  return {
    ...newData,
    ...(existingData?.edgeDeployed !== undefined && { edgeDeployed: existingData.edgeDeployed }),
    ...(existingData?.coveredByDomainWide !== undefined
      && { coveredByDomainWide: existingData.coveredByDomainWide }),
  };
}
