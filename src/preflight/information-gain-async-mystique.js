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

import { INFORMATION_GAIN_OBSERVATION, IMPROVEMENT_PROMPTS } from './information-gain-constants.js';

/**
 * Asynchronous Mystique integration for information-gain content improvements
 * Similar to how readability audit works:
 * 1. Send weak aspects to Mystique for content improvement
 * 2. Return immediately
 * 3. Guidance handler processes responses later
 */

/**
 * Sends information-gain weak aspects to Mystique for AI-powered content improvement
 *
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} improvementRequests - Array of improvement requests with weak aspects
 * @param {string} siteId - Site identifier
 * @param {string} jobId - Job identifier (AsyncJob ID for preflight)
 * @param {Object} context - The context object containing sqs, env, dataAccess, etc.
 * @returns {Promise<void>}
 */
export async function sendInformationGainToMystique(
  auditUrl,
  improvementRequests,
  siteId,
  jobId,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[information-gain async] Missing required context - sqs or queue configuration');
    throw new Error('Missing SQS context or queue configuration');
  }

  log.debug(`[information-gain async] Sending ${improvementRequests.length} improvement requests to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

  try {
    const site = await dataAccess.Site.findById(siteId);
    const { AsyncJob: AsyncJobEntity } = dataAccess;

    // Store original order mapping in job metadata
    const originalOrderMapping = improvementRequests.map((req, index) => ({
      pageUrl: req.pageUrl,
      aspect: req.aspect,
      originalContent: req.originalContent,
      originalIndex: index,
    }));

    // Update job with information-gain metadata for async processing
    const jobEntity = await AsyncJobEntity.findById(jobId);
    const currentPayload = jobEntity.getMetadata()?.payload || {};
    const infoGainMetadata = {
      mystiqueResponsesReceived: 0,
      mystiqueResponsesExpected: improvementRequests.length,
      totalImprovementRequests: improvementRequests.length,
      lastMystiqueRequest: new Date().toISOString(),
      originalOrderMapping,
    };

    // Store information-gain metadata in job payload
    jobEntity.setMetadata({
      ...jobEntity.getMetadata(),
      payload: {
        ...currentPayload,
        informationGainMetadata: infoGainMetadata,
      },
    });
    await jobEntity.save();
    log.debug(`[information-gain async] Stored information-gain metadata in job ${jobId}`);

    // Send each improvement request as a separate message to Mystique
    const messagePromises = improvementRequests.map((request, index) => {
      const prompt = IMPROVEMENT_PROMPTS[request.aspect];
      const observation = `${INFORMATION_GAIN_OBSERVATION}

${prompt}

Original content:
${request.originalContent}`;

      const mystiqueMessage = {
        type: 'guidance:information-gain',
        siteId,
        auditId: jobId,
        mode: 'preflight',
        deliveryType: site.getDeliveryType(),
        time: new Date().toISOString(),
        url: auditUrl,
        observation,
        data: {
          jobId,
          pageUrl: request.pageUrl,
          aspect: request.aspect,
          original_content: request.originalContent,
          weak_aspect_reason: request.reason,
          current_score: request.currentScore,
          seo_impact: request.seoImpact,
          issue_id: `infogain-${Date.now()}-${index}`,
        },
      };

      return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage)
        .then(() => {
          log.debug(`[information-gain async] Sent message ${index + 1}/${improvementRequests.length} to Mystique`, {
            pageUrl: request.pageUrl,
            aspect: request.aspect,
            contentLength: request.originalContent.length,
          });
          return { success: true, index, pageUrl: request.pageUrl };
        })
        .catch((sqsError) => {
          log.error(`[information-gain async] Failed to send SQS message ${index + 1}:`, {
            error: sqsError.message,
            queueUrl: env.QUEUE_SPACECAT_TO_MYSTIQUE,
            pageUrl: request.pageUrl,
          });
          return {
            success: false, index, pageUrl: request.pageUrl, error: sqsError,
          };
        });
    });

    // Wait for all messages to be sent
    const results = await Promise.all(messagePromises);
    const successfulMessages = results.filter((result) => result.success);
    const failedMessages = results.filter((result) => !result.success);

    if (failedMessages.length > 0) {
      log.error(`[information-gain async] ${failedMessages.length} messages failed to send to Mystique`);
      throw new Error(`Failed to send ${failedMessages.length} out of ${improvementRequests.length} messages to Mystique`);
    }

    log.debug(`[information-gain async] Successfully sent ${successfulMessages.length} messages to Mystique for processing`);
  } catch (error) {
    log.error(`[information-gain async] Failed to send improvement requests to Mystique: ${error.message}`);
    throw error;
  }
}
