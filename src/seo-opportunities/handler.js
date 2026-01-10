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
import { validateUrls } from '../seo-indexability-check/validators.js';

/**
 * Sends validation results back to Mystique
 *
 * @param {string} siteId - Site ID
 * @param {string} auditId - Audit ID (optional)
 * @param {string} requestId - Request ID for correlation
 * @param {Array} cleanUrls - URLs that passed validation
 * @param {Array} blockedUrls - URLs that failed validation (for info/tracking)
 * @param {Object} context - Audit context containing sqs, env, log
 * @returns {Promise<void>}
 */
async function sendResultsToMystique(siteId, auditId, requestId, cleanUrls, blockedUrls, context) {
  const { sqs, env, log } = context;

  const message = {
    type: 'detect:seo-indexability',
    siteId,
    auditId,
    requestId,
    time: new Date().toISOString(),
    data: {
      cleanUrls: cleanUrls.map((u) => ({
        url: u.url,
        primaryKeyword: u.primaryKeyword,
        position: u.position,
        trafficValue: u.trafficValue,
        intent: u.intent,
        checks: u.checks,
      })),
      blockedUrls: blockedUrls.map((u) => ({
        url: u.url,
        primaryKeyword: u.primaryKeyword,
        position: u.position,
        trafficValue: u.trafficValue,
        intent: u.intent,
        blockers: u.blockers,
        checks: u.checks,
      })),
    },
  };

  await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
  log.info(`Sent ${cleanUrls.length} clean and ${blockedUrls.length} blocked URLs to Mystique`);
}

/**
 * SEO Opportunities Audit - validates URLs for indexability before H1/meta optimization
 *
 * @param {Object} context - Audit context
 * @param {Object} context.data - Audit data containing URLs from Mystique
 * @param {Array} context.data.urls - URLs to validate with keyword metadata
 * @param {Object} context.site - Site object
 * @param {Object} context.log - Logger instance
 * @param {Object} context.sqs - SQS client
 * @param {Object} context.env - Environment variables
 * @returns {Promise<Object>} Audit result with validation summary
 */
export async function validateSeoOpportunitiesStep(context) {
  const {
    log, site, data,
  } = context;

  // Extract URLs from audit context data (sent by Mystique)
  const { urls = [] } = data || {};

  if (!urls || urls.length === 0) {
    log.warn(`No URLs provided for SEO opportunities validation for siteId=${site.getId()}`);
    return {
      auditResult: {
        success: false,
        message: 'No URLs provided for validation',
        totalUrls: 0,
        cleanUrls: 0,
        blockedUrls: 0,
      },
      fullAuditRef: site.getBaseURL(),
    };
  }

  log.info(`Starting SEO opportunities validation: ${urls.length} URLs for siteId=${site.getId()}`);

  // Validate all URLs (reuses existing indexability validation logic)
  const validationResults = await validateUrls(urls, context);

  const cleanUrls = validationResults.filter((r) => r.indexable);
  const blockedUrls = validationResults.filter((r) => !r.indexable);

  log.info(`Validation complete for ${site.getBaseURL()}: ${cleanUrls.length} clean, ${blockedUrls.length} blocked`);

  // Blocker summary (for logging)
  const blockerSummary = blockedUrls.length > 0 ? blockedUrls.reduce((acc, url) => {
    url.blockers.forEach((blocker) => {
      acc[blocker] = (acc[blocker] || 0) + 1;
    });
    return acc;
  }, {}) : {};

  if (blockedUrls.length > 0) {
    log.info(`Blocker summary: ${JSON.stringify(blockerSummary)}`);
  }

  // Send both clean and blocked URLs to Mystique
  await sendResultsToMystique(
    site.getId(),
    context.audit?.getId?.(),
    data.requestId,
    cleanUrls,
    blockedUrls,
    context,
  );

  return {
    auditResult: {
      success: true,
      totalUrls: urls.length,
      cleanUrls: cleanUrls.length,
      blockedUrls: blockedUrls.length,
      blockerSummary,
      timestamp: new Date().toISOString(),
    },
    fullAuditRef: site.getBaseURL(),
  };
}

/**
 * Export audit using AuditBuilder pattern
 */
export default new AuditBuilder()
  .addStep('validateSeoOpportunities', validateSeoOpportunitiesStep)
  .build();
