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

import { ok, notFound, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * Converts an array of row-based objects (records) into a column-based data format
 * that is compatible with the hyparquet-writer utility.
 * The function infers the column data types from the first row's values.
 *
 * @param {Array<Object>} objects - Array of objects representing rows,
 *   where each object has the same set of keys (columns).
 * @returns {Array<Object>} - Array of column definition objects, each with:
 *   - {string} name: Column name.
 *   - {string} type: Inferred data type ('STRING', 'INT32', 'DOUBLE', 'TIMESTAMP').
 *   - {Array<any>} data: Array of column values.
 */
/* c8 ignore start */
function objectsToColumnData(objects) {
  if (!objects || objects.length === 0) {
    return [];
  }

  const keys = Object.keys(objects[0]);
  const columnData = {};

  keys.forEach((key) => {
    const sampleValue = objects[0][key];
    let type = 'STRING';

    if (typeof sampleValue === 'number') {
      type = Number.isInteger(sampleValue) ? 'INT32' : 'DOUBLE';
    } else if (sampleValue instanceof Date) {
      type = 'TIMESTAMP';
    }

    columnData[key] = {
      data: [],
      name: key,
      type,
    };
  });

  objects.forEach((obj) => {
    keys.forEach((key) => {
      columnData[key].data.push(obj[key]);
    });
  });

  return Object.values(columnData);
  /* c8 ignore end */
}

/**
 * Writes categorized AI prompts to FINAL aggregates location for analytics/reporting.
 * This is where Spacecat permanently stores categorized prompts after receiving them
 * from Mystique's temp/ transfer location.
 *
 * @function
 * @param {Object} params - The parameters object.
 * @param {Array<Object>} params.aiCategorizedPrompts
 * - Array of categorized AI prompts to write to parquet.
 * @param {string} params.bucket
 * - The S3 bucket where the parquet file will be stored.
 * @param {import('@aws-sdk/client-s3').S3Client} params.s3Client
 * - The AWS S3 client used for uploading.
 * @param {string} params.siteId - The ID of the site this data is associated with.
 * @param {Object} params.dateContext - Contains the date string ("YYYY-MM-DD") for partitioning.
 * @param {import('../common/logger.js').Logger} params.log
 * - Logger utility for logging info/warnings/errors.
 * @returns {Promise<{success: boolean, key?: string, error?: string}>}
 * - Object with success flag and file key or error message.
 * Creates: aggregates/${siteId}/geo-brand-presence/ai-prompts/date=${date}/data.parquet
 */
async function writeCategorizedPromptsToAggregates({
  aiCategorizedPrompts,
  bucket,
  s3Client,
  siteId,
  dateContext,
  log,
}) {
  /* c8 ignore start */
  try {
    const dateStr = dateContext.date
      || new Date().toISOString().split('T')[0];

    const s3Key = `aggregates/${siteId}/geo-brand-presence/ai-prompts/date=${dateStr}/data.parquet`;

    log.info('GEO BRAND PRESENCE: Writing %d categorized AI prompts to %s', aiCategorizedPrompts.length, s3Key);

    const columnData = objectsToColumnData(aiCategorizedPrompts);
    const parquetBuffer = parquetWriteBuffer({ columnData });
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: parquetBuffer,
      ContentType: 'application/octet-stream',
    }));

    log.info('GEO BRAND PRESENCE: Successfully wrote categorized AI prompts to s3://%s/%s', bucket, s3Key);
    return { success: true, key: s3Key };
  } catch (error) {
    log.error('GEO BRAND PRESENCE: Failed to write categorized AI prompts to aggregates: %s', error.message);
    return { success: false, error: error.message };
  }
  /* c8 ignore end */
}

/**
 * Downloads categorized prompts from a presigned URL.
 * @param {string} presignedUrl - The presigned URL to download from
 * @param {object} log - Logger instance
 * @returns {Promise<Array>} Array of categorized prompts
 */
