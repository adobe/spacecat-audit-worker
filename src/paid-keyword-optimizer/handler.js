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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { getWeekInfo, getTemporalCondition, getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { getLowPerformingPaidPagesTemplate } from './queries.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

// Configurable thresholds
const CUT_OFF_BOUNCE_RATE = 0.5;
const PREDOMINANT_TRAFFIC_PCT = 80;
const PAGE_VIEW_THRESHOLD = 5000;

// Import type constant
const IMPORT_AHREF_PAID_PAGES = 'ahref-paid-pages';
const IMPORT_TRAFFIC_ANALYSIS = 'traffic-analysis';

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-ad-intent-gap',
  OBSERVATION: 'Low-performing paid search pages detected with high bounce rates',
};

const EXCLUDE_URL_PATTERNS = [
  /\/(help|support|faq|docs|documentation)\//i,
  /\/(cart|checkout|order|payment)\//i,
  /\/(legal|privacy|terms|cookie-policy)\//i,
  /\/(login|signin|register|signup|account)\//i,
  /\/(search|search-results|results)\//i,
  /\/(thank-you|confirmation)\//i,
  /\/(404|error|not-found)\//i,
  /\/(unsubscribe|preferences|manage-subscription)\//i,
  /\/(api|webhook)\//i,
  /\/(status|system-status)\//i,
];

/**
 * Normalizes a URL by stripping the www. prefix from the hostname.
 * This ensures consistent URL matching between different data sources
 * (e.g., RUM uses casio.com while Ahrefs uses www.casio.com).
 * @param {string} url - URL to normalize
 * @returns {string} URL with www. stripped from hostname
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.replace(/^www\./, '');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Checks if a URL matches any excluded page type pattern
 * @param {string} url - URL to check
 * @returns {boolean} True if the URL should be excluded
 */
