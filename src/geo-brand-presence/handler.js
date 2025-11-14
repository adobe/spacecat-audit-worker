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
/* eslint-disable no-use-before-define */

import { Audit } from '@adobe/spacecat-shared-data-access';
import {
  isString,
  isNonEmptyArray,
  isNonEmptyObject,
  isoCalendarWeek,
  llmoConfig,
} from '@adobe/spacecat-shared-utils';
import { parquetReadObjects } from 'hyparquet';
import { parquetWriteBuffer } from 'hyparquet-writer';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { getSignedUrl } from '../utils/getPresignedUrl.js';
import { transformWebSearchProviderForMystique } from './util.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const LLMO_QUESTIONS_IMPORT_TYPE = 'llmo-prompts-ahrefs';
export const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'detect:geo-brand-presence';
export const GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE = 'detect:geo-brand-presence-daily';
export const GEO_BRAND_CATEGORIZATION_OPPTY_TYPE = 'categorize:geo-brand-presence';
export const GEO_FAQ_OPPTY_TYPE = 'guidance:geo-faq';
export const OPPTY_TYPES = [
  GEO_BRAND_PRESENCE_OPPTY_TYPE,
  GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE,
  GEO_BRAND_CATEGORIZATION_OPPTY_TYPE,
  // GEO_FAQ_OPPTY_TYPE, // TODO reenable when working on faqs again
];

// Web search providers to send messages for
export const WEB_SEARCH_PROVIDERS = [
  'all',
  'chatgpt',
  'gemini',
  'google_ai_overviews',
  'ai_mode',
  'perplexity',
  'copilot',
  // Add more providers here as needed
];

/**
 * @import { S3Client } from '@aws-sdk/client-s3';
 * @import { ISOCalendarWeek } from '@adobe/spacecat-shared-utils';
 */

/**
 * Removes duplicate prompts from AI-generated prompts based on region, topic, and prompt text.
 * @param {Array<Object>} prompts - Array of prompt objects
 * @param {string} siteId - Site id
 * @param {Object} log - Logger instance
 * @returns {Array<Object>} Deduplicated array of prompts
 */
function deduplicatePrompts(prompts, siteId, log) {
  /* c8 ignore start */
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return prompts;
  }

  const regionTopicGroups = new Map();
  const deduplicatedPrompts = [];
  let totalDuplicatesRemoved = 0;
  let totalEmptyPromptsSkipped = 0;
  let totalInvalidItemsSkipped = 0;
  let totalErrorsRecovered = 0;
  const originalCount = prompts.length;

  for (let i = 0; i < prompts.length; i += 1) {
    const item = prompts[i];

    try {
      if (!item || typeof item !== 'object') {
        totalInvalidItemsSkipped += 1;
        log.warn(`GEO BRAND PRESENCE: [DEDUP] Skipping non-object item at index ${i}: ${typeof item}`);
      } else {
        // Get the prompt for duplicate checking
        const prompt = item.prompt || '';
        const region = (item.region || item.market || 'US').toLowerCase();
        const topic = (item.topic || item.keyword || '').toLowerCase();

        // Skip empty prompts
        if (!prompt || prompt.trim().length === 0) {
          totalEmptyPromptsSkipped += 1;
          log.debug(`GEO BRAND PRESENCE: [DEDUP] Skipping empty prompt at index ${i}: region='${region}', topic='${topic}'`);
        } else {
          // Check for duplicates BEFORE adding to result
          const regionTopicKey = `${region}:${topic}`;
          const promptKey = prompt.toLowerCase().trim();

          // Initialize group if not exists
          if (!regionTopicGroups.has(regionTopicKey)) {
            regionTopicGroups.set(regionTopicKey, {
              seenPrompts: new Set(),
              originalCount: 0,
            });
          }

          const group = regionTopicGroups.get(regionTopicKey);
          group.originalCount += 1;

          if (group.seenPrompts.has(promptKey)) {
            // Skip duplicate
            totalDuplicatesRemoved += 1;
            const truncatedPrompt = prompt.length > 50 ? `${prompt.substring(0, 50)}...` : prompt;
            log.debug(`GEO BRAND PRESENCE: [DEDUP] Skipping duplicate prompt at index ${i}: region='${region}', topic='${topic}', prompt='${truncatedPrompt}'`);
          } else {
            // Mark as seen BEFORE adding to result
            group.seenPrompts.add(promptKey);
            deduplicatedPrompts.push(item);
          }
        }
      }
    } catch (error) {
      totalErrorsRecovered += 1;
      log.error(`GEO BRAND PRESENCE: [DEDUP] Error processing item at index ${i}:`, error);
      // Include item in result even if processing fails
      deduplicatedPrompts.push(item);
    }
  }

  // Log deduplication statistics
  const finalCount = deduplicatedPrompts.length;
  const totalSkipped = totalDuplicatesRemoved + totalEmptyPromptsSkipped + totalInvalidItemsSkipped;
  const skipRate = originalCount > 0 ? ((totalSkipped / originalCount) * 100).toFixed(1) : 0;

  log.info(
    'GEO BRAND PRESENCE: [DEDUP] Site %s: Processed %d prompts across %d region/topic groups. Skipped %d items (%s%%): %d duplicates, %d empty, %d invalid. Recovered from %d errors. Kept %d unique prompts.',
    siteId,
    originalCount,
    regionTopicGroups.size,
    totalSkipped,
    skipRate,
    totalDuplicatesRemoved,
    totalEmptyPromptsSkipped,
    totalInvalidItemsSkipped,
    totalErrorsRecovered,
    finalCount,
  );

  // Log group statistics if debug enabled
  if (log.debug) {
    regionTopicGroups.forEach((group, key) => {
      const [region, topic] = key.split(':');
      const keptCount = group.seenPrompts.size;
      const removedCount = group.originalCount - keptCount;
      if (removedCount > 0) {
        log.debug(`GEO BRAND PRESENCE: [DEDUP] Group '${region}/${topic}': ${group.originalCount} → ${keptCount} (removed ${removedCount})`);
      }
    });
  }
  /* c8 ignore end */
  return deduplicatedPrompts;
}

