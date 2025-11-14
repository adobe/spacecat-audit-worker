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
 * Utility functions for creating fix entities for verified suggestions via the Spacecat API.
 * 
 * Usage example:
 * ```javascript
 * import { createFixEntityForSuggestions } from './create-fix-entity.js';
 * 
 * // In your fix checker script:
 * const apiBaseUrl = 'https://spacecat.experiencecloud.live/api/v1';
 * const apiKey = process.env.SPACECAT_API_KEY; // Optional if using authentication
 * 
 * // For multiple verified suggestions (recommended approach):
 * const fixedSuggestions = results.filter(r => r.isFixed).map(r => r.suggestion);
 * const suggestionIds = fixedSuggestions.map(s => s.getId());
 * 
 * const result = await createFixEntityForSuggestions(
 *   siteId,
 *   opportunityId,
 *   suggestionIds,
 *   {
 *     apiBaseUrl,
 *     apiKey,
 *     logger: this.log
 *   }
 * );
 * console.log(`Success: ${result.success}, Suggestion IDs: ${result.suggestionIds.length}`);
 * ```
 */

/**
 * Creates fix entities via the Spacecat API for verified suggestions.
 * 
 * @param {string} siteId - The site ID
 * @param {string} opportunityId - The opportunity ID
 * @param {Array<string>} suggestionIds - Array of suggestion IDs that have been verified as fixed
 * @param {Object} options - Optional configuration
 * @param {string} options.apiBaseUrl - API base URL (default: 'https://spacecat.experiencecloud.live/api/v1')
 * @param {string} options.apiKey - Optional API key for authentication
 * @param {string} options.status - Fix entity status (default: 'PUBLISHED')
 * @param {string} options.origin - Fix entity origin (default: 'reporting')
 * @param {Object} options.logger - Optional logger object with info/error/debug methods
 * @returns {Promise<Object>} - Returns object with success status and response data
 * @throws {Error} - Throws error if API call fails
 */
export async function createFixEntityForSuggestions(siteId, opportunityId, suggestionIds, options = {}) {
  const {
    apiBaseUrl = 'https://spacecat.experiencecloud.live/api/v1',
    apiKey = null,
    authToken = null,
    status = 'PUBLISHED',
    origin = 'reporting',
    logger = null
  } = options;

  const log = logger || {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => {}
  };

  try {
    // Validate inputs
    if (!siteId) {
      throw new Error('siteId is required');
    }

    if (!opportunityId) {
      throw new Error('opportunityId is required');
    }

    if (!suggestionIds || !Array.isArray(suggestionIds) || suggestionIds.length === 0) {
      throw new Error('suggestionIds must be a non-empty array');
    }

    log.info(`Creating fix entity for ${suggestionIds.length} suggestion(s) via API...`);

    // Prepare the API request
    const url = `${apiBaseUrl}/sites/${siteId}/opportunities/${opportunityId}/fixes`;
    const fixData = {
      suggestionIds,
      status,
      origin
    };

    const headers = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    if(authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    log.debug(`POST ${url}`);
    log.debug(`Payload: ${JSON.stringify(fixData, null, 2)}`);

    // Make the API request
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ fixData })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    log.info(`Successfully created fix entity via API: ${JSON.stringify(result)}`);

    return {
      success: true,
      data: result,
      suggestionIds
    };

  } catch (error) {
    log.error(`Failed to create fix entity via API: ${error.message}`);
    throw error;
  }
}

/**
 * Batch create fix entities by grouping suggestions by opportunity.
 * This is useful when you have suggestions from multiple opportunities and want to
 * create fix entities for all of them in an organized manner.
 * 
 * @param {string} siteId - The site ID
 * @param {Array<Suggestion>} suggestions - Array of suggestion objects that have been verified as fixed
 * @param {Object} options - Optional configuration (same as createFixEntityForSuggestions)
 * @returns {Promise<Object>} - Returns object with results for each opportunity
 */
export async function createFixEntitiesByOpportunity(siteId, suggestions, options = {}) {
  const {
    logger = null
  } = options;

  const log = logger || {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => {}
  };

  // Group suggestions by opportunity ID
  const suggestionsByOpportunity = {};
  
  for (const suggestion of suggestions) {
    const opportunityId = suggestion.getOpportunityId ? suggestion.getOpportunityId() : suggestion.opportunityId;
    if (!opportunityId) {
      log.error('Suggestion missing opportunityId, skipping');
      continue;
    }
    
    if (!suggestionsByOpportunity[opportunityId]) {
      suggestionsByOpportunity[opportunityId] = [];
    }
    suggestionsByOpportunity[opportunityId].push(suggestion);
  }

  const results = {
    successful: [],
    failed: []
  };

  log.info(`Processing ${Object.keys(suggestionsByOpportunity).length} opportunity group(s)`);

  // Process each opportunity group
  for (const [opportunityId, oppSuggestions] of Object.entries(suggestionsByOpportunity)) {
    try {
      log.info(`Creating fix entity for opportunity ${opportunityId} with ${oppSuggestions.length} suggestion(s)`);
      
      // Extract suggestion IDs from the suggestion objects
      const suggestionIds = oppSuggestions.map(suggestion => {
        return suggestion.getId ? suggestion.getId() : suggestion.id;
      });
      
      const result = await createFixEntityForSuggestions(siteId, opportunityId, suggestionIds, options);
      
      results.successful.push({
        opportunityId,
        suggestionCount: oppSuggestions.length,
        result
      });
    } catch (error) {
      log.error(`Failed to create fix entity for opportunity ${opportunityId}: ${error.message}`);
      results.failed.push({
        opportunityId,
        suggestionCount: oppSuggestions.length,
        error: error.message
      });
    }
  }

  log.info(`Completed: ${results.successful.length} successful, ${results.failed.length} failed`);

  return results;
}
