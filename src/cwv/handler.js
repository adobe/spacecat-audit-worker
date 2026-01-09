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
import { buildCWVAuditResult } from './cwv-audit-result.js';
import { syncOpportunitiesAndSuggestions } from './opportunity-sync.js';
import { processAutoSuggest } from './auto-suggest.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * Step 1: CWV Data Collection and Code Import
 * Builds CWV audit result and triggers code import
 * @param {Object} context - Context object containing site, finalUrl, log, env
 * @returns {Promise<Object>} Object containing auditResult, fullAuditRef (for persister),
 *                            and import worker parameters (type, siteId, allowCache)
 */
export async function collectCWVDataAndImportCode(context) {
  const { site, log } = context;
  const siteId = site.getId();

  log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 1: Collecting CWV data and triggering code import`);

  const { auditResult, fullAuditRef } = await buildCWVAuditResult(context);

  return {
    // These fields are required for the first step to persist audit result
    auditResult,
    fullAuditRef,
    // Trigger code import
    type: 'code',
    siteId,
    allowCache: false,
  };
}

/**
 * Step 2: Sync Opportunities and Suggestions
 * Creates opportunities and suggestions in SpaceCat and sends auto-suggest messages to Mystique
 * @param {Object} context - Context object containing site, audit, finalUrl, log, dataAccess
 * @returns {Promise<Object>} Status object with 'complete' status
 */
export async function syncOpportunityAndSuggestionsStep(context) {
  const { site, log } = context;
  const siteId = site.getId();

  log.info(`[audit-worker-cwv] siteId: ${siteId} | Step 2: Syncing opportunities and suggestions`);

  const opportunity = await syncOpportunitiesAndSuggestions(context);
  await processAutoSuggest(context, opportunity, site);

  return {
    status: 'complete',
  };
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('collectCWVDataAndImportCode', collectCWVDataAndImportCode, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('syncOpportunityAndSuggestions', syncOpportunityAndSuggestionsStep)
  .build();
