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
import { sleep } from '../support/utils.js';
import { buildBrokenLinkKey } from './link-key.js';

const BATCH_STATE_PREFIX = 'broken-internal-links/batch-state';

// Timeout constants (Lambda has 15 min timeout)
const LAMBDA_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const TIMEOUT_BUFFER_MS = 2 * 60 * 1000; // 2 minute buffer
const SAFE_PROCESSING_TIME_MS = LAMBDA_TIMEOUT_MS - TIMEOUT_BUFFER_MS; // 13 minutes
const S3_BATCH_OPERATION_SIZE = 10;
const BATCH_CLAIM_TTL_MS = LAMBDA_TIMEOUT_MS + TIMEOUT_BUFFER_MS;
const DISPATCH_RESERVATION_TTL_MS = 5 * 60 * 1000;
const FINALIZATION_LOCK_TTL_MS = LAMBDA_TIMEOUT_MS;
const EXECUTION_LOCK_TTL_MS = LAMBDA_TIMEOUT_MS + TIMEOUT_BUFFER_MS;

function isConditionalWriteConflict(error) {
  const errorName = error?.name || '';
  const errorCode = error?.Code || error?.code || '';
  const statusCode = error?.$metadata?.httpStatusCode;
  const message = error?.message || '';

  return errorName === 'PreconditionFailed'
    || errorName === 'ConditionalCheckFailedException'
    || errorCode === 'PreconditionFailed'
    || errorCode === 'ConditionalCheckFailedException'
    || statusCode === 412
    || message.includes('PreconditionFailed');
}

function resolveRemainingTime(runtimeContext) {
  const directRemainingTime = runtimeContext?.getRemainingTimeInMillis;
  if (typeof directRemainingTime === 'function') {
    return directRemainingTime.call(runtimeContext);
  }

  const nestedRemainingTime = runtimeContext?.lambdaContext?.getRemainingTimeInMillis;
  if (typeof nestedRemainingTime === 'function') {
    return nestedRemainingTime.call(runtimeContext.lambdaContext);
  }

  return null;
}

function resolveLeaseExpiry(runtimeContext, fallbackMs, bufferMs = 0) {
  const runtimeRemaining = resolveRemainingTime(runtimeContext);
  /* c8 ignore next 2 - Branch depends on Lambda runtime context presence */
  const leaseDurationMs = Number.isFinite(runtimeRemaining)
    ? Math.max(runtimeRemaining, 0) + bufferMs
    : fallbackMs;
  return new Date(Date.now() + leaseDurationMs).toISOString();
}

function buildTimeoutStatus(startTime, runtimeContext) {
  const elapsed = Date.now() - startTime;
  const runtimeRemaining = resolveRemainingTime(runtimeContext);
  const remaining = Number.isFinite(runtimeRemaining)
    ? runtimeRemaining
    : LAMBDA_TIMEOUT_MS - elapsed;
  const safeTimeRemaining = remaining - TIMEOUT_BUFFER_MS;

  return {
    elapsed,
    remaining,
    safeTimeRemaining,
    isApproachingTimeout: safeTimeRemaining <= 0,
    percentUsed: (elapsed / LAMBDA_TIMEOUT_MS) * 100,
  };
}

async function listAllObjects({ s3Client, bucketName, prefix }) {
  const contents = [];
  let continuationToken;

  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    if (Array.isArray(response.Contents)) {
      contents.push(...response.Contents);
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return contents;
}

async function mapInBatches(items, batchSize, mapper) {
  const results = [];

  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map((item) => mapper(item)));
    results.push(...batchResults);
  }

  return results;
}

