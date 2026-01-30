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
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { fetchCPCData, getCPCForTrafficType, DEFAULT_CPC } from './ahrefs-cpc.js';
import { calculateBounceGapLoss as calculateGenericBounceGapLoss } from './bounce-gap-calculator.js';
import { retrieveAuditById } from '../utils/data-access.js';
import {
  getTop3PagesWithTrafficLostTemplate,
  getBounceGapMetricsTemplate,
} from './queries.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const CUT_OFF_BOUNCE_RATE = 0.3;

async function getCPCData(context, siteId) {
  const { log, env } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;

  const cpcData = await fetchCPCData(context, bucketName, siteId, log);

  log.info(`[paid-audit] [Site: ${siteId}] CPC loaded (${cpcData.source}): organic=$${cpcData.organicCPC.toFixed(4)}, paid=$${cpcData.paidCPC.toFixed(4)}`);

  return cpcData;
}

/**
 * Calculates projected traffic value by applying the appropriate CPC per traffic type.
 * - paid traffic uses paidCPC
 * - earned/owned traffic uses organicCPC
 *
 * @param {Object} byTrafficType - Loss breakdown by traffic type
 *   Example: { paid: { loss }, earned: { loss }, owned: { loss } }
 * @param {Object} cpcData - CPC data from fetchCPCData { organicCPC, paidCPC, source }
 * @returns {number} Total projected traffic value in dollars
 */
function calculateProjectedTrafficValue(byTrafficType, cpcData) {
  let totalValue = 0;

  for (const [trfType, data] of Object.entries(byTrafficType)) {
    const cpc = getCPCForTrafficType(trfType, cpcData);
    totalValue += data.loss * cpc;
  }

  return totalValue;
}

const AUDIT_CONSTANTS = {
  GUIDANCE_TYPE: 'guidance:paid-cookie-consent',
  OBSERVATION: 'High bounce rate detected on paid traffic page',
};

const IMPORT_TYPE_TRAFFIC_ANALYSIS = 'traffic-analysis';

function isImportEnabled(importType, imports) {
  return imports?.find((importConfig) => importConfig.type === importType)?.enabled;
}

async function enableImport(site, importType, log) {
  const siteConfig = site.getConfig();
  if (!siteConfig) {
    const errorMsg = `Cannot enable import ${importType} for site ${site.getId()}: site config is null`;
    log.error(errorMsg);
    throw new Error(errorMsg);
  }
  siteConfig.enableImport(importType);
  site.setConfig(Config.toDynamoItem(siteConfig));
  await site.save();
}

function getConfig(env) {
  const {
    RUM_METRICS_DATABASE: rumMetricsDatabase,
    RUM_METRICS_COMPACT_TABLE: rumMetricsCompactTable,
    S3_IMPORTER_BUCKET_NAME: bucketName,
    PAID_DATA_THRESHOLD: paidDataThreshold,
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for paid audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    pageViewThreshold: paidDataThreshold ?? 1000,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
  };
}

function transformResultItem(item, baseURL) {
  return {
    path: item.path,
    url: item.path ? new URL(item.path, baseURL).toString() : undefined,
    device: item.device,
    trafficLoss: parseFloat(item.traffic_loss || 0),
    pageViews: parseInt(item.pageviews || 0, 10),
    pctPageviews: parseFloat(item.pct_pageviews || 0),
    clickRate: parseFloat(item.click_rate || 0),
    bounceRate: parseFloat(item.bounce_rate || 0),
    engagementRate: parseFloat(item.engagement_rate || 0),
    engagedScrollRate: parseFloat(item.engaged_scroll_rate || 0),
    source: item.utm_source || 'paid',
    referrer: item.referrer || '',
  };
}

