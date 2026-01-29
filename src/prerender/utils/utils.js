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
 * Merges multiple URL arrays and ensures uniqueness by path
 * (handles www vs non-www differences by checking path only)
 * @param {...Array<string>} urlArrays - Variable number of URL arrays to merge
 * @returns {Array<string>} - Array of unique URLs (by path), preserving original URLs
 */
export function mergeUniqueUrls(...urlArrays) {
  const seenPaths = new Set();
  const uniqueUrls = [];

  // Flatten all arrays and process each URL
  urlArrays.flat().forEach((url) => {
    try {
      const urlObj = new URL(url);
      // Normalize path by removing all trailing slashes (except for root path)
      let path = urlObj.pathname;
      if (path.length > 1) {
        path = path.replace(/\/+$/, ''); // Remove all trailing slashes
      }

      // Only add URL if we haven't seen this path before
      if (!seenPaths.has(path)) {
        seenPaths.add(path);
        uniqueUrls.push(url); // Keep original URL unchanged
      }
    } catch (error) {
      // If URL parsing fails, add it anyway (edge case handling)
      uniqueUrls.push(url);
    }
  });

  return uniqueUrls;
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