async function forEachInBatches(items, batchSize, action) {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(batch.map((item) => action(item)));
  }
}

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
      IfNoneMatch: '*',
    }));

    log.info(`[batch-state] Saved batch ${batchNum}: ${results.length} results, ${pagesProcessed} pages`);
  } catch (error) {
    /* c8 ignore next 4 - Concurrent worker already saved this batch */
    if (isConditionalWriteConflict(error)) {
      log.info(`[batch-state] Batch ${batchNum} results already saved by another worker, skipping overwrite`);
      return;
    }
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

      // Merge broken entries by URL, preserving HTTP metadata (newer entries take precedence)
      const brokenMap = new Map();
      [...currentCache.broken, ...newBroken].forEach((entry) => {
        if (typeof entry === 'string') {
          if (!brokenMap.has(entry)) brokenMap.set(entry, {});
        } else {
          brokenMap.set(entry.url, {
            httpStatus: entry.httpStatus,
            statusBucket: entry.statusBucket,
            contentType: entry.contentType,
          });
        }
      });

      const merged = {
        broken: Array.from(brokenMap.entries()).map(([url, meta]) => ({ url, ...meta })),
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

      if (currentCache.etag) {
        putParams.IfMatch = currentCache.etag;
      } else {
        putParams.IfNoneMatch = '*';
      }

      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(new PutObjectCommand(putParams));

      log.info(`[batch-state] Cache updated (attempt ${attempt + 1}): ${merged.broken.length} broken, ${merged.working.length} working`);
      return; // Success
    } catch (error) {
      if (isConditionalWriteConflict(error) && attempt < maxRetries - 1) {
        log.warn(`[batch-state] Cache conflict (attempt ${attempt + 1}), retrying with merge...`);

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

async function loadBatchClaimWithETag(auditId, batchNum, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/claims/batch-${batchNum}.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const claim = JSON.parse(body);

    return {
      claimStartedAt: claim.claimStartedAt || null,
      expiresAt: claim.expiresAt || null,
      status: claim.status || 'active',
      etag: response.ETag,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

async function loadDispatchWithETag(auditId, dispatchKey, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/dispatch/${dispatchKey}.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const dispatch = JSON.parse(body);

    return {
      data: dispatch,
      etag: response.ETag,
      key,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

async function loadExecutionLockWithETag(auditId, lockKey, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/execution-locks/${lockKey}.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const lock = JSON.parse(body);

    /* c8 ignore next 5 - Fallback coercion branches for missing lock fields */
    return {
      lockStartedAt: lock.lockStartedAt || null,
      expiresAt: lock.expiresAt || null,
      status: lock.status || 'active',
      etag: response.ETag,
      key,
    };
  /* c8 ignore next */
  } catch (error) {
    /* c8 ignore next 3 - NoSuchKey when claim deleted between conflict and load */
    if (error.name === 'NoSuchKey') return null;
    throw error;
  }
}

function isClaimReclaimable(claimData) {
  /* c8 ignore next 3 - Defensive: caller always null-checks before calling */
  if (!claimData) {
    return true;
  }

  if (claimData.status === 'released') {
    return true;
  }

  /* c8 ignore next 5 - Claim expiry branch; tested via TTL-based reclaim */
  if (claimData.expiresAt) {
    const expiresAtMs = Date.parse(claimData.expiresAt);
    if (Number.isNaN(expiresAtMs)) return true;
    return Date.now() > expiresAtMs;
  }

  const { claimStartedAt } = claimData;
  if (!claimStartedAt) {
    return true;
  }

  const startedAtMs = Date.parse(claimStartedAt);
  if (Number.isNaN(startedAtMs)) {
    return true;
  }

  return (Date.now() - startedAtMs) > BATCH_CLAIM_TTL_MS;
}

function isDispatchReservationStale(updatedAt, ttlMs = DISPATCH_RESERVATION_TTL_MS) {
  if (!updatedAt) {
    return true;
  }

  const updatedAtMs = Date.parse(updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return (Date.now() - updatedAtMs) > ttlMs;
}

function isDispatchReservationReclaimable(dispatchData, ttlMs = DISPATCH_RESERVATION_TTL_MS) {
  /* c8 ignore next */
  if (!dispatchData) return true;

  if (dispatchData.status === 'cleared') {
    return true;
  }

  return isDispatchReservationStale(dispatchData.updatedAt, ttlMs);
}

function isExecutionLockReclaimable(lockData, ttlMs = EXECUTION_LOCK_TTL_MS) {
  /* c8 ignore next */
  if (!lockData) return true;

  /* c8 ignore next */
  if (lockData.status === 'released') return true;

  /* c8 ignore start - Execution lock expiresAt and lockStartedAt fallback branches */
  if (lockData.expiresAt) {
    const expiresAtMs = Date.parse(lockData.expiresAt);
    if (Number.isNaN(expiresAtMs)) return true;
    return Date.now() > expiresAtMs;
  }

  const { lockStartedAt } = lockData;
  if (!lockStartedAt) return true;
  /* c8 ignore stop */

  const startedAtMs = Date.parse(lockStartedAt);
  /* c8 ignore next */
  if (Number.isNaN(startedAtMs)) return true;

  return (Date.now() - startedAtMs) > ttlMs;
}

/**
 * Attempt to claim a batch for processing.
 * @returns {Promise<string|null>} Claim ETag on success, null if already claimed
 */
export async function tryStartBatchProcessing(auditId, batchNum, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/claims/batch-${batchNum}.json`;
  const claimBody = JSON.stringify({
    auditId,
    batchNum,
    status: 'active',
    claimStartedAt: new Date().toISOString(),
    expiresAt: resolveLeaseExpiry(context, BATCH_CLAIM_TTL_MS),
  });

  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: claimBody,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    log.debug(`[batch-state] Claimed batch ${batchNum} for processing`);
    return response.ETag;
  } catch (error) {
    if (!isConditionalWriteConflict(error)) {
      throw error;
    }
  }

  const existingClaim = await loadBatchClaimWithETag(auditId, batchNum, context);
  if (!existingClaim) {
    return null;
  }

  if (!isClaimReclaimable(existingClaim)) {
    log.info(`[batch-state] Batch ${batchNum} already claimed by another worker`);
    return null;
  }

  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: claimBody,
      ContentType: 'application/json',
      IfMatch: existingClaim.etag,
    }));
    log.warn(`[batch-state] Reclaimed stale batch ${batchNum} claim`);
    return response.ETag;
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Lost reclaim race for batch ${batchNum}`);
      return null;
    }
    throw error;
  }
}

/**
 * Release a batch processing claim using conditional overwrite.
 * Marks the claim as "released" only if the ETag still matches (our claim
 * hasn't been reclaimed by another worker). Prevents accidentally deleting
 * another worker's active claim.
 * @param {string} auditId - The audit ID
 * @param {number} batchNum - Batch number
 * @param {string|null} claimEtag - ETag from tryStartBatchProcessing
 * @param {Object} context - Context with s3Client, env, log
 */
export async function releaseBatchProcessingClaim(auditId, batchNum, claimEtag, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/claims/batch-${batchNum}.json`;

  try {
    if (claimEtag) {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify({
          status: 'released',
          releasedAt: new Date().toISOString(),
        }),
        ContentType: 'application/json',
        IfMatch: claimEtag,
      }));
    } else {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));
    }
    log.debug(`[batch-state] Released batch ${batchNum} claim`);
  } catch (error) {
    if (isConditionalWriteConflict(error)) {
      log.info(`[batch-state] Batch ${batchNum} claim was reclaimed by another worker, skipping release`);
      return;
    }
    log.warn(`[batch-state] Failed to release batch ${batchNum} claim: ${error.message}`);
  }
}

export async function reserveWorkflowDispatch(
  auditId,
  dispatchKey,
  context,
  metadata = {},
  ttlMs = DISPATCH_RESERVATION_TTL_MS,
) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/dispatch/${dispatchKey}.json`;
  const reservationBody = JSON.stringify({
    status: 'pending',
    dispatchKey,
    updatedAt: new Date().toISOString(),
    ...metadata,
  });

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: reservationBody,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    log.debug(`[batch-state] Reserved workflow dispatch ${dispatchKey}`);
    return { acquired: true, state: 'acquired' };
  } catch (error) {
    if (!isConditionalWriteConflict(error)) {
      throw error;
    }
  }

  const existingDispatch = await loadDispatchWithETag(auditId, dispatchKey, context);
  if (!existingDispatch) {
    return { acquired: false, state: 'unknown' };
  }

  if (existingDispatch.data?.status === 'sent') {
    log.info(`[batch-state] Workflow dispatch ${dispatchKey} already sent`);
    return { acquired: false, state: 'sent' };
  }

  if (!isDispatchReservationReclaimable(existingDispatch.data, ttlMs)) {
    log.info(`[batch-state] Workflow dispatch ${dispatchKey} already reserved`);
    return { acquired: false, state: 'pending' };
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: reservationBody,
      ContentType: 'application/json',
      IfMatch: existingDispatch.etag,
    }));
    log.warn(`[batch-state] Reclaimed stale workflow dispatch ${dispatchKey}`);
    return { acquired: true, state: 'acquired' };
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Lost workflow dispatch reservation race for ${dispatchKey}`);
      return { acquired: false, state: 'pending' };
    }
    throw error;
  }
}

export async function tryAcquireExecutionLock(
  auditId,
  lockKey,
  context,
  ttlMs = EXECUTION_LOCK_TTL_MS,
) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/execution-locks/${lockKey}.json`;
  const lockBody = JSON.stringify({
    lockKey,
    status: 'active',
    lockStartedAt: new Date().toISOString(),
    expiresAt: resolveLeaseExpiry(context, EXECUTION_LOCK_TTL_MS),
  });

  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: lockBody,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    log.debug(`[batch-state] Acquired execution lock ${lockKey}`);
    return response.ETag;
  } catch (error) {
    /* c8 ignore next 2 - Non-conflict S3 errors during lock acquisition */
    if (!isConditionalWriteConflict(error)) throw error;
  }

  const existingLock = await loadExecutionLockWithETag(auditId, lockKey, context);
  /* c8 ignore next */
  if (!existingLock) return null;

  if (!isExecutionLockReclaimable(existingLock, ttlMs)) {
    log.info(`[batch-state] Execution lock ${lockKey} already held`);
    return null;
  }
  /* c8 ignore start - Stale execution lock reclaim; requires concurrent-worker timing */
  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: lockBody,
      ContentType: 'application/json',
      IfMatch: existingLock.etag,
    }));
    log.warn(`[batch-state] Reclaimed stale execution lock ${lockKey}`);
    return response.ETag;
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Lost execution lock reclaim race for ${lockKey}`);
      return null;
    }
    throw error;
  }
  /* c8 ignore stop */
}

export async function releaseExecutionLock(auditId, lockKey, lockEtag, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/execution-locks/${lockKey}.json`;

  try {
    if (lockEtag) {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify({
          status: 'released',
          releasedAt: new Date().toISOString(),
        }),
        ContentType: 'application/json',
        IfMatch: lockEtag,
      }));
    /* c8 ignore start - Execution lock release edge cases */
    } else {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));
    }
    log.debug(`[batch-state] Released execution lock ${lockKey}`);
  } catch (error) {
    if (isConditionalWriteConflict(error)) {
      log.info(`[batch-state] Execution lock ${lockKey} was reclaimed by another worker, skipping release`);
      return;
    }
    log.warn(`[batch-state] Failed to release execution lock ${lockKey}: ${error.message}`);
  }
  /* c8 ignore stop */
}

