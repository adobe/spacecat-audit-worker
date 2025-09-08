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

import { createHash } from 'crypto';
import {
  ok, badRequest, notFound, internalServerError,
} from '@adobe/spacecat-shared-http-utils';
import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';
import { getObjectFromKey } from '../../utils/s3-utils.js';

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
          diffContent: reportData.diff,
          isCodeChangeAvailable: true,
        };

        suggestion.setData(updatedData);
        suggestion.setUpdatedBy('system');

        promises.push(suggestion.save());
        updatedSuggestions.push(suggestion);

        log.info(`Successfully updated suggestion ${suggestion.getId()}`);
      }
    }
    await Promise.all(promises);
  } catch (error) {
    log.error(`Error updating suggestions with code change data: ${error.message}`, error);
    throw error;
  }

  return updatedSuggestions;
}

/**
 * AccessibilityCodeChangeHandler - Updates suggestions with code changes from S3
 *
 * Expected message format:
 * {
 *   "siteId": "<site-id>",
 *   "type": "<handler-type>",
 *   "data": {
 *     "opportunityId": "<uuid>",
 *     "updates": [
 *       {
 *         "url": "<page url>",
 *         "source": "<source>", // optional
 *         "type": ["color-contrast", "select-name"]
 *       }
 *     ]
 *   }
 * }
 *
 * @param {Object} message - The SQS message
 * @param {Object} context - The context object containing dataAccess, log, s3Client, etc.
 * @returns {Promise<Response>} - HTTP response
 */
export default async function AccessibilityCodeChangeHandler(message, context) {
  const {
    log, dataAccess, s3Client, env,
  } = context;
  const { Opportunity } = dataAccess;
  const { siteId, data } = message;

  if (!data) {
    log.error('AccessibilityCodeChangeHandler: No data provided in message');
    return badRequest('No data provided in message');
  }

  const { opportunityId, updates } = data;

  if (!opportunityId) {
    log.error('AccessibilityCodeChangeHandler: No opportunityId provided');
    return badRequest('No opportunityId provided');
  }

  if (!isNonEmptyArray(updates)) {
    log.error('AccessibilityCodeChangeHandler: No updates provided or updates is empty');
    return badRequest('No updates provided or updates is empty');
  }

  const siteIdMsg = `AccessibilityCodeChangeHandler: Processing message for siteId: ${siteId}, opportunityId: ${opportunityId}`;
  log.info(siteIdMsg);
  log.info(`AccessibilityCodeChangeHandler: Updates to process: ${JSON.stringify(updates, null, 2)}`);

  try {
    // Find the opportunity
    const opportunity = await Opportunity.findById(opportunityId);

    if (!opportunity) {
      log.error(`AccessibilityCodeChangeHandler: Opportunity not found for ID: ${opportunityId}`);
      return notFound('Opportunity not found');
    }

    // Verify the opportunity belongs to the correct site
    if (opportunity.getSiteId() !== siteId) {
      const errorMsg = `AccessibilityCodeChangeHandler: Site ID mismatch. Expected: ${siteId}, Found: ${opportunity.getSiteId()}`;
      log.error(errorMsg);
      return badRequest('Site ID mismatch');
    }

    // Get all suggestions for the opportunity
    const suggestions = await opportunity.getSuggestions();

    if (!isNonEmptyArray(suggestions)) {
      log.warn(`AccessibilityCodeChangeHandler: No suggestions found for opportunity: ${opportunityId}`);
      return ok('No suggestions found for opportunity');
    }

    log.info(`AccessibilityCodeChangeHandler: Found ${suggestions.length} suggestions for opportunity: ${opportunityId}`);

    // Get the S3 bucket name from environment
    const bucketName = env.S3_MYSTIQUE_BUCKET_NAME;

    if (!bucketName) {
      log.error('AccessibilityCodeChangeHandler: S3_MYSTIQUE_BUCKET_NAME environment variable not set');
      return internalServerError('S3 bucket name not configured');
    }

    let totalUpdatedSuggestions = 0;

    // Process each update
    await Promise.all(updates.map(async (update) => {
      const { url, source, type: types } = update;

      if (!url) {
        log.warn('AccessibilityCodeChangeHandler: Skipping update without URL');
        return;
      }

      if (!isNonEmptyArray(types)) {
        log.warn(`AccessibilityCodeChangeHandler: Skipping update for URL ${url} without types`);
        return;
      }

      const urlMsg = `AccessibilityCodeChangeHandler: Processing update for URL: ${url}, source: ${source || 'N/A'}, types: ${types.join(', ')}`;
      log.info(urlMsg);

      // For each type in the update, try to read the code change report
      await Promise.all(types.map(async (ruleId) => {
        let reportData = await readCodeChangeReport(
          s3Client,
          bucketName,
          siteId,
          url,
          source,
          ruleId,
          log,
        );

        if (!reportData) {
          const warnMsg = `AccessibilityCodeChangeHandler: No code change report found for URL: ${url}, source: ${source}, type: ${ruleId}`;
          log.warn(warnMsg);
          return;
        }

        reportData = JSON.parse(reportData);

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
        log.info(`AccessibilityCodeChangeHandler: Updated ${updatedSuggestions.length} suggestions for type: ${ruleId}`);
      }));
    }));

    log.info(`AccessibilityCodeChangeHandler: Successfully processed all updates. Total suggestions updated: ${totalUpdatedSuggestions}`);
    return ok();
  } catch (error) {
    log.error(`AccessibilityCodeChangeHandler: Error processing message: ${error.message}`, error);
    return internalServerError(`Error processing message: ${error.message}`);
  }
}