async function executeTop3TrafficLostPagesQuery(
  athenaClient,
  dimensions,
  segmentName,
  siteId,
  temporalCondition,
  pageViewThreshold,
  limit,
  config,
  log,
  baseURL,
) {
  const dimensionColumns = dimensions.join(', ');
  const groupBy = dimensions.join(', ');
  const dimensionColumnsPrefixed = dimensions.map((dim) => `a.${dim}`).join(', ');

  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const query = getTop3PagesWithTrafficLostTemplate({
    siteId,
    tableName,
    temporalCondition,
    dimensionColumns,
    groupBy,
    dimensionColumnsPrefixed,
    pageViewThreshold,
    limit,
  });

  const description = `top 3 pages for lost traffic for siteId: ${siteId} | temporal: ${temporalCondition}`;

  log.debug(`[DEBUG] ${segmentName} Query:`, query);

  const result = await athenaClient.query(query, config.rumMetricsDatabase, description);
  return result.map((item) => transformResultItem(item, baseURL));
}

// const hasValues = (segment) => segment?.value?.length > 0;

/**
 * Executes the bounce gap metrics query to get bounce rates
 * for both consent='show' and consent='hidden' by traffic source.
 */
async function executeBounceGapMetricsQuery(
  athenaClient,
  siteId,
  temporalCondition,
  config,
  log,
) {
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const query = getBounceGapMetricsTemplate({
    siteId,
    tableName,
    temporalCondition,
  });

  const description = `bounce gap metrics consent(show - hidden) for siteId: ${siteId}`;

  log.debug('[DEBUG] Bounce Gap Metrics Query:', query);

  const result = await athenaClient.query(query, config.rumMetricsDatabase, description);
  return result.map((item) => ({
    trfType: item.trf_type,
    consent: item.consent,
    pageViews: parseInt(item.pageviews || 0, 10),
    bounceRate: parseFloat(item.bounce_rate || 0),
  }));
}

/**
 * Calculates projected traffic lost using bounce gap attribution.
 * Formula: sum of (PV_show × max(0, BR_show - BR_hidden)) per trf_type
 *
 * Data transformation:
 * - Input: flat array of rows with {trfType, consent, pageViews, bounceRate}
 * - Groups by: trfType (paid, earned, owned)
 * - Treatment: 'show' (consent banner visible)
 * - Control: 'hidden' (consent banner not visible)
 *
 * @param {Array} bounceGapData - Array of {trfType, consent, pageViews, bounceRate}
 * @param {Object} log - Logger instance
 * @returns {Object} { projectedTrafficLost, hasShowData, hasHiddenData, byTrafficType }
 */
export function calculateBounceGapLoss(bounceGapData, log) {
  const TREATMENT = 'show'; // consent banner visible - causes higher bounce rate
  const CONTROL = 'hidden'; // consent banner not visible - baseline bounce rate

  // Group flat data by traffic type, then by consent state
  // Result: { paid: { show: {...}, hidden: {...} }, earned: {...}, owned: {...} }
  const groupedByTrafficType = {};
  for (const row of bounceGapData) {
    if (!groupedByTrafficType[row.trfType]) groupedByTrafficType[row.trfType] = {};
    groupedByTrafficType[row.trfType][row.consent] = {
      pageViews: row.pageViews,
      bounceRate: row.bounceRate,
    };
  }

  // Validate we have both treatment and control data
  const hasShowData = Object.values(groupedByTrafficType).some((g) => g[TREATMENT]);
  const hasHiddenData = Object.values(groupedByTrafficType).some((g) => g[CONTROL]);

  if (!hasShowData || !hasHiddenData) {
    log.warn(`[paid-audit] Missing consent data - show:${hasShowData} hidden:${hasHiddenData}`);
    return { projectedTrafficLost: 0, hasShowData, hasHiddenData };
  }

  // Calculate bounce gap loss per traffic type
  const result = calculateGenericBounceGapLoss(groupedByTrafficType, log, TREATMENT, CONTROL);

  return {
    projectedTrafficLost: result.totalLoss,
    hasShowData,
    hasHiddenData,
    byTrafficType: result.byGroup,
  };
}

