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
import {
  getWeekInfo, getMonthInfo, getLastNumberOfWeeks, getTemporalCondition,
} from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { Config } from '@adobe/spacecat-shared-data-access/src/models/site/config.js';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { warmCacheForSite } from './cache-warmer.js';
import { getTotalPageViewsTemplate } from './queries.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const IMPORT_TYPE_TRAFFIC_ANALYSIS = 'traffic-analysis';
const AUDIT_TYPE = 'paid-traffic-analysis';

const THRESHOLD_LOW = 30000;
const THRESHOLD_HIGH = 120000;

const REPORT_DECISION = {
  NOT_ENOUGH_DATA: 'not enough data',
  MONTHLY: 'monthly report',
  WEEKLY: 'weekly report',
};

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
  } = env;

  if (!bucketName) {
    throw new Error('S3_IMPORTER_BUCKET_NAME must be provided for paid-traffic-analysis audit');
  }

  return {
    rumMetricsDatabase: rumMetricsDatabase ?? 'rum_metrics',
    rumMetricsCompactTable: rumMetricsCompactTable ?? 'compact_metrics',
    bucketName,
    athenaTemp: `s3://${bucketName}/rum-metrics-compact/temp/out`,
  };
}

function determineReportDecision(totalPageViewSum) {
  if (totalPageViewSum < THRESHOLD_LOW) {
    return REPORT_DECISION.NOT_ENOUGH_DATA;
  }
  if (totalPageViewSum < THRESHOLD_HIGH) {
    return REPORT_DECISION.MONTHLY;
  }
  return REPORT_DECISION.WEEKLY;
}

export function getWeeksForMonth(targetMonth, targetYear) {
  const weeks = getLastNumberOfWeeks(20);
  return weeks.filter(({ week, year }) => {
    const { month: weekMonth } = getWeekInfo(week, year);
    return year === targetYear && weekMonth === targetMonth;
  });
}

