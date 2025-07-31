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
 * Batch size for AI processing (URLs per batch)
 */
const AI_BATCH_SIZE = 20;

/**
 * Timeout for AI batch processing (in milliseconds)
 */
const AI_BATCH_TIMEOUT = 60000; // 60 seconds per batch

/**
 * Maximum number of concurrent AI batches
 */
const MAX_CONCURRENT_AI_BATCHES = 5;

/**
 * Creates batches of URLs for AI processing
 * @param {Array} validatedUrls - Array of validated URL objects
 * @param {number} batchSize - Size of each batch
 * @returns {Array} - Array of batch objects
 */
function createAiBatches(validatedUrls, batchSize = AI_BATCH_SIZE) {
  const batches = [];

  for (let i = 0; i < validatedUrls.length; i += batchSize) {
    const batch = validatedUrls.slice(i, i + batchSize);
    batches.push({
      batch_id: `llm-batch-${Date.now()}-${Math.floor(i / batchSize)}`,
      urls: batch,
      created_at: new Date().toISOString(),
      batch_index: Math.floor(i / batchSize),
      total_batches: Math.ceil(validatedUrls.length / batchSize),
    });
  }

  return batches;
}

/**
 * Fetches alternative URLs for the site (placeholder - needs implementation)
 * @param {string} siteId - Site identifier
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} - Array of alternative URLs
 */
async function getAlternativeUrls(siteId, log) {
  // TODO: Implement fetching site's URL list
  // This could come from sitemap, internal links audit, or site structure
  // For now, return empty array as placeholder
  log.debug(`Fetching alternative URLs for site ${siteId}`);
  return [];
}

/**
 * Creates SQS message for AI batch processing
 * @param {Object} batch - Batch object with URLs
 * @param {string} siteId - Site identifier
 * @param {Array} alternativeUrls - Alternative URLs for the site
 * @returns {Object} - SQS message object
 */
function createBatchSqsMessage(batch, siteId, alternativeUrls) {
  return {
    message_type: 'llm-error-remediation-batch',
    batch_id: batch.batch_id,
    site_id: siteId,
    alternative_urls: alternativeUrls,
    broken_urls: batch.urls.map((error) => ({
      url: error.url,
      user_agent: error.userAgent,
      status_code: error.status,
      request_count: error.totalRequests,
      raw_user_agents: error.rawUserAgents,
      validated_at: error.validatedAt,
      baseline_status: error.baselineStatus,
      llm_status: error.llmStatus,
      test_user_agent: error.testUserAgent,
    })),
    guidance_type: 'guidance:llm-error-remediation',
    created_at: batch.created_at,
    batch_metadata: {
      batch_index: batch.batch_index,
      total_batches: batch.total_batches,
      urls_count: batch.urls.length,
    },
  };
}

/**
 * Sends batch to Mystique and waits for response (placeholder)
 * @param {Object} sqsMessage - SQS message to send
 * @param {number} timeout - Timeout in milliseconds
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} - AI suggestions response
 */
async function sendBatchToMystiqueAndWait(sqsMessage, timeout, log) {
  // TODO: Implement actual SQS integration
  // This is a placeholder for the SQS + response handling

  log.info(`Sending batch ${sqsMessage.batch_id} to Mystique (${sqsMessage.broken_urls.length} URLs)`);

  try {
    // Simulate API call delay
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });

    // Mock response structure for 404 AI suggestions
    const mockResponse = {
      batch_id: sqsMessage.batch_id,
      processed_count: sqsMessage.broken_urls.length,
      suggestions: sqsMessage.broken_urls.map((brokenUrl) => ({
        broken_url: brokenUrl.url,
        user_agent: brokenUrl.user_agent,
        suggested_urls: [
          '/suggested-alternative-1',
          '/suggested-alternative-2',
          '/related-content',
        ],
        aiRationale: `AI analysis for ${brokenUrl.url} with ${brokenUrl.user_agent}: This 404 error appears to be caused by page restructuring or URL changes. Based on site content analysis and user intent, these alternative pages provide similar value and should be considered for redirects.`,
        confidence_score: 0.75 + (Math.random() * 0.2), // Random between 0.75-0.95
        processing_time_ms: 1500 + Math.floor(Math.random() * 1000),
      })),
      processing_time_seconds: 45,
      failed_urls: [],
      batch_metadata: sqsMessage.batch_metadata,
    };

    log.info(`Received AI suggestions for batch ${sqsMessage.batch_id} (${mockResponse.processed_count} URLs processed)`);
    return mockResponse;
  } catch (error) {
    log.error(`Failed to process AI batch ${sqsMessage.batch_id}: ${error.message}`);
    throw error;
  }
}

