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

import { READABILITY_GUIDANCE_TYPE, READABILITY_OBSERVATION, TARGET_READABILITY_SCORE } from './constants.js';

/**
 * Asynchronous Mystique integration for readability audit
 * Similar to how alt-text and accessibility audits work:
 * 1. Send messages to Mystique
 * 2. Return immediately
 * 3. Guidance handler processes responses later
 */

/**
 * Sends readability issues to Mystique for AI processing (asynchronous)
 * Follows the same pattern as alt-text and accessibility audits
 *
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} readabilityIssues - Array of readability issues to process
 * @param {string} siteId - Site identifier
 * @param {string} jobId - Job identifier (AsyncJob ID for preflight, Audit ID for opportunities)
 * @param {Object} context - The context object containing sqs, env, dataAccess, etc.
 * @param {string} guidanceType - The guidance handler type to route responses to
 * @returns {Promise<void>}
 */
export async function sendReadabilityToMystique(
  auditUrl,
  readabilityIssues,
  siteId,
  jobId,
  context,
  guidanceType = READABILITY_GUIDANCE_TYPE,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[readability-suggest async] Missing required context - sqs or queue configuration');
    throw new Error('Missing SQS context or queue configuration');
  }

  log.info(`[readability-suggest async] Sending ${readabilityIssues.length} readability issues to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

  try {
    const site = await dataAccess.Site.findById(siteId);

    // Handle metadata storage differently for preflight vs opportunities
    const isPreflight = guidanceType === READABILITY_GUIDANCE_TYPE;

    if (isPreflight) {
      // Preflight: Store metadata in AsyncJob
      const { AsyncJob: AsyncJobEntity } = dataAccess;

      // Store original order mapping in job metadata to preserve identify-step order
      const originalOrderMapping = readabilityIssues.map((issue, index) => ({
        textContent: issue.textContent,
        originalIndex: index,
      }));

      // Update job with readability metadata for async processing
      const jobEntity = await AsyncJobEntity.findById(jobId);
      const currentPayload = jobEntity.getMetadata()?.payload || {};
      const readabilityMetadata = {
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: readabilityIssues.length,
        totalReadabilityIssues: readabilityIssues.length,
        lastMystiqueRequest: new Date().toISOString(),
        originalOrderMapping, // Store original order for reconstruction
      };

      // Store readability metadata in job payload
      jobEntity.setMetadata({
        ...jobEntity.getMetadata(),
        payload: {
          ...currentPayload,
          readabilityMetadata,
        },
      });
      await jobEntity.save();
      log.info(`[readability-suggest async] Stored readability metadata in AsyncJob ${jobId}`);
    } else {
      // Opportunities: No need to store metadata in AsyncJob
      log.info(`[readability-suggest async] Sending ${readabilityIssues.length} readability issues for opportunity audit ${jobId}`);
    }

    // Send each readability issue as a separate message to Mystique
    const messagePromises = readabilityIssues.map((issue, index) => {
      const mystiqueMessage = {
        type: guidanceType,
        siteId,
        auditId: jobId,
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        url: auditUrl,
        observation: READABILITY_OBSERVATION,
        data: {
          // Use appropriate ID based on audit type
          ...(isPreflight ? { jobId } : { auditId: jobId }),
          original_paragraph: issue.textContent,
          target_flesch_score: TARGET_READABILITY_SCORE,
          current_flesch_score: issue.fleschReadingEase,
          pageUrl: issue.pageUrl,
          selector: issue.selector,
          issue_id: `readability-${Date.now()}-${index}`,
        },
      };

      return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage)
        .then(() => {
          log.debug(`[readability-suggest async] Sent message ${index + 1}/${readabilityIssues.length} to Mystique`, {
            pageUrl: issue.pageUrl,
            textLength: issue.textContent.length,
            fleschScore: issue.fleschReadingEase,
          });
          return { success: true, index, pageUrl: issue.pageUrl };
        })
        .catch((sqsError) => {
          log.error(`[readability-suggest async] Failed to send SQS message ${index + 1}:`, {
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
      log.error(`[readability-suggest async] ${failedMessages.length} messages failed to send to Mystique`);
      throw new Error(`Failed to send ${failedMessages.length} out of ${readabilityIssues.length} messages to Mystique`);
    }

    log.info(`[readability-suggest async] Successfully sent ${successfulMessages.length} messages to Mystique for processing`);
  } catch (error) {
    log.error(`[readability-suggest async] Failed to send readability issues to Mystique: ${error.message}`);
    throw error;
  }
}
