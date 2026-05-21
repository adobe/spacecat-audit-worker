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

import { Audit, Suggestion } from '@adobe/spacecat-shared-data-access';
import { readSiteStatusJson, uploadStatusSummaryToS3 } from './status-writer.js';
import { isStickyBotBlocked, detectBotBlock, buildBotBlockedResult } from './bot-block.js';
import { filterUrls } from './url-filter.js';
import { fetchUrls } from './url-fetcher.js';
import { AuditBuilder } from '../common/audit-builder.js';
import { syncSuggestions } from '../utils/data-access.js';
import { getObjectFromKey } from '../utils/s3-utils.js';
import { resolveMode } from './mode-resolver.js';
import { getScrapeJobStats } from './scrape-stats.js';
import { analyzeHtmlForPrerender } from './utils/html-comparator.js';
import { getS3Path, isPaidLLMOCustomer, toPathname } from './utils/utils.js';
import {
  detectWrongEdgeDeployedStatus,
  createScrapeForbiddenOpportunity,
  processOpportunityAndSuggestions,
  markNewSuggestionsAsCovered,
} from './opportunity-syncer.js';
import {
  CONTENT_GAIN_THRESHOLD,
  MODE_AI_ONLY,
  MYSTIQUE_BATCH_SIZE,
} from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;
const { AUDIT_STEP_DESTINATIONS } = Audit;
const AUDIT_ERROR_MESSAGE = 'Audit failed';

/**
 * Gets scraped HTML content and metadata from S3 for a specific URL
 * @param {string} url - Full URL
 * @param {Object} context - Audit context (must contain log, s3Client, env;
 * may contain auditContext, site)
 * @returns {Promise<Object>} - Object with serverSideHtml, clientSideHtml, and metadata
 */
async function getScrapedHtmlFromS3(url, context) {
  const {
    log, s3Client, env, auditContext,
  } = context;

  try {
    const bucketName = env.S3_SCRAPER_BUCKET_NAME;
    const { scrapeJobId: storageId } = auditContext || {};
    const serverSideKey = getS3Path(url, storageId, 'server-side.html');
    const clientSideKey = getS3Path(url, storageId, 'client-side.html');
    const scrapeJsonKey = getS3Path(url, storageId, 'scrape.json');

    log.debug(`${LOG_PREFIX} Getting scraped content for URL: ${url}`);

    const results = await Promise.allSettled([
      getObjectFromKey(s3Client, bucketName, serverSideKey, log),
      getObjectFromKey(s3Client, bucketName, clientSideKey, log),
      getObjectFromKey(s3Client, bucketName, scrapeJsonKey, log),
    ]);

    // Extract values from settled promises
    const serverSideHtml = results[0].status === 'fulfilled' ? results[0].value : null;
    const clientSideHtml = results[1].status === 'fulfilled' ? results[1].value : null;
    const scrapeJsonData = results[2].status === 'fulfilled' ? results[2].value : null;

    // getObjectFromKey already parses JSON if ContentType is application/json
    // So scrapeJsonData is either null (not found), or an already-parsed object
    const metadata = scrapeJsonData || null;

    return {
      serverSideHtml,
      clientSideHtml,
      metadata,
    };
  } catch (error) {
    log.warn(`${LOG_PREFIX} Could not get scraped content for ${url}: ${error.message}`);
    return {
      serverSideHtml: null,
      clientSideHtml: null,
      metadata: null,
    };
  }
}

/**
 * Compares server-side HTML with client-side HTML and detects prerendering opportunities
 * @param {string} url - URL being analyzed
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Comparison result with similarity score and recommendation
 */
