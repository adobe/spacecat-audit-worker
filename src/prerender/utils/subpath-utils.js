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
 * Checks whether a URL falls within the subpath scope defined by baseURL.
 * When baseURL has no subpath (root domain), all URLs are considered in scope.
 *
 * @param {string} url - Absolute URL to check
 * @param {string} baseURL - Site base URL (e.g. "https://example.com/en")
 * @returns {boolean}
 */
export function isUrlInScope(url, baseURL) {
  if (!url || !baseURL) {
    return false;
  }
  try {
    const parsedBase = new URL(prependSchema(baseURL));
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
 * Filters an array of absolute URL strings to those within the site.baseUrl subpath.
 * No-op for root-domain sites (no subpath).
 *
 * @param {string[]} urls - Array of absolute URL strings
 * @param {string} baseURL - Site base URL
 * @param {Object} log - Logger
 * @returns {string[]}
 */
export function filterUrlsToScope(urls, baseURL, log) {
  if (!urls || urls.length === 0) {
    return urls;
  }
  try {
    const parsedBase = new URL(prependSchema(baseURL));
    if (!parsedBase.pathname || parsedBase.pathname === '/') {
      return urls;
    }
    const filtered = urls.filter((url) => isUrlInScope(url, baseURL));
    log?.debug?.(
      `[prerender/subpath-utils] Scoped ${urls.length} URLs to ${filtered.length} within ${parsedBase.pathname}`,
    );
    return filtered;
  } catch {
    return urls;
  }
}
