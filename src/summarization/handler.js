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

import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

export async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, audit, dataAccess,
  } = context;
  const { siteId, auditResult } = auditData;

  // Skip if audit failed
  if (!auditResult.success) {
    log.info('Audit failed, skipping Mystique message');
    return auditData;
  }

  // Get site for additional data
  const { Site } = dataAccess;
  const site = await Site.findById(siteId);
  if (!site) {
    log.warn('Site not found, skipping Mystique message');
    return auditData;
  }

  const { topPages } = auditResult;
  if (topPages.length === 0) {
    log.info('No top pages found, skipping Mystique message');
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  const topPagesPayload = topPages.slice(0, 100).map((page) => ({ page_url: page, keyword: '', questions: [] }));

  const message = {
    type: 'guidance:summarization',
    siteId,
    url: site.getBaseURL(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: { pages: topPagesPayload },
  };
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info('SUMMARIZATION: %s Message sent to Mystique for site id %s:', 'summarization', siteId, message);

  return auditData;
}

export async function summarizationAudit(url, context, site) {
  const { dataAccess, log } = context;
  const { SiteTopPage } = dataAccess;
  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
  let success = true;
  if (topPages.length === 0) {
    log.warn('No top pages found for site');
    success = false;
  }

  return {
    auditResult: {
      topPages: topPages.map((page) => page.getUrl()),
      success,
    },
    fullAuditRef: url,
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(summarizationAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
