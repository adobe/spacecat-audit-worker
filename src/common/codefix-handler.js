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
import {
  isNonEmptyArray,
  buildAggregationKey,
  buildKey,
} from '@adobe/spacecat-shared-utils';
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
 * @param {string} reportKey - The S3 key path to the report
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} - The report data or null if not found
 *
 * Expected report.json structure:
 * {
 *   url: "https://example.com/contact-us",
 *   source: "#contact-us",
 *   type: "color-contrast",
 *   updatedFiles: ["blocks/form/form.js"],
 *   htmlWithIssues: ["<span>Optional<span>", "<span>Optional<span>"],
 *   diff: "diff --git ...",
 *   createdAt: "",
 *   updatedAt: ""
 * }
 */
async function readCodeChangeReport(s3Client, bucketName, reportKey, log) {
  try {
    log.info(`Reading code change report from S3: ${reportKey}`);

    const reportData = await getObjectFromKey(s3Client, bucketName, reportKey, log);

    if (!reportData) {
      log.warn(`No code change report found for key: ${reportKey}`);
      return null;
    }

    // If reportData is a plain string, try to parse it as JSON
    if (typeof reportData === 'string') {
      try {
        const parsedData = JSON.parse(reportData);
        return parsedData;
      } catch (error) {
        log.warn(`Failed to parse report data as JSON for key: ${reportKey}, returning null`);
        return null;
      }
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
 * @param {string} matchKey - The key to match (aggregation_key or ruleId from type)
 * @param {Object} reportData - The code change report data
 * @param {boolean} useAggregationKey - If true, build aggregation key from suggestion data;
 *                                      if false, use issue type (ruleId)
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} - Array of updated suggestions
 */
async function updateSuggestionsWithCodeChange(
  suggestions,
  url,
  source,
  matchKey,
  reportData,
  useAggregationKey,
  log,
) {
  const updatedSuggestions = [];

  try {
    const promises = [];
    for (const suggestion of suggestions) {
      const suggestionData = suggestion.getData();

      // Check if this suggestion matches the criteria
      const suggestionUrl = suggestionData.url;
      const suggestionSource = suggestionData.source;

      let suggestionMatchKey;
      let suggestionsMatch = false;

      if (useAggregationKey) {
        const issueType = suggestionData.issues?.[0]?.type || '';
        const targetSelector = suggestionData.issues?.[0]?.htmlWithIssues?.[0]?.target_selector || '';
        suggestionMatchKey = buildAggregationKey(
          issueType,
          suggestionUrl,
          targetSelector,
          suggestionSource,
        );
        suggestionsMatch = suggestionMatchKey === matchKey && !!reportData.diff;
      } else {
        suggestionMatchKey = buildKey(suggestionUrl, suggestionSource);
        const issueType = suggestionData.issues?.[0]?.type;
        suggestionsMatch = suggestionMatchKey === buildKey(url, source)
          && issueType === matchKey
          && !!reportData.diff;
      }

      if (suggestionsMatch) {
        log.info(`Updating suggestion ${suggestion.getId()} with code change data`);

        // Update suggestion data with diff content and availability flag
        const updatedData = {
          ...suggestionData,
          patchContent: reportData.diff,
          isCodeChangeAvailable: false,
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
 * @param {Array} updates - Array of update objects with:
 *                          - url (required)
 *                          - source (optional)
 *                          - aggregation_key (optional, new) OR type array (optional, old)
 *                          - code_fix_path (optional, only with aggregation_key)
 *                          - code_fix_bucket (optional, only with aggregation_key)
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

  // Default bucket name from environment
  const defaultBucketName = env.S3_MYSTIQUE_BUCKET_NAME;

  let totalUpdatedSuggestions = 0;

  // Process each update
  await Promise.all(updates.map(async (update) => {
    const {
      url,
      source,
      aggregation_key: aggregationKey,
      types,
      code_fix_path: codeFixPath,
      code_fix_bucket: codeFixBucket,
    } = update;

    if (!url) {
      log.warn('[CodeFixProcessor] Skipping update without URL');
      return;
    }

    // NEW FORMAT: aggregation_key with optional custom S3 path
    if (aggregationKey) {
      log.info(`[CodeFixProcessor] Processing update (new format) for URL: ${url}, source: ${source || 'N/A'}, aggregation_key: ${aggregationKey}`);

      // Determine bucket and path to use
      let bucketName;
      let reportKey;

      if (codeFixPath && codeFixBucket) {
        // Use provided path and bucket with priority
        bucketName = codeFixBucket;
        reportKey = codeFixPath;
        log.info(`[CodeFixProcessor] Using provided S3 path: s3://${bucketName}/${reportKey}`);
      } else {
        // Fall back to default path construction
        if (!defaultBucketName) {
          log.error('[CodeFixProcessor] S3_MYSTIQUE_BUCKET_NAME environment variable not set and no code_fix_bucket provided');
          throw new CodeFixConfigurationError('S3 bucket name not configured');
        }
        bucketName = defaultBucketName;
        const urlSourceHash = generateUrlSourceHash(url, source || '');
        // Sanitize aggregation key for S3 path (replace slashes with underscores)
        const sanitizedAggregationKey = aggregationKey.replace(/[/\\]/g, '_');
        reportKey = `fixes/${siteId}/${urlSourceHash}/${sanitizedAggregationKey}/report.json`;
        log.info(`[CodeFixProcessor] Using default S3 path: s3://${bucketName}/${reportKey}`);
      }

      const reportData = await readCodeChangeReport(
        s3Client,
        bucketName,
        reportKey,
        log,
      );

      if (!reportData) {
        log.warn(`[CodeFixProcessor] No code change report found for URL: ${url}, aggregation_key: ${aggregationKey}`);
        return;
      }

      // Update matching suggestions with the code change data
      const updatedSuggestions = await updateSuggestionsWithCodeChange(
        suggestions,
        url,
        source,
        aggregationKey,
        reportData,
        true, // useAggregationKey = true for new format
        log,
      );
      totalUpdatedSuggestions += updatedSuggestions.length;
      return;
    }

    // OLD FORMAT: type array (backwards compatible)
    if (!isNonEmptyArray(types)) {
      log.warn(`[CodeFixProcessor] Skipping update for URL ${url} without aggregation_key or types`);
      return;
    }

    if (!defaultBucketName) {
      log.error('[CodeFixProcessor] S3_MYSTIQUE_BUCKET_NAME environment variable not set');
      throw new CodeFixConfigurationError('S3 bucket name not configured');
    }

    log.info(`[CodeFixProcessor] Processing update (old format) for URL: ${url}, source: ${source || 'N/A'}, types: ${types.join(', ')}`);

    // For each type in the update, try to read the code change report
    await Promise.all(types.map(async (ruleId) => {
      const urlSourceHash = generateUrlSourceHash(url, source || '');
      const reportKey = `fixes/${siteId}/${urlSourceHash}/${ruleId}/report.json`;

      const reportData = await readCodeChangeReport(
        s3Client,
        defaultBucketName,
        reportKey,
        log,
      );

      if (!reportData) {
        log.warn(`[CodeFixProcessor] No code change report found for URL: ${url}, source: ${source}, type: ${ruleId}`);
        return;
      }

      // Update matching suggestions with the code change data
      const updatedSuggestions = await updateSuggestionsWithCodeChange(
        suggestions,
        url,
        source,
        ruleId,
        reportData,
        false, // useAggregationKey = false for old format (use ruleId)
        log,
      );
      totalUpdatedSuggestions += updatedSuggestions.length;
    }));
  }));

  log.info(`[CodeFixProcessor] Successfully processed all updates. Total suggestions updated: ${totalUpdatedSuggestions}`);
  return totalUpdatedSuggestions;
}
