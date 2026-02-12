/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
/* eslint-disable no-use-before-define */
/* c8 ignore start */

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { ContentAIClient } from '../utils/content-ai.js';

export { transformWebSearchProviderForMystique } from '../geo-brand-presence/util.js';

/**
 * @import {S3Client} from '@aws-sdk/client-s3';
 */

/**
 * Gets the URLs by prompt from Content AI
 * @param {string} prompt - The prompt to search
 * @param {Object} site - The site object
 * @param {Object} context - The context object
 * @param {ContentAIClient} [contentAIClient] - Optional pre-initialized client for reuse
 * @returns {Promise<string[]>} The URLs
 */
// eslint-disable-next-line no-unused-vars
export async function promptToLinks(prompt, site, context, contentAIClient = null) {
  let client = contentAIClient;
  if (!client) {
    client = new ContentAIClient(context);
    await client.initialize();
  }
  const response = await client.runGenerativeSearch(prompt, site);
  if (response.status !== 200) {
    throw new Error(`Error calling ContentAI - ${response.statusText}`);
  }
  const res = await response.json();
  return res?.data?.urls || [];
}

export const URL_ENRICHMENT_BATCH_SIZE = 10;
export const BRAND_DATA_ENRICHMENT_TYPE = 'enrich:brand-data';
export const ENRICHMENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const ENRICHMENT_LOCK_PREFIX = 'temp/url-enrichment-locks';

/**
 * Gets the S3 key for the enrichment lock file.
 * Lock is keyed by siteId + lockId to prevent concurrent enrichments.
 * @param {string} siteId - The site ID
 * @param {string} lockId - A unique identifier for the enrichment (e.g., week-year)
 * @returns {string} The S3 key for the lock file
 */
export function enrichmentLockS3Key(siteId, lockId) {
  const safeLockId = lockId.replace(/[^a-zA-Z0-9-_.]/g, '_');
  return `${ENRICHMENT_LOCK_PREFIX}/${siteId}/${safeLockId}.lock.json`;
}

/**
 * Attempts to acquire an enrichment lock for a site.
 * Returns lock info if acquired, null if already locked by another audit.
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket
 * @param {string} siteId - The site ID
 * @param {string} lockId - Unique lock identifier (e.g., week-year)
 * @param {string} auditId - The current audit ID
 * @param {Object} log - Logger instance
 * @returns {Promise<{acquired: boolean, existingLock?: Object}>}
 */
export async function acquireEnrichmentLock(s3Client, bucket, siteId, lockId, auditId, log) {
  const lockKey = enrichmentLockS3Key(siteId, lockId);

  try {
    // Check if lock exists
    const existingLock = await loadEnrichmentLock(s3Client, bucket, siteId, lockId);

    if (existingLock) {
      const lockAge = Date.now() - new Date(existingLock.startedAt).getTime();
      const isExpired = lockAge > ENRICHMENT_TIMEOUT_MS;

      if (!isExpired) {
        log.info(
          'Enrichment lock exists for %s/%s (auditId: %s, age: %dms), skipping',
          siteId,
          lockId,
          existingLock.auditId,
          lockAge,
        );
        return { acquired: false, existingLock };
      }

      log.warn(
        'Enrichment lock expired for %s/%s (auditId: %s, age: %dms), taking over',
        siteId,
        lockId,
        existingLock.auditId,
        lockAge,
      );
    }

    // Create/overwrite lock
    const lockData = {
      auditId,
      siteId,
      lockId,
      startedAt: new Date().toISOString(),
    };

    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: lockKey,
      Body: JSON.stringify(lockData, null, 2),
      ContentType: 'application/json',
    }));

    log.info('Enrichment lock acquired for %s/%s (auditId: %s)', siteId, lockId, auditId);
    return { acquired: true };
  } catch (error) {
    log.error('Failed to acquire enrichment lock for %s/%s: %s', siteId, lockId, error.message);
    return { acquired: false };
  }
}

/**
 * Loads an existing enrichment lock from S3.
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket
 * @param {string} siteId - The site ID
 * @param {string} lockId - Unique lock identifier
 * @returns {Promise<Object|null>} The lock data or null if not found
 */
