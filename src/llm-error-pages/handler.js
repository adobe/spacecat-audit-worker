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

// Separate lifecycle windows for freshness, DB purge, and history size.
const DB_RETENTION_WEEKS = 6;
export const HISTORY_RETENTION_WEEKS = 6;
const RETENTION_MS = DB_RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000;
const NEW_WINDOW_WEEKS = 4;
const NEW_WINDOW_MS = NEW_WINDOW_WEEKS * 7 * 24 * 60 * 60 * 1000;

// Limit per-week agent lists so history payloads stay bounded.
const MAX_AGENT_ENTRIES = 10;

// Statuses protected from automatic retention changes.
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

// ---------------------------------------------------------------------------
// observation:llm-broken-urls wire-format limits.
//
// These mirror the Pydantic validator in mystique PR #2490
// (`app/tasks/llm_broken_urls_ingestion_task.py`). Keep them in lockstep:
// if mystique raises or lowers a cap, mirror the change here.
// ---------------------------------------------------------------------------
const OBSERVATION_MAX_URLS = 50;
const OBSERVATION_MAX_USER_AGENTS_PER_URL = 50;
const OBSERVATION_MAX_USER_AGENT_LENGTH = 512;

// SQS standard-queue maximum payload is 256 KB (262144 bytes). Keep a
// safety margin so a worst-case-but-not-pathological message still fits
// without us hitting the hard SQS reject (which would propagate as an
// audit failure and trigger re-delivery of the inbound audit message).
const OBSERVATION_MAX_MESSAGE_BYTES = 200 * 1024;

/**
 * Builds one per-week history record for an llm-error-pages suggestion.
 */
function buildWeekHistoryEntry(item, periodIdentifier) {
  return {
    periodIdentifier,
    hitCount: item.hitCount,
    httpStatus: item.httpStatus,
    agentTypes: item.agentTypes.slice(0, MAX_AGENT_ENTRIES),
    userAgents: item.userAgents.slice(0, MAX_AGENT_ENTRIES),
    avgTtfb: item.avgTtfb,
  };
}

/**
 * Upserts, orders, and prunes per-week suggestion history.
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
 * Build and publish the `observation:llm-broken-urls` message to mystique's
 * blackboard ingestion (PR #2490 / `LlmBrokenUrlsIngestionTask`).
 *
 * Failure isolation: this is the shadow-validation publish. It MUST NOT fail
 * the audit run or trigger SQS re-delivery of the legacy
 * `guidance:llm-error-pages` message that was already sent at the call site.
 * Every thrown error is caught here and logged.
 *
 * Defence layers applied here:
 *   - per-row `try/catch` around URL parsing so one malformed Athena log row
 *     cannot abort the whole publish
 *   - origin re-anchoring guard so a protocol-relative or absolute attacker-
 *     controlled path cannot smuggle an off-origin URL into the payload
 *   - per-URL caps on user-agent count + length matching mystique limits
 *   - serialized-size budget below the SQS 256 KB hard limit
 *   - empty-array guard so we never emit a payload mystique's `min_length=1`
 *     would reject at the Pydantic boundary
 *
 * Phase 4 cutover (post-merge of mystique PR #2490 + projector PR #200):
 * remove the `if (env?.OBSERVATION_LLM_BROKEN_URLS_ENABLED === 'true')`
 * guard at the call site and delete the legacy `guidance:llm-error-pages`
 * publish block above it. This helper stays in place.
 *
 * @param {object} args
 * @param {object[]} args.sorted404      Pre-consolidated 404 rows (output of
 *                                       `consolidateErrorsByUrl` + sort).
 * @param {string}   args.messageBaseUrl Site baseURL (already verified to be
 *                                       truthy by caller).
 * @param {Date}     args.startDate      Audit window start.
 * @param {Date}     args.endDate        Audit window end.
 * @param {object}   args.site           Site model (provides id, deliveryType).
 * @param {object}  [args.audit]         Audit model (optional, provides id).
 * @param {object}   args.sqs            SQS client (provides `sendMessage`).
 * @param {object}   args.env            Process env (provides queue URL).
 * @param {object}   args.log            Logger (info/warn/error).
 */
