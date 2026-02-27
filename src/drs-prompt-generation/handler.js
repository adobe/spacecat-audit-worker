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

import { ok } from '@adobe/spacecat-shared-http-utils';
import { writeDrsPromptsToS3 } from './drs-parquet-writer.js';
import writeDrsPromptsToLlmoConfig from './drs-config-writer.js';

/**
 * Downloads DRS result from presigned URL and writes JSON + parquet to SpaceCat S3.
 * Non-fatal — returns null keys on failure so the handler can continue.
 *
 * @param {string} resultLocation - Presigned URL to the DRS result JSON
 * @param {string} jobId - DRS job ID
 * @param {string} siteId - Site identifier
 * @param {object} context - Universal context (env, s3Client, log)
 * @returns {Promise<{drsJsonKey: string|null, drsParquetKey: string|null}>}
 */
async function convertDrsResult(resultLocation, jobId, siteId, context) {
  const { env, s3Client, log } = context;

  try {
    log.info(`Downloading DRS result from presigned URL for job ${jobId}`);
    const response = await fetch(resultLocation);

    if (!response.ok) {
      throw new Error(`Failed to download DRS result: ${response.status} ${response.statusText}`);
    }

    const drsResult = await response.json();
    const prompts = drsResult.prompts || drsResult;
    const drsPrompts = Array.isArray(prompts) ? prompts : [];

    if (drsPrompts.length === 0) {
      log.warn(`DRS job ${jobId} returned no prompts for site ${siteId}`);
      return { drsJsonKey: null, drsParquetKey: null };
    }

    const bucket = env.S3_IMPORTER_BUCKET_NAME;
    const { jsonKey, parquetKey } = await writeDrsPromptsToS3({
      drsPrompts,
      siteId,
      jobId,
      bucket,
      s3Client,
      log,
    });

    // Write prompts to LLMO config as aiTopics (non-fatal)
    try {
      await writeDrsPromptsToLlmoConfig({
        drsPrompts, siteId, s3Client, s3Bucket: bucket, log,
      });
    } catch /* c8 ignore next */ (configError) {
      log.error(`Failed to write DRS prompts to LLMO config for site ${siteId}: ${configError.message}`);
    }

    log.info(`DRS conversion complete for job ${jobId}: JSON=${jsonKey}, parquet=${parquetKey}`);
    return { drsJsonKey: jsonKey, drsParquetKey: parquetKey };
  } catch (error) {
    log.error(`DRS conversion failed for job ${jobId}, site ${siteId}: ${error.message}`);
    return { drsJsonKey: null, drsParquetKey: null };
  }
}

/**
 * Handles DRS prompt generation job completion notifications.
 * When a prompt_generation_base_url job completes in the Data Retrieval Service,
 * the SNS notification is routed to the audit-jobs SQS queue and dispatched here.
 *
 * On JOB_COMPLETED (all sources): downloads DRS result from the presigned URL in
 * resultLocation, writes JSON + parquet to SpaceCat S3.
 * On JOB_COMPLETED + source=onboarding: additionally triggers llmo-customer-analysis.
 * On JOB_FAILED: logs the failure (prompts can be generated manually later).
 *
 * Conversion is non-fatal — if the download or conversion fails, the handler
 * still triggers the downstream audit.
 *
 * LLMO-1819: https://jira.corp.adobe.com/browse/LLMO-1819
 *
 * @param {object} message - Normalized SQS message with DRS notification data
 * @param {object} context - Universal context
 * @returns {Response}
 */
export default async function drsPromptGenerationHandler(message, context) {
  const { log, sqs, dataAccess } = context;
  const { siteId, auditContext = {} } = message;
  const {
    drsEventType, drsJobId, resultLocation, source,
  } = auditContext;

  if (!siteId) {
    log.error('DRS prompt generation notification missing site_id in metadata');
    return ok();
  }

  if (drsEventType === 'JOB_FAILED') {
    log.error(`DRS prompt generation job ${drsJobId} failed for site ${siteId}. Prompts can be generated manually via DRS dashboard.`);
    return ok();
  }

  if (drsEventType !== 'JOB_COMPLETED') {
    log.warn(`Unexpected DRS event type: ${drsEventType} for site ${siteId}`);
    return ok();
  }

  log.info(`DRS prompt generation completed for site ${siteId}, job ${drsJobId}, result: ${resultLocation}`);

  // Download DRS result and write JSON + parquet to SpaceCat S3 (non-fatal for all sources)
  const {
    drsJsonKey, drsParquetKey,
  } = await convertDrsResult(resultLocation, drsJobId, siteId, context);

  if (source !== 'onboarding') {
    log.info(`DRS job ${drsJobId} was not triggered by onboarding (source: ${source}), skipping llmo-customer-analysis trigger`);
    return ok();
  }

  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  await sqs.sendMessage(configuration.getQueues().audits, {
    type: 'llmo-customer-analysis',
    siteId,
    auditContext: {
      drsJobId,
      resultLocation,
      ...(drsJsonKey && { drsJsonKey }),
      ...(drsParquetKey && { drsParquetKey }),
    },
  });

  log.info(`Triggered llmo-customer-analysis for site ${siteId} after DRS prompt generation job ${drsJobId}`);
  return ok();
}
