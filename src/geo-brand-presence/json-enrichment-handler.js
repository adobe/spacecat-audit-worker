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
 * JSON Enrichment Handler
 *
 * Processes JSON prompts in batches to add Related URLs from promptToLinks.
 * Uses SQS self-continuation pattern to handle long-running operations.
 *
 * Safeguards implemented:
 * - Timeout detection: Sends to Mystique without enrichment if timeout exceeded (#4)
 * - Conflict detection: Aborts if another audit took over (#1)
 * - Lock release: Releases enrichment lock on completion
 * - Fallback: Sends unenriched prompts to Mystique on failure (#3)
 *
 * Flow:
 * 1. Receives message with auditId and batchStart index
 * 2. Checks for timeout and conflicts
 * 3. Loads metadata and JSON prompts from S3
 * 4. Processes a batch of prompts (concurrent within batch)
 * 5. Saves updated JSON to S3
 * 6. If more batches remain, sends continuation message to self
 * 7. When done, sends enriched prompts to Mystique
 * 8. Releases lock on completion
 */

import { ok, notFound, internalServerError } from '@adobe/spacecat-shared-http-utils';
import {
  URL_ENRICHMENT_BATCH_SIZE,
  URL_ENRICHMENT_TYPE,
  loadEnrichmentMetadata,
  loadEnrichmentJson,
  saveEnrichmentJson,
  processJsonEnrichmentBatch,
  isEnrichmentTimedOut,
  checkEnrichmentConflict,
  releaseEnrichmentLock,
  transformWebSearchProviderForMystique,
} from './util.js';
import { getSignedUrl } from '../utils/getPresignedUrl.js';

const AUDIT_NAME = 'GEO_BRAND_PRESENCE_JSON_ENRICHMENT';

/**
 * Uploads prompts to S3 and returns a presigned URL.
 * @param {Array<Object>} prompts - The prompts array
 * @param {string} bucket - The S3 bucket
 * @param {Object} context - The context object
 * @returns {Promise<string>} The presigned URL
 */
async function uploadPromptsAsPresignedUrl(prompts, bucket, s3Client, env) {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { randomUUID } = await import('node:crypto');

  const key = `temp/geo-brand-presence/${randomUUID()}/prompts.json`;

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(prompts),
    ContentType: 'application/json',
  }));

  return getSignedUrl(
    { host: `${bucket}.s3.${env.AWS_REGION}.amazonaws.com`, key },
    env.AWS_REGION,
  );
}

/**
 * Sends prompts to Mystique for detection.
 * @param {Array<Object>} prompts - The enriched prompts
 * @param {Object} metadata - The enrichment metadata
 * @param {Object} context - The context object
 * @param {Object} log - Logger instance
 */
