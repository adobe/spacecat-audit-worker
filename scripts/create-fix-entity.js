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

/**
 * Utility functions for creating fix entities for verified suggestions.
 * 
 * Usage example:
 * ```javascript
 * import { createDataAccess } from '@adobe/spacecat-shared-data-access';
 * import { createFixEntityForSuggestion } from './create-fix-entity.js';
 * 
 * // In your fix checker script:
 * const dataAccess = createDataAccess(config);
 * 
 * // For a single verified suggestion:
 * if (isFixed) {
 *   await createFixEntityForSuggestion(dataAccess, suggestion, {
 *     status: 'PENDING',
 *     logger: this.log
 *   });
 * }
 * 
 * // For multiple verified suggestions:
 * import { createFixEntitiesForSuggestions } from './create-fix-entity.js';
 * 
 * const fixedSuggestions = results.filter(r => r.isFixed).map(r => r.suggestion);
 * const result = await createFixEntitiesForSuggestions(dataAccess, fixedSuggestions, {
 *   logger: this.log
 * });
 * console.log(`Created: ${result.createdItems.length}, Skipped: ${result.skippedItems.length}`);
 * ```
 */

/**
 * Creates a fix entity and fix entity suggestion for a verified fix.
 * Prevents duplication by checking if a fix entity already exists for the suggestion.
 * 
 * @param {Object} dataAccess - The data access instance from createDataAccess()
 * @param {Suggestion} suggestion - The suggestion object that has been verified as fixed
 * @param {Object} options - Optional configuration
 * @param {string} options.status - Fix entity status (default: 'PENDING')
 * @param {string} options.origin - Fix entity origin (default: 'SPACECAT')
 * @param {Object} options.logger - Optional logger object with info/error/debug methods
 * @returns {Promise<Object>} - Returns the created or existing fix entity
 * @throws {Error} - Throws error if creation fails
 */
export async function createFixEntityForSuggestion(dataAccess, suggestion, options = {}) {
  const {
    status = 'PENDING',
    origin = 'spacecat',
    logger = null
  } = options;

  const log = logger || {
    info: () => {},
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => {}
  };

  try {
    // Validate inputs
    if (!dataAccess) {
      throw new Error('dataAccess is required');
    }

    if (!suggestion) {
      throw new Error('suggestion is required');
    }

    // Get suggestion details
    const suggestionId = suggestion.getId ? suggestion.getId() : suggestion.id;
    const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : suggestion.opportunityId;
    const suggestionType = suggestion.getType ? suggestion.getType() : suggestion.type;
    const suggestionData = suggestion.getData ? suggestion.getData() : suggestion.data;

    if (!suggestionId) {
      throw new Error('suggestion must have an ID');
    }

    if (!opportunityId) {
      throw new Error('suggestion must have an opportunityId');
    }

    if (!suggestionType) {
      throw new Error('suggestion must have a type');
    }

    if (!suggestionData || typeof suggestionData !== 'object') {
      throw new Error('suggestion.getData() must return a non-empty object');
    }

    // Check if fix entity already exists for this suggestion (prevent duplication)
    const { FixEntitySuggestionCollection, FixEntityCollection } = dataAccess;
    const existingFixEntitySuggestions = await FixEntitySuggestionCollection
      .allBySuggestionId(suggestionId);

    if (existingFixEntitySuggestions && existingFixEntitySuggestions.length > 0) {
      log.debug(`Fix entity already exists for suggestion ${suggestionId}, skipping creation`);
      
      // Get the existing fix entity
      const existingFixEntityId = existingFixEntitySuggestions[0].getFixEntityId();
      const existingFixEntity = await FixEntityCollection.findById(existingFixEntityId);
      
      return existingFixEntity;
    }

    // Create fix entity
    const fixEntity = await FixEntityCollection.create({
      opportunityId,
      type: suggestionType,
      changeDetails: suggestionData,
      status,
      origin,
      createdAt: suggestion.getUpdatedAt(),
      updatedAt: suggestion.getUpdatedAt(),
    });

    log.info(`Created fix entity ${fixEntity.getId()} for suggestion ${suggestionId}`);

    // Create fix entity suggestion junction record
    const fixEntityId = fixEntity.getId();
    const fixEntityCreatedAt = fixEntity.getCreatedAt();

    await FixEntitySuggestionCollection.create({
      opportunityId,
      fixEntityId,
      suggestionId,
      fixEntityCreatedAt
    });

    log.info(`Created fix entity suggestion link: ${suggestionId} -> ${fixEntityId}`);

    return fixEntity;

  } catch (error) {
    log.error(`Failed to create fix entity for suggestion: ${error.message}`);
    throw error;
  }
}

/**
 * Batch create fix entities for multiple suggestions.
 * Useful when processing multiple verified fixes at once.
 * 
 * @param {Object} dataAccess - The data access instance from createDataAccess()
 * @param {Array<Suggestion>} suggestions - Array of suggestion objects that have been verified as fixed
 * @param {Object} options - Optional configuration (same as createFixEntityForSuggestion)
 * @returns {Promise<Object>} - Returns object with createdItems and skippedItems arrays
 */
export async function createFixEntitiesForSuggestions(dataAccess, suggestions, options = {}) {
  const {
    logger = null
  } = options;

  const log = logger || {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => {}
  };

  const createdItems = [];
  const skippedItems = [];
  const errorItems = [];

  log.info(`Processing ${suggestions.length} suggestions for fix entity creation`);

  for (const suggestion of suggestions) {
    try {
      const suggestionId = suggestion.getId ? suggestion.getId() : suggestion.id;
      
      // Check if fix entity already exists before attempting creation
      const { FixEntitySuggestionCollection } = dataAccess;
      const existingFixEntitySuggestions = await FixEntitySuggestionCollection
        .allBySuggestionId(suggestionId);

      if (existingFixEntitySuggestions && existingFixEntitySuggestions.length > 0) {
        skippedItems.push({
          suggestionId,
          reason: 'Fix entity already exists'
        });
        continue;
      }

      // Create new fix entity
      const result = await createFixEntityForSuggestion(dataAccess, suggestion, options);
      
      if (result) {
        createdItems.push({
          suggestionId,
          fixEntity: result
        });
      }
    } catch (error) {
      const suggestionId = suggestion.getId ? suggestion.getId() : suggestion.id;
      errorItems.push({
        suggestionId,
        error: error.message
      });
      log.error(`Failed to create fix entity for suggestion ${suggestionId}: ${error.message}`);
    }
  }

  log.info(`Created: ${createdItems.length}, Skipped: ${skippedItems.length}, Errors: ${errorItems.length}`);

  return {
    createdItems,
    skippedItems,
    errorItems
  };
}