async function compareHtmlContent(url, context) {
  const { log } = context;

  log.debug(`${LOG_PREFIX} Comparing HTML content for: ${url}`);

  const scrapedData = await getScrapedHtmlFromS3(url, context);

  const { serverSideHtml, clientSideHtml, metadata } = scrapedData;

  // Track if scrape.json exists and if it indicates 403
  const hasScrapeMetadata = metadata !== null;
  const scrapeForbidden = metadata?.error?.statusCode === 403;

  try {
    // Validate HTML data availability
    if (!serverSideHtml || !clientSideHtml) {
      throw new Error(`Missing HTML data for ${url} (server-side: ${!!serverSideHtml}, client-side: ${!!clientSideHtml})`);
    }

    const analysis = await analyzeHtmlForPrerender(
      serverSideHtml,
      clientSideHtml,
      CONTENT_GAIN_THRESHOLD,
    );

    log.debug(`${LOG_PREFIX} Content analysis for ${url}: contentGainRatio=${analysis.contentGainRatio}, wordCountBefore=${analysis.wordCountBefore}, wordCountAfter=${analysis.wordCountAfter}`);

    return {
      url,
      ...analysis,
      hasScrapeMetadata, // Track if scrape.json exists on S3
      scrapeForbidden, // Track if original scrape was forbidden (403)
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge, // From scrape.json (content-scraper PR #784)
      usedEarlyClientSideHtml: !!metadata?.usedEarlyClientSideHtml, // From scrape.json
      /* c8 ignore next */
      scrapeError: metadata?.error, // Include error details from scrape.json
    };
  } catch (error) {
    log.debug(`${LOG_PREFIX} HTML analysis failed for ${url}: ${error.message}`);
    return {
      url,
      error: true,
      needsPrerender: false,
      hasScrapeMetadata,
      scrapeForbidden,
      isDeployedAtEdge: !!metadata?.isDeployedAtEdge,
      usedEarlyClientSideHtml: !!metadata?.usedEarlyClientSideHtml,
      scrapeError: metadata?.error,
    };
  }
}

/**
 * Parses the mode from the data field
 * @param {string|Object} data - The data field from the message
 * @returns {string|null} - The mode value or null
 */
/**
 * Fetches the latest scrapeJobId from the status.json file in S3
 * @param {string} siteId - The site ID
 * @param {Object} context - Audit context with s3Client and env
 * @returns {Promise<string|null>} - The scrapeJobId or null if not found
 */
async function fetchLatestScrapeJobId(siteId, context) {
  const { log } = context;
  log.info(`${LOG_PREFIX} ai-only: Fetching status.json for siteId=${siteId}`);
  const statusData = await readSiteStatusJson(siteId, context);
  if (statusData.scrapeJobId) {
    log.info(`${LOG_PREFIX} ai-only: Found scrapeJobId: ${statusData.scrapeJobId}`);
    return statusData.scrapeJobId;
  }
  log.warn(`${LOG_PREFIX} ai-only: No scrapeJobId found in status.json`);
  return null;
}

/**
 * Sends a guidance:prerender message to Mystique with AI summary generation request
 * @param {string} auditUrl - Audited URL (site base URL)
 * @param {Object} auditData - Audit data used to build the message
 * @param {Object} opportunity - The prerender opportunity entity
 * @param {Object} context - Processing context
 * @param {Array|null} [preBuiltCandidates] - Pre-built candidate objects for normal audit runs.
 *   Each entry is { suggestionId, url, originalHtmlMarkdownKey, markdownDiffKey }.
 *   When null/omitted, candidates are derived from all DB suggestions (ai-only mode).
 * @returns {Promise<number>} - Number of suggestions sent to Mystique
 */
