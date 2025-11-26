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
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import { sendAltTextOpportunityToMystique, chunkArray, cleanupOutdatedSuggestions } from './opportunityHandler.js';
import { DATA_SOURCES } from '../common/constants.js';
import { MYSTIQUE_BATCH_SIZE } from './constants.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

// Persist using an already-created audit if present, otherwise fall back
export async function persistUsingExistingAudit(auditData, context) {
  const { audit, dataAccess } = context;
  if (audit?.getId) {
    return audit;
  }
  const { Audit } = dataAccess;
  return Audit.create(auditData);
}

export async function processAltTextWithMystique(context) {
  const {
    log, site, audit, dataAccess, env,
  } = context;

  log.info(`[${AUDIT_TYPE}]: Processing alt-text with Mystique for siteId ${site.getId()} using custom sqs queue ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`);
  log.debug(`[${AUDIT_TYPE}]: Processing alt-text with Mystique for site ${site.getId()}`);

  try {
    const { Opportunity } = dataAccess;
    const siteId = site.getId();
    // Ensure an Audit exists in a single-step flow
    let workingAudit = audit;
    if (!workingAudit) {
      const { Audit } = dataAccess;
      const auditData = {
        siteId,
        isLive: site.getIsLive(),
        auditedAt: new Date().toISOString(),
        auditType: AUDIT_TYPE,
        auditResult: { status: 'preparing' },
        fullAuditRef: '',
        invocationId: context.invocation?.id,
      };
      workingAudit = await Audit.create(auditData);
      context.audit = workingAudit;
      log.debug(`[${AUDIT_TYPE}]: Created audit ${workingAudit.getId()} for single-step flow`);
    }

    // Get top pages and included URLs
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    const includedURLs = await site?.getConfig?.()?.getIncludedURLs('alt-text') || [];

    // Get ALL page URLs to send to Mystique
    const pageUrls = [...new Set([...topPages.map((page) => page.getUrl()), ...includedURLs])];
    if (pageUrls.length === 0) {
      throw new Error(`No top pages found for site ${site.getId()}`);
    }

    const urlBatches = chunkArray(pageUrls, MYSTIQUE_BATCH_SIZE);

    // First, find or create the opportunity and clear existing suggestions
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );

    if (altTextOppty) {
      log.info(`[${AUDIT_TYPE}]: Updating opportunity for new audit run`);

      // Reset only Mystique-related data, keep existing metrics
      const existingData = altTextOppty.getData() || {};
      const resetData = {
        ...existingData,
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: urlBatches.length,
        processedSuggestionIds: [],
      };
      altTextOppty.setData(resetData);
      await altTextOppty.save();
      log.debug(`[${AUDIT_TYPE}]: Updated opportunity data for new audit run`);
    } else {
      log.debug(`[${AUDIT_TYPE}]: Creating new opportunity for site ${siteId}`);
      const opportunityDTO = {
        siteId,
        auditId: workingAudit.getId(),
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: AUDIT_TYPE,
        origin: 'AUTOMATION',
        title: 'Missing alt text for images decreases accessibility and discoverability of content',
        description: 'Missing alt text on images leads to poor seo scores, low accessibility scores and search engine failing to surface such images with keyword search',
        guidance: {
          recommendations: [
            {
              insight: 'Alt text for images decreases accessibility and limits discoverability',
              recommendation: 'Add meaningful alt text on images that clearly articulate the subject matter of the image',
              type: null,
              rationale: 'Alt text for images is vital to ensure your content is discoverable and usable for many people as possible',
            },
          ],
        },
        data: {
          projectedTrafficLost: 0,
          projectedTrafficValue: 0,
          decorativeImagesCount: 0,
          dataSources: [
            DATA_SOURCES.RUM,
            DATA_SOURCES.SITE,
            DATA_SOURCES.AHREFS,
          ],
          mystiqueResponsesReceived: 0,
          mystiqueResponsesExpected: urlBatches.length,
          processedSuggestionIds: [],
        },
        tags: ['seo', 'accessibility'],
      };

      altTextOppty = await Opportunity.create(opportunityDTO);
      log.debug(`[${AUDIT_TYPE}]: Created new opportunity with ID ${altTextOppty.getId()}`);
    }

    await sendAltTextOpportunityToMystique(
      site.getBaseURL(),
      pageUrls,
      site.getId(),
      workingAudit.getId(),
      context,
    );

    log.debug(`[${AUDIT_TYPE}]: Sent ${pageUrls.length} pages to Mystique for generating alt-text suggestions`);

    // Clean up outdated suggestions
    // Small delay to ensure no concurrent operations
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    await cleanupOutdatedSuggestions(altTextOppty, log);
    return {
      auditResult: { status: 'submitted', pagesSent: pageUrls.length },
      fullAuditRef: '',
    };
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to process with Mystique: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  // Prevent duplicate audit records in single-step flow by reusing the created audit
  .withPersister(persistUsingExistingAudit)
  .addStep('processAltTextWithMystique', processAltTextWithMystique)
  .build();
