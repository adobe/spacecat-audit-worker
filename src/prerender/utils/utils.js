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
 * General utilities for the Prerender audit.
 */

import { Entitlement } from '@adobe/spacecat-shared-data-access';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { DOMAIN_WIDE_SUGGESTION_KEY } from './constants.js';

/**
 * Common non-HTML file extensions that should be filtered out
 */
const NON_HTML_EXTENSIONS = new Set([
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  // Media
  '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav', '.ogg',
  // Archives
  '.zip', '.rar', '.tar', '.gz', '.7z',
  // Code/Data
  '.json', '.xml', '.css', '.js', '.ts', '.map',
  // Other
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
]);

/**
 * Checks if a URL points to a non-HTML resource based on file extension
 * @param {string} pathname - The pathname from a URL object
 * @returns {boolean} - True if the URL has a non-HTML extension
 */
function hasNonHtmlExtension(pathname) {
  const lowerPath = pathname.toLowerCase();
  return Array.from(NON_HTML_EXTENSIONS).some((ext) => lowerPath.endsWith(ext));
}

/**
 * Extracts the pathname from a URL string, stripping trailing slashes on non-root paths.
 * Falls back to the raw string when the URL is not parseable (e.g. invalid or relative).
 *
 * @param {string} url
 * @returns {string} pathname, or the original string on parse failure
 */
export function toPathname(url) {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' ? pathname : pathname.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Normalizes a URL to its pathname + search string.
 * Trailing slashes on the pathname are removed (except for the root path).
 * Falls back to the raw string when the URL is not parseable.
 * @param {string} url
 * @returns {string} pathname+search, or the original string on parse failure
 */
export function normalizePathnameWithQuery(url) {
  try {
    const { pathname, search } = new URL(url);
    const normalized = (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname).toLowerCase();
    return search ? `${normalized}${search}` : normalized;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Builds a dedup key for a prerender suggestion.
 * Domain-wide suggestions (incoming items with `.key` or stored records with
 * `isDomainWide:true`) always return the same constant so that syncSuggestions
 * matches existing domain-wide records instead of creating duplicates.
 * Individual suggestions are keyed by pathname+search.
 * @param {Object} data - Suggestion data or incoming new-data item
 * @returns {string} dedup key
 */
export function buildSuggestionKey(data) {
  if (data.key === DOMAIN_WIDE_SUGGESTION_KEY || data.isDomainWide) {
    return DOMAIN_WIDE_SUGGESTION_KEY;
  }
  return normalizePathnameWithQuery(data.url);
}

/**
 * Merges multiple URL arrays, ensures uniqueness, and filters out non-HTML URLs.
 * By default, deduplicates by pathname only (handles www vs non-www differences).
 * When includeQueryParams is true, query parameters are included in the uniqueness
 * key so that URLs like /page?a=1 and /page?b=2 are treated as distinct.
 * @param {Array<string>} urlArrays - URL arrays to merge (spread or single array)
 * @param {Object} [options] - Options object (must be last argument)
 * @param {boolean} [options.includeQueryParams=false] - Include query params in dedup key
 * @returns {Object} - Object with unique HTML URLs and filtered count
 *   - urls: Array of unique HTML URLs, preserving original URLs
 *   - filteredCount: Number of non-HTML URLs that were filtered out
 */
export function mergeAndGetUniqueHtmlUrls(...args) {
  const lastArg = args[args.length - 1];
  const hasOptions = lastArg && !Array.isArray(lastArg) && typeof lastArg === 'object';
  const { includeQueryParams = false } = hasOptions ? lastArg : {};
  const urlArrays = hasOptions ? args.slice(0, -1) : args;

  const seenKeys = new Set();
  const uniqueUrls = [];
  let filteredCount = 0;

  // Flatten all arrays and process each URL
  urlArrays.flat().forEach((url) => {
    try {
      const urlObj = new URL(url);
      const { pathname } = urlObj;

      // Skip non-HTML URLs
      if (hasNonHtmlExtension(pathname)) {
        filteredCount += 1;
        return;
      }

      // Normalize path by removing all trailing slashes (except for root path)
      let dedupKey = pathname;
      if (dedupKey.length > 1) {
        dedupKey = dedupKey.replace(/\/+$/, ''); // Remove all trailing slashes
      }

      // Include the raw query string in the dedup key when requested,
      // so the user gets exactly what they passed in the CSV.
      if (includeQueryParams && urlObj.search) {
        dedupKey += urlObj.search;
      }

      // Only add URL if we haven't seen this key before
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        uniqueUrls.push(url); // Keep original URL unchanged
      }
    } catch (error) {
      // If URL parsing fails, add it anyway (edge case handling)
      uniqueUrls.push(url);
    }
  });

  return {
    urls: uniqueUrls,
    filteredCount,
  };
}

/**
 * Checks if the site belongs to a paid LLMO customer
 * @param {Object} context - Context with site, dataAccess and log
 * @returns {Promise<boolean>} - True if paid LLMO customer, false otherwise
 */
export async function isPaidLLMOCustomer(context) {
  const { site, log } = context;
  try {
    // Check for LLMO product code entitlement
    const tierClient = await TierClient.createForSite(
      context,
      site,
      Entitlement.PRODUCT_CODES.LLMO,
    );
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement.getTier() ?? null;
    const isPaid = tier === Entitlement.TIERS.PAID;

    log.debug(`Prerender - isPaidLLMOCustomer check: siteId=${site.getId()}, tier=${tier}, isPaid=${isPaid}`);
    return isPaid;
  } catch (e) {
    log.warn(`Prerender - Failed to check paid LLMO customer status for siteId=${site.getId()}: ${e.message}`);
    return false;
  }
}
