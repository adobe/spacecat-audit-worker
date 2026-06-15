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

import ExcelJS from 'exceljs';
import { Audit, Opportunity as Oppty, Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
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
  SPREADSHEET_COLUMNS,
  toPathOnly,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';
import { validateCountryCode } from '../cdn-logs-report/utils/report-utils.js';
import { buildSiteFilters, getS3Config, getCdnAwsRuntime } from '../utils/cdn-utils.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';
import { convertToOpportunity } from '../common/opportunity.js';
import { syncSuggestions } from '../utils/data-access.js';
import { createOpportunityData } from './opportunity-data-mapper.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

const STATUS_BUCKETS = [
  { code: 404, auditType: 'llm-error-pages-404', suggestionType: 'REDIRECT_UPDATE' },
  { code: 403, auditType: 'llm-error-pages-403', suggestionType: 'CODE_CHANGE' },
  { code: '5xx', auditType: 'llm-error-pages-5xx', suggestionType: 'CODE_CHANGE' },
];

// Suggestion lifecycle by last-seen recency (3-tier):
//   ≤ NEW_WINDOW_WEEKS        → stays NEW (fresh issue)
//   NEW_WINDOW..RETENTION     → flipped to OUTDATED (kept + in history, not fresh)
//   > DB_RETENTION_WEEKS      → deleted (removeByIds), system-managed states only
// A URL seen in the current run is always kept (and reappearing OUTDATED ones
// transition back to NEW via syncSuggestions' defaultMergeStatusFunction).
//
// Three independent knobs that happen to share a value today — keep them
// separate so bumping one (e.g. a longer trend) doesn't silently change the
// others (DB purge window, or the per-suggestion JSON payload size).
const DB_RETENTION_WEEKS = 6; // hard-delete + OUTDATED-window ceiling
export const HISTORY_RETENTION_WEEKS = 6; // max weeks kept in data.history[]
const RETENTION_MS = DB_RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000;
const NEW_WINDOW_WEEKS = 4;
const NEW_WINDOW_MS = NEW_WINDOW_WEEKS * 7 * 24 * 60 * 60 * 1000;

// Cap on agent/user-agent arrays stored per week in data.history[]. A UA-rotating
// bot produces an unbounded list; retaining it for HISTORY_RETENTION_WEEKS would
// multiply the suggestion JSON blob and widen the window for inadvertent PII
// retention in a UI-exposed field. Top-N by insertion order is enough for the UI.
const MAX_AGENT_ENTRIES = 10;

// Customer-actioned / in-flight statuses the retention sweep must never touch —
// neither hard-delete (FIXED is an audit trail of remediation) nor auto-OUTDATE.
// Only system-managed NEW/OUTDATED rows age out. Sourced from the canonical enum
// so it stays correct if STATUSES change.
const PROTECTED_SWEEP_STATUSES = new Set([
  SuggestionModel.STATUSES.FIXED,
  SuggestionModel.STATUSES.APPROVED,
  SuggestionModel.STATUSES.REJECTED,
  SuggestionModel.STATUSES.SKIPPED,
  SuggestionModel.STATUSES.ERROR,
  SuggestionModel.STATUSES.IN_PROGRESS,
  SuggestionModel.STATUSES.PENDING_VALIDATION,
]);

const TOP_404_LIMIT = 50;

/**
 * Builds one per-week history record for an llm-error-pages suggestion.
 *
 * The top-level suggestion `data` fields stay a "latest week" snapshot (so
 * the existing UI keeps reading `hitCount`/`agentTypes`/… unchanged); this
 * record captures the same metrics scoped to a single audit week so we can
 * reconstruct week-over-week trend (TTFB drift, hit-count trajectory,
 * which LLM bots discovered the URL when).
 *
 * @param {object} item       A grouped-error row for the URL this week.
 * @param {string} periodIdentifier ISO week id (e.g. `w24-2026`).
 * @returns {object} The per-week record stored in `data.history[]`.
 */
function buildWeekHistoryEntry(item, periodIdentifier) {
  return {
    periodIdentifier,
    hitCount: item.hitCount,
    httpStatus: item.httpStatus,
    // Capped (see MAX_AGENT_ENTRIES) — these are retained per week, not just on
    // the latest-week snapshot, so an unbounded array would bloat the blob 6×.
    // groupErrorsByUrl always yields arrays (matches the unguarded access in
    // mergeDataFunction above), so slice directly — no nullish fallback needed.
    agentTypes: item.agentTypes.slice(0, MAX_AGENT_ENTRIES),
    userAgents: item.userAgents.slice(0, MAX_AGENT_ENTRIES),
    avgTtfb: item.avgTtfb,
  };
}

/**
 * Merges this week's history record into a suggestion's existing
 * `data.history[]`, then orders + prunes it.
 *
 * - Keyed by `periodIdentifier`: re-running the SAME week (the Monday
 *   two-week loop, or a manual backfill) REPLACES that week's record
 *   rather than appending a duplicate — the merge is idempotent.
 * - Ordered oldest-first by ISO week so consumers can render a trend
 *   left-to-right without re-sorting.
 * - Pruned to the most recent `RETENTION_WEEKS` so the array can't grow
 *   unbounded as a URL stays broken for months. Matches the audit's
 *   existing `RETENTION_WEEKS` retention window.
 *
 * @param {Array<object>} [existingHistory] Prior history (may be undefined).
 * @param {object} weekEntry The current week's record (carries periodIdentifier).
 * @returns {Array<object>} Merged, ordered, pruned history (oldest-first).
 */
export function upsertWeekHistory(existingHistory, weekEntry) {
  const byPeriod = new Map();
  (Array.isArray(existingHistory) ? existingHistory : []).forEach((entry) => {
    if (entry?.periodIdentifier) {
      byPeriod.set(entry.periodIdentifier, entry);
    }
  });
  byPeriod.set(weekEntry.periodIdentifier, weekEntry);

  return Array.from(byPeriod.values())
    .sort((a, b) => parsePeriodIdentifier(a.periodIdentifier).getTime()
      - parsePeriodIdentifier(b.periodIdentifier).getTime())
    .slice(-HISTORY_RETENTION_WEEKS);
}

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
 * Step 3: Run audit, generate Excel reports, and send to Mystique.
 * Supports multiple weeks via auditContext.weekOffset for backfill.
 */
/* eslint-disable no-await-in-loop */
export async function runAuditAndSendToMystique(context) {
  const { log, site } = context;
  const s3Config = getS3Config(site, context);
  const url = site.getBaseURL();

  log.info(`[LLM-ERROR-PAGES] Starting audit for ${url}`);

  try {
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
    const sharepointClient = await createLLMOSharepointClient(context);
    const llmoFolder = site.getConfig()?.getLlmoDataFolder?.() || s3Config.siteName;
    const outputLocation = `${llmoFolder}/agentic-traffic`;
    const {
      dataAccess, sqs, env, audit,
    } = context;

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
          context,
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

        // Malformed URLs (e.g. '/brandshttps://...', '/),') are dropped inside
        // processErrorPagesResults so every downstream view stays consistent.
        // Log a sample so false positives are diagnosable from Coralogix.
        if (processedResults.droppedUrls?.length > 0) {
          const sample = processedResults.droppedUrls.slice(0, 5);
          log.info(`[LLM-ERROR-PAGES] Filtered ${processedResults.droppedUrls.length} malformed URL(s); sample: ${JSON.stringify(sample)}`);
        }

        const buildFilename = (code) => `agentictraffic-errors-${code}-${periodIdentifier}.xlsx`;

        const writeCategoryExcel = async (code, errors) => {
          if (!errors || errors.length === 0) {
            return;
          }

          /* c8 ignore next 2 */
          const sorted = [...errors].sort(
            (a, b) => (b.total_requests || 0) - (a.total_requests || 0),
          );

          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet('data');
          sheet.addRow(SPREADSHEET_COLUMNS);

          sorted.forEach((e) => {
            sheet.addRow([
              e.agent_type || '',
              e.user_agent || '',
              e.total_requests || 0,
              e.avg_ttfb_ms ?? '',
              /* c8 ignore next */
              validateCountryCode(e.country_code),
              /* c8 ignore next */
              e.url || '',
              e.product || '',
              e.category || '',
              '',
              '',
              '',
            ]);
          });

          const filename = buildFilename(code);
          await saveExcelReport({
            workbook,
            outputLocation,
            log,
            sharepointClient,
            filename,
          });
          log.info(`[LLM-ERROR-PAGES] Uploaded Excel for ${code}: ${filename} (${sorted.length} rows)`);
        };

        try {
          await Promise.all([
            writeCategoryExcel('404', categorizedResults[404]?.slice(0, TOP_404_LIMIT)),
            writeCategoryExcel('403', categorizedResults[403]),
            writeCategoryExcel('5xx', categorizedResults['5xx']),
          ]);
        } catch (excelError) {
          log.error('[LLM-ERROR-PAGES] Excel write failed', {
            err: excelError.message,
            stack: excelError.stack,
            siteId: site.getId(),
            periodIdentifier,
          });
        }

        log.info(`[LLM-ERROR-PAGES] Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

        const opportunityMap = {};
        const { Suggestion, Opportunity } = dataAccess;
        const deleteCutoff = new Date(Date.now() - RETENTION_MS);
        const outdatedCutoff = new Date(Date.now() - NEW_WINDOW_MS);
        let existingOpportunities = [];
        try {
          existingOpportunities = await Opportunity.allBySiteIdAndStatus(site.getId(), 'NEW');
        } catch (preFetchError) {
          log.error('[LLM-ERROR-PAGES] Failed to pre-fetch opportunities', {
            err: preFetchError.message,
            stack: preFetchError.stack,
            siteId: site.getId(),
            periodIdentifier,
          });
        }

        await Promise.allSettled(STATUS_BUCKETS.map(async ({ code, auditType, suggestionType }) => {
          try {
            const rawAll = categorizedResults[code] || [];
            const rawErrors = code === 404 ? rawAll.slice(0, TOP_404_LIMIT) : rawAll;
            let existingSuggestions = [];
            let scrapedUrls = new Set();

            if (rawErrors.length > 0) {
              const groupedErrors = groupErrorsByUrl(rawErrors);
              scrapedUrls = new Set(groupedErrors.map((e) => e.url));

              const opportunity = await convertToOpportunity(
                url,
                { siteId: site.getId(), auditId: audit.getId(), id: audit.getId() },
                context,
                createOpportunityData,
                auditType,
                { statusCode: code, totalErrors: groupedErrors.length },
              );

              opportunityMap[code] = opportunity;

              // Temporary: hide newly-created Opps from the UI until it is updated to
              // recognise the bucket-specific opportunity types (`llm-error-pages-404`,
              // `-403`, `-5xx`). The existing Excel/SharePoint view is unaffected. Once
              // the UI ships support for these types, drop this block and bulk-flip any
              // accumulated IGNORED rows back to NEW.
              if (opportunity.getStatus() === Oppty.STATUSES.NEW) {
                opportunity.setStatus(Oppty.STATUSES.IGNORED);
                opportunity.setUpdatedBy('system');
                await opportunity.save();
                log.info(`[LLM-ERROR-PAGES] Marked new opportunity ${opportunity.getId()} as IGNORED (auditType=${auditType}) pending UI support`);
              }

              existingSuggestions = await opportunity.getSuggestions();

              await syncSuggestions({
                opportunity,
                newData: groupedErrors,
                buildKey: (error) => `${auditType}::${error.url}`,
                context,
                log,
                existingSuggestions,
                scrapedUrlsSet: scrapedUrls,
                mergeDataFunction: (existingData, newDataItem) => ({
                  ...existingData,
                  hitCount: newDataItem.hitCount,
                  agentTypes: newDataItem.agentTypes,
                  userAgents: newDataItem.userAgents,
                  avgTtfb: newDataItem.avgTtfb,
                  countryCode: newDataItem.countryCode,
                  product: newDataItem.product,
                  category: newDataItem.category,
                  periodIdentifier,
                  // Append this week to the per-week trend; idempotent + pruned
                  // to RETENTION_WEEKS (see upsertWeekHistory). Top-level fields
                  // above remain the latest-week snapshot for the existing UI.
                  history: upsertWeekHistory(
                    existingData.history,
                    buildWeekHistoryEntry(newDataItem, periodIdentifier),
                  ),
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
                    userAgents: error.userAgents,
                    hitCount: error.hitCount,
                    avgTtfb: error.avgTtfb,
                    countryCode: error.countryCode,
                    product: error.product,
                    category: error.category,
                    periodIdentifier,
                    // Seed the per-week trend with this URL's first sighting.
                    history: [buildWeekHistoryEntry(error, periodIdentifier)],
                  },
                }),
              });
            } else {
              const stale = existingOpportunities.find((o) => o.getType() === auditType);
              if (stale) {
                opportunityMap[code] = stale;
                existingSuggestions = await stale.getSuggestions();
              }
            }

            // 3-tier retention by last-seen recency (see constants block):
            //   > DB_RETENTION_WEEKS  → delete (removeByIds)
            //   NEW_WINDOW..RETENTION → mark OUTDATED (kept, no longer fresh)
            //   ≤ NEW_WINDOW_WEEKS    → leave as-is (stays NEW)
            // Guards (skip → no delete, no outdate):
            //   - URL present in this run (fresh; syncSuggestions returns it to NEW)
            //   - no periodIdentifier (age unknowable)
            //   - UNPARSEABLE periodIdentifier — parsePeriodIdentifier returns
            //     epoch(0) on a format mismatch (e.g. 'w5-2026', '2026-W15'),
            //     which is < every cutoff and would otherwise be silently
            //     hard-purged with no recovery. Same "age unknowable" treatment.
            //   - customer-actioned / in-flight status (PROTECTED_SWEEP_STATUSES):
            //     never delete (FIXED is an audit trail) nor auto-OUTDATE.
            // Only system-managed NEW/OUTDATED rows age out; OUTDATE flips NEW only.
            //
            // Backfill (auditContext.weekOffset set) runs the Athena query for a
            // HISTORICAL week, so scrapedUrls only holds that week's URLs and the
            // wall-clock cutoffs would mis-classify current suggestions. Skip the
            // sweep entirely in backfill mode.
            const isBackfill = context.auditContext?.weekOffset !== undefined;
            const toDelete = [];
            const toOutdate = [];
            if (!isBackfill) {
              existingSuggestions.forEach((s) => {
                const data = s.getData() || {};
                if (scrapedUrls.has(data.url)) {
                  return;
                }
                const lastSeen = data.periodIdentifier;
                if (!lastSeen) {
                  return;
                }
                if (PROTECTED_SWEEP_STATUSES.has(s.getStatus())) {
                  return;
                }
                const seenAt = parsePeriodIdentifier(lastSeen);
                if (seenAt.getTime() === 0) {
                  log.warn(`[LLM-ERROR-PAGES] Skipping suggestion ${s.getId()} with unparseable periodIdentifier: "${lastSeen}" for ${auditType}`);
                  return;
                }
                const isNew = s.getStatus() === SuggestionModel.STATUSES.NEW;
                if (seenAt < deleteCutoff) {
                  toDelete.push(s);
                } else if (seenAt < outdatedCutoff && isNew) {
                  toOutdate.push(s);
                }
              });
            }

            if (toDelete.length > 0) {
              await Suggestion.removeByIds(toDelete.map((s) => s.getId()));
              log.info(`[LLM-ERROR-PAGES] Deleted ${toDelete.length} suggestions older than ${DB_RETENTION_WEEKS} weeks for ${auditType}`);
            }
            if (toOutdate.length > 0) {
              await Suggestion.bulkUpdateStatus(toOutdate, 'OUTDATED');
              log.info(`[LLM-ERROR-PAGES] Marked ${toOutdate.length} suggestions OUTDATED (last seen ${NEW_WINDOW_WEEKS}-${DB_RETENTION_WEEKS} weeks ago) for ${auditType}`);
            }
          } catch (bucketError) {
            log.error('[LLM-ERROR-PAGES] DB sync failed for bucket', {
              err: bucketError.message,
              stack: bucketError.stack,
              siteId: site.getId(),
              bucket: code,
              auditType,
              periodIdentifier,
            });
          }
        }));

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
          customer: s3Config.siteName,
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
        customer: s3Config?.siteName,
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

// RunnerAudit's processAuditResult persists the Audit record AFTER the runner
// returns, but runAuditAndSendToMystique needs context.audit DURING its run:
// convertToOpportunity reads audit.getId() to wire up Opportunity/Suggestion
// records, and the Mystique message includes auditId so the guidance callback
// can later locate the audit and write AI suggestions back into the SharePoint
// xlsx. Without a real audit in context the bucket sync throws (silently, per
// its try/catch) and Mystique gets a placeholder auditId that the guidance
// handler cannot resolve, so backfilled weeks end up with no DB suggestions
// and no AI columns in the xlsx. Pre-create the Audit row here, then override
// the persister to update-and-return that same row so we end up with exactly
// one Audit per backfill week (not a duplicate from processAuditResult).
const backfillAudit = new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(async (_finalUrl, context, site, auditContext) => {
    const { dataAccess } = context;
    const audit = await dataAccess.Audit.create({
      siteId: site.getId(),
      isLive: site.getIsLive(),
      auditedAt: new Date().toISOString(),
      auditType: 'llm-error-pages',
      auditResult: { backfill: true, weekOffset: auditContext.weekOffset },
      fullAuditRef: site.getBaseURL(),
    });
    // Mutate context directly so the persister (which receives the original context,
    // not enrichedContext) can access the pre-created audit row.
    context.audit = audit;
    const enrichedContext = {
      ...context, site, auditContext, audit,
    };
    return runAuditAndSendToMystique(enrichedContext);
  })
  .withPersister(async (auditData, context) => {
    const { audit } = context;
    if (audit && typeof audit.setAuditResult === 'function' && auditData?.auditResult) {
      audit.setAuditResult(auditData.auditResult);
      await audit.save();
    }
    return audit;
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
