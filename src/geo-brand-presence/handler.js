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
  isObject,
} from '@adobe/spacecat-shared-utils';
import { parquetReadObjects } from 'hyparquet';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { transformWebSearchProviderForMystique } from './util.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
export const LLMO_QUESTIONS_IMPORT_TYPE = 'llmo-prompts-ahrefs';
export const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'detect:geo-brand-presence';
export const GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE = 'detect:geo-brand-presence-daily';
export const GEO_FAQ_OPPTY_TYPE = 'guidance:geo-faq';
export const OPPTY_TYPES = [
  GEO_BRAND_PRESENCE_OPPTY_TYPE,
  GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE,
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
 * @returns {Array<Object>} Deduplicated array of prompts
 */
function deduplicatePrompts(prompts) {
  /* c8 ignore start */
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return prompts;
  }

  const result = prompts
    .filter((item) => isObject(item))
    .reduce((acc, item) => {
      const region = String(item.region || item.market || 'US').toLowerCase();
      const topic = String(item.topic || item.keyword || '').toLowerCase();
      const prompt = String(item.prompt || '').trim();
      if (!prompt) return acc;
      const key = `${region}:${topic}:${prompt.toLowerCase()}`;
      if (!acc[key]) acc[key] = item;
      return acc;
    }, {});
  return Object.values(result);
  /* c8 ignore end */
}

