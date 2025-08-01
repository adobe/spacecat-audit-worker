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
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

const VALIDATION_TIMEOUT = 10000; // 10 seconds

const MAX_CONCURRENT_VALIDATIONS = 20;

/**
 * Validates a single URL with simple status consistency check
 * @param {Object} error - Error object with url, userAgent, rawUserAgents, status
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} - Validated error object or null if invalid
 */
export async function validateSingleUrl(error, log) {
  const {
    url, userAgent, rawUserAgents, status,
  } = error;

  try {
    const testUserAgent = rawUserAgents[0]; // Use first raw user agent

    // For 403 errors, check if it's universally blocked
    if (status === '403') {
      const simpleResponse = await fetch(url, { timeout: VALIDATION_TIMEOUT });
      if (simpleResponse.status === 403) {
        log.debug(`URL ${url} returns 403 even with simple GET - universally blocked, excluding`);
        return null; // Exclude universal 403s
      }
    }

    // Test with LLM user agent to verify status consistency
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': testUserAgent,
      },
      timeout: VALIDATION_TIMEOUT,
    });

    // Status consistency check - remove if status changed
    if (response.status.toString() !== status) {
      log.debug(`URL ${url} status mismatch - expected ${status}, got ${response.status} - removing`);
      return null;
    }

    // URL passed validation
    log.debug(`URL ${url} validated successfully - ${userAgent} status ${status}`);
    return {
      ...error,
      validatedAt: new Date().toISOString(),
    };
  } catch (validationError) {
    // Network errors, timeouts, etc. - still include in opportunities
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
