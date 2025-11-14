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
/**
 * Geo Brand Presence Audit - Multi-Step Workflow
 * =============================================
 *
 * This audit evaluates brand presence in AI-powered search results
 * using a 3-step process:
 *
 * STEP 0: Import (runs in import-worker via keywordPromptsImportStep)
 *   - Fetches keyword data from Ahrefs API
 *   - Generates AI prompts from keywords + URL combinations
 *   - Writes prompts to partitioned parquet files: metrics/${siteId}/llmo-prompts-ahrefs/...
 *   - Returns parquetFiles array for use in Step 1
 *
 * STEP 1: Load Prompts & Send to Categorization (loadPromptsAndSendCategorization)
 *   - Reads AI prompts from parquet files
 *   - Deduplicates AI prompts
 *   - Uploads AI prompts as JSON with presigned URL (24h expiry)
 *   - Sends categorization message to Mystique (always, even if prompts empty)
 *   - Mystique filters out already-categorized prompts internally, categorizes
 *     the rest and includes them in callback
 *   - Stores context (config version, providers, etc.) in audit result for Step 2
 *
 * STEP 2: Detection (loadCategorizedPromptsAndSendDetection)
 *   - Triggered by callback from Mystique after categorization completes
 *   - Receives categorized AI prompts via presigned URL in callback message
 *   - Downloads categorized AI prompts from presigned URL
 *   - Writes categorized AI prompts to aggregates/ parquet for analytics
 *   - Loads human prompts from LLMO config (topics) using locked config version
 *   - Combines AI (from callback) + human prompts (from config)
 *   - Uploads combined prompts as JSON with presigned URL
 *   - Sends detection messages to Mystique (one per web search provider)
 *
 * Data Flow:
 *   Parquet (metrics/) → AI prompts → Deduplicate →
 *   JSON (temp/) → Mystique categorization → Callback with categorized prompts →
 *   Categorized AI prompts written to Parquet (aggregates/) for analytics +
 *   LLMO config → Human prompts → Combined prompts → JSON (temp/) → Detection → Results
 *
 * Config Version Locking:
 *   Step 1 locks the config version X. Step 2 uses the same version X to read human prompts,
 *   ensuring consistency even if Mystique creates version X+1 during categorization.
 *
 * Note: Step 2 is NOT a regular audit step. It's triggered externally via callback
 * when categorization completes, allowing the categorization to run asynchronously.
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

// ============================================================================
// STEP 1: CATEGORIZATION
// ============================================================================

/**
 * Loads AI prompts from parquet files and sends them to Mystique for categorization.
 *
 * This is the first audit step after import. It:
 * - Reads AI prompts from parquet files (paths provided by import step)
 * - Filters to only AI prompts (human prompts don't need categorization)
 * - Uploads prompts as JSON to temp/ location with presigned URL
 * - Sends async categorization message to Mystique
 * - Stores context for Step 2 (which runs after categorization completes)
 *
 * The function returns immediately after sending the message. Step 2 will be
 * triggered separately by a callback when Mystique finishes categorization.
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

  const auditResult = audit?.getAuditResult();
  const aiPlatform = auditResult?.aiPlatform;

  let dailyDateContext;
  if (isDaily) {
    const referenceDate = auditResult?.referenceDate
      || context.data?.referenceDate
      || auditContext?.referenceDate
      || new Date();
    const date = new Date(referenceDate);
    date.setUTCDate(date.getUTCDate() - 1);

    const { week, year } = isoCalendarWeek(date);

    dailyDateContext = {
      date: date.toISOString().split('T')[0],
      week,
      year,
    };
  }

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

  aiPrompts = deduplicatePrompts(aiPrompts, siteId, log);

  const {
    exists: configExists,
    version: configVersion,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });

  log.info('GEO BRAND PRESENCE: Found %d AI prompts (after dedup) to categorize for site id %s (%s)', aiPrompts.length, siteId, baseURL);

  // Always send categorization message (even with empty prompts) to trigger callback flow
  // This ensures Step 2 (detection) runs even when all prompts are already categorized
  if (aiPrompts.length === 0) {
    log.info('GEO BRAND PRESENCE: No uncategorized AI prompts for site id %s (%s), sending empty categorization request to trigger callback flow', siteId, baseURL);
  }

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

  // Mystique's main_brand_categorization_flow.py consumes this message asynchronously.
  // No waiting needed - Step 2 (detection) is triggered separately via callback
  // after categorization completes.
  const categorizationMessage = createMystiqueMessage({
    type: GEO_BRAND_CATEGORIZATION_OPPTY_TYPE,
    siteId,
    baseURL,
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    calendarWeek: dateContext,
    url,
    webSearchProvider: null,
    configVersion: /* c8 ignore next */ configExists ? configVersion : null,
    ...(isDaily && { date: dateContext.date }),
  });

  categorizationMessage.data.parquetFiles = parquetFiles;

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, categorizationMessage);

  // Store context for Step 2 (triggered by callback after categorization completes)
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

