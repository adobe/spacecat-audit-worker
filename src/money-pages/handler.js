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

/**
 * Send message to Mystique for money page generation
 * @param {Object} context - The execution context containing sqs, audit, etc.
 * @returns {Object} Status object indicating completion
 */
export async function sendToMystiqueForGeneration(context) {
  const {
    log, site, finalUrl, sqs, env, audit,
  } = context;

  try {
    const message = {
      type: 'detect:money-pages',
      siteId: site.getId(),
      auditId: audit.getId(),
      time: new Date().toISOString(),
      data: {
        site_url: finalUrl,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`[${AUDIT_TYPE}] Message sent to Mystique`, message);

    return {
      status: 'complete',
    };
  } catch (error) {
    log.error(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] Failed to send message to Mystique: ${
        error.message
      }`,
    );
    throw error;
  }
}

/**
 * Export the audit handler with all steps configured
 * Uses AuditBuilder to chain the steps together
 */
export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('send-message-to-mystique', sendToMystiqueForGeneration)
  .build();