export async function markWorkflowDispatchSent(auditId, dispatchKey, context, metadata = {}) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/dispatch/${dispatchKey}.json`;

  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: JSON.stringify({
      status: 'sent',
      dispatchKey,
      updatedAt: new Date().toISOString(),
      ...metadata,
    }),
    ContentType: 'application/json',
  }));
  log.debug(`[batch-state] Marked workflow dispatch ${dispatchKey} as sent`);
}

const MARK_DISPATCH_MAX_RETRIES = 3;

/**
 * Retry-safe wrapper for markWorkflowDispatchSent.
 * Since the SQS message is already sent when this is called, callers must
 * decide whether to fail the invocation or preserve the reservation after
 * this helper throws. Silent success here reopens duplicate-dispatch races.
 */
export async function markWorkflowDispatchSentWithRetry(
  auditId,
  dispatchKey,
  context,
  metadata = {},
) {
  const { log } = context;
  for (let attempt = 1; attempt <= MARK_DISPATCH_MAX_RETRIES; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await markWorkflowDispatchSent(auditId, dispatchKey, context, metadata);
      return;
    } catch (error) {
      if (attempt < MARK_DISPATCH_MAX_RETRIES) {
        log.warn(`[batch-state] Failed to mark dispatch ${dispatchKey} as sent (attempt ${attempt}): ${error.message}, retrying...`);
        // eslint-disable-next-line no-await-in-loop
        await sleep(100 * 2 ** (attempt - 1));
      } else {
        log.error(`[batch-state] ALERT: Failed to mark dispatch ${dispatchKey} as sent after ${MARK_DISPATCH_MAX_RETRIES} attempts: ${error.message}. Duplicate delivery possible when reservation TTL (${DISPATCH_RESERVATION_TTL_MS}ms) expires.`);
        throw new Error(`Failed to mark dispatch ${dispatchKey} as sent after ${MARK_DISPATCH_MAX_RETRIES} attempts: ${error.message}`);
      }
    }
  }
  /* c8 ignore next */
}

export async function clearWorkflowDispatchReservation(auditId, dispatchKey, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/dispatch/${dispatchKey}.json`;

  try {
    const existingDispatch = await loadDispatchWithETag(auditId, dispatchKey, context);
    if (!existingDispatch || existingDispatch.data?.status === 'sent') {
      return;
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify({
        status: 'cleared',
        dispatchKey,
        updatedAt: new Date().toISOString(),
      }),
      ContentType: 'application/json',
      IfMatch: existingDispatch.etag,
    }));
    log.debug(`[batch-state] Cleared workflow dispatch reservation ${dispatchKey}`);
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Workflow dispatch reservation ${dispatchKey} was updated by another worker before clear`);
      return;
    }
    log.warn(`[batch-state] Failed to clear workflow dispatch reservation ${dispatchKey}: ${error.message}`);
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
      } else {
        putParams.IfNoneMatch = '*';
      }

      // eslint-disable-next-line no-await-in-loop
      await s3Client.send(new PutObjectCommand(putParams));
      log.debug(`[batch-state] Marked batch ${batchNum} as completed`);
      return;
    } catch (error) {
      if (isConditionalWriteConflict(error) && attempt < maxRetries - 1) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(50 * 2 ** attempt * (0.5 + Math.random()));
        // eslint-disable-next-line no-continue
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Failed to mark batch ${batchNum} as completed after ${maxRetries} attempts`);
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

  // Check timeout before loading (uses runtime remaining time when available)
  if (startTime && buildTimeoutStatus(startTime, context).isApproachingTimeout) {
    log.error('[batch-state] Approaching timeout, cannot safely load all batch results');
    throw new Error('Timeout approaching - cannot complete merge operation');
  }

  const Contents = await listAllObjects({
    s3Client,
    bucketName,
    prefix,
  });

  if (!Contents || Contents.length === 0) {
    log.info('[batch-state] No batch files found');
    return [];
  }

  log.info(`[batch-state] Loading ${Contents.length} batch files...`);

  // Load all batches in parallel. Any unreadable/corrupt batch is fatal because
  // silently merging partial results under-reports broken links.
  const batches = await mapInBatches(
    Contents,
    S3_BATCH_OPERATION_SIZE,
    async ({ Key }) => {
      if (startTime && buildTimeoutStatus(startTime, context).isApproachingTimeout) {
        throw new Error('Timeout approaching while loading batch results');
      }

      const response = await s3Client.send(new GetObjectCommand({
        Bucket: bucketName,
        Key,
      }));
      const body = await response.Body.transformToString();
      return JSON.parse(body);
    },
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
    const Contents = await listAllObjects({
      s3Client,
      bucketName,
      prefix,
    });

    if (!Contents || Contents.length === 0) {
      log.debug('[batch-state] No files to cleanup');
      return;
    }

    log.info(`[batch-state] Cleaning up ${Contents.length} files for audit ${auditId}`);

    // Delete all files in bounded batches to avoid unbounded concurrent deletes.
    await forEachInBatches(
      Contents,
      S3_BATCH_OPERATION_SIZE,
      ({ Key }) => s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key,
      })),
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
export function getTimeoutStatus(startTime, runtimeContext) {
  return buildTimeoutStatus(startTime, runtimeContext);
}

