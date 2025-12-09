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
import { sendImageOptimizationToAnalyzer, chunkArray, cleanupOutdatedSuggestions } from './opportunityHandler.js';
import { DATA_SOURCES } from '../common/constants.js';
import { ANALYZER_BATCH_SIZE } from './constants.js';

const AUDIT_TYPE = 'image-optimization';
const { AUDIT_STEP_DESTINATIONS } = AuditModel;

/**
 * First step: Prepares the audit for import processing.
 * Returns metadata needed for subsequent steps.
 *
 * @param {Object} context - Context object containing site and finalUrl
 * @returns {Promise<Object>} Audit result with S3 bucket path and metadata
 */
export async function processImportStep(context) {
  const { site, finalUrl } = context;

  const s3BucketPath = `scrapes/${site.getId()}/`;

  return {
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    type: 'top-pages',
    siteId: site.getId(),
  };
}

/**
 * Creates or updates an opportunity for image optimization.
 * Follows DRY principle by extracting opportunity creation logic.
 *
 * @param {Object} params - Parameters object
 * @param {Object} params.Opportunity - Opportunity model
 * @param {string} params.siteId - Site identifier
 * @param {string} params.auditId - Audit identifier
 * @param {number} params.expectedBatches - Number of expected analyzer responses
 * @param {Object} params.log - Logger object
 * @returns {Promise<Object>} Created or updated opportunity
 */
async function findOrCreateOpportunity({
  Opportunity, siteId, auditId, expectedBatches, log,
}) {
  const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
  let imageOptOppty = opportunities.find(
    (oppty) => oppty.getType() === AUDIT_TYPE,
  );

  if (imageOptOppty) {
    log.info(`[${AUDIT_TYPE}]: Updating opportunity for new audit run`);

    // Reset analyzer tracking data while preserving existing metrics
    const existingData = imageOptOppty.getData() || {};
    const resetData = {
      ...existingData,
      analyzerResponsesReceived: 0,
      analyzerResponsesExpected: expectedBatches,
      processedAnalysisIds: [],
    };
    imageOptOppty.setData(resetData);
    await imageOptOppty.save();
    log.debug(`[${AUDIT_TYPE}]: Updated opportunity data for new audit run`);
  } else {
    log.debug(`[${AUDIT_TYPE}]: Creating new opportunity for site ${siteId}`);
    const opportunityDTO = {
      siteId,
      auditId,
      runbook: 'https://adobe.sharepoint.com/:w:/s/aemsites-engineering/EeEUbjd8QcFOqCiwY0w9JL8BLMnpWypZ2iIYLd0lDGtMUw?e=XSmEjh',
      type: AUDIT_TYPE,
      origin: 'AUTOMATION',
      title: 'Images can be optimized using AVIF format for better performance',
      description: 'Converting images to AVIF format can reduce file sizes by up to 50% while maintaining quality, improving page load times and Core Web Vitals',
      guidance: {
        recommendations: [
          {
            insight: 'AVIF format provides superior compression compared to JPEG/PNG/WebP',
            recommendation: 'Enable AVIF format delivery through Adobe Dynamic Media or implement AVIF conversion in your image pipeline',
            type: null,
            rationale: 'Smaller images lead to faster page loads, better Core Web Vitals scores, reduced bandwidth costs, and improved user experience',
          },
        ],
      },
      data: {
        totalImages: 0,
        dynamicMediaImages: 0,
        nonDynamicMediaImages: 0,
        avifImages: 0,
        potentialSavingsBytes: 0,
        potentialSavingsPercent: 0,
        dataSources: [
          DATA_SOURCES.RUM,
          DATA_SOURCES.SITE,
          DATA_SOURCES.AHREFS,
        ],
        analyzerResponsesReceived: 0,
        analyzerResponsesExpected: expectedBatches,
        processedAnalysisIds: [],
      },
      tags: ['performance', 'core-web-vitals', 'images'],
    };

    imageOptOppty = await Opportunity.create(opportunityDTO);
    log.debug(`[${AUDIT_TYPE}]: Created new opportunity with ID ${imageOptOppty.getId()}`);
  }

  return imageOptOppty;
}

/**
 * Main processing step: Analyzes images for optimization opportunities.
 * Orchestrates the image analysis workflow by coordinating with external analyzer.
 *
 * @param {Object} context - Context object with site, audit, dataAccess, log
 * @returns {Promise<void>}
 */
export async function processImageOptimization(context) {
  const {
    log, site, audit, dataAccess,
  } = context;

  log.debug(`[${AUDIT_TYPE}]: Processing image optimization for site ${site.getId()}`);

  try {
    const { Opportunity, SiteTopPage } = dataAccess;
    const siteId = site.getId();

    // Gather page URLs from top pages and site configuration
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
    const includedURLs = await site?.getConfig?.()?.getIncludedURLs('image-optimization') || [];

    // Combine and deduplicate URLs
    const pageUrls = [...new Set([...topPages.map((page) => page.getUrl()), ...includedURLs])];
    if (pageUrls.length === 0) {
      throw new Error(`No top pages found for site ${site.getId()}`);
    }

    const urlBatches = chunkArray(pageUrls, ANALYZER_BATCH_SIZE);

    // Find or create opportunity for tracking results
    const imageOptOppty = await findOrCreateOpportunity({
      Opportunity,
      siteId,
      auditId: audit.getId(),
      expectedBatches: urlBatches.length,
      log,
    });

    // Send URLs to external analyzer for image detection and analysis
    await sendImageOptimizationToAnalyzer(
      site.getBaseURL(),
      pageUrls,
      site.getId(),
      audit.getId(),
      context,
    );

    log.debug(`[${AUDIT_TYPE}]: Sent ${pageUrls.length} pages to analyzer for image optimization analysis`);

    // Clean up stale suggestions from previous runs
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    await cleanupOutdatedSuggestions(imageOptOppty, log);
  } catch (error) {
    log.error(`[${AUDIT_TYPE}]: Failed to process image optimization: ${error.message}`);
    throw error;
  }
}

// Build and export the audit using the fluent builder pattern
export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('processImport', processImportStep, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('processImageOptimization', processImageOptimization)
  .build();

