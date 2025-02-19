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
import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';

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
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!isObject(site)) {
      log.warn(`Site not found for site: ${siteId}`);
      return null;
    }
    return site;
  } catch (e) {
    throw new Error(`Error getting site ${siteId}: ${e.message}`);
  }
}

/**
 * Retrieves an audit record by its ID.
 *
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} auditId - The ID of the audit record to retrieve.
 * @param {Object} log - The logging object.
 * @returns {Promise<Object|null>} - Returns the audit record if found, otherwise null.
 */
export async function retrieveAuditById(dataAccess, auditId, log) {
  try {
    const { Audit } = dataAccess;
    const audit = await Audit.findById(auditId);
    if (!isObject(audit)) {
      log.warn(`Audit not found for auditId: ${auditId}`);
      return null;
    }
    return audit;
  } catch (e) {
    throw new Error(`Error getting audit ${auditId}: ${e.message}`);
  }
}

/**
 * Handles outdated suggestions by updating their status to OUTDATED.
 *
 * @param {Object} params - The parameters for the handleOutdatedSuggestions operation.
 * @param {Suggestion[]} params.existingSuggestions - The existing suggestions.
 * @param {Set} params.newDataKeys - The set of new data keys to check for outdated suggestions.
 * @param {Function} params.buildKey - The function to build a unique key for each suggestion.
 * @param {Object} params.context - The context object containing the data access object.
 * @returns {Promise<void>} - Resolves when the outdated suggestions are updated.
 */
const handleOutdatedSuggestions = async ({
  existingSuggestions, newDataKeys, buildKey, context,
}) => {
  // Check if context is provided
  if (context) {
    const { Suggestion } = context.dataAccess;
    const existingOutdatedSuggestions = existingSuggestions
      .filter((existing) => !newDataKeys.has(buildKey(existing.getData())))
      .filter((existing) => existing.getStatus() !== SuggestionDataAccess.STATUSES.OUTDATED);
    await Suggestion.bulkUpdateStatus(
      existingOutdatedSuggestions,
      SuggestionDataAccess.STATUSES.OUTDATED,
    );
  }
};

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
  context,
  buildKey,
  mapNewSuggestion,
  log,
}) {
  const newDataKeys = new Set(newData.map(buildKey));
  const existingSuggestions = await opportunity.getSuggestions();
  // Remove outdated suggestions
  await handleOutdatedSuggestions({
    existingSuggestions,
    newDataKeys,
    buildKey,
    context,
  });

  // Update existing suggestions
  const RESOLVED_STATUSES = [
    SuggestionDataAccess.STATUSES.OUTDATED,
    SuggestionDataAccess.STATUSES.FIXED,
  ];
  await Promise.all(
    existingSuggestions
      .filter((existing) => {
        const existingKey = buildKey(existing.getData());
        return newDataKeys.has(existingKey);
      })
      .map((existing) => {
        const newDataItem = newData.find((data) => buildKey(data) === buildKey(existing.getData()));
        existing.setData({
          ...existing.getData(),
          ...newDataItem,
        });
        if (RESOLVED_STATUSES.includes(existing.getStatus())) {
          log.warn('Resolved suggestion found in audit. Possible regression.');
          existing.setStatus(SuggestionDataAccess.STATUSES.NEW);
        }
        return existing.save();
      }),
  );

  // Prepare new suggestions
  const newSuggestions = newData
    .filter((data) => !existingSuggestions.some(
      (existing) => buildKey(existing.getData()) === buildKey(data),
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
