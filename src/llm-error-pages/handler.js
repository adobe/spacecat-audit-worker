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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  generateReportingPeriods,
  processErrorPagesResults,
  buildLlmErrorPagesQuery,
  getAllLlmProviders,
  consolidateErrorsByUrl,
  sortErrorsByTrafficVolume,
  categorizeErrorsByStatusCode,
  groupErrorsByUrl,
  parsePeriodIdentifier,
  toPathOnly,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';
import { buildSiteFilters, getS3Config, getCdnAwsRuntime } from '../utils/cdn-utils.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

/**
 * One Opportunity per status code bucket. Each Opportunity has its own lifecycle
 * (NEW/IN_PROGRESS/RESOLVED) and remediation guidance:
 *
 *   llm-error-pages-404  → REDIRECT_UPDATE suggestions; sent to Mystique for AI enrichment
 *   llm-error-pages-403  → CODE_CHANGE suggestions; read-only in UI (no Mystique)
 *   llm-error-pages-5xx  → CODE_CHANGE suggestions; read-only in UI (no Mystique)
 */
const STATUS_BUCKETS = [
  { code: 404, auditType: 'llm-error-pages-404', suggestionType: 'REDIRECT_UPDATE' },
  { code: 403, auditType: 'llm-error-pages-403', suggestionType: 'CODE_CHANGE' },
  { code: '5xx', auditType: 'llm-error-pages-5xx', suggestionType: 'CODE_CHANGE' },
];

/** Suggestions not seen in any of the last N weeks are marked OUTDATED. */
const RETENTION_WEEKS = 4;
const RETENTION_MS = RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000;

/**
 * Step 1: Import top pages and submit for scraping
 */
export async function importTopPagesAndScrape(context) {
  const {
    site, dataAccess, log,
  } = context;
  const { SiteTopPage } = dataAccess;

  try {
    // Try to get top agentic URLs from Athena first
    let topPageUrls = await getTopAgenticUrlsFromAthena(site, context);

    // Fallback to SEO provider if Athena returns no data
    if (!topPageUrls || topPageUrls.length === 0) {
      log.info('[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to SEO top pages');
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
      topPageUrls = topPages.map((page) => page.getUrl());
    }

    if (topPageUrls.length === 0) {
      log.warn('[LLM-ERROR-PAGES] No top pages found for site');
      return {
        type: 'top-pages',
        siteId: site.getId(),
        auditResult: {
          success: false,
          topPages: [],
        },
        fullAuditRef: site.getBaseURL(),
      };
    }

    log.info(`[LLM-ERROR-PAGES] Found ${topPageUrls.length} top pages for site ${site.getId()}`);

    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        success: true,
        topPages: topPageUrls,
      },
      fullAuditRef: site.getBaseURL(),
    };
  } catch (error) {
    log.error(`[LLM-ERROR-PAGES] Failed to import top pages: ${error.message}`, error);
    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        success: false,
        error: error.message,
        topPages: [],
      },
      fullAuditRef: site.getBaseURL(),
    };
  }
}

/**
 * Step 2: Submit top pages for scraping
 */
export async function submitForScraping(context) {
  const {
    site, dataAccess, audit, log,
  } = context;
  const { SiteTopPage } = dataAccess;

  const auditResult = audit.getAuditResult();
  if (auditResult.success === false) {
    log.warn('[LLM-ERROR-PAGES] Audit failed, skipping scraping');
    throw new Error('Audit failed, skipping scraping');
  }

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');

  if (topPages.length === 0) {
    log.warn('[LLM-ERROR-PAGES] No top pages to submit for scraping');
    throw new Error('No top pages to submit for scraping');
  }

  log.info(`[LLM-ERROR-PAGES] Submitting ${topPages.length} pages for scraping`);

  return {
    urls: topPages.map((topPage) => ({ url: topPage.getUrl() })),
    siteId: site.getId(),
    type: 'llm-error-pages',
  };
}

