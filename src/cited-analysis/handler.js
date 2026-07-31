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
  computeBrandTokens,
  isExcludedCitedHost,
  toApexHost,
  buildAnalysisScrapeStatusMessage,
  formatDrsExtras,
  scrapedThisCycle,
} from '../utils/offsite-audit-utils.js';
import { CITED_ANALYSIS_DRS_CONFIG } from '../offsite-brand-presence/constants.js';
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
const HUMAN_PREFIX = `[offsite:${AUDIT.CITED}]`;

// SQS standard-queue maximum payload is 256 KB (262144 bytes). Stay under a
// safety budget so worst-case serialisation doesn't hit the hard reject.
const SQS_MAX_SAFE_BYTES = 200 * 1024;

// Max prompts kept per URL in the Mystique payload. The stored prompts array
// can hold 100+ entries per URL; un-capped, 50 URLs of full prompts blow past
// the SQS budget. Keeping the top 5 (stored order) keeps every URL in the
// payload while staying far under budget (50 URLs x 5 prompts ~= 18 KB).
const MAX_PROMPTS_PER_URL = 5;

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
 * Drops cited URLs that are not earned third-party editorial content:
 * social/search/deal-aggregator domains (google, facebook, instagram, groupon)
 * and brand-owned lookalike domains whose host contains a brand token
 * (e.g. ``lovedbylovesac.com`` for the Lovesac customer).
 *
 * This is read-time defense in depth — the write path (offsite-brand-presence)
 * applies the same exclusion before storing — and additionally filters URLs
 * that were already stored before that filter existed.
 *
 * Unparseable URLs are kept (a no-op `host`), matching `partitionOwnedUrls`.
 * Each drop is debug-logged with the matched domain/token so operators can
 * diagnose over-eager matches for short/common-word brand tokens.
 * @param {Array<{url: string}>} urls
 * @param {Set<string>} brandTokens
 * @param {Object} olog - bound offsite logger (see createOffsiteLogger)
 * @returns {{ kept: Array<{url: string}>, droppedCount: number }}
 */
