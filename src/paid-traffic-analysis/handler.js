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
import { getWeekInfo, getMonthInfo } from '@adobe/spacecat-shared-utils';
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
  const { log, env } = context;
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

  // Warm cache for this site and period

  const temporalParams = {
    yearInt: auditResult.year,
    weekInt: auditResult.week || 0,
    monthInt: auditResult.month,
  };

  log.info(`[cache-warming-${period}] Starting cache warming for site: ${siteId}`);
  await warmCacheForSite(context, log, env, site, temporalParams);
  log.info(`[cache-warming-${period}] Completed cache warming for site: ${siteId}`);
  log.info(`[traffic-analysis-audit-${period}] Request parameters: ${JSON.stringify(auditResult)} set for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);

  return {
    auditResult,
    fullAuditRef: auditUrl,
  };
}

export async function sendRequestToMystique(auditUrl, auditData, context, site) {
  const { id, auditResult } = auditData;
  const {
    log, sqs, env, siteId,
  } = context;
  const mystiqueMessage = buildMystiqueMessage(site, id, auditUrl, auditResult);

  log.info(`[traffic-analysis-audit] [siteId:  ${siteId}] and [baseUrl:${auditUrl}] with message ${JSON.stringify(mystiqueMessage, 2)} evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[traffic-analysis-audit] [siteId: ${auditUrl}] [baseUrl:${auditUrl}] Completed mystique evaluation step`);
}

async function importDataStep(context, period) {
  const { site, finalUrl, log } = context;
  const siteId = site.getId();
  const allowOverwrite = false;
  log.info(`[traffic-analysis-import-${period}] Starting import data step for siteId: ${siteId}, url: ${finalUrl}`);

  // First prepare and save the traffic analysis request like we did before
  const analysisResult = await prepareTrafficAnalysisRequest(
    finalUrl,
    context,
    site,
    period,
  );

  log.info(`[traffic-analysis-import-${period}] Prepared audit result for siteId: ${siteId}, sending to import worker with allowOverwrite: ${allowOverwrite}`);

  return {
    auditResult: analysisResult.auditResult,
    fullAuditRef: finalUrl,
    type: 'traffic-analysis',
    siteId,
    allowOverwrite,
  };
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