// eslint-disable-next-line max-len
async function sendPrerenderGuidanceRequestToMystique(auditUrl, auditData, opportunity, context, preBuiltCandidates) {
  const {
    log, sqs, env, site,
  } = context;
  /* c8 ignore start - Defensive checks and destructuring, tested in ai-only mode tests */
  const {
    siteId,
    auditId,
  } = auditData || {};

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn(`${LOG_PREFIX} SQS or Mystique queue not configured, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }

  if (!opportunity || !opportunity.getId) {
    log.warn(`${LOG_PREFIX} Opportunity entity not available, skipping guidance:prerender message. baseUrl=${auditUrl || site?.getBaseURL?.() || ''}, siteId=${siteId}`);
    return 0;
  }
  /* c8 ignore stop */

  const opportunityId = opportunity.getId();

  try {
    const baseUrl = auditUrl;

    let suggestionsPayload;

    /* c8 ignore next 4 - Normal run path exercised via processContentAndGenerateOpportunities */
    if (preBuiltCandidates) {
      suggestionsPayload = preBuiltCandidates;
    } else {
      // ai-only mode: no URL list available, derive candidates from all DB suggestions.
      const existingSuggestions = await opportunity.getSuggestions();

      if (!existingSuggestions || existingSuggestions.length === 0) {
        log.debug(`${LOG_PREFIX} No existing suggestions found for opportunityId=${opportunityId}, skipping Mystique message. baseUrl=${baseUrl}, siteId=${siteId}`);
        return 0;
      }

      const candidates = [];

      existingSuggestions.forEach((s) => {
        const data = s.getData();

        // Skip domain-wide aggregate suggestion and anything without URL
        if (!data?.url || data?.isDomainWide) {
          return;
        }

        // Skip OUTDATED and SKIPPED suggestions (stale or user-dismissed)
        const status = s.getStatus();
        const isDeployedOrFixed = status === Suggestion.STATUSES.FIXED || !!data?.edgeDeployed;
        if (
          status === Suggestion.STATUSES.OUTDATED
          || status === Suggestion.STATUSES.SKIPPED
          || isDeployedOrFixed
        ) {
          return;
        }

        const suggestionId = s.getId();

        // Resolve the scrapeJobId in priority order:
        //   1. data.scrapeJobId — stamped at suggestion-creation time (most reliable)
        //   2. data.originalHtmlKey — extract the job segment from the stored S3 path
        //      (format: prerender/scrapes/{scrapeJobId}/...)
        //   3. Neither available → skip; we cannot build valid S3 keys without a job id
        let effectiveScrapeJobId = data.scrapeJobId;
        if (!effectiveScrapeJobId && data.originalHtmlKey) {
          // prerender/scrapes/{scrapeJobId}/...
          const parts = data.originalHtmlKey.split('/');
          effectiveScrapeJobId = parts[2] || null;
          if (effectiveScrapeJobId) {
            log.debug(`${LOG_PREFIX} Suggestion ${suggestionId} missing scrapeJobId; `
              + `derived from originalHtmlKey: ${effectiveScrapeJobId}. `
              + `baseUrl=${baseUrl}, siteId=${siteId}`);
          }
        }
        if (!effectiveScrapeJobId) {
          log.warn(`${LOG_PREFIX} Suggestion ${suggestionId} skipped: no scrapeJobId and no `
            + `originalHtmlKey to derive one from. baseUrl=${baseUrl}, siteId=${siteId}`);
          return;
        }

        candidates.push({
          suggestionId,
          url: data.url,
          originalHtmlMarkdownKey: getS3Path(data.url, effectiveScrapeJobId, 'server-side-html.md'),
          markdownDiffKey: getS3Path(data.url, effectiveScrapeJobId, 'markdown-diff.md'),
        });
      });

      suggestionsPayload = candidates;
    }

    if (suggestionsPayload.length === 0) {
      log.info(`${LOG_PREFIX} No eligible suggestions to send to Mystique for opportunityId=${opportunityId}. baseUrl=${baseUrl}, siteId=${siteId}`);
      return 0;
    }

    const deliveryType = site?.getDeliveryType?.() || 'unknown';

    // SQS has a 256 KB message size limit. Chunk suggestions into batches to stay safely under it.
    // TODO: send all batches once Mystique multi-batch handling is fully deployed.
    const firstBatch = suggestionsPayload.slice(0, MYSTIQUE_BATCH_SIZE);

    const time = new Date().toISOString();
    const queue = env.QUEUE_SPACECAT_TO_MYSTIQUE;
    await sqs.sendMessage(queue, {
      type: 'guidance:prerender',
      url: baseUrl,
      siteId,
      auditId,
      deliveryType,
      time,
      data: {
        opportunityId,
        suggestions: firstBatch,
        batchIndex: 0,
        totalBatches: 1,
      },
    });

    log.info(`${LOG_PREFIX} Queued guidance:prerender message to Mystique for baseUrl=${baseUrl}, `
      + `siteId=${siteId}, opportunityId=${opportunityId}, suggestions=${firstBatch.length} (capped to 1 batch of ${MYSTIQUE_BATCH_SIZE})`);
    return firstBatch.length;
  /* c8 ignore next 8 - Error handling for SQS failures when sending to Mystique,
   * difficult to test reliably */
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to send guidance:prerender message to Mystique for opportunityId=${opportunityId}, `
      + `baseUrl=${auditUrl}, siteId=${siteId}: ${error.message}`, error);
    return 0;
  }
}

