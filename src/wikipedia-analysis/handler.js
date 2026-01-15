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
import { wwwUrlResolver } from '../common/index.js';

/**
 * Wikipedia Analysis Audit Handler
 *
 * This audit triggers the Wikipedia Analysis workflow in Mystique to:
 * 1. Analyze the company's Wikipedia page
 * 2. Find and analyze competitor Wikipedia pages
 * 3. Generate improvement suggestions
 *
 * The audit sends a message to Mystique which performs the actual analysis
 * and returns results via the guidance handler.
 */

/**
 * Retrieves Wikipedia-related configuration from the site
 * @param {Object} site - The site object
 * @returns {Object} Wikipedia configuration
 */
function getWikipediaConfig(site) {
  const config = site.getConfig();
  const baseURL = site.getBaseURL();

  // Try to get Wikipedia configuration from site config
  // If not configured, use baseURL directly
  return {
    companyName: config?.getCompanyName?.() || baseURL,
    companyWebsite: baseURL,
    wikipediaUrl: config?.getWikipediaUrl?.() || '', // Empty = auto-detect
    competitors: config?.getCompetitors?.() || [], // Empty = auto-detect
    competitorRegion: config?.getCompetitorRegion?.() || null,
  };
}

/**
 * Run Wikipedia Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @returns {Promise<Object>} Audit result
 */
async function runWikipediaAnalysisAudit(url, context, site) {
  const { log } = context;

  log.info(`[Wikipedia] Starting Wikipedia analysis audit for site: ${site.getId()}`);

  try {
    const wikipediaConfig = getWikipediaConfig(site);

    // Validate that we have a company name
    if (!wikipediaConfig.companyName) {
      log.warn('[Wikipedia] No company name configured for site, skipping audit');
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    log.info(`[Wikipedia] Wikipedia config: companyName=${wikipediaConfig.companyName}, website=${wikipediaConfig.companyWebsite}`);

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: wikipediaConfig,
      },
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`[Wikipedia] Audit failed: ${error.message}`);
    return {
      auditResult: {
        success: false,
        error: error.message,
      },
      fullAuditRef: url,
    };
  }
}

/**
 * Post processor to send Wikipedia analysis request to Mystique
 * @param {string} auditUrl - The audit URL
 * @param {Object} auditData - The audit data
 * @param {Object} context - The context object
 * @returns {Promise<Object>} Updated audit data
 */
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  // Skip if audit failed
  if (!auditResult.success) {
    log.info('[Wikipedia] Audit failed, skipping Mystique message');
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('[Wikipedia] SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn('[Wikipedia] Site not found, skipping Mystique message');
      return auditData;
    }

    const { config } = auditResult;

    const message = {
      type: 'guidance:wikipedia-analysis',
      siteId,
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        companyName: config.companyName,
        companyWebsite: config.companyWebsite,
        wikipediaUrl: config.wikipediaUrl,
        competitors: config.competitors,
        competitorRegion: config.competitorRegion,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`[Wikipedia] Queued Wikipedia analysis request to Mystique for ${config.companyName}`);
  } catch (error) {
    log.error(`[Wikipedia] Failed to send Mystique message: ${error.message}`);
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runWikipediaAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
