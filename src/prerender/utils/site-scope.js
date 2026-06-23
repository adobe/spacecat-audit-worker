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

import { prependSchema, stripWWW } from '@adobe/spacecat-shared-utils';

function isWithinAuditScope(url, baseURL) {
  if (!url || !baseURL) {
    return false;
  }
  try {
    const parsedBaseURL = new URL(prependSchema(baseURL));
    const basePath = parsedBaseURL.pathname;
    const hasBasePath = basePath && basePath !== '/';
    if (!hasBasePath) {
      return true;
    }
    const basePathWithSlash = `${basePath}/`;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return url.startsWith(basePathWithSlash) || url === basePath;
    }
    const parsedUrl = new URL(prependSchema(url));
    if (stripWWW(parsedUrl.hostname) !== stripWWW(parsedBaseURL.hostname)
      || parsedUrl.port !== parsedBaseURL.port) {
      return false;
    }
    return parsedUrl.pathname.startsWith(basePathWithSlash) || parsedUrl.pathname === basePath;
  } catch {
    return false;
  }
}

/**
 * Checks whether a URL belongs to the given site.
 *
 * Two sites can share the same domain but have different baseUrls
 * (e.g. nba.com and nba.com/kings are separate sites). Top pages,
 * scrape jobs, and suggestions must be restricted to the site's own
 * scope so that results from one site do not bleed into another.
 *
 * Scoping is currently driven by site.getBaseURL(). Accepting the full
 * site object allows future scoping rules (e.g. locale config, org-level
 * overrides) to be added without changing call sites.
 *
 * @param {string} url - Absolute URL to check
 * @param {Object} site - Site object with getBaseURL()
 * @returns {boolean}
 */
export function isUrlWithinSite(url, site) {
  return isWithinAuditScope(url, site?.getBaseURL?.());
}

/**
 * Filters an array of absolute URL strings to those belonging to the site's scope.
 *
 * @param {string[]} urls - Array of absolute URL strings
 * @param {Object} site - Site object with getBaseURL()
 * @returns {string[]}
 */
export function filterUrlsBySite(urls, site) {
  if (!urls || urls.length === 0) {
    return urls;
  }
  return urls.filter((url) => isUrlWithinSite(url, site));
}