async function loadFinalizationLockWithETag(auditId, context) {
  const { s3Client, env } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/finalization-lock.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const lock = JSON.parse(body);

    return {
      acquiredAt: lock.acquiredAt || null,
      expiresAt: lock.expiresAt || null,
      status: lock.status || 'active',
      etag: response.ETag,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    /* c8 ignore next 2 - Defensive: non-NoSuchKey S3 errors during lock load */
    throw error;
  }
}

function isFinalizationLockReclaimable(lockData) {
  /* c8 ignore next 2 - Defensive guards; callers always provide lockData */
  if (!lockData) return true;
  if (lockData.status === 'released') return true;

  if (lockData.expiresAt) {
    const expiresAtMs = Date.parse(lockData.expiresAt);
    /* c8 ignore next */
    if (Number.isNaN(expiresAtMs)) return true;
    return Date.now() > expiresAtMs;
  }

  const { acquiredAt } = lockData;
  if (!acquiredAt) return true;
  const acquiredAtMs = Date.parse(acquiredAt);
  if (Number.isNaN(acquiredAtMs)) return true;
  return (Date.now() - acquiredAtMs) > FINALIZATION_LOCK_TTL_MS;
}

/**
 * Acquire an exclusive finalization lock using S3 conditional writes.
 * Prevents duplicate finalization when multiple Lambda invocations
 * reach this point concurrently (e.g., via SQS at-least-once delivery).
 * Includes TTL-based stale lock reclaim to prevent permanent deadlocks
 * if the lock holder crashes before completing finalization.
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<string|null>} Lock ETag if acquired, null if already held
 */
