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
  resolveEnableBrandProfile,
  requestOffsiteScrape,
  buildAnalysisScrapeStatusMessage,
  formatDrsExtras,
  scrapedThisCycle,
} from '../utils/offsite-audit-utils.js';
import { OFFSITE_DOMAINS } from '../offsite-brand-presence/constants.js';
import { computeTopicsFromBrandPresence } from '../utils/offsite-brand-presence-enrichment.js';
import { enrichUrlsWithTopicData } from '../utils/url-topic-enrichment.js';
import { resolveBrandForSite, applyBrandScope } from '../utils/brand-resolver.js';
import { postMessageOptional } from '../utils/slack-utils.js';
import {
  createOffsiteLogger, withAuditPersistLog, AUDIT, OUTCOME, PEER,
} from '../utils/offsite-logging.js';

// Human prefix for the one offsite-audit-utils helper that still logs via a passed-in prefix
// string (resolveEnableBrandProfile, shared with the offsite-brand-presence handler). All other
// logging in this file goes through the bound offsite logger (createOffsiteLogger), which emits
// the same `[offsite:<audit>]` prefix.
const HUMAN_PREFIX = `[offsite:${AUDIT.REDDIT}]`;

/**
 * Reddit Analysis Audit Handler
 *
 * This audit performs Reddit analysis by:
 * 1. Fetching Reddit URLs from the URL Store (discovered during brand presence analysis)
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
 * @throws {StoreEmptyError} If the URL store returns empty results
 */
async function fetchStoreData(siteId, context, site) {
  const { log } = context;
  const olog = createOffsiteLogger(log, { audit: AUDIT.REDDIT, siteId });
  const storeClient = StoreClient.createFrom(context);

  olog.start('url_store_read', `Fetching data from stores for siteId: ${siteId}`, {
    peer: PEER.URL_STORE, direction: 'inbound',
  });

  const rawUrls = await storeClient.getUrls(siteId, URL_TYPES.REDDIT, { sortBy: 'createdAt', sortOrder: 'desc' });
  olog.success('url_store_read', `Retrieved ${rawUrls.length} Reddit URLs from URL Store`, {
    peer: PEER.URL_STORE, direction: 'inbound', count: rawUrls.length,
  });

  const drsClient = DrsClient.createFrom(context);
  const { datasetIds } = OFFSITE_DOMAINS['reddit.com'];
  const { urls, counts } = await filterUrlsByDrsStatus(
    rawUrls,
    datasetIds,
    siteId,
    drsClient,
    olog,
  );
  olog.success('drs_availability', `${urls.length} Reddit URLs available in DRS${formatDrsExtras(counts)}`, {
    peer: PEER.DRS, direction: 'outbound', available: urls.length,
  });

  const topics = await computeTopicsFromBrandPresence(siteId, context, site);
  olog.debug('topics_load', `Computed ${topics.length} topics from brand presence data`, {
    count: topics.length,
  });
  olog.debug('topics_load', `Brand-presence topics payload: ${JSON.stringify(topics)}`);

  let guidelines = [];
  try {
    const sentimentConfig = await storeClient.getGuidelines(
      siteId,
      GUIDELINE_TYPES.REDDIT_ANALYSIS,
    );
    guidelines = sentimentConfig.guidelines ?? [];
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      olog.skip('guideline_read', 'No guidelines configured for reddit-analysis, proceeding without', {
        peer: PEER.URL_STORE, direction: 'inbound', reason: 'no_guidelines',
      });
    } else {
      throw error;
    }
  }

  olog.success('guideline_read', `Retrieved ${guidelines.length} guidelines`, {
    peer: PEER.URL_STORE, direction: 'inbound', count: guidelines.length,
  });

  return {
    urls,
    sentimentConfig: { topics, guidelines },
    drsCounts: counts,
  };
}

/**
 * Run Reddit Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @param {Object} [auditContext] - SQS audit context; optional `messageData` from `message.data`
 *   (e.g. urlLimit, enableBrandProfile from Slack)
 * @returns {Promise<Object>} Audit result
 */
