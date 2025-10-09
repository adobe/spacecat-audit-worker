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
  isString, isNonEmptyArray, isNonEmptyObject, llmoConfig,
} from '@adobe/spacecat-shared-utils';
import { parquetReadObjects } from 'hyparquet';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const LLMO_QUESTIONS_IMPORT_TYPE = 'llmo-prompts-ahrefs';
export const GEO_BRAND_PRESENCE_OPPTY_TYPE = 'detect:geo-brand-presence';
export const GEO_FAQ_OPPTY_TYPE = 'guidance:geo-faq';
export const OPPTY_TYPES = [
  GEO_BRAND_PRESENCE_OPPTY_TYPE,
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
  // Add more providers here as needed
];

/**
 * @import { S3Client } from '@aws-sdk/client-s3';
 */

export async function sendToMystique(context, getPresignedUrl = getSignedUrl) {
  const {
    auditContext, log, sqs, env, site, audit, s3Client,
  } = context;

  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  const { calendarWeek, parquetFiles, success } = auditContext ?? /* c8 ignore next */ {};
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
  if (!calendarWeek || typeof calendarWeek !== 'object' || !calendarWeek.week || !calendarWeek.year) {
    log.error('GEO BRAND PRESENCE: Invalid calendarWeek in auditContext for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }
  if (!Array.isArray(parquetFiles) || !parquetFiles.every((x) => typeof x === 'string')) {
    log.error('GEO BRAND PRESENCE: Invalid parquetFiles in auditContext for site id %s (%s). Cannot send data to Mystique', siteId, baseURL, auditContext);
    return;
  }

  log.info('GEO BRAND PRESENCE: sending data to mystique for site id %s (%s), calendarWeek: %j', siteId, baseURL, calendarWeek);

  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME ?? /* c8 ignore next */ '';
  const recordSets = await Promise.all(
    parquetFiles.map((key) => loadParquetDataFromS3({ key, bucket, s3Client })),
  );

  let prompts = recordSets.flat();
  for (const x of prompts) {
    x.market = x.region; // TODO(aurelio): remove when .region is supported by Mystique
    x.origin = x.source; // TODO(aurelio): remove when we decided which one to pick
  }

  // Load customer-defined prompts from customer config
  const {
    config,
    exists: configExists,
    version: configVersion,
  } = await llmoConfig.readConfig(siteId, s3Client, { s3Bucket: bucket });
  const customerPrompts = Object.values(config.topics).flatMap((x) => {
    const category = config.categories[x.category];
    return x.prompts.map((p) => ({
      prompt: p.prompt,
      region: p.regions.join(','),
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
    }));
  });

  prompts = prompts.concat(customerPrompts);

  log.info('GEO BRAND PRESENCE: Found %d keyword prompts for site id %s (%s)', prompts.length, siteId, baseURL);
  if (prompts.length === 0) {
    log.warn('GEO BRAND PRESENCE: No keyword prompts found for site id %s (%s), skipping message to mystique', siteId, baseURL);
    return;
  }

  const url = await asPresignedJsonUrl(prompts, bucket, { ...context, getPresignedUrl });
  log.info('GEO BRAND PRESENCE: Presigned URL for prompts for site id %s (%s): %s', siteId, baseURL, url);

  if (!isNonEmptyArray(providersToUse)) {
    log.warn('GEO BRAND PRESENCE: No web search providers configured for site id %s (%s), skipping message to mystique', siteId, baseURL);
    return;
  }

  // Send messages for each combination of opportunity type and web search provider
  await Promise.all(
    OPPTY_TYPES.flatMap((opptyType) => providersToUse.map(async (webSearchProvider) => {
      const message = createMystiqueMessage({
        opptyType,
        siteId,
        baseURL,
        auditId: audit.getId(),
        deliveryType: site.getDeliveryType(),
        calendarWeek,
        url,
        webSearchProvider,
        configVersion: /* c8 ignore next */ configExists ? configVersion : null,
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.info('GEO BRAND PRESENCE: %s message sent to Mystique for site id %s (%s) with provider %s', opptyType, siteId, baseURL, webSearchProvider);
    })),
  );
}

/**
 * Loads Parquet data from S3 and returns the parsed data.
 * @param {object} options - Options for loading Parquet data.
 * @param {string} options.key - The S3 object key for the Parquet file.
 * @param {string} options.bucket - The S3 bucket name.
 * @param {S3Client} options.s3Client - The S3 client instance.
 * @return {Promise<Array<Record<string, unknown>>>}
 */
async function loadParquetDataFromS3({ key, bucket, s3Client }) {
  const res = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const body = await res.Body?.transformToByteArray();
  /* c8 ignore start */
  if (!body) {
    throw new Error(`Failed to read Parquet file from s3://${bucket}/${key}`);
  }
  /* c8 ignore end */

  return parquetReadObjects({ file: body.buffer });
}

async function asPresignedJsonUrl(data, bucketName, context) {
  const {
    s3Client, log, getPresignedUrl,
  } = context;

  const key = `temp/audit-geo-brand-presence/${new Date().toISOString().split('T')[0]}-${randomUUID()}.json`;
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

  log.info('GEO BRAND PRESENCE: Keyword prompts import step for %s with endDate: %s, aiPlatform: %s', finalUrl, endDate, aiPlatform);

  return {
    type: LLMO_QUESTIONS_IMPORT_TYPE,
    endDate,
    siteId: site.getId(),
    // auditResult can't be empty, so sending empty array and include aiPlatform
    auditResult: { keywordQuestions: [], aiPlatform },
    fullAuditRef: finalUrl,
  };
}

/**
 * Creates a message object for sending to Mystique.
 * @param {object} params - Message parameters
 * @param {string} params.opptyType - The opportunity type
 * @param {string} params.siteId - The site ID
 * @param {string} params.baseURL - The base URL
 * @param {string} params.auditId - The audit ID
 * @param {string} params.deliveryType - The delivery type
 * @param {object} params.calendarWeek - The calendar week object
 * @param {string} params.url - The presigned URL for data
 * @param {string} params.webSearchProvider - The web search provider
 * @param {null | string} [params.configVersion] - The configuration version
 * @returns {object} The message object
 */
function createMystiqueMessage({
  opptyType,
  siteId,
  baseURL,
  auditId,
  deliveryType,
  calendarWeek,
  url,
  webSearchProvider,
  configVersion = null,
}) {
  return {
    type: opptyType,
    siteId,
    url: baseURL,
    auditId,
    deliveryType,
    time: new Date().toISOString(),
    week: calendarWeek.week,
    year: calendarWeek.year,
    data: {
      url,
      configVersion,
      web_search_provider: webSearchProvider,
    },
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('keywordPromptsImportStep', keywordPromptsImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('sendToMystiqueStep', sendToMystique)
  .build();