export async function sendToMystique(context, getPresignedUrl = getSignedUrl) {
  // TEMPORARY!!!!
  /* c8 ignore start */
  const {
    auditContext, log, sqs, env, site, audit, s3Client, brandPresenceCadence,
  } = context;

  const siteId = site.getId();
  const baseURL = site.getBaseURL();
  const isDaily = brandPresenceCadence === 'daily';

  const { calendarWeek, parquetFiles, success } = auditContext ?? /* c8 ignore next */ {};

  // For daily cadence, calculate date context
  let dailyDateContext;
  if (isDaily) {
    const referenceDate = auditContext?.referenceDate || new Date();
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
  // Get aiPlatform from the audit result
  const auditResult = audit?.getAuditResult();
  const aiPlatform = auditResult?.aiPlatform;
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

  log.debug('GEO BRAND PRESENCE: sending data to mystique for site id %s (%s), calendarWeek: %j', siteId, baseURL, calendarWeek);

  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';
  const recordSets = await Promise.all(
    parquetFiles.map((key) => loadParquetDataFromS3({ key, bucket, s3Client })),
  );

  let parquetPrompts = recordSets.flat();
  for (const x of parquetPrompts) {
    x.market = x.region; // TODO(aurelio): remove when .region is supported by Mystique
    x.origin = x.source; // TODO(aurelio): remove when we decided which one to pick
  }

  log.debug('GEO BRAND PRESENCE: Loaded %d raw parquet prompts for site id %s (%s)', parquetPrompts.length, siteId, baseURL);

  // Remove duplicates from AI-generated prompts
  parquetPrompts = deduplicatePrompts(parquetPrompts);

  // Load customer-defined prompts from customer config
  const {
    config,
    exists: configExists,
    version: configVersion,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });
  const customerPrompts = Object.values(config.topics).flatMap((x) => {
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
  // Apply 200 limit with customer prompt priority (FIXED LOGIC)
  let prompts;
  if (!EXCLUDE_FROM_HARD_LIMIT.has(siteId)) {
    if (customerPrompts.length >= 200) {
      // Only use first 200 customer prompts
      prompts = customerPrompts.slice(0, 200);
    } else if (parquetPrompts.length + customerPrompts.length > 200) {
      // Use ALL customer prompts + fill remaining slots with parquet prompts
      const remainingSlots = 200 - customerPrompts.length;
      prompts = parquetPrompts.slice(0, remainingSlots).concat(customerPrompts);
    } else {
      // Total is <= 200, use all prompts
      prompts = parquetPrompts.concat(customerPrompts);
    }
  } else {
    // No limit for excluded sites
    prompts = parquetPrompts.concat(customerPrompts);
  }
  log.info('GEO BRAND PRESENCE: Found %d parquet prompts (after dedup) + %d customer prompts = %d total prompts for site id %s (%s)', parquetPrompts.length, customerPrompts.length, prompts.length, siteId, baseURL);
  if (prompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No keyword prompts found for site id %s (%s), skipping message to mystique', siteId, baseURL);
    return;
  }

  // Use daily-specific S3 path if daily cadence
  const s3Context = isDaily
    ? {
      ...context, getPresignedUrl, isDaily, dateContext,
    }
    : { ...context, getPresignedUrl };
  const url = await asPresignedJsonUrl(prompts, bucket, s3Context);
  log.debug('GEO BRAND PRESENCE: Presigned URL for prompts for site id %s (%s): %s', siteId, baseURL, url);

  if (!isNonEmptyArray(providersToUse)) {
    log.warn('GEO BRAND PRESENCE: No web search providers configured for site id %s (%s), skipping message to mystique', siteId, baseURL);
    return;
  }

  // Determine opportunity types based on cadence
  const opptyTypes = isDaily
    ? [GEO_BRAND_PRESENCE_DAILY_OPPTY_TYPE]
    : [GEO_BRAND_PRESENCE_OPPTY_TYPE];

  // Send messages for each combination of opportunity type and web search provider
  await Promise.all(
    opptyTypes.flatMap((opptyType) => providersToUse.map(async (webSearchProvider) => {
      const message = createMystiqueMessage({
        type: opptyType,
        siteId,
        baseURL,
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
        calendarWeek: dateContext,
        url,
        webSearchProvider: transformWebSearchProviderForMystique(webSearchProvider),
        configVersion: /* c8 ignore next */ configExists ? configVersion : null,
        ...(isDaily && { date: dateContext.date }), // Add date only for daily cadence
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      const cadenceLabel = isDaily ? ' DAILY' : '';
      log.debug('GEO BRAND PRESENCE%s: %s message sent to Mystique for site id %s (%s) with provider %s', cadenceLabel, opptyType, siteId, baseURL, webSearchProvider);
    })),
  );
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
    s3Client, log, getPresignedUrl, isDaily, dateContext,
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
  return getPresignedUrl(
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

  if (isString(data) && data.length > 0) {
    try {
      // Try to parse as JSON first (for new format with endDate and aiPlatform)
      const parsedData = JSON.parse(data);
      if (isNonEmptyObject(parsedData)) {
        if (parsedData.endDate && Date.parse(parsedData.endDate)) {
          endDate = parsedData.endDate;
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

  log.debug('GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s', finalUrl, endDate, aiPlatform);
  const result = {
    type: LLMO_QUESTIONS_IMPORT_TYPE,
    endDate,
    siteId: site.getId(),
    // auditResult can't be empty, so sending empty array and include aiPlatform
    auditResult: { keywordQuestions: [], aiPlatform },
    fullAuditRef: finalUrl,
  };

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
  };
}

const EXCLUDE_FROM_HARD_LIMIT = new Set([
  '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
  '63c38133-4991-4ed0-886b-2d0f440d81ab',
  '1f582f10-41d3-4ff0-afaa-cd1a267ba58a',
  'd8db1956-b24c-4ad7-bdb6-6f5a90d89edc',
  '4b4ed67e-af44-49f7-ab24-3dda37609c9d',
  '0f770626-6843-4fbd-897c-934a9c19f079',
  'fdc7c65b-c0d0-40ff-ab26-fd0e16b75877',
  '9a1cfdaf-3bb3-49a7-bbaa-995653f4c2f4',
  '1398e8f1-90c9-4a5d-bfca-f585fa35fc69',
  '1905ef6e-c112-477e-9fae-c22ebf21973a',
]);

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('sendToMystiqueStep', sendToMystique)
  .build();