// ============================================================================
// STEP 2: DETECTION
// ============================================================================

/**
 * Loads categorized prompts and sends them to Mystique for detection.
 *
 * This step is triggered by a callback from Mystique after categorization completes. It:
 * - Receives categorized AI prompts via presigned URL in callback message data
 * - Downloads categorized AI prompts from the presigned URL
 * - Loads human prompts from LLMO config (using locked config version from Step 1)
 * - Writes categorized AI prompts to aggregates/ for analytics
 * - Combines AI (from callback) + human (from config) prompts
 * - Uploads combined prompts as JSON with presigned URL
 * - Sends detection messages (one per web search provider)
 *
 * Unlike Step 1, this is NOT part of the regular audit flow - it's invoked externally.
 */
export async function loadCategorizedPromptsAndSendDetection(
  context,
  getPresignedUrlOverride = getSignedUrl,
) {
  /* c8 ignore start */
  const {
    auditContext, log, sqs, env, site, audit, s3Client, brandPresenceCadence, data,
  } = context;

  const siteId = site.getId();
  const baseURL = site.getBaseURL();
  const isDaily = brandPresenceCadence === 'daily';

  log.info('GEO BRAND PRESENCE: Step 2 - Loading categorized AI prompts from callback for site id %s (%s)', siteId, baseURL);

  const auditResult = audit?.getAuditResult();
  const providersToUse = auditResult?.providersToUse ?? WEB_SEARCH_PROVIDERS;
  const dateContext = auditResult?.dateContext ?? auditContext?.calendarWeek;
  const lockedConfigVersion = auditResult?.configVersion;
  const parquetFiles = auditResult?.parquetFiles ?? auditContext?.parquetFiles;

  if (!isNonEmptyObject(dateContext) || !dateContext.week || !dateContext.year) {
    log.error('GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Invalid date context' };
  }

  if (!Array.isArray(parquetFiles) || !parquetFiles.every((x) => typeof x === 'string')) {
    log.error('GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Invalid parquet files' };
  }

  // Check if categorization had an error
  if (data?.error || context.data?.error) {
    log.error('GEO BRAND PRESENCE: Categorization failed for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Categorization failed' };
  }

  // Get categorized prompts URL from callback message
  const categorizedPromptsUrl = data?.categorizedPromptsUrl || context.data?.url;
  if (!categorizedPromptsUrl) {
    log.error('GEO BRAND PRESENCE: No categorizedPromptsUrl in callback for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'Missing categorizedPromptsUrl in callback' };
  }

  // Download categorized AI prompts from presigned URL (sent by Mystique)
  log.info('GEO BRAND PRESENCE: Downloading categorized AI prompts from %s', categorizedPromptsUrl);
  let aiCategorizedPrompts = [];
  try {
    const response = await fetch(categorizedPromptsUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch categorized prompts: ${response.status} ${response.statusText}`);
    }
    const responseData = await response.json();
    aiCategorizedPrompts = responseData.prompts || responseData || [];
    log.info('GEO BRAND PRESENCE: Downloaded %d categorized AI prompts from callback for site id %s (%s)', aiCategorizedPrompts.length, siteId, baseURL);
  } catch (error) {
    log.error('GEO BRAND PRESENCE: Failed to download categorized prompts from %s: %s', categorizedPromptsUrl, error.message);
    return { status: 'error', message: `Failed to download categorized prompts: ${error.message}` };
  }

  // Write categorized AI prompts to aggregates/ for analytics
  // This is the FINAL upload location. Mystique sent these via temp/ transfer location.
  if (aiCategorizedPrompts.length > 0) {
    await writeCategorizedPromptsToAggregates({
      aiCategorizedPrompts,
      bucket: context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '',
      s3Client,
      siteId,
      dateContext,
      log,
    });
  }

  // Load human prompts from LLMO config using the locked version from Step 1
  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';
  const configOptions = { s3Bucket: bucket };
  if (lockedConfigVersion) {
    configOptions.version = lockedConfigVersion;
    log.info('GEO BRAND PRESENCE: Reading LLMO config version %s (locked from Step 1)', lockedConfigVersion);
  }

  const {
    config,
    exists: configExists,
  } = await llmoConfig.readConfig(siteId, s3Client, configOptions);

  if (!configExists) {
    log.error('GEO BRAND PRESENCE: LLMO config not found for site id %s (%s). Cannot proceed with detection', siteId, baseURL);
    return { status: 'error', message: 'LLMO config not found' };
  }

  const humanPrompts = Object.values(config.topics || {}).flatMap((x) => {
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

  const allPrompts = humanPrompts.concat(aiCategorizedPrompts);

  log.info(
    'GEO BRAND PRESENCE: Combined %d human prompts (from config v%s) + %d AI prompts (from callback) = %d total for site id %s (%s)',
    humanPrompts.length,
    lockedConfigVersion || 'latest',
    aiCategorizedPrompts.length,
    allPrompts.length,
    siteId,
    baseURL,
  );

  if (allPrompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No prompts found for site id %s (%s), skipping detection', siteId, baseURL);
    return { status: 'completed', message: 'No prompts to detect' };
  }

  const s3Context = isDaily
    ? {
      ...context, getPresignedUrl: getPresignedUrlOverride, isDaily, dateContext,
    }
    : { ...context, getPresignedUrl: getPresignedUrlOverride };
  const url = await asPresignedJsonUrl(allPrompts, bucket, s3Context);
  log.info('GEO BRAND PRESENCE: Presigned URL for combined prompts for site id %s (%s): %s', siteId, baseURL, url);

  const opptyTypes = isDaily
    ? [GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE]
    : [GEO_BRAND_PRESENCE_OPPTY_TYPE];

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
        configVersion: lockedConfigVersion,
        ...(isDaily && { date: dateContext.date }),
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      const cadenceLabel = isDaily ? ' DAILY' : '';
      log.debug('GEO BRAND PRESENCE%s: %s detection message sent to Mystique for site id %s (%s) with provider %s', cadenceLabel, opptyType, siteId, baseURL, webSearchProvider);
    },
  ));

  await Promise.all(detectionMessages);

  const cadenceLabel = isDaily ? ' DAILY' : '';
  log.info('GEO BRAND PRESENCE%s: Step 2 complete - detection messages sent to Mystique for site id %s (%s)', cadenceLabel, siteId, baseURL);

  return { status: 'completed', message: 'Detection messages sent successfully' };
  /* c8 ignore end */
}

// ============================================================================
// PARQUET UTILITIES
// ============================================================================

/**
 * Converts row-based data to column-based format required by hyparquet-writer.
 * Infers column types from first row values.
 */
function objectsToColumnData(objects) {
  /* c8 ignore start */
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
 * Creates: aggregates/${siteId}/geo-brand-presence/ai-prompts/date=${date}/data.parquet
 */
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
 * Loads and parses parquet file from S3.
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

// ============================================================================
// DATA TRANSFER UTILITIES
// ============================================================================

/**
 * Uploads data as JSON to S3 and returns a presigned URL (24h expiry).
 * Used to pass prompt data to Mystique via temporary JSON files.
 */
export async function asPresignedJsonUrl(data, bucketName, context) {
  const {
    s3Client, log, getPresignedUrl: getPresignedUrlFn, isDaily, dateContext,
  } = context;

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
    { expiresIn: 86_400 },
  );
}

// ============================================================================
// STEP 0: IMPORT COORDINATION
// ============================================================================

/**
 * Coordinates with import-worker to fetch and store keyword prompts.
 * Returns import job details that trigger the actual import in import-worker.
 */
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
      if (Date.parse(data)) {
        endDate = data;
      } else {
        log.warn('GEO BRAND PRESENCE: Could not parse data as JSON or date string: %s', data);
      }
    }
  }

  if (brandPresenceCadence === 'daily' && !referenceDate) {
    referenceDate = new Date().toISOString();
  }

  log.debug('GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s, referenceDate: %s', finalUrl, endDate, aiPlatform, referenceDate);
  const result = {
    type: LLMO_QUESTIONS_IMPORT_TYPE,
    endDate,
    siteId: site.getId(),
    auditResult: { keywordQuestions: [], aiPlatform },
    fullAuditRef: finalUrl,
  };

  if (referenceDate) {
    result.auditResult.referenceDate = referenceDate;
  }

  if (brandPresenceCadence) {
    result.auditResult.cadence = brandPresenceCadence;
  }

  return result;
}

// ============================================================================
// MESSAGE CONSTRUCTION
// ============================================================================

/**
 * Creates a standardized message for Mystique SQS queue.
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
    config_version: configVersion,
    web_search_provider: webSearchProvider,
  };

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

// ============================================================================
// AUDIT REGISTRATION
// ============================================================================

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('loadPromptsAndSendCategorizationStep', loadPromptsAndSendCategorization)
  .build();
