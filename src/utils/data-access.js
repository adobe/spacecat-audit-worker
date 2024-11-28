/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { isObject } from '@adobe/spacecat-shared-utils';

/**
 * Fetches site data based on the given base URL. If no site is found for the given
 * base URL, null is returned. Otherwise, the site object is returned. If an error
 * occurs while fetching the site, an error is thrown.
 *
 * @async
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} siteId - The siteId of the site to fetch data for.
 * @param {Object} log - The logging object.
 * @throws {Error} - Throws an error if the site data cannot be fetched.
 * @returns {Promise<Object|null>} - Returns the site object if found, otherwise null.
 */
export async function retrieveSiteBySiteId(dataAccess, siteId, log) {
  try {
    const site = await dataAccess.getSiteByID(siteId);
    if (!isObject(site)) {
      log.warn(`Site not found for site: ${siteId}`);
      return null;
    }
    return site;
  } catch (e) {
    throw new Error(`Error getting site ${siteId}: ${e.message}`);
  }
}

// copied from https://github.com/adobe/spacecat-audit-worker/pull/475/files#diff-74f4c74bec5502c1f20ed840e20b348687c5eeaca9af8a6ecb5df6ae82519f68R39
// todo delete after merging code from that PR
/**
 * Synchronizes existing suggestions with new data by removing outdated suggestions
 * and adding new ones.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newData - Array of new data objects to sync.
 * @param {Function} params.buildKey - Function to generate a unique key for each item.
 * @param {Function} params.mapNewSuggestion - Function to map new data to suggestion objects.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncSuggestions({
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  log,
}) {
  const newDataKeys = new Set(newData.map(buildKey));
  const existingSuggestions = await opportunity.getSuggestions();

  // Remove outdated suggestions
  await Promise.all(
    existingSuggestions
      .filter((existing) => !newDataKeys.has(buildKey(existing)))
      .map((suggestion) => suggestion.remove()),
  );

  // Prepare new suggestions
  const newSuggestions = newData
    .filter((data) => !existingSuggestions.some(
      (existing) => buildKey(existing) === buildKey(data),
    ))
    .map(mapNewSuggestion);

  // Add new suggestions if any
  if (newSuggestions.length > 0) {
    const suggestions = await opportunity.addSuggestions(newSuggestions);

    if (suggestions.errorItems?.length > 0) {
      log.error(`Suggestions for siteId ${opportunity.getSiteId()} contains ${suggestions.errorItems.length} items with errors`);
      suggestions.errorItems.forEach((errorItem) => {
        log.error(`Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
      });

      if (suggestions.createdItems?.length <= 0) {
        throw new Error(`Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
      }
    }
  }
}
