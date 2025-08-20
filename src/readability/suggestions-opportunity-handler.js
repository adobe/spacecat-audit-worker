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
import { READABILITY_GUIDANCE_TYPE, READABILITY_OBSERVATION, TARGET_FLESCH_SCORE } from './constants.js';

/**
 * Sends readability issues to Mystique for AI processing (asynchronous)
 * Follows the same pattern as alt-text audit
 *
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} readabilityIssues - Array of readability issues to process
 * @param {string} siteId - Site identifier
 * @param {string} auditId - Audit identifier
 * @param {Object} opportunity - The opportunity object to track responses
 * @param {Object} context - The context object containing sqs, env, etc.
 * @returns {Promise<void>}
 */
export async function sendReadabilityToMystique(
  auditUrl,
  readabilityIssues,
  siteId,
  auditId,
  opportunity,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[readability-suggestions] Missing required context - sqs or queue configuration');
    throw new Error('Missing SQS context or queue configuration');
  }

  log.info(`[readability-suggestions] Sending ${readabilityIssues.length} readability issues to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

  try {
    const site = await dataAccess.Site.findById(siteId);

    // Send each readability issue as a separate message to Mystique
    const messagePromises = readabilityIssues.map((issue, index) => {
      const mystiqueMessage = {
        type: READABILITY_GUIDANCE_TYPE,
        siteId,
        auditId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        url: auditUrl,
        observation: READABILITY_OBSERVATION,
        data: {
          opportunityId: opportunity.getId(),
          original_paragraph: issue.textContent,
          target_flesch_score: TARGET_FLESCH_SCORE,
          current_flesch_score: issue.fleschReadingEase,
          pageUrl: issue.pageUrl,
          selector: issue.selector,
          issue_id: `readability-${Date.now()}-${index}`,
        },
      };

      return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage)
        .then(() => {
          log.debug(`[readability-suggestions] Sent message ${index + 1}/${readabilityIssues.length} to Mystique`, {
            pageUrl: issue.pageUrl,
            textLength: issue.textContent.length,
            fleschScore: issue.fleschReadingEase,
          });
          return { success: true, index, pageUrl: issue.pageUrl };
        })
        .catch((sqsError) => {
          log.error(`[readability-suggestions] Failed to send SQS message ${index + 1}:`, {
            error: sqsError.message,
            queueUrl: env.QUEUE_SPACECAT_TO_MYSTIQUE,
            pageUrl: issue.pageUrl,
          });
          return {
            success: false, index, pageUrl: issue.pageUrl, error: sqsError,
          };
        });
    });

    // Wait for all messages to be sent
    const results = await Promise.all(messagePromises);
    const successfulMessages = results.filter((result) => result.success);
    const failedMessages = results.filter((result) => !result.success);

    if (failedMessages.length > 0) {
      log.error(`[readability-suggestions] ${failedMessages.length} messages failed to send to Mystique`);
      throw new Error(`Failed to send ${failedMessages.length} out of ${readabilityIssues.length} messages to Mystique`);
    }

    log.info(`[readability-suggestions] Successfully sent ${successfulMessages.length} messages to Mystique for processing`);
  } catch (error) {
    log.error(`[readability-suggestions] Failed to send readability issues to Mystique: ${error.message}`);
    throw error;
  }
}

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
    log.debug('[readability-suggestions]: No new suggestions to add');
    return;
  }

  const updateResult = await opportunity.addSuggestions(newSuggestionDTOs);

  if (isNonEmptyArray(updateResult.errorItems)) {
    log.error(`[readability-suggestions]: Suggestions for siteId ${opportunity.getSiteId()} contains ${updateResult.errorItems.length} items with errors`);
    updateResult.errorItems.forEach((errorItem) => {
      log.error(`[readability-suggestions]: Item ${JSON.stringify(errorItem.item)} failed with error: ${errorItem.error}`);
    });

    if (!isNonEmptyArray(updateResult.createdItems)) {
      throw new Error(`[readability-suggestions]: Failed to create suggestions for siteId ${opportunity.getSiteId()}`);
    }
  }

  log.info(`[readability-suggestions]: Added ${newSuggestionDTOs.length} new readability suggestions`);
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
    log.debug('[readability-suggestions]: No opportunity found, skipping suggestion cleanup');
    return;
  }

  const existingSuggestions = await opportunity.getSuggestions();

  if (!existingSuggestions || existingSuggestions.length === 0) {
    log.debug('[readability-suggestions]: No existing suggestions to clear');
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
    log.info(`[readability-suggestions]: Cleared ${suggestionsToRemove.length} existing suggestions (preserved ${ignoredSuggestions.length} ignored suggestions)`);
  } else {
    log.debug(`[readability-suggestions]: No suggestions to clear (all ${existingSuggestions.length} suggestions are ignored)`);
  }
}
