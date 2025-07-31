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
import { fetch } from '@adobe/spacecat-shared-http-utils';

/**
 * Normal browser user agent for baseline validation
 */
const BASELINE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Timeout for HTTP validation requests (in milliseconds)
 */
const VALIDATION_TIMEOUT = 10000; // 10 seconds

/**
 * Maximum concurrent validation requests
 */
const MAX_CONCURRENT_VALIDATIONS = 20;

/**
 * Validates a single URL with both baseline and LLM user agent
 * @param {Object} error - Error object with url, userAgent, rawUserAgents
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} - Validated error object or null if invalid
 */
async function validateSingleUrl(error, log) {
  const { url, userAgent, rawUserAgents } = error;

  try {
    // Step 1: Test with baseline (normal browser) user agent
    const baselineResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': BASELINE_USER_AGENT,
      },
      timeout: VALIDATION_TIMEOUT,
    });

    const baselineStatus = baselineResponse.status;

    // Step 2: Test with one of the raw LLM user agents
    const testUserAgent = rawUserAgents[0]; // Use first raw user agent
    const llmResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': testUserAgent,
      },
      timeout: VALIDATION_TIMEOUT,
    });

    const llmStatus = llmResponse.status;

    // Step 3: Apply validation rules

    // Rule 1: If URL returns 200 with baseline, it's not actually broken
    if (baselineStatus === 200) {
      log.debug(`URL ${url} returns 200 with baseline browser - removing from suggestions`);
      return null;
    }

    // Rule 2: For 403 errors, if both baseline and LLM return 403, it's universal blocking
    if (error.status === '403' && baselineStatus === 403 && llmStatus === 403) {
      log.debug(`URL ${url} returns 403 for both baseline and LLM - universal blocking, removing`);
      return null;
    }

    // Rule 3: If LLM status doesn't match expected status, remove it
    if (llmStatus.toString() !== error.status) {
      log.debug(`URL ${url} status mismatch - expected ${error.status}, got ${llmStatus} - removing`);
      return null;
    }

    // URL passed validation
    log.debug(`URL ${url} validated successfully - ${userAgent} status ${error.status}`);
    return {
      ...error,
      validatedAt: new Date().toISOString(),
      baselineStatus,
      llmStatus,
      testUserAgent,
    };
  } catch (validationError) {
    // Network errors, timeouts, etc. - still include in suggestions
    log.warn(`Validation failed for ${url} (${userAgent}): ${validationError.message} - including anyway`);
    return {
      ...error,
      validatedAt: new Date().toISOString(),
      validationError: validationError.message,
    };
  }
}

/**
 * Validates URLs in batches with concurrency control
 * @param {Array} errors - Array of error objects to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} - Array of validated error objects
 */
export async function validateUrlsBatch(errors, log) {
  log.info(`Starting URL validation for ${errors.length} URLs`);

  const validatedUrls = [];

  // Create batch processing promises to avoid await-in-loop
  const batchPromises = [];
  for (let i = 0; i < errors.length; i += MAX_CONCURRENT_VALIDATIONS) {
    const batch = errors.slice(i, i + MAX_CONCURRENT_VALIDATIONS);
    const batchIndex = Math.floor(i / MAX_CONCURRENT_VALIDATIONS) + 1;
    const totalBatches = Math.ceil(errors.length / MAX_CONCURRENT_VALIDATIONS);

    log.info(`Preparing validation batch ${batchIndex}/${totalBatches} (${batch.length} URLs)`);

    // Create promise for this batch
    const batchPromise = Promise.allSettled(
      batch.map((error) => validateSingleUrl(error, log)),
    ).then((batchResults) => ({
      batchIndex,
      batch,
      results: batchResults,
    }));

    batchPromises.push(batchPromise);
  }

  // Process all batches
  const allBatchResults = await Promise.allSettled(batchPromises);

  // Collect valid results from all batches
  allBatchResults.forEach((batchResult) => {
    if (batchResult.status === 'fulfilled') {
      const { batchIndex, batch, results } = batchResult.value;
      log.info(`Processing results for batch ${batchIndex} (${results.length} URLs)`);

      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value !== null) {
          validatedUrls.push(result.value);
        } else if (result.status === 'rejected') {
          log.error(`Validation failed for URL ${batch[index].url}: ${result.reason}`);
        }
      });
    } else {
      log.error(`Batch processing failed: ${batchResult.reason}`);
    }
  });

  log.info(`URL validation complete: ${validatedUrls.length}/${errors.length} URLs passed validation`);
  return validatedUrls;
}

/**
 * Groups errors by status code for batch validation
 * @param {Array} errors - Array of error objects
 * @returns {Object} - Errors grouped by status code
 */
export function groupErrorsForValidation(errors) {
  const grouped = {
    404: [],
    403: [],
    '5xx': [],
  };

  errors.forEach((error) => {
    if (error.status === '404') {
      grouped['404'].push(error);
    } else if (error.status === '403') {
      grouped['403'].push(error);
    } else if (error.status.startsWith('5')) {
      grouped['5xx'].push(error);
    }
  });

  return grouped;
}
