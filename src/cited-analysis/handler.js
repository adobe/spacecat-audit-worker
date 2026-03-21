/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { enrichUrlsWithTopicData } from '../utils/url-topic-enrichment.js';

const LOG_PREFIX = '[Cited]';

/**
 * Cited Analysis Audit Handler
 *
 * This audit performs cited URL analysis by:
 * 1. Fetching top-cited URLs from the URL Store (discovered during brand presence analysis)
 * 2. Optionally fetching analysis topics and guidelines from the Sentiment Config
 * 3. Sending all data to Mystique for analysis
 *
 * Mystique will fetch the actual page content from the Content Store directly
 * (content can exceed SQS message size limits).
 *
 * Results are returned via the guidance handler.
 */

function getCitedConfig(site) {
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

async function fetchStoreData(siteId, context) {
  const { log } = context;
  const storeClient = StoreClient.createFrom(context);

  log.info(`${LOG_PREFIX} Fetching data from stores for siteId: ${siteId}`);

  const urls = await storeClient.getUrls(siteId, URL_TYPES.CITED);
  log.info(`${LOG_PREFIX} Retrieved ${urls.length} cited URLs from URL Store`);

  let sentimentConfig = { topics: [], guidelines: [] };
  try {
    sentimentConfig = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.CITED_ANALYSIS);
    log.info(`${LOG_PREFIX} Retrieved ${sentimentConfig.topics.length} topics and ${sentimentConfig.guidelines.length} guidelines`);
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      log.info(`${LOG_PREFIX} No guidelines configured for cited-analysis, proceeding without`);
    } else {
      throw error;
    }
  }

  return {
    urls,
    sentimentConfig,
  };
}

async function runCitedAnalysisAudit(url, context, site) {
  const { log } = context;
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Starting cited analysis audit for site: ${siteId}`);

  try {
    const citedConfig = getCitedConfig(site);

    if (!citedConfig.companyName) {
      log.warn(`${LOG_PREFIX} No company name configured for site, skipping audit`);
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    log.info(`${LOG_PREFIX} Config: companyName=${citedConfig.companyName}, website=${citedConfig.companyWebsite}`);

    const storeData = await fetchStoreData(siteId, context);

    log.info(`${LOG_PREFIX} Successfully fetched all store data for ${citedConfig.companyName}`);

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: citedConfig,
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
    const enrichedUrls = sentimentConfig.topics.length > 0
      ? enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      : urls;

    const message = {
      type: 'guidance:cited-analysis',
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
        urls: enrichedUrls,
        topics: sentimentConfig.topics,
        guidelines: sentimentConfig.guidelines,
      },
    };

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(`${LOG_PREFIX} Queued cited analysis request to Mystique for ${config.companyName} with ${urls.length} URLs`);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    throw error;
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runCitedAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
