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

const GUIDANCE_TYPE = 'page-type';
const MIN_ACCURACY_THRESHOLD = 75;

function convertPatternsToPageTypes(patterns) {
  return patterns.map((item) => ({
    name: item.pagetype,
    pattern: item.regex,
  }));
}

async function updateSitePageTypes(site, patterns, log) {
  try {
    const existingPageTypes = site.getPageTypes();
    const pageTypes = convertPatternsToPageTypes(patterns);

    if (existingPageTypes && existingPageTypes.length > 0) {
      log.info(`[${GUIDANCE_TYPE}] Overriding existing pageTypes configuration (${existingPageTypes.length} patterns) with new patterns (${patterns.length} patterns) for site: ${site.getId()}`);
    }

    site.setPageTypes(pageTypes);

    await site.save();
    log.debug(`[${GUIDANCE_TYPE}] Updated site pageTypes configuration with ${patterns.length} patterns for site: ${site.getId()}`);
  } catch (error) {
    log.error(`[${GUIDANCE_TYPE}] Failed to update site pageTypes for site: ${site.getId()}: ${error.message}`);
    throw error;
  }
}

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Site, Audit } = dataAccess;
  const { siteId, auditId, data } = message;

  log.debug(`[${GUIDANCE_TYPE}] Message received for site: ${siteId}, audit: ${auditId}`);

  const site = await Site.findById(siteId);
  if (!site) {
    log.warn(`[${GUIDANCE_TYPE}] Failed: no site found for site: ${siteId}, audit: ${auditId}`);
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
    log.warn(`[${GUIDANCE_TYPE}] Skipping: no valid guidance body for site: ${siteId}, audit: ${auditId}`);
  } else {
    const {
      patterns, validation, execution_metrics: executionMetrics, accuracy_pct: accuracyPct,
    } = pageTypesData;

    auditResult = {
      ...auditResult,
      success: true,
      patterns,
      patternsCount: patterns?.length || 0,
      accuracy: accuracyPct,
      sampleSize: validation?.sample_size,
      executionMetrics,
    };

    if (!Array.isArray(patterns) || patterns.length === 0) {
      auditResult.error = 'No valid patterns received';
      auditResult.patternsStored = false;
      log.warn(`[${GUIDANCE_TYPE}] Skipping: no valid patterns for site: ${siteId}, audit: ${auditId}`);
    } else {
      // Check accuracy threshold
      if (accuracyPct == null || accuracyPct < MIN_ACCURACY_THRESHOLD) {
        auditResult.error = `Accuracy ${accuracyPct}% below threshold ${MIN_ACCURACY_THRESHOLD}%`;
        auditResult.patternsStored = false;
        log.info(`[${GUIDANCE_TYPE}] Skipping: accuracy ${accuracyPct}% below threshold ${MIN_ACCURACY_THRESHOLD}% for site: ${siteId}, audit: ${auditId}`);
      } else {
        try {
          log.debug(`[${GUIDANCE_TYPE}] Updating patterns for site: ${siteId}, audit: ${auditId}, patterns: ${JSON.stringify(patterns)}`);
          const existingPageTypes = site.getPageTypes();
          const hadExistingPageTypes = existingPageTypes && existingPageTypes.length > 0;

          await updateSitePageTypes(site, patterns, log);
          auditResult.patternsStored = true;
          auditResult.newPageTypesAdded = true;

          if (hadExistingPageTypes) {
            auditResult.previousPageTypesCount = existingPageTypes.length;
          }

          log.info(`[${GUIDANCE_TYPE}] Created: stored ${patterns.length} patterns for site: ${siteId}, audit: ${auditId}`);
        } catch (error) {
          auditResult.error = `Failed to store patterns: ${error.message}`;
          auditResult.patternsStored = false;
          auditResult.newPageTypesAdded = false;
          log.error(`[${GUIDANCE_TYPE}] Failed: could not store patterns for site: ${siteId}, audit: ${auditId}: ${error.message}`);
        }
      }

      log.debug(`[${GUIDANCE_TYPE}] Validation: ${accuracyPct}% accuracy with ${validation?.sample_size} samples`);
      log.debug(`[${GUIDANCE_TYPE}] Execution: processed ${executionMetrics?.total_urls} URLs in ${executionMetrics?.total_duration_seconds}s`);
    }
  }

  // Save audit result regardless of success/failure
  if (auditId) {
    try {
      const audit = await Audit.findById(auditId);
      if (audit) {
        audit.setAuditResult(auditResult);
        await audit.save();
        log.debug(`[${GUIDANCE_TYPE}] Saved audit result for site: ${siteId}, audit: ${auditId}`);
      } else {
        log.warn(`[${GUIDANCE_TYPE}] Failed: audit not found for site: ${siteId}, audit: ${auditId}`);
      }
    } catch (error) {
      log.error(`[${GUIDANCE_TYPE}] Failed: could not save audit result for site: ${siteId}, audit: ${auditId}: ${error.message}`);
    }
  }

  return ok();
}
