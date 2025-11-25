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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_TYPE = Audit.AUDIT_TYPES.HIGH_VALUE_PAGES || 'high-value-pages';

/**
 * Step 1: Run the audit and import top pages data
 * Currently this step only seeds baseline metadata for later steps because
 * there is no pre-existing high-value page state to fetch anymore.
 * @param {Object} context - The execution context containing site, log, and finalUrl
 * @returns {Object} Audit result placeholder
 */
export async function runAuditAndImportTopPagesStep(context) {
  const { site, log, finalUrl } = context;

  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] starting audit`);

  return {
    auditResult: {},
    fullAuditRef: finalUrl,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Step 2: Send message to Mystique for high value page generation
 * Filters out existing high value pages from top pages and sends to Mystique queue
 * @param {Object} context - The execution context containing dataAccess, sqs, audit, etc.
 * @returns {Object} Status object indicating completion
 */
export async function sendToMystiqueForGeneration(context) {
  const {
    log, site, finalUrl, sqs, env, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;
  let topPagesPayload = [];
  try {
    // Fetch all top pages for the site
    const topPages = await SiteTopPage.allBySiteId(site.getId());
    // Forward every top page because we no longer exclude existing high-value pages upstream.
    topPagesPayload = topPages.map((topPage) => ({
      url: topPage.getUrl(),
      traffic: topPage.getTraffic(),
      topKeyword: topPage.getTopKeyword(),
    }));
  } catch (error) {
    log.error(
      `[${AUDIT_TYPE}] [Site: ${site.getId()}] Error occurred: ${error.message}`,
    );
    throw new Error(`Error occurred: ${error.message}`);
  }

  try {
    // Prepare message for Mystique queue
    const message = {
      type: 'detect:high-value-pages',
      siteId: site.getId(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        site_url: finalUrl,
        top_pages: topPagesPayload,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`[${AUDIT_TYPE}] Message sent to Mystique`, {
      ...message,
      data: {
        ...message.data,
        top_pages: `total top pages: ${topPagesPayload.length}`,
      },
    });

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
  .addStep(
    'runAuditAndImportTopPages',
    runAuditAndImportTopPagesStep,
    AUDIT_STEP_DESTINATIONS.IMPORT_WORKER,
  )
  .addStep('send-message-to-mystique', sendToMystiqueForGeneration)
  .build();
