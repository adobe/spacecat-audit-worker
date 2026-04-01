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

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { loadSql } from './utils/report-utils.js';
import { weeklyBreakdownQueries } from './utils/query-builder.js';
import { mapToAgenticTrafficBundle } from './utils/agentic-traffic-mapper.js';

function parseEnabledSiteIds(context) {
  const raw = context?.env?.AGENTIC_DAILY_EXPORT_SITE_IDS || process.env.AGENTIC_DAILY_EXPORT_SITE_IDS || '';
  return new Set(
    raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isAgenticDailyExportEnabled(site, context) {
  const siteId = site?.getId?.();
  return Boolean(siteId) && parseEnabledSiteIds(context).has(siteId);
}

export function getPreviousUtcDate(referenceDate = new Date()) {
  const previous = new Date(referenceDate);
  previous.setUTCDate(previous.getUTCDate() - 1);
  previous.setUTCHours(0, 0, 0, 0);
  return previous;
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  let normalized;
  if (typeof value === 'string') {
    normalized = value;
  } else if (typeof value === 'object') {
    normalized = JSON.stringify(value);
  } else {
    normalized = String(value);
  }

  if (/["\n,]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  return normalized;
}

function serializeCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((column) => escapeCsvValue(row[column])).join(','));
  return [header, ...body].join('\n');
}

function getAgenticBundleKeyPrefix(siteId, trafficDate, batchId) {
  const [year, month, day] = trafficDate.split('-');
  return `${siteId}/agentic-traffic/${year}/${month}/${day}/${batchId}/`;
}

async function ensureAthenaDatabase(athenaClient, databaseName) {
  const sqlDb = await loadSql('create-database', { database: databaseName });
  await athenaClient.execute(sqlDb, databaseName, `[Athena Query] Create database ${databaseName}`);
}

async function uploadBundleToS3({
  s3Client,
  bucket,
  keyPrefix,
  trafficRows,
  classificationRows,
}) {
  const trafficKey = `${keyPrefix}agentic_traffic.csv`;
  const classificationsKey = `${keyPrefix}agentic_url_classifications.csv`;

  await Promise.all([
    s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: trafficKey,
      Body: serializeCsv(trafficRows, [
        'traffic_date',
        'host',
        'platform',
        'agent_type',
        'user_agent',
        'http_status',
        'url_path',
        'hits',
        'avg_ttfb_ms',
        'dimensions',
        'metrics',
        'updated_by',
      ]),
      ContentType: 'text/csv',
    })),
    s3Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: classificationsKey,
      Body: serializeCsv(classificationRows, [
        'host',
        'url_path',
        'region',
        'category_name',
        'page_type',
        'content_type',
        'updated_by',
      ]),
      ContentType: 'text/csv',
    })),
  ]);

  return {
    trafficKey,
    classificationsKey,
  };
}

function getAnalyticsQueueUrl(context) {
  return context?.env?.ANALYTICS_QUEUE_URL || process.env.ANALYTICS_QUEUE_URL || '';
}

async function dispatchAnalyticsEvent({
  context,
  site,
  batchId,
  bundleUri,
  trafficDate,
  rowCount,
}) {
  const queueUrl = getAnalyticsQueueUrl(context);
  if (!queueUrl) {
    throw new Error('ANALYTICS_QUEUE_URL is required for agentic daily export dispatch');
  }

  const message = {
    type: 'batch.completed',
    correlationId: batchId,
    pipeline_id: 'agentic_traffic',
    s3_uri: bundleUri,
    site_id: site.getId(),
    start_date: trafficDate,
    end_date: trafficDate,
    row_count: rowCount,
  };

  if (site.getOrganizationId?.()) {
    message.org_id = site.getOrganizationId();
  }

  await context.sqs.sendMessage(queueUrl, message);

  return {
    queueUrl,
    messageType: message.type,
    pipelineId: message.pipeline_id,
  };
}

export async function runDailyAgenticExport({
  athenaClient,
  s3Client,
  s3Config,
  site,
  context,
  reportConfig,
  referenceDate = new Date(),
}) {
  const { log } = context;
  const trafficDateObj = getPreviousUtcDate(referenceDate);
  const trafficDate = trafficDateObj.toISOString().split('T')[0];

  await ensureAthenaDatabase(athenaClient, s3Config.databaseName);

  const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery({
    trafficDate: trafficDateObj,
    databaseName: s3Config.databaseName,
    tableName: reportConfig.tableName,
    site,
  });

  const rawRows = await athenaClient.query(
    query,
    s3Config.databaseName,
    '[Athena Query] agentic_daily_flat_data',
  );

  const { trafficRows, classificationRows } = await mapToAgenticTrafficBundle(
    rawRows,
    site,
    context,
    trafficDate,
  );

  if (trafficRows.length === 0) {
    log.info(`[cdn-logs-report] No agentic daily export rows for ${site.getId()} on ${trafficDate}`);
    return {
      enabled: true,
      success: true,
      skipped: true,
      siteId: site.getId(),
      trafficDate,
      rowCount: 0,
      classificationCount: 0,
    };
  }

  const batchId = uuidv4();
  const keyPrefix = getAgenticBundleKeyPrefix(site.getId(), trafficDate, batchId);
  const bundleUri = `s3://${s3Config.bucket}/${keyPrefix}`;
  const uploadedFiles = await uploadBundleToS3({
    s3Client,
    bucket: s3Config.bucket,
    keyPrefix,
    trafficRows,
    classificationRows,
  });
  const dispatch = await dispatchAnalyticsEvent({
    context,
    site,
    batchId,
    bundleUri,
    trafficDate,
    rowCount: trafficRows.length,
  });

  log.info(`[cdn-logs-report] Daily agentic export dispatched for ${site.getId()} on ${trafficDate}. Rows: ${trafficRows.length}, classifications: ${classificationRows.length}`);

  return {
    enabled: true,
    success: true,
    skipped: false,
    siteId: site.getId(),
    trafficDate,
    rowCount: trafficRows.length,
    classificationCount: classificationRows.length,
    bundleUri,
    uploadedFiles,
    dispatch,
  };
}