// Note: Fallback suggestions removed for 404s
// If AI processing fails, 404 URLs are skipped entirely
// since the value is in the AI-generated alternative URLs

/**
 * Processes validated URLs through AI in batches
 * @param {Array} validatedUrls - Array of validated URL objects
 * @param {string} siteId - Site identifier
 * @param {Object} context - Context object with logger
 * @returns {Promise<Array>} - Array of AI suggestions
 */
export async function processBatchedAiSuggestions(validatedUrls, siteId, context) {
  const { log } = context;

  if (!validatedUrls || validatedUrls.length === 0) {
    log.info('No validated URLs to process for AI suggestions');
    return [];
  }

  // Step 1: Create batches
  const batches = createAiBatches(validatedUrls, AI_BATCH_SIZE);
  log.info(`Created ${batches.length} AI processing batches (${AI_BATCH_SIZE} URLs per batch)`);

  // Step 2: Fetch alternative URLs once (shared across all batches)
  log.info(`Fetching alternative URLs for site ${siteId}`);
  const alternativeUrls = await getAlternativeUrls(siteId, log);
  log.info(`Found ${alternativeUrls.length} alternative URLs for suggestions`);

  // Step 3: Process batches with concurrency control
  const allSuggestions = [];

  // Create batch processing promises
  const batchGroups = [];
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_AI_BATCHES) {
    batchGroups.push(batches.slice(i, i + MAX_CONCURRENT_AI_BATCHES));
  }

  // Process all batch groups and collect results
  const groupPromises = batchGroups.map(async (concurrentBatches, groupIndex) => {
    log.info(`Processing AI batch group ${groupIndex + 1}/${batchGroups.length} (${concurrentBatches.length} batches)`);

    // Process batches in parallel within this group
    const batchResults = await Promise.allSettled(
      concurrentBatches.map((batch) => {
        const sqsMessage = createBatchSqsMessage(batch, siteId, alternativeUrls);
        return sendBatchToMystiqueAndWait(sqsMessage, AI_BATCH_TIMEOUT, log);
      }),
    );

    // Collect results from this batch group
    const groupSuggestions = [];
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        groupSuggestions.push(...result.value.suggestions);
        log.info(`Batch ${concurrentBatches[index].batch_id} completed successfully (${result.value.processed_count} suggestions)`);
      } else {
        log.error(`Batch ${concurrentBatches[index].batch_id} failed: ${result.reason}`);
        // For 404s, no fallback suggestions - skip failed URLs
        const failedBatch = concurrentBatches[index];
        log.warn(`Skipping ${failedBatch.urls.length} URLs from failed batch - no AI suggestions available for 404s`);
        // Note: Failed 404 URLs will not get any suggestions, which is correct business logic
      }
    });

    return groupSuggestions;
  });

  // Wait for all groups to complete and flatten results
  const allGroupResults = await Promise.allSettled(groupPromises);
  allGroupResults.forEach((groupResult) => {
    if (groupResult.status === 'fulfilled') {
      allSuggestions.push(...groupResult.value);
    } else {
      log.error(`Batch group processing failed: ${groupResult.reason}`);
    }
  });

  log.info(`AI batch processing complete: ${allSuggestions.length} total suggestions generated`);
  return allSuggestions;
}

/**
 * Maps AI suggestions back to error objects for opportunity creation
 * Only returns URLs that successfully received AI suggestions
 * @param {Array} aiSuggestions - Array of AI suggestion objects
 * @param {Array} validatedUrls - Original validated URL objects
 * @returns {Array} - Enhanced error objects with AI suggestions
 *                   (URLs without AI suggestions are excluded)
 */
export function mapAiSuggestionsToErrors(aiSuggestions, validatedUrls) {
  // Create a lookup map for AI suggestions
  const suggestionsMap = new Map();
  aiSuggestions.forEach((suggestion) => {
    const key = `${suggestion.broken_url}|${suggestion.user_agent}`;
    suggestionsMap.set(key, suggestion);
  });

  // Only return URLs that have AI suggestions (filter out failed ones)
  const enhancedErrors = validatedUrls
    .map((error) => {
      const key = `${error.url}|${error.userAgent}`;
      const aiSuggestion = suggestionsMap.get(key);

      if (!aiSuggestion) {
        return null; // No AI suggestion available - will be filtered out
      }

      return {
        ...error,
        aiSuggestion,
        hasAiSuggestion: true,
        suggestionType: 'AI_GENERATED',
      };
    })
    .filter((error) => error !== null); // Remove URLs without AI suggestions

  return enhancedErrors;
}
