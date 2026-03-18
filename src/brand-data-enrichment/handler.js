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
 * enriches every prompt with relatedUrls via ContentAI's promptToLinks,
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
import { validateContentAI } from '../faqs/utils.js';
import {
  URL_ENRICHMENT_BATCH_SIZE,
  BATCHES_PER_INVOCATION,
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
    log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: Missing required context properties (s3Client: ${!!s3Client}, env: ${!!env}, sqs: ${!!sqs}, dataAccess: ${!!dataAccess})`);
    return internalServerError('Missing required context properties');
  }

  const { Site } = dataAccess;
  const { siteId, batchStart = 0, indexName: indexNameFromMessage } = message;
  let { auditId } = message;
  const bucket = env.S3_IMPORTER_BUCKET_NAME;

  let metadata = null;

  try {
    const site = await Site.findById(siteId);
    if (!site) {
      log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: Site not found for siteId: ${siteId}`);
      return notFound('Site not found');
    }

    // --- First invocation ---
    if (batchStart === 0) {
      const invocationStartTime = Date.now();
      auditId = auditId || randomUUID();

      const { config } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });
      const flatPrompts = flattenConfigPrompts(config);

      if (flatPrompts.length === 0) {
        log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: No prompts found in config for siteId: ${siteId}, skipping`);
        return ok({ status: 'skipped', reason: 'no-prompts' });
      }

      // Validate ContentAI configuration and get indexName
      const validation = await validateContentAI(site, context);
      if (!validation.isWorking || !validation.indexName) {
        log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: ContentAI is not working or index not found for siteId: ${siteId}`);
        return ok({ status: 'skipped', reason: 'contentai-not-working' });
      }

      const { indexName } = validation;
      log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Using ContentAI index: ${indexName}`);

      const lockResult = await acquireEnrichmentLock(
        s3Client,
        bucket,
        siteId,
        LOCK_ID,
        auditId,
        log,
      );

      if (!lockResult.acquired) {
        log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Lock not acquired for siteId: ${siteId}, skipping`);
        return ok({ status: 'skipped', reason: 'lock-not-acquired' });
      }

      const totalPrompts = flatPrompts.length;
      metadata = {
        auditId,
        siteId,
        lockId: LOCK_ID,
        totalPrompts,
        indexName,
        createdAt: new Date().toISOString(),
      };

      await saveEnrichmentMetadata(s3Client, bucket, metadata);
      await saveEnrichmentConfig(s3Client, bucket, auditId, config);

      log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Starting enrichment for siteId: ${siteId}, auditId: ${auditId}, totalPrompts: ${totalPrompts}`);

      // Process multiple batches sequentially per invocation
      let currentPromptIndex = 0;
      let totalEnrichedCount = 0;
      let batchNumber = 0;

      const maxPromptsThisInvocation = Math.min(
        BATCHES_PER_INVOCATION * URL_ENRICHMENT_BATCH_SIZE,
        totalPrompts,
      );

      // eslint-disable-next-line no-await-in-loop
      while (currentPromptIndex < maxPromptsThisInvocation) {
        batchNumber += 1;
        const batchStartTime = Date.now();

        const batchEnd = Math.min(
          currentPromptIndex + URL_ENRICHMENT_BATCH_SIZE,
          totalPrompts,
        );
        const batchSize = batchEnd - currentPromptIndex;
        const batchIndices = [];
        for (let i = 0; i < batchSize; i += 1) {
          batchIndices.push(currentPromptIndex + i);
        }

        // eslint-disable-next-line no-await-in-loop
        const enrichedCount = await processJsonEnrichmentBatch(
          flatPrompts,
          batchIndices,
          site,
          context,
          log,
          indexName,
        );

        totalEnrichedCount += enrichedCount;
        const batchDuration = Date.now() - batchStartTime;

        log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Batch ${batchNumber} complete - enriched ${enrichedCount}/${batchIndices.length} prompts (took ${batchDuration}ms)`);

        currentPromptIndex = batchEnd;

        // Save config periodically (every 10 batches or at end)
        if (batchNumber % 10 === 0 || currentPromptIndex >= maxPromptsThisInvocation) {
          // eslint-disable-next-line no-await-in-loop
          await saveEnrichmentConfig(s3Client, bucket, auditId, config);
        }
      }

      const invocationDuration = Date.now() - invocationStartTime;
      log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Invocation complete - processed ${batchNumber} batches (${currentPromptIndex} prompts) in ${invocationDuration}ms (${Math.round(invocationDuration / 1000)}s)`);

      const remaining = totalPrompts - currentPromptIndex;

      if (remaining > 0) {
        const { Configuration } = dataAccess;
        const configuration = await Configuration.findLatest();
        const auditQueue = configuration.getQueues().audits;

        await sqs.sendMessage(auditQueue, {
          type: BRAND_DATA_ENRICHMENT_TYPE,
          siteId,
          auditId,
          batchStart: currentPromptIndex,
          indexName,
        });

        return ok({
          status: 'processing',
          remaining,
          processedPrompts: currentPromptIndex,
        });
      }

      // All done - no more prompts remaining
      const finalConflictCheck = await checkEnrichmentConflict(
        s3Client,
        bucket,
        siteId,
        LOCK_ID,
        auditId,
      );

      if (finalConflictCheck.hasConflict) {
        log.warn(`${BRAND_DATA_ENRICHMENT_TYPE}: Final conflict detected for auditId: ${auditId}`);
        return ok({ status: 'aborted', reason: finalConflictCheck.reason });
      }

      await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket: bucket });
      await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);

      log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Completed enrichment for auditId: ${auditId}, totalPrompts: ${totalPrompts}, enrichedCount: ${totalEnrichedCount}`);

      return ok({
        status: 'completed',
        totalPrompts,
        enrichedCount: totalEnrichedCount,
      });
    }

    // --- Continuation (batchStart > 0) ---
    const invocationStartTime = Date.now();

    log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Continuation starting at prompt ${batchStart} for auditId: ${auditId}, siteId: ${siteId}`);

    metadata = await loadEnrichmentMetadata(s3Client, bucket, auditId);

    if (!metadata) {
      log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: Metadata not found for auditId: ${auditId}`);
      return notFound('Enrichment metadata not found');
    }

    // Get indexName from message or metadata
    const indexName = indexNameFromMessage || metadata.indexName;
    if (!indexName) {
      log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: indexName not found for auditId: ${auditId}`);
      return internalServerError('indexName not found');
    }

    if (isEnrichmentTimedOut(metadata)) {
      log.warn(`${BRAND_DATA_ENRICHMENT_TYPE}: Enrichment timed out for auditId: ${auditId} (started: ${metadata.createdAt})`);

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
      log.warn(`${BRAND_DATA_ENRICHMENT_TYPE}: Conflict detected for auditId: ${auditId} - reason: ${conflictCheck.reason}`);
      return ok({ status: 'aborted', reason: conflictCheck.reason });
    }

    const config = await loadEnrichmentConfig(s3Client, bucket, auditId);
    const flatPrompts = flattenConfigPrompts(config);
    const { totalPrompts } = metadata;

    // Process multiple batches sequentially per invocation
    let currentPromptIndex = batchStart;
    let totalEnrichedCount = 0;
    let batchNumber = 0;

    const maxPromptsThisInvocation = Math.min(
      batchStart + (BATCHES_PER_INVOCATION * URL_ENRICHMENT_BATCH_SIZE),
      totalPrompts,
    );

    // eslint-disable-next-line no-await-in-loop
    while (currentPromptIndex < maxPromptsThisInvocation) {
      batchNumber += 1;
      const batchStartTime = Date.now();

      const batchEnd = Math.min(
        currentPromptIndex + URL_ENRICHMENT_BATCH_SIZE,
        totalPrompts,
      );
      const batchSize = batchEnd - currentPromptIndex;
      const batchIndices = [];
      for (let i = 0; i < batchSize; i += 1) {
        batchIndices.push(currentPromptIndex + i);
      }

      // eslint-disable-next-line no-await-in-loop
      const enrichedCount = await processJsonEnrichmentBatch(
        flatPrompts,
        batchIndices,
        site,
        context,
        log,
        indexName,
      );

      totalEnrichedCount += enrichedCount;
      const batchDuration = Date.now() - batchStartTime;

      log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Batch ${batchNumber} complete - enriched ${enrichedCount}/${batchIndices.length} prompts (took ${batchDuration}ms)`);

      currentPromptIndex = batchEnd;

      // Save config periodically (every 10 batches or at end)
      if (batchNumber % 10 === 0 || currentPromptIndex >= maxPromptsThisInvocation) {
        // eslint-disable-next-line no-await-in-loop
        await saveEnrichmentConfig(s3Client, bucket, auditId, config);
      }
    }

    const invocationDuration = Date.now() - invocationStartTime;
    log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Invocation complete - processed ${batchNumber} batches (${currentPromptIndex - batchStart} prompts) in ${invocationDuration}ms (${Math.round(invocationDuration / 1000)}s)`);

    const remaining = totalPrompts - currentPromptIndex;

    if (remaining > 0) {
      const { Configuration } = dataAccess;
      const configuration = await Configuration.findLatest();
      const auditQueue = configuration.getQueues().audits;

      await sqs.sendMessage(auditQueue, {
        type: BRAND_DATA_ENRICHMENT_TYPE,
        siteId,
        auditId,
        batchStart: currentPromptIndex,
        indexName,
      });

      return ok({
        status: 'processing',
        remaining,
        processedPrompts: currentPromptIndex,
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
      log.warn(`${BRAND_DATA_ENRICHMENT_TYPE}: Final conflict detected for auditId: ${auditId}`);
      return ok({ status: 'aborted', reason: finalConflictCheck.reason });
    }

    await llmoConfig.writeConfig(siteId, config, s3Client, { s3Bucket: bucket });
    await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);

    log.info(`${BRAND_DATA_ENRICHMENT_TYPE}: Completed enrichment for auditId: ${auditId}, totalPrompts: ${totalPrompts}, enrichedCount: ${totalEnrichedCount}`);

    return ok({
      status: 'completed',
      totalPrompts,
      enrichedCount: totalEnrichedCount,
    });
  } catch (error) {
    log.error(`${BRAND_DATA_ENRICHMENT_TYPE}: Error during enrichment for auditId: ${auditId}: ${error.message}`);

    if (metadata) {
      await releaseEnrichmentLock(s3Client, bucket, siteId, LOCK_ID, log);
    }

    return internalServerError(error.message);
  }
}
