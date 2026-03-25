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

/**
 * Common non-HTML file extensions that should be filtered out from scrape inputs.
 */
const NON_HTML_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav', '.ogg',
  '.zip', '.rar', '.tar', '.gz', '.7z',
  '.json', '.xml', '.css', '.js', '.ts', '.map',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
]);

function hasNonHtmlExtension(pathname) {
  const lowerPath = pathname.toLowerCase();
  const lastDot = lowerPath.lastIndexOf('.');
  if (lastDot > lowerPath.lastIndexOf('/')) {
    return NON_HTML_EXTENSIONS.has(lowerPath.slice(lastDot));
  }
  return false;
}

function defaultTopPagesToUrls(topPages) {
  return topPages.map((page) => page.url ?? page.getUrl());
}

/**
 * Merges multiple URL arrays, ensures uniqueness by path, and filters out non-HTML URLs.
 * URLs with the same path are treated as duplicates even when the hostname differs.
 * @param {...Array<string>} urlArrays - Variable number of URL arrays to merge
 * @returns {{ urls: string[], filteredCount: number }}
 */
export function mergeAndGetUniqueHtmlUrls(...urlArrays) {
  const seenPaths = new Set();
  const uniqueUrls = [];
  let filteredCount = 0;

  urlArrays.flat().forEach((url) => {
    try {
      const urlObj = new URL(url);
      const { pathname } = urlObj;

      if (hasNonHtmlExtension(pathname)) {
        filteredCount += 1;
        return;
      }

      let normalizedPath = pathname;
      if (normalizedPath.length > 1) {
        normalizedPath = normalizedPath.replace(/\/+$/, '');
      }

      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
        uniqueUrls.push(url);
      }
    } catch {
      uniqueUrls.push(url);
    }
  });

  return {
    urls: uniqueUrls,
    filteredCount,
  };
}

/**
 * Loads top organic, agentic, and manually included URLs for an audit and applies
 * the prerender-style merge/deduping/filtering rules.
 * @param {Object} options
 * @param {Object} options.site - Site model
 * @param {Object} options.dataAccess - Data access container
 * @param {string} options.auditType - Audit type used for included URLs lookup
 * @param {Function} options.getAgenticUrls - Async function returning agentic URLs
 * @param {Array} [options.topPages] - Optional preloaded top pages to use instead of loading them.
 * Supports either page models with `getUrl()` or normalized objects with `url`.
 * @param {number} [options.topOrganicLimit] - Optional cap for Ahrefs URLs
 * @param {Function} [options.topPagesToUrls] - Maps Ahrefs page records to URL strings
 * @returns {Promise<Object>}
 */
export async function getMergedAuditInputUrls({
  site,
  dataAccess,
  auditType,
  getAgenticUrls,
  topPages: providedTopPages,
  topOrganicLimit,
  topPagesToUrls = defaultTopPagesToUrls,
}) {
  const { SiteTopPage } = dataAccess || {};
  let topPagesPromise;
  if (providedTopPages !== undefined) {
    topPagesPromise = Promise.resolve(providedTopPages);
  } else if (SiteTopPage?.allBySiteIdAndSourceAndGeo) {
    topPagesPromise = SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  } else {
    topPagesPromise = Promise.resolve([]);
  }

  const [topPages, agenticUrls, siteConfig] = await Promise.all([
    topPagesPromise,
    getAgenticUrls(),
    site?.getConfig?.(),
  ]);
  const normalizedTopPages = topPages || [];
  const limitedTopPages = Number.isInteger(topOrganicLimit)
    ? normalizedTopPages.slice(0, topOrganicLimit)
    : normalizedTopPages;
  const topPagesUrls = topPagesToUrls(limitedTopPages);
  const includedURLs = await siteConfig?.getIncludedURLs?.(auditType) || [];
  const { urls, filteredCount } = mergeAndGetUniqueHtmlUrls(
    topPagesUrls,
    agenticUrls || [],
    includedURLs,
  );

  return {
    topPages: normalizedTopPages,
    topPagesUrls,
    agenticUrls: agenticUrls || [],
    includedURLs,
    urls,
    filteredCount,
  };
}