/**
 * Step 3: Run audit, write Opportunities to DB, and send 404s to Mystique.
 */
/* eslint-disable no-await-in-loop */
export async function runAuditAndSendToMystique(context) {
  const { log, site } = context;
  const url = site.getBaseURL();
  let s3Config;

  log.info(`[LLM-ERROR-PAGES] Starting audit for ${url}`);

  try {
    s3Config = getS3Config(site, context);
    const awsRuntime = getCdnAwsRuntime(site, context);
    const athenaClient = awsRuntime.createAthenaClient(s3Config.getAthenaTempLocation());

    const isMonday = new Date().getUTCDay() === 1;
    let weekOffsets;
    if (context.auditContext?.weekOffset !== undefined) {
      weekOffsets = [context.auditContext.weekOffset];
    } else if (isMonday) {
      weekOffsets = [-1, 0];
    } else {
      weekOffsets = [0];
    }

    const { weeks } = generateReportingPeriods(new Date(), weekOffsets);
    const auditResults = [];

    const filters = site.getConfig()?.getLlmoCdnlogsFilter?.() || [];
    const siteFilters = buildSiteFilters(filters, site);
    const {
      dataAccess, sqs, env, audit,
    } = context;
    const { Suggestion, Opportunity } = dataAccess;
    const retentionCutoff = new Date(Date.now() - RETENTION_MS);

    for (const week of weeks) {
      const { startDate, endDate, periodIdentifier } = week;
      log.info(`[LLM-ERROR-PAGES] Running weekly audit for ${periodIdentifier}`);
      try {
        const query = await buildLlmErrorPagesQuery({
          databaseName: s3Config.databaseName,
          tableName: s3Config.tableName,
          startDate,
          endDate,
          llmProviders: getAllLlmProviders(),
          siteFilters,
          site,
        });

        log.info('[LLM-ERROR-PAGES] Executing query...');
        const sqlQueryDescription = '[Athena Query] LLM error pages analysis';
        const results = await athenaClient.query(
          query,
          s3Config.databaseName,
          sqlQueryDescription,
        );

        const processedResults = processErrorPagesResults(results);
        const categorizedResults = categorizeErrorsByStatusCode(processedResults.errorPages);

        log.info(`[LLM-ERROR-PAGES] Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

        // ── Opportunity + Suggestion sync ──────────────────────────────────────
        // One Opportunity per status code bucket. One Suggestion per unique URL.
        const opportunityMap = {};

        // Pre-fetch existing NEW opportunities once so the empty-bucket retention sweep
        // can find a stale opportunity without creating one.
        const existingOpportunities = await Opportunity.allBySiteIdAndStatus(
          site.getId(), 'NEW',
        );

        for (const { code, auditType, suggestionType } of STATUS_BUCKETS) {
          const rawErrors = categorizedResults[code] || [];
          let existingSuggestions = [];

          if (rawErrors.length > 0) {
            // Group by URL: Athena returns one row per (url, user_agent) pair.
            // groupErrorsByUrl merges those into one entry per URL with summed hitCount
            // and a collected agentTypes array. Without this, duplicate buildKeys would
            // cause syncSuggestions to silently overwrite earlier rows. See JSDoc.
            const groupedErrors = groupErrorsByUrl(rawErrors);

            // Create or find the Opportunity for this status code bucket.
            const opportunity = await convertToOpportunity(
              url,
              { siteId: site.getId(), auditId: audit.getId(), id: audit.getId() },
              context,
              createOpportunityData,
              auditType,
              { statusCode: code, totalErrors: groupedErrors.length },
            );

            opportunityMap[code] = opportunity;

            // Pre-fetch suggestions once — reused by syncSuggestions (via existingSuggestions
            // param) and by the 4-week cleanup below to avoid a second DB round-trip.
            existingSuggestions = await opportunity.getSuggestions();

            // Sync current week's URLs as Suggestions.
            //
            // scrapedUrlsSet: prevents syncSuggestions from marking previous-week URLs as
            //   OUTDATED. The OUTDATED filter fires only when a Suggestion's URL is in
            //   scrapedUrlsSet AND absent from newData. Since scrapedUrlsSet === URLs in
            //   newData, that condition is never true. Old URLs stay active until the
            //   explicit 4-week cleanup below.
            //
            // mergeDataFunction: refreshes live metrics (hitCount, agentTypes, etc.) for
            //   URLs that recur across weeks while preserving Mystique-enriched fields
            //   (suggestedUrls, aiRationale, confidenceScore) set by guidance-handler.js.
            await syncSuggestions({
              opportunity,
              newData: groupedErrors,
              buildKey: (error) => `${auditType}::${error.url}`,
              context,
              log,
              existingSuggestions,
              scrapedUrlsSet: new Set(groupedErrors.map((e) => e.url)),
              mergeDataFunction: (existingData, newDataItem) => ({
                ...existingData,
                // Refresh top-level fields with current week's Athena metrics.
                // These drive rank and the 4-week retention cleanup.
                hitCount: newDataItem.hitCount,
                agentTypes: newDataItem.agentTypes,
                avgTtfb: newDataItem.avgTtfb,
                countryCode: newDataItem.countryCode,
                product: newDataItem.product,
                category: newDataItem.category,
                periodIdentifier,
                // Preserve AI-enriched fields from Mystique if already present.
                // Avoids redundant Mystique calls when the same URL reappears in a
                // later week — guidance-handler.js checks these fields before re-queuing.
                ...(existingData.suggestedUrls && { suggestedUrls: existingData.suggestedUrls }),
                ...(existingData.aiRationale && { aiRationale: existingData.aiRationale }),
                ...(existingData.confidenceScore !== undefined && {
                  confidenceScore: existingData.confidenceScore,
                }),
              }),
              mapNewSuggestion: (error) => ({
                opportunityId: opportunity.getId(),
                type: suggestionType,
                rank: error.hitCount,
                data: {
                  url: error.url,
                  httpStatus: error.httpStatus,
                  agentTypes: error.agentTypes,
                  hitCount: error.hitCount,
                  avgTtfb: error.avgTtfb,
                  countryCode: error.countryCode,
                  product: error.product,
                  category: error.category,
                  periodIdentifier,
                },
              }),
            });
          } else {
            log.info(`[LLM-ERROR-PAGES] No ${code} errors for ${periodIdentifier}, skipping sync`);
            // Still run retention: find the existing opportunity (if any) so stale
            // suggestions age out even when a bucket produces zero errors this week.
            const staleOpportunity = existingOpportunities.find((o) => o.getType() === auditType);
            if (staleOpportunity) {
              opportunityMap[code] = staleOpportunity;
              existingSuggestions = await staleOpportunity.getSuggestions();
            }
          }

          // 4-week retention cleanup: runs regardless of whether new errors exist this
          // week. Marks OUTDATED any suggestion whose URL has not been seen within the
          // last RETENTION_WEEKS weeks so stale entries don't accumulate indefinitely.
          const toOutdate = existingSuggestions.filter((s) => {
            const lastSeen = s.getData()?.periodIdentifier;
            if (!lastSeen) {
              return false; // no timestamp → skip (old data, handled separately)
            }
            const status = s.getStatus();
            if (['OUTDATED', 'FIXED', 'RESOLVED', 'REJECTED', 'APPROVED'].includes(status)) {
              return false;
            }
            return parsePeriodIdentifier(lastSeen) < retentionCutoff;
          });

          if (toOutdate.length > 0) {
            await Suggestion.bulkUpdateStatus(toOutdate, 'OUTDATED');
            log.info(`[LLM-ERROR-PAGES] Outdated ${toOutdate.length} stale suggestions for ${auditType} (older than ${RETENTION_WEEKS} weeks)`);
          }
        }

        // ── Send 404s to Mystique for AI guidance ──────────────────────────────
        if (sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
          const errors404 = categorizedResults[404] || [];

          if (errors404.length > 0) {
            const messageBaseUrl = site.getBaseURL?.() || '';
            const consolidated404 = consolidateErrorsByUrl(errors404);
            const sorted404 = sortErrorsByTrafficVolume(consolidated404).slice(0, 50);

            let alternativeUrls = await getTopAgenticUrlsFromAthena(site, context);

            if (!alternativeUrls || alternativeUrls.length === 0) {
              log.info('[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to SEO top pages');
              const { SiteTopPage } = dataAccess;
              const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
              alternativeUrls = topPages.map((page) => page.getUrl());
            }

            const urlToUserAgentsMap = new Map();
            sorted404.forEach((errorPage) => {
              const path = toPathOnly(errorPage.url, messageBaseUrl);
              const fullUrl = messageBaseUrl ? new URL(path, messageBaseUrl).toString() : path;
              if (!urlToUserAgentsMap.has(fullUrl)) {
                urlToUserAgentsMap.set(fullUrl, new Set());
              }
              urlToUserAgentsMap.get(fullUrl).add(errorPage.userAgent);
            });

            const mystiqueMessage = {
              type: 'guidance:llm-error-pages',
              siteId: site.getId(),
              auditId: audit?.getId() || 'llm-error-pages-audit',
              deliveryType: site?.getDeliveryType?.() || 'aem_edge',
              time: new Date().toISOString(),
              data: {
                brokenLinks: Array.from(urlToUserAgentsMap.entries())
                  .map(([fullUrl, userAgents], index) => ({
                    urlFrom: Array.from(userAgents).join(', '),
                    urlTo: fullUrl,
                    suggestionId: `llm-404-suggestion-${periodIdentifier}-${index}`,
                  }))
                  .filter((link) => link.urlFrom.length > 0),
                alternativeUrls,
                opportunityId: opportunityMap[404]?.getId(),
              },
            };

            await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, mystiqueMessage);
            log.info(`[LLM-ERROR-PAGES] Sent ${urlToUserAgentsMap.size} consolidated 404 URLs to Mystique for AI processing`);
          } else {
            log.warn('[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message');
          }
        } else {
          log.warn('[LLM-ERROR-PAGES] SQS or Mystique queue not configured, skipping message');
        }

        auditResults.push({
          success: true,
          timestamp: new Date().toISOString(),
          periodIdentifier,
          dateRange: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
          database: s3Config.databaseName,
          table: s3Config.tableName,
          customer: s3Config.customerName,
          totalErrors: processedResults.totalErrors,
          summary: processedResults.summary,
          errorPages: processedResults.errorPages,
          categorizedResults,
        });
      } catch (weekError) {
        log.error(`[LLM-ERROR-PAGES] Failed for ${periodIdentifier}`, weekError);
        auditResults.push({
          success: false,
          error: weekError.message,
          periodIdentifier,
          timestamp: new Date().toISOString(),
        });
      }
    }

    return {
      type: 'audit-result',
      siteId: site.getId(),
      auditResult: auditResults,
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`[LLM-ERROR-PAGES] Audit failed: ${error.message}`, error);

    return {
      type: 'audit-result',
      siteId: site.getId(),
      auditResult: [{
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        database: s3Config?.databaseName,
        table: s3Config?.tableName,
        customer: s3Config?.customerName,
      }],
      fullAuditRef: url,
    };
  }
}
/* eslint-enable no-await-in-loop */

const stepAudit = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-top-pages', importTopPagesAndScrape, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-send-to-mystique', runAuditAndSendToMystique)
  .build();

const backfillAudit = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(async (_finalUrl, context, site, auditContext) => {
    const enrichedContext = { ...context, site, auditContext };
    return runAuditAndSendToMystique(enrichedContext);
  })
  .build();

export default {
  run(message, context) {
    const { auditContext = {} } = message;
    if (auditContext.weekOffset !== undefined) {
      return backfillAudit.run(message, context);
    }
    return stepAudit.run(message, context);
  },
};
