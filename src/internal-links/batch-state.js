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

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const BATCH_STATE_PREFIX = 'broken-internal-links/batch-state';

/**
 * Generates the S3 key for the single accumulated state file
 * @param {string} auditId - The audit ID
 * @returns {string} S3 key
 */
export function getBatchStateKey(auditId) {
  return `${BATCH_STATE_PREFIX}/${auditId}/state.json`;
}

/**
 * Loads the current batch state from S3
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<Object>} Current state or default empty state
 */
export async function loadBatchState(auditId, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = getBatchStateKey(auditId);

  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    const body = await response.Body.transformToString();
    const state = JSON.parse(body);
    log.debug(`[broken-internal-links-batch] Loaded existing state: ${state.results?.length || 0} results, batch ${state.lastBatchNum || 0}`);
    // Normalize state to ensure arrays are always present
    return {
      results: state.results ?? [],
      brokenUrlsCache: state.brokenUrlsCache ?? [],
      workingUrlsCache: state.workingUrlsCache ?? [],
      lastBatchNum: state.lastBatchNum ?? -1,
      totalPagesProcessed: state.totalPagesProcessed ?? 0,
    };
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      log.debug('[broken-internal-links-batch] No existing state found, starting fresh');
      return {
        results: [],
        brokenUrlsCache: [],
        workingUrlsCache: [],
        lastBatchNum: -1,
        totalPagesProcessed: 0,
      };
    }
    log.error(`[broken-internal-links-batch] Failed to load state from S3: ${error.message}`);
    throw error;
  }
}

/**
 * Saves the accumulated batch state to S3 (single file approach)
 * @param {Object} params - Parameters
 * @param {string} params.auditId - The audit ID
 * @param {Array} params.results - All accumulated broken links
 * @param {Array} params.brokenUrlsCache - All known broken URLs
 * @param {Array} params.workingUrlsCache - All known working URLs
 * @param {number} params.batchNum - Current batch number
 * @param {number} params.totalPagesProcessed - Total pages processed so far
 * @param {Object} context - Context with s3Client, env, log
 */
export async function saveBatchState({
  auditId,
  results,
  brokenUrlsCache,
  workingUrlsCache,
  batchNum,
  totalPagesProcessed,
}, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = getBatchStateKey(auditId);

  const stateData = {
    lastBatchNum: batchNum,
    totalPagesProcessed,
    timestamp: new Date().toISOString(),
    resultsCount: results.length,
    results,
    brokenUrlsCache,
    workingUrlsCache,
  };

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(stateData),
      ContentType: 'application/json',
    }));
    log.info(`[broken-internal-links-batch] Saved state: batch ${batchNum}, ${results.length} results, caches: ${brokenUrlsCache.length} broken, ${workingUrlsCache.length} working`);
  } catch (error) {
    log.error(`[broken-internal-links-batch] Failed to save state to S3: ${error.message}`);
    throw error;
  }
}

/**
 * Loads final results from S3 (called at merge step)
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 * @returns {Promise<Array>} Array of all broken links
 */
export async function loadFinalResults(auditId, context) {
  const { log } = context;
  const state = await loadBatchState(auditId, context);
  log.info(`[broken-internal-links-batch] Loaded final results: ${state.results.length} broken links from ${state.lastBatchNum + 1} batches`);
  return state.results;
}

/**
 * Cleans up batch state file from S3 after audit completion
 * @param {string} auditId - The audit ID
 * @param {Object} context - Context with s3Client, env, log
 */
export async function cleanupBatchState(auditId, context) {
  const { s3Client, env, log } = context;
  const bucketName = env.S3_SCRAPER_BUCKET_NAME;
  const key = getBatchStateKey(auditId);

  log.info(`[broken-internal-links-batch] Cleaning up state file for audit ${auditId}`);

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    log.info(`[broken-internal-links-batch] Cleanup complete for audit ${auditId}`);
  } catch (error) {
    // Log but don't throw - file might not exist or already deleted
    log.warn(`[broken-internal-links-batch] Failed to delete state file: ${error.message}`);
  }
}

/**
 * Estimates SQS message size for cache data
 * @param {Array} brokenUrls - Array of broken URLs
 * @param {Array} workingUrls - Array of working URLs
 * @returns {number} Estimated size in bytes
 */
export function estimateCacheSize(brokenUrls, workingUrls) {
  const brokenSize = JSON.stringify(brokenUrls).length;
  const workingSize = JSON.stringify(workingUrls).length;
  return brokenSize + workingSize;
}

/**
 * SQS message size limit (256KB with some buffer for other message content)
 */
export const SQS_CACHE_SIZE_LIMIT = 200 * 1024; // 200KB to leave room for other message data
