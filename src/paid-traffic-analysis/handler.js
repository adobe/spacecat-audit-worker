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
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';
// import { getLastFullWeekInfo, getMonthInfo } from './date-utils.js';

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

const createWeeklyRunner = () => (auditUrl, context, site, auditContext) => prepareTrafficAnalysisRequest(auditUrl, context, site, 'weekly', auditContext);

const createMonthlyRunner = () => (auditUrl, context, site, auditContext) => prepareTrafficAnalysisRequest(auditUrl, context, site, 'monthly', auditContext);

export const paidTrafficAnalysisWeekly = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(createWeeklyRunner())
  .withPostProcessors([sendRequestToMystique])
  .build();

export const paidTrafficAnalysisMonthly = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(createMonthlyRunner())
  .withPostProcessors([sendRequestToMystique])
  .build();
