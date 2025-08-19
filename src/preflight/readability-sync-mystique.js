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

import rs from 'text-readability';
import { franc } from 'franc-min';

// Mystique configuration
const READABILITY_GUIDANCE_TYPE = 'guidance:readability';
const READABILITY_OBSERVATION = 'Content readability needs improvement';
const TARGET_READABILITY_SCORE = 30;
const MYSTIQUE_BATCH_SIZE = 5;

// Polling configuration
const POLLING_INTERVAL_MS = 2000; // Poll every 2 seconds
const MAX_POLLING_TIME_MS = 60000; // Maximum wait time: 60 seconds
const MAX_POLLING_ATTEMPTS = MAX_POLLING_TIME_MS / POLLING_INTERVAL_MS;

/**
 * Chunks an array into smaller arrays of specified size
 */
function chunkArray(array, chunkSize) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Generates mock suggestions for development/testing when Mystique is not available
 * @param {Array} readabilityIssues - Array of readability issues
 * @param {Object} log - Logger object
 * @returns {Array} Mock suggestions with improved text
 */
function generateMockSuggestions(readabilityIssues, log) {
  log.info('[readability-sync] Generating mock suggestions for development');

  return readabilityIssues
    .filter((issue) => issue.check === 'poor-readability' && issue.textContent)
    .map((issue) => {
      const originalText = issue.textContent;
      const originalScore = rs.fleschReadingEase(originalText);

      // Simple mock improvement: replace complex words and shorten sentences
      const improvedText = originalText
        .replace(/utilize/gi, 'use')
        .replace(/numerous/gi, 'many')
        .replace(/extraordinarily/gi, 'very')
        .replace(/multisyllabic/gi, 'long')
        .replace(/intricate/gi, 'complex')
        .replace(/grammatical constructions/gi, 'grammar')
        .replace(/comprehend/gi, 'understand')
        .replace(/considerable/gi, 'much')
        .replace(/concentration/gi, 'focus')
        .replace(/substantially/gi, 'greatly')
        .replace(/facilitate/gi, 'help')
        .replace(/accommodate/gi, 'fit')
        .replace(/comprehensive/gi, 'complete')
        .replace(/predominantly/gi, 'mainly');

      const improvedScore = rs.fleschReadingEase(improvedText);

      return {
        type: 'content_improvement',
        originalText,
        improvedText,
        originalFleschScore: originalScore,
        improvedFleschScore: improvedScore,
        improvement: improvedScore - originalScore,
        seoRecommendation: 'Mock suggestion: Simplified complex words and shortened sentences to improve readability.',
        aiRationale: 'Development mock: Replaced complex vocabulary with simpler alternatives and improved sentence structure.',
        rank: 1,
      };
    });
}

/**
 * Formats Mystique suggestions for inclusion in API response
 * @param {Array} suggestions - Array of suggestion objects from the database
 * @returns {Array} Formatted suggestions with improved text
 */
function formatMystiqueSuggestions(suggestions) {
  return suggestions.map((suggestion) => {
    const suggestionData = suggestion.getData();

    // Extract data from the suggestion
    const data = suggestionData.data || suggestionData;

    const originalScore = data.originalFleschScore || data.current_flesch_score;
    const improvedScore = data.improvedFleschScore || data.improved_flesch_score;

    return {
      type: 'content_improvement',
      originalText: data.originalParagraph || data.original_paragraph,
      improvedText: data.improvedParagraph || data.improved_paragraph,
      originalFleschScore: originalScore,
      improvedFleschScore: improvedScore,
      improvement: improvedScore - originalScore,
      seoRecommendation: data.seoRecommendation || data.seo_recommendation,
      aiRationale: data.aiRationale || data.ai_rationale,
      rank: suggestion.getRank?.() || data.rank || 1,
    };
  });
}

/**
 * Polls the opportunity for suggestions until all expected responses are received
 * @param {Object} opportunity - The opportunity to monitor
 * @param {Object} context - Context object with log, dataAccess
 * @returns {Promise<Array>} Array of suggestions from Mystique
 */
async function waitForMystiqueResponses(opportunity, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;

  let attempts = 0;
  const opportunityId = opportunity.getId();

  // eslint-disable-next-line no-await-in-loop
  while (attempts < MAX_POLLING_ATTEMPTS) {
    try {
      // Refresh opportunity data
      // eslint-disable-next-line no-await-in-loop
      const refreshedOpportunity = await Opportunity.findById(opportunityId);
      if (!refreshedOpportunity) {
        throw new Error(`Opportunity ${opportunityId} not found during polling`);
      }

      const data = refreshedOpportunity.getData() || {};
      const responsesReceived = data.mystiqueResponsesReceived || 0;
      const responsesExpected = data.mystiqueResponsesExpected || 0;

      const attemptNumber = attempts + 1;
      log.debug(`[readability-sync] Polling attempt ${attemptNumber}: ${responsesReceived}/${responsesExpected} responses received`);

      // Check if all responses have been received
      if (responsesReceived >= responsesExpected && responsesExpected > 0) {
        log.info(`[readability-sync] All ${responsesExpected} Mystique responses received`);

        // Get all suggestions from the opportunity
        // eslint-disable-next-line no-await-in-loop
        const suggestions = await refreshedOpportunity.getSuggestions();

        if (suggestions && suggestions.length > 0) {
          log.info(`[readability-sync] Retrieved ${suggestions.length} suggestions from Mystique`);
          return formatMystiqueSuggestions(suggestions);
        }
        log.warn('[readability-sync] No suggestions found despite receiving responses');
        return [];
      }

      // Wait before next polling attempt
      attempts += 1;
      if (attempts < MAX_POLLING_ATTEMPTS) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, POLLING_INTERVAL_MS);
        });
      }
    } catch (error) {
      const attemptNumber = attempts + 1;
      log.error(`[readability-sync] Error during polling attempt ${attemptNumber}:`, error);
      attempts += 1;
      if (attempts < MAX_POLLING_ATTEMPTS) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, POLLING_INTERVAL_MS);
        });
      }
    }
  }

  log.warn(`[readability-sync] Timeout waiting for Mystique responses after ${MAX_POLLING_TIME_MS}ms`);
  return [];
}

