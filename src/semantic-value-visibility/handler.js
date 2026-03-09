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
import { noopUrlResolver } from '../common/index.js';
import { GUIDANCE_TYPE } from './constants.js';

/**
 * Audit runner for semantic value visibility.
 *
 * Sends a request to Mystique via SQS to analyze marketing images on the site.
 * Mystique runs the image pipeline (Playwright → OCR → Vision LLM → Agent)
 * and sends the results back to the guidance handler.
 */
export async function auditRunner(auditUrl, context, site) {
  const {
    log, sqs, env,
  } = context;
  const siteId = site.getId();

  log.info(`[semantic-value-visibility] Starting audit for siteId: ${siteId}, url: ${auditUrl}`);

  const message = {
    type: GUIDANCE_TYPE,
    siteId,
    url: auditUrl,
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
  };

  log.info(`[semantic-value-visibility] Sending request to Mystique for siteId: ${siteId}`);
  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`[semantic-value-visibility] Request sent to Mystique for siteId: ${siteId}`);

  return {
    auditResult: { siteId, url: auditUrl, status: 'sent-to-mystique' },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withUrlResolver(noopUrlResolver)
  .withRunner(auditRunner)
  .build();
