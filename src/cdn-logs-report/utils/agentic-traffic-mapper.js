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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { joinBaseAndPath } from '../../utils/url-utils.js';
import { validateCountryCode } from './report-utils.js';
import { inferProviderFromUserAgent } from '../../common/user-agent-classification.js';

const MAX_AVG_TTFB_MS = 999999.99;
const UNSUPPORTED_URL_PREFIXES = ['data:', `java${'script:'}`, 'blob:', 'mailto:'];

function normalizeText(value, fallback = '') {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value.replaceAll('\0', '');
}

function normalizeLabel(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function inferContentType(urlPath = '') {
  const path = String(urlPath).toLowerCase();
  if (/\.(png|apng)$/.test(path)) {
    return 'png';
  }
  if (/\.(jpg|jpeg|jpe|jfif|pjpeg|pjp)$/.test(path)) {
    return 'jpg';
  }
  if (/\.gif$/.test(path)) {
    return 'gif';
  }
  if (/\.webp$/.test(path)) {
    return 'webp';
  }
  if (/\.svg$/.test(path)) {
    return 'svg';
  }
  if (/\.ico$/.test(path)) {
    return 'ico';
  }
  if (/\.bmp$/.test(path)) {
    return 'bmp';
  }
  if (/\.avif$/.test(path)) {
    return 'avif';
  }
  if (/\.xml$/.test(path)) {
    return 'xml';
  }
  if (/\.pdf$/.test(path)) {
    return 'pdf';
  }
  if (/\.(html|htm)$/.test(path)) {
    return 'html';
  }
  if (/\.txt$/.test(path)) {
    return 'txt';
  }
  if (!path || path.endsWith('/') || !path.split('/').pop().includes('.')) {
    return 'html';
  }
  return 'other';
}

// Mirrors getLlmVisibilityScore in project-elmo-ui: 100 when deployed/covered, else the
// word-count ratio capped at 100.
export function getLlmVisibilityScore({
  wordCountBefore, wordCountAfter, isDeployed, coveredByDomainWide, coveredByPattern,
}) {
  if (isDeployed || coveredByDomainWide || coveredByPattern) {
    return 100;
  }
  if (Number.isFinite(wordCountBefore) && Number.isFinite(wordCountAfter) && wordCountAfter > 0) {
    return Math.min(100, Math.round((wordCountBefore / wordCountAfter) * 100));
  }
  return 0;
}

// Builds a pathname -> { score, isDeployedAtEdge, updatedAt } map from prerender suggestions.
// Skips domain-wide aggregates and entries with neither a deploy signal nor usable word counts.
function buildCitabilityMap(suggestions, log) {
  return suggestions.reduce((acc, suggestion) => {
    const data = suggestion?.getData?.() ?? {};
    if (!data.url || data.isDomainWide) {
      return acc;
    }

    let pathname;
    try {
      ({ pathname } = new URL(data.url));
    } catch (error) {
      log?.warn?.(`Skipping malformed citability URL during agentic mapping: ${error.message}`);
      return acc;
    }

    const isDeployed = !!data.edgeDeployed
      || suggestion.getStatus?.() === Suggestion.STATUSES.FIXED;
    const coveredByDomainWide = !!data.coveredByDomainWide;
    const coveredByPattern = !!data.coveredByPattern;
    const isDeployedAtEdge = isDeployed || coveredByDomainWide || coveredByPattern;

    const { wordCountBefore, wordCountAfter } = data;
    const hasUsableWordCounts = Number.isFinite(wordCountBefore)
      && Number.isFinite(wordCountAfter) && wordCountAfter > 0;
    if (!isDeployedAtEdge && !hasUsableWordCounts) {
      return acc;
    }

    const updatedAt = suggestion.getUpdatedAt?.();
    const existing = acc[pathname];
    if (!existing || new Date(updatedAt) > new Date(existing.updatedAt)) {
      acc[pathname] = {
        score: getLlmVisibilityScore({
          wordCountBefore, wordCountAfter, isDeployed, coveredByDomainWide, coveredByPattern,
        }),
        isDeployedAtEdge,
        updatedAt,
      };
    }

    return acc;
  }, {});
}

// Reads live suggestions from the site's NEW prerender opportunity (replaces PageCitability).
async function getCitabilityScores(site, context) {
  const opportunityDA = context?.dataAccess?.Opportunity;
  if (!opportunityDA?.allBySiteIdAndStatus) {
    return [];
  }

  try {
    const opportunities = await opportunityDA.allBySiteIdAndStatus(site.getId(), 'NEW');
    const opportunity = (opportunities || []).find(
      (o) => o.getType?.() === Audit.AUDIT_TYPES.PRERENDER,
    );
    if (!opportunity?.getSuggestions) {
      return [];
    }
    const suggestions = await opportunity.getSuggestions();
    return (suggestions || []).filter(
      (s) => s.getStatus?.() !== Suggestion.STATUSES.OUTDATED,
    );
  } catch (error) {
    context?.log?.warn?.(`Failed to fetch prerender suggestions for agentic mapping: ${error.message}`);
    return [];
  }
}

function canonicalizeAgenticUrlPath(rawUrl, baseURL, log) {
  const normalizedUrl = rawUrl === '-' ? '/' : normalizeText(rawUrl, '/');
  const pseudoUrlCandidate = normalizedUrl.replace(/^\/+/, '').toLowerCase();
  if (UNSUPPORTED_URL_PREFIXES.some((prefix) => pseudoUrlCandidate.startsWith(prefix))) {
    return null;
  }

  try {
    const canonicalUrl = new URL(joinBaseAndPath(baseURL, normalizedUrl || '/'));
    return canonicalUrl.pathname.replaceAll('\0', '');
  } catch (error) {
    log?.warn?.(`Skipping malformed agentic URL during daily export mapping: ${error.message}`);
    return null;
  }
}

export async function mapToAgenticTrafficBundle(rows, site, context, trafficDate) {
  if (!Array.isArray(rows) || !site || !trafficDate) {
    return {
      trafficRows: [],
      classificationRows: [],
    };
  }

  const siteIgnoreList = site.getConfig?.()?.getLlmoCountryCodeIgnoreList?.() || [];
  const prerenderSuggestions = await getCitabilityScores(site, context);
  const citabilityMap = buildCitabilityMap(prerenderSuggestions, context?.log);
  const baseURL = site.getConfig?.()?.getFetchConfig?.()?.overrideBaseURL || site.getBaseURL();
  const defaultHost = new URL(baseURL).host;
  const classificationMap = new Map();
  const trafficRows = rows
    .map((row) => {
      if (row.agent_type === 'Other') {
        return null;
      }

      const hits = Number(row.number_of_hits) || 0;
      if (hits <= 0) {
        return null;
      }

      const urlPath = canonicalizeAgenticUrlPath(row.url, baseURL, context?.log);
      if (!urlPath) {
        return null;
      }

      const host = normalizeText(row.host, defaultHost) || defaultHost;
      const citability = citabilityMap[urlPath];
      const dimensions = {};

      if (citability?.score !== undefined && citability?.score !== null) {
        dimensions.citability_score = citability.score;
      }

      if (citability?.isDeployedAtEdge !== undefined) {
        dimensions.deployed_at_edge = citability.isDeployedAtEdge;
      }

      const classificationKey = `${host}|${urlPath}`;
      if (!classificationMap.has(classificationKey)) {
        classificationMap.set(classificationKey, {
          host,
          url_path: urlPath,
          region: validateCountryCode(row.country_code, siteIgnoreList),
          category_name: normalizeLabel(row.product),
          page_type: normalizeText(row.category),
          content_type: inferContentType(urlPath),
          updated_by: 'audit-worker:agentic-daily-export',
        });
      }

      const avgTtfb = Number(row.avg_ttfb_ms);
      const normalizedAvgTtfb = Number.isFinite(avgTtfb) && avgTtfb <= MAX_AVG_TTFB_MS
        ? avgTtfb
        : null;

      return {
        traffic_date: trafficDate,
        host,
        platform: inferProviderFromUserAgent(row.user_agent_display),
        agent_type: normalizeText(row.agent_type, 'Unknown'),
        user_agent: normalizeText(row.user_agent_display, 'Unknown'),
        http_status: Number(row.status) || 0,
        url_path: urlPath,
        hits,
        avg_ttfb_ms: normalizedAvgTtfb,
        dimensions,
        metrics: {},
        updated_by: 'audit-worker:agentic-daily-export',
      };
    })
    .filter(Boolean);

  return {
    trafficRows,
    classificationRows: Array.from(classificationMap.values()),
  };
}