/**
 * Sends readability opportunities to Mystique and waits for responses
 * @param {string} auditUrl - The URL being audited
 * @param {Array} readabilityIssues - Array of readability issues
 * @param {string} siteId - Site ID
 * @param {string} auditId - Audit ID
 * @param {Object} context - Context object with sqs, env, log, dataAccess
 * @returns {Promise<Array>} Array of improved text suggestions from Mystique
 */
export async function sendToMystiqueAndWait(
  auditUrl,
  readabilityIssues,
  siteId,
  auditId,
  context,
) {
  const {
    sqs, env, log, dataAccess,
  } = context;
  const { Opportunity } = dataAccess;

  if (!sqs) {
    throw new Error('SQS client is required for Mystique integration');
  }

  if (!env.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[readability-sync] QUEUE_SPACECAT_TO_MYSTIQUE not configured, using mock suggestions for development');
    return generateMockSuggestions(readabilityIssues, log);
  }

  try {
    // Filter issues for Mystique processing
    const mystiqueReadyIssues = readabilityIssues.filter((issue) => {
      if (issue.check !== 'poor-readability') return false;

      const originalText = issue.textContent;
      if (!originalText || originalText.length < 50) return false;

      // Check if content is in English
      const detectedLanguage = franc(originalText);
      if (detectedLanguage !== 'eng') return false;

      // Check if score is below target
      const currentScore = rs.fleschReadingEase(originalText);
      return currentScore < TARGET_READABILITY_SCORE;
    });

    if (mystiqueReadyIssues.length === 0) {
      log.info('[readability-sync] No issues suitable for Mystique processing');
      return [];
    }

    // Create opportunity to track responses
    let opportunity = await Opportunity.findBySiteIdAndAuditIdAndType(
      siteId,
      auditId,
      'readability',
    );

    if (!opportunity) {
      // Create temporary opportunity for tracking
      const opportunityData = {
        siteId,
        auditId,
        type: 'readability',
        title: 'Readability Improvement Suggestions',
        description: 'AI-generated suggestions to improve content readability',
        status: 'NEW',
        data: {
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: 0,
          totalReadabilityIssues: mystiqueReadyIssues.length,
        },
      };
      opportunity = await Opportunity.create(opportunityData);
      log.info(`[readability-sync] Created opportunity ${opportunity.getId()} for tracking Mystique responses`);
    }

    // Send issues to Mystique in batches
    const issueBatches = chunkArray(mystiqueReadyIssues, MYSTIQUE_BATCH_SIZE);
    let totalMessagesSent = 0;

    // Update expected responses count
    const opportunityData = opportunity.getData() || {};
    opportunityData.mystiqueResponsesExpected = issueBatches.length;
    opportunityData.mystiqueResponsesReceived = 0;
    opportunity.setData(opportunityData);
    await opportunity.save();

    log.info(`[readability-sync] Sending ${issueBatches.length} batches to Mystique`);

    // Process all batches in parallel to avoid await-in-loop
    await Promise.all(
      issueBatches.map(async (batch, batchIndex) => {
        const batchPromises = batch.map(async (issue) => {
          const originalText = issue.textContent;
          const currentScore = rs.fleschReadingEase(originalText);

          const mystiqueMessage = {
            type: READABILITY_GUIDANCE_TYPE,
            siteId,
            auditId,
            deliveryType: context.site.getDeliveryType(),
            time: new Date().toISOString(),
            url: auditUrl,
            observation: READABILITY_OBSERVATION,
            data: {
              original_paragraph: originalText,
              target_flesch_score: TARGET_READABILITY_SCORE,
              current_flesch_score: currentScore,
              issue_id: issue.id || `readability-${Date.now()}-${Math.random()}`,
            },
          };

          await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
          totalMessagesSent += 1;

          log.debug(`[readability-sync] Sent message for issue in batch ${batchIndex + 1}`);
        });

        await Promise.all(batchPromises);
      }),
    );

    log.info(`[readability-sync] Sent ${totalMessagesSent} messages to Mystique, waiting for responses...`);

    // Wait for Mystique responses
    const suggestions = await waitForMystiqueResponses(opportunity, context);

    return suggestions;
  } catch (error) {
    log.error('[readability-sync] Error in Mystique sync processing:', {
      error: error.message,
      stack: error.stack,
      siteId,
      auditId,
      auditUrl,
      issuesCount: readabilityIssues.length,
    });
    throw error;
  }
}
