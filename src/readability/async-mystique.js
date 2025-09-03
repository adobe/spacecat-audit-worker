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

import { DATA_SOURCES } from '../common/constants.js';
import { READABILITY_GUIDANCE_TYPE, READABILITY_OBSERVATION, TARGET_FLESCH_SCORE } from './constants.js';

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
 * @param {string} jobId - Job identifier
 * @param {Object} context - The context object containing sqs, env, dataAccess, etc.
 * @returns {Promise<void>}
 */
export async function sendReadabilityToMystique(
  auditUrl,
  readabilityIssues,
  siteId,
  jobId,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;

  if (!sqs || !env || !env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.error('[readability-async] Missing required context - sqs or queue configuration');
    throw new Error('Missing SQS context or queue configuration');
  }

  log.info(`[readability-async] Sending ${readabilityIssues.length} readability issues to Mystique queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);

  try {
    const site = await dataAccess.Site.findById(siteId);

    // Create or update opportunity to track Mystique responses (like alt-text does)
    const { Opportunity } = dataAccess;

    // Check if opportunity already exists
    // Note: auditId & jobId refer to the same entity
    // opportunities are linked to jobs via auditId
    const existingOpportunities = await Opportunity.allBySiteId(siteId);
    let opportunity = existingOpportunities.find(
      (oppty) => oppty.getAuditId() === jobId && oppty.getData()?.subType === 'readability',
    );

    if (opportunity) {
      // Update existing opportunity
      const existingData = opportunity.getData() || {};
      const updatedData = {
        ...existingData,
        mystiqueResponsesReceived: 0, // Reset for new batch
        mystiqueResponsesExpected: readabilityIssues.length,
        totalReadabilityIssues: readabilityIssues.length,
        processedSuggestionIds: existingData.processedSuggestionIds || [],
        lastMystiqueRequest: new Date().toISOString(),
      };
      opportunity.setData(updatedData);
      await opportunity.save();
      log.info(`[readability-async] Updated existing opportunity with ID: ${opportunity.getId()}`);
    } else {
      // Create new opportunity
      const opportunityData = {
        siteId,
        auditId: jobId, // auditId is set to jobId to link this opportunity to the current job
        type: 'generic-opportunity',
        origin: 'AUTOMATION',
        title: 'Readability Improvement Suggestions',
        description: 'AI-generated suggestions to improve content readability using advanced text analysis',
        status: 'NEW',
        runbook: auditUrl,
        tags: ['Readability', 'Content', 'SEO'],
        data: {
          subType: 'readability',
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: readabilityIssues.length,
          totalReadabilityIssues: readabilityIssues.length,
          processedSuggestionIds: [],
          dataSources: [DATA_SOURCES.SITE, DATA_SOURCES.PAGE],
          lastMystiqueRequest: new Date().toISOString(),
        },
      };

      try {
        opportunity = await Opportunity.create(opportunityData);
        log.info(`[readability-async] Created opportunity with ID: ${opportunity.getId()}`);
      } catch (createError) {
        log.error(`[readability-async] Failed to create opportunity: ${createError.message}`);
        throw createError;
      }
    }

    // Send each readability issue as a separate message to Mystique
    const messagePromises = readabilityIssues.map((issue, index) => {
      const mystiqueMessage = {
        type: READABILITY_GUIDANCE_TYPE,
        siteId,
        auditId: jobId,
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
          log.debug(`[readability-async] Sent message ${index + 1}/${readabilityIssues.length} to Mystique`, {
            pageUrl: issue.pageUrl,
            textLength: issue.textContent.length,
            fleschScore: issue.fleschReadingEase,
          });
          return { success: true, index, pageUrl: issue.pageUrl };
        })
        .catch((sqsError) => {
          log.error(`[readability-async] Failed to send SQS message ${index + 1}:`, {
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
      log.error(`[readability-async] ${failedMessages.length} messages failed to send to Mystique`);
      throw new Error(`Failed to send ${failedMessages.length} out of ${readabilityIssues.length} messages to Mystique`);
    }

    log.info(`[readability-async] Successfully sent ${successfulMessages.length} messages to Mystique for processing`);
  } catch (error) {
    log.error(`[readability-async] Failed to send readability issues to Mystique: ${error.message}`);
    throw error;
  }
}
