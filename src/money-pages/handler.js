/*
 * Copyright 2024 Adobe. All rights reserved.
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

const AUDIT_TYPE = 'money-pages';

export function collectAuditData(auditUrl, context, site) {
  const { log } = context;

  log.info(`[${AUDIT_TYPE}] [Site: ${site.getId()}] Collecting audit data`);

  return {
    auditResult: { siteUrl: auditUrl },
    fullAuditRef: auditUrl,
  };
}

export async function sendToMystiqueForGeneration(finalUrl, auditData, context, site) {
  const {
    log, sqs, env, audit,
  } = context;
  const siteId = site.getId();

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`[${AUDIT_TYPE}] [Site: ${siteId}] SQS or Mystique queue not configured, skipping`);
    return;
  }

  const message = {
    type: AUDIT_TYPE,
    siteId,
    auditId: audit.getId(),
    time: new Date().toISOString(),
    data: {
      site_url: finalUrl,
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`[${AUDIT_TYPE}] Message sent to Mystique`, message);
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(collectAuditData)
  .withPostProcessors([sendToMystiqueForGeneration])
  .build();