/**
 * Handles AI-summary-only mode: sends existing suggestions to Mystique without running audit.
 * Called early in step 1 to bypass import/scraping/processing steps.
 * @param {Object} context - Audit context
 * @returns {Promise<Object>} - Result indicating success/failure
 */
export async function handleAiOnlyMode(context) {
  const {
    site, log, dataAccess, data,
  } = context;
  const { Opportunity } = dataAccess;
  const siteId = site.getId();
  const baseUrl = site.getBaseURL();

  // Parse optional params from data field (opportunityId, scrapeJobId)
  let opportunityId = null;
  let scrapeJobId = null;
  if (data) {
    try {
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      opportunityId = parsedData.opportunityId;
      scrapeJobId = parsedData.scrapeJobId;
    } catch (e) {
      // Ignore parse errors - graceful degradation for malformed JSON
    }
  }

  log.info(`${LOG_PREFIX} ai-only: Processing AI summary request for baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunityId || 'latest'}`);

  // Fetch scrapeJobId from status.json if not provided
  if (!scrapeJobId) {
    log.info(`${LOG_PREFIX} ai-only: scrapeJobId not provided, fetching from status.json for baseUrl=${baseUrl}, siteId=${siteId}`);
    scrapeJobId = await fetchLatestScrapeJobId(siteId, context);

    if (!scrapeJobId) {
      const error = 'scrapeJobId not found. Either provide it in data or ensure a prerender audit has run recently.';
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }
  }

  // Find the opportunity
  let opportunity;
  if (opportunityId) {
    opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) {
      const error = `Opportunity not found: ${opportunityId}`;
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }
  } else {
    // Find latest NEW prerender opportunity for this site
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    opportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

    if (!opportunity) {
      const error = `No NEW prerender opportunity found for site: ${siteId}`;
      log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
      return {
        error,
        status: 'failed',
        fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
        auditResult: { error },
      };
    }

    log.info(`${LOG_PREFIX} ai-only: Found latest NEW opportunity: ${opportunity.getId()} for baseUrl=${baseUrl}, siteId=${siteId}`);
  }

  // Verify opportunity belongs to the site
  if (opportunity.getSiteId() !== siteId) {
    const error = `Opportunity ${opportunity.getId()} does not belong to site ${siteId}`;
    log.error(`${LOG_PREFIX} ai-only: ${error} baseUrl=${baseUrl}, siteId=${siteId}`);
    return {
      error,
      status: 'failed',
      fullAuditRef: `${MODE_AI_ONLY}/failed-${siteId}`,
      auditResult: { error },
    };
  }

  // Send to Mystique using the existing function
  const auditData = {
    siteId,
    // Fallback to custom audit ID for ai-only mode (for old opportunities without auditId)
    auditId: opportunity.getAuditId() || `prerender-ai-only-${siteId}`,
    scrapeJobId,
  };

  const suggestionCount = await sendPrerenderGuidanceRequestToMystique(
    site.getBaseURL(),
    auditData,
    opportunity,
    context,
  );

  log.info(`${LOG_PREFIX} ai-only: Successfully queued AI summary request for ${suggestionCount} suggestion(s). baseUrl=${baseUrl}, siteId=${siteId}, opportunityId=${opportunity.getId()}`);

  return {
    status: 'complete',
    mode: MODE_AI_ONLY,
    opportunityId: opportunity.getId(),
    fullAuditRef: `${MODE_AI_ONLY}/${opportunity.getId()}`,
    auditResult: {
      message: `AI summary generation queued successfully for ${suggestionCount} suggestion(s)`,
      suggestionCount,
    },
  };
}

/**
 * Step 1: Import top pages data OR handle ai-only mode
 * @param {Object} context - Audit context with site and finalUrl
 * @returns {Promise<Object>} - Import job configuration OR ai-summary result
 */
