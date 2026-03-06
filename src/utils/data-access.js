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
import {
  Suggestion as SuggestionDataAccess,
  FixEntity as FixEntityDataAccess,
} from '@adobe/spacecat-shared-data-access';
import { limitConcurrencyAllSettled } from '../support/utils.js';

// Max concurrent HTTP calls to prevent Lambda timeout (15 min)
const MAX_CONCURRENT_CHECKS = 5;

/**
 * Opportunity types that only make changes in the author environment (no publish state).
 * For these types:
 * - Fix entities are created directly in DEPLOYED state (final state)
 * - Skip the publish step (publishDeployedFixEntities)
 * - Regression checks look for DEPLOYED fix entities instead of PUBLISHED
 */
export const AUTHOR_ONLY_OPPORTUNITY_TYPES = [
  'security-permissions-redundant',
  'security-permissions',
];

/**
 * Safely stringify an object for logging, truncating large arrays to prevent
 * exceeding JavaScript's maximum string length.
 *
 * @param {*} data - The data to stringify.
 * @param {number} maxArrayLength - Maximum number of array items to include (default: 10).
 * @returns {string} - The stringified data or an error message.
 */
function safeStringify(data, maxArrayLength = 10) {
  try {
    if (Array.isArray(data) && data.length > maxArrayLength) {
      const truncated = data.slice(0, maxArrayLength);
      return JSON.stringify({
        truncated: true,
        totalLength: data.length,
        items: truncated,
        message: `Showing first ${maxArrayLength} of ${data.length} items`,
      }, null, 2);
    }
    return JSON.stringify(data, null, 2);
  } catch (error) {
    return `[Unable to stringify: ${error.message}. Total items: ${Array.isArray(data) ? data.length : 'N/A'}]`;
  }
}

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
 * Retrieves the top pages for a given site.
 *
 * @param {Object} dataAccess - The data access object for database operations.
 * @param {string} siteId - The site ID to retrieve the top pages for.
 * @param {Object} context - The context object containing necessary information.
 * @param {Object} log - The logging object.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of top pages.
 */