/**
 * Calculates sitewide bounce delta (pp) for description text.
 * Formula: Sitewide_BR_show - Sitewide_BR_hidden (all traffic sources)
 *
 * @param {Array} bounceGapData - Array of {trfType, consent, pageViews, bounceRate}
 * @returns {number} Bounce rate difference in decimal (0.12 = 12pp), floored at 0
 */
export function calculateSitewideBounceDelta(bounceGapData) {
  let totalPVShow = 0;
  let totalBouncesShow = 0;
  let totalPVHidden = 0;
  let totalBouncesHidden = 0;

  for (const row of bounceGapData) {
    if (row.consent === 'show') {
      totalPVShow += row.pageViews;
      totalBouncesShow += row.pageViews * row.bounceRate;
    } else if (row.consent === 'hidden') {
      totalPVHidden += row.pageViews;
      totalBouncesHidden += row.pageViews * row.bounceRate;
    }
  }

  const sitewideShowBR = totalPVShow > 0 ? totalBouncesShow / totalPVShow : 0;
  const sitewideHiddenBR = totalPVHidden > 0 ? totalBouncesHidden / totalPVHidden : 0;

  return Math.max(0, sitewideShowBR - sitewideHiddenBR);
}

function buildMystiqueMessage(site, auditId, url) {
  return {
    type: AUDIT_CONSTANTS.GUIDANCE_TYPE,
    observation: AUDIT_CONSTANTS.OBSERVATION,
    siteId: site.getId(),
    url,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      url,
    },
  };
}