/**
 * Step 1: Load prompts from parquet files and send categorization message
 */
export async function loadPromptsAndSendCategorization(
  context,
  getPresignedUrlOverride = getSignedUrl,
) {
  /* c8 ignore start */
  const {
    auditContext, log, sqs, env, site, audit, s3Client, brandPresenceCadence,
  } = context;

  const siteId = site.getId();
  const baseURL = site.getBaseURL();
  const isDaily = brandPresenceCadence === 'daily';

  const { calendarWeek, parquetFiles, success } = auditContext ?? /* c8 ignore next */ {};

  // Get aiPlatform and referenceDate from the audit result
  const auditResult = audit?.getAuditResult();
  const aiPlatform = auditResult?.aiPlatform;

  // For daily cadence, calculate date context
  let dailyDateContext;
  if (isDaily) {
    // Check audit result first (from keywordPromptsImportStep),
    // then context.data (Slack/API params), then auditContext
    const referenceDate = auditResult?.referenceDate
      || context.data?.referenceDate
      || auditContext?.referenceDate
      || new Date();
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() - 1); // Yesterday

    // Calculate ISO 8601 week and year using shared utility
    const { week, year } = isoCalendarWeek(date);

    dailyDateContext = {
      date: date.toISOString().split('T')[0],
      week,
      year,
    };
  }

  // Store aiPlatform for later detection step
  const providersToUse = WEB_SEARCH_PROVIDERS.includes(aiPlatform)
    ? [aiPlatform]
    : WEB_SEARCH_PROVIDERS;
  log.info('GEO BRAND PRESENCE: aiPlatform: %s for site id %s (%s). Will use providers: %j', aiPlatform, siteId, baseURL, providersToUse);

  if (success === false) {
    log.error('GEO BRAND PRESENCE: Received the following errors for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }

  // For weekly cadence, validate calendarWeek; for daily, use dailyDateContext
  const dateContext = isDaily ? dailyDateContext : calendarWeek;
  if (!isNonEmptyObject(dateContext) || !dateContext.week || !dateContext.year) {
    log.error('GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }
  if (!Array.isArray(parquetFiles) || !parquetFiles.every((x) => typeof x === 'string')) {
    log.error('GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }

  log.debug('GEO BRAND PRESENCE: Step 1 - Loading AI prompts from parquet and sending to categorization for site id %s (%s)', siteId, baseURL);

  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';
  const recordSets = await Promise.all(
    parquetFiles.map((key) => loadParquetDataFromS3({ key, bucket, s3Client })),
  );

  let aiPrompts = recordSets.flat();
  for (const x of aiPrompts) {
    x.market = x.region; // TODO(aurelio): remove when .region is supported by Mystique
    x.origin = x.source; // TODO(aurelio): remove when we decided which one to pick
  }

  log.debug('GEO BRAND PRESENCE: Loaded %d AI prompts from parquet for site id %s (%s)', aiPrompts.length, siteId, baseURL);

  // Remove duplicates from AI-generated prompts
  aiPrompts = deduplicatePrompts(aiPrompts, siteId, log);

  // Get config version for passing to categorization
  const {
    exists: configExists,
    version: configVersion,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });

  log.info('GEO BRAND PRESENCE: Found %d AI prompts (after dedup) to categorize for site id %s (%s)', aiPrompts.length, siteId, baseURL);

  if (aiPrompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No AI prompts found for site id %s (%s), skipping categorization', siteId, baseURL);
    return;
  }

  // Upload AI prompts to S3 for categorization
  const s3Context = isDaily
    ? {
      ...context, getPresignedUrl: getPresignedUrlOverride, isDaily, dateContext,
    }
    : { ...context, getPresignedUrl: getPresignedUrlOverride };
  const url = await asPresignedJsonUrl(aiPrompts, bucket, s3Context);
  log.info('GEO BRAND PRESENCE: Presigned URL for AI prompts for site id %s (%s): %s', siteId, baseURL, url);

  if (!isNonEmptyArray(providersToUse)) {
    log.warn('GEO BRAND PRESENCE: No web search providers configured for site id %s (%s), skipping message to mystique', siteId, baseURL);
    return;
  }

  // Send categorization message with ONLY AI prompts and parquet file info
  const categorizationMessage = createMystiqueMessage({
    type: GEO_BRAND_CATEGORIZATION_OPPTY_TYPE,
    siteId,
    baseURL,
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    calendarWeek: dateContext,
    url,
    webSearchProvider: null, // Categorization doesn't need a specific provider
    configVersion: /* c8 ignore next */ configExists ? configVersion : null,
    ...(isDaily && { date: dateContext.date }), // Add date only for daily cadence
  });

  // Add parquet file paths to the message so categorization can update them
  categorizationMessage.data.parquetFiles = parquetFiles;

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, categorizationMessage);

  // Store context for step 2 (will be used after categorization completes)
  // This data will be passed to loadCategorizedPromptsAndSendDetection
  // Store in audit result for access by step 2
  audit.setAuditResult({
    ...audit.getAuditResult(),
    providersToUse,
    dateContext,
    configVersion,
    parquetFiles,
  });

  const cadenceLabel = isDaily ? ' DAILY' : '';
  const stepCompleteMsg = 'GEO BRAND PRESENCE%s: Step 1 complete - categorization '
    + 'message sent to Mystique with AI prompts for site id %s (%s)';
  log.info(stepCompleteMsg, cadenceLabel, siteId, baseURL);
  /* c8 ignore end */
}

/**
 * Step 2: Load categorized AI prompts from LLMO config, write to parquet,
 * combine with human prompts, and send detection
 * Triggered by a callback from Mystique when categorization finishes
 */
export async function loadCategorizedPromptsAndSendDetection(
  context,
  getPresignedUrlOverride = getSignedUrl,
) {
  /* c8 ignore start */
  const {
    auditContext, log, sqs, env, site, audit, s3Client, brandPresenceCadence,
  } = context;

  const siteId = site.getId();
  const baseURL = site.getBaseURL();
  const isDaily = brandPresenceCadence === 'daily';

  log.info('GEO BRAND PRESENCE: Step 2 - Loading categorized AI prompts from LLMO config for site id %s (%s)', siteId, baseURL);

  // Get providers, context, and parquet files from step 1 (stored in audit result)
  const auditResult = audit?.getAuditResult();
  const providersToUse = auditResult?.providersToUse ?? WEB_SEARCH_PROVIDERS;
  const dateContext = auditResult?.dateContext ?? auditContext?.calendarWeek;
  const configVersion = auditResult?.configVersion;
  const parquetFiles = auditResult?.parquetFiles ?? auditContext?.parquetFiles;

  if (!isNonEmptyObject(dateContext) || !dateContext.week || !dateContext.year) {
    log.error('GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Invalid date context' };
  }

  if (!Array.isArray(parquetFiles) || !parquetFiles.every((x) => typeof x === 'string')) {
    log.error('GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Invalid parquet files' };
  }

  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';

  // Load LLMO config to get categorized AI prompts and human prompts
  const {
    config,
    exists: configExists,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });

  if (!configExists) {
    log.error('GEO BRAND PRESENCE: LLMO config not found for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'LLMO config not found' };
  }

  // Load AI-categorized prompts from ai_topics (updated by categorization flow)
  const aiCategorizedPrompts = Object.values(config.ai_topics || {}).flatMap((x) => {
    const category = config.categories[x.category];
    return x.prompts.flatMap((p) => p.regions.map((region) => ({
      prompt: p.prompt,
      region,
      category: category.name,
      topic: x.name,
      url: '',
      keyword: '',
      keywordImportTime: -1,
      volume: -1,
      volumeImportTime: -1,
      source: p.origin || 'ai',
      market: p.regions.join(','),
      origin: p.origin || 'ai',
    })));
  });

  log.info('GEO BRAND PRESENCE: Loaded %d AI-categorized prompts from LLMO config for site id %s (%s)', aiCategorizedPrompts.length, siteId, baseURL);

  // Write categorized AI prompts to aggregates location
  if (aiCategorizedPrompts.length > 0) {
    await writeCategorizedPromptsToAggregates({
      aiCategorizedPrompts,
      bucket,
      s3Client,
      siteId,
      dateContext,
      log,
    });
  }

  // Load human prompts from LLMO config (topics)
  const humanPrompts = Object.values(config.topics).flatMap((x) => {
    const category = config.categories[x.category];
    return x.prompts.flatMap((p) => p.regions.map((region) => ({
      prompt: p.prompt,
      region,
      category: category.name,
      topic: x.name,
      url: '',
      keyword: '',
      keywordImportTime: -1,
      volume: -1,
      volumeImportTime: -1,
      source: 'human',
      market: p.regions.join(','),
      origin: 'human',
    })));
  });

  // Combine human and AI prompts from LLMO config
  const allPrompts = humanPrompts.concat(aiCategorizedPrompts);

  log.info('GEO BRAND PRESENCE: Loaded %d human prompts + %d AI prompts from LLMO config = %d total for site id %s (%s)', humanPrompts.length, aiCategorizedPrompts.length, allPrompts.length, siteId, baseURL);

  if (allPrompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No prompts found for site id %s (%s), skipping detection', siteId, baseURL);
    return { status: 'completed', message: 'No prompts to detect' };
  }

  // Upload combined prompts to S3 with presigned URL
  const s3Context = isDaily
    ? {
      ...context, getPresignedUrl: getPresignedUrlOverride, isDaily, dateContext,
    }
    : { ...context, getPresignedUrl: getPresignedUrlOverride };
  const url = await asPresignedJsonUrl(allPrompts, bucket, s3Context);
  log.info('GEO BRAND PRESENCE: Presigned URL for combined prompts for site id %s (%s): %s', siteId, baseURL, url);

  // Determine opportunity types based on cadence
  const opptyTypes = isDaily
    ? [GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE]
    : [GEO_BRAND_PRESENCE_OPPTY_TYPE];

  // Send detection messages for each combination of opportunity type and web search provider
  const detectionMessages = opptyTypes.flatMap((opptyType) => providersToUse.map(
    async (webSearchProvider) => {
      const message = createMystiqueMessage({
        type: opptyType,
        siteId,
        baseURL,
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
        calendarWeek: dateContext,
        url,
        webSearchProvider: transformWebSearchProviderForMystique(webSearchProvider),
        configVersion,
        ...(isDaily && { date: dateContext.date }), // Add date only for daily cadence
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      const cadenceLabel = isDaily ? ' DAILY' : '';
      log.debug('GEO BRAND PRESENCE%s: %s detection message sent to Mystique for site id %s (%s) with provider %s', cadenceLabel, opptyType, siteId, baseURL, webSearchProvider);
    },
  ));

  // Wait for all detection messages to be sent
  await Promise.all(detectionMessages);

  const cadenceLabel = isDaily ? ' DAILY' : '';
  log.info('GEO BRAND PRESENCE%s: Step 2 complete - detection messages sent to Mystique for site id %s (%s)', cadenceLabel, siteId, baseURL);

  return { status: 'completed', message: 'Detection messages sent successfully' };
  /* c8 ignore end */
}

/**
 * Writes categorized AI prompts to aggregates location in S3.
 * Creates new parquet: aggregates/${siteId}/geo-brand-presence/ai-prompts/date=${date}/data.parquet
 * @param {object} options - Options for writing categorized prompts
 * @param {Array<object>} options.aiCategorizedPrompts - Categorized AI prompts from LLMO config
 * @param {string} options.bucket - S3 bucket name
 * @param {S3Client} options.s3Client - S3 client instance
 * @param {string} options.siteId - Site ID for path construction
 * @param {object} options.dateContext - Date context with date, week, year
 * @param {object} options.log - Logger instance
 */
/**
 * Convert an array of objects to column data format for parquet writing
 * @param {Array<Object>} objects - Array of objects to convert
 * @returns {Array<Object>} Column data array
 */
function objectsToColumnData(objects) {
  /* c8 ignore start */
  if (!objects || objects.length === 0) {
    return [];
  }

  // Get all keys from the first object to determine columns
  const keys = Object.keys(objects[0]);
  const columnData = {};

  // Initialize column data structure
  keys.forEach((key) => {
    const sampleValue = objects[0][key];
    let type = 'STRING'; // Default type

    // Determine type based on value
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

  // Fill column data with values
  objects.forEach((obj) => {
    keys.forEach((key) => {
      columnData[key].data.push(obj[key]);
    });
  });

  return Object.values(columnData);
  /* c8 ignore end */
}

export async function writeCategorizedPromptsToAggregates({
  aiCategorizedPrompts,
  bucket,
  s3Client,
  siteId,
  dateContext,
  log,
}) {
  /* c8 ignore start */
  try {
    // Extract date from dateContext (for daily) or calculate from week/year
    const dateStr = dateContext.date
      // YYYY-MM-DD format for daily
      || new Date().toISOString().split('T')[0]; // Use current date for weekly

    // Construct S3 key with Hive-style partitioning
    const s3Key = `aggregates/${siteId}/geo-brand-presence/ai-prompts/date=${dateStr}/data.parquet`;

    log.info('GEO BRAND PRESENCE: Writing %d categorized AI prompts to %s', aiCategorizedPrompts.length, s3Key);

    // Convert objects to column data format
    const columnData = objectsToColumnData(aiCategorizedPrompts);

    // Write categorized prompts to parquet
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
 * Loads Parquet data from S3 and returns the parsed data.
 * @param {object} options - Options for loading Parquet data.
 * @param {string} options.key - The S3 object key for the Parquet file.
 * @param {string} options.bucket - The S3 bucket name.
 * @param {S3Client} options.s3Client - The S3 client instance.
 * @return {Promise<Array<Record<string, unknown>>>}
 */
export async function loadParquetDataFromS3({ key, bucket, s3Client }) {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToByteArray();
  /* c8 ignore start */
  if (!body) {
    throw new Error(`Failed to read Parquet file from s3://${bucket}/${key}`);
  }
  /* c8 ignore end */

  return parquetReadObjects({ file: body.buffer });
}

export async function asPresignedJsonUrl(data, bucketName, context) {
  const {
    s3Client, log, getPresignedUrl: getPresignedUrlFn, isDaily, dateContext,
  } = context;

  // Use daily-specific path if daily cadence
  const basePath = isDaily ? 'temp/audit-geo-brand-presence-daily' : 'temp/audit-geo-brand-presence';
  const dateStr = isDaily ? dateContext.date : new Date().toISOString().split('T')[0];
  const key = `${basePath}/${dateStr}-${randomUUID()}.json`;
  await s3Client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: JSON.stringify(data),
    ContentType: 'application/json',
  }));

  log.info('GEO BRAND PRESENCE: Data uploaded to S3 at s3://%s/%s', bucketName, key);
  return getPresignedUrlFn(
    s3Client,
    new GetObjectCommand({ Bucket: bucketName, Key: key }),
    { expiresIn: 86_400 /* seconds, 24h */ },
  );
}

export async function keywordPromptsImportStep(context) {
  const {
    site,
    data,
    finalUrl,
    log,
    brandPresenceCadence,
  } = context;

  let endDate;
  let aiPlatform;
  let referenceDate;

  if (isString(data) && data.length > 0) {
    try {
      // Try to parse as JSON first (for new format with endDate, aiPlatform, and referenceDate)
      const parsedData = JSON.parse(data);
      if (isNonEmptyObject(parsedData)) {
        if (parsedData.endDate && Date.parse(parsedData.endDate)) {
          endDate = parsedData.endDate;
        }
        if (parsedData.referenceDate && Date.parse(parsedData.referenceDate)) {
          referenceDate = parsedData.referenceDate;
        }
        aiPlatform = parsedData.aiPlatform;
      }
    } catch (e) {
      // If JSON parsing fails, treat as a date string (legacy behavior)
      if (Date.parse(data)) {
        endDate = data;
      } else {
        log.warn('GEO BRAND PRESENCE: Could not parse data as JSON or date string: %s', data);
      }
    }
  }

  // For daily cadence, always set referenceDate (default to current date for traceability)
  if (brandPresenceCadence === 'daily' && !referenceDate) {
    referenceDate = new Date().toISOString();
  }

  log.debug('GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s, referenceDate: %s', finalUrl, endDate, aiPlatform, referenceDate);
  const result = {
    type: LLMO_QUESTIONS_IMPORT_TYPE,
    endDate,
    siteId: site.getId(),
    // auditResult can't be empty, so sending empty array and include aiPlatform
    auditResult: { keywordQuestions: [], aiPlatform },
    fullAuditRef: finalUrl,
  };

  // Add referenceDate if specified (always present for daily audits)
  if (referenceDate) {
    result.auditResult.referenceDate = referenceDate;
  }

  // Add cadence if specified
  if (brandPresenceCadence) {
    result.auditResult.cadence = brandPresenceCadence;
  }

  return result;
}

/**
 * Creates a message object for sending to Mystique.
 * @param {object} params - Message parameters
 * @param {string} params.type - The opportunity type
 * @param {string} params.siteId - The site ID
 * @param {string} params.baseURL - The base URL
 * @param {string} params.auditId - The audit ID
 * @param {string} params.deliveryType - The delivery type
 * @param {ISOCalendarWeek} params.calendarWeek - The calendar week object
 * @param {string} params.url - The presigned URL for data
 * @param {string} params.webSearchProvider - The web search provider
 * @param {null | string} [params.configVersion] - The configuration version
 * @param {null | string} [params.date] - The date string (for daily cadence)
 * @returns {object} The message object
 */
export function createMystiqueMessage({
  type,
  siteId,
  baseURL,
  auditId,
  deliveryType,
  calendarWeek,
  url,
  webSearchProvider,
  configVersion = null,
  date = null,
  source = undefined,
  initiator = undefined,
}) {
  const data = {
    url,
    configVersion,
    config_version: configVersion, // @todo remove after mystique supports configVersion
    web_search_provider: webSearchProvider,
  };

  // Add date if present (daily-specific)
  if (date) {
    data.date = date;
  }

  return {
    type,
    siteId,
    url: baseURL,
    auditId,
    deliveryType,
    time: new Date().toISOString(),
    week: calendarWeek.week,
    year: calendarWeek.year,
    data,
    ...(source && { source }),
    ...(initiator && { initiator }),
  };
}

// Note: Step 2 (loadCategorizedPromptsAndSendDetection) is NOT added here as a step.
// Instead, it will be triggered by a direct callback from Mystique when categorization completes.
// The audit worker will need a separate handler/route to receive this callback and execute step 2.
export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('loadPromptsAndSendCategorizationStep', loadPromptsAndSendCategorization)
  .build();
