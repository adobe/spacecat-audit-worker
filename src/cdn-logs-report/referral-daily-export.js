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

/* eslint-disable camelcase */
import { createHash } from 'crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { classifyTrafficSource } from '@adobe/spacecat-shared-rum-api-client/src/common/traffic.js';
import { joinBaseAndPath } from '../utils/url-utils.js';
import { loadSql, getImporterS3Client } from './utils/report-utils.js';
import { weeklyBreakdownQueries } from './utils/query-builder.js';
import { buildClassificationRows, serializeClassificationCsv } from '../llmo-referral-traffic-daily/classify.js';
import { fetchAgenticUrlClassificationRules } from '../common/agentic-url-classification-rules.js';

const CDN_REFERRAL_CSV_COLUMNS = [
  'traffic_date', 'host', 'url_path', 'trf_platform', 'device', 'region',
  'pageviews', 'referrer', 'utm_source', 'utm_medium', 'tracking_param',
  'trf_type', 'trf_channel', 'updated_by',
];

function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const normalized = String(value);
  if (/["\r\n,]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function serializeCsv(rows) {
  const header = CDN_REFERRAL_CSV_COLUMNS.join(',');
  const body = rows.map(
    (row) => CDN_REFERRAL_CSV_COLUMNS.map((col) => escapeCsvValue(row[col])).join(','),
  );
  return [header, ...body].join('\r\n');
}

export function getPreviousUtcDate(referenceDate = new Date()) {
  const previous = new Date(referenceDate);
  previous.setUTCDate(previous.getUTCDate() - 1);
  previous.setUTCHours(0, 0, 0, 0);
  return previous;
}

function getCsvKey(siteId, trafficDate) {
  const [year, month, day] = trafficDate.split('-');
  return `referral-traffic-cdn-daily-export/csvs/${siteId}/${year}/${month}/${day}/data.csv`;
}

function getClassificationCsvKey(siteId, trafficDate) {
  const [year, month, day] = trafficDate.split('-');
  return `referral-traffic-cdn-daily-export/csvs/${siteId}/${year}/${month}/${day}/classifications.csv`;
}

async function ensureAthenaDatabase(athenaClient, databaseName) {
  const sqlDb = await loadSql('create-database', { database: databaseName });
  await athenaClient.execute(sqlDb, databaseName, `[Athena Query] Create database ${databaseName}`);
}

export function mapToReferralCsvRows(rawRows, site, trafficDate) {
  const baseURL = site.getBaseURL();
  const siteHost = new URL(baseURL).hostname;
  const grouped = new Map();

  for (const row of rawRows) {
    const rawPath = row.path || '';
    const effectiveHost = row.host || siteHost;
    const {
      referrer, utm_source, utm_medium, tracking_param,
    } = row;
    const device = row.device || '';
    const normalizedDate = (row.date || '') || trafficDate;
    const region = row.region || 'GLOBAL';
    const rowPageviews = row.pageviews;

    const urlPath = rawPath.split('?')[0];
    const url = joinBaseAndPath(baseURL, urlPath || '/');

    const { type, category, vendor } = classifyTrafficSource(
      url,
      referrer,
      utm_source,
      utm_medium,
      tracking_param,
    );

    if (type === 'earned' && category === 'llm') {
      const normalizedVendor = vendor || '';
      const key = JSON.stringify(
        [normalizedDate, effectiveHost, urlPath, normalizedVendor, device, region],
      );
      const pageviews = Number(rowPageviews) || 0;

      if (grouped.has(key)) {
        grouped.get(key).pageviews += pageviews;
      } else {
        grouped.set(key, {
          traffic_date: normalizedDate,
          host: effectiveHost,
          url_path: urlPath || '/',
          trf_platform: normalizedVendor,
          device,
          region,
          pageviews,
          referrer: referrer ?? null,
          utm_source: utm_source ?? null,
          utm_medium: utm_medium ?? null,
          tracking_param: tracking_param ?? null,
          trf_type: 'earned',
          trf_channel: 'llm',
          updated_by: 'spacecat:cdn',
        });
      }
    }
  }

  return [...grouped.values()];
}

async function cleanupCsvFromS3({
  s3Client, bucket, csvKey, log,
}) {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: csvKey }));
  } catch (error) {
    log.warn(`[cdn-logs-report] Failed to clean up referral export CSV for s3://${bucket}/${csvKey}: ${error.message}`);
  }
}

async function getAnalyticsQueueUrl(context) {
  const configuration = await context?.dataAccess?.Configuration?.findLatest?.();
  return configuration?.getQueues?.().analytics || '';
}

/**
 * Classifies this run's CDN referral URLs against the site's active category rules
 * and emits them for the projector to import into referral_url_classifications
 * (LLMO-6257 P2, write-time-in-service). Separate CSV + projector message from the
 * traffic export; all sources serialize on the referral_url_classifications:<siteId>
 * FIFO group, so the dedup id is namespaced with the source (`:cdn`) to avoid
 * colliding with another source's classification message for the same site/date.
 * Uses the importer S3 client (us-east-1), like the traffic export.
 */
