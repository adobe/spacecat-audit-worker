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
  resolveForwardedUrlLimit,
  resolveEnableBrandProfile,
  resolveEnableSemrush,
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
  createOffsiteLogger, withAuditPersistLog, errorField, AUDIT, OUTCOME, PEER,
} from '../utils/offsite-logging.js';

// Human prefix for the one offsite-audit-utils helper that still logs via a passed-in prefix
// string (resolveEnableBrandProfile, shared with the offsite-brand-presence handler). All other
// logging in this file goes through the bound offsite logger (createOffsiteLogger), which emits
// the same `[offsite:<audit>]` prefix.
const HUMAN_PREFIX = `[offsite:${AUDIT.YOUTUBE}]`;

/**
 * YouTube Analysis Audit Handler
 *
 * This audit performs YouTube analysis by:
 * 1. Fetching YouTube URLs from the URL Store (discovered during brand presence analysis)
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
 * Retrieves YouTube-related configuration from the site
 * @param {Object} site - The site object
 * @returns {Object} YouTube configuration
 */
function getYouTubeConfig(site) {
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
 * Fetches all required data from stores for YouTube analysis
 * @param {string} siteId - The site ID
 * @param {Object} context - The audit context
 * @returns {Promise<Object>} Object containing urls and sentimentConfig
 * @throws {StoreEmptyError} If any store returns empty results
 */
async function fetchStoreData(siteId, context, site) {
  const { log } = context;
  const olog = createOffsiteLogger(log, { audit: AUDIT.YOUTUBE, siteId });
  const storeClient = StoreClient.createFrom(context);

  olog.start('data_acquisition_url_store_read', 'Fetching data from stores', {
    peer: PEER.URL_STORE, direction: 'inbound',
  });

  const rawUrls = await storeClient.getUrls(siteId, URL_TYPES.YOUTUBE, { sortBy: 'createdAt', sortOrder: 'desc' });
  olog.success('data_acquisition_url_store_read', 'Retrieved URLs from URL Store', {
    peer: PEER.URL_STORE, direction: 'inbound', count: rawUrls.length,
  });

  const drsClient = DrsClient.createFrom(context);
  const { datasetIds } = OFFSITE_DOMAINS['youtube.com'];
  const { urls, counts } = await filterUrlsByDrsStatus(
    rawUrls,
    datasetIds,
    siteId,
    drsClient,
    olog,
  );
  olog.success('data_acquisition_scrape_content_checked', `${urls.length} YouTube URLs available in DRS${formatDrsExtras(counts)}`, {
    peer: PEER.DRS, direction: 'outbound', available: urls.length,
  });

  const topics = await computeTopicsFromBrandPresence(siteId, context, site);
  olog.debug('audit_orchestration_brand_topics_resolved', 'Computed topics from brand presence data', {
    count: topics.length,
  });

  let guidelines = [];
  try {
    const sentimentConfig = await storeClient.getGuidelines(
      siteId,
      GUIDELINE_TYPES.YOUTUBE_ANALYSIS,
    );
    guidelines = sentimentConfig.guidelines ?? [];
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      olog.skip('audit_orchestration_brand_guidelines_resolved', 'No guidelines configured for youtube-analysis, proceeding without', {
        peer: PEER.URL_STORE, direction: 'inbound', reason: 'no_guidelines', reasonCategory: 'expected',
      });
    } else {
      throw error;
    }
  }

  olog.success('audit_orchestration_brand_guidelines_resolved', `Retrieved ${guidelines.length} guidelines`, {
    peer: PEER.URL_STORE, direction: 'inbound', count: guidelines.length,
  });

  return {
    urls,
    sentimentConfig: { topics, guidelines },
    drsCounts: counts,
  };
}

/**
 * Run YouTube Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @param {Object} [auditContext] - SQS audit context; optional `messageData` from `message.data`
 *   (e.g. urlLimit, enableBrandProfile, enableSemrush from Slack)
 * @returns {Promise<Object>} Audit result
 */