export async function tryAcquireFinalizationLock(auditId, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/finalization-lock.json`;
  const lockBody = JSON.stringify({
    acquiredAt: new Date().toISOString(),
    expiresAt: resolveLeaseExpiry(context, FINALIZATION_LOCK_TTL_MS),
    auditId,
  });

  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: lockBody,
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    log.info(`[batch-state] Acquired finalization lock for audit ${auditId}`);
    return response.ETag ?? '"finalization-lock"';
  } catch (error) {
    if (!isConditionalWriteConflict(error)) {
      throw error;
    }
  }

  const existingLock = await loadFinalizationLockWithETag(auditId, context);
  if (!existingLock) {
    return null;
  }

  if (!isFinalizationLockReclaimable(existingLock)) {
    log.info(`[batch-state] Finalization lock already held for audit ${auditId}`);
    return null;
  }

  try {
    const response = await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: lockBody,
      ContentType: 'application/json',
      IfMatch: existingLock.etag,
    }));
    log.warn(`[batch-state] Reclaimed stale finalization lock for audit ${auditId}`);
    /* c8 ignore next - fallback coercion branch */
    return response.ETag ?? existingLock.etag;
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Lost finalization lock reclaim race for audit ${auditId}`);
      return null;
    }
    throw error;
  }
}

