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
import {
  AWSAthenaClient,
} from '@adobe/spacecat-shared-athena-client';
import { getWeekInfo, getTemporalCondition } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getLowPerformingPaidPagesTemplate } from './queries.js';

// Configurable thresholds
const CUT_OFF_BOUNCE_RATE = 0.3;
const PREDOMINANT_TRAFFIC_PCT = 80;
const PAGE_VIEW_THRESHOLD = 1000;

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-keyword-optimizer',
  OBSERVATION: 'Low-performing paid search pages detected with high bounce rates',
};

/**
 * Gets configuration from environment variables
 * @param {Object} env - Environment variables
 * @returns {Object} Configuration object
 */
function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_IMPORTER_BUCKET_NAME: bucketName,
    PAID_DATA_THRESHOLD: paidDataThreshold,
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for paid keyword optimizer audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    pageViewThreshold: paidDataThreshold ?? PAGE_VIEW_THRESHOLD,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
  };
}

/**
 * Transforms a raw Athena result item into a structured object
 * @param {Object} item - Raw Athena result row
 * @param {string} baseURL - Base URL of the site
 * @returns {Object} Transformed result item
 */
function transformResultItem(item, baseURL) {
  return {
    path: item.path,
    url: item.path ? new URL(item.path, baseURL).toString() : undefined,
    trfType: item.trf_type,
    trfChannel: item.trf_channel,
    trafficLoss: parseFloat(item.traffic_loss || 0),
    pageViews: parseInt(item.pageviews || 0, 10),
    pctPageviews: parseFloat(item.pct_pageviews || 0),
    clickRate: parseFloat(item.click_rate || 0),
    bounceRate: parseFloat(item.bounce_rate || 0),
    engagementRate: parseFloat(item.engagement_rate || 0),
    engagedScrollRate: parseFloat(item.engaged_scroll_rate || 0),
  };
}

/**
 * Executes the low performing paid pages query
 * @param {Object} athenaClient - Athena client instance
 * @param {Array<string>} dimensions - Dimension columns
 * @param {string} segmentName - Name for logging
 * @param {string} siteId - Site ID
 * @param {string} temporalCondition - Temporal SQL condition
 * @param {number} pageViewThreshold - Minimum page views threshold
 * @param {Object} config - Configuration object
 * @param {Object} log - Logger instance
 * @param {string} baseURL - Base URL of the site
 * @returns {Promise<Array>} Query results
 */
async function executeLowPerformingPaidPagesQuery(
  athenaClient,
  dimensions,
  segmentName,
  siteId,
  temporalCondition,
  pageViewThreshold,
  config,
  log,
  baseURL,
) {
  const dimensionColumns = dimensions.join(', ');
  const groupBy = dimensions.join(', ');
  const dimensionColumnsPrefixed = dimensions.map((dim) => `a.${dim}`).join(', ');

  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const query = getLowPerformingPaidPagesTemplate({
    siteId,
    tableName,
    temporalCondition,
    dimensionColumns,
    groupBy,
    dimensionColumnsPrefixed,
    pageViewThreshold,
  });

  const description = `${segmentName} for siteId: ${siteId} | temporal: ${temporalCondition}`;

  log.debug(`[DEBUG] ${segmentName} Query:`, query);

  const result = await athenaClient.query(query, config.rumMetricsDatabase, description);
  return result.map((item) => transformResultItem(item, baseURL));
}

/**
 * Builds traffic map by path, aggregating pageviews by traffic type
 * @param {Array} results - Query results
 * @returns {Map} Map of path to traffic data
 */
function buildPathTrafficMap(results) {
  const pathTrafficMap = new Map();

  results.forEach((row) => {
    const { path, trfType, pageViews } = row;

    if (!pathTrafficMap.has(path)) {
      pathTrafficMap.set(path, {
        paid: 0,
        earned: 0,
        owned: 0,
        total: 0,
        rows: [],
      });
    }

    const pathData = pathTrafficMap.get(path);
    if (trfType === 'paid' || trfType === 'earned' || trfType === 'owned') {
      pathData[trfType] += pageViews;
      pathData.total += pageViews;
    }
    pathData.rows.push(row);
  });

  return pathTrafficMap;
}

/**
 * Checks if a path has predominantly paid traffic
 * @param {Map} pathTrafficMap - Traffic map
 * @param {string} path - Path to check
 * @param {number} thresholdPct - Percentage threshold (default 80)
 * @returns {boolean} True if predominantly paid
 */
function isPredominantlyPaid(pathTrafficMap, path, thresholdPct = PREDOMINANT_TRAFFIC_PCT) {
  const trafficData = pathTrafficMap.get(path);
  if (!trafficData || trafficData.total === 0) return false;

  const paidPct = (trafficData.paid / trafficData.total) * 100;
  return paidPct >= thresholdPct;
}

/**
 * Gets the paid traffic row for a path
 * @param {Map} pathTrafficMap - Traffic map
 * @param {string} path - Path to get
 * @returns {Object|null} Paid traffic row or null
 */
