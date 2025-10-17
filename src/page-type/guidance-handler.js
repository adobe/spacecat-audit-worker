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
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';

const GUIDANCE_TYPE = 'detect:page-types';
const MIN_ACCURACY_THRESHOLD = 85;

function convertPatternsToPageTypes(patterns) {
  return patterns.map((item) => ({
    name: item.label,
    pattern: item.pattern_path,
  }));
}

async function updateSitePageTypes(site, patterns, log) {
  try {
    const existingPageTypes = site.getPageTypes();
    const pageTypes = convertPatternsToPageTypes(patterns);

    if (existingPageTypes && existingPageTypes.length > 0) {
      log.info(`Overriding existing pageTypes configuration (${existingPageTypes.length} patterns) with new patterns (${patterns.length} patterns) for site ${site.getId()}`);
    }

    site.setPageTypes(pageTypes);

    await site.save();
    log.info(`Updated site pageTypes configuration with ${patterns.length} patterns for site ${site.getId()}`);
  } catch (error) {
    log.error(`Failed to update site pageTypes for site ${site.getId()}: ${error.message}`);
    throw error;
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit } = dataAccess;
  const { siteId, auditId, data } = message;

  log.info(`Message received for ${GUIDANCE_TYPE} handler site: ${siteId} message: ${JSON.stringify(message)}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.warn(`No site found for siteId: ${siteId}`);
    return notFound();
  }

  // Extract page types data directly from data
  const pageTypesData = data.patterns ? data : null;

  let auditResult = {
    success: false,
    error: null,
    patternsStored: false,
    newPageTypesAdded: false,
    accuracyThreshold: MIN_ACCURACY_THRESHOLD,
    guidance: pageTypesData,
  };

  if (!pageTypesData) {
    auditResult.error = 'No valid guidance body received';
    log.warn(`No valid guidance body received for site: ${siteId}`);
  } else {
    const {
      patterns, validation, execution_metrics: executionMetrics, accuracy_pct: accuracyPct,
    } = pageTypesData;

    auditResult = {
      ...auditResult,
      success: true,
      patterns: patterns || [],
      patternsCount: patterns?.length || 0,
      accuracy: accuracyPct,
      sampleSize: validation?.sample_size,
      executionMetrics,
    };

    if (!Array.isArray(patterns) || patterns.length === 0) {
      auditResult.error = 'No valid patterns received';
      auditResult.patternsStored = false;
      log.warn(`No valid patterns received for site: ${siteId}`);
    } else {
      // Check accuracy threshold
      const accuracy = validation?.accuracy_pct;
      if (accuracy == null || accuracy < MIN_ACCURACY_THRESHOLD) {
        auditResult.error = `Accuracy ${accuracy}% below threshold ${MIN_ACCURACY_THRESHOLD}%`;
        auditResult.patternsStored = false;
        log.warn(`Page type detection accuracy ${accuracy}% is below threshold ${MIN_ACCURACY_THRESHOLD}% for site: ${siteId}. Skipping pattern storage.`);
      } else {
        try {
          log.info(`Updating site page types for site: ${siteId} with patterns: ${JSON.stringify(patterns)}`);
          const existingPageTypes = site.getPageTypes();
          const hadExistingPageTypes = existingPageTypes && existingPageTypes.length > 0;

          await updateSitePageTypes(site, patterns, log);
          auditResult.patternsStored = true;
          auditResult.newPageTypesAdded = true;

          if (hadExistingPageTypes) {
            auditResult.previousPageTypesCount = existingPageTypes.length;
          }

          log.info(`Successfully stored ${patterns.length} page type patterns for site: ${siteId}`);
        } catch (error) {
          auditResult.error = `Failed to store patterns: ${error.message}`;
          auditResult.patternsStored = false;
          auditResult.newPageTypesAdded = false;
          log.error(`Failed to store page type patterns for site: ${siteId}: ${error.message}`);
        }
      }

      log.info(`Validation results: ${accuracy}% accuracy with ${validation?.sample_size} samples`);
      log.info(`Execution metrics: processed ${executionMetrics?.total_urls} URLs in ${executionMetrics?.total_duration_seconds}s`);
    }
  }

  // Save audit result regardless of success/failure
  if (auditId) {
    try {
      const audit = await Audit.findById(auditId);
      if (audit) {
        audit.setAuditResult(auditResult);
        await audit.save();
        log.info(`Saved audit result for auditId: ${auditId}`);
      } else {
        log.warn(`Audit not found for auditId: ${auditId}`);
      }
    } catch (error) {
      log.error(`Failed to save audit result for auditId: ${auditId}: ${error.message}`);
    }
  }

  return ok();
}
