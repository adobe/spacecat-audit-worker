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

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

const BATCH_STATE_PREFIX = 'broken-internal-links/batch-state';

// Timeout constants (Lambda has 15 min timeout)
const LAMBDA_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const TIMEOUT_BUFFER_MS = 2 * 60 * 1000; // 2 minute buffer
const SAFE_PROCESSING_TIME_MS = LAMBDA_TIMEOUT_MS - TIMEOUT_BUFFER_MS; // 13 minutes
const DEFAULT_ITEM_TYPE = 'link';

function buildBrokenLinkKey(link) {
  return `${link.urlFrom}|${link.urlTo}|${link.itemType || DEFAULT_ITEM_TYPE}`;
}

/**
 * Check if we're approaching Lambda timeout
 * @param {number} startTime - Timestamp when Lambda started
 * @param {Object} log - Logger
 * @returns {boolean} True if we should stop processing
 */
function isApproachingTimeout(startTime, log) {
  const elapsed = Date.now() - startTime;
  if (elapsed > SAFE_PROCESSING_TIME_MS) {
    log.warn(`[batch-state] Approaching Lambda timeout: ${elapsed}ms elapsed, ${LAMBDA_TIMEOUT_MS - elapsed}ms remaining`);
    return true;
  }
  return false;
}

/**
 * Sleep utility
 */
const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

/**
 * Save batch results to unique file (idempotent - safe to overwrite)
 * @param {string} auditId - The audit ID
 * @param {number} batchNum - Batch number
 * @param {Array} results - Broken links found in this batch
 * @param {number} pagesProcessed - Number of pages processed
 * @param {Object} context - Context with s3Client, env, log
 */
export async function saveBatchResults(auditId, batchNum, results, pagesProcessed, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/batches/batch-${batchNum}.json`;

  const data = {
    batchNum,
    processedAt: new Date().toISOString(),
    pagesProcessed,
    resultsCount: results.length,
    results,
  };

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
    }));

    log.info(`[batch-state] Saved batch ${batchNum}: ${results.length} results, ${pagesProcessed} pages`);
  } catch (error) {
    log.error(`[batch-state] Failed to save batch ${batchNum}: ${error.message}`);
    throw error;
  }
}

/**
 * Load cache with ETag for conditional updates
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<Object>} Cache data with ETag
 */
async function loadCacheWithETag(auditId, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/cache/urls.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const cache = JSON.parse(body);

    return {
      broken: cache.broken || [],
      working: cache.working || [],
      etag: response.ETag,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      // First time - no cache exists
      return {
        broken: [],
        working: [],
        etag: null,
      };
    }
    throw error;
  }
}

/**
 * Update shared cache with atomic operations (uses ETag for conflict detection)
 * @param {string} auditId - The audit ID
 * @param {Array} newBroken - New broken URLs to add
 * @param {Array} newWorking - New working URLs to add
 * @param {Object} context - Context with s3Client, env, log
 * @param {number} maxRetries - Maximum retry attempts
 */
export async function updateCache(auditId, newBroken, newWorking, context, maxRetries = 5) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/cache/urls.json`;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      // Load current cache with ETag
      // eslint-disable-next-line no-await-in-loop
      const currentCache = await loadCacheWithETag(auditId, context);

      // Merge (union of sets - deduplication)
      const merged = {
        broken: [...new Set([...currentCache.broken, ...newBroken])],
        working: [...new Set([...currentCache.working, ...newWorking])],
        lastUpdated: new Date().toISOString(),
      };

      // Save with conditional write
      const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify(merged),
        ContentType: 'application/json',
      };

      // Only use IfMatch if we have an ETag (not first time)
      if (currentCache.etag) {
        putParams.IfMatch = currentCache.etag;
      }

      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(new PutObjectCommand(putParams));

      log.info(`[batch-state] Cache updated (attempt ${attempt + 1}): ${merged.broken.length} broken, ${merged.working.length} working`);
      return; // Success
    } catch (error) {
      if (error.name === 'PreconditionFailed' && attempt < maxRetries - 1) {
        // Conflict - another batch updated cache
        log.warn(`[batch-state] Cache conflict (attempt ${attempt + 1}), retrying with merge...`);

        // Exponential backoff with jitter to prevent thundering herd
        const baseDelay = 100 * 2 ** attempt;
        const jitter = baseDelay * (0.5 + Math.random());
        // eslint-disable-next-line no-await-in-loop
        await sleep(jitter);
        // eslint-disable-next-line no-continue
        continue; // Retry
      }

      // Non-retryable error or max retries exceeded
      log.error(`[batch-state] Cache update failed after ${attempt + 1} attempts: ${error.message}`);
      throw error;
    }
  }
  // Unreachable: loop always returns or throws
  throw new Error(`Failed to update cache after ${maxRetries} attempts`);
}

/**
 * Load cache (without ETag, for read-only operations)
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<Object>} Cache arrays
 */
export async function loadCache(auditId, context) {
  const { log } = context;
  const cache = await loadCacheWithETag(auditId, context);

  if (cache.broken.length === 0 && cache.working.length === 0) {
    log.debug('[batch-state] No cache found, using empty cache');
  } else {
    log.debug(`[batch-state] Loaded cache: ${cache.broken.length} broken, ${cache.working.length} working`);
  }

  return {
    brokenUrlsCache: cache.broken,
    workingUrlsCache: cache.working,
  };
}

/**
 * Load completion tracking with ETag
 */
