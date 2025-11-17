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
 * Checks if a URL is within the audit scope defined by baseURL.
 * For baseURL with subpath (e.g., bulk.com/uk), only URLs starting with that subpath are included.
 * For baseURL without subpath (e.g., bulk.com), all URLs are included.
 *
 * This follows the same pattern as redirect-chains audit (handler.js lines 458-493).
 *
 * @param {string} url - The URL to check (can be relative or absolute)
 * @param {string} baseURL - The base URL defining the audit scope
 *   (e.g., "bulk.com/uk" or "bulk.com")
 * @returns {boolean} - True if URL is within scope, false otherwise
 */
export function isWithinAuditScope(url, baseURL) {
  if (!url || !baseURL) {
    return false;
  }

  try {
    // Parse baseURL to extract path
    const baseURLWithSchema = prependSchema(baseURL);
    const parsedBaseURL = new URL(baseURLWithSchema);
    const basePath = parsedBaseURL.pathname;
    const hasBasePath = basePath && basePath !== '/';

    // If baseURL has no subpath, include all URLs
    if (!hasBasePath) {
      return true;
    }

    // Ensure we match with a trailing slash to avoid false positives (e.g., /fr/ not /french)
    const basePathWithSlash = `${basePath}/`;

    // Handle relative URLs
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      // Relative URL - check if it starts with the scope path
      return url.startsWith(basePathWithSlash) || url === basePath;
    }

    // Handle absolute URLs
    const urlWithSchema = prependSchema(url);
    const parsedUrl = new URL(urlWithSchema);

    // Compare hostnames (and ports, if present) - protocol-agnostic
    if (parsedUrl.hostname !== parsedBaseURL.hostname || parsedUrl.port !== parsedBaseURL.port) {
      return false;
    }

    // Compare paths (protocol-agnostic)
    return parsedUrl.pathname.startsWith(basePathWithSlash) || parsedUrl.pathname === basePath;
  } catch (error) {
    // If URL parsing fails, exclude it to be safe
    return false;
  }
}

/**
 * Filters an array of items by audit scope based on baseURL.
 * Items can be strings (URLs) or objects with a URL property.
 *
 * @param {Array} items - Array of items to filter (URLs or objects with
 *   url/urlFrom/urlTo properties)
 * @param {string} baseURL - The base URL defining the audit scope
 * @param {Object} options - Optional configuration
 * @param {string} options.urlProperty - Property name to extract URL from objects
 *   (default: 'url')
 * @param {Object} log - Logger instance for debugging
 * @returns {Array} - Filtered array of items within scope
 */
export function filterByAuditScope(items, baseURL, options = {}, log = console) {
  if (!items || items.length === 0) {
    return items;
  }

  const { urlProperty = 'url' } = options;

  // Parse baseURL to check if we need filtering
  try {
    const baseURLWithSchema = prependSchema(baseURL);
    const parsedBaseURL = new URL(baseURLWithSchema);
    const basePath = parsedBaseURL.pathname;
    const hasBasePath = basePath && basePath !== '/';

    // If baseURL has no subpath, return all items
    if (!hasBasePath) {
      log.debug(
        `[subpath-filter] No subpath in baseURL ${baseURL}, returning all ${items.length} items`,
      );
      return items;
    }

    const filtered = items.filter((item) => {
      let urlToCheck;

      // Handle different item types
      if (typeof item === 'string') {
        urlToCheck = item;
      } else if (item && typeof item === 'object') {
        // If urlProperty is a method name (like 'getUrl'), call it
        if (urlProperty && typeof item[urlProperty] === 'function') {
          urlToCheck = item[urlProperty]();
        } else {
          // Try common URL property names
          urlToCheck = item[urlProperty] || item.url || item.urlFrom || item.urlTo
            || item.getUrl?.();
        }
      } else {
        return false;
      }

      return isWithinAuditScope(urlToCheck, baseURL);
    });

    log.debug(
      `[subpath-filter] Filtered ${items.length} items to ${filtered.length} `
      + `based on audit scope: ${basePath}`,
    );
    return filtered;
  } catch (error) {
    log.warn(`[subpath-filter] Error filtering items: ${error.message}, returning all items`);
    return items;
  }
}

/**
 * Extracts the path prefix (locale/subpath) from a URL.
 * Used for filtering alternatives by the same locale as the broken link.
 *
 * @param {string} url - The URL to extract path from
 * @returns {string} - The path prefix (e.g., "/uk" or "/fr") or empty string if no path
 */
export function extractPathPrefix(url) {
  if (!url) {
    return '';
  }

  try {
    const urlWithSchema = prependSchema(url);
    const parsed = new URL(urlWithSchema);
    const { pathname } = parsed;

    if (!pathname || pathname === '/') {
      return '';
    }

    // Get first path segment as locale/subpath
    const segments = pathname.split('/').filter((seg) => seg.length > 0);
    return segments.length > 0 ? `/${segments[0]}` : '';
  } catch (error) {
    return '';
  }
}
