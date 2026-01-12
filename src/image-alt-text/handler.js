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
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

export async function processImportStep(context) {
  const { site, finalUrl, log } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  log.info(`[${AUDIT_TYPE}]: Starting import step for siteId: ${site.getId()}, finalUrl: ${finalUrl}`);
  log.debug(`[${AUDIT_TYPE}]: S3 bucket path: ${s3BucketPath}`);

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

export async function processAltTextWithMystique(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  const siteId = site.getId();
  const auditId = audit.getId();

  log.info(`[${AUDIT_TYPE}]: Processing alt-text with Mystique for siteId: ${siteId}, auditId: ${auditId}`);

  try {
    const { Opportunity } = dataAccess;

    // Get top pages and included URLs
    const { SiteTopPage } = dataAccess;
    log.debug(`[${AUDIT_TYPE}]: Fetching top pages for siteId: ${siteId} from ahrefs/global`);
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    log.info(`[${AUDIT_TYPE}]: Found ${topPages.length} top pages from ahrefs for siteId: ${siteId}`);

    const includedURLs = await site?.getConfig?.()?.getIncludedURLs('alt-text') || [];
    log.info(`[${AUDIT_TYPE}]: Found ${includedURLs.length} included URLs from config for siteId: ${siteId}`);

    // Get ALL page URLs to send to Mystique
    const pageUrls = [...new Set([...topPages.map((page) => page.getUrl()), ...includedURLs])];
    if (pageUrls.length === 0) {
      log.error(`[${AUDIT_TYPE}]: No top pages found for siteId: ${siteId}`);
      throw new Error(`No top pages found for site ${site.getId()}`);
    }

    log.info(`[${AUDIT_TYPE}]: Total unique page URLs to process: ${pageUrls.length} for siteId: ${siteId}`);

    const urlBatches = chunkArray(pageUrls, MYSTIQUE_BATCH_SIZE);
    log.info(`[${AUDIT_TYPE}]: Created ${urlBatches.length} batches (batch size: ${MYSTIQUE_BATCH_SIZE}) for siteId: ${siteId}`);

    // First, find or create the opportunity and clear existing suggestions
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    let altTextOppty = opportunities.find(
      (oppty) => oppty.getType() === AUDIT_TYPE,
    );

    if (altTextOppty) {
      log.info(`[${AUDIT_TYPE}]: Found existing opportunity ${altTextOppty.getId()} for siteId: ${siteId}, updating for new audit run`);

      // Reset only Mystique-related data, keep existing metrics
      const existingData = altTextOppty.getData() || {};
      log.debug(`[${AUDIT_TYPE}]: Existing opportunity data - mystiqueResponsesReceived: ${existingData.mystiqueResponsesReceived || 0}, processedSuggestions: ${existingData.processedSuggestionIds?.length || 0}`);

      const resetData = {
        ...existingData,
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: urlBatches.length,
        processedSuggestionIds: [],
      };
      altTextOppty.setData(resetData);
      await altTextOppty.save();
      log.info(`[${AUDIT_TYPE}]: Updated opportunity ${altTextOppty.getId()} - reset mystiqueResponsesReceived to 0, set mystiqueResponsesExpected to ${urlBatches.length}`);
    } else {
      log.info(`[${AUDIT_TYPE}]: No existing opportunity found, creating new opportunity for siteId: ${siteId}`);
      const opportunityDTO = {
        siteId,
        auditId: audit.getId(),
        runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
        type: AUDIT_TYPE,
        origin: 'AUTOMATION',
        title: 'Make images on your site accessible (and boost SEO) — alt-text suggestions have been prepared',
        description: 'Descriptive alt-text improves accessibility and allows search engines to better understand image content.',
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
      log.info(`[${AUDIT_TYPE}]: Created new opportunity ${altTextOppty.getId()} for siteId: ${siteId} with mystiqueResponsesExpected: ${urlBatches.length}`);
    }

    await sendAltTextOpportunityToMystique(
      site.getBaseURL(),
      pageUrls,
      site.getId(),
      audit.getId(),
      context,
    );

    log.info(`[${AUDIT_TYPE}]: Successfully sent ${pageUrls.length} pages in ${urlBatches.length} batches to Mystique for siteId: ${siteId}`);

    // Clean up outdated suggestions
    // Small delay to ensure no concurrent operations
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    log.debug(`[${AUDIT_TYPE}]: Starting cleanup of outdated suggestions for opportunityId: ${altTextOppty.getId()}`);
    await cleanupOutdatedSuggestions(altTextOppty, log);
    log.info(`[${AUDIT_TYPE}]: Completed alt-text processing with Mystique for siteId: ${siteId}`);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to process with Mystique for siteId: ${site.getId()}: ${error.message}`, { error: error.stack });
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('processAltTextWithMystique', processAltTextWithMystique)
  .build();
