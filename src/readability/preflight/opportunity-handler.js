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
