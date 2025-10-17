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

/* eslint-disable max-classes-per-file */

import { createHash } from 'crypto';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { getObjectFromKey } from '../utils/s3-utils.js';

/**
 * Custom error classes for code fix processing
 */
export class CodeFixValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodeFixValidationError';
  }
}

export class CodeFixNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodeFixNotFoundError';
  }
}

export class CodeFixConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CodeFixConfigurationError';
  }
}

/**
 * Generates a hash for the given URL and source combination.
 * @param {string} url - The URL to hash
 * @param {string} source - The source to hash
 * @returns {string} - The generated hash (first 16 characters of MD5)
 */
function generateUrlSourceHash(url, source) {
  const combined = `${url}_${source}`;
  return createHash('md5').update(combined).digest('hex').substring(0, 16);
}

/**
 * Reads code change report from S3 bucket
 * @param {Object} s3Client - The S3 client instance
 * @param {string} bucketName - The S3 bucket name
 * @param {string} siteId - The site ID
 * @param {string} url - The page URL
 * @param {string} source - The source (optional)
 * @param {string} type - The issue type (e.g., 'color-contrast')
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} - The report data or null if not found
 */
async function readCodeChangeReport(s3Client, bucketName, siteId, url, source, type, log) {
  try {
    const urlSourceHash = generateUrlSourceHash(url, source || '');
    const reportKey = `fixes/${siteId}/${urlSourceHash}/${type}/report.json`;

    log.info(`Reading code change report from S3: ${reportKey}`);

    const reportData = await getObjectFromKey(s3Client, bucketName, reportKey, log);

    if (!reportData) {
      log.warn(`No code change report found for key: ${reportKey}`);
      return null;
    }

    log.info(`Successfully read code change report from S3: ${reportKey}`);
    return reportData;
  } catch (error) {
    log.error(`Error reading code change report from S3: ${error.message}`, error);
    return null;
  }
}

/**
 * Updates suggestions with code change data
 * @param {Array} suggestions - Array of suggestion objects
 * @param {string} url - The page URL to match
 * @param {string} source - The source to match (optional)
 * @param {string} ruleId - The WCAG rule ID to match
 * @param {Object} reportData - The code change report data
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} - Array of updated suggestions
 */
async function updateSuggestionsWithCodeChange(suggestions, url, source, ruleId, reportData, log) {
  const updatedSuggestions = [];

  try {
    const promises = [];
    for (const suggestion of suggestions) {
      const suggestionData = suggestion.getData();

      // Check if this suggestion matches the criteria
      const suggestionUrl = suggestionData.url;
      const suggestionSource = suggestionData.source;
      const suggestionRuleId = suggestionData.issues[0]?.type;

      if (suggestionUrl === url
            && (!source || suggestionSource === source)
            && suggestionRuleId === ruleId
            && !!reportData.diff) {
        log.info(`Updating suggestion ${suggestion.getId()} with code change data`);

        // Update suggestion data with diff content and availability flag
        const updatedData = {
          ...suggestionData,
          patchContent: reportData.diff,
          isCodeChangeAvailable: true,
        };

        suggestion.setData(updatedData);
        promises.push(suggestion.save());
        updatedSuggestions.push(suggestion);
      }
    }

    await Promise.all(promises);
    log.info(`Updated ${updatedSuggestions.length} suggestions with code change data`);
    return updatedSuggestions;
  } catch (error) {
    log.error(`Error updating suggestions with code change: ${error.message}`, error);
    throw error;
  }
}

/**
 * Processes code fix updates for an opportunity's suggestions
 *
 * @param {string} siteId - The site ID
 * @param {string} opportunityId - The opportunity ID
 * @param {Array} updates - Array of update objects with url, source, and type fields
 * @param {Object} context - Context object containing dataAccess, log, s3Client, env
 * @returns {Promise<number>} - Number of suggestions updated
 * @throws {CodeFixValidationError} - If validation fails (bad request scenarios)
 * @throws {CodeFixNotFoundError} - If opportunity not found
 * @throws {CodeFixConfigurationError} - If configuration is missing
 * @throws {Error} - For other processing errors
 */
export async function processCodeFixUpdates(siteId, opportunityId, updates, context) {
  const {
    log, dataAccess, s3Client, env,
  } = context;
  const { Opportunity } = dataAccess;

  // Validation
  if (!opportunityId) {
    log.error('[CodeFixProcessor] No opportunityId provided');
    throw new CodeFixValidationError('No opportunityId provided');
  }

  if (!isNonEmptyArray(updates)) {
    log.error('[CodeFixProcessor] No updates provided or updates is empty');
    throw new CodeFixValidationError('No updates provided or updates is empty');
  }

  log.info(`[CodeFixProcessor] Processing code fix updates for siteId: ${siteId}, opportunityId: ${opportunityId}`);

  // Find the opportunity
  const opportunity = await Opportunity.findById(opportunityId);

  if (!opportunity) {
    log.error(`[CodeFixProcessor] Opportunity not found for ID: ${opportunityId}`);
    throw new CodeFixNotFoundError(`Opportunity not found for ID: ${opportunityId}`);
  }

  // Verify the opportunity belongs to the correct site
  if (opportunity.getSiteId() !== siteId) {
    const errorMsg = `[CodeFixProcessor] Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
    log.error(errorMsg);
    throw new CodeFixValidationError(errorMsg);
  }

  // Get all suggestions for the opportunity
  const suggestions = await opportunity.getSuggestions();

  if (!isNonEmptyArray(suggestions)) {
    log.warn(`[CodeFixProcessor] No suggestions found for opportunity: ${opportunityId}`);
    return 0;
  }

  const bucketName = env.S3_MYSTIQUE_BUCKET_NAME;

  if (!bucketName) {
    log.error('[CodeFixProcessor] S3_MYSTIQUE_BUCKET_NAME environment variable not set');
    throw new CodeFixConfigurationError('S3 bucket name not configured');
  }

  let totalUpdatedSuggestions = 0;

  // Process each update
  await Promise.all(updates.map(async (update) => {
    const { url, source, type: types } = update;

    if (!url) {
      log.warn('[CodeFixProcessor] Skipping update without URL');
      return;
    }

    if (!isNonEmptyArray(types)) {
      log.warn(`[CodeFixProcessor] Skipping update for URL ${url} without types`);
      return;
    }

    log.info(`[CodeFixProcessor] Processing update for URL: ${url}, source: ${source || 'N/A'}, types: ${types.join(', ')}`);

    // For each type in the update, try to read the code change report
    await Promise.all(types.map(async (ruleId) => {
      const reportData = await readCodeChangeReport(
        s3Client,
        bucketName,
        siteId,
        url,
        source,
        ruleId,
        log,
      );

      if (!reportData) {
        log.warn(`[CodeFixProcessor] No code change report found for URL: ${url}, source: ${source}, type: ${ruleId}`);
        return;
      }

      // reportData is already parsed by getObjectFromKey, no need to JSON.parse again

      // Update matching suggestions with the code change data
      const updatedSuggestions = await updateSuggestionsWithCodeChange(
        suggestions,
        url,
        source,
        ruleId,
        reportData,
        log,
      );
      totalUpdatedSuggestions += updatedSuggestions.length;
    }));
  }));

  log.info(`[CodeFixProcessor] Successfully processed all updates. Total suggestions updated: ${totalUpdatedSuggestions}`);
  return totalUpdatedSuggestions;
}