export async function loadEnrichmentLock(s3Client, bucket, siteId, lockId) {
  const lockKey = enrichmentLockS3Key(siteId, lockId);

  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: lockKey,
    }));
    const text = await result.Body?.transformToString() ?? '{}';
    return JSON.parse(text);
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Releases an enrichment lock by deleting the lock file.
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket
 * @param {string} siteId - The site ID
 * @param {string} lockId - Unique lock identifier
 * @param {Object} log - Logger instance
 */
export async function releaseEnrichmentLock(s3Client, bucket, siteId, lockId, log) {
  const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const lockKey = enrichmentLockS3Key(siteId, lockId);

  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: lockKey,
    }));
    log.info('Enrichment lock released for %s/%s', siteId, lockId);
  } catch (error) {
    log.warn('Failed to release enrichment lock for %s/%s: %s', siteId, lockId, error.message);
  }
}

/**
 * Checks if enrichment has exceeded the timeout.
 * @param {Object} metadata - The enrichment metadata
 * @returns {boolean} True if enrichment has timed out
 */
export function isEnrichmentTimedOut(metadata) {
  if (!metadata?.createdAt) return false;
  const elapsed = Date.now() - new Date(metadata.createdAt).getTime();
  return elapsed > ENRICHMENT_TIMEOUT_MS;
}

/**
 * Checks if a newer audit has started since enrichment began.
 * Used to detect if we should skip uploading stale data.
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket
 * @param {string} siteId - The site ID
 * @param {string} lockId - Unique lock identifier
 * @param {string} currentAuditId - The current audit's ID
 * @returns {Promise<{hasConflict: boolean, newerAuditId?: string}>}
 */
export async function checkEnrichmentConflict(s3Client, bucket, siteId, lockId, currentAuditId) {
  const lock = await loadEnrichmentLock(s3Client, bucket, siteId, lockId);

  if (!lock) {
    // Lock was released or doesn't exist - possible conflict
    return { hasConflict: true, reason: 'lock-missing' };
  }

  if (lock.auditId !== currentAuditId) {
    // Another audit took over the lock
    return { hasConflict: true, newerAuditId: lock.auditId, reason: 'lock-stolen' };
  }

  return { hasConflict: false };
}

/**
 * Gets the S3 key for URL enrichment directory
 * @param {string} auditId - The audit ID
 * @returns {string} The S3 directory key
 */
export function urlEnrichmentDirectoryS3Key(auditId) {
  return `temp/url-enrichment/${auditId}`;
}

/**
 * Gets the S3 key for URL enrichment metadata file
 * @param {string} auditId - The audit ID
 * @returns {string} The S3 key for metadata.json
 */
export function urlEnrichmentMetadataS3Key(auditId) {
  return `${urlEnrichmentDirectoryS3Key(auditId)}/metadata.json`;
}

/**
 * Gets the S3 key for the JSON prompts file being enriched
 * @param {string} auditId - The audit ID
 * @returns {string} The S3 key for the JSON file
 */
export function urlEnrichmentJsonS3Key(auditId) {
  return `${urlEnrichmentDirectoryS3Key(auditId)}/prompts.json`;
}

/**
 * Checks which prompts in the array need URL enrichment.
 * A prompt needs enrichment if it has a 'prompt' field but no 'url' (or empty).
 * The 'url' field comes from parquet/Ahrefs data for AI prompts, or is empty for human prompts.
 * When enrichment is needed, promptToLinks will be called to generate a 'relatedUrl'.
 * @param {Array<Object>} prompts - Array of prompt objects
 * @returns {{ needsEnrichment: boolean, indicesToEnrich: number[] }}
 */
export function checkJsonEnrichmentNeeded(prompts) {
  const indicesToEnrich = [];

  for (let i = 0; i < prompts.length; i += 1) {
    const prompt = prompts[i];
    const hasPrompt = prompt.prompt && prompt.prompt.trim() !== '';
    const hasUrl = prompt.url && prompt.url.trim() !== '';

    if (hasPrompt && !hasUrl) {
      indicesToEnrich.push(i);
    }
  }

  return {
    needsEnrichment: indicesToEnrich.length > 0,
    indicesToEnrich,
  };
}

