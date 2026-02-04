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
import StoreClient, { StoreEmptyError, URL_TYPES, GUIDELINE_TYPES } from '../utils/store-client.js';

const LOG_PREFIX = '[Wikipedia]';

/**
 * Wikipedia Analysis Audit Handler
 *
 * This audit performs Wikipedia analysis by:
 * 1. Fetching Wikipedia URLs from the URL Store (discovered during brand presence analysis)
 * 2. Fetching analysis topics and guidelines from the Sentiment Config
 * 3. Sending all data to Mystique for analysis
 *
 * Mystique will fetch the actual page content from the Content Store directly
 * (content can exceed SQS message size limits).
 *
 * Results are returned via the guidance handler.
 */

/**
 * Retrieves Wikipedia-related configuration from the site
 * @param {Object} site - The site object
 * @returns {Object} Wikipedia configuration
 */
function getWikipediaConfig(site) {
  const config = site.getConfig();
  const baseURL = site.getBaseURL();

  return {
    companyName: config?.getCompanyName?.() || baseURL,
    companyWebsite: baseURL,
    competitors: config?.getCompetitors?.() || [],
    competitorRegion: config?.getCompetitorRegion?.() || null,
    // Include any additional config that might be useful for analysis
    industry: config?.getIndustry?.() || null,
    brandKeywords: config?.getBrandKeywords?.() || [],
  };
}

/**
 * Fetches all required data from stores for Wikipedia analysis
 * @param {string} siteId - The site ID
 * @param {Object} context - The audit context
 * @returns {Promise<Object>} Object containing urls and sentimentConfig
 * @throws {StoreEmptyError} If any store returns empty results
 */
async function fetchStoreData(siteId, context) {
  const { log } = context;
  const storeClient = StoreClient.createFrom(context);

  log.info(`${LOG_PREFIX} Fetching data from stores for siteId: ${siteId}`);

  // Fetch Wikipedia URLs from URL Store
  // Uses: GET /sites/{siteId}/url-store/by-audit/wikipedia-analysis
  const urls = await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);
  log.info(`${LOG_PREFIX} Retrieved ${urls.length} Wikipedia URLs from URL Store`);

  // Fetch sentiment config (topics + guidelines) filtered by audit type
  // Uses: GET /sites/{siteId}/sentiment/config?audit=wikipedia-analysis
  const auditType = GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS;
  const sentimentConfig = await storeClient.getGuidelines(siteId, auditType);
  const topicCount = sentimentConfig.topics.length;
  const guidelineCount = sentimentConfig.guidelines.length;
  log.info(`${LOG_PREFIX} Retrieved ${topicCount} topics and ${guidelineCount} guidelines`);

  return {
    urls,
    sentimentConfig,
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
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Starting Wikipedia analysis audit for site: ${siteId}`);

  try {
    // Get site configuration
    const wikipediaConfig = getWikipediaConfig(site);

    // Validate that we have a company name
    if (!wikipediaConfig.companyName) {
      log.warn(`${LOG_PREFIX} No company name configured for site, skipping audit`);
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    log.info(`${LOG_PREFIX} Config: companyName=${wikipediaConfig.companyName}, website=${wikipediaConfig.companyWebsite}`);

    // Fetch data from all stores
    const storeData = await fetchStoreData(siteId, context);

    log.info(`${LOG_PREFIX} Successfully fetched all store data for ${wikipediaConfig.companyName}`);

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: wikipediaConfig,
        storeData,
      },
      fullAuditRef: url,
    };
  } catch (error) {
    // Handle store empty errors specifically
    if (error instanceof StoreEmptyError) {
      log.error(`${LOG_PREFIX} Store data missing: ${error.message}`);
      return {
        auditResult: {
          success: false,
          error: error.message,
          storeName: error.storeName,
        },
        fullAuditRef: url,
      };
    }

    log.error(`${LOG_PREFIX} Audit failed: ${error.message}`);
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
    log.info(`${LOG_PREFIX} Audit failed, skipping Mystique message`);
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping message`);
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn(`${LOG_PREFIX} Site not found, skipping Mystique message`);
      return auditData;
    }

    const { config, storeData } = auditResult;
    const { urls, sentimentConfig } = storeData;

    // Build message with all data Mystique needs
    // Note: Content is fetched by Mystique directly from Content Store (avoids SQS size limits)
    const message = {
      type: 'guidance:wikipedia-analysis',
      siteId,
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        // Site configuration
        companyName: config.companyName,
        companyWebsite: config.companyWebsite,
        competitors: config.competitors,
        competitorRegion: config.competitorRegion,
        industry: config.industry,
        brandKeywords: config.brandKeywords,

        // Store data - Mystique will fetch content separately
        urls, // Array of URL objects from URL Store
        topics: sentimentConfig.topics, // Sentiment topics
        guidelines: sentimentConfig.guidelines, // Analysis guidelines filtered by audit type
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`${LOG_PREFIX} Queued Wikipedia analysis request to Mystique for ${config.companyName} with ${urls.length} URLs`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    // Re-throw to fail the audit if we can't send to Mystique
    throw error;
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runWikipediaAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
