/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

// Per-URL citability, mirroring getLlmVisibilityScore + the status.json merge in
// project-elmo-ui (usePrerenderGains). Pure: takes already-fetched suggestions and
// status.json, returns Map<urlPath, { score, deployedAtEdge }>.

const ACTIVE_STATUSES = new Set([
  'NEW', 'PENDING_VALIDATION', 'APPROVED', 'IN_PROGRESS', 'FIXED', 'SKIPPED',
]);

// pathname only, trailing slash stripped — matches getUrlPath in the UI and avoids
// www/non-www and trailing-slash mismatches between sources. Falsy input is returned
// unchanged; callers only pass non-empty URLs/paths (they guard on url presence first).
export function normalizePath(input) {
  if (!input) {
    return input;
  }
  let path = input;
  try {
    ({ pathname: path } = new URL(input));
  } catch {
    /* already a path */
  }
  path = path.replaceAll('\0', '');
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function getLlmVisibilityScore({
  wordCountBefore, wordCountAfter, isDeployed, coveredByDomainWide, coveredByPattern,
}) {
  if (isDeployed || coveredByDomainWide || coveredByPattern) {
    return 100;
  }
  if (Number.isFinite(wordCountBefore) && Number.isFinite(wordCountAfter) && wordCountAfter > 0) {
    return Math.max(0, Math.min(100, Math.round((wordCountBefore / wordCountAfter) * 100)));
  }
  return 0;
}

function hasDomainWideFix(active) {
  // '/*' is a convention sentinel meaning "whole domain", matched literally — not a regex.
  return active.some(({ status, data = {} }) => data.isDomainWide
    && (status === 'FIXED' || data.edgeDeployed)
    && (data.allowedRegexPatterns || []).includes('/*'));
}

function addSuggestions(map, active, edgeDeployedPaths, domainWideFix) {
  active.forEach(({ status, data = {} }) => {
    if (data.isDomainWide || !data.url) {
      return;
    }
    const path = normalizePath(data.url);
    const isDeployed = !!data.edgeDeployed || status === 'FIXED' || edgeDeployedPaths.has(path);
    const coveredByDomainWide = domainWideFix || !!data.coveredByDomainWide;
    const coveredByPattern = !!data.coveredByPattern;
    const { wordCountBefore, wordCountAfter } = data;
    const hasValidData = isDeployed || coveredByDomainWide || coveredByPattern
      || (Number.isFinite(wordCountAfter) && wordCountAfter > 0);
    if (hasValidData) {
      const score = getLlmVisibilityScore({
        wordCountBefore, wordCountAfter, isDeployed, coveredByDomainWide, coveredByPattern,
      });
      const deployedAtEdge = isDeployed || coveredByDomainWide || coveredByPattern;
      map.set(path, { score, deployedAtEdge });
    }
  });
}

// status.json: already-optimised pages score 100; edge-deployed-but-still-needing pages
// score 100 and flag deployed_at_edge.
function addStatusPages(map, pages) {
  pages.forEach((p) => {
    if (!p.url) {
      return;
    }
    const path = normalizePath(p.url);
    if (p.needsPrerender === false && p.scrapingStatus === 'success') {
      map.set(path, { score: 100, deployedAtEdge: map.get(path)?.deployedAtEdge || false });
    }
    if (p.isDeployedAtEdge === true && p.needsPrerender === true) {
      map.set(path, { score: 100, deployedAtEdge: true });
    }
  });
}

export function buildPrerenderCitabilityMap({ suggestions = [], statusJson = {} } = {}) {
  const active = suggestions.filter((s) => ACTIVE_STATUSES.has(s.status));
  const pages = Array.isArray(statusJson.pages) ? statusJson.pages : [];
  const edgeDeployedPaths = new Set(
    pages
      .filter((p) => p.isDeployedAtEdge && p.needsPrerender && p.url)
      .map((p) => normalizePath(p.url)),
  );

  const map = new Map();
  addSuggestions(map, active, edgeDeployedPaths, hasDomainWideFix(active));
  addStatusPages(map, pages);
  return map;
}