export async function releaseFinalizationLock(auditId, lockEtag, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/finalization-lock.json`;

  try {
    if (lockEtag) {
      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: JSON.stringify({
          status: 'released',
          releasedAt: new Date().toISOString(),
        }),
        ContentType: 'application/json',
        IfMatch: lockEtag,
      }));
    } else {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      }));
    }
    log.info(`[batch-state] Released finalization lock for audit ${auditId}`);
  } catch (error) {
    if (isConditionalWriteConflict(error) || error.name === 'NoSuchKey') {
      log.info(`[batch-state] Finalization lock for audit ${auditId} was already cleared or reclaimed, skipping release`);
      return;
    }
    log.warn(`[batch-state] Failed to release finalization lock for audit ${auditId}: ${error.message}`);
  }
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

/**
 * Persist scrapeResultPaths to S3 so continuation Lambdas can reconstruct them.
 * Called once on the initial invocation (batchStartIndex === 0).
 * @param {string} auditId - The audit ID
 * @param {Map<string,string>} scrapeResultPaths - URL → S3 key mapping
 * @param {Object} context - Context with s3Client, env, log
 */
export async function saveScrapeResultPaths(auditId, scrapeResultPaths, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/scrape-result-paths.json`;
  const entries = Array.from(scrapeResultPaths.entries());

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(entries),
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
    log.info(`[batch-state] Saved ${entries.length} scrape result paths for audit ${auditId}`);
    return true;
  } catch (error) {
    if (isConditionalWriteConflict(error)) {
      log.info(`[batch-state] Scrape result paths already exist for audit ${auditId}, preserving existing manifest`);
      return false;
    }
    log.error(`[batch-state] Failed to save scrape result paths: ${error.message}`);
    throw error;
  }
}

/**
 * Load scrapeResultPaths from S3 on continuation Lambdas.
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<Map<string,string>>} Reconstructed URL → S3 key mapping
 */
export async function loadScrapeResultPaths(auditId, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = `${BATCH_STATE_PREFIX}/${auditId}/scrape-result-paths.json`;

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const entries = JSON.parse(body);
    const map = new Map(entries);
    log.info(`[batch-state] Loaded ${map.size} scrape result paths for audit ${auditId}`);
    return map;
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      log.warn(`[batch-state] No scrape result paths found for audit ${auditId}`);
      return new Map();
    }
    log.error(`[batch-state] Failed to load scrape result paths: ${error.message}`);
    throw error;
  }
}

// Export constants for use in handler
export const BATCH_TIMEOUT_CONFIG = {
  LAMBDA_TIMEOUT_MS,
  TIMEOUT_BUFFER_MS,
  SAFE_PROCESSING_TIME_MS,
  BATCH_CLAIM_TTL_MS,
  DISPATCH_RESERVATION_TTL_MS,
  FINALIZATION_LOCK_TTL_MS,
  EXECUTION_LOCK_TTL_MS,
};
