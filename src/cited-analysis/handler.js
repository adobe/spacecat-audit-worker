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

import DrsClient from '@adobe/spacecat-shared-drs-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { wwwUrlResolver } from '../common/index.js';
import StoreClient, {
  StoreEmptyError, URL_TYPES, GUIDELINE_TYPES,
} from '../utils/store-client.js';
import {
  DrsNoContentAvailableError,
  MYSTIQUE_URLS_LIMIT,
  filterUrlsByDrsStatus,
  resolveMystiqueUrlLimit,
} from '../utils/offsite-audit-utils.js';
import { CITED_ANALYSIS_DRS_CONFIG } from '../offsite-brand-presence/constants.js';
import { computeTopicsFromBrandPresence } from '../utils/offsite-brand-presence-enrichment.js';
import { enrichUrlsWithTopicData } from '../utils/url-topic-enrichment.js';

const LOG_PREFIX = '[Cited]';

/**
 * Cited Analysis Audit Handler
 *
 * This audit performs cited URL analysis by:
 * 1. Fetching top-cited URLs from the URL Store (discovered during brand presence analysis)
 * 2. Computing topics from LLMO brand-presence data (for URL enrichment);
 *    optional guidelines from Sentiment Config
 * 3. Sending config and enriched URLs to Mystique
 *    (topics/guidelines are not on the SQS payload for now)
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

/**
 * Fetches all required data from stores for Cited analysis
 * @param {string} siteId - The site ID
 * @param {Object} context - The audit context
 * @returns {Promise<Object>} Object containing urls and sentimentConfig
 * @throws {StoreEmptyError} If any store returns empty results
 */
async function fetchStoreData(siteId, context, site) {
  const { log } = context;
  const storeClient = StoreClient.createFrom(context);

  log.info(`${LOG_PREFIX} Fetching data from stores for siteId: ${siteId}`);

  const rawUrls = await storeClient.getUrls(siteId, URL_TYPES.CITED, { sortBy: 'createdAt', sortOrder: 'desc' });
  log.info(`${LOG_PREFIX} Retrieved ${rawUrls.length} cited URLs from URL Store`);

  const drsClient = DrsClient.createFrom(context);
  const { datasetIds } = CITED_ANALYSIS_DRS_CONFIG;
  const urls = await filterUrlsByDrsStatus(rawUrls, datasetIds, siteId, drsClient, log, LOG_PREFIX);
  log.info(`${LOG_PREFIX} ${urls.length} cited URLs available in DRS`);

  const topics = await computeTopicsFromBrandPresence(siteId, context, site);
  log.info(`${LOG_PREFIX} Computed ${topics.length} topics from brand presence data`);
  log.debug(`${LOG_PREFIX} Brand-presence topics payload: ${JSON.stringify(topics)}`);

  let guidelines = [];
  try {
    const sentimentConfig = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.CITED_ANALYSIS);
    guidelines = sentimentConfig.guidelines ?? [];
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      log.info(`${LOG_PREFIX} No guidelines configured for cited-analysis, proceeding without`);
    } else {
      throw error;
    }
  }

  log.info(`${LOG_PREFIX} Retrieved ${guidelines.length} guidelines`);

  return {
    urls,
    sentimentConfig: { topics, guidelines },
  };
}

/**
 * Run Cited Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @param {Object} [auditContext] - SQS audit context; optional `messageData` from `message.data`
 *   (e.g. urlLimit from Slack)
 * @returns {Promise<Object>} Audit result
 */
async function runCitedAnalysisAudit(url, context, site, auditContext = {}) {
  const { log } = context;
  const siteId = site.getId();

  log.info(`${LOG_PREFIX} Starting Cited analysis audit for site: ${siteId}`);
  log.info(`${LOG_PREFIX} auditContext: ${JSON.stringify(auditContext)}`);

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

    const storeData = await fetchStoreData(siteId, context, site);
    log.info(`${LOG_PREFIX} Successfully fetched all store data for ${citedConfig.companyName}`);

    const urlLimit = resolveMystiqueUrlLimit(auditContext, log, LOG_PREFIX);

    const { slackContext } = auditContext;

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: { ...citedConfig, urlLimit },
        storeData,
        ...(slackContext && { slackContext }),
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

    if (error instanceof DrsNoContentAvailableError) {
      log.error(`${LOG_PREFIX} No DRS content available yet: ${error.message}`);
      return {
        auditResult: {
          success: false,
          error: error.message,
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
 * Post processor to send Cited analysis request to Mystique
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
    const urlLimit = config?.urlLimit ?? MYSTIQUE_URLS_LIMIT;
    log.info(`${LOG_PREFIX} urlLimit=${urlLimit} (URLs sent to Mystique)`);

    const { urls, sentimentConfig } = storeData;
    const enrichedUrls = enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      .slice(0, urlLimit);

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
      },
    };

    log.debug(`${LOG_PREFIX} Built Mystique message type ${message.type}`);
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    log.info(
      `${LOG_PREFIX} Queued Cited analysis request to Mystique for ${config.companyName} `
        + `with ${enrichedUrls.length} URLs`,
    );
    return auditData;
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runCitedAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