async function publishObservationLlmBrokenUrls({
  sorted404, facetsByUrl, periodIdentifier, messageBaseUrl, startDate, endDate,
  site, audit, sqs, env, log,
}) {
  try {
    if (!messageBaseUrl) {
      log.warn('[LLM-ERROR-PAGES] No baseURL available — skipping observation:llm-broken-urls publish');
      return;
    }

    // Origin re-anchoring defence: protocol-relative (`//evil.com/x`) and
    // absolute attacker-controlled URLs (`https://evil.com/x`) are
    // neutralised by `toPathOnly`, which returns `parsed.pathname` from
    // the input URL — discarding host and scheme. So by the time we hit
    // `new URL(path, messageBaseUrl)` below, `path` is guaranteed
    // relative and the result inherits `messageBaseUrl`'s origin.
    //
    // We intentionally do NOT re-check origin here: it would be dead
    // code under the current architecture and a stale assertion if
    // `toPathOnly`'s contract ever changes. Instead, the defense is
    // pinned by a regression test in `handler.test.js` that verifies
    // off-origin inputs are stripped to the site's own origin.

    // Re-group by URL only — existing `consolidateErrorsByUrl` keys by
    // (url, provider) so the same URL appears once per provider. The
    // observation wire format wants ONE entry per URL with all providers
    // unioned.
    //
    // We intentionally do NOT wrap this loop in a per-row try/catch: the
    // legacy publish above (see `runAuditAndSendToMystique`) constructs
    // the same `new URL(path, messageBaseUrl)` and would itself throw
    // on a malformed row — so the whole week's audit would already have
    // aborted before reaching this helper. The outer try/catch on this
    // function is the failure-isolation boundary we actually need.
    const byUrl = new Map();
    sorted404.forEach((errorPage) => {
      const path = toPathOnly(errorPage.url, messageBaseUrl);
      const fullUrl = new URL(path, messageBaseUrl).toString();
      const entryHits = Number(errorPage.totalRequests) || 0;
      const entryUas = errorPage.rawUserAgents || [];
      // groupErrorsByUrl produced one facet row per URL from the SAME errors404
      // set this `sorted404` was consolidated from, keyed by the raw `url` — so
      // every sorted404 url has a facet row (agentTypes is always an array;
      // avgTtfb/category/product/countryCode may be undefined on sparse rows).
      // The `|| { agentTypes: [] }` is an unreachable-but-defensive default: if
      // consolidateErrorsByUrl and groupErrorsByUrl ever diverge, a missing
      // facet row degrades to empty facets instead of throwing a TypeError the
      // outer try/catch would swallow (silently dropping the whole publish).
      /* c8 ignore next */
      const f = facetsByUrl.get(errorPage.url) || { agentTypes: [] };
      const existing = byUrl.get(fullUrl);
      if (existing) {
        existing.hits += entryHits;
        entryUas.forEach((ua) => existing.userAgents.add(ua));
        f.agentTypes.forEach((at) => existing.agentTypes.add(at));
      } else {
        byUrl.set(fullUrl, {
          hits: entryHits,
          userAgents: new Set(entryUas),
          // Facets are URL-stable across providers/rows; first sighting seeds
          // them, agentTypes unions across rows mapping to the same full URL.
          agentTypes: new Set(f.agentTypes),
          avgTtfb: f.avgTtfb ?? '',
          category: f.category ?? '',
          product: f.product ?? null,
          countryCode: f.countryCode ?? 'GLOBAL',
        });
      }
    });

    const observationUrls = Array.from(byUrl.entries())
      .slice(0, OBSERVATION_MAX_URLS)
      .map(([fullUrl, v]) => ({
        url: fullUrl,
        hits: v.hits,
        userAgents: Array.from(v.userAgents)
          .slice(0, OBSERVATION_MAX_USER_AGENTS_PER_URL)
          .map((ua) => String(ua).slice(0, OBSERVATION_MAX_USER_AGENT_LENGTH)),
        // FIELD NAMING: `observedThrough` (not `lastSeen`).
        //
        // This value is the audit-window end — the same value for every
        // URL in a given publish — not a per-URL last-hit timestamp.
        // `observedThrough` makes that semantics explicit and avoids a
        // UI label ("Last seen: ...") that would lie to customers.
        //
        // CROSS-REPO COORDINATION: mystique PR #2490 must accept this
        // field name (either rename `last_seen` → `observed_through`
        // on the Pydantic model, or add a Pydantic alias) BEFORE the
        // OBSERVATION_LLM_BROKEN_URLS_ENABLED flag is flipped on in
        // any environment. Safe to land unilaterally here because the
        // flag is OFF by default.
        observedThrough: endDate.toISOString(),
        // CDN-log trend facets the ELMO UI renders (mystique #2490 accepts
        // these; the projector builds the weekly history[] + filters from them).
        // periodIdentifier is the same for every URL in this publish (the audit
        // week). avgTtfb is stringified to match the consumer's string field.
        periodIdentifier: periodIdentifier || '',
        agentTypes: Array.from(v.agentTypes)
          .slice(0, OBSERVATION_MAX_USER_AGENTS_PER_URL)
          .map((at) => String(at).slice(0, OBSERVATION_MAX_USER_AGENT_LENGTH)),
        avgTtfb: String(v.avgTtfb),
        category: v.category || '',
        product: v.product ?? null,
        countryCode: v.countryCode || 'GLOBAL',
      }));

    // NOTE: `observationUrls` is guaranteed non-empty here.
    // The legacy publish above this helper only runs when
    // `errors404.length > 0`, and `byUrl` is keyed by URL — so
    // `byUrl.size >= 1` whenever the helper is invoked, which means
    // `observationUrls.length >= 1`. Mystique's `min_length=1` Pydantic
    // constraint is therefore upheld structurally and we do not add a
    // redundant guard here. If the upstream guard is ever removed, the
    // Pydantic boundary will reject and surface via SQS DLQ.

    const observationMessage = {
      type: 'observation:llm-broken-urls',
      siteId: site.getId(),
      auditId: audit?.getId() || null,
      baseURL: messageBaseUrl,
      deliveryType: site?.getDeliveryType?.() || null,
      time: new Date().toISOString(),
      data: {
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        urls: observationUrls,
      },
    };

    // SQS standard-queue maximum is 256 KB. Stay under our safety budget
    // — if a hostile log record blows past it, skip the publish with a
    // warn rather than throw and fail the audit.
    const serialized = JSON.stringify(observationMessage);
    if (serialized.length > OBSERVATION_MAX_MESSAGE_BYTES) {
      log.warn(`[LLM-ERROR-PAGES] observation:llm-broken-urls payload size ${serialized.length} bytes exceeds budget ${OBSERVATION_MAX_MESSAGE_BYTES}; skipping publish (siteId=${site.getId()}, urls=${observationUrls.length})`);
      return;
    }

    await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, observationMessage);
    log.info(`[LLM-ERROR-PAGES] Sent observation:llm-broken-urls with ${observationUrls.length} URLs to Mystique blackboard`);
  } catch (err) {
    // Shadow-validation publish must never affect the legacy path or
    // trigger SQS re-delivery of the audit message. Log and swallow.
    log.error(`[LLM-ERROR-PAGES] Failed to publish observation:llm-broken-urls (shadow path); legacy message already sent. siteId=${site?.getId?.()} err=${err?.message}`);
  }
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
                  // Keep top-level fields as latest snapshot and history as trend.
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

            // Skip backfill sweeps; otherwise age only system-managed stale suggestions.
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

            // Phase 3 dual-publish: also emit the new observation:llm-broken-urls
            // message that feeds the Mysticat blackboard cascade in mystique
            // (LlmBrokenUrlsIngestionTask → o_llm_broken_urls → verifier →
            // alternatives → projector). The legacy guidance:llm-error-pages
            // message above continues to feed the old crew flow during shadow
            // validation; Phase 4 cutover removes that block.
            //
            // Feature-flagged so this PR can land safely before mystique's
            // ingestion dispatcher (PR #2490) and projector (PR #200) merge.
            // With the flag off, behaviour is unchanged.
            //
            // All defence/observability logic lives in the helper. Phase 4
            // cutover = delete the legacy publish above AND this flag check;
            // the helper call stays.
            if (env?.OBSERVATION_LLM_BROKEN_URLS_ENABLED === 'true') {
              // Per-URL CDN-log facets (agentTypes / avgTtfb / category /
              // product / countryCode) the ELMO UI renders. groupErrorsByUrl
              // collapses the raw rows to one entry per URL with these facets;
              // keyed by the raw `url` so the helper can look them up while it
              // re-groups sorted404 into the observation wire shape.
              const facetsByUrl = new Map(
                groupErrorsByUrl(errors404).map((r) => [r.url, r]),
              );
              await publishObservationLlmBrokenUrls({
                sorted404,
                facetsByUrl,
                periodIdentifier,
                messageBaseUrl,
                startDate,
                endDate,
                site,
                audit,
                sqs,
                env,
                log,
              });
            }
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
