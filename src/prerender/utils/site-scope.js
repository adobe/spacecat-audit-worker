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

/**
 * Checks if a URL is within the site scope defined by siteBaseUrl.
 * For siteBaseUrl with subpath (e.g., bulk.com/uk), only URLs starting with that subpath are
 * included.
 * For siteBaseUrl without subpath (e.g., bulk.com), all URLs are included.
 *
 * @param {string} url - The URL to check (can be relative or absolute)
 * @param {string} siteBaseUrl - The site's base URL defining the scope
 *   (e.g., "bulk.com/uk" or "bulk.com")
 * @returns {boolean} - True if URL is within scope, false otherwise
 */
export function isWithinSiteScope(url, siteBaseUrl) {
  if (!url) {
    return false;
  }
  if (!siteBaseUrl) {
    return true;
  }

  try {
    const baseURLWithSchema = prependSchema(siteBaseUrl);
    const parsedBaseURL = new URL(baseURLWithSchema);
    const rawPath = parsedBaseURL.pathname;
    // Normalize away any trailing slash on the base path before building the guard suffix,
    // otherwise a siteBaseUrl like "bulk.com/uk/" produces basePath="/uk/" and
    // basePathWithSlash="/uk//" which would never match any real URL.
    const basePath = rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    const hasBasePath = basePath && basePath !== '/';

    if (!hasBasePath) {
      return true;
    }

    // Trailing slash prevents false positives (e.g., /uk/ matching /ukraine)
    const basePathWithSlash = `${basePath}/`;

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return url.startsWith(basePathWithSlash) || url === basePath;
    }

    const urlWithSchema = prependSchema(url);
    const parsedUrl = new URL(urlWithSchema);

    const normalizedUrlHost = stripWWW(parsedUrl.hostname);
    const normalizedBaseHost = stripWWW(parsedBaseURL.hostname);
    if (normalizedUrlHost !== normalizedBaseHost || parsedUrl.port !== parsedBaseURL.port) {
      return false;
    }

    return parsedUrl.pathname.startsWith(basePathWithSlash) || parsedUrl.pathname === basePath;
  } catch {
    return false;
  }
}

/**
 * Filters a list of URLs to only those within the site scope.
 * @param {string[]} urls
 * @param {string} siteBaseUrl
 * @returns {string[]}
 */
export function filterBySiteScope(urls, siteBaseUrl) {
  return urls.filter((url) => isWithinSiteScope(url, siteBaseUrl));
}