function getPaidTrafficRow(pathTrafficMap, path) {
  const trafficData = pathTrafficMap.get(path);
  /* c8 ignore next 1 */
  if (!trafficData) return null;

  /* c8 ignore next 1 */
  return trafficData.rows.find((row) => row.trfType === 'paid') || null;
}

/**
 * Builds the mystique message payload
 * @param {Object} site - Site object
 * @param {string} auditId - Audit ID
 * @param {Array<Object>} qualifyingPages - Pages that qualify for analysis
 * @returns {Object} Mystique message
 */
function buildMystiqueMessage(site, auditId, qualifyingPages) {
  const urls = qualifyingPages.map((page) => page.url);

  return {
    type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url: urls[0], // Primary URL for reference
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      urls,
    },
  };
}

/**
 * Main audit runner for paid keyword optimizer
 * @param {string} auditUrl - Audit URL
 * @param {Object} context - Execution context
 * @param {Object} site - Site object
 * @returns {Promise<Object>} Audit result
 */
export async function paidKeywordOptimizerRunner(auditUrl, context, site) {
  const { log, env } = context;
  const config = getConfig(env);
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.debug(
    `[paid-keyword-optimizer] [Site: ${auditUrl}] Querying Athena metrics for low-performing paid pages (siteId: ${siteId})`,
  );

  // Get temporal parameters (4 weeks back from current week)
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/paid-keyword-optimizer/${siteId}-${Date.now()}`);

  try {
    log.debug(`[paid-keyword-optimizer] [Site: ${auditUrl}] Executing Athena query for paid traffic analysis`);

    // Execute query with dimensions: trf_type, path, trf_channel
    const lowPerformingPages = await executeLowPerformingPaidPagesQuery(
      athenaClient,
      ['trf_type', 'path', 'trf_channel'],
      'Low Performing Paid Pages',
      siteId,
      temporalCondition,
      config.pageViewThreshold,
      config,
      log,
      baseURL,
    );

    log.debug(`[paid-keyword-optimizer] [Site: ${auditUrl}] Query returned ${lowPerformingPages.length} rows`);

    // Build traffic map by path
    const pathTrafficMap = buildPathTrafficMap(lowPerformingPages);

    // Filter for predominantly paid paths
    const predominantlyPaidPaths = Array.from(pathTrafficMap.keys())
      .filter((path) => isPredominantlyPaid(pathTrafficMap, path));

    log.debug(`[paid-keyword-optimizer] [Site: ${auditUrl}] Found ${predominantlyPaidPaths.length} predominantly paid paths`);

    // Get paid traffic rows for predominantly paid paths
    const predominantlyPaidPages = predominantlyPaidPaths
      .map((path) => getPaidTrafficRow(pathTrafficMap, path))
      .filter((row) => row !== null);

    // Calculate statistics
    const totalPageViews = predominantlyPaidPages
      .reduce((sum, page) => sum + page.pageViews, 0);
    const averageBounceRate = predominantlyPaidPages.length > 0
      ? predominantlyPaidPages.reduce((sum, page) => sum + page.bounceRate, 0)
        / predominantlyPaidPages.length
      : 0;

    const auditResult = {
      totalPageViews,
      averageBounceRate,
      predominantlyPaidPages,
      predominantlyPaidCount: predominantlyPaidPages.length,
      temporalCondition,
    };

    log.info(`[paid-keyword-optimizer] [Site: ${auditUrl}] Audit initial result:`, JSON.stringify(auditResult, null, 2));

    return {
      auditResult,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[paid-keyword-optimizer] [Site: ${auditUrl}] Athena query failed: ${error.message}`);
    throw error;
  }
}

/**
 * Post-processor to send qualifying pages to mystique
 * @param {string} auditUrl - Audit URL
 * @param {Object} auditData - Audit data
 * @param {Object} context - Execution context
 * @param {Object} site - Site object
 */
export async function sendToMystique(auditUrl, auditData, context, site) {
  const { log, sqs, env } = context;
  const { auditResult, id } = auditData;

  // Filter pages with bounce rate >= threshold
  const qualifyingPages = (auditResult.predominantlyPaidPages || [])
    .filter((page) => page.bounceRate >= CUT_OFF_BOUNCE_RATE);

  if (qualifyingPages.length === 0) {
    log.info(
      `[paid-keyword-optimizer] [Site: ${auditUrl}] No pages with bounce rate >= ${CUT_OFF_BOUNCE_RATE} found; skipping mystique`,
    );
    return;
  }

  log.info(
    `[paid-keyword-optimizer] [Site: ${auditUrl}] Found ${qualifyingPages.length} pages with high bounce rate`,
  );

  const mystiqueMessage = buildMystiqueMessage(site, id, qualifyingPages);

  log.debug(
    `[paid-keyword-optimizer] [Site: ${auditUrl}] Sending ${qualifyingPages.length} pages to mystique: `
    + `${JSON.stringify(mystiqueMessage, null, 2)}`,
  );

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.debug(`[paid-keyword-optimizer] [Site: ${auditUrl}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(paidKeywordOptimizerRunner)
  .withPostProcessors([sendToMystique])
  .build();
