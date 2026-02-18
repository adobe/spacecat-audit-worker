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

import { PutObjectCommand } from '@aws-sdk/client-s3';
import {
  READABILITY_GUIDANCE_TYPE,
  READABILITY_OBSERVATION,
  TARGET_READABILITY_SCORE,
  READABILITY_BATCH_PREFIX,
} from './constants.js';

/**
 * Asynchronous Mystique integration for readability audit.
 *
 * Preflight mode:  one SQS message per paragraph, data inline,
 *                  type = guidance:readability, mode = preflight
 *
 * Opportunity mode: one S3 file with all paragraphs, one SQS message
 *                   with s3BatchPath, type = guidance:readability, mode = opportunity
 */

/**
 * Preflight mode: sends one SQS message per issue with inline data.
 * Unchanged from the original contract.
 */
async function sendPreflightMessages(
  readabilityIssues,
  siteId,
  jobId,
  auditUrl,
  site,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  // Store metadata in AsyncJob for preflight
  const { AsyncJob: AsyncJobEntity } = dataAccess;
  const originalOrderMapping = readabilityIssues.map((issue, index) => ({
    textContent: issue.textContent,
    originalIndex: index,
  }));

  const jobEntity = await AsyncJobEntity.findById(jobId);
  const currentPayload = jobEntity.getMetadata()?.payload || {};
  const readabilityMetadata = {
    mystiqueResponsesReceived: 0,
    mystiqueResponsesExpected: readabilityIssues.length,
    totalReadabilityIssues: readabilityIssues.length,
    lastMystiqueRequest: new Date().toISOString(),
    originalOrderMapping,
  };

  jobEntity.setMetadata({
    ...jobEntity.getMetadata(),
    payload: {
      ...currentPayload,
      readabilityMetadata,
    },
  });
  await jobEntity.save();
  log.debug(`[readability-suggest async] Stored readability metadata in job ${jobId}`);

  // Send each issue as a separate message
  const messagePromises = readabilityIssues.map((issue, index) => {
    const mystiqueMessage = {
      type: READABILITY_GUIDANCE_TYPE,
      siteId,
      auditId: jobId,
      mode: 'preflight',
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      url: auditUrl,
      observation: READABILITY_OBSERVATION,
      data: {
        jobId,
        original_paragraph: issue.textContent,
        target_flesch_score: TARGET_READABILITY_SCORE,
        current_flesch_score: issue.fleschReadingEase,
        pageUrl: issue.pageUrl,
        selector: issue.selector || issue.elements?.[0]?.selector || '',
        issue_id: `readability-${Date.now()}-${index}`,
      },
    };

    return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage)
      .then(() => {
        log.debug(`[readability-suggest async] Sent preflight message ${index + 1}/${readabilityIssues.length} to Mystique`, {
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

  const results = await Promise.all(messagePromises);
  const failedMessages = results.filter((result) => !result.success);

  if (failedMessages.length > 0) {
    log.error(`[readability-suggest async] ${failedMessages.length} messages failed to send to Mystique`);
    throw new Error(`Failed to send ${failedMessages.length} out of ${readabilityIssues.length} messages to Mystique`);
  }

  const successfulMessages = results.filter((result) => result.success);
  log.debug(`[readability-suggest async] Successfully sent ${successfulMessages.length} preflight messages to Mystique for processing`);
}

/**
 * Opportunity mode: writes all issues to S3 as a JSON array,
 * then sends a single SQS message with s3BatchPath.
 */
async function sendOpportunityBatch(
  readabilityIssues,
  siteId,
  jobId,
  context,
) {
  const {
    sqs, env, log, s3Client,
  } = context;

  const bucketName = env.S3_MYSTIQUE_BUCKET_NAME;
  if (!bucketName) {
    throw new Error('Missing S3_MYSTIQUE_BUCKET_NAME for readability batch');
  }

  log.debug(`[readability-suggest async] Sending ${readabilityIssues.length} readability issues for opportunity audit ${jobId}`);

  // Build the S3 request payload
  const batchPayload = readabilityIssues.map((issue) => ({
    originalParagraph: issue.textContent,
    targetFleschScore: TARGET_READABILITY_SCORE,
    currentFleschScore: issue.fleschReadingEase,
    pageUrl: issue.pageUrl,
    selector: issue.selector || issue.elements?.[0]?.selector || '',
  }));

  // Write to S3
  const s3Key = `${READABILITY_BATCH_PREFIX}/${siteId}/${jobId}.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: s3Key,
    Body: JSON.stringify(batchPayload),
    ContentType: 'application/json',
  }));
  log.debug(`[readability-suggest async] Wrote ${readabilityIssues.length} issues to S3: ${s3Key}`);

  // Send single SQS message with s3BatchPath
  const mystiqueMessage = {
    type: READABILITY_GUIDANCE_TYPE,
    siteId,
    auditId: jobId,
    mode: 'opportunity',
    data: {
      s3BatchPath: s3Key,
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.debug(`[readability-suggest async] Successfully sent batch message to Mystique for opportunity audit ${jobId}`);
}

/**
 * Sends readability issues to Mystique for AI processing (asynchronous).
 *
 * @param {string} auditUrl - The base URL being audited
 * @param {Array} readabilityIssues - Array of readability issues to process
 * @param {string} siteId - Site identifier
 * @param {string} jobId - Job identifier (AsyncJob ID for preflight, Audit ID for opportunities)
 * @param {Object} context - The context object containing sqs, env, dataAccess, etc.
 * @param {string} mode - The processing mode: 'preflight' or 'opportunity'
 * @returns {Promise<void>}
 */
export async function sendReadabilityToMystique(
  auditUrl,
  readabilityIssues,
  siteId,
  jobId,
  context,
  mode = 'preflight',
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[readability-suggest async] Missing required context - sqs or queue configuration');
    throw new Error('Missing SQS context or queue configuration');
  }

  log.debug(`[readability-suggest async] Sending ${readabilityIssues.length} readability issues to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

  try {
    const site = await dataAccess.Site.findById(siteId);
    const isPreflight = mode === 'preflight';

    if (isPreflight) {
      await sendPreflightMessages(
        readabilityIssues,
        siteId,
        jobId,
        auditUrl,
        site,
        context,
      );
    } else {
      await sendOpportunityBatch(
        readabilityIssues,
        siteId,
        jobId,
        context,
      );
    }
  } catch (error) {
    log.error(`[readability-suggest async] Failed to send readability issues to Mystique: ${error.message}`);
    throw error;
  }
}