export async function getTopPagesForSiteId(dataAccess, siteId, context, log) {
  try {
    const { SiteTopPage } = dataAccess;
    const result = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    log.info('Received top pages response:', JSON.stringify(result, null, 2));

    const topPages = result || [];
    if (topPages.length > 0) {
      const topPagesUrls = topPages.map((page) => ({ url: page.getUrl() }));
      log.info(`Found ${topPagesUrls.length} top pages`);
      return topPagesUrls;
    }
    log.info('No top pages found');
    return [];
  } catch (error) {
    log.error(`Error retrieving top pages for site ${siteId}: ${error.message}`);
    throw error;
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
 * @param {Set} [params.scrapedUrlsSet] - Optional set of URLs that were scraped in this audit
 * @returns {Promise<void>} - Resolves when the outdated suggestions are updated.
 */
export const handleOutdatedSuggestions = async ({
  context,
  existingSuggestions,
  newDataKeys,
  buildKey,
  statusToSetForOutdated = SuggestionDataAccess.STATUSES.OUTDATED,
  scrapedUrlsSet = null,
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
      SuggestionDataAccess.STATUSES.REJECTED,
      SuggestionDataAccess.STATUSES.APPROVED,
      SuggestionDataAccess.STATUSES.IN_PROGRESS,
      SuggestionDataAccess.STATUSES.PENDING_VALIDATION,
    ].includes(existing.getStatus()))
    .filter((existing) => {
      // Preserve suggestions that have been deployed (tokowakaDeployed or edgeDeployed)
      const data = existing.getData?.();
      return !(data?.tokowakaDeployed || data?.edgeDeployed);
    })
    .filter((existing) => {
      // mark suggestions as outdated only if their URL was actually scraped
      if (scrapedUrlsSet) {
        const suggestionUrl = existing.getData()?.url;
        return suggestionUrl && scrapedUrlsSet.has(suggestionUrl);
      }
      return true;
    });

  // prevents JSON.stringify overflow
  log.info(`[SuggestionSync] Final count of suggestions to mark as ${statusToSetForOutdated}: ${existingOutdatedSuggestions.length}`);
  if (existingOutdatedSuggestions.length > 0 && existingOutdatedSuggestions.length <= 10) {
    log.debug(`Outdated suggestions sample: ${JSON.stringify(existingOutdatedSuggestions, null, 2)}`);
  } else if (existingOutdatedSuggestions.length > 10) {
    log.debug(`Outdated suggestions sample (first 10): ${JSON.stringify(existingOutdatedSuggestions.slice(0, 10), null, 2)}`);
  }

  if (isNonEmptyArray(existingOutdatedSuggestions)) {
    await Suggestion.bulkUpdateStatus(
      existingOutdatedSuggestions,
      statusToSetForOutdated,
    );
  }
};

export const keepSameDataFunction = (existingData) => ({ ...existingData });

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
 * Default merge function for determining the status of an existing suggestion.
 * This function encapsulates the default behavior for status transitions:
 * - REJECTED suggestions remain REJECTED
 * - OUTDATED suggestions transition to PENDING_VALIDATION or NEW (possible regression)
 * - Other statuses remain unchanged
 *
 * @param {Object} existing - The existing suggestion object.
 * @param {Object} newDataItem - The new data item being merged.
 * @param {Object} context - The context object containing site and log.
 * @returns {string|null} - The new status to set, or null to keep existing status.
 */
export const defaultMergeStatusFunction = (existing, newDataItem, context) => {
  const { log, site } = context;
  const currentStatus = existing.getStatus();

  if (currentStatus === SuggestionDataAccess.STATUSES.REJECTED) {
    // Keep REJECTED status when same suggestion appears again in audit
    log.debug('REJECTED suggestion found in audit. Preserving REJECTED status.');
    return null; // Keep existing status
  }

  if (currentStatus === SuggestionDataAccess.STATUSES.OUTDATED) {
    log.warn('Outdated suggestion found in audit. Possible regression.');
    const requiresValidation = Boolean(site?.requiresValidation);
    return requiresValidation
      ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
      : SuggestionDataAccess.STATUSES.NEW;
  }

  return null; // Keep existing status
};

/**
 * Synchronizes existing suggestions with new data.
 * Handles outdated suggestions by updating their status, either to OUTDATED or the provided one.
 * Updates existing suggestions with new data if they match based on the provided key.
 * For REJECTED suggestions that appear again, preserves REJECTED status
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
 * @param {Function} [params.mergeStatusFunction] - Function to determine the status of
 *   existing suggestions.
 * @param {string} [params.statusToSetForOutdated] - Status to set for outdated suggestions.
 * @param {Array} [params.existingSuggestions] - Pre-fetched suggestions to avoid duplicate
 *   DB query. If not provided, will be fetched from opportunity.
 * @returns {Promise<void>} - Resolves when the synchronization is complete.
 */
export async function syncSuggestions({
  context,
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  mergeDataFunction = defaultMergeDataFunction,
  mergeStatusFunction = defaultMergeStatusFunction,
  statusToSetForOutdated = SuggestionDataAccess.STATUSES.OUTDATED,
  scrapedUrlsSet = null,
  existingSuggestions: prefetchedSuggestions = null,
}) {
  if (!context) {
    return;
  }
  const { log } = context;
  const newDataKeys = new Set(newData.map(buildKey));
  // Use pre-fetched suggestions if provided, otherwise fetch from DB
  const existingSuggestions = prefetchedSuggestions ?? await opportunity.getSuggestions();

  // Pre-compute Maps for O(1) lookups instead of O(N*M)
  const newDataByKey = new Map(newData.map((data) => [buildKey(data), data]));
  const existingSuggestionKeys = new Set(
    existingSuggestions.map((s) => buildKey(s.getData())),
  );

  // Update outdated suggestions
  await handleOutdatedSuggestions({
    existingSuggestions,
    newDataKeys,
    buildKey,
    context,
    statusToSetForOutdated,
    scrapedUrlsSet,
  });

  log.debug(`Existing suggestions = ${existingSuggestions.length}: ${safeStringify(existingSuggestions)}`);

  // Update existing suggestions - O(N) with Map lookup
  await Promise.all(
    existingSuggestions
      .filter((existing) => {
        const existingKey = buildKey(existing.getData());
        return newDataKeys.has(existingKey);
      })
      .map((existing) => {
        const existingKey = buildKey(existing.getData());
        const newDataItem = newDataByKey.get(existingKey);
        existing.setData(mergeDataFunction(existing.getData(), newDataItem));

        // Use the merge status function to determine if status should change
        const newStatus = mergeStatusFunction(existing, newDataItem, context);
        // null indicates to keep existing status
        if (newStatus !== null) {
          existing.setStatus(newStatus);
        }
        existing.setUpdatedBy('system');
        return existing.save();
      }),
  );
  log.debug(`Updated existing suggestions = ${existingSuggestions.length}: ${safeStringify(existingSuggestions)}`);

  // Prepare new suggestions - O(N) with Set lookup
  const { site } = context;
  const requiresValidation = Boolean(site?.requiresValidation);
  const newSuggestions = newData
    .filter((data) => !existingSuggestionKeys.has(buildKey(data)))
    .map((data) => {
      const suggestion = mapNewSuggestion(data);
      return {
        ...suggestion,
        status: requiresValidation ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
          : SuggestionDataAccess.STATUSES.NEW,
      };
    });

  // Add new suggestions if any
  if (newSuggestions.length > 0) {
    const siteId = opportunity.getSiteId?.() || 'unknown';
    log.info(`Adding ${newSuggestions.length} new suggestions for siteId ${siteId}`);

    const suggestions = await opportunity.addSuggestions(newSuggestions);
    log.debug(`New suggestions = ${suggestions.length}: ${safeStringify(suggestions)}`);

    if (suggestions.errorItems?.length > 0) {
      log.error(`Suggestions for siteId ${siteId} contains ${suggestions.errorItems.length} items with errors out of ${newSuggestions.length} total`);

      // Log first few errors with more detail
      const errorsToLog = suggestions.errorItems.slice(0, 5);
      errorsToLog.forEach((errorItem, index) => {
        log.error(`Error ${index + 1}/${suggestions.errorItems.length}: ${errorItem.error}`);
        log.error(`Failed item data: ${safeStringify(errorItem.item, 1)}`);
      });

      if (suggestions.errorItems.length > 5) {
        log.error(`... and ${suggestions.errorItems.length - 5} more errors`);
      }

      if (suggestions.createdItems?.length <= 0) {
        const sampleError = suggestions.errorItems[0]?.error || 'Unknown error';
        log.error('[suggestions.errorItems]', suggestions.errorItems);
        throw new Error(`Failed to create suggestions for siteId ${siteId}. Sample error: ${sampleError}`);
      } else {
        log.warn(`Partial success: Created ${suggestions.createdItems.length} suggestions, ${suggestions.errorItems.length} failed`);
      }
    } else {
      log.debug(`Successfully created ${suggestions.createdItems?.length || suggestions.length} suggestions for siteId ${siteId}`);
    }
  }
}

/**
 * Computes suggestions that have "disappeared" from the current audit data.
 * A suggestion is considered disappeared if its key is no longer present in newDataKeys.
 *
 * @param {Array} existingSuggestions - The existing suggestions from the opportunity.
 * @param {Set} newDataKeys - Set of keys from current audit data.
 * @param {Function} buildKey - Function to generate a unique key from suggestion data.
 * @returns {Array} - Suggestions whose keys are not in newDataKeys.
 */
export function getDisappearedSuggestions(existingSuggestions, newDataKeys, buildKey) {
  return existingSuggestions.filter(
    (suggestion) => !newDataKeys.has(buildKey(suggestion.getData())),
  );
}

/**
 * Reconciles disappeared suggestions by checking if issues were fixed externally.
 * For suggestions in NEW status that have disappeared from audit data, this function
 * checks if the issue was resolved using the AI suggestion and marks them as FIXED.
 *
 * @param {Object} params - The parameters object.
 * @param {Object} params.opportunity - The opportunity object with addFixEntities method.
 * @param {Array} params.disappearedSuggestions - Suggestions no longer in audit data.
 * @param {Object} params.log - Logger object.
 * @param {Function} params.isIssueFixedWithAISuggestion - Async callback to verify fix.
 * @param {Function} params.buildFixEntityPayload - Function to build fix entity payload.
 * @param {boolean} [params.isAuthorOnly=false] - If true, this is an author-only opportunity.
 * @returns {Promise<void>}
 */
export async function reconcileDisappearedSuggestions({
  opportunity,
  disappearedSuggestions,
  log,
  isIssueFixedWithAISuggestion,
  buildFixEntityPayload,
  isAuthorOnly = false,
}) {
  try {
    const newStatus = SuggestionDataAccess?.STATUSES?.NEW;

    // From disappeared suggestions, only process those in NEW status
    const candidates = disappearedSuggestions.filter((s) => {
      if (!newStatus || s?.getStatus?.() !== newStatus) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      return;
    }

    // Use bounded concurrency for HTTP checks to prevent Lambda timeout
    const checkTasks = candidates.map((suggestion) => async () => {
      const isFixed = await isIssueFixedWithAISuggestion?.(suggestion);
      return { suggestion, isFixed };
    });

    const checkResults = await limitConcurrencyAllSettled(checkTasks, MAX_CONCURRENT_CHECKS);
    const fixedSuggestions = checkResults.filter((r) => r?.isFixed).map((r) => r.suggestion);

    const fixEntityObjects = [];

    // Process fixed suggestions (DB operations are fast, no concurrency limit needed)
    for (const suggestion of fixedSuggestions) {
      log.debug(`[reconcileDisappearedSuggestions] Marking suggestion ${suggestion?.getId?.()} as FIXED`);
      let suggestionMarkedFixed = false;
      try {
        suggestion.setStatus?.(SuggestionDataAccess.STATUSES.FIXED);
        suggestion.setUpdatedBy?.('system');
        // eslint-disable-next-line no-await-in-loop
        await suggestion.save?.();
        suggestionMarkedFixed = true;
      } catch (e) {
        log.warn(`Failed to mark suggestion ${suggestion?.getId?.()} as FIXED: ${e.message}`);
      }

      if (suggestionMarkedFixed && typeof buildFixEntityPayload === 'function') {
        try {
          const fixEntity = buildFixEntityPayload(suggestion, opportunity, isAuthorOnly);
          if (fixEntity) {
            fixEntityObjects.push(fixEntity);
          }
        } catch (e) {
          log.warn(`Failed building fix entity for suggestion ${suggestion?.getId?.()}: ${e.message}`);
        }
      }
    }

    if (fixEntityObjects.length > 0 && typeof opportunity.addFixEntities === 'function') {
      try {
        await opportunity.addFixEntities(fixEntityObjects);
        log.info(`Added ${fixEntityObjects.length} fix entities for opportunity ${opportunity.getId?.()}`);
      } catch (e) {
        log.warn(`Failed to add fix entities on opportunity ${opportunity.getId?.()}: ${e.message}`);
      }
    }
  } catch (e) {
    log.warn(`Failed reconciliation for disappeared suggestions: ${e.message}`);
  }
}

/**
 * Publishes DEPLOYED fix entities to PUBLISHED when verified on production.
 * Skipped for author-only opportunity types where DEPLOYED is final.
 *
 * @param {Object} params - The parameters object.
 * @param {string} params.opportunityId - The opportunity ID.
 * @param {Object} params.context - Context object with dataAccess and log.
 * @param {Function} params.isIssueResolvedOnProduction - Async predicate for verification.
 * @param {Array} [params.currentAuditData] - Current audit data for fast-path optimization.
 * @param {Function} [params.buildKey] - Function to build unique key from data.
 * @returns {Promise<void>}
 */
export async function publishDeployedFixEntities({
  opportunityId,
  context,
  isIssueResolvedOnProduction,
  currentAuditData,
  buildKey,
}) {
  if (!context) {
    return;
  }
  const { dataAccess, log } = context;
  try {
    const { FixEntity, Suggestion } = dataAccess || {};
    if (!FixEntity?.allByOpportunityIdAndStatus || !Suggestion?.getFixEntitiesBySuggestionId) {
      log.debug('FixEntity APIs not available; skipping publish.');
      return;
    }

    const deployedStatus = FixEntityDataAccess.STATUSES.DEPLOYED;
    const publishedStatus = FixEntityDataAccess.STATUSES.PUBLISHED;

    const deployedFixEntities = await FixEntity.allByOpportunityIdAndStatus(
      opportunityId,
      deployedStatus,
    );
    if (!Array.isArray(deployedFixEntities) || deployedFixEntities.length === 0) {
      return;
    }

    // Build set of current audit data keys for fast-path check
    const currentDataKeys = currentAuditData && buildKey
      ? new Set(currentAuditData.map(buildKey))
      : null;

    // Helper to check a single fix entity with bounded HTTP calls
    const checkFixEntity = async (fixEntity) => {
      const suggestionIds = fixEntity.getSuggestionIds?.() || [];
      if (suggestionIds.length === 0) {
        return { fixEntity, allResolved: false };
      }

      // Fetch all suggestions first (DB calls)
      const suggestionResults = await Promise.all(
        suggestionIds.map(async (suggestionId) => {
          const { data: suggestions = [] } = await Suggestion.getFixEntitiesBySuggestionId(
            suggestionId,
          );
          return suggestions[0];
        }),
      );

      // Fast-path check using current audit data (no HTTP)
      for (const suggestion of suggestionResults) {
        if (!suggestion) {
          return { fixEntity, allResolved: false };
        }
        if (currentDataKeys && buildKey) {
          const key = buildKey(suggestion.getData?.());
          if (currentDataKeys.has(key)) {
            return { fixEntity, allResolved: false };
          }
        }
      }

      // HTTP verification with bounded concurrency
      const httpCheckTasks = suggestionResults.map((suggestion) => async () => {
        const resolved = await isIssueResolvedOnProduction?.(suggestion);
        return resolved;
      });

      const httpResults = await limitConcurrencyAllSettled(httpCheckTasks, MAX_CONCURRENT_CHECKS);
      const allResolved = httpResults.every((r) => r === true);
      return { fixEntity, allResolved };
    };

    // Process fix entities with bounded concurrency
    const fixEntityTasks = deployedFixEntities.map((fe) => async () => checkFixEntity(fe));
    const results = await limitConcurrencyAllSettled(fixEntityTasks, MAX_CONCURRENT_CHECKS);

    // Update resolved fix entities
    for (const result of results) {
      if (result?.allResolved) {
        try {
          result.fixEntity.setStatus?.(publishedStatus);
          // eslint-disable-next-line no-await-in-loop
          await result.fixEntity.save?.();
          log.info(`Published fix entity ${result.fixEntity.getId?.()}`);
        } catch (e) {
          log.debug(`Failed to save fix entity: ${e.message}`);
        }
      }
    }
  } catch (e) {
    log.warn(`Failed to publish deployed fix entities: ${e.message}`);
  }
}

/**
 * Wrapper that orchestrates publish detection before delegating to syncSuggestions.
 * This separates the publish detection logic from the core sync functionality.
 *
 * Steps:
 * 1. Reconcile disappeared suggestions (mark externally fixed as FIXED)
 * 2. Publish deployed fix entities (verify on production)
 * 3. Delegate to base syncSuggestions
 *
 * @param {Object} params - All parameters from syncSuggestions plus publish detection params.
 * @param {Function} [params.isIssueFixedWithAISuggestion] - Callback for reconcile step.
 * @param {Function} [params.buildFixEntityPayload] - Function to build fix entity payload.
 * @param {Function} [params.isIssueResolvedOnProduction] - Callback for publish step.
 * @returns {Promise<void>}
 */
export async function syncSuggestionsWithPublishDetection({
  context,
  opportunity,
  newData,
  buildKey,
  mapNewSuggestion,
  mergeDataFunction,
  mergeStatusFunction,
  statusToSetForOutdated,
  scrapedUrlsSet,
  // Publish detection params
  isIssueFixedWithAISuggestion,
  buildFixEntityPayload,
  isIssueResolvedOnProduction,
}) {
  if (!context) {
    return;
  }
  const { log } = context;

  // Determine if this is an author-only opportunity type
  const opportunityType = opportunity.getType?.();
  const isAuthorOnly = AUTHOR_ONLY_OPPORTUNITY_TYPES.includes(opportunityType);

  // Compute disappeared suggestions for reconcile step
  const newDataKeys = new Set(newData.map(buildKey));
  const existingSuggestions = await opportunity.getSuggestions();
  const disappearedSuggestions = getDisappearedSuggestions(
    existingSuggestions,
    newDataKeys,
    buildKey,
  );

  // Step 1: Reconcile disappeared suggestions
  if (typeof isIssueFixedWithAISuggestion === 'function'
      && typeof buildFixEntityPayload === 'function') {
    await reconcileDisappearedSuggestions({
      opportunity,
      disappearedSuggestions,
      log,
      isIssueFixedWithAISuggestion,
      buildFixEntityPayload,
      isAuthorOnly,
    });
  }

  // Step 2: Publish deployed fix entities (skip for author-only)
  if (isAuthorOnly) {
    log.debug('[syncSuggestionsWithPublishDetection] Skipping publish for author-only type');
  } else if (typeof isIssueResolvedOnProduction === 'function') {
    await publishDeployedFixEntities({
      opportunityId: opportunity.getId(),
      context,
      currentAuditData: newData,
      buildKey,
      isIssueResolvedOnProduction,
    });
  }

  // Step 3: Delegate to base syncSuggestions, passing pre-fetched suggestions to avoid double query
  await syncSuggestions({
    context,
    opportunity,
    newData,
    buildKey,
    mapNewSuggestion,
    mergeDataFunction,
    mergeStatusFunction,
    statusToSetForOutdated,
    scrapedUrlsSet,
    existingSuggestions,
  });
}
