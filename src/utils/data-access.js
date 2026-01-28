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
 * Computes suggestions that have "disappeared" from the current audit data.
 * These are existing suggestions whose key is no longer present in the new data.
 *
 * @param {Suggestion[]} existingSuggestions - The existing suggestions.
 * @param {Set} newDataKeys - The set of new data keys.
 * @param {Function} buildKey - Function to build a unique key from suggestion data.
 * @returns {Suggestion[]} - Array of disappeared suggestions.
 */
export const getDisappearedSuggestions = (
  existingSuggestions,
  newDataKeys,
  buildKey,
) => existingSuggestions.filter((existing) => {
  const data = existing.getData?.() || {};
  const key = buildKey(data);
  return !newDataKeys.has(key);
});

/**
 * Handles outdated suggestions by updating their status to OUTDATED by default,
 * or the status given as input.
 *
 * @param {Object} params - The parameters for the handleOutdatedSuggestions operation.
 * @param {Suggestion[]} params.disappearedSuggestions - Suggestions no longer in audit data.
 * @param {Object} params.context - The context object containing the data access object.
 * @param {Set} [params.scrapedUrlsSet] - Optional set of URLs that were scraped in this audit
 * @returns {Promise<void>} - Resolves when the outdated suggestions are updated.
 */
export const handleOutdatedSuggestions = async ({
  context,
  disappearedSuggestions,
  statusToSetForOutdated = SuggestionDataAccess.STATUSES.OUTDATED,
  scrapedUrlsSet = null,
}) => {
  const { Suggestion } = context.dataAccess;
  const { log } = context;

  // From disappeared suggestions, filter to those that should be marked outdated:
  // - Exclude already terminal statuses (OUTDATED, FIXED, ERROR, SKIPPED, REJECTED)
  // - Optionally filter by scraped URLs
  const existingOutdatedSuggestions = disappearedSuggestions
    .filter((existing) => ![
      SuggestionDataAccess.STATUSES.OUTDATED,
      SuggestionDataAccess.STATUSES.FIXED,
      SuggestionDataAccess.STATUSES.ERROR,
      SuggestionDataAccess.STATUSES.SKIPPED,
      SuggestionDataAccess.STATUSES.REJECTED,
    ].includes(existing.getStatus()))
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
 * Synchronizes existing suggestions with new data.
 * Handles outdated suggestions by updating their status, either to OUTDATED or the provided one.
 * Updates existing suggestions with new data if they match based on the provided key.
 * For REJECTED suggestions that appear again, preserves REJECTED status
 *
 * Prepares new suggestions from the new data and adds them to the opportunity.
 * Maps new data to suggestion objects using the provided mapping function.
 *
 * Optionally handles reconciliation and fix entity publishing:
 * - If `isIssueFixed` is provided, calls `reconcileDisappearedSuggestions` before syncing.
 * - If `isIssueResolvedOnProduction` is provided, calls `publishDeployedFixEntities` after.
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
 * @param {Set} [params.scrapedUrlsSet] - Optional set of scraped URLs for filtering.
 * @param {Function} [params.isIssueFixed] - Async callback for reconcileDisappearedSuggestions.
 *   If provided, reconciliation is performed before syncing.
 * @param {Function} [params.getPagePath] - Function to get page path for fix entity.
 * @param {Function} [params.getUpdatedValue] - Function to get updated value for fix entity.
 * @param {Function} [params.getOldValue] - Function to get old value for fix entity.
 * @param {Function} [params.isIssueResolvedOnProduction] - Async callback for publishing.
 *   If provided, fix entity publishing is performed after reconciliation.
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
  scrapedUrlsSet = null,
  // Optional: reconcileDisappearedSuggestions params
  isIssueFixed,
  getPagePath,
  getUpdatedValue,
  getOldValue,
  // Optional: publishDeployedFixEntities params
  isIssueResolvedOnProduction,
}) {
  if (!context) {
    return;
  }
  const { log, site, dataAccess } = context;

  // Fetch existing suggestions and compute disappeared suggestions once
  const newDataKeys = new Set(newData.map(buildKey));
  const existingSuggestions = await opportunity.getSuggestions();
  const disappearedSuggestions = getDisappearedSuggestions(
    existingSuggestions,
    newDataKeys,
    buildKey,
  );

  log.info(`[syncSuggestions] Existing suggestions = ${existingSuggestions.length}, Disappeared = ${disappearedSuggestions.length}`);

  // Step 1: Reconcile disappeared suggestions (if isIssueFixed is provided)
  if (typeof isIssueFixed === 'function') {
    // eslint-disable-next-line no-use-before-define
    await reconcileDisappearedSuggestions({
      opportunity,
      disappearedSuggestions,
      getPagePath,
      site,
      log,
      isIssueFixed,
      getUpdatedValue,
      getOldValue,
    });
  } else {
    log.info('[syncSuggestions] No isIssueFixed provided');
  }

  // Step 2: Publish deployed fix entities (if isIssueResolvedOnProduction is provided)
  if (typeof isIssueResolvedOnProduction === 'function') {
    try {
      // eslint-disable-next-line no-use-before-define
      await publishDeployedFixEntities({
        opportunityId: opportunity.getId(),
        dataAccess,
        log,
        currentAuditData: newData,
        buildKey,
        isIssueResolvedOnProduction,
      });
    /* c8 ignore next 3 - defensive: publishDeployedFixEntities has internal try-catch */
    } catch (err) {
      log.warn(`Failed to publish fix entities: ${err.message}`);
    }
  } else {
    log.info('[syncSuggestions] No isIssueResolvedOnProduction provided');
  }

  // Step 3: Handle outdated suggestions (mark as OUTDATED)
  await handleOutdatedSuggestions({
    disappearedSuggestions,
    context,
    statusToSetForOutdated,
    scrapedUrlsSet,
  });

  // Update existing suggestions (skip FIXED and IN_PROGRESS as they're being actively worked on)
  const skipStatuses = [
    SuggestionDataAccess.STATUSES.FIXED,
    SuggestionDataAccess.STATUSES.IN_PROGRESS,
  ];
  await Promise.all(
    existingSuggestions
      .filter((existing) => {
        const existingKey = buildKey(existing.getData());
        const status = existing.getStatus();
        return newDataKeys.has(existingKey) && !skipStatuses.includes(status);
      })
      .map((existing) => {
        const newDataItem = newData.find((data) => buildKey(data) === buildKey(existing.getData()));
        existing.setData(mergeDataFunction(existing.getData(), newDataItem));

        if (existing.getStatus() === SuggestionDataAccess.STATUSES.REJECTED) {
          // Keep REJECTED status when same suggestion appears again in audit
          log.debug('REJECTED suggestion found in audit. Preserving REJECTED status.');
        } else if (SuggestionDataAccess.STATUSES.OUTDATED === existing.getStatus()) {
          log.warn('Resolved suggestion found in audit. Possible regression.');
          const requiresValidationForOutdated = Boolean(site?.requiresValidation);
          existing.setStatus(requiresValidationForOutdated
            ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
            : SuggestionDataAccess.STATUSES.NEW);
        }
        existing.setUpdatedBy('system');
        return existing.save();
      }),
  );
  log.debug(`Updated existing suggestions = ${existingSuggestions.length}: ${safeStringify(existingSuggestions)}`);

  // Prepare new suggestions
  // For FIXED suggestions with ALL fix entities in PUBLISHED state, allow creating
  // a new suggestion (regression scenario). Otherwise, block duplicate creation.
  const fixedStatus = SuggestionDataAccess.STATUSES.FIXED;
  const publishedStatus = FixEntityDataAccess?.STATUSES?.PUBLISHED;
  /* c8 ignore next */
  const { Suggestion } = context.dataAccess || {};

  // Build a set of keys for FIXED suggestions where ALL fix entities are PUBLISHED
  // These should be excluded from the "existing" check to allow regression detection
  const fullyPublishedFixedKeys = new Set();
  const fixedSuggestions = existingSuggestions.filter((s) => s.getStatus() === fixedStatus);

  if (fixedSuggestions.length > 0 && publishedStatus && Suggestion?.getFixEntitiesBySuggestionId) {
    await Promise.all(fixedSuggestions.map(async (suggestion) => {
      try {
        const suggestionId = suggestion.getId?.();
        if (!suggestionId) return;

        const { data: fixEntities = [] } = await Suggestion.getFixEntitiesBySuggestionId(
          suggestionId,
        );

        // Only consider it a completed fix if there are fix entities AND all are PUBLISHED
        if (fixEntities.length > 0
          && fixEntities.every((fe) => fe.getStatus?.() === publishedStatus)) {
          fullyPublishedFixedKeys.add(buildKey(suggestion.getData()));
        }
      } catch (e) {
        log.debug(`Failed to check fix entities for suggestion: ${e.message}`);
      }
    }));
  }

  const requiresValidation = Boolean(site?.requiresValidation);
  const newSuggestions = newData
    .filter((data) => {
      const key = buildKey(data);
      const existingMatches = existingSuggestions.filter(
        (existing) => buildKey(existing.getData()) === key,
      );

      // No existing suggestion with this key - allow creation
      if (existingMatches.length === 0) return true;

      // Only allow creation if ALL existing matches are FIXED with PUBLISHED fix entities
      // This prevents creating duplicate NEW suggestions when a regression already exists
      const allMatchesAreFullyPublishedFixed = existingMatches.every(
        (match) => match.getStatus() === fixedStatus && fullyPublishedFixedKeys.has(key),
      );

      return allMatchesAreFullyPublishedFixed;
    })
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
 * Reconciles suggestions that disappeared from current audit results.
 * If a previous suggestion is verified as fixed (via the provided callback),
 * marks it as FIXED and creates a PUBLISHED fix entity.
 *
 * @param {Object} params - The parameters for the reconciliation.
 * @param {Object} params.opportunity - The opportunity object.
 * @param {Suggestion[]} params.disappearedSuggestions - Suggestions no longer in audit data.
 * @param {Function} params.getPagePath - Function to get the page path from suggestion data.
 * @param {Object} params.site - The site object.
 * @param {Object} params.log - Logger object.
 * @param {Function} params.isIssueFixed - Async callback to determine if a suggestion's issue
 *   has been fixed. Receives the suggestion object and returns true if fixed, false otherwise.
 * @param {Function} [params.getUpdatedValue] - Optional function to extract the updated value
 *   for fix entity changeDetails. Receives suggestion data, defaults to urlEdited or first
 *   urlsSuggested.
 * @param {Function} [params.getOldValue] - Optional function to extract the old value
 *   for fix entity changeDetails. Receives suggestion data.
 * @returns {Promise<void>}
 */
export async function reconcileDisappearedSuggestions({
  opportunity,
  disappearedSuggestions,
  getPagePath,
  site,
  log,
  isIssueFixed,
  getUpdatedValue,
  getOldValue,
}) {
  try {
    const newStatus = SuggestionDataAccess?.STATUSES?.NEW;

    // From disappeared suggestions, only process those in NEW status
    // (suggestions that haven't been actioned yet)
    const candidates = disappearedSuggestions.filter((s) => {
      if (!newStatus || s?.getStatus?.() !== newStatus) {
        return false;
      }
      return true;
    });

    const fixEntityObjects = [];

    for (const suggestion of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const data = suggestion?.getData?.();

      // Use the provided callback to determine if the issue has been fixed
      // eslint-disable-next-line no-await-in-loop
      const isFixed = await isIssueFixed?.(suggestion);
      if (suggestion?.getData?.()?.url_to === 'https://www.wilson.com/en-us/golf/bags/cart-bags') {
        log.info(`[reconcileDisappearedSuggestions] isFixed: ${isFixed}`);
      }
      if (!isFixed) {
        // eslint-disable-next-line no-continue
        continue;
      }

      log.info(`[reconcileDisappearedSuggestions] Reconciling suggestion ${suggestion?.getId?.()} as FIXED in ${opportunity.getId?.()}`);
      // Mark suggestion as FIXED and prepare a PUBLISHED fix entity on the opportunity
      let suggestionMarkedFixed = false;
      try {
        suggestion.setStatus?.(SuggestionDataAccess.STATUSES.FIXED);
        suggestion.setUpdatedBy?.('system');
        // eslint-disable-next-line no-await-in-loop
        await suggestion.save?.();
        suggestionMarkedFixed = true;
      /* c8 ignore next 3 */
      } catch (e) {
        log.warn(`Failed to mark suggestion ${suggestion?.getId?.()} as FIXED: ${e.message}`);
      }

      // Only create fix entity if we successfully marked and saved the suggestion as FIXED
      if (suggestionMarkedFixed) {
        try {
          const published = FixEntityDataAccess?.STATUSES?.PUBLISHED;
          if (published && typeof opportunity.addFixEntities === 'function') {
            // Use custom getUpdatedValue/getOldValue if provided, otherwise default logic
            /* c8 ignore next 3 */
            const updatedValue = typeof getUpdatedValue === 'function'
              ? getUpdatedValue(data)
              : (data?.urlEdited || data?.urlsSuggested?.[0] || '');
            /* c8 ignore next 3 */
            const oldValue = typeof getOldValue === 'function'
              ? getOldValue(data)
              : '';
            fixEntityObjects.push({
              opportunityId: opportunity.getId(),
              status: published,
              type: suggestion?.getType?.(),
              executedAt: new Date().toISOString(),
              changeDetails: {
                system: site.getDeliveryType(),
                pagePath: getPagePath(data),
                oldValue,
                updatedValue,
              },
              suggestions: [suggestion?.getId?.()],
            });
          }
        /* c8 ignore next 3 */
        } catch (e) {
          log.warn(`Failed building fix entity payload for suggestion ${suggestion?.getId?.()}: ${e.message}`);
        }
      }
    }

    if (fixEntityObjects.length > 0 && typeof opportunity.addFixEntities === 'function') {
      try {
        await opportunity.addFixEntities(fixEntityObjects);
        log.info(`Added ${fixEntityObjects.length} fix entities for opportunity ${opportunity.getId?.()}`);
      /* c8 ignore next 3 */
      } catch (e) {
        log.warn(`Failed to add fix entities on opportunity ${opportunity.getId?.()}: ${e.message}`);
      }
    }
  } catch (e) {
    log.warn(`Failed reconciliation for disappeared suggestions: ${e.message}`);
  }
}

/**
 * Publishes DEPLOYED fix entities to PUBLISHED when their associated suggestions
 * are verified as resolved/fixed on production. This utility enables audits to automatically
 * transition fix entities from DEPLOYED to PUBLISHED status based on live verification.
 *
 * The function follows a FixEntity-first flow:
 * 1) Fetches all FixEntities for the opportunity with DEPLOYED status
 * 2) For each FixEntity, retrieves its associated suggestions
 * 3) Fast-path: If a suggestion's key exists in currentAuditData, issue is still present (skip)
 * 4) Verifies remaining suggestions using the provided predicate function
 * 5) If ALL suggestions pass verification (predicate returns true), publishes the FixEntity
 *
 * This is useful for audits that track fixes which can be verified programmatically,
 * such as broken links (check if URL returns 200), redirects (check if redirect works),
 * or any other issue that can be confirmed as resolved via an async check.
 *
 * @param {Object} params - The parameters object
 * @param {string} params.opportunityId - The opportunity ID to process fix entities for
 * @param {Object} params.dataAccess - Data access object containing FixEntity
 * @param {Object} params.log - Logger object for debug/warn messages
 * @param {function(Object): Promise<boolean>} params.isIssueResolvedOnProduction - Async predicate
 *   that receives a suggestion object and returns:
 *   - `true` if the issue is resolved on production (OK to publish)
 *   - `false` if the issue still exists (do NOT publish)
 *   - throwing an error is treated as "not resolved" for safety
 * @param {Array} [params.currentAuditData] - Current audit data array. If a suggestion's key
 *   exists in this data, the issue is still present and production check is skipped.
 * @param {function(Object): string} [params.buildKey] - Function to build a unique key from
 *   suggestion data. Used with currentAuditData to check if issue still exists.
 * @returns {Promise<void>}
 *
 * @example
 * await publishDeployedFixEntities({
 *   opportunityId: opportunity.getId(),
 *   dataAccess,
 *   log,
 *   currentAuditData: auditResult.brokenBacklinks,
 *   buildKey: (data) => `${data.url_from}|${data.url_to}`,
 *   isIssueResolvedOnProduction: async (suggestion) => {
 *     const url = suggestion?.getData?.()?.targetUrl;
 *     if (!url) return false; // No URL = can't verify = not resolved
 *     const response = await fetch(url);
 *     return response.ok; // true if resolved (200), false if still broken
 *   },
 * });
 */
export async function publishDeployedFixEntities({
  opportunityId,
  dataAccess,
  log,
  isIssueResolvedOnProduction,
  currentAuditData,
  buildKey,
}) {
  // log.info(`Publishing deployed fix entities for opportunity ${opportunityId}`);
  try {
    const { FixEntity } = dataAccess;
    if (!FixEntityDataAccess?.STATUSES?.DEPLOYED || !FixEntityDataAccess?.STATUSES?.PUBLISHED) {
      log.debug('FixEntity status constants not available; skipping publish.');
      return;
    }
    if (typeof FixEntity?.allByOpportunityIdAndStatus !== 'function'
      || typeof FixEntity?.getSuggestionsByFixEntityId !== 'function') {
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

    log.info(`[publishDeployedFixEntities] Found ${deployedFixEntities.length} deployed fix entities for opportunity ${opportunityId}`);
    // Build a set of keys from current audit data for quick lookup
    // If a suggestion's key exists in current audit data, the issue is still present
    const currentAuditKeys = new Set(
      Array.isArray(currentAuditData) && typeof buildKey === 'function'
        ? currentAuditData.map(buildKey)
        : [],
    );

    const publishTasks = [];
    for (const fixEntity of deployedFixEntities) {
      const fixEntityId = fixEntity.getId?.();
      // eslint-disable-next-line no-await-in-loop
      const suggestions = await FixEntity.getSuggestionsByFixEntityId(fixEntityId);
      if (!suggestions || suggestions.length === 0) {
        // eslint-disable-next-line no-continue
        continue;
      }

      // Determine if all suggestions are resolved on production.
      // If we cannot verify for any suggestion (errors or unavailable predicate),
      // we consider it NOT resolved to avoid accidental publish.
      let shouldPublish = true;
      for (const suggestion of suggestions) {
        // Fast path: if suggestion key exists in current audit data, issue is still present
        if (typeof buildKey === 'function') {
          /* c8 ignore next */
          const suggestionKey = buildKey(suggestion.getData?.() || {});
          if (currentAuditKeys.has(suggestionKey)) {
            log.debug(`Suggestion ${suggestion.getId?.()} still in audit data, skipping prod check`);
            shouldPublish = false;
            break;
          }
        }

        try {
          // eslint-disable-next-line no-await-in-loop
          const isResolved = await isIssueResolvedOnProduction?.(suggestion);
          if (isResolved !== true) {
            shouldPublish = false;
            break;
          }
        } catch (e) {
          log?.error?.(`[publishDeployedFixEntities] Live check failed for suggestion under fixEntity ${fixEntity.getId?.()}: ${e.message}`);
          shouldPublish = false;
          break;
        }
      }

      if (shouldPublish && typeof fixEntity.getStatus === 'function'
        && fixEntity.getStatus() === deployedStatus) {
        publishTasks.push((async () => {
          fixEntity.setStatus?.(publishedStatus);
          fixEntity.setUpdatedBy?.('system');
          await fixEntity.save?.();
          log.info(`[publishDeployedFixEntities] Published fix entity ${fixEntity.getId?.()} from DEPLOYED to PUBLISHED`);
        })());
      }
    }

    await Promise.all(publishTasks);
  } catch (err) {
    log?.warn?.(`Failed to publish DEPLOYED fix entities for opportunity ${opportunityId}: ${err.message}`);
  }
}
