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

/**
 * Brand Data Enrichment Handler
 *
 * Reads the LLMO config for a site, flattens all prompts from topics and aiTopics,
 * enriches every prompt with a relatedUrl via ContentAI's promptToLinks,
 * then writes the enriched config back via llmoConfig.writeConfig.
 *
 * Uses SQS self-continuation pattern to handle long-running batch operations.
 *
 * Safeguards:
 * - Timeout: writes partial config (partial enrichment is better than nothing)
 * - Conflict: aborts if another audit took over
 * - Error: does NOT write config on unexpected errors
 * - Lock release: releases enrichment lock on completion/timeout/error
 */

import { ok, notFound, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { llmoConfig } from '@adobe/spacecat-shared-utils';
import { randomUUID } from 'node:crypto';
import {
  URL_ENRICHMENT_BATCH_SIZE,
  BRAND_DATA_ENRICHMENT_TYPE,
  flattenConfigPrompts,
  acquireEnrichmentLock,
  saveEnrichmentMetadata,
  loadEnrichmentMetadata,
  saveEnrichmentConfig,
  loadEnrichmentConfig,
  processJsonEnrichmentBatch,
  isEnrichmentTimedOut,
  checkEnrichmentConflict,
  releaseEnrichmentLock,
} from './util.js';

const LOCK_ID = 'brand-data-enrichment';

/**
 * Handles brand data enrichment for LLMO config prompts.
 * Processes prompts in batches and uses SQS self-continuation for long operations.
 *
 * @param {Object} message - SQS message with siteId, optional auditId, batchStart
 * @param {Object} context - Universal context with dataAccess, sqs, s3Client, etc.
 * @returns {Promise<Object>} HTTP response
 */
export default async function handleBrandDataEnrichment(message, context) {
  const { log } = context;

  const {
    dataAccess, sqs, s3Client, env,
  } = context;

  if (!s3Client || !env || !sqs || !dataAccess) {
    log.error(
      '%s: Missing required context properties (s3Client: %s, env: %s, sqs: %s, dataAccess: %s)',
      BRAND_DATA_ENRICHMENT_TYPE,
      !!s3Client,
      !!env,
      !!sqs,
      !!dataAccess,
    );
    return internalServerError('Missing required context properties');
  }

  const { Site } = dataAccess;
  const { siteId, batchStart = 0 } = message;
  let { auditId } = message;
  const bucket = env.S3_IMPORTER_BUCKET_NAME;

  let metadata = null;

  try {
    const site = await Site.findById(siteId);
    if (!site) {
      log.error('%s: Site not found for siteId: %s', BRAND_DATA_ENRICHMENT_TYPE, siteId);
      return notFound('Site not found');
    }

    // --- First invocation ---
    if (batchStart === 0) {
      auditId = auditId || randomUUID();

      const { config } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });
      const flatPrompts = flattenConfigPrompts(config);

      if (flatPrompts.length === 0) {
        log.info('%s: No prompts found in config for siteId: %s, skipping', BRAND_DATA_ENRICHMENT_TYPE, siteId);
        return ok({ status: 'skipped', reason: 'no-prompts' });
      }

      const lockResult = await acquireEnrichmentLock(
        s3Client,
        bucket,
        siteId,
        LOCK_ID,
        auditId,
        log,
      );

      if (!lockResult.acquired) {
        log.info('%s: Lock not acquired for siteId: %s, skipping', BRAND_DATA_ENRICHMENT_TYPE, siteId);
        return ok({ status: 'skipped', reason: 'lock-not-acquired' });
      }

      const totalPrompts = flatPrompts.length;
      metadata = {
        auditId,
        siteId,
        lockId: LOCK_ID,
        totalPrompts,
        createdAt: new Date().toISOString(),
      };

      await saveEnrichmentMetadata(s3Client, bucket, metadata);
      await saveEnrichmentConfig(s3Client, bucket, auditId, config);

      const allIndices = Array.from({ length: totalPrompts }, (_, i) => i);
      const batchEnd = Math.min(URL_ENRICHMENT_BATCH_SIZE, totalPrompts);
      const batchIndices = allIndices.slice(0, batchEnd);

      log.info(
        '%s: Starting enrichment for siteId: %s, auditId: %s, totalPrompts: %d',
        BRAND_DATA_ENRICHMENT_TYPE,
        siteId,
        auditId,
        totalPrompts,
      );

      const enrichedCount = await processJsonEnrichmentBatch(
        flatPrompts,
        batchIndices,
        site,
        context,
        log,
      );

      // Save config (flatPrompts mutated by reference → config is updated)
      await saveEnrichmentConfig(s3Client, bucket, auditId, config);

      log.info(
        '%s: Batch 1 complete - enriched %d/%d prompts for auditId: %s',
        BRAND_DATA_ENRICHMENT_TYPE,
        enrichedCount,
        batchIndices.length,
        auditId,
      );

      const remaining = totalPrompts - batchEnd;

      if (remaining > 0) {
        const { Configuration } = dataAccess;
        const configuration = await Configuration.findLatest();
        const auditQueue = configuration.getQueues().audits;

        await sqs.sendMessage(auditQueue, {
          type: BRAND_DATA_ENRICHMENT_TYPE,
          siteId,
          auditId,
          batchStart: batchEnd,
        });

        return ok({
          status: 'processing',
          remaining,
        });
      }

      // All done in a single batch
      const finalConflictCheck = await checkEnrichmentConflict(
        s3Client,
        bucket,
        siteId,
        LOCK_ID,
        auditId,
      );

      if (finalConflictCheck.hasConflict) {
        log.warn('%s: Final conflict detected for auditId: %s', BRAND_DATA_ENRICHMENT_TYPE, auditId);
        return ok({ status: 'aborted', reason: finalConflictCheck.reason });
      }

      await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket: bucket });
      await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);

      log.info(
        '%s: Completed enrichment for auditId: %s, totalPrompts: %d, enrichedCount: %d',
        BRAND_DATA_ENRICHMENT_TYPE,
        auditId,
        totalPrompts,
        enrichedCount,
      );

      return ok({
        status: 'completed',
        totalPrompts,
        enrichedCount,
      });
    }

    // --- Continuation (batchStart > 0) ---
    log.info(
      '%s: Continuation batch at %d for auditId: %s, siteId: %s',
      BRAND_DATA_ENRICHMENT_TYPE,
      batchStart,
      auditId,
      siteId,
    );

    metadata = await loadEnrichmentMetadata(s3Client, bucket, auditId);

    if (!metadata) {
      log.error('%s: Metadata not found for auditId: %s', BRAND_DATA_ENRICHMENT_TYPE, auditId);
      return notFound('Enrichment metadata not found');
    }

    if (isEnrichmentTimedOut(metadata)) {
      log.warn(
        '%s: Enrichment timed out for auditId: %s (started: %s)',
        BRAND_DATA_ENRICHMENT_TYPE,
        auditId,
        metadata.createdAt,
      );

      const config = await loadEnrichmentConfig(s3Client, bucket, auditId);
      await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket: bucket });
      await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);

      return ok({ status: 'timeout' });
    }

    const conflictCheck = await checkEnrichmentConflict(
      s3Client,
      bucket,
      siteId,
      LOCK_ID,
      auditId,
    );

    if (conflictCheck.hasConflict) {
      log.warn(
        '%s: Conflict detected for auditId: %s - reason: %s',
        BRAND_DATA_ENRICHMENT_TYPE,
        auditId,
        conflictCheck.reason,
      );
      return ok({ status: 'aborted', reason: conflictCheck.reason });
    }

    const config = await loadEnrichmentConfig(s3Client, bucket, auditId);
    const flatPrompts = flattenConfigPrompts(config);
    const { totalPrompts } = metadata;

    const batchEnd = Math.min(batchStart + URL_ENRICHMENT_BATCH_SIZE, totalPrompts);
    const batchIndices = Array.from(
      { length: batchEnd - batchStart },
      (_, i) => batchStart + i,
    );

    const enrichedCount = await processJsonEnrichmentBatch(
      flatPrompts,
      batchIndices,
      site,
      context,
      log,
    );

    await saveEnrichmentConfig(s3Client, bucket, auditId, config);

    log.info(
      '%s: Batch complete - enriched %d/%d prompts for auditId: %s',
      BRAND_DATA_ENRICHMENT_TYPE,
      enrichedCount,
      batchIndices.length,
      auditId,
    );

    const remaining = totalPrompts - batchEnd;

    if (remaining > 0) {
      const { Configuration } = dataAccess;
      const configuration = await Configuration.findLatest();
      const auditQueue = configuration.getQueues().audits;

      await sqs.sendMessage(auditQueue, {
        type: BRAND_DATA_ENRICHMENT_TYPE,
        siteId,
        auditId,
        batchStart: batchEnd,
      });

      return ok({
        status: 'processing',
        remaining,
      });
    }

    // --- Completion ---
    const finalConflictCheck = await checkEnrichmentConflict(
      s3Client,
      bucket,
      siteId,
      LOCK_ID,
      auditId,
    );

    if (finalConflictCheck.hasConflict) {
      log.warn('%s: Final conflict detected for auditId: %s', BRAND_DATA_ENRICHMENT_TYPE, auditId);
      return ok({ status: 'aborted', reason: finalConflictCheck.reason });
    }

    await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket: bucket });
    await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);

    log.info(
      '%s: Completed enrichment for auditId: %s, totalPrompts: %d',
      BRAND_DATA_ENRICHMENT_TYPE,
      auditId,
      totalPrompts,
    );

    return ok({
      status: 'completed',
      totalPrompts,
      enrichedCount,
    });
  } catch (error) {
    log.error(
      '%s: Error during enrichment for auditId: %s: %s',
      BRAND_DATA_ENRICHMENT_TYPE,
      auditId,
      error.message,
    );

    if (metadata) {
      await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);
    }

    return internalServerError(error.message);
  }
}