export async function importTopPages(context) {
  const {
    site, finalUrl, log, auditContext,
  } = context;

  const { isAiOnly } = resolveMode(context);
  if (isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 1, skipping import/scraping/processing`);
    return handleAiOnlyMode(context);
  }

  const s3BucketPath = `scrapes/${site.getId()}/`;
  return {
    type: 'top-pages',
    siteId: site.getId(),
    auditResult: { status: 'preparing', finalUrl },
    fullAuditRef: s3BucketPath,
    ...(Array.isArray(auditContext?.urls) && auditContext.urls.length > 0
      ? {
        auditContext: {
          urls: auditContext.urls,
        },
      }
      : {}),
  };
}

/**
 * Step 2: Submit URLs for scraping OR skip if in ai-only mode
 * @param {Object} context - Audit context with site and dataAccess
 * @returns {Promise<Object>} - URLs to scrape and metadata OR ai-only result
 */
export async function submitForScraping(context) {
  const { site, log } = context;

  const mode = resolveMode(context);
  if (mode.isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 2, skipping scraping (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();

  const siteStatus = mode.isCsv ? {} : await readSiteStatusJson(siteId, context);

  if (isStickyBotBlocked(mode, siteStatus)) {
    return buildBotBlockedResult(context, siteStatus);
  }

  const rawUrls = await fetchUrls(context, mode);
  const {
    csvUrls, topPagesUrls, agenticUrls, includedURLs,
  } = rawUrls;

  const { urls: finalUrls, filteredCount, metrics } = await filterUrls(
    context,
    mode,
    rawUrls,
    siteStatus,
  );

  log.info([
    `${LOG_PREFIX} prerender_submit_scraping_metrics:`,
    `submittedUrls=${finalUrls.length}`,
    `csvUrls=${csvUrls.length}`,
    `agenticUrls=${agenticUrls.length}`,
    `topPagesUrls=${topPagesUrls.length}`,
    `includedURLs=${includedURLs.length}`,
    `filteredOutUrls=${filteredCount}`,
    ...(!mode.isCsv ? [
      `currentAgentic=${metrics.currentAgentic}`,
      `currentOrganic=${metrics.currentOrganic}`,
      `currentIncludedUrls=${metrics.currentIncludedUrls}`,
      `isFirstRunOfCycle=${metrics.isFirstRunOfCycle}`,
      `agenticNewThisCycle=${metrics.agenticNewThisCycle}`,
      `edgeDeployedUrls=${metrics.edgeDeployedCount}`,
    ] : []),
    `baseUrl=${site.getBaseURL()}`,
    `siteId=${siteId}`,
  ].join(', '));

  return {
    urls: finalUrls.map((url) => ({ url })),
    siteId,
    processingType: AUDIT_TYPE,
    maxScrapeAge: 0,
    options: {
      pageLoadTimeout: 20000,
      storagePrefix: AUDIT_TYPE,
    },
  };
}

/**
 * Writes citability metrics to the PageCitability entity for all successfully scraped URLs.
 * This enables the page-citability audit to detect recently-processed URLs via its 7-day
 * staleness filter, avoiding duplicate scraping across both audits.
 *
 * @param {Array} comparisonResults - Results from compareHtmlContent (all scraped URLs)
 * @param {string} siteId - Site ID
 * @param {Object} context - Audit context with dataAccess and log
 * @returns {Promise<void>}
 */
export async function writeToCitabilityRecords(comparisonResults, siteId, context) {
  if (!comparisonResults?.length) {
    return;
  }

  const { dataAccess, log } = context;
  const { PageCitability } = dataAccess;

  if (!PageCitability?.allBySiteId) {
    log.debug(`${LOG_PREFIX} PageCitability not available, skipping citability record writes`);
    return;
  }

  const existingRecords = await PageCitability.allBySiteId(siteId);
  const existingRecordsMap = new Map(
    existingRecords.map((r) => [toPathname(r.getUrl()), r]),
  );

  const successful = comparisonResults.filter((r) => !r.error);
  const WRITE_BATCH_SIZE = 10;

  const writeOne = async (result) => {
    const {
      url,
      citabilityScore,
      contentGainRatio,
      wordDifference,
      wordCountBefore,
      wordCountAfter,
      isDeployedAtEdge,
    } = result;
    try {
      const existing = existingRecordsMap.get(toPathname(url));
      if (existing) {
        existing.setCitabilityScore(citabilityScore ?? null);
        existing.setContentRatio(contentGainRatio ?? null);
        existing.setWordDifference(wordDifference ?? null);
        existing.setBotWords(wordCountBefore ?? null);
        existing.setNormalWords(wordCountAfter ?? null);
        existing.setIsDeployedAtEdge(isDeployedAtEdge ?? false);
        await existing.save();
      } else {
        await PageCitability.create({
          siteId,
          url,
          citabilityScore: citabilityScore ?? null,
          contentRatio: contentGainRatio ?? null,
          wordDifference: wordDifference ?? null,
          botWords: wordCountBefore ?? null,
          normalWords: wordCountAfter ?? null,
          isDeployedAtEdge: isDeployedAtEdge ?? false,
        });
      }
      return true;
    } catch (e) {
      log.warn(`${LOG_PREFIX} Failed to write PageCitability for ${url}: ${e.message}`);
      return false;
    }
  };

  let written = 0;
  for (let i = 0; i < successful.length; i += WRITE_BATCH_SIZE) {
    const batch = successful.slice(i, i + WRITE_BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map(writeOne));
    written += results.filter(Boolean).length;
  }

  log.info(`${LOG_PREFIX} Wrote PageCitability records: ${written}/${successful.length}`);
}

/**
 * Step 3: Process scraped content and compare server-side vs client-side HTML
 * OR skip if ai-only mode
 * @param {Object} context - Audit context with site, audit, and other dependencies
 * @returns {Promise<Object>} - Audit results with opportunities OR ai-only result
 */
export async function processContentAndGenerateOpportunities(context) {
  const {
    site, audit, log, scrapeResultPaths, dataAccess, auditContext,
  } = context;

  const { isAiOnly } = resolveMode(context);
  if (isAiOnly) {
    log.info(`${LOG_PREFIX} Detected ai-only mode in step 3, skipping processing (already handled in step 1)`);
    return { status: 'skipped', mode: MODE_AI_ONLY };
  }

  const siteId = site.getId();
  const startTime = process.hrtime();
  const isDomainBlocked = auditContext?.domainBlocked === true;

  // Diagnostic: detect non-NEW suggestions with edgeDeployed before syncing.
  // Runs unconditionally so audits with no prerender findings still catch pre-existing issues.
  await detectWrongEdgeDeployedStatus(dataAccess, siteId, site.getBaseURL(), log);

  // Check if this is a paid LLMO customer early so we can use it in all logs
  const isPaid = await isPaidLLMOCustomer(context);

  if (isDomainBlocked) {
    log.info(`${LOG_PREFIX} Domain is bot-blocked, treating as fully forbidden scrape. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);
  }

  log.info(`${LOG_PREFIX} Generate opportunities for baseUrl=${site.getBaseURL()}, siteId=${siteId}, isPaidLLMOCustomer=${isPaid}`);

  try {
    let urlsToCheck = [];

    // Skip expensive URL fetching and comparison when domain is known to be bot-blocked
    if (!isDomainBlocked) {
      if (scrapeResultPaths?.size > 0) {
        urlsToCheck = Array.from(context.scrapeResultPaths.keys());
        log.info(`${LOG_PREFIX} Found ${urlsToCheck.length} URLs from scrape results`);
      } else {
        // scrapeResultPaths is empty — all submitted URLs had FAILED status in the scraper.
        // getScrapeJobStats reads the ScrapeUrl DB and populates missingPages so status.json
        // records the correct failed URLs. Running a top-page fallback here would write phantom
        // 'error' entries for URLs that were never submitted to this scrape job.
        log.warn(`${LOG_PREFIX} No COMPLETE scrape results for baseUrl=${site.getBaseURL()}, `
          + `siteId=${siteId}, scrapeJobId=${auditContext?.scrapeJobId ?? 'unknown'}. `
          + 'Skipping comparison; failed URLs recorded via ScrapeUrl DB.');
      }
    }

    const comparisonResults = isDomainBlocked
      ? []
      : await Promise.all(urlsToCheck.map((url) => compareHtmlContent(url, context)));

    // Phase 2c: write citability metrics to PageCitability entity.
    await writeToCitabilityRecords(comparisonResults, siteId, context);

    const urlsNeedingPrerender = comparisonResults.filter((result) => result.needsPrerender);
    const successfulComparisons = comparisonResults.filter((result) => !result.error);

    log.info(`${LOG_PREFIX} Found ${urlsNeedingPrerender.length}/${successfulComparisons.length} URLs needing prerender from total ${urlsToCheck.length} URLs scraped. isPaidLLMOCustomer=${isPaid}`);

    const { scrapeJobId } = auditContext || {};
    // getScrapeJobStats combines 403s from COMPLETE-status URLs (already in comparisonResults)
    // and FAILED-status URLs (absent from comparisonResults, fetched from ScrapeUrl table).
    // missingPages is reused by uploadStatusSummaryToS3 to avoid a redundant DB + S3 round-trip.
    const urlCount = urlsToCheck.length;
    const {
      urlsSubmittedForScraping,
      scrapeForbiddenCount,
      missingPages,
      submittedUrlSet,
    } = await getScrapeJobStats(scrapeJobId, comparisonResults, urlCount, context);

    log.info(`${LOG_PREFIX} Scrape analysis for baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbiddenCount=${scrapeForbiddenCount}, totalUrlsChecked=${comparisonResults.length}, isPaidLLMOCustomer=${isPaid}`);

    const { scrapeForbidden, scrapeForbiddenSince } = await detectBotBlock(context, {
      isDomainBlocked, urlsSubmittedForScraping, scrapeForbiddenCount,
    });

    // Remove internal tracking fields from results before storing
    // eslint-disable-next-line
    const cleanResults = comparisonResults.map(({ hasScrapeMetadata, scrapeForbidden, ...result }) => result);

    const urlsNotNeedingPrerender = successfulComparisons.length - urlsNeedingPrerender.length;
    // Scraping error rate: % of submitted URLs that failed (base = urlsSubmittedForScraping)
    const failedCount = urlsSubmittedForScraping - successfulComparisons.length;
    const scrapingErrorRate = urlsSubmittedForScraping > 0
      ? Math.round((failedCount / urlsSubmittedForScraping) * 100)
      : 0;

    // Exclude deployed URLs — don't mark their suggestions outdated regardless of needsPrerender.
    // isDeployedAtEdge=true means prerender is already active at CDN level (via RCV, LLMO
    // side-effect, or domain-wide deployment); no authoritative "resolved" judgment applies.
    const scrapedUrlsSet = new Set(
      successfulComparisons
        .filter((r) => !r.isDeployedAtEdge)
        .map((r) => r.url),
    );

    const auditResult = {
      totalUrlsChecked: comparisonResults.length,
      urlsNeedingPrerender: urlsNeedingPrerender.length,
      urlsScrapedSuccessfully: successfulComparisons.length,
      urlsSubmittedForScraping,
      urlsNotNeedingPrerender,
      scrapingErrorRate,
      results: cleanResults,
      missingPages,
      scrapeForbidden,
      scrapeForbiddenSince,
      scrapeForbiddenCount,
      lastAuditSuccess: true,
    };

    log.info(`${LOG_PREFIX} Scraping metrics for baseUrl=${site.getBaseURL()}, siteId=${siteId}. urlsSubmittedForScraping=${urlsSubmittedForScraping}, urlsScrapedSuccessfully=${successfulComparisons.length}, scrapeForbiddenCount=${scrapeForbiddenCount}, scrapingErrorRate=${scrapingErrorRate}%`);

    let opportunityWithSuggestions = null;

    /* c8 ignore next 16 - Opportunity processing branch, covered by integration tests */
    if (urlsNeedingPrerender.length > 0) {
      const { opportunity, auditRunCandidates } = await processOpportunityAndSuggestions(
        site.getBaseURL(),
        {
          siteId,
          id: audit.getId(),
          auditId: audit.getId(),
          auditResult,
          scrapeJobId,
          scrapedUrlsSet,
        },
        context,
        isPaid,
      );
      opportunityWithSuggestions = opportunity;
      await sendPrerenderGuidanceRequestToMystique(
        site.getBaseURL(),
        { siteId, auditId: audit.getId(), scrapeJobId },
        opportunity,
        context,
        auditRunCandidates,
      );
    } else if (scrapeForbidden) {
      // Create a dummy opportunity when scraping is forbidden (403)
      // This allows the UI to display proper messaging without suggestions
      await createScrapeForbiddenOpportunity(site.getBaseURL(), {
        siteId,
        id: audit.getId(),
        auditId: audit.getId(),
        auditResult,
        scrapeJobId,
      }, context, isPaid);
    } else {
      log.info(`${LOG_PREFIX} No opportunity found. baseUrl=${site.getBaseURL()}, siteId=${siteId}, scrapeForbidden=${scrapeForbidden}, scrapeForbiddenCount=${scrapeForbiddenCount}, isPaidLLMOCustomer=${isPaid}`);

      const { Opportunity } = dataAccess;
      const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
      const existingOpportunity = opportunities.find((o) => o.getType() === AUDIT_TYPE);

      if (existingOpportunity) {
        // Normalize scraped URLs to pathnames so domain shifts don't prevent
        // outdating existing suggestions.
        const scrapedPathnames = new Set(
          [...scrapedUrlsSet].map(toPathname),
        );
        const scrapedUrlsForNoOppty = {
          has: (url) => scrapedPathnames.has(toPathname(url)),
        };
        await syncSuggestions({
          opportunity: existingOpportunity,
          newData: [],
          context,
          buildKey: (suggestionData) => toPathname(suggestionData.url),
          mapNewSuggestion: () => ({}),
          scrapedUrlsSet: scrapedUrlsForNoOppty,
        });
        opportunityWithSuggestions = existingOpportunity;
      }
    }

    // When domain-wide suggestion has edgeDeployed, mark NEW suggestions as coveredByDomainWide
    // Only mark suggestions for pathnames confirmed deployed at edge in this audit run
    const deployedAtEdgePathnames = new Set(
      successfulComparisons
        .filter((r) => r.isDeployedAtEdge)
        .map((r) => toPathname(r.url)),
    );
    await markNewSuggestionsAsCovered(opportunityWithSuggestions, context, deployedAtEdgePathnames);

    const endTime = process.hrtime(startTime);
    const elapsedSeconds = (endTime[0] + endTime[1] / 1e9).toFixed(2);

    log.info(`${LOG_PREFIX} Audit completed in ${elapsedSeconds}s. baseUrl=${site.getBaseURL()}, siteId=${siteId}`);

    const auditData = {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult,
      scrapeJobId,
      submittedUrlSet,
    };

    // Upload status summary to S3 (post-processing)
    await uploadStatusSummaryToS3(site.getBaseURL(), auditData, context);

    return {
      status: 'complete',
      auditResult,
    };
  } catch (error) {
    log.error(`${LOG_PREFIX} Audit failed for baseUrl=${site.getBaseURL()}, siteId=${siteId}: ${error.message}`, error);

    const errorAuditResult = {
      error: AUDIT_ERROR_MESSAGE,
      lastAuditSuccess: false,
      results: [],
    };

    // Upload status.json on error so UI can show audit status via S3 fallback
    await uploadStatusSummaryToS3(site.getBaseURL(), {
      siteId,
      auditId: audit.getId(),
      auditedAt: new Date().toISOString(),
      auditType: AUDIT_TYPE,
      auditResult: errorAuditResult,
      scrapeJobId: auditContext?.scrapeJobId,
    }, context);

    return {
      error: AUDIT_ERROR_MESSAGE,
      totalUrlsChecked: 0,
      urlsNeedingPrerender: 0,
      results: [],
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver((site) => site.getBaseURL())
  .addStep('submit-for-import-top-pages', importTopPages, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('process-content-and-generate-opportunities', processContentAndGenerateOpportunities)
  .build();