function collectWeeksToImport() {
  const decisionWeeks = getLastNumberOfWeeks(4);

  const monthlyWeeks = [];
  for (let i = 1; i <= 4; i += 1) {
    const now = new Date();
    now.setMonth(now.getMonth() - i);
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const weeksInMonth = getWeeksForMonth(month, year);
    monthlyWeeks.push(...weeksInMonth);
  }

  const allWeeks = [...decisionWeeks, ...monthlyWeeks];
  const seen = new Set();
  return allWeeks.filter(({ week, year }) => {
    const key = `${week}-${year}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildMystiqueMessage(site, auditId, baseUrl, auditResult) {
  return {
    type: 'guidance:traffic-analysis',
    siteId: auditResult.siteId,
    url: baseUrl,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      year: auditResult.year,
      month: auditResult.month,
      week: auditResult.period === 'weekly' ? auditResult.week : 0,
      temporalCondition: auditResult.temporalCondition,
    },
  };
}

export async function prepareTrafficAnalysisRequest(auditUrl, context, site, period) {
  const { log } = context;
  const siteId = site.getSiteId();

  log.debug(`[paid-traffic-analysis] Preparing ${period} request parameters for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);

  let auditResult;

  if (period === 'monthly') {
    const { month, year, temporalCondition } = getMonthInfo();
    auditResult = {
      year,
      month,
      siteId,
      temporalCondition,
      period,
    };
  } else {
    const {
      week, year, month, temporalCondition,
    } = getWeekInfo();
    auditResult = {
      year,
      week,
      month,
      siteId,
      temporalCondition,
      period,
    };
  }

  log.debug(`[paid-traffic-analysis] Request parameters: ${JSON.stringify(auditResult)} set for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);
  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function sendRequestToMystique(auditUrl, auditData, context, site) {
  const { id, auditResult, period } = auditData;
  const {
    log, sqs, env, siteId,
  } = context;

  const temporalParams = {
    yearInt: auditResult.year,
    weekInt: auditResult.week || 0,
    monthInt: auditResult.month,
  };

  log.debug(`[paid-traffic-analysis] cache-warming-${period} Starting cache warming for site: ${siteId}`);
  await warmCacheForSite(context, log, env, site, temporalParams);
  log.debug(`[paid-traffic-analysis] cache-warming-${period} Completed cache warming for site: ${siteId}`);

  const mystiqueMessage = buildMystiqueMessage(site, id, auditUrl, auditResult);

  log.debug(`[paid-traffic-analysis] [siteId: ${siteId}] [baseUrl: ${auditUrl}] sending message ${JSON.stringify(mystiqueMessage)} to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.debug(`[paid-traffic-analysis] [siteId: ${siteId}] [baseUrl: ${auditUrl}] Completed mystique evaluation step`);
}

// Step 1: import-data
// Enables traffic-analysis import if needed, collects all weeks for decision + monthly trends,
// sends all-but-last as parallel SQS imports, returns last for IMPORT_WORKER chain.
export async function importDataStep(context) {
  const {
    site, finalUrl, log, sqs, dataAccess,
  } = context;
  const siteId = site.getId();
  const allowCache = true;

  log.info(`[paid-traffic-analysis] Starting import data step for siteId: ${siteId}, url: ${finalUrl}`);

  // Enable traffic-analysis import type if not already enabled
  const siteConfig = site.getConfig();
  const imports = siteConfig?.getImports() || [];
  if (!isImportEnabled(IMPORT_TYPE_TRAFFIC_ANALYSIS, imports)) {
    log.debug(`[paid-traffic-analysis] Enabling ${IMPORT_TYPE_TRAFFIC_ANALYSIS} import for site ${siteId}`);
    await enableImport(site, IMPORT_TYPE_TRAFFIC_ANALYSIS, log);
  }

  // Collect all weeks needed: decision weeks (last 4) + last 4 months' weeks, deduplicated
  const allWeeks = collectWeeksToImport();

  log.info(`[paid-traffic-analysis] [siteId: ${siteId}] Collected ${allWeeks.length} unique weeks for import: [${allWeeks.map((w) => `${w.week}/${w.year}`).join(', ')}]`);

  // Send all-but-last as parallel fire-and-forget SQS imports
  const weeksToImport = allWeeks.slice(0, -1);
  const lastWeek = allWeeks[allWeeks.length - 1];

  const { Configuration } = dataAccess;
  const configuration = await Configuration.findLatest();

  for (const weekInfo of weeksToImport) {
    const message = {
      type: IMPORT_TYPE_TRAFFIC_ANALYSIS,
      siteId,
      auditContext: {
        week: weekInfo.week,
        year: weekInfo.year,
      },
      allowCache,
    };

    log.debug(`[paid-traffic-analysis] [siteId: ${siteId}] Sending import message for week ${weekInfo.week}/${weekInfo.year}`);
    // eslint-disable-next-line no-await-in-loop
    await sqs.sendMessage(configuration.getQueues().imports, message);
  }

  log.info(`[paid-traffic-analysis] [siteId: ${siteId}] Sent ${weeksToImport.length} parallel imports, reserving week ${lastWeek.week}/${lastWeek.year} for main audit flow`);

  // Return last week for chaining through IMPORT_WORKER
  return {
    auditResult: {
      status: 'pending',
      message: `Importing traffic-analysis data for week ${lastWeek.week}/${lastWeek.year}`,
    },
    fullAuditRef: finalUrl,
    type: IMPORT_TYPE_TRAFFIC_ANALYSIS,
    siteId,
    allowCache,
    auditContext: {
      week: lastWeek.week,
      year: lastWeek.year,
    },
  };
}

// Step 2: analyze-and-report
// Queries Athena for total paid pageviews, determines decision, generates reports.
export async function analyzeAndReportStep(context) {
  const {
    site, log, dataAccess, env,
  } = context;
  const siteId = site.getId();
  const finalUrl = site.getBaseURL();

  log.info(`[paid-traffic-analysis] Starting analyze-and-report step for siteId: ${siteId}`);

  // Decision phase: query Athena for total paid pageviews (last 4 weeks)
  const config = getConfig(env);
  const { week, year } = getWeekInfo();
  const temporalCondition = getTemporalCondition({ week, year, numSeries: 4 });
  const tableName = `${config.rumMetricsDatabase}.${config.rumMetricsCompactTable}`;

  const athenaClient = AWSAthenaClient.fromContext(
    context,
    `${config.athenaTemp}/paid-traffic-analysis/${siteId}-${Date.now()}`,
  );

  const query = getTotalPageViewsTemplate({
    siteId,
    tableName,
    temporalCondition,
  });

  log.debug(`[paid-traffic-analysis] [siteId: ${siteId}] Executing total pageviews query`);

  const result = await athenaClient.query(
    query,
    config.rumMetricsDatabase,
    `paid-traffic-analysis total pageviews for siteId: ${siteId}`,
  );

  const totalPageViewSum = parseInt(result?.[0]?.total_pageview_sum || 0, 10);
  const reportDecision = determineReportDecision(totalPageViewSum);

  log.info(`[paid-traffic-analysis] [siteId: ${siteId}] totalPageViewSum=${totalPageViewSum}, reportDecision=${reportDecision}`);

  if (reportDecision === REPORT_DECISION.NOT_ENOUGH_DATA) {
    return {
      auditResult: { totalPageViewSum, reportDecision },
      fullAuditRef: finalUrl,
    };
  }

  const { Audit: AuditModel, Opportunity } = dataAccess;
  const reportsGenerated = [];

  // Weekly report (only when decision is WEEKLY)
  if (reportDecision === REPORT_DECISION.WEEKLY) {
    const weeklyRequest = await prepareTrafficAnalysisRequest(finalUrl, context, site, 'weekly');
    const weeklyAudit = await AuditModel.create({
      siteId,
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult: weeklyRequest.auditResult,
      fullAuditRef: finalUrl,
    });

    await sendRequestToMystique(
      finalUrl,
      { id: weeklyAudit.getId(), auditResult: weeklyRequest.auditResult, period: 'weekly' },
      context,
      site,
    );

    reportsGenerated.push('weekly');
    log.info(`[paid-traffic-analysis] [siteId: ${siteId}] Weekly report generated, auditId=${weeklyAudit.getId()}`);
  }

  // Monthly report (when decision is MONTHLY or WEEKLY)
  const { month, year: monthYear } = getMonthInfo();

  // Check if monthly report already exists for this period
  const existingOpportunities = await Opportunity.allBySiteId(siteId);
  const hasMonthlyReport = existingOpportunities.some((o) => {
    const data = o.getData();
    return o.getType() === 'paid-traffic'
      && data?.month === month
      && data?.year === monthYear
      && data?.week == null;
  });

  if (hasMonthlyReport) {
    log.info(`[paid-traffic-analysis] [siteId: ${siteId}] Monthly report for ${month}/${monthYear} already exists, skipping`);
  } else {
    const monthlyRequest = await prepareTrafficAnalysisRequest(finalUrl, context, site, 'monthly');
    const monthlyAudit = await AuditModel.create({
      siteId,
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult: monthlyRequest.auditResult,
      fullAuditRef: finalUrl,
    });

    await sendRequestToMystique(
      finalUrl,
      { id: monthlyAudit.getId(), auditResult: monthlyRequest.auditResult, period: 'monthly' },
      context,
      site,
    );

    reportsGenerated.push('monthly');
    log.info(`[paid-traffic-analysis] [siteId: ${siteId}] Monthly report generated, auditId=${monthlyAudit.getId()}`);
  }

  return {
    auditResult: { totalPageViewSum, reportDecision, reportsGenerated },
    fullAuditRef: finalUrl,
  };
}

const paidTrafficAnalysis = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-data', importDataStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('analyze-and-report', analyzeAndReportStep)
  .build();

export default paidTrafficAnalysis;