async function loadCompletedWithETag(auditId, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/completed.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const data = JSON.parse(body);

    return {
      completed: data.completed || [],
      etag: response.ETag,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return {
        completed: [],
        etag: null,
      };
    }
    throw error;
  }
}

/**
 * Mark batch as completed (atomic operation)
 * @param {string} auditId - The audit ID
 * @param {number} batchNum - Batch number
 * @param {Object} context - Context with s3Client, env, log
 * @param {number} maxRetries - Maximum retry attempts
 */
export async function markBatchCompleted(auditId, batchNum, context, maxRetries = 5) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/completed.json`;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const current = await loadCompletedWithETag(auditId, context);

      // Add this batch (Set ensures no duplicates)
      const updated = [...new Set([...current.completed, batchNum])].sort((a, b) => a - b);

      const putParams = {
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify({
          completed: updated,
          lastUpdated: new Date().toISOString(),
        }),
        ContentType: 'application/json',
      };

      if (current.etag) {
        putParams.IfMatch = current.etag;
      }

      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(new PutObjectCommand(putParams));
      log.debug(`[batch-state] Marked batch ${batchNum} as completed`);
      return;
    } catch (error) {
      if (error.name === 'PreconditionFailed' && attempt < maxRetries - 1) {
        // Retry with exponential backoff
        // eslint-disable-next-line no-await-in-loop
        await sleep(50 * 2 ** attempt * (0.5 + Math.random()));
        // eslint-disable-next-line no-continue
        continue;
      }
      throw error;
    }
  }
}

/**
 * Check if batch already completed
 * @param {string} auditId - The audit ID
 * @param {number} batchNum - Batch number
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<boolean>} True if batch already completed
 */
export async function isBatchCompleted(auditId, batchNum, context) {
  try {
    const current = await loadCompletedWithETag(auditId, context);
    return current.completed.includes(batchNum);
  } catch (error) {
    const { log } = context;
    log.error(`[batch-state] Error checking batch completion: ${error.message}`);
    // On error, assume not completed (will process and be idempotent)
    return false;
  }
}

/**
 * Load all batch results and merge (called at finalization)
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @param {number} startTime - Lambda start time (for timeout check)
 * @returns {Promise<Array>} Merged and deduplicated results
 */
export async function loadAllBatchResults(auditId, context, startTime) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `${BATCH_STATE_PREFIX}/${auditId}/batches/`;

  // Check timeout before loading
  if (startTime && isApproachingTimeout(startTime, log)) {
    log.error('[batch-state] Approaching timeout, cannot safely load all batch results');
    throw new Error('Timeout approaching - cannot complete merge operation');
  }

  const { Contents } = await s3Client.send(new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: prefix,
  }));

  if (!Contents || Contents.length === 0) {
    log.info('[batch-state] No batch files found');
    return [];
  }

  log.info(`[batch-state] Loading ${Contents.length} batch files...`);

  // Load all batches in parallel
  const batches = await Promise.all(
    Contents.map(async ({ Key }) => {
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key,
      }));
      const body = await response.Body.transformToString();
      return JSON.parse(body);
    }),
  );

  // Sort by batch number for consistent ordering
  batches.sort((a, b) => a.batchNum - b.batchNum);

  // Merge and deduplicate by urlFrom|urlTo|itemType so asset/link collisions do not overwrite.
  const resultsMap = new Map();
  batches.forEach((batch) => {
    batch.results.forEach((link) => {
      const key = buildBrokenLinkKey(link);
      resultsMap.set(key, link);
    });
  });

  const results = Array.from(resultsMap.values());
  log.info(`[batch-state] Merged ${batches.length} batches: ${results.length} unique broken links`);

  return results;
}

/**
 * Cleanup all batch state files (called after audit completion)
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 */
export async function cleanupBatchState(auditId, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const prefix = `${BATCH_STATE_PREFIX}/${auditId}/`;

  try {
    const { Contents } = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    }));

    if (!Contents || Contents.length === 0) {
      log.debug('[batch-state] No files to cleanup');
      return;
    }

    log.info(`[batch-state] Cleaning up ${Contents.length} files for audit ${auditId}`);

    // Delete all files in parallel
    await Promise.all(
      Contents.map(({ Key }) => s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key,
      }))),
    );

    log.info(`[batch-state] Cleanup complete for audit ${auditId}`);
  } catch (error) {
    // Log but don't throw - cleanup is best effort
    log.warn(`[batch-state] Cleanup failed: ${error.message}`);
  }
}

/**
 * Get timeout-safe status for Lambda execution
 * @param {number} startTime - Lambda start timestamp
 * @returns {Object} Timeout status
 */
export function getTimeoutStatus(startTime) {
  const elapsed = Date.now() - startTime;
  const remaining = LAMBDA_TIMEOUT_MS - elapsed;
  const safeTimeRemaining = remaining - TIMEOUT_BUFFER_MS;

  return {
    elapsed,
    remaining,
    safeTimeRemaining,
    isApproachingTimeout: elapsed > SAFE_PROCESSING_TIME_MS,
    percentUsed: (elapsed / LAMBDA_TIMEOUT_MS) * 100,
  };
}

/**
 * Load final results from all batch files
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @param {number} startTime - Lambda start time (for timeout check)
 * @returns {Promise<Array>} Array of all broken links
 */
export async function loadFinalResults(auditId, context, startTime) {
  return loadAllBatchResults(auditId, context, startTime);
}

// Export constants for use in handler
export const BATCH_TIMEOUT_CONFIG = {
  LAMBDA_TIMEOUT_MS,
  TIMEOUT_BUFFER_MS,
  SAFE_PROCESSING_TIME_MS,
};
