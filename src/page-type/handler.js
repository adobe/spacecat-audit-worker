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
import { getWeekInfo } from '@adobe/spacecat-shared-utils';
import { wwwUrlResolver } from '../common/index.js';
import { AuditBuilder } from '../common/audit-builder.js';

function buildMystiqueMessage(site, auditId, baseUrl, auditResult) {
  return {
    type: 'detect:page-types',
    siteId: auditResult.siteId,
    url: baseUrl,
    auditId,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      year: auditResult.year,
      week: auditResult.week,
      month: auditResult.month,
    },
  };
}

/**
 * Prepares page type detection request parameters for weekly analysis
 * @param {string} auditUrl - The URL being audited
 * @param {Object} context - The audit context
 * @param {Object} site - The site object
 * @returns {Object} Audit result and reference
 */
export async function pageTypeDetectionRunner(auditUrl, context, site) {
  const { log } = context;
  const siteId = site.getSiteId();

  log.info(`[page-type-audit] Preparing mystique page-type-detection request parameters for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);

  const {
    week, year, month, temporalCondition,
  } = getWeekInfo();

  const auditResult = {
    year,
    week,
    month,
    siteId,
    temporalCondition,
  };

  log.info(`[page-type-audit] Request parameters: ${JSON.stringify(auditResult)} set for [siteId: ${siteId}] and baseUrl: ${auditUrl}`);

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

  log.info(`[page-type-audit] [siteId: ${siteId}] and [baseUrl:${auditUrl}] with message ${JSON.stringify(mystiqueMessage, 2)} evaluation to mystique`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
  log.info(`[page-type-audit] [siteId: ${siteId}] [baseUrl:${auditUrl}] Completed mystique evaluation step`);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(pageTypeDetectionRunner)
  .withPostProcessors([sendRequestToMystique])
  .build();