async function sendToMystique(prompts, metadata, context, log) {
  const { sqs, env, s3Client } = context;

  if (!s3Client) {
    log.error(
      '%s: Cannot send to Mystique - s3Client is undefined in context for auditId: %s',
      AUDIT_NAME,
      metadata.auditId,
    );
    throw new Error('s3Client is not available in context');
  }

  const bucket = env.S3_IMPORTER_BUCKET_NAME;

  const url = await uploadPromptsAsPresignedUrl(prompts, bucket, s3Client, env);

  const {
    siteId,
    auditId,
    baseURL,
    deliveryType,
    dateContext,
    providersToUse,
    isDaily,
    configVersion,
    configExists,
  } = metadata;

  const opptyType = isDaily
    ? 'detect:geo-brand-presence-daily'
    : 'detect:geo-brand-presence';

  const detectionMessages = providersToUse.map(async (webSearchProvider) => {
    const message = {
      type: opptyType,
      siteId,
      url: baseURL,
      auditId,
      deliveryType,
      presigned_url: url,
      web_search_provider: transformWebSearchProviderForMystique(webSearchProvider),
      week: dateContext.week,
      year: dateContext.year,
      config_version: configExists ? configVersion : null,
      ...(isDaily && { date: dateContext.date }),
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.debug(
      '%s: Detection message sent to Mystique for site %s with provider %s',
      AUDIT_NAME,
      siteId,
      webSearchProvider,
    );
  });

  await Promise.all(detectionMessages);

  log.info(
    '%s: Sent %d detection messages to Mystique for site %s',
    AUDIT_NAME,
    providersToUse.length,
    siteId,
  );
}

/**
 * Sends unenriched prompts to Mystique as fallback.
 * @param {Object} metadata - The enrichment metadata
 * @param {Array<Object>} prompts - The prompts (possibly partially enriched)
 * @param {Object} context - The context object
 * @param {Object} log - Logger instance
 */
async function sendFallbackToMystique(metadata, prompts, context, log) {
  log.warn(
    '%s: Sending fallback (possibly partial) prompts to Mystique for auditId: %s',
    AUDIT_NAME,
    metadata.auditId,
  );

  // Guard: Check if required context properties exist
  // Note: s3Client is checked in sendToMystique, so we only check sqs and env here
  if (!context.sqs || !context.env) {
    log.error(
      '%s: Cannot send fallback - missing required context properties (sqs: %s, env: %s) for auditId: %s',
      AUDIT_NAME,
      !!context.sqs,
      !!context.env,
      metadata.auditId,
    );
    return false;
  }

  try {
    await sendToMystique(prompts, metadata, context, log);
    return true;
  } catch (error) {
    log.error(
      '%s: Failed to send fallback to Mystique for auditId: %s: %s',
      AUDIT_NAME,
      metadata.auditId,
      error.message,
    );
    return false;
  }
}

/**
 * Handles JSON enrichment for geo-brand-presence prompts.
 * Processes prompts in batches and uses SQS self-continuation for long operations.
 *
 * @param {Object} message - SQS message with auditId, siteId, batchStart
 * @param {Object} context - Universal context with dataAccess, sqs, s3Client, etc.
 * @returns {Promise<Object>} HTTP response
 */
export default async function handleJsonEnrichment(message, context) {
  // TODO: Remove diagnostic logging after debugging
  // eslint-disable-next-line no-console
  console.log('ENRICHMENT_HANDLER_INVOKED:', JSON.stringify(message));

  let log;
  try {
    ({
      log,
    } = context);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('ENRICHMENT_HANDLER_CONTEXT_ERROR:', e);
    throw e;
  }

  const {
    dataAccess, sqs, s3Client, env,
  } = context;
  const { Site } = dataAccess;
  const { auditId, siteId, batchStart = 0 } = message;

  log.info(
    '%s: Processing batch starting at %d for auditId: %s, siteId: %s',
    AUDIT_NAME,
    batchStart,
    auditId,
    siteId,
  );

  let metadata = null;
  let prompts = null;
  const bucket = env.S3_IMPORTER_BUCKET_NAME;

  try {
    const site = await Site.findById(siteId);
    if (!site) {
      log.error('%s: Site not found for siteId: %s', AUDIT_NAME, siteId);
      return notFound('Site not found');
    }

    log.debug('%s: Loading metadata from S3 for auditId: %s', AUDIT_NAME, auditId);
    metadata = await loadEnrichmentMetadata(s3Client, bucket, auditId);

    if (!metadata || !metadata.indicesToEnrich) {
      log.error('%s: Invalid metadata for auditId: %s', AUDIT_NAME, auditId);
      return notFound('Enrichment metadata not found');
    }

    if (isEnrichmentTimedOut(metadata)) {
      log.warn(
        '%s: Enrichment timed out for auditId: %s (started: %s) - sending partial to Mystique',
        AUDIT_NAME,
        auditId,
        metadata.createdAt,
      );

      prompts = await loadEnrichmentJson(s3Client, bucket, auditId);
      await sendFallbackToMystique(metadata, prompts, context, log);
      await releaseEnrichmentLock(s3Client, bucket, siteId, metadata.lockId, log);

      return ok({
        status: 'timeout',
        message: 'Enrichment timed out, sent partial results to Mystique',
      });
    }

    const conflictCheck = await checkEnrichmentConflict(
      s3Client,
      bucket,
      siteId,
      metadata.lockId,
      auditId,
    );

    if (conflictCheck.hasConflict) {
      log.warn(
        '%s: Conflict detected for auditId: %s - reason: %s, newer audit: %s',
        AUDIT_NAME,
        auditId,
        conflictCheck.reason,
        conflictCheck.newerAuditId || 'unknown',
      );

      // Don't send to Mystique - a newer audit has taken over
      return ok({
        status: 'aborted',
        reason: conflictCheck.reason,
        newerAuditId: conflictCheck.newerAuditId,
      });
    }

    log.debug('%s: Loading prompts from S3 for auditId: %s', AUDIT_NAME, auditId);
    prompts = await loadEnrichmentJson(s3Client, bucket, auditId);

    if (!Array.isArray(prompts)) {
      log.error('%s: Invalid prompts data for auditId: %s', AUDIT_NAME, auditId);
      return internalServerError('Invalid prompts data');
    }

    const { indicesToEnrich } = metadata;
    const batchEnd = Math.min(batchStart + URL_ENRICHMENT_BATCH_SIZE, indicesToEnrich.length);
    const batchIndices = indicesToEnrich.slice(batchStart, batchEnd);
    const totalBatches = Math.ceil(indicesToEnrich.length / URL_ENRICHMENT_BATCH_SIZE);
    const currentBatch = Math.floor(batchStart / URL_ENRICHMENT_BATCH_SIZE) + 1;

    log.info(
      '%s: Processing batch %d/%d (%d prompts) for auditId: %s',
      AUDIT_NAME,
      currentBatch,
      totalBatches,
      batchIndices.length,
      auditId,
    );

    const enrichedCount = await processJsonEnrichmentBatch(
      prompts,
      batchIndices,
      site,
      context,
      log,
    );

    log.info(
      '%s: Batch %d/%d complete - enriched %d/%d prompts for auditId: %s',
      AUDIT_NAME,
      currentBatch,
      totalBatches,
      enrichedCount,
      batchIndices.length,
      auditId,
    );

    await saveEnrichmentJson(s3Client, bucket, auditId, prompts);
    log.debug('%s: Saved updated prompts to S3 for auditId: %s', AUDIT_NAME, auditId);

    const remaining = indicesToEnrich.length - batchEnd;

    if (remaining > 0) {
      log.info(
        '%s: %d prompts remaining, sending continuation message for auditId: %s',
        AUDIT_NAME,
        remaining,
        auditId,
      );

      const { Configuration } = dataAccess;
      const configuration = await Configuration.findLatest();
      const auditQueue = configuration.getQueues().audits;

      // TODO: Remove diagnostic logging after debugging
      log.info('%s: Sending continuation to queue: %s, batchStart: %d', AUDIT_NAME, auditQueue, batchEnd);

      await sqs.sendMessage(auditQueue, {
        type: URL_ENRICHMENT_TYPE,
        auditId,
        siteId,
        batchStart: batchEnd,
      });

      // TODO: Remove diagnostic logging after debugging
      log.info('%s: Continuation message sent successfully for auditId: %s', AUDIT_NAME, auditId);

      return ok({
        status: 'processing',
        batchProcessed: currentBatch,
        totalBatches,
        remaining,
      });
    }

    log.info(
      '%s: All batches complete for auditId: %s, performing final conflict check',
      AUDIT_NAME,
      auditId,
    );

    const finalConflictCheck = await checkEnrichmentConflict(
      s3Client,
      bucket,
      siteId,
      metadata.lockId,
      auditId,
    );

    if (finalConflictCheck.hasConflict) {
      log.warn(
        '%s: Final conflict detected for auditId: %s - aborting',
        AUDIT_NAME,
        auditId,
      );
      return ok({
        status: 'aborted',
        reason: 'conflict-at-send',
        newerAuditId: finalConflictCheck.newerAuditId,
      });
    }

    log.info('%s: Sending enriched prompts to Mystique for auditId: %s', AUDIT_NAME, auditId);
    await sendToMystique(prompts, metadata, context, log);

    await releaseEnrichmentLock(s3Client, bucket, siteId, metadata.lockId, log);

    log.info(
      '%s: Successfully completed JSON enrichment for auditId: %s, sent to Mystique',
      AUDIT_NAME,
      auditId,
    );

    return ok({
      status: 'completed',
      totalPrompts: prompts.length,
      enrichedCount: indicesToEnrich.length,
      sentToMystique: true,
    });
  } catch (error) {
    log.error(
      '%s: Error processing JSON enrichment for auditId: %s: %s',
      AUDIT_NAME,
      auditId,
      error.message,
    );

    if (metadata && prompts) {
      await sendFallbackToMystique(metadata, prompts, context, log);
      await releaseEnrichmentLock(s3Client, bucket, siteId, metadata.lockId, log);
    }

    return internalServerError(error.message);
  }
}