async function downloadCategorizedPromptsFromUrl(presignedUrl, log) {
  try {
    const response = await fetch(presignedUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data.categorized_prompts || [];
  } catch (error) {
    log.error('Failed to download categorized prompts from URL: %s', error.message);
    throw error;
  }
}

/**
 * Step 2: Receive Categorization Status
 * Audit step that processes categorization results from Mystique.
 * Downloads categorized prompts and writes them to parquet for persistence.
 * Exported for testing purposes.
 */
export async function receiveCategorization(context) {
  const {
    log, s3Client, env, data, site, audit,
  } = context;

  const siteId = site.getId();
  const auditId = audit.getId();

  log.info('GEO BRAND PRESENCE STEP 2: Received categorization status for auditId: %s, siteId: %s', auditId, siteId);

  // Check for error in categorization
  if (data?.error) {
    const errorMsg = data?.message || 'Unknown error';
    log.error('GEO BRAND PRESENCE STEP 2: Categorization failed for auditId: %s, siteId: %s, error: %s', auditId, siteId, errorMsg);
    // Return success to acknowledge - error logged, detection continues in Mystique
    return {
      status: 'categorization_error',
      message: errorMsg,
    };
  }

  // Validate presigned URL
  if (!data?.url) {
    log.warn('GEO BRAND PRESENCE STEP 2: No presigned URL provided for auditId: %s, siteId: %s', auditId, siteId);
    return {
      status: 'no_url',
      message: 'No URL provided, skipping parquet update',
    };
  }

  try {
    // Download categorized prompts from presigned URL
    log.info('GEO BRAND PRESENCE STEP 2: Downloading categorized prompts from URL for auditId: %s', auditId);
    const categorizedPrompts = await downloadCategorizedPromptsFromUrl(data.url, log);

    if (!categorizedPrompts || categorizedPrompts.length === 0) {
      log.warn('GEO BRAND PRESENCE STEP 2: No categorized prompts found for auditId: %s', auditId);
      return {
        status: 'no_prompts',
        message: 'No categorized prompts to write',
      };
    }

    log.info('GEO BRAND PRESENCE STEP 2: Downloaded %d categorized prompts for auditId: %s', categorizedPrompts.length, auditId);

    // Write categorized prompts to aggregates parquet
    const dateContext = {
      date: data?.date || new Date().toISOString().split('T')[0],
    };

    const result = await writeCategorizedPromptsToAggregates({
      aiCategorizedPrompts: categorizedPrompts,
      bucket: env.S3_BUCKET_NAME,
      s3Client,
      siteId,
      dateContext,
      log,
    });

    if (!result.success) {
      log.error('GEO BRAND PRESENCE STEP 2: Failed to write categorized prompts for auditId: %s, error: %s', auditId, result.error);
      throw new Error(`Failed to write categorized prompts: ${result.error}`);
    }

    log.info('GEO BRAND PRESENCE STEP 2: Successfully wrote %d categorized prompts to parquet for auditId: %s', categorizedPrompts.length, auditId);

    return {
      status: 'success',
      promptsWritten: categorizedPrompts.length,
      s3Key: result.key,
    };
  } catch (error) {
    log.error('GEO BRAND PRESENCE STEP 2: Error processing categorization status for auditId: %s, siteId: %s', auditId, siteId, error);
    throw error;
  }
}

/**
 * Message handler for categorization status messages from Mystique.
 * Processes categorization results and updates parquet files with categorized prompts.
 * This handler is triggered by SQS messages with type 'category:geo-brand-presence'
 * sent from Mystique after it completes prompt categorization.
 * @param {object} message - SQS message from Mystique
 * @param {object} context - Universal context with dataAccess, log, etc.
 * @returns {Promise<object>} HTTP response (ok, notFound, or internalServerError)
 */
export async function handleCategorizationResponseHandler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site } = dataAccess;
  const { auditId, siteId } = message;

  try {
    // Load site from database
    const site = await Site.findById(siteId);
    if (!site) {
      log.error('Site not found for categorization: %s', siteId);
      return notFound();
    }

    // Load audit from database
    const audit = await Audit.findById(auditId);
    if (!audit) {
      log.error('Audit not found for categorization: %s', auditId);
      return notFound();
    }

    // Process categorization results
    const result = await receiveCategorization({
      ...context,
      site,
      audit,
      data: message.data,
    });

    return ok(result);
  } catch (error) {
    log.error('Error processing categorization for auditId %s: %s', auditId, error.message);
    return internalServerError(error.message);
  }
}
