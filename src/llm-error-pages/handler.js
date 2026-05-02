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

const RETENTION_WEEKS = 4;
const RETENTION_MS = RETENTION_WEEKS * 7 * 24 * 60 * 60 * 1000;

// Top-N cap applied to 404s on both Excel and DB write paths.
const TOP_404_LIMIT = 50;

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

        // DB Opportunity + Suggestion sync — each bucket runs independently
        // (Promise.allSettled) so a failure in one bucket cannot block the
        // retention sweep or sync for the other two.
        const opportunityMap = {};
        const { Suggestion, Opportunity } = dataAccess;
        const retentionCutoff = new Date(Date.now() - RETENTION_MS);
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
            // 404 bucket is capped at TOP_404_LIMIT on both Excel and DB paths.
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

            // Retention sweep: skip URLs synced this run (defensive — syncSuggestions
            // mutates existingSuggestions in-place, but this guard keeps the filter
            // correct even if that contract changes).
            const toOutdate = existingSuggestions.filter((s) => {
              const data = s.getData() || {};
              if (scrapedUrls.has(data.url)) {
                return false;
              }
              const lastSeen = data.periodIdentifier;
              if (!lastSeen) {
                return false;
              }
              const status = s.getStatus();
              if (['OUTDATED', 'FIXED', 'RESOLVED', 'REJECTED', 'APPROVED'].includes(status)) {
                return false;
              }
              return parsePeriodIdentifier(lastSeen) < retentionCutoff;
            });

            if (toOutdate.length > 0) {
              await Suggestion.bulkUpdateStatus(toOutdate, 'OUTDATED');
              log.info(`[LLM-ERROR-PAGES] Outdated ${toOutdate.length} stale suggestions for ${auditType}`);
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
