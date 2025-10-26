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
import { isNonEmptyArray, isObject } from '@adobe/spacecat-shared-utils';
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
 * Retrieves the IMS org ID for a given site.
 *
 * @param {Object} site - The site object.
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {Object} log - The logging object.
 * @returns {Promise<string|null>} - Returns the IMS org ID if found, otherwise null.
 */
export async function getImsOrgId(site, dataAccess, log) {
  try {
    const organizationId = site.getOrganizationId();
    if (!organizationId) {
      log.warn(`No organization ID found for site: ${site.getBaseURL()}`);
      return null;
    }

    const { Organization } = dataAccess;
    const organization = await Organization.findById(organizationId);
    const imsOrgId = organization?.getImsOrgId();

    if (!imsOrgId) {
      log.warn(`No IMS org ID found for organization: ${organizationId}`);
      return null;
    }

    return imsOrgId;
  } catch (error) {
    log.warn(`Failed to get IMS org ID for site ${site.getBaseURL()}: ${error.message}`);
    return null;
  }
}

/**
 * Handles outdated suggestions by updating their status to OUTDATED by default,
 * or the status given as input.
 *
 * @param {Object} params - The parameters for the handleOutdatedSuggestions operation.
 * @param {Suggestion[]} params.existingSuggestions - The existing suggestions.
 * @param {Set} params.newDataKeys - The set of new data keys to check for outdated suggestions.
 * @param {Function} params.buildKey - The function to build a unique key for each suggestion.
 * @param {Object} params.context - The context object containing the data access object.
 * @returns {Promise<void>} - Resolves when the outdated suggestions are updated.
 */
const handleOutdatedSuggestions = async ({
  context,
  opportunity,
  existingSuggestions,
  newDataKeys,
  buildKey,
  statusToSetForOutdated = SuggestionDataAccess.STATUSES.OUTDATED,
}) => {
  const { Suggestion } = context.dataAccess;
  const { log } = context;
  const existingOutdatedSuggestions = existingSuggestions
    .filter((existing) => !newDataKeys.has(buildKey(existing.getData())))
    .filter((existing) => ![
      SuggestionDataAccess.STATUSES.OUTDATED,
      SuggestionDataAccess.STATUSES.FIXED,
      SuggestionDataAccess.STATUSES.ERROR,
      SuggestionDataAccess.STATUSES.SKIPPED,
    ].includes(existing.getStatus()));

  log.debug(`Outdated suggestions = ${existingOutdatedSuggestions.length}: ${JSON.stringify(existingOutdatedSuggestions, null, 2)}`);

  if (isNonEmptyArray(existingOutdatedSuggestions)) {
    await Suggestion.bulkUpdateStatus(
      existingOutdatedSuggestions,
      statusToSetForOutdated,
    );
  }
  if (statusToSetForOutdated === SuggestionDataAccess.STATUSES.FIXED && opportunity) {
    log.info('Adding FixEntity items for FIXED suggestions with existingOutdatedSuggestions length: ', existingOutdatedSuggestions.length);
    const { FixEntity: FixEntityModel } = context.dataAccess;
    const { site } = context;
    // Create a FixEntity for each suggestion that was marked FIXED
    await Promise.all(existingOutdatedSuggestions.map(async (s) => {
      try {
        await opportunity.addFixEntities([{
          opportunityId: opportunity.getId(),
          status: FixEntityModel?.STATUSES?.PUBLISHED,
          type: s.getType(),
          executedAt: new Date().toISOString(),
          changeDetails: {
            system: site?.getDeliveryType?.(),
            data: s.getData?.(),
          },
          origin: FixEntityModel?.ORIGINS?.SPACECAT,
        }]);
      } catch (e) {
        log?.warn?.(`Failed to add FixEntity for suggestion ${s.getId?.()}: ${e.message}`);
      }
    }));
  }
};

export const keepSameDataFunction = (existingData) => ({ ...existingData });

/**
 * Default merge function for combining existing and new data.
 * This performs a shallow merge where new data overrides existing data.
 *
 * @param {Object} existingData - The existing suggestion data.
 * @param {Object} newData - The new data to merge.
 * @returns {Object} - The merged data object.
 */
const defaultMergeDataFunction = (existingData, newData) => ({
  ...existingData,
  ...newData,
});

/**
 * Keep latest merge function for combining existing and new data.
 * This performs a shallow merge where new data overrides existing data.
 * @param {Object} existingData - The existing suggestion data.
 * @param {Object} newData - The new data to merge.
 * @returns {Object} - The merged data object.
 */
export const keepLatestMergeDataFunction = (existingData, newData) => ({
  ...newData,
});

/**
 * Synchronizes existing suggestions with new data.
 * Handles outdated suggestions by updating their status, either to OUTDATED or the provided one.
 * Updates existing suggestions with new data if they match based on the provided key.
 *
 * Prepares new suggestions from the new data and adds them to the opportunity.
 * Maps new data to suggestion objects using the provided mapping function.
 *
 * @param {Object} params - The parameters for the sync operation.
 * @param {Object} params.context - The context object containing the data access object and logger.
 * @param {Object} params.opportunity - The opportunity object to synchronize suggestions for.
 * @param {Array} params.newData - Array of new data objects to sync.
 * @param {Function} params.buildKey - Function to generate a unique key for each item.
 * @param {Function} params.mapNewSuggestion - Function to map new data to suggestion objects.
 * @param {Function} [params.mergeDataFunction] - Function to merge existing and new data.
 *   Defaults to shallow merge.
 * @param {string} [params.statusToSetForOutdated] - Status to set for outdated suggestions.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncSuggestions({
  context,
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  mergeDataFunction = defaultMergeDataFunction,
  statusToSetForOutdated = SuggestionDataAccess.STATUSES.OUTDATED,
}) {
  if (!context) {
    return;
  }
  const { log } = context;
  const newDataKeys = new Set(newData.map(buildKey));
  const existingSuggestions = await opportunity.getSuggestions();

  // Update outdated suggestions
  await handleOutdatedSuggestions({
    existingSuggestions,
    newDataKeys,
    buildKey,
    context,
    opportunity,
    statusToSetForOutdated,
  });

  log.debug(`Existing suggestions = ${existingSuggestions.length}: ${JSON.stringify(existingSuggestions, null, 2)}`);

  // Update existing suggestions
  await Promise.all(
    existingSuggestions
      .filter((existing) => {
        const existingKey = buildKey(existing.getData());
        return newDataKeys.has(existingKey);
      })
      .map((existing) => {
        const newDataItem = newData.find((data) => buildKey(data) === buildKey(existing.getData()));
        existing.setData(mergeDataFunction(existing.getData(), newDataItem));
        if ([SuggestionDataAccess.STATUSES.OUTDATED].includes(existing.getStatus())) {
          log.warn('Resolved suggestion found in audit. Possible regression.');
          existing.setStatus(SuggestionDataAccess.STATUSES.NEW);
        }
        existing.setUpdatedBy('system');
        return existing.save();
      }),
  );
  log.debug(`Updated existing suggestions = ${existingSuggestions.length}: ${JSON.stringify(existingSuggestions, null, 2)}`);

  // Prepare new suggestions
  const newSuggestions = newData
    .filter((data) => !existingSuggestions.some(
      (existing) => buildKey(existing.getData()) === buildKey(data),
    ))
    .map(mapNewSuggestion);

  // Add new suggestions if any
  if (newSuggestions.length > 0) {
    const suggestions = await opportunity.addSuggestions(newSuggestions);
    log.debug(`New suggestions = ${suggestions.length}: ${JSON.stringify(suggestions, null, 2)}`);

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
