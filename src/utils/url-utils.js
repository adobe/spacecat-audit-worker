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

import {
  hasText,
  prependSchema,
  stripWWW,
  tracingFetch as fetch,
} from '@adobe/spacecat-shared-utils';

/**
 * Checks if a given URL is a "preview" page
 *
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL is a "preview" page, false otherwise
 */
export function isPreviewPage(url) {
  const urlObj = new URL(url);
  return urlObj.hostname.endsWith('.page');
}

export async function filterBrokenSuggestedUrls(suggestedUrls, baseURL) {
  const baseDomain = new URL(baseURL).hostname;
  const checks = suggestedUrls.map(async (suggestedUrl) => {
    try {
      const schemaPrependedUrl = prependSchema(stripWWW(suggestedUrl));
      const suggestedURLObj = new URL(schemaPrependedUrl);
      if (suggestedURLObj.hostname === baseDomain) {
        const response = await fetch(schemaPrependedUrl);
        if (response.ok) {
          return suggestedUrl;
        }
      }
      return null;
      // eslint-disable-next-line no-unused-vars
    } catch (error) {
      return null;
    }
  });
  return (await Promise.all(checks)).filter((url) => url !== null);
}

/**
 * Gets the country code (lowercased) from a language code.
 * If the language code is not in the format of "language-country" or "language_country",
 * the default country code is returned.
 * @param {string} lang - The language code.
 * @param {string} defaultCountry - The default country code.
 * @returns {string} - The country code.
 */
export function getCountryCodeFromLang(lang, defaultCountry = 'us') {
  if (!hasText(lang)) return defaultCountry;
  // Split on hyphen or underscore (both are used in the wild)
  const parts = lang.split(/[-_]/);
  if (parts.length === 2 && parts[1].length === 2) {
    // Return the country part, uppercased
    return parts[1].toLowerCase();
  }
  // If only language is present, return default
  return defaultCountry;
}

/**
 * Parses comma-separated URLs from Slack command data
 * @param {string} data - Comma-separated URLs string
 * @returns {Array|null} Array of unique URLs or null
 */
export function parseCustomUrls(data) {
  if (!hasText(data)) {
    return null;
  }

  const urls = data
    .split(',')
    .map((url) => url.trim())
    .map((url) => url.replace(/^<|>$/g, '').trim()) // Remove < at start and > at end, then trim again
    .filter((url) => hasText(url));

  return urls.length > 0 ? [...new Set(urls)] : null;
}

/**
 * Finds the best matching path from config based on context.
 * Sorts by depth (deepest first) to find most specific match.
 * Use case: Config path resolution for multi-locale configurations.
 * @param {Object} sectionData - The config section (e.g., public).
 * @param {string} contextPath - The path to match (e.g., '/en/us/products').
 * @returns {string} The best matching config key.
 */
export function findBestMatchingPath(sectionData, contextPath) {
  if (!hasText(contextPath) || contextPath === 'default') {
    return 'default';
  }

  const paths = Object.keys(sectionData)
    .filter((key) => key !== 'default')
    .sort((a, b) => {
      const aDepth = a.split('/').filter(Boolean).length;
      const bDepth = b.split('/').filter(Boolean).length;
      return bDepth - aDepth; // Deepest first
    });

  // Find exact match or startsWith match
  for (const path of paths) {
    if (contextPath === path || contextPath.startsWith(path)) {
      return path;
    }
  }

  return 'default';
}

/**
 * Removes trailing slash from a URL if present.
 * @param {string} url - The URL to process
 * @returns {string} URL without trailing slash
 */
export function removeTrailingSlash(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Gets the base URL from a full URL, optionally returning only the hostname.
 * @param {string} url - The full URL
 * @param {boolean} useHostnameOnly - If true, returns protocol + host only
 * @returns {string} Base URL (with or without path)
 */
export function getBaseUrl(url, useHostnameOnly = false) {
  if (useHostnameOnly) {
    try {
      const urlObj = new URL(url);
      return `${urlObj.protocol}//${urlObj.host}`; // includes port if any
    } catch {
      // If URL parsing fails, return the original URL with trailing slash removed
      return removeTrailingSlash(url);
    }
  }
  return removeTrailingSlash(url);
}