function partitionExcludedUrls(urls, brandTokens, olog) {
  const kept = [];
  let droppedCount = 0;
  for (const entry of urls) {
    const host = toApexHost(entry.url);
    const reason = host && isExcludedCitedHost(host, brandTokens);
    if (reason) {
      droppedCount += 1;
      olog.debug('url_store_read', `Excluding ${entry.url}`, {
        peer: PEER.URL_STORE, direction: 'inbound', reason,
      });
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
  const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId });
  const storeClient = StoreClient.createFrom(context);

  olog.start('url_store_read', `Fetching data from stores for siteId: ${siteId}`, {
    peer: PEER.URL_STORE, direction: 'inbound',
  });

  const rawUrls = await storeClient.getUrls(siteId, URL_TYPES.CITED, { sortBy: 'createdAt', sortOrder: 'desc' });
  olog.success('url_store_read', `Retrieved ${rawUrls.length} cited URLs from URL Store`, {
    peer: PEER.URL_STORE, direction: 'inbound', count: rawUrls.length,
  });

  // Drop URLs on the customer's own domain. Cited URLs represent 3rd-party
  // EARNED citations — pages on ``bmw.com`` for the BMW customer would
  // skew earned-media reporting. The mystique flow re-applies the same
  // filter for defense in depth.
  const baseURL = site?.getBaseURL?.();
  const { kept: earnedUrls, droppedCount: ownedDroppedCount } = partitionOwnedUrls(
    rawUrls,
    baseURL,
  );
  if (ownedDroppedCount > 0) {
    olog.debug(
      'url_store_read',
      `Excluded ${ownedDroppedCount} owned-domain URLs (cited analysis is 3rd-party earned only)`,
      { peer: PEER.URL_STORE, direction: 'inbound', droppedOwned: ownedDroppedCount },
    );
  }

  // Drop social/search/deal-aggregator domains and brand-owned lookalikes
  // (e.g. lovedbylovesac.com). Defense in depth for the write-path filter, and
  // catches URLs stored before that filter existed.
  const brandKeywords = site?.getConfig?.()?.getBrandKeywords?.() || [];
  const brandTokens = computeBrandTokens(toApexHost(baseURL), brandKeywords);
  const { kept: curatedUrls, droppedCount: nonEarnedDroppedCount } = partitionExcludedUrls(
    earnedUrls,
    brandTokens,
    olog,
  );
  if (nonEarnedDroppedCount > 0) {
    olog.debug(
      'url_store_read',
      `Excluded ${nonEarnedDroppedCount} non-earned/branded URLs `
      + '(social, search, deal-aggregator, or brand-owned lookalike)',
      { peer: PEER.URL_STORE, direction: 'inbound', droppedNonEarned: nonEarnedDroppedCount },
    );
  }

  const drsClient = DrsClient.createFrom(context);
  const { datasetIds } = CITED_ANALYSIS_DRS_CONFIG;
  const { urls, counts } = await filterUrlsByDrsStatus(
    curatedUrls,
    datasetIds,
    siteId,
    drsClient,
    olog,
  );
  olog.success('drs_availability', `${urls.length} cited URLs available in DRS${formatDrsExtras(counts)}`, {
    peer: PEER.DRS, direction: 'outbound', available: urls.length,
  });

  const topics = await computeTopicsFromBrandPresence(siteId, context, site);
  olog.debug('topics_load', `Computed ${topics.length} topics from brand presence data`, {
    count: topics.length,
  });
  olog.debug('topics_load', `Brand-presence topics payload: ${JSON.stringify(topics)}`);

  let guidelines = [];
  try {
    const sentimentConfig = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.CITED_ANALYSIS);
    guidelines = sentimentConfig.guidelines ?? [];
  } catch (error) {
    if (error instanceof StoreEmptyError) {
      olog.skip('guideline_read', 'No guidelines configured for cited-analysis, proceeding without', {
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
 * Run Cited Analysis audit
 * @param {string} url - The resolved URL for the audit
 * @param {Object} context - The audit context
 * @param {Object} site - The site being audited
 * @param {Object} [auditContext] - SQS audit context; optional `messageData` from `message.data`
 *   (e.g. urlLimit, enableBrandProfile from Slack)
 * @returns {Promise<Object>} Audit result
 */
async function runCitedAnalysisAudit(url, context, site, auditContext = {}) {
  const { log } = context;
  const siteId = site.getId();
  const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId });
  // Phase-timing anchor for the Mystique phase; combined with the DRS timings threaded in
  // via auditContext (from the offsite-brand-presence DRS status handler) in the guidance
  // handler to report DRS / Mystique / total durations.
  const analysisStartedAt = Date.now();

  olog.start('audit_start', `Starting Cited analysis audit for site: ${siteId}`);
  olog.debug('audit_start', `auditContext: ${JSON.stringify(auditContext)}`);

  const enableBrandProfile = resolveEnableBrandProfile(auditContext, log, HUMAN_PREFIX);

  try {
    const citedConfig = getCitedConfig(site);

    if (!citedConfig.companyName) {
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

    olog.success('config_resolve', `Config: companyName=${citedConfig.companyName}, website=${citedConfig.companyWebsite}, competitors=${citedConfig.competitors.length}`, {
      companyName: citedConfig.companyName, competitors: citedConfig.competitors.length,
    });
    if (citedConfig.competitors.length === 0) {
      // Surfaces the misconfiguration before the SQS hop to Mystique. With an
      // empty list Mystique will only count the primary brand in Share of Voice
      // (no hardcoded fallback) — see LLMO-4909 / cited_sentiment_flow.py.
      olog.warn('config_resolve', `No competitors configured for site ${siteId}; Share of Voice will only include the primary brand`, {
        outcome: OUTCOME.SKIP, reason: 'no_competitors',
      });
    }

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
        analysisName: 'cited-analysis',
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
          ...citedConfig,
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
      // cited URLs to analyze. Report a terminal message instead of looping.
      if (auditContext.drsScrapeRequested) {
        olog.failure('url_store_read', `URL store still empty after scrape: ${error.message}`, {
          peer: PEER.URL_STORE, direction: 'inbound', reason: 'empty_after_scrape',
        });
        await postMessageOptional(
          context,
          channelId,
          `:warning: *cited-analysis* for *${site.getBaseURL()}* — no cited URLs found to analyze.`,
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
      olog.skip('store_fetch_complete', 'URL store empty, requesting a scoped scrape for top-cited', {
        status: 'pending_scrape', peer: PEER.URL_STORE, direction: 'inbound', reason: 'empty_store',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *cited-analysis* for *${site.getBaseURL()}* — no stored URLs yet; `
          + 'collecting & scraping cited URLs first, will retry automatically.',
        { threadTs },
      );
      await requestOffsiteScrape(context, siteId, 'top-cited', slackContext, enableBrandProfile, olog);
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
          `:warning: *cited-analysis* for *${site.getBaseURL()}* — DRS reported no scraped content after scraping; nothing to analyze.`,
          { threadTs },
        );
        return {
          auditResult: { success: false, error: error.message },
          fullAuditRef: url,
        };
      }
      olog.skip('store_fetch_complete', 'URLs stored but not scraped in DRS yet, requesting a scrape for top-cited', {
        status: 'pending_scrape', peer: PEER.DRS, direction: 'outbound', reason: 'no_drs_content',
      });
      await postMessageOptional(
        context,
        channelId,
        `:mag: *cited-analysis* for *${site.getBaseURL()}* — cited URLs are stored but not scraped in DRS yet${formatDrsExtras(error.counts)}; `
          + 'starting a DRS scrape for top-cited, will analyze automatically when it finishes.',
        { threadTs },
      );
      await requestOffsiteScrape(context, siteId, 'top-cited', slackContext, enableBrandProfile, olog);
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
  const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId, auditId: audit?.getId() });

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
    // Project only the fields Mystique reads (url, categories, prompts,
    // timesCited). URL Store metadata (siteId, byCustomer, audits, timestamps)
    // is not needed downstream and contributes significant per-URL bloat.
    // Prompts are capped at MAX_PROMPTS_PER_URL (stored order) — the array can
    // hold 100+ entries per URL, which would blow the SQS budget at 50 URLs.
    const enrichedUrls = enrichUrlsWithTopicData(urls, sentimentConfig.topics)
      .slice(0, urlLimit)
      .map(({
        url: urlStr, categories, timesCited, prompts,
      }) => {
        const cappedPrompts = prompts?.slice(0, MAX_PROMPTS_PER_URL);
        return {
          url: urlStr,
          ...(categories?.length > 0 && { categories }),
          ...(timesCited > 0 && { timesCited }),
          ...(cappedPrompts?.length > 0 && { prompts: cappedPrompts }),
        };
      });

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

    // Safety guard: if the serialised message still exceeds the budget after
    // per-URL projection, drop URLs from the tail until it fits rather than
    // letting SQS reject the send entirely. This re-serialises the message once
    // per dropped URL (O(n)), which is fine while MYSTIQUE_URLS_LIMIT
    // stays small (50) and prompts are capped per URL; switch to a binary
    // search / byte-per-URL estimate if the cap ever grows large enough for the
    // linear passes to matter.
    let sentUrlCount = message.data.urls.length;
    while (sentUrlCount > 1) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (bytes <= SQS_MAX_SAFE_BYTES) {
        break;
      }
      sentUrlCount -= 1;
      message.data.urls = enrichedUrls.slice(0, sentUrlCount);
      olog.warn(
        'mystique_dispatch',
        `Message size ${bytes} bytes exceeds budget; reducing to ${sentUrlCount} URLs`,
        { peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'sqs_budget' },
      );
    }

    // Last-resort: a single URL with extremely long prompts can still exceed
    // the budget. Strip its prompts so the URL itself always gets through.
    if (sentUrlCount === 1) {
      const bytes = Buffer.byteLength(JSON.stringify(message), 'utf8');
      if (bytes > SQS_MAX_SAFE_BYTES) {
        olog.warn(
          'mystique_dispatch',
          `Single-URL payload (${bytes} bytes) still exceeds budget; stripping prompts`,
          { peer: PEER.MYSTIQUE, direction: 'outbound', reason: 'sqs_budget_single' },
        );
        const [singleUrl] = message.data.urls;
        message.data.urls = [{
          url: singleUrl.url,
          ...(singleUrl.categories?.length > 0 && { categories: singleUrl.categories }),
          ...(singleUrl.timesCited > 0 && { timesCited: singleUrl.timesCited }),
        }];
      }
    }

    olog.debug('mystique_dispatch', `Built Mystique message type ${message.type}`, {
      peer: PEER.MYSTIQUE, direction: 'outbound',
    });
    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
    olog.success(
      'mystique_dispatch',
      `Queued Cited analysis request to Mystique for ${config.companyName} `
        + `with ${message.data.urls.length} URLs`,
      {
        peer: PEER.MYSTIQUE,
        direction: 'outbound',
        urls: message.data.urls.length,
        ...(brand && { brandId: brand.brandId }),
      },
    );
    return auditData;
  } catch (error) {
    olog.failure('mystique_dispatch', `Failed to send Mystique message: ${error.message}`, {
      peer: PEER.MYSTIQUE, direction: 'outbound', errorName: error.name,
    });
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
  .withPostProcessors([sendMystiqueMessagePostProcessor, withAuditPersistLog(AUDIT.CITED)])
  .build();