async function runRedditAnalysisAudit(url, context, site, auditContext = {}) {
  const { log } = context;
  const siteId = site.getId();
  const olog = createOffsiteLogger(log, { audit: AUDIT.REDDIT, siteId });
  // Phase-timing anchor for the Mystique phase; combined with the DRS timings threaded in
  // via auditContext (from the offsite-brand-presence DRS status handler) in the guidance
  // handler to report DRS / Mystique / total durations.
  const analysisStartedAt = Date.now();

  olog.start('audit_start', `Starting Reddit analysis audit for site: ${siteId}`);
  olog.debug('audit_start', `auditContext: ${JSON.stringify(auditContext)}`);

  const enableBrandProfile = resolveEnableBrandProfile(auditContext, log, HUMAN_PREFIX);

  try {
    const redditConfig = getRedditConfig(site);

    if (!redditConfig.companyName) {
      olog.warn('config_resolve', 'No company name configured for site, skipping audit', {
        outcome: OUTCOME.SKIP, reason: 'no_company_name',
      });
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    olog.success('config_resolve', `Config: companyName=${redditConfig.companyName}, website=${redditConfig.companyWebsite}`, {
      companyName: redditConfig.companyName,
    });

    const storeData = await fetchStoreData(siteId, context, site);
    // Whether this run's DRS scrape produced the content (poll-dispatched) or we are reusing
    // a prior scrape (direct/scheduled run) changes the log and Slack wording so the thread
    // reads as a coherent sequence rather than a contradictory "no scrape needed".
    const scrapedNow = scrapedThisCycle(auditContext);
    olog.success(
      'store_fetch_complete',
      scrapedNow
        ? `DRS scrape finished this cycle; ${storeData.urls.length} URL(s) ready, proceeding to Mystique`
        : `Reusing previously scraped DRS content for ${storeData.urls.length} URL(s); no new scrape needed, proceeding to Mystique`,
      { status: 'pending_analysis', urls: storeData.urls.length, scrapedNow },
    );

    const urlLimit = resolveMystiqueUrlLimit(auditContext, olog);

    const { slackContext } = auditContext;

    // Manual Slack-triggered runs get a notification describing the exact DRS state (fresh
    // scrape this cycle vs. reused prior content). No-ops on scheduled runs where
    // slackContext is absent.
    await postMessageOptional(
      context,
      slackContext?.channelId,
      buildAnalysisScrapeStatusMessage({
        analysisName: 'reddit-analysis',
        baseUrl: site.getBaseURL(),
        urlCount: storeData.urls.length,
        urlLimit,
        counts: storeData.drsCounts,
        scrapedNow,
      }),
      { threadTs: slackContext?.threadTs },
    );

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: {
          ...redditConfig,
          urlLimit,
          ...(enableBrandProfile !== undefined && { enableBrandProfile }),
        },
        storeData,
        ...(slackContext && { slackContext }),
        timings: { analysisStartedAt, ...(auditContext.timings || {}) },
      },
      fullAuditRef: url,
    };
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      const { slackContext } = auditContext;
      const { channelId, threadTs } = slackContext || {};
      // A scoped scrape already ran and the store is STILL empty → the brand has no
      // Reddit URLs to analyze. Report a terminal message instead of looping.
      if (auditContext.drsScrapeRequested) {
        olog.failure('url_store_read', `URL store still empty after scrape: ${error.message}`, {
          peer: PEER.URL_STORE, direction: 'inbound', reason: 'empty_after_scrape',
        });
        await postMessageOptional(
          context,
          channelId,
          `:warning: *reddit-analysis* for *${site.getBaseURL()}* — no Reddit URLs found to analyze.`,
          { threadTs },
        );
        return {
          auditResult: { success: false, error: error.message, storeName: error.storeName },
          fullAuditRef: url,
        };
      }
      // First individual run with an empty store: collect + scrape just this bucket via a
      // domain-scoped offsite-brand-presence run, which re-triggers this analysis when DRS
      // completes — no need to run offsite-brand-presence for all buckets manually.
      olog.skip('store_fetch_complete', 'URL store empty, requesting a scoped scrape for reddit.com', {
        status: 'pending_scrape', peer: PEER.URL_STORE, direction: 'inbound', reason: 'empty_store',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *reddit-analysis* for *${site.getBaseURL()}* — no stored URLs yet; `
          + 'collecting & scraping Reddit URLs first, will retry automatically.',
        { threadTs },
      );
      await requestOffsiteScrape(context, siteId, 'reddit.com', slackContext, enableBrandProfile, olog);
      return {
        auditResult: { success: false, status: 'pending_scrape', error: error.message },
        fullAuditRef: url,
      };
    }

    if (error instanceof DrsNoContentAvailableError) {
      const { slackContext } = auditContext;
      const { channelId, threadTs } = slackContext || {};
      if (auditContext.drsScrapeRequested) {
        // A scrape already ran this cycle and DRS still reports no scraped content → terminal.
        olog.failure('drs_availability', `No DRS content available after scraping: ${error.message}`, {
          peer: PEER.DRS, direction: 'outbound', reason: 'no_content_after_scrape',
        });
        await postMessageOptional(
          context,
          channelId,
          `:warning: *reddit-analysis* for *${site.getBaseURL()}* — DRS reported no scraped content after scraping; nothing to analyze.`,
          { threadTs },
        );
        return {
          auditResult: { success: false, error: error.message },
          fullAuditRef: url,
        };
      }
      olog.skip('store_fetch_complete', 'URLs stored but not scraped in DRS yet, requesting a scrape for reddit.com', {
        status: 'pending_scrape', peer: PEER.DRS, direction: 'outbound', reason: 'no_drs_content',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *reddit-analysis* for *${site.getBaseURL()}* — Reddit URLs are stored but not scraped in DRS yet${formatDrsExtras(error.counts)}; `
          + 'starting a DRS scrape for reddit.com, will analyze automatically when it finishes.',
        { threadTs },
      );
      await requestOffsiteScrape(context, siteId, 'reddit.com', slackContext, enableBrandProfile, olog);
      return {
        auditResult: { success: false, status: 'pending_scrape', error: error.message },
        fullAuditRef: url,
      };
    }

    olog.failure('audit_start', `Audit failed: ${error.message}`, { errorName: error.name });
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
  const olog = createOffsiteLogger(log, { audit: AUDIT.REDDIT, siteId, auditId: audit?.getId() });

  if (!auditResult.success) {
    olog.skip('mystique_dispatch', 'Audit failed, skipping Mystique message', {
      peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'audit_failed',
    });
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    olog.warn('mystique_dispatch', 'SQS or Mystique queue not configured, skipping message', {
      outcome: OUTCOME.SKIP, peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'not_configured',
    });
    return auditData;
  }

  try {
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      olog.warn('mystique_dispatch', 'Site not found, skipping Mystique message', {
        outcome: OUTCOME.SKIP, peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'site_not_found',
      });
      return auditData;
    }

    const { config, storeData } = auditResult;
    const urlLimit = config?.urlLimit ?? MYSTIQUE_URLS_LIMIT;
    olog.success('url_limit_resolve', `urlLimit=${urlLimit} (URLs sent to Mystique)`);

    const { urls, sentimentConfig } = storeData;
    const enrichedUrls = enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      .slice(0, urlLimit);

    const baseMessage = {
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
        ...(config.enableBrandProfile !== undefined
          && { enableBrandProfile: config.enableBrandProfile }),
        urls: enrichedUrls,
      },
    };

    let brand = null;
    try {
      brand = await resolveBrandForSite(context, site);
    } catch (brandError) {
      olog.warn('mystique_dispatch', `Brand resolution failed unexpectedly; proceeding without scope: ${brandError.message}`, {
        peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'brand_resolution', errorName: brandError.name,
      });
    }
    const message = applyBrandScope(baseMessage, brand);

    olog.debug('mystique_dispatch', `Built Mystique message type ${message.type}`, {
      peer: PEER.MYSTIQUE, direction: 'outbound',
    });
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    olog.success(
      'mystique_dispatch',
      `Queued Reddit analysis request to Mystique for ${config.companyName} `
        + `with ${enrichedUrls.length} URLs`,
      {
        peer: PEER.MYSTIQUE,
        direction: 'outbound',
        urls: enrichedUrls.length,
        ...(brand && { brandId: brand.brandId }),
      },
    );
    return auditData;
  } catch (error) {
    olog.failure('mystique_dispatch', `Failed to send Mystique message: ${error.message}`, {
      peer: PEER.MYSTIQUE, direction: 'outbound', errorName: error.name,
    });
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runRedditAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor, withAuditPersistLog(AUDIT.REDDIT)])
  .build();
