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

import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';

/**
 * Adds new readability suggestions incrementally without removing existing ones
 * This should be called when receiving responses from Mystique
 *
 * @param {Object} params - The parameters for the operation.
 * @param {Object} params.opportunity - The opportunity object to add suggestions to.
 * @param {Array} params.newSuggestionDTOs - Array of new suggestion DTOs to add.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the addition is complete.
 */
export async function addReadabilitySuggestions({ opportunity, newSuggestionDTOs, log }) {
  if (!isNonEmptyArray(newSuggestionDTOs)) {
    log.debug('[READABILITY]: No new suggestions to add');
    return;
  }

  const updateResult = await opportunity.addSuggestions(newSuggestionDTOs);

  if (isNonEmptyArray(updateResult.errorItems)) {
    log.error(`[READABILITY]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
    updateResult.errorItems.forEach((errorItem) => {
      log.error(`[READABILITY]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
    });

    if (!isNonEmptyArray(updateResult.createdItems)) {
      throw new Error(`[READABILITY]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
    }
  }

  log.info(`[READABILITY]: Added ${newSuggestionDTOs.length} new readability suggestions`);
}

/**
 * Clears all existing readability suggestions except those that are ignored/skipped
 * This should be called once at the beginning of the readability audit process
 *
 * @param {Object} params - The parameters for the cleanup operation.
 * @param {Object} params.opportunity - The opportunity object to clear suggestions for.
 * @param {Object} params.log - Logger object for error reporting.
 * @returns {Promise<void>} - Resolves when the cleanup is complete.
 */
export async function clearReadabilitySuggestions({ opportunity, log }) {
  if (!opportunity) {
    log.debug('[READABILITY]: No opportunity found, skipping suggestion cleanup');
    return;
  }

  const existingSuggestions = await opportunity.getSuggestions();

  if (!existingSuggestions || existingSuggestions.length === 0) {
    log.debug('[READABILITY]: No existing suggestions to clear');
    return;
  }

  const IGNORED_STATUSES = [SuggestionModel.STATUSES.SKIPPED, SuggestionModel.STATUSES.FIXED];
  const ignoredSuggestions = existingSuggestions.filter(
    (s) => IGNORED_STATUSES.includes(s.getStatus()),
  );
  const ignoredSuggestionIds = ignoredSuggestions.map((s) => s.getId());

  // Remove existing suggestions that were not ignored
  const suggestionsToRemove = existingSuggestions.filter(
    (suggestion) => !ignoredSuggestionIds.includes(suggestion.getId()),
  );

  if (suggestionsToRemove.length > 0) {
    await Promise.all(suggestionsToRemove.map((suggestion) => suggestion.remove()));
    log.info(`[READABILITY]: Cleared ${suggestionsToRemove.length} existing suggestions (preserved ${ignoredSuggestions.length} ignored suggestions)`);
  } else {
    log.debug(`[READABILITY]: No suggestions to clear (all ${existingSuggestions.length} suggestions are ignored)`);
  }
}
