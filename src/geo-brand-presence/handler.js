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
 * ============================================
 * Geo Brand Presence Audit - workflow
 * ============================================
 * STEP 0: Import (runs in import-worker via keywordPromptsImportStep)
 *   - Fetches keyword data from Ahrefs API
 *   - Generates AI prompts from keywords + URL combinations
 *   - Writes prompts to partitioned parquet files: metrics/${siteId}/llmo-prompts-ahrefs/...
 *   - Returns parquetFiles array for use in Step 1
 *
 * STEP 1: Unified Detection (loadPromptsAndSendDetection)
 *   - Reads AI prompts from parquet files
 *   - Deduplicates AI prompts
 *   - Loads human prompts from LLMO config
 *   - Combines AI + human prompts
 *   - Uploads combined prompts as JSON with presigned URL (24h expiry)
 *   - Sends Detection messages directly to Mystique (one per web search provider)
 *   - Mystique conditionally categorizes AI prompts if needed (inline)
 *
 * STEP 2: Receive Categorization Status (receiveCategorization)
 *   - Receives categorization status message from Mystique via SQS
 *   - Downloads categorized prompts from presigned URL
 *   - Writes categorized prompts to aggregates parquet for analytics
 *   - Returns (detection continues independently in Mystique)
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
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { getSignedUrl } from '../utils/getPresignedUrl.js';
import {
  transformWebSearchProviderForMystique,
  checkJsonEnrichmentNeeded,
  saveEnrichmentMetadata,
  saveEnrichmentJson,
  acquireEnrichmentLock,
  URL_ENRICHMENT_TYPE,
} from './util.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const LLMO_QUESTIONS_IMPORT_TYPE = 'llmo-prompts-ahrefs';
export const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'detect:geo-brand-presence';
export const GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE = 'detect:geo-brand-presence-daily';
export const GEO_BRAND_CATEGORIZATION_OPPTY_TYPE = 'category:geo-brand-presence';
export const GEO_FAQ_OPPTY_TYPE = 'guidance:geo-faq';
export const OPPTY_TYPES = [
  GEO_BRAND_PRESENCE_OPPTY_TYPE,
  GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE,
  GEO_BRAND_CATEGORIZATION_OPPTY_TYPE,
];

export const WEB_SEARCH_PROVIDERS = [
  'all',
  'chatgpt',
  'gemini',
  'google_ai_overviews',
  'ai_mode',
  'perplexity',
  'copilot',
];

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
        const prompt = item.prompt || '';
        const region = (item.region || item.market || 'US').toLowerCase();
        const topic = (item.topic || item.keyword || '').toLowerCase();

        if (!prompt || prompt.trim().length === 0) {
          totalEmptyPromptsSkipped += 1;
          log.debug(`GEO BRAND PRESENCE: [DEDUP] Skipping empty prompt at index ${i}: region='${region}', topic='${topic}'`);
        } else {
          const regionTopicKey = `${region}:${topic}`;
          const promptKey = prompt.toLowerCase().trim();

          if (!regionTopicGroups.has(regionTopicKey)) {
            regionTopicGroups.set(regionTopicKey, {
              seenPrompts: new Set(),
              originalCount: 0,
            });
          }

          const group = regionTopicGroups.get(regionTopicKey);
          group.originalCount += 1;

          if (group.seenPrompts.has(promptKey)) {
            totalDuplicatesRemoved += 1;
            const truncatedPrompt = prompt.length > 50 ? `${prompt.substring(0, 50)}...` : prompt;
            log.debug(`GEO BRAND PRESENCE: Skipping duplicate prompt at index ${i}: region='${region}', topic='${topic}', prompt='${truncatedPrompt}'`);
          } else {
            group.seenPrompts.add(promptKey);
            deduplicatedPrompts.push(item);
          }
        }
      }
    } catch (error) {
      totalErrorsRecovered += 1;
      log.error(`GEO BRAND PRESENCE: Deduplication error processing item at index ${i}:`, error);
      deduplicatedPrompts.push(item);
    }
  }

  const finalCount = deduplicatedPrompts.length;
  const totalSkipped = totalDuplicatesRemoved + totalEmptyPromptsSkipped + totalInvalidItemsSkipped;
  const skipRate = originalCount > 0 ? ((totalSkipped / originalCount) * 100).toFixed(1) : 0;

  log.info(
    'GEO BRAND PRESENCE: Site %s: Processed %d prompts across %d region/topic groups. Skipped %d items (%s%%): %d duplicates, %d empty, %d invalid. Recovered from %d errors. Kept %d unique prompts.',
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

  if (log.debug) {
    regionTopicGroups.forEach((group, key) => {
      const [region, topic] = key.split(':');
      const keptCount = group.seenPrompts.size;
      const removedCount = group.originalCount - keptCount;
      if (removedCount > 0) {
        log.debug(`GEO BRAND PRESENCE: Group '${region}/${topic}': ${group.originalCount} → ${keptCount} (removed ${removedCount})`);
      }
    });
  }
  /* c8 ignore end */
  return deduplicatedPrompts;
}

