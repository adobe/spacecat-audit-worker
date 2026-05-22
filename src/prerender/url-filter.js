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

import { mergeAndGetUniqueHtmlUrls, toPathname } from './utils/utils.js';
import { DAILY_BATCH_SIZE } from './utils/constants.js';
import { getRecentlyProcessedPathnames } from './page-citability.js';

/**
 * Returns a Set of URL pathnames that are already deployed at the CDN edge.
 * @param {{ pages?: Array<{ url: string, isDeployedAtEdge: boolean }> }} status
 * @returns {Set<string>}
 */
function getEdgeDeployedPathnames(status) {
  const pages = Array.isArray(status?.pages) ? status.pages : [];
  const pathnames = new Set();
  for (const p of pages) {
    if (p.isDeployedAtEdge && p.url) {
      try {
        const { pathname } = new URL(p.url);
        pathnames.add(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
      } catch { /* skip malformed URLs */ }
    }
  }
  return pathnames;
}

/**
 * Returns true when the URL's pathname is NOT in the set of recently processed pathnames.
 * @param {string} url
 * @param {Set<string>} recentPathnames
 * @returns {boolean}
 */
function isNotRecentUrl(url, recentPathnames) {
  try {
    return !recentPathnames.has(new URL(url).pathname);
  } catch {
    return true;
  }
}

/**
 * Applies mode-specific URL filtering, deduplication, and batching.
 *
 * CSV   → dedup+HTML-only from pre-supplied csvUrls (no recency/edge filter).
 * Slack → dedup+HTML-only from organic+included (no recency/edge filter).
 * Normal → recency filter (PageCitability) + edge-deployed filter + DAILY_BATCH_SIZE cap.
 *
 * @param {Object} context - Handler context (log, site, dataAccess)
 * @param {{ isCsv: boolean, isSlack: boolean }} mode - Resolved execution mode
 * @param {{ csvUrls?: string[], topPagesUrls: string[], agenticUrls: string[],
 *   includedURLs: string[] }} rawUrls - All URLs rebased to preferred base URL.
 * @param {Object} [_unused] - Included for API parity (used by callers)
 *   All URLs must already be rebased to the preferred base URL.
 * @param {Object} status - Site status.json (used for edge-deployed pathnames in Normal mode)
 * @returns {Promise<{
 *   urls: string[],
 *   filteredCount: number,
 *   metrics: {
 *     currentOrganic: number, currentIncludedUrls: number, currentAgentic: number,
 *     isFirstRunOfCycle: boolean, agenticNewThisCycle: number, edgeDeployedCount: number
 *   }
 * }>}
 */
export async function filterUrls(context, mode, rawUrls, status) {
  const {
    csvUrls = [], topPagesUrls, agenticUrls, includedURLs,
  } = rawUrls;
  const { isCsv, isSlack } = mode;

  if (isCsv) {
    const { urls, filteredCount } = mergeAndGetUniqueHtmlUrls(csvUrls);
    return {
      urls,
      filteredCount,
      metrics: {
        currentOrganic: 0,
        currentIncludedUrls: 0,
        currentAgentic: 0,
        isFirstRunOfCycle: true,
        agenticNewThisCycle: 0,
        edgeDeployedCount: 0,
      },
    };
  }

  if (isSlack) {
    const { urls, filteredCount } = mergeAndGetUniqueHtmlUrls([
      ...topPagesUrls,
      ...includedURLs,
    ]);
    return {
      urls,
      filteredCount,
      metrics: {
        currentOrganic: topPagesUrls.length,
        currentIncludedUrls: includedURLs.length,
        currentAgentic: 0,
        isFirstRunOfCycle: true,
        agenticNewThisCycle: 0,
        edgeDeployedCount: 0,
      },
    };
  }

  // Normal mode
  const siteId = context.site.getId();
  const recentPathnames = await getRecentlyProcessedPathnames(context, siteId);
  const edgeDeployedPathnames = getEdgeDeployedPathnames(status);

  const filteredOrganicUrls = topPagesUrls
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !edgeDeployedPathnames.has(toPathname(url)));
  const filteredIncludedURLs = includedURLs
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !edgeDeployedPathnames.has(toPathname(url)));
  const filteredAgenticUrls = agenticUrls
    .filter((url) => isNotRecentUrl(url, recentPathnames))
    .filter((url) => !edgeDeployedPathnames.has(toPathname(url)));

  const isFirstRunOfCycle = filteredOrganicUrls.length === topPagesUrls.length;
  const agenticNewThisCycle = filteredAgenticUrls.length;

  const orderedCandidateUrls = [
    ...filteredOrganicUrls,
    ...filteredIncludedURLs,
    ...filteredAgenticUrls,
  ];
  const batchedUrls = orderedCandidateUrls.slice(0, DAILY_BATCH_SIZE);

  const organicUrlSet = new Set(filteredOrganicUrls);
  const includedUrlSet = new Set(filteredIncludedURLs);
  const currentOrganic = batchedUrls.filter((url) => organicUrlSet.has(url)).length;
  const currentIncludedUrls = batchedUrls.filter((url) => includedUrlSet.has(url)).length;
  const currentAgentic = batchedUrls.filter(
    (url) => !organicUrlSet.has(url) && !includedUrlSet.has(url),
  ).length;

  const { urls, filteredCount } = mergeAndGetUniqueHtmlUrls(batchedUrls);

  return {
    urls,
    filteredCount,
    metrics: {
      currentOrganic,
      currentIncludedUrls,
      currentAgentic,
      isFirstRunOfCycle,
      agenticNewThisCycle,
      edgeDeployedCount: edgeDeployedPathnames.size,
    },
  };
}