async function emitReferralClassifications({
  site, context, rows, trafficDate, bucket, queueUrl, s3Client,
}) {
  const { log } = context;
  const siteId = site.getId();

  const rulesResult = await fetchAgenticUrlClassificationRules(site, context);
  const rules = Array.isArray(rulesResult?.topicPatterns) ? rulesResult.topicPatterns : [];
  if (rules.length === 0) {
    log.info(`[cdn-logs-report] No category rules for site ${siteId}; skipping classification emit`);
    return { classified: 0 };
  }

  const classificationRows = buildClassificationRows(rows, rules, 'spacecat:cdn');
  if (classificationRows.length === 0) {
    log.info(`[cdn-logs-report] No referral URLs matched a category rule for site ${siteId}`);
    return { classified: 0 };
  }

  const classificationKey = getClassificationCsvKey(siteId, trafficDate);
  const classificationUri = `s3://${bucket}/${classificationKey}`;

  const dedupId = createHash('sha256')
    .update(`${siteId}:${trafficDate}:referral_url_classifications:cdn`)
    .digest('hex');
  const messageGroupId = `referral_url_classifications:${siteId}`;

  const message = {
    type: 'batch.completed',
    correlationId: dedupId,
    pipeline_id: 'referral_url_classifications',
    s3_uri: classificationUri,
    site_id: siteId,
    start_date: trafficDate,
    end_date: trafficDate,
    row_count: classificationRows.length,
  };

  if (site.getOrganizationId?.()) {
    message.org_id = site.getOrganizationId();
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: classificationKey,
      Body: serializeClassificationCsv(classificationRows),
      ContentType: 'text/csv',
    }));

    await context.sqs.sendMessage(queueUrl, message, messageGroupId, 0, dedupId);
  } catch (err) {
    await cleanupCsvFromS3({
      s3Client, bucket, csvKey: classificationKey, log,
    });
    throw err;
  }

  log.info(`[cdn-logs-report] Dispatched ${classificationRows.length} referral classifications for site ${siteId} on ${trafficDate}`);
  return { classified: classificationRows.length };
}

export const testHelpers = {
  cleanupCsvFromS3,
  escapeCsvValue,
  emitReferralClassifications,
};

export async function runDailyReferralExport({
  athenaClient,
  s3Config,
  site,
  context,
  reportConfig,
  referenceDate = new Date(),
}) {
  const { log } = context;
  const trafficDateObj = getPreviousUtcDate(referenceDate);
  const trafficDate = trafficDateObj.toISOString().split('T')[0];
  const bucket = context.env?.S3_IMPORTER_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for referral daily export');
  }
  const siteId = site.getId();

  const queueUrl = await getAnalyticsQueueUrl(context);
  if (!queueUrl) {
    throw new Error('analytics queue is not configured');
  }

  await ensureAthenaDatabase(athenaClient, s3Config.databaseName);

  const query = await weeklyBreakdownQueries.createReferralDailyReportQuery({
    trafficDate: trafficDateObj,
    databaseName: s3Config.databaseName,
    tableName: reportConfig.tableName,
    site,
  });

  const rawRows = await athenaClient.query(
    query,
    s3Config.databaseName,
    '[Athena Query] referral_daily_flat_data',
  );

  const rows = mapToReferralCsvRows(rawRows, site, trafficDate);

  if (rows.length === 0) {
    log.info(`[cdn-logs-report] No LLM referral rows for ${siteId} on ${trafficDate} (Athena returned ${rawRows.length} rows, 0 matched classification)`);
    return {
      enabled: true,
      success: true,
      skipped: true,
      siteId,
      trafficDate,
      rowCount: 0,
    };
  }

  const csvKey = getCsvKey(siteId, trafficDate);
  const csvUri = `s3://${bucket}/${csvKey}`;

  const dedupId = createHash('sha256')
    .update(`${siteId}:${trafficDate}:referral_traffic_cdn`)
    .digest('hex');

  const message = {
    type: 'batch.completed',
    correlationId: dedupId,
    pipeline_id: 'referral_traffic_cdn',
    s3_uri: csvUri,
    site_id: siteId,
    start_date: trafficDate,
    end_date: trafficDate,
    row_count: rows.length,
  };

  if (site.getOrganizationId?.()) {
    message.org_id = site.getOrganizationId();
  }

  const messageGroupId = `referral_traffic_cdn:${siteId}`;
  // Importer bucket is us-east-1, not the site's CDN region; reusing the CDN client 301s.
  const s3Client = getImporterS3Client();

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: csvKey,
      Body: serializeCsv(rows),
      ContentType: 'text/csv',
    }));

    await context.sqs.sendMessage(queueUrl, message, messageGroupId, 0, dedupId);
  } catch (err) {
    await cleanupCsvFromS3({
      s3Client, bucket, csvKey, log,
    });
    throw err;
  }

  // Classify this run's referral URLs and emit them for import into
  // referral_url_classifications (LLMO-6257 P2). Best-effort: the traffic export has
  // already succeeded, so a classification hiccup must not fail the audit.
  try {
    await emitReferralClassifications({
      site, context, rows, trafficDate, bucket, queueUrl, s3Client,
    });
  } catch (err) {
    log.warn(`[cdn-logs-report] Referral URL classification emit failed for site ${siteId}: ${err.message}`);
  }

  log.info(
    `[cdn-logs-report] Daily referral export dispatched for ${siteId} (${site.getBaseURL()}) on ${trafficDate}. Rows: ${rows.length}`,
  );

  return {
    enabled: true,
    success: true,
    skipped: false,
    siteId,
    trafficDate,
    rowCount: rows.length,
    batchId: dedupId,
    csvUri,
  };
}