export async function paidAuditRunner(auditUrl, context, site) {
  const { log, env } = context;
  const config = getConfig(env);
  const siteId = site.getId();
  const baseURL = site.getBaseURL();

  log.debug(
    `[paid-audit] [Site: ${auditUrl}] Querying paid Athena metrics with consent and referrer data (siteId: ${siteId})`,
  );

  // Get temporal parameters (7 days back from current week)
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });

  const athenaClient = AWSAthenaClient.fromContext(context, `${config.athenaTemp}/paid-audit-cookie-consent/${siteId}-${Date.now()}`);

  try {
    log.debug(`[paid-audit] [Site: ${auditUrl}] Executing Athena queries for paid traffic segments`);

    // Execute bounce gap metrics query for main projected traffic lost calculation
    const bounceGapData = await executeBounceGapMetricsQuery(
      athenaClient,
      siteId,
      temporalCondition,
      config,
      log,
    );

    // Calculate projected traffic lost using bounce gap data
    const {
      projectedTrafficLost,
      hasShowData,
      hasHiddenData,
      byTrafficType,
    } = calculateBounceGapLoss(bounceGapData, log);

    // Calculate sitewide bounce delta for description text
    const sitewideBounceDelta = calculateSitewideBounceDelta(bounceGapData);

    // Abort if no show data - we can't do meaningful bounce gap calculation
    if (!hasShowData) {
      log.warn(
        `[paid-audit] [Site: ${auditUrl}] No show consent data available; `
        + 'cannot calculate bounce gap metrics. Aborting audit.',
      );
      return {
        auditResult: null,
        fullAuditRef: auditUrl,
      };
    }

    // Abort if no hidden data - we can't do meaningful bounce gap calculation
    if (!hasHiddenData) {
      log.warn(
        `[paid-audit] [Site: ${auditUrl}] No hidden consent data available; `
        + 'cannot calculate bounce gap metrics. Aborting audit.',
      );
      return {
        auditResult: null,
        fullAuditRef: auditUrl,
      };
    }

    // Get CPC data and calculate projected traffic value per traffic type
    const cpcData = await getCPCData(context, site.getId());
    const projectedTrafficValue = calculateProjectedTrafficValue(byTrafficType, cpcData);

    // For output, use paid CPC as the applied CPC (this is a paid cookie consent audit)
    const appliedCPC = cpcData.paidCPC;
    const cpcSource = cpcData.source;

    log.info(`[paid-audit] [Site: ${siteId}] Traffic: lost=${projectedTrafficLost.toFixed(0)}, value=$${projectedTrafficValue.toFixed(2)}, cpc=$${appliedCPC.toFixed(4)} (${cpcSource})`);

    // Continue with existing queries for top3 pages and device breakdown
    const lostTrafficSummary = await executeTop3TrafficLostPagesQuery(athenaClient, ['device'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, null, config, log, baseURL);
    const top3PagesTrafficLost = await executeTop3TrafficLostPagesQuery(athenaClient, ['path'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, 3, config, log, baseURL);
    const top3PagesTrafficLostByDevice = await executeTop3TrafficLostPagesQuery(athenaClient, ['path', 'device'], 'Top 3 Pages with Traffic Lost', siteId, temporalCondition, 0, null, config, log, baseURL);
    // top 3 pages with highest projectedTrafficLost
    const top3Pages = top3PagesTrafficLost;
    // averagePageViewsTop3  /  averageTrafficLostTop3  / averageBounceRateMobileTop3
    const averagePageViewsTop3 = top3PagesTrafficLost
      .reduce((sum, item) => sum + item.pageViews, 0) / top3PagesTrafficLost.length;
    const averageTrafficLostTop3 = top3PagesTrafficLost
      .reduce((sum, item) => sum + item.trafficLoss, 0) / top3PagesTrafficLost.length;
    const top3PagesMobileOnly = top3PagesTrafficLostByDevice
      .filter((item) => item.device === 'mobile');
    const averageBounceRateMobileTop3 = top3PagesMobileOnly
      .reduce((sum, item) => sum + item.bounceRate, 0) / top3PagesMobileOnly.length;
    const totalPageViews = lostTrafficSummary.reduce((sum, item) => sum + item.pageViews, 0);
    const totalAverageBounceRate = totalPageViews > 0 ? projectedTrafficLost / totalPageViews : 0;

    const auditResult = {
      totalPageViews,
      totalAverageBounceRate,
      projectedTrafficLost,
      projectedTrafficValue,
      sitewideBounceDelta,
      top3Pages,
      averagePageViewsTop3,
      averageTrafficLostTop3,
      averageBounceRateMobileTop3,
      temporalCondition,
      // CPC information for transparency
      appliedCPC,
      cpcSource,
      defaultCPC: DEFAULT_CPC,
      // Only include Ahrefs CPC values if available
      ...(cpcSource === 'ahrefs' && {
        ahrefsOrganicCPC: cpcData.organicCPC,
        ahrefsPaidCPC: cpcData.paidCPC,
      }),
    };
    log.info(`[paid-audit] [Site: ${auditUrl}] Summary: pv=${totalPageViews}, lost=${projectedTrafficLost.toFixed(0)}, value=$${projectedTrafficValue.toFixed(2)}, top3=${top3Pages.length}`);
    return {
      auditResult,
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`[paid-audit] [Site: ${auditUrl}] Paid traffic Athena query failed: ${error.message}`);
    throw error;
  }
}

export async function paidConsentBannerCheck(auditUrl, auditData, context, site) {
  const {
    log, sqs, env,
  } = context;

  const { auditResult, id } = auditData;

  // // take first page which has highest projectedTrafficLost
  const selected = auditResult.top3Pages?.length > 0 ? auditResult.top3Pages[0] : null;
  const selectedPageUrl = selected?.url;
  if (!selectedPageUrl) {
    log.warn(
      `[paid-audit] [Site: ${auditUrl}] No pages with consent='show' found for consent banner audit; skipping`,
    );
    return;
  }

  const mystiqueMessage = buildMystiqueMessage(site, id, selectedPageUrl);

  const projected = selected?.trafficLoss;
  log.debug(
    `[paid-audit] [Site: ${auditUrl}] Sending consent-seen page ${selectedPageUrl} with message `
    + `(projectedTrafficLoss: ${projected}) ${JSON.stringify(mystiqueMessage, 2)} `
    + 'evaluation to mystique',
  );
  if (selected?.bounceRate >= CUT_OFF_BOUNCE_RATE) {
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
    log.debug(`[paid-audit] [Site: ${auditUrl}] Completed mystique evaluation step`);
  } else {
    log.debug(`[paid-audit] [Site: ${auditUrl}] Skipping mystique evaluation step for page ${selectedPageUrl} with bounce rate ${selected?.bounceRate}`);
  }
}

function createImportStep(weekIndex) {
  return async function triggerTrafficAnalysisImportStep(context) {
    const { site, finalUrl, log } = context;
    const siteId = site.getId();

    // Get the last 4 completed weeks (oldest first)
    const weeks = getLastNumberOfWeeks(4);
    const { week, year } = weeks[weekIndex];

    log.info(`[paid-audit] [Site: ${finalUrl}] Import step ${weekIndex + 1}/4: Triggering traffic-analysis import for week ${week}/${year}`);

    // Only enable import on the first step
    if (weekIndex === 0) {
      const siteConfig = site.getConfig();
      const imports = siteConfig?.getImports() || [];

      if (!isImportEnabled(IMPORT_TYPE_TRAFFIC_ANALYSIS, imports)) {
        log.debug(`[paid-audit] [Site: ${finalUrl}] Enabling ${IMPORT_TYPE_TRAFFIC_ANALYSIS} import for site ${siteId}`);
        await enableImport(site, IMPORT_TYPE_TRAFFIC_ANALYSIS, log);
      }
    }

    return {
      auditResult: {
        status: 'pending',
        message: `Importing traffic-analysis data for week ${week}/${year}`,
      },
      fullAuditRef: finalUrl,
      type: IMPORT_TYPE_TRAFFIC_ANALYSIS,
      siteId,
      allowCache: true,
      auditContext: {
        week,
        year,
      },
    };
  };
}

// Create the 4 import steps
export const importWeekStep0 = createImportStep(0);
export const importWeekStep1 = createImportStep(1);
export const importWeekStep2 = createImportStep(2);
export const importWeekStep3 = createImportStep(3);

export async function runPaidConsentAnalysisStep(context) {
  const {
    site, finalUrl, log, dataAccess, auditContext,
  } = context;

  log.info(`[paid-audit] [Site: ${finalUrl}] Step 5: Running consent banner analysis`);

  // The StepAudit framework only loads the audit for steps that have a next step.
  // Since this is the final step, we need to fetch the audit ourselves.
  const audit = await retrieveAuditById(dataAccess, auditContext.auditId, log);
  if (!audit) {
    log.error(`[paid-audit] [Site: ${finalUrl}] Audit ${auditContext.auditId} not found; cannot update results`);
    return {};
  }

  // Run existing analysis logic (reuses paidAuditRunner)
  const result = await paidAuditRunner(finalUrl, context, site);

  // IMPORTANT: paidAuditRunner returns { auditResult: null } when no
  // show/hidden consent data exists. Must handle this early-exit case.
  if (!result.auditResult) {
    log.warn(`[paid-audit] [Site: ${finalUrl}] No consent data available; skipping analysis step`);
    return {};
  }

  // Update audit with real results (replaces the "pending" placeholder from step 1)
  audit.setAuditResult(result.auditResult);
  await audit.save();

  // Run existing post-processor logic (moved from .withPostProcessors)
  // Wrapped in try-catch to match post-processor error semantics:
  // audit is already saved, so a failure here should log but not fail the step.
  try {
    const auditData = { auditResult: result.auditResult, id: audit.getId() };
    await paidConsentBannerCheck(finalUrl, auditData, context, site);
  } catch (error) {
    log.error(`[paid-audit] [Site: ${finalUrl}] Post-processor paidConsentBannerCheck failed: ${error.message}`);
  }

  return {};
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-week-0', importWeekStep0, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-1', importWeekStep1, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-2', importWeekStep2, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('import-week-3', importWeekStep3, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('run-consent-analysis', runPaidConsentAnalysisStep)
  .build();