/**
 * Saves URL enrichment metadata to S3
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket name
 * @param {Object} metadata - The metadata object to save
 * @returns {Promise<void>}
 */
export async function saveEnrichmentMetadata(s3Client, bucket, metadata) {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: urlEnrichmentMetadataS3Key(metadata.auditId),
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json',
  }));
}

/**
 * Loads URL enrichment metadata from S3
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket name
 * @param {string} auditId - The audit ID
 * @returns {Promise<Object>} The metadata object
 */
export async function loadEnrichmentMetadata(s3Client, bucket, auditId) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: urlEnrichmentMetadataS3Key(auditId),
  }));

  const text = await result.Body?.transformToString() ?? '{}';
  return JSON.parse(text);
}

/**
 * Saves JSON prompts to S3 for enrichment processing
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket name
 * @param {string} auditId - The audit ID
 * @param {Array<Object>} prompts - Array of prompt objects
 * @returns {Promise<void>}
 */
export async function saveEnrichmentJson(s3Client, bucket, auditId, prompts) {
  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: urlEnrichmentJsonS3Key(auditId),
    Body: JSON.stringify(prompts),
    ContentType: 'application/json',
  }));
}

/**
 * Loads JSON prompts from S3 for enrichment processing
 * @param {S3Client} s3Client - The S3 client
 * @param {string} bucket - The S3 bucket name
 * @param {string} auditId - The audit ID
 * @returns {Promise<Array<Object>>} Array of prompt objects
 */
export async function loadEnrichmentJson(s3Client, bucket, auditId) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: urlEnrichmentJsonS3Key(auditId),
  }));

  const text = await result.Body?.transformToString() ?? '[]';
  return JSON.parse(text);
}

/**
 * Enriches a single prompt object with a Related URL using promptToLinks
 * @param {Object} prompt - The prompt object (will be mutated)
 * @param {number} index - The index in the original array
 * @param {Object} site - The site object
 * @param {Object} context - The context object
 * @param {Object} log - Logger instance
 * @param {ContentAIClient} contentAIClient - Pre-initialized ContentAI client for reuse
 * @returns {Promise<boolean>} True if enriched successfully
 */
async function enrichPromptWithRelatedUrl(prompt, index, site, context, log, contentAIClient) {
  const promptText = prompt.prompt?.trim() || '';

  if (!promptText) {
    return false;
  }

  try {
    const urls = await promptToLinks(promptText, site, context, contentAIClient);
    if (urls && urls.length > 0) {
      const [firstUrl] = urls;
      // first returned URL is the most relevant
      // being its content the one semantically
      // closest to the input prompt
      // eslint-disable-next-line no-param-reassign
      prompt.relatedUrl = firstUrl;
      return true;
    }
  } catch (error) {
    log.debug(
      'GEO BRAND PRESENCE JSON ENRICHMENT: Failed to enrich prompt at index %d: %s',
      index,
      error.message,
    );
  }
  return false;
}

/**
 * Processes a batch of prompts for URL enrichment (concurrent within batch)
 * @param {Array<Object>} prompts - Full array of prompt objects
 * @param {number[]} indicesToProcess - Array of indices to process in this batch
 * @param {Object} site - The site object
 * @param {Object} context - The context object
 * @param {Object} log - Logger instance
 * @returns {Promise<number>} Number of successfully enriched prompts
 */
export async function processJsonEnrichmentBatch(
  prompts,
  indicesToProcess,
  site,
  context,
  log,
) {
  // Create and initialize ContentAI client ONCE for the entire batch
  const contentAIClient = new ContentAIClient(context);
  await contentAIClient.initialize();

  const results = await Promise.all(
    indicesToProcess.map((index) => enrichPromptWithRelatedUrl(
      prompts[index],
      index,
      site,
      context,
      log,
      contentAIClient,
    )),
  );

  return results.filter(Boolean).length;
}
