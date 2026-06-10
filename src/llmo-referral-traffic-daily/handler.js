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

import { createHash } from 'crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { parquetReadObjects } from 'hyparquet';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../common/country-patterns.js';
import { fetchAgenticUrlClassificationRules } from '../common/agentic-url-classification-rules.js';
import { createClassifier } from '../common/agentic-url-classification.js';
import { serializeCsv } from '../common/spreadsheet-safe.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const COMPILED_COUNTRY_PATTERNS = DEFAULT_COUNTRY_PATTERNS.map(({ name, regex }) => {
  let flags = '';
  let pat = regex;
  if (pat.startsWith('(?i)')) {
    flags += 'i';
    pat = pat.slice(4);
  }
  return { name, re: new RegExp(pat, flags) };
});

function extractCountryCode(url) {
  for (const { re } of COMPILED_COUNTRY_PATTERNS) {
    const match = url.match(re);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }
  return 'GLOBAL';
}

function consentToBool(raw) {
  if (raw == null || raw === '') {
    return true;
  }
  return ['hidden', 'suppressed', 'accept'].includes(String(raw).toLowerCase());
}

function validateDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`);
  }
}

// Stable 14-column daily schema (I5). topic + category are always present,
// positioned after region (mirroring the agentic CDN-logs report layout); their
// cells are empty when no classification rules exist for the site — never 'Other'.
const CSV_COLUMNS = [
  'traffic_date', 'host', 'url_path', 'trf_platform', 'device', 'region',
  'topic', 'category',
  'pageviews', 'consent', 'trf_type', 'trf_channel', 'bounced', 'updated_by',
];

function buildCsvRows(records, host, classifier = null) {
  const grouped = new Map();

  for (const row of records) {
    if (row.trf_type === 'earned' && row.trf_channel === 'llm') {
      const trafficDate = row.date || '';
      const urlPath = row.path || '';
      const trfPlatform = row.trf_platform || '';
      const device = row.device || '';
      const region = extractCountryCode(urlPath);
      const consentBool = consentToBool(row.consent);
      const bounced = row.engaged > 0 ? 0 : 1;
      const pageviews = Number(row.pageviews || 0);

      const key = JSON.stringify([
        trafficDate, host, urlPath, trfPlatform, device, region, consentBool, bounced,
      ]);

      if (grouped.has(key)) {
        grouped.get(key).pageviews += pageviews;
      } else {
        // topic/category always present; empty when no classifier (I5)
        const { topic, category } = classifier
          ? classifier.classify(urlPath)
          : { topic: '', category: '' };
        grouped.set(key, {
          traffic_date: trafficDate,
          host,
          url_path: urlPath,
          trf_platform: trfPlatform,
          device,
          region,
          topic,
          category,
          pageviews,
          consent: consentBool ? 'true' : 'false',
          trf_type: 'earned',
          trf_channel: 'llm',
          bounced,
          updated_by: 'spacecat:optel',
        });
      }
    }
  }

  return [...grouped.values()];
}

function getCsvS3Key(siteId, year, month, day) {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `rum-metrics-compact/llmo-daily-csvs/siteid=${siteId}/year=${year}/month=${paddedMonth}/day=${paddedDay}/data.csv`;
}

async function getAnalyticsQueueUrl(context) {
  const configuration = await context?.dataAccess?.Configuration?.findLatest?.();
  return configuration?.getQueues?.()?.analytics || '';
}

export async function triggerTrafficAnalysisDailyImport(context) {
  const {
    site, finalUrl, log, auditContext = {},
  } = context;

  const siteId = site.getId();
  let date;

  if (auditContext.date) {
    date = auditContext.date;
  } else {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    [date] = yesterday.toISOString().split('T');
  }

  validateDate(date);

  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  // Path mirrors createS3DailyKey in spacecat-import-worker/src/ingestor/traffic-analysis-daily.js
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  const parquetKey = `rum-metrics-compact/data-daily/siteid=${siteId}/year=${year}/month=${paddedMonth}/day=${paddedDay}/data.parquet`;

  log.info(
    `[llmo-referral-traffic-daily] Triggering traffic-analysis-daily import for site: ${siteId}, date: ${date}`,
  );

  return {
    type: 'traffic-analysis',
    siteId,
    auditResult: {
      status: 'import-triggered',
      date,
      year,
      month,
      day,
      parquetKey,
    },
    auditContext: {
      date,
      mode: 'daily',
    },
    fullAuditRef: finalUrl,
    allowCache: false,
  };
}

export async function referralTrafficDailyRunner(context) {
  const {
    env, log, audit, site, s3Client,
  } = context;

  const { S3_IMPORTER_BUCKET_NAME: bucket } = env;
  if (!bucket) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for llmo-referral-traffic-daily audit');
  }

  const queueUrl = await getAnalyticsQueueUrl(context);
  if (!queueUrl) {
    throw new Error('analytics queue is not configured');
  }

  const auditResult = audit.getAuditResult();
  const {
    date, year, month, day, parquetKey,
  } = auditResult;
  const siteId = site.getId();
  const host = new URL(site.getBaseURL()).hostname;

  validateDate(date);

  const csvKey = getCsvS3Key(siteId, year, month, day);
  const s3Uri = `s3://${bucket}/${csvKey}`;

  log.info(
    `[llmo-referral-traffic-daily] Starting daily referral traffic export for site: ${siteId}, date: ${date}`,
  );

  let records;
  try {
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: parquetKey }));
    const bytes = await response.Body.transformToByteArray();
    records = await parquetReadObjects({
      file: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      log.info(`[llmo-referral-traffic-daily] No parquet found at ${parquetKey} for site ${siteId}`);
      return {
        auditResult: { date, rowCount: 0 },
        fullAuditRef: s3Uri,
      };
    }
    throw err;
  }

  // fetch agentic URL classification rules (topic + category); gate enrichment
  // on rules being present so cells stay empty rather than blanket-tagged 'Other'
  const classificationRules = await fetchAgenticUrlClassificationRules(site, context);
  const classifier = createClassifier(classificationRules, { log });
  // M5: distinguish a failed fetch from a site with no rules. Both yield a null
  // classifier; the error shape on the fetch result disambiguates the log line.
  if (classifier) {
    log.info(`[llmo-referral-traffic-daily] Agentic classification rules found for site ${siteId}`);
  } else if (classificationRules?.error) {
    log.warn(`[llmo-referral-traffic-daily] Failed to fetch agentic classification rules for site ${siteId}; topic/category left empty`);
  } else {
    log.info(`[llmo-referral-traffic-daily] No agentic classification rules for site ${siteId}; topic/category left empty`);
  }

  const rows = buildCsvRows(records, host, classifier);

  if (rows.length === 0) {
    log.info(`[llmo-referral-traffic-daily] No LLM referral rows after filter for site ${siteId} on ${date}`);
    return {
      auditResult: { date, rowCount: 0 },
      fullAuditRef: s3Uri,
    };
  }

  const csvBody = serializeCsv(rows, CSV_COLUMNS);

  await s3Client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: csvKey,
    Body: csvBody,
    ContentType: 'text/csv',
  }));

  log.info(`[llmo-referral-traffic-daily] Uploaded CSV to ${csvKey} (${rows.length} rows)`);

  const dedupId = createHash('sha256')
    .update(`${siteId}:${date}:referral_traffic_optel`)
    .digest('hex');
  const messageGroupId = `referral_traffic_optel:${siteId}`;

  const message = {
    type: 'batch.completed',
    correlationId: dedupId,
    pipeline_id: 'referral_traffic_optel',
    s3_uri: s3Uri,
    site_id: siteId,
    start_date: date,
    end_date: date,
    row_count: rows.length,
  };

  if (site.getOrganizationId?.()) {
    message.org_id = site.getOrganizationId();
  }

  try {
    await context.sqs.sendMessage(queueUrl, message, messageGroupId, 0, dedupId);
  } catch (err) {
    log.error(`[llmo-referral-traffic-daily] SQS dispatch failed for site ${siteId}; cleaning up uploaded CSV`);
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: csvKey }));
    throw err;
  }

  log.info(
    `[llmo-referral-traffic-daily] Dispatched analytics event for site ${siteId}, date ${date}, dedupId: ${dedupId}`,
  );

  return {
    auditResult: { date, csvKey, rowCount: rows.length },
    fullAuditRef: s3Uri,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep(
    'trigger-traffic-analysis-daily-import',
    triggerTrafficAnalysisDailyImport,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep(
    'run-referral-traffic-daily',
    referralTrafficDailyRunner,
  )
  .build();
