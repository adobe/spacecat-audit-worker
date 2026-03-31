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
