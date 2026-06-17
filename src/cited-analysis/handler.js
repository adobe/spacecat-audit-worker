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
  filterUrlsByDrsStatus,
  resolveMystiqueUrlLimit,
  requestOffsiteScrape,
} from '../utils/offsite-audit-utils.js';
import { CITED_ANALYSIS_DRS_CONFIG } from '../offsite-brand-presence/constants.js';
import { computeTopicsFromBrandPresence } from '../utils/offsite-brand-presence-enrichment.js';
import { enrichUrlsWithTopicData } from '../utils/url-topic-enrichment.js';
import { resolveBrandForSite, applyBrandScope } from '../utils/brand-resolver.js';
import { postMessageOptional } from '../utils/slack-utils.js';

const LOG_PREFIX = '[Cited]';

// SQS standard-queue maximum payload is 256 KB (262144 bytes). Stay under a
// safety budget so worst-case serialisation doesn't hit the hard reject.
const SQS_MAX_SAFE_BYTES = 200 * 1024;

// Cited-analysis-specific URL cap. Lower than the global MYSTIQUE_URLS_LIMIT
// (50) because: (a) each URL requires a full DRS scrape — 50 URLs can take
// 30-40 min; (b) 40 URLs with full prompts fits within the SQS budget after
// field projection, removing the need for a per-URL prompts cap.
const CITED_ANALYSIS_URLS_LIMIT = 40;

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
 * Extracts the apex hostname from a URL or bare host string, stripping the
 * leading ``www.`` so apex-to-apex comparison works regardless of how the
 * brand domain is configured (``bmw.com`` vs ``https://www.bmw.com/``).
 *
 * Returns an empty string for unparseable input — the caller then treats the
 * ownership check as a no-op rather than dropping URLs based on garbage.
 * @param {string} value
 * @returns {string}
 */
function toApexHost(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Filters out cited URLs that live on the customer's own domain.
 *
 * Cited URLs are meant to represent 3rd-party EARNED citations. A page on
 * ``bmw.com`` for the BMW customer is self-owned content; counting it as an
 * earned citation skews offsite brand-perception reporting. We drop these
 * here — before the expensive DRS lookup and before shipping the SQS payload
 * to Mystique. The mystique flow re-applies the same filter for defense in
 * depth.
 *
 * Ownership is matched on dotted suffix boundaries: ``bmw.com`` matches
 * ``bmw.com``, ``www.bmw.com``, and ``m.bmw.com``, but NOT ``not-bmw.com``
 * or ``bmw.com.attacker.example``.
 * @param {Array<{url: string}>} urls
 * @param {string} brandBaseURL
 * @returns {{ kept: Array<{url: string}>, droppedCount: number }}
 */
function partitionOwnedUrls(urls, brandBaseURL) {
  const ownedHost = toApexHost(brandBaseURL);
  if (!ownedHost) {
    return { kept: urls, droppedCount: 0 };
  }
  const kept = [];
  let droppedCount = 0;
  for (const entry of urls) {
    const host = toApexHost(entry.url);
    const isOwned = host && (host === ownedHost || host.endsWith(`.${ownedHost}`));
    if (isOwned) {
      droppedCount += 1;
    } else {
      kept.push(entry);
    }
  }
  return { kept, droppedCount };
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

  // Drop URLs on the customer's own domain. Cited URLs represent 3rd-party
  // EARNED citations — pages on ``bmw.com`` for the BMW customer would
  // skew earned-media reporting. The mystique flow re-applies the same
  // filter for defense in depth.
  const { kept: earnedUrls, droppedCount: ownedDroppedCount } = partitionOwnedUrls(
    rawUrls,
    site?.getBaseURL?.(),
  );
  if (ownedDroppedCount > 0) {
    log.info(
      `${LOG_PREFIX} Excluded ${ownedDroppedCount} owned-domain URLs `
      + '(cited analysis is 3rd-party earned only)',
    );
  }

  const drsClient = DrsClient.createFrom(context);
  const { datasetIds } = CITED_ANALYSIS_DRS_CONFIG;
  const urls = await filterUrlsByDrsStatus(
    earnedUrls,
    datasetIds,
    siteId,
    drsClient,
    log,
    LOG_PREFIX,
  );
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

    log.info(`${LOG_PREFIX} Config: companyName=${citedConfig.companyName}, website=${citedConfig.companyWebsite}, competitors=${citedConfig.competitors.length}`);
    if (citedConfig.competitors.length === 0) {
      // Surfaces the misconfiguration before the SQS hop to Mystique. With an
      // empty list Mystique will only count the primary brand in Share of Voice
      // (no hardcoded fallback) — see LLMO-4909 / cited_sentiment_flow.py.
      log.warn(`${LOG_PREFIX} No competitors configured for site ${siteId}; Share of Voice will only include the primary brand`);
    }

    const storeData = await fetchStoreData(siteId, context, site);
    log.info(`${LOG_PREFIX} Successfully fetched all store data for ${citedConfig.companyName}`);

    const urlLimit = Math.min(
      resolveMystiqueUrlLimit(auditContext, log, LOG_PREFIX),
      CITED_ANALYSIS_URLS_LIMIT,
    );

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
      if (auditContext.drsScrapeRequested) {
        log.error(`${LOG_PREFIX} No DRS content available after scraping: ${error.message}`);
        return {
          auditResult: { success: false, error: error.message },
          fullAuditRef: url,
        };
      }
      log.info(`${LOG_PREFIX} No DRS content yet, requesting a scrape for top-cited`);
      await requestOffsiteScrape(context, siteId, 'top-cited', auditContext.slackContext);
      return {
        auditResult: { success: false, status: 'pending_scrape', error: error.message },
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
    const urlLimit = config?.urlLimit ?? CITED_ANALYSIS_URLS_LIMIT;
    log.info(`${LOG_PREFIX} urlLimit=${urlLimit} (URLs sent to Mystique)`);

    const { urls, sentimentConfig } = storeData;
    // Project only the fields Mystique reads (url, categories, prompts,
    // timesCited). URL Store metadata (siteId, byCustomer, audits, timestamps)
    // is not needed downstream and contributes significant per-URL bloat.
    // Full prompts are kept — CITED_ANALYSIS_URLS_LIMIT=40 keeps the payload
    // within the SQS budget without capping per-URL prompts.
    const enrichedUrls = enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      .slice(0, urlLimit)
      .map(({
        url: urlStr, categories, timesCited, prompts,
      }) => ({
        url: urlStr,
        ...(categories?.length > 0 && { categories }),
        ...(timesCited > 0 && { timesCited }),
        ...(prompts?.length > 0 && { prompts }),
      }));

    const baseMessage = {
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

    let brand = null;
    try {
      brand = await resolveBrandForSite(context, site);
    } catch (brandError) {
      log.warn(`${LOG_PREFIX} Brand resolution failed unexpectedly; proceeding without scope: ${brandError.message}`);
    }
    const message = applyBrandScope(baseMessage, brand);

    // Safety guard: if the serialised message still exceeds the budget after
    // per-URL projection and prompt capping, drop URLs from the tail until
    // it fits rather than letting SQS reject the send entirely.
    let sentUrlCount = message.data.urls.length;
    while (sentUrlCount > 1) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (bytes <= SQS_MAX_SAFE_BYTES) {
        break;
      }
      sentUrlCount -= 1;
      message.data.urls = enrichedUrls.slice(0, sentUrlCount);
      log.warn(
        `${LOG_PREFIX} Message size ${bytes} bytes exceeds budget; reducing to ${sentUrlCount} URLs`,
      );
    }

    log.debug(`${LOG_PREFIX} Built Mystique message type ${message.type}`);
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    const scopeForLog = brand
      ? ` brandId=${brand.brandId}`
      : '';
    log.info(
      `${LOG_PREFIX} Queued Cited analysis request to Mystique for ${config.companyName} `
        + `with ${message.data.urls.length} URLs${scopeForLog}`,
    );
    return auditData;
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send Mystique message: ${error.message}`);
    // Notify the Slack thread that triggered this audit so the operator knows
    // Mystique was never reached and doesn't wait for results that won't come.
    const slackContext = auditResult?.slackContext;
    if (slackContext) {
      const { channelId, threadTs } = slackContext;
      const siteLabel = auditResult.config?.companyWebsite || siteId;
      await postMessageOptional(
        context,
        channelId,
        `:x: *cited-analysis* failed to queue for *${siteLabel}*\n• Reason: ${error.message}`,
        { threadTs },
      );
    }
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runCitedAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
