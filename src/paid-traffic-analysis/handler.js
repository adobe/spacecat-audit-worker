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
import { getWeekInfo, getMonthInfo, getLastNumberOfWeeks } from '@adobe/spacecat-shared-utils';
import { Audit } from '@adobe/spacecat-shared-data-access';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { warmCacheForSite } from './cache-warmer.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

function buildMystiqueMessage(site, auditId, baseUrl, auditResult) {
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
      week: auditResult.week,
      temporalCondition: auditResult.temporalCondition,
    },
  };
}

/**
 * Prepares traffic analysis request parameters for either weekly or monthly analysis
 * @param {string} auditUrl - The URL being audited
 * @param {Object} context - The audit context
 * @param {Object} site - The site object
 * @param {'weekly'|'monthly'} period - The analysis period
 * @returns {Object} Audit result and reference
 */
export async function prepareTrafficAnalysisRequest(auditUrl, context, site, period) {
  const { log } = context;
  const siteId = site.getSiteId();

  log.info(`[traffic-analysis-audit-${period}] Preparing mystique traffic-analysis-audit request parameters for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);

  let auditResult;

  if (period === 'monthly') {
    const { month, year, temporalCondition } = getMonthInfo();

    auditResult = {
      year,
      month,
      siteId,
      temporalCondition,
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
    };
  }
  log.info(`[traffic-analysis-audit-${period}] Request parameters: ${JSON.stringify(auditResult)} set for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);
  return {
    auditResult,
    fullAuditRef: auditUrl,
    period,
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

  log.info(`[traffic-analysis-audit] cache-warming-${period} Starting cache warming for site: ${siteId}`);
  await warmCacheForSite(context, log, env, site, temporalParams);
  log.info(`[traffic-analysis-audit] cache-warming-${period} Completed cache warming for site: ${siteId}`);

  const mystiqueMessage = buildMystiqueMessage(site, id, auditUrl, auditResult);

  log.info(`[traffic-analysis-audit] [siteId:  ${siteId}] and [baseUrl:${auditUrl}] with message ${JSON.stringify(mystiqueMessage, 2)} evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[traffic-analysis-audit] [siteId: ${siteId}] [baseUrl:${siteId}] Completed mystique evaluation step`);
}

function getWeeksForMonth(targetMonth, targetYear) {
  // Get the last 6 weeks to ensure we cover the entire target month
  const weeks = getLastNumberOfWeeks(6);

  // Filter weeks that belong to the target month
  return weeks.filter(({ week, year }) => {
    // Get week info to determine which months this week spans
    const { month: weekMonth } = getWeekInfo(week, year);
    // Include weeks that overlap with the target month
    return year === targetYear && weekMonth === targetMonth;
  });
}

async function importDataStep(context, period) {
  const {
    site, finalUrl, log, sqs, dataAccess,
  } = context;
  const siteId = site.getId();
  const allowCache = true;
  log.info(`[traffic-analysis-import-${period}] Starting import data step for siteId: ${siteId}, url: ${finalUrl}`);

  if (period === 'monthly') {
    const { month, year } = getMonthInfo();
    const { Configuration } = dataAccess;
    const configuration = await Configuration.findLatest();

    // Get all weeks that overlap with this month
    const weeksInMonth = getWeeksForMonth(month, year);

    log.info(`[traffic-analysis-import-monthly] [siteId: ${siteId}] Found ${weeksInMonth.length} weeks for month ${month}/${year}: weeks [${weeksInMonth.map((w) => `${w.week}/${w.year}`).join(', ')}]`);

    // Send import requests for all weeks except the last one
    const weeksToImport = weeksInMonth.slice(0, -1);
    const lastWeek = weeksInMonth[weeksInMonth.length - 1];

    log.info(`[traffic-analysis-import-monthly] [siteId: ${siteId}] Sending import messages for ${weeksToImport.length} weeks: [${weeksToImport.map((w) => `${w.week}/${w.year}`).join(', ')}],  allowCache: ${allowCache}`);
    log.info(`[traffic-analysis-import-monthly] [siteId: ${siteId}] Reserving last week ${lastWeek.week}/${lastWeek.year} for main audit flow`);

    for (const weekInfo of weeksToImport) {
      const { temporalCondition } = getWeekInfo(weekInfo.week, weekInfo.year);

      const message = {
        type: 'traffic-analysis',
        siteId,
        auditContext: {
          week: weekInfo.week,
          year: weekInfo.year,
        },
        allowCache,
      };

      log.info(`[traffic-analysis-import-monthly] [siteId: ${siteId}] Sending import message for week ${weekInfo.week}/${weekInfo.year} with allowCache: ${allowCache}, temporalCondition: ${temporalCondition}`);
      // eslint-disable-next-line no-await-in-loop
      await sqs.sendMessage(configuration.getQueues().imports, message);
    }

    // Return the last week for the main audit flow
    const { temporalCondition } = getWeekInfo(lastWeek.week, lastWeek.year);

    log.info(`[traffic-analysis-import-monthly] [siteId: ${siteId}] Returning main audit flow data for week ${lastWeek.week}/${lastWeek.year} with allowCache: ${allowCache}, temporalCondition: ${temporalCondition}`);

    return {
      auditResult: {
        year,
        month,
        week: lastWeek.week,
        siteId,
        temporalCondition,
      },
      fullAuditRef: finalUrl,
      type: 'traffic-analysis',
      siteId,
      allowCache,
    };
  } else {
    const analysisResult = await prepareTrafficAnalysisRequest(
      finalUrl,
      context,
      site,
      period,
    );

    log.info(`[traffic-analysis-import-${period}] [siteId: ${siteId}] Prepared audit result for siteId: ${siteId}, sending to import worker with allowCache: ${allowCache}`);

    return {
      auditResult: analysisResult.auditResult,
      fullAuditRef: finalUrl,
      type: 'traffic-analysis',
      siteId,
      allowCache,
    };
  }
}

async function processAnalysisStep(context, period) {
  const { site, audit, log } = context;
  const finalUrl = site.getBaseURL();
  const siteId = site.getId();
  const auditId = audit.getId();

  log.info(`[traffic-analysis-process-${period}] Starting process analysis step for siteId: ${siteId}, auditId: ${auditId}, url: ${finalUrl}`);

  // Use the audit result that was already saved in the import step
  await sendRequestToMystique(
    finalUrl,
    { id: auditId, auditResult: audit.getAuditResult() },
    context,
    site,
  );

  log.info(`[traffic-analysis-process-${period}] Completed sending to Mystique for siteId: ${siteId}, auditId: ${auditId}`);

  return {
    status: 'complete',
    findings: ['Traffic analysis completed and sent to Mystique'],
  };
}

export const weeklyImportDataStep = (context) => importDataStep(context, 'weekly');
export const monthlyImportDataStep = (context) => importDataStep(context, 'monthly');
export const weeklyProcessAnalysisStep = (context) => processAnalysisStep(context, 'weekly');
export const monthlyProcessAnalysisStep = (context) => processAnalysisStep(context, 'monthly');

export const paidTrafficAnalysisWeekly = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-data', weeklyImportDataStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('process-analysis', weeklyProcessAnalysisStep)
  .build();

export const paidTrafficAnalysisMonthly = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-data', monthlyImportDataStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('process-analysis', monthlyProcessAnalysisStep)
  .build();