async function runYouTubeAnalysisAudit(url, context, site, auditContext = {}) {
  const { log } = context;
  const siteId = site.getId();
  const olog = createOffsiteLogger(log, { audit: AUDIT.YOUTUBE, siteId });
  // Phase-timing anchor for the Mystique phase; combined with the DRS timings threaded in
  // via auditContext (from the offsite-brand-presence DRS status handler) in the guidance
  // handler to report DRS / Mystique / total durations.
  const analysisStartedAt = Date.now();

  olog.start('audit_orchestration_start', 'Audit started');

  const enableBrandProfile = resolveEnableBrandProfile(auditContext, log, HUMAN_PREFIX);
  const forwardedUrlLimit = resolveForwardedUrlLimit(auditContext, log, HUMAN_PREFIX);
  const enableSemrush = resolveEnableSemrush(auditContext, log, HUMAN_PREFIX);

  try {
    const youtubeConfig = getYouTubeConfig(site);

    if (!youtubeConfig.companyName) {
      olog.warn('audit_orchestration_brand_profile_resolved', 'No company name configured for site, skipping audit', {
        outcome: OUTCOME.SKIP, reason: 'no_company_name', reasonCategory: 'config',
      });
      return {
        auditResult: {
          success: false,
          error: 'No company name configured for this site',
        },
        fullAuditRef: url,
      };
    }

    olog.success('audit_orchestration_brand_profile_resolved', 'Brand profile resolved', {
      companyName: youtubeConfig.companyName,
      website: youtubeConfig.companyWebsite,
    });

    olog.start('data_acquisition_start', 'Starting data acquisition', {});

    const storeData = await fetchStoreData(siteId, context, site);
    // Whether this run's DRS scrape produced the content (poll-dispatched) or we are reusing
    // a prior scrape (direct/scheduled run) changes the log and Slack wording so the thread
    // reads as a coherent sequence rather than a contradictory "no scrape needed".
    const scrapedNow = scrapedThisCycle(auditContext);
    olog.success(
      'data_acquisition_end',
      scrapedNow
        ? 'DRS scrape finished this cycle; proceeding to Mystique'
        : 'Reusing previously scraped DRS content; no new scrape needed, proceeding to Mystique',
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
        analysisName: 'youtube-analysis',
        baseUrl: site.getBaseURL(),
        urlCount: storeData.urls.length,
        urlLimit,
        counts: storeData.drsCounts,
        scrapedNow,
      }),
      { threadTs: slackContext?.threadTs },
    );

    olog.success('audit_orchestration_end', 'Audit complete', { status: 'pending_analysis' });

    return {
      auditResult: {
        success: true,
        status: 'pending_analysis',
        config: {
          ...youtubeConfig,
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
      // YouTube URLs to analyze. Report a terminal message instead of looping.
      if (auditContext.drsScrapeRequested) {
        olog.failure('data_acquisition_url_store_read', 'URL store still empty after scrape', {
          peer: PEER.URL_STORE, direction: 'inbound', reason: 'store_empty_after_scrape', reasonCategory: 'infra', ...errorField(error),
        });
        await postMessageOptional(
          context,
          channelId,
          `:warning: *youtube-analysis* for *${site.getBaseURL()}* — no YouTube URLs found to analyze.`,
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
      olog.skip('data_acquisition_end', 'URL store empty, requesting a scoped scrape for youtube.com', {
        status: 'pending_scrape', peer: PEER.URL_STORE, direction: 'inbound', reason: 'store_empty_first_attempt', reasonCategory: 'expected',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *youtube-analysis* for *${site.getBaseURL()}* — no stored URLs yet; `
          + 'collecting & scraping YouTube URLs first, will retry automatically.',
        { threadTs },
      );
      await requestOffsiteScrape(
        context,
        siteId,
        'youtube.com',
        slackContext,
        enableBrandProfile,
        forwardedUrlLimit,
        enableSemrush,
        olog,
      );
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
        olog.failure('data_acquisition_scrape_content_checked', 'No DRS content available after scraping', {
          peer: PEER.DRS, direction: 'outbound', reason: 'content_not_scraped_after_retry', reasonCategory: 'infra', ...errorField(error),
        });
        await postMessageOptional(
          context,
          channelId,
          `:warning: *youtube-analysis* for *${site.getBaseURL()}* — DRS reported no scraped content after scraping; nothing to analyze.`,
          { threadTs },
        );
        return {
          auditResult: { success: false, error: error.message },
          fullAuditRef: url,
        };
      }
      olog.skip('data_acquisition_end', 'URLs stored but not scraped in DRS yet, requesting a scrape for youtube.com', {
        status: 'pending_scrape', peer: PEER.DRS, direction: 'outbound', reason: 'content_not_scraped_first_attempt', reasonCategory: 'expected',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *youtube-analysis* for *${site.getBaseURL()}* — YouTube URLs are stored but not scraped in DRS yet${formatDrsExtras(error.counts)}; `
          + 'starting a DRS scrape for youtube.com, will analyze automatically when it finishes.',
        { threadTs },
      );
      await requestOffsiteScrape(
        context,
        siteId,
        'youtube.com',
        slackContext,
        enableBrandProfile,
        forwardedUrlLimit,
        enableSemrush,
        olog,
      );
      return {
        auditResult: { success: false, status: 'pending_scrape', error: error.message },
        fullAuditRef: url,
      };
    }

    olog.failure('audit_orchestration_end', 'Audit failed', { ...errorField(error) });
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
 * Post processor to send YouTube analysis request to Mystique
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
  const olog = createOffsiteLogger(log, { audit: AUDIT.YOUTUBE, siteId, auditId: audit?.getId() });

  if (!auditResult.success) {
    olog.skip('audit_analysis_start', 'Audit failed, skipping Mystique message', {
      peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'audit_failed', reasonCategory: 'expected',
    });
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    olog.warn('audit_analysis_start', 'SQS or Mystique queue not configured, skipping message', {
      outcome: OUTCOME.SKIP, peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'mystique_not_configured', reasonCategory: 'infra',
    });
    return auditData;
  }

  try {
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      olog.warn('audit_analysis_start', 'Site not found, skipping Mystique message', {
        outcome: OUTCOME.SKIP, peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'site_not_found_at_dispatch', reasonCategory: 'infra',
      });
      return auditData;
    }

    const { config, storeData } = auditResult;
    const urlLimit = config?.urlLimit ?? MYSTIQUE_URLS_LIMIT;
    olog.success('audit_orchestration_analysis_url_limit_resolved', 'URL limit resolved', { urlLimit });

    const { urls, sentimentConfig } = storeData;
    const enrichedUrls = enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      .slice(0, urlLimit);

    const baseMessage = {
      type: 'guidance:youtube-analysis',
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
      olog.warn('audit_orchestration_brand_scope_resolved', 'Brand resolution failed unexpectedly; proceeding without scope', {
        peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'brand_resolution', reasonCategory: 'infra', ...errorField(brandError),
      });
    }
    const message = applyBrandScope(baseMessage, brand);

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    olog.success(
      'audit_analysis_start',
      'Queued analysis request to Mystique',
      {
        peer: PEER.MYSTIQUE,
        direction: 'outbound',
        companyName: config.companyName,
        urls: enrichedUrls.length,
        messageType: message.type,
        ...(brand && { brandId: brand.brandId }),
      },
    );
    return auditData;
  } catch (error) {
    olog.failure('audit_analysis_start', 'Failed to send Mystique message', {
      peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'unexpected_error', reasonCategory: 'infra', ...errorField(error),
    });
    throw error;
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runYouTubeAnalysisAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor, withAuditPersistLog(AUDIT.YOUTUBE)])
  .build();
