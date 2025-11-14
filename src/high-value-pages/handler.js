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
 * Retrieves existing high value pages from the URL store (to be implemented)
 * @param {Object} context - The execution context containing site, log, and finalUrl
 * @returns {Object} Audit result with existing high value pages
 */
export async function runAuditAndImportTopPagesStep(context) {
  const { site, log, finalUrl } = context;

  log.debug(`[${AUDIT_TYPE}] [Site: ${site.getId()}] starting audit`);

  /**
   * TODO: Implement getting existing high value pages from URL store when URL store API is ready
   * Format of the HighValuePage should be: {
    "url": "https://www.example.com/services/engineering/iot",
    "reasoning": "This is a service detail page for IoT engineering, relevant to the...",
    "rank": "3:96" // 3 is the rank of the page, 96 is the score of the page
  }
   */
  const existingHighValuePages = [];

  return {
    auditResult: {
      existingHighValuePages,
    },
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
export const sendToMystiqueForGeneration = async (context) => {
  const {
    log, site, finalUrl, sqs, env, dataAccess, audit,
  } = context;
  const { SiteTopPage } = dataAccess;

  const { existingHighValuePages } = audit.getAuditResult();

  // Fetch all top pages for the site
  const topPages = await SiteTopPage.allBySiteId(site.getId());

  // Filter out existing high value pages and map to required format
  const topPagesWithoutExistingHighValuePages = topPages
    .filter((topPage) => !existingHighValuePages.some((hvp) => hvp.url === topPage.getUrl()))
    .map((topPage) => ({
      url: topPage.getUrl(),
      traffic: topPage.getTraffic(),
      topKeyword: topPage.getTopKeyword(),
    }));

  // Prepare message for Mystique queue
  const message = {
    type: 'guidance:high-value-pages',
    siteId: site.getId(),
    auditId: audit.getId(),
    deliveryType: site.getDeliveryType(),
    time: new Date().toISOString(),
    data: {
      finalUrl,
      highValuePages: existingHighValuePages,
      topPages: topPagesWithoutExistingHighValuePages,
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`Message sent to Mystique: ${JSON.stringify(message)}`);

  return {
    status: 'complete',
  };
};

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
