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

import { Entitlement, Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { TierClient } from '@adobe/spacecat-shared-tier-client';

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
 * Merges multiple URL arrays, ensures uniqueness by path, and filters out non-HTML URLs
 * (handles www vs non-www differences by checking path only)
 * @param {...Array<string>} urlArrays - Variable number of URL arrays to merge
 * @returns {Object} - Object with unique HTML URLs and filtered count
 *   - urls: Array of unique HTML URLs (by path), preserving original URLs
 *   - filteredCount: Number of non-HTML URLs that were filtered out
 */
export function mergeAndGetUniqueHtmlUrls(...urlArrays) {
  const seenPaths = new Set();
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
      let normalizedPath = pathname;
      if (normalizedPath.length > 1) {
        normalizedPath = normalizedPath.replace(/\/+$/, ''); // Remove all trailing slashes
      }

      // Only add URL if we haven't seen this path before
      if (!seenPaths.has(normalizedPath)) {
        seenPaths.add(normalizedPath);
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

const EDGE_OPTIMIZE_USER_AGENT = 'Tokowaka-AI Tokowaka/1.0 AdobeEdgeOptimize-AI AdobeEdgeOptimize/1.0';

/**
 * Headers that indicate the URL is being served with prerendering/edge optimization enabled.
 * x-tokowaka-request-id: Legacy header (being deprecated)
 * x-edgeoptimize-request-id: New header replacing tokowaka
 */
const PRERENDER_INDICATOR_HEADERS = [
  'x-tokowaka-request-id',
  'x-edgeoptimize-request-id',
];

/**
 * Timeout for verification requests (in milliseconds)
 */
const VERIFICATION_TIMEOUT_MS = 10000;

/**
 * Checks if a URL has prerendering enabled by making a request with the edge optimize user agent
 * and checking for prerender indicator headers in the response.
 *
 * Checks for: x-tokowaka-request-id (legacy), x-edgeoptimize-request-id
 *
 * @param {string} url - The URL to verify
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} - True if prerendering is enabled (any indicator header present)
 */
async function isUrlPrerenderEnabled(url, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VERIFICATION_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': EDGE_OPTIMIZE_USER_AGENT,
        Accept: '*/*',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for any of the prerender indicator headers
    const foundHeaders = PRERENDER_INDICATOR_HEADERS
      .map((header) => ({ header, value: response.headers.get(header) }))
      .filter(({ value }) => Boolean(value));

    return foundHeaders.length > 0;
  } catch (error) {
    clearTimeout(timeoutId);
    log.warn(`Prerender verification failed for ${url}: ${error.message}`);
    return false;
  }
}

/**
 * Verifies NEW suggestions for prerender opportunity and marks them as FIXED
 * if the URL is being served with prerendering/edge optimization enabled.
 *
 * Checks for presence of: x-tokowaka-request-id (legacy) or x-edgeoptimize-request-id headers.
 *
 * @param {Object} opportunity - The opportunity object containing suggestions
 * @param {Object} context - Context with log
 * @returns {Promise<number>} - Number of suggestions marked as fixed
 */
export async function verifyAndMarkFixedSuggestions(opportunity, context) {
  const { log } = context;

  try {
    const suggestions = await opportunity.getSuggestions();
    const newSuggestions = suggestions.filter(
      (s) => s.getStatus() === SuggestionDataAccess.STATUSES.NEW,
    );

    if (newSuggestions.length === 0) {
      return 0;
    }

    // Filter out domain-wide aggregate suggestion (has 'key' in data but no 'url')
    const urlSuggestions = newSuggestions.filter((s) => {
      const data = s.getData();
      return data?.url && !data?.key;
    });

    if (urlSuggestions.length === 0) {
      return 0;
    }

    // Verify each suggestion URL in parallel
    const verificationResults = await Promise.all(
      urlSuggestions.map(async (suggestion) => {
        const { url } = suggestion.getData();
        const isFixed = await isUrlPrerenderEnabled(url, log);
        return { suggestion, isFixed };
      }),
    );

    // Update suggestions that are verified as fixed
    const fixedSuggestions = verificationResults
      .filter(({ isFixed }) => isFixed)
      .map(({ suggestion }) => suggestion);

    if (fixedSuggestions.length > 0) {
      await Promise.all(
        fixedSuggestions.map((suggestion) => {
          suggestion.setStatus(SuggestionDataAccess.STATUSES.FIXED);
          return suggestion.save();
        }),
      );
    }

    return fixedSuggestions.length;
  } catch (error) {
    log.error(`Prerender - verification error: ${error.message}`, error);
    return 0;
  }
}
