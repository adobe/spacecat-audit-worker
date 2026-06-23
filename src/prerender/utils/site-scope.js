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

import { prependSchema } from '@adobe/spacecat-shared-utils';

/**
 * Checks whether a URL belongs to the site identified by its configured baseUrl.
 *
 * Two sites can share the same domain but have different baseUrls
 * (e.g. nba.com and nba.com/kings are separate sites). Top pages,
 * scrape jobs, and suggestions must be restricted to the site's own
 * baseUrl so that results from one site do not bleed into another.
 *
 * When baseUrl has no path component (root-domain site), all URLs
 * on that domain are considered in scope.
 *
 * @param {string} url - Absolute URL to check
 * @param {string} baseUrl - Site baseUrl from site config (e.g. "https://nba.com/kings")
 * @returns {boolean}
 */
export function isUrlWithinSiteBaseUrl(url, baseUrl) {
  if (!url || !baseUrl) {
    return false;
  }
  try {
    const parsedBase = new URL(prependSchema(baseUrl));
    const basePath = parsedBase.pathname;
    if (!basePath || basePath === '/') {
      return true;
    }
    const basePathWithSlash = `${basePath}/`;
    const parsedUrl = new URL(prependSchema(url));
    return parsedUrl.pathname.startsWith(basePathWithSlash) || parsedUrl.pathname === basePath;
  } catch {
    return false;
  }
}

/**
 * Filters an array of absolute URL strings to those belonging to the site's baseUrl.
 * No-op for root-domain sites.
 *
 * @param {string[]} urls - Array of absolute URL strings
 * @param {string} baseUrl - Site baseUrl from site config
 * @param {Object} log - Logger
 * @returns {string[]}
 */
export function filterUrlsBySiteBaseUrl(urls, baseUrl, log) {
  if (!urls || urls.length === 0) {
    return urls;
  }
  try {
    const parsedBase = new URL(prependSchema(baseUrl));
    if (!parsedBase.pathname || parsedBase.pathname === '/') {
      return urls;
    }
    const filtered = urls.filter((url) => isUrlWithinSiteBaseUrl(url, baseUrl));
    log?.debug?.(
      `[prerender] Scoped ${urls.length} URLs to ${filtered.length} for site baseUrl ${baseUrl}`,
    );
    return filtered;
  } catch {
    return urls;
  }
}