function isExcludedPageType(url) {
  return EXCLUDE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Fetches Ahrefs paid-pages data from S3 and returns a Map keyed by URL
 * @param {Object} context - Execution context with s3Client, env, and log
 * @param {string} siteId - Site ID
 * @returns {Promise<Map>} Map of URL to Ahrefs data
 */
async function fetchPaidPagesFromS3(context, siteId) {
  const { s3Client, env } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const key = `metrics/${siteId}/ahrefs/paid-pages.json`;

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  const response = await s3Client.send(command);
  const bodyString = await response.Body.transformToString();
  const pages = JSON.parse(bodyString);

  const map = new Map();
  for (const page of pages) {
    map.set(normalizeUrl(page.url), {
      topKeyword: page.topKeyword,
      cpc: page.cpc || 0,
      sumTraffic: page.sum_traffic || 0,
      serpTitle: page.topKeywordBestPositionTitle,
    });
  }

  if (map.size === 0) {
    throw new Error(`Ahrefs paid-pages data is empty for site ${siteId} (key: ${key})`);
  }

  return map;
}

/**
 * Computes a Wasted-Spend Intent Score (WSIS) for a page
 * @param {Object} page - Page data with pageViews, bounceRate, engagedScrollRate
 * @param {Object} ahrefsData - Ahrefs data with cpc
 * @returns {number} Priority score
 */
function computePriorityScore(page, ahrefsData) {
  const cpc = ahrefsData?.cpc || 0;
  const wastedSpend = cpc * page.pageViews * page.bounceRate;
  const alignmentSignal = Math.max(0.1, 1 - (page.engagedScrollRate ?? 0.5));
  return (wastedSpend / 1000) * alignmentSignal;
}

/**
 * Checks if a specific import type is enabled for the site
 * @param {string} importType - Import type to check
 * @param {Array} imports - Array of import configurations
 * @returns {boolean} True if import is enabled
 */
function isImportEnabled(importType, imports) {
  return imports?.find((importConfig) => importConfig.type === importType)?.enabled;
}

/**
 * Toggles an import type on or off for a site
 * @param {Object} site - Site object
 * @param {string} importType - Import type to toggle
 * @param {boolean} enable - Whether to enable or disable
 * @param {Object} log - Logger instance
 * @throws {Error} If site config is null or save fails
 */
async function toggleImport(site, importType, enable, log) {
  const siteConfig = site.getConfig();
  if (!siteConfig) {
    const errorMsg = `Cannot toggle import ${importType} for site ${site.getId()}: site config is null`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  if (enable) {
    siteConfig.enableImport(importType);
  } else {
    siteConfig.disableImport(importType);
  }
  site.setConfig(Config.toDynamoItem(siteConfig));
  await site.save();
}

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
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for paid keyword optimizer audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    pageViewThreshold: PAGE_VIEW_THRESHOLD,
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
 * Builds the mystique message payload for a single page
 * @param {Object} site - Site object
 * @param {string} auditId - Audit ID
 * @param {Object} page - Page data with url, bounceRate, pageViews, etc.
 * @returns {Object} Mystique message
 */
function buildMystiqueMessage(site, auditId, page) {
  return {
    type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url: page.url,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      bounceRate: page.bounceRate,
      pageViews: page.pageViews,
      trafficLoss: page.trafficLoss,
      priorityScore: page.priorityScore,
      cpc: page.cpc,
      sumTraffic: page.sumTraffic,
      topKeyword: page.topKeyword,
      serpTitle: page.serpTitle,
      engagedScrollRate: page.engagedScrollRate,
    },
  };
}

/**
 * Factory function that creates a traffic-analysis import step for a specific week index.
 * Week index 0 = oldest week in the 4-week lookback, index 3 = most recent.
 * Only weekIndex 0 enables the traffic-analysis import on the site config.
 * @param {number} weekIndex - Index into the getLastNumberOfWeeks(4) array
 * @returns {Function} Step handler function
 */
function createTrafficAnalysisImportStep(weekIndex) {
  return async function triggerTrafficAnalysisImportStep(context) {
    const { site, finalUrl, log } = context;
    const siteId = site.getId();

    const weeks = getLastNumberOfWeeks(4);
    const { week, year } = weeks[weekIndex];

    log.info(
      `[ad-intent-mismatch] [Site: ${finalUrl}] Import step ${weekIndex + 1}/4: `
      + `Triggering traffic-analysis import for week ${week}/${year}`,
    );

    // Only enable import on the first step
    if (weekIndex === 0) {
      const siteConfig = site.getConfig();
      const imports = siteConfig?.getImports() || [];

      if (!isImportEnabled(IMPORT_TRAFFIC_ANALYSIS, imports)) {
        log.debug(
          `[ad-intent-mismatch] [Site: ${finalUrl}] Enabling ${IMPORT_TRAFFIC_ANALYSIS} import for site ${siteId}`,
        );
        await toggleImport(site, IMPORT_TRAFFIC_ANALYSIS, true, log);
      }
    }

    return {
      auditResult: {
        status: 'processing',
        message: `Importing traffic-analysis data for week ${week}/${year}`,
      },
      fullAuditRef: finalUrl,
      type: IMPORT_TRAFFIC_ANALYSIS,
      siteId,
      allowCache: true,
      auditContext: {
        week,
        year,
      },
    };
  };
}

export const importTrafficAnalysisWeekStep0 = createTrafficAnalysisImportStep(0);
export const importTrafficAnalysisWeekStep1 = createTrafficAnalysisImportStep(1);
export const importTrafficAnalysisWeekStep2 = createTrafficAnalysisImportStep(2);
export const importTrafficAnalysisWeekStep3 = createTrafficAnalysisImportStep(3);

/**
 * Main audit runner for paid keyword optimizer (used by step 2)
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
    `[ad-intent-mismatch] [Site: ${auditUrl}] Querying Athena metrics for low-performing paid pages (siteId: ${siteId})`,
  );

  // Get temporal parameters (4 weeks back from current week)
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/ad-intent-mismatch/${siteId}-${Date.now()}`);

  try {
    log.debug(`[ad-intent-mismatch] [Site: ${auditUrl}] Executing Athena query for paid traffic analysis`);

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

    log.debug(`[ad-intent-mismatch] [Site: ${auditUrl}] Query returned ${lowPerformingPages.length} rows`);

    // Build traffic map by path
    const pathTrafficMap = buildPathTrafficMap(lowPerformingPages);

    // Filter for predominantly paid paths
    const predominantlyPaidPaths = Array.from(pathTrafficMap.keys())
      .filter((path) => isPredominantlyPaid(pathTrafficMap, path));

    log.debug(`[ad-intent-mismatch] [Site: ${auditUrl}] Found ${predominantlyPaidPaths.length} predominantly paid paths`);

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

    log.info(`[ad-intent-mismatch] [Site: ${auditUrl}] Audit result:`, JSON.stringify(auditResult, null, 2));

    return {
      auditResult,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[ad-intent-mismatch] [Site: ${auditUrl}] Athena query failed: ${error.message}`);
    throw error;
  }
}

/**
 * Step 1: Trigger the ahref-paid-pages import
 * Creates the audit and sends a message to the import worker
 * @param {Object} context - Step context
 * @returns {Promise<Object>} Step result with audit and import payload
 */
export async function triggerPaidPagesImportStep(context) {
  const { site, log, finalUrl } = context;
  const siteId = site.getId();

  log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] Step 1: Triggering ${IMPORT_AHREF_PAID_PAGES} import`);

  // Check if import is enabled and toggle if needed
  let importWasEnabled = false;
  const siteConfig = site.getConfig();
  const imports = siteConfig?.getImports() || [];

  if (!isImportEnabled(IMPORT_AHREF_PAID_PAGES, imports)) {
    log.debug(`[ad-intent-mismatch] [Site: ${finalUrl}] Enabling ${IMPORT_AHREF_PAID_PAGES} import for site ${siteId}`);
    await toggleImport(site, IMPORT_AHREF_PAID_PAGES, true, log);
    importWasEnabled = true;
  }

  return {
    // Required for first step - creates the audit
    auditResult: {
      status: 'pending',
      message: 'Waiting for ahref-paid-pages import to complete',
    },
    fullAuditRef: finalUrl,
    // Import worker payload
    type: IMPORT_AHREF_PAID_PAGES,
    siteId,
    allowCache: false,
    // Pass along whether we enabled the import (for potential cleanup)
    auditContext: {
      importWasEnabled,
    },
  };
}

/**
 * Step 2: Run the paid keyword analysis after import completes and send to Mystique
 * This is the final step that:
 * 1. Disables the import if it was enabled in step 1
 * 2. Runs Athena analysis
 * 3. Updates the audit with results
 * 4. Fetches Ahrefs data from S3 (mandatory)
 * 5. Applies URL pattern exclusion
 * 6. Applies bounce rate filter
 * 7. Computes WSIS priority score
 * 8. Caps to top N pages
 * 9. Sends enriched messages to Mystique
 * @param {Object} context - Step context
 * @returns {Promise<Object>} Step result
 */
export async function runPaidKeywordAnalysisStep(context) {
  const {
    site, finalUrl, audit, log, auditContext, sqs, env,
  } = context;
  const siteId = site.getId();

  log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] Step 2: Running paid keyword analysis`);

  // Disable import if we enabled it in step 1 (cleanup - don't fail audit if this fails)
  if (auditContext?.importWasEnabled) {
    log.debug(`[ad-intent-mismatch] [Site: ${finalUrl}] Disabling ${IMPORT_AHREF_PAID_PAGES} import for site ${siteId}`);
    try {
      await toggleImport(site, IMPORT_AHREF_PAID_PAGES, false, log);
    } catch (error) {
      log.error(`[ad-intent-mismatch] [Site: ${finalUrl}] Failed to disable import (cleanup): ${error.message}`);
    }
  }

  // Run the actual analysis
  const result = await paidKeywordOptimizerRunner(finalUrl, context, site);

  // Persist the real audit results (Audit model does not allow updates,
  // so we create a new audit entry with the final results)
  const { Audit: AuditModel } = context.dataAccess;
  const newAudit = await AuditModel.create({
    siteId,
    isLive: site.getIsLive(),
    auditedAt: new Date().toISOString(),
    auditType: audit.getAuditType(),
    auditResult: result.auditResult,
    fullAuditRef: audit.getFullAuditRef(),
  });
  const newAuditId = newAudit.getId();

  log.debug(`[ad-intent-mismatch] [Site: ${finalUrl}] Audit updated with analysis results`);

  const { auditResult } = result;
  const searchPages = auditResult.predominantlyPaidPages;

  // Fetch Ahrefs data (mandatory — terminate if fails)
  let ahrefsMap;
  try {
    ahrefsMap = await fetchPaidPagesFromS3(context, siteId);
  } catch (error) {
    log.error(`[ad-intent-mismatch] [Site: ${finalUrl}] Audit terminated: Ahrefs data unavailable for site ${siteId}. Reason: ${error.message}`);
    return {};
  }

  // Check for empty traffic data
  if (searchPages.length === 0) {
    log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] No predominantly paid pages found; skipping mystique`);
    return {};
  }

  // URL pattern exclusion
  const urlFilteredPages = searchPages.filter((page) => !isExcludedPageType(page.url));

  // Bounce rate filter
  const bounceFilteredPages = urlFilteredPages.filter(
    (page) => page.bounceRate >= CUT_OFF_BOUNCE_RATE,
  );

  // Enrich with Ahrefs data and compute priority score
  const MAX_PAGES = parseInt(env.AD_INTENT_MAX_PAGES || '10', 10);

  const rankedPages = bounceFilteredPages
    .map((page) => {
      const ahrefs = ahrefsMap.get(normalizeUrl(page.url)) || {};
      return {
        ...page,
        cpc: ahrefs.cpc || 0,
        sumTraffic: ahrefs.sumTraffic || 0,
        topKeyword: ahrefs.topKeyword || '',
        serpTitle: ahrefs.serpTitle || '',
        priorityScore: computePriorityScore(page, ahrefs),
      };
    })
    .filter((page) => page.priorityScore > 0.01)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, MAX_PAGES > 0 ? MAX_PAGES : undefined);

  // Pipeline summary log
  log.info(
    `[ad-intent-mismatch] Filter pipeline for site ${siteId}: `
    + `${searchPages.length} paid pages → ${urlFilteredPages.length} URL-pass `
    + `→ ${bounceFilteredPages.length} bounce-pass → ${rankedPages.length} after scoring+cap`,
  );

  if (rankedPages.length === 0) {
    log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] No pages passed pipeline; skipping mystique`);
    return {};
  }

  // Send enriched messages
  await Promise.all(rankedPages.map((page) => {
    const mystiqueMessage = buildMystiqueMessage(site, newAuditId, page);
    log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] Sending message for ${page.url}`);
    return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  }));

  log.info(`[ad-intent-mismatch] [Site: ${finalUrl}] Step complete - sent ${rankedPages.length} messages`);

  return {};
}

// Legacy function for backward compatibility with tests
export async function sendToMystique(auditUrl, auditData, context, site) {
  const { log, sqs, env } = context;
  const { auditResult, id } = auditData;

  // Filter pages with bounce rate >= threshold
  const qualifyingPages = (auditResult.predominantlyPaidPages || [])
    .filter((page) => page.bounceRate >= CUT_OFF_BOUNCE_RATE);

  if (qualifyingPages.length === 0) {
    log.info(
      `[ad-intent-mismatch] [Site: ${auditUrl}] No pages with bounce rate >= ${CUT_OFF_BOUNCE_RATE} found; skipping mystique`,
    );
    return;
  }

  log.info(
    `[ad-intent-mismatch] [Site: ${auditUrl}] Found ${qualifyingPages.length} pages with high bounce rate`,
  );

  // Send one message per qualifying page
  await Promise.all(qualifyingPages.map((page) => {
    const mystiqueMessage = buildMystiqueMessage(site, id, page);
    log.info(
      `[ad-intent-mismatch] [Site: ${auditUrl}] Sending message for ${page.url} to mystique: `
      + `${JSON.stringify(mystiqueMessage, null, 2)}`,
    );
    return sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  }));

  log.info(`[ad-intent-mismatch] [Site: ${auditUrl}] Completed mystique evaluation step - sent ${qualifyingPages.length} messages`);
}

export {
  normalizeUrl,
  isExcludedPageType,
  fetchPaidPagesFromS3,
  computePriorityScore,
  buildMystiqueMessage,
  buildPathTrafficMap,
  isPredominantlyPaid,
  getPaidTrafficRow,
  transformResultItem,
  getConfig,
  EXCLUDE_URL_PATTERNS,
};

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('triggerPaidPagesImportStep', triggerPaidPagesImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('importTrafficAnalysisWeekStep0', importTrafficAnalysisWeekStep0, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('importTrafficAnalysisWeekStep1', importTrafficAnalysisWeekStep1, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('importTrafficAnalysisWeekStep2', importTrafficAnalysisWeekStep2, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('importTrafficAnalysisWeekStep3', importTrafficAnalysisWeekStep3, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('runPaidKeywordAnalysisStep', runPaidKeywordAnalysisStep)
  .build();