/**
 * Loads prompts and sends categorization messages for brand presence detection.
 *
 * @param {Object} context - The execution context including audit, logging, site info, etc.
 * @param {Function} [getPresignedUrlOverride=getSignedUrl]
 * - (Optional) Override for generating presigned URLs.
 * @returns {Promise<void>}
 */
export async function loadPromptsAndSendDetection(
  context,
  getPresignedUrlOverride = getSignedUrl,
) {
  /* c8 ignore start */
  const {
    // eslint-disable-next-line no-unused-vars
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

  // When import fails (success === false), continue with human prompts only.
  // This allows graceful degradation when Ahrefs API is unavailable.
  const importFailed = success === false;
  if (importFailed) {
    log.warn('GEO BRAND PRESENCE: Import failed for site id %s (%s). Continuing with human prompts only.', siteId, baseURL);
  }

  // For weekly cadence, validate calendarWeek; for daily, use dailyDateContext
  const dateContext = isDaily ? dailyDateContext : calendarWeek;
  if (!isNonEmptyObject(dateContext) || !dateContext.week || !dateContext.year) {
    log.error('GEO BRAND PRESENCE: Invalid date context for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }
  if (!importFailed && (!Array.isArray(parquetFiles) || !parquetFiles.every((x) => typeof x === 'string'))) {
    log.error('GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }

  log.debug('GEO BRAND PRESENCE: Unified step - Loading AI prompts from parquet and human prompts from config for site id %s (%s)', siteId, baseURL);

  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';

  // Load AI prompts from parquet (skip if import failed)
  let aiPrompts = [];
  if (!importFailed && parquetFiles?.length > 0) {
    const recordSets = await Promise.all(
      parquetFiles.map((key) => loadParquetDataFromS3({ key, bucket, s3Client })),
    );
    aiPrompts = recordSets.flat();
  }
  for (const x of aiPrompts) {
    x.market = x.region; // TODO(aurelio): remove when .region is supported by Mystique
    x.origin = x.source; // TODO(aurelio): remove when we decided which one to pick
  }

  log.debug('GEO BRAND PRESENCE: Loaded %d AI prompts from parquet for site id %s (%s)', aiPrompts.length, siteId, baseURL);

  aiPrompts = deduplicatePrompts(aiPrompts, siteId, log);

  // Load LLMO config to get human prompts and config version
  const {
    config,
    exists: configExists,
    version: configVersion,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });

  log.info('GEO BRAND PRESENCE: Found %d AI prompts (after dedup) for site id %s (%s)', aiPrompts.length, siteId, baseURL);

  // Load human prompts from LLMO config
  let humanPrompts = [];
  if (configExists && config) {
    humanPrompts = Object.values(config.topics || {}).flatMap((x) => {
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
    log.info('GEO BRAND PRESENCE: Loaded %d human prompts from config for site id %s (%s)', humanPrompts.length, siteId, baseURL);
  }

  // Combine AI and human prompts
  const allPrompts = humanPrompts.concat(aiPrompts);
  log.info(
    'GEO BRAND PRESENCE: Combined %d human + %d AI prompts = %d total for site id %s (%s)',
    humanPrompts.length,
    aiPrompts.length,
    allPrompts.length,
    siteId,
    baseURL,
  );

  if (allPrompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No prompts found for site id %s (%s), skipping detection', siteId, baseURL);
    return;
  }

  if (!isNonEmptyArray(providersToUse)) {
    log.warn('GEO BRAND PRESENCE: No web search providers configured for site id %s (%s), skipping', siteId, baseURL);
    return;
  }

  // Check if any prompts need URL enrichment
  const { needsEnrichment, indicesToEnrich } = checkJsonEnrichmentNeeded(allPrompts);
  const cadenceLabel = isDaily ? ' DAILY' : '';

  if (needsEnrichment) {
    // Trigger async JSON enrichment before sending to Mystique
    log.info(
      'GEO BRAND PRESENCE%s: %d prompts need URL enrichment for site id %s (%s)',
      cadenceLabel,
      indicesToEnrich.length,
      siteId,
      baseURL,
    );

    const enrichmentTriggered = await triggerJsonEnrichment({
      allPrompts,
      indicesToEnrich,
      siteId,
      auditId: audit.getId(),
      baseURL,
      deliveryType: site.getDeliveryType(),
      dateContext,
      providersToUse,
      isDaily,
      configVersion,
      configExists,
      bucket,
    }, context);

    if (enrichmentTriggered) {
      log.info(
        'GEO BRAND PRESENCE%s: JSON enrichment triggered for site id %s (%s) - Mystique will be called after enrichment',
        cadenceLabel,
        siteId,
        baseURL,
      );
      return;
    }

    // Fallback: enrichment failed to trigger, send directly to Mystique
    log.warn(
      'GEO BRAND PRESENCE%s: Failed to trigger enrichment for site id %s (%s), sending directly to Mystique',
      cadenceLabel,
      siteId,
      baseURL,
    );
  }

  // No enrichment needed OR fallback: send directly to Mystique
  await sendPromptsToMystique({
    allPrompts,
    siteId,
    auditId: audit.getId(),
    baseURL,
    deliveryType: site.getDeliveryType(),
    dateContext,
    providersToUse,
    isDaily,
    configVersion,
    configExists,
    bucket,
  }, context, getPresignedUrlOverride);

  log.info(
    'GEO BRAND PRESENCE%s: Detection messages sent directly to Mystique for site id %s (%s)',
    cadenceLabel,
    siteId,
    baseURL,
  );
  /* c8 ignore end */
}

/**
 * Triggers async JSON enrichment before sending to Mystique.
 * Saves prompts and metadata to S3, then sends SQS message to start batch processing.
 *
 * @param {Object} params - Parameters for enrichment
 * @param {Object} context - The context object
 * @returns {Promise<boolean>} True if enrichment was triggered successfully
 */
async function triggerJsonEnrichment(params, context) {
  const {
    allPrompts,
    indicesToEnrich,
    siteId,
    auditId,
    baseURL,
    deliveryType,
    dateContext,
    providersToUse,
    isDaily,
    configVersion,
    configExists,
    bucket,
  } = params;

  const {
    log, sqs, s3Client, dataAccess,
  } = context;

  try {
    // Create a lock ID based on week/year to prevent concurrent enrichments
    const lockId = `w${dateContext.week}-${dateContext.year}${isDaily ? `-${dateContext.date}` : ''}`;

    // Try to acquire enrichment lock (Safeguard #2)
    const lockResult = await acquireEnrichmentLock(
      s3Client,
      bucket,
      siteId,
      lockId,
      auditId,
      log,
    );

    if (!lockResult.acquired) {
      log.info(
        'GEO BRAND PRESENCE: Enrichment lock not acquired for site %s, another enrichment in progress',
        siteId,
      );
      return false; // Fallback to direct send
    }

    // Save prompts to S3
    await saveEnrichmentJson(s3Client, bucket, auditId, allPrompts);

    // Save metadata to S3
    const metadata = {
      auditId,
      siteId,
      lockId,
      baseURL,
      deliveryType,
      dateContext,
      providersToUse,
      isDaily,
      configVersion,
      configExists,
      indicesToEnrich,
      totalPrompts: allPrompts.length,
      createdAt: new Date().toISOString(),
    };
    await saveEnrichmentMetadata(s3Client, bucket, metadata);

    // Send initial enrichment message to SQS
    const { Configuration } = dataAccess;
    const configuration = await Configuration.findLatest();

    await sqs.sendMessage(configuration.getQueues().audits, {
      type: URL_ENRICHMENT_TYPE,
      auditId,
      siteId,
      batchStart: 0,
    });

    return true;
  } catch (error) {
    log.error(
      'GEO BRAND PRESENCE: Error triggering JSON enrichment for site %s: %s',
      siteId,
      error.message,
    );
    return false;
  }
}

/**
 * Sends prompts directly to Mystique (no enrichment).
 * Used when no enrichment is needed or as fallback.
 *
 * @param {Object} params - Parameters for sending
 * @param {Object} context - The context object
 * @param {Function} getPresignedUrlOverride - Optional presigned URL override
 */
async function sendPromptsToMystique(params, context, getPresignedUrlOverride) {
  const {
    allPrompts,
    siteId,
    auditId,
    baseURL,
    deliveryType,
    dateContext,
    providersToUse,
    isDaily,
    configVersion,
    configExists,
    bucket,
  } = params;

  const { log, sqs, env } = context;

  const s3Context = isDaily
    ? {
      ...context, getPresignedUrl: getPresignedUrlOverride, isDaily, dateContext,
    }
    : { ...context, getPresignedUrl: getPresignedUrlOverride };

  const url = await asPresignedJsonUrl(allPrompts, bucket, s3Context);

  const opptyTypes = isDaily
    ? [GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE]
    : [GEO_BRAND_PRESENCE_OPPTY_TYPE];

  const detectionMessages = opptyTypes.flatMap((opptyType) => providersToUse.map(
    async (webSearchProvider) => {
      const message = createMystiqueMessage({
        type: opptyType,
        siteId,
        baseURL,
        auditId,
        deliveryType,
        calendarWeek: dateContext,
        url,
        webSearchProvider: transformWebSearchProviderForMystique(webSearchProvider),
        configVersion: configExists ? configVersion : null,
        ...(isDaily && { date: dateContext.date }),
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.debug(
        'GEO BRAND PRESENCE: Detection message sent to Mystique for site %s with provider %s',
        siteId,
        webSearchProvider,
      );
    },
  ));

  await Promise.all(detectionMessages);
}

/**
 * Loads and parses a Parquet file from S3 into JavaScript objects.
 *
 * @param {Object} params - The parameters object.
 * @param {string} params.key - The S3 key of the Parquet file.
 * @param {string} params.bucket - The S3 bucket name.
 * @param {AWS.S3Client} params.s3Client - The AWS S3 client instance.
 * @returns {Promise<AsyncGenerator<Object>>}
 * - An async generator yielding objects from the Parquet file.
 * @throws {Error} If the Parquet file cannot be read from S3.
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

/**
 * Uploads arbitrary data as a JSON file to S3 and generates a presigned URL with 24h expiry.
 *
 * This utility is used to pass prompt data or structured JSON to Mystique by persisting it
 * as a temporary JSON file in S3. The returned presigned URL allows Mystique to securely
 * retrieve the JSON content within a limited time window.
 *
 * @param {Object} data - The data to serialize and upload as JSON.
 * @param {string} bucketName - The name of the S3 bucket to use.
 * @param {Object} context - Context object. Should contain:
 *   - {AWS.S3Client} s3Client - AWS S3 client instance.
 *   - {Function} getPresignedUrl - Function to generate S3 presigned URLs.
 *   - {Object} log - Logger instance.
 *   - {boolean} isDaily - Whether this is for daily cadence (affects S3 path).
 *   - {Object} dateContext - The date context used for the file path.
 * @returns {Promise<string>} - A promise that resolves to a presigned S3 URL (valid for 24 hours).
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

/**
 * Creates a standardized message for Mystique SQS queue.
 *
 * @param {Object} params - The parameters for the message.
 * @param {string} params.type - The opportunity type for the message.
 * @param {string} params.siteId - The unique identifier for the site.
 * @param {string} params.baseURL - The base URL for the site.
 * @param {string} params.auditId - The audit identifier.
 * @param {string} params.deliveryType - The delivery type for the site.
 * @param {Object} params.calendarWeek - The calendar week info (week, year).
 * @param {string} params.url - The target URL for detection.
 * @param {string} params.webSearchProvider - The search provider.
 * @param {string|null} [params.configVersion=null] - The config version, if present.
 * @param {string|null} [params.date=null] - The date for daily cadence (YYYY-MM-DD), if present.
 * @param {string|undefined} [params.source] - Optional source for the message.
 * @param {string|undefined} [params.initiator] - Optional initiator for the message.
 * @returns {Object} - The formatted message payload for Mystique queue.
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

/**
 * Coordinates with import-worker to fetch and store keyword prompts.
 * Returns import job details that trigger the actual import in import-worker.
 *
 * @param {Object} context - The execution context.
 * @param {Object} context.site - The site object.
 * @param {string|Object} context.data
 * - The data string or object, may contain endDate, referenceDate, aiPlatform.
 * @param {string} context.finalUrl - The final URL for the audit.
 * @param {Object} context.log - The logger instance.
 * @param {string} context.brandPresenceCadence - The cadence of brand presence, e.g., 'daily'.
 * @returns {Object} The import job details to trigger import in import-worker.
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

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('loadPromptsAndSendDetectionStep', loadPromptsAndSendDetection)
  .build();
