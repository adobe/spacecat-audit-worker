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

const LOG_PREFIX = '[Reddit]';

/**
 * Reddit Analysis Audit Handler
 *
 * This audit performs Reddit analysis by:
 * 1. Fetching Reddit URLs from the URL Store (discovered during brand presence analysis)
 * 2. Fetching analysis topics and guidelines from the Sentiment Config
 * 3. Sending all data to Mystique for analysis
 *
 * Mystique will fetch the actual page content from the Content Store directly
 * (content can exceed SQS message size limits).
 *
 * Results are returned via the guidance handler.
 */

/**
 * Retrieves Reddit-related configuration from the site
 * @param {Object} site - The site object
 * @returns {Object} Reddit configuration
 */
function getRedditConfig(site) {
  const config = site.getConfig();
  const baseURL = site.getBaseURL();

  return {
    companyName: config?.getCompanyName?.() || baseURL,
    companyWebsite: baseURL,
    competitors: config?.getCompetitors?.() || [],
    competitorRegion: config?.getCompetitorRegion?.() || null,
    industry: config?.getIndustry?.() || null,
    brandKeywords: config?.getBrandKeywords?.() || [],
  };
}

/**
 * Fetches all required data from stores for Reddit analysis
 * @param {string} siteId - The site ID
 * @param {Object} context - The audit context
 * @returns {Promise<Object>} Object containing urls and sentimentConfig
 * @throws {StoreEmptyError} If any store returns empty results
 */
async function fetchStoreData(siteId, context) {
  const { log } = context;
  const storeClient = StoreClient.createFrom(context);

  log.info(`${LOG_PREFIX} Fetching data from stores for siteId: ${siteId}`);

  const urls = await storeClient.getUrls(siteId, URL_TYPES.REDDIT);
  log.info(`${LOG_PREFIX} Retrieved ${urls.length} Reddit URLs from URL Store`);

  const auditType = GUIDELINE_TYPES.REDDIT_ANALYSIS;
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
 * Run Reddit Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @returns {Promise<Object>} Audit result
 */
async function runRedditAnalysisAudit(url, context, site) {
  const { log } = context;
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Starting Reddit analysis audit for site: ${siteId}`);

  try {
    const redditConfig = getRedditConfig(site);

    if (!redditConfig.companyName) {
      log.warn(`${LOG_PREFIX} No company name configured for site, skipping audit`);
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    log.info(`${LOG_PREFIX} Config: companyName=${redditConfig.companyName}, website=${redditConfig.companyWebsite}`);

    const storeData = await fetchStoreData(siteId, context);

    log.info(`${LOG_PREFIX} Successfully fetched all store data for ${redditConfig.companyName}`);

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: redditConfig,
        storeData,
      },
      fullAuditRef: url,
    };
  } catch (error) {
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
 * Post processor to send Reddit analysis request to Mystique
 */
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  if (!auditResult.success) {
    log.info(`${LOG_PREFIX} Audit failed, skipping Mystique message`);
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping message`);
    return auditData;
  }

  try {
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn(`${LOG_PREFIX} Site not found, skipping Mystique message`);
      return auditData;
    }

    const { config, storeData } = auditResult;
    const { urls, sentimentConfig } = storeData;

    const message = {
      type: 'guidance:reddit-analysis',
      siteId,
      url: site.getBaseURL(),
      auditId: audit.getId(),
      deliveryType: site.getDeliveryType(),
      time: new Date().toISOString(),
      data: {
        companyName: config.companyName,
        companyWebsite: config.companyWebsite,
        competitors: config.competitors,
        competitorRegion: config.competitorRegion,
        industry: config.industry,
        brandKeywords: config.brandKeywords,
        urls,
        topics: sentimentConfig.topics,
        guidelines: sentimentConfig.guidelines,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`${LOG_PREFIX} Queued Reddit analysis request to Mystique for ${config.companyName} with ${urls.length} URLs`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    throw error;
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runRedditAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
