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
  SPREADSHEET_COLUMNS,
  toPathOnly,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';
import { validateCountryCode } from '../cdn-logs-report/utils/report-utils.js';
import { buildSiteFilters, getS3Config, getCdnAwsRuntime } from '../utils/cdn-utils.js';
import { getTopAgenticUrlsFromAthena } from '../utils/agentic-urls.js';

const { AUDIT_STEP_DESTINATIONS } = Audit;

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

    // Fallback to Ahrefs if Athena returns no data
    if (!topPageUrls || topPageUrls.length === 0) {
      log.info('[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to Ahrefs');
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
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

  const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

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
    const llmoFolder = site.getConfig()?.getLlmoDataFolder?.() || s3Config.customerName;
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
          if (!errors || errors.length === 0) return;

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

        await Promise.all([
          writeCategoryExcel('404', categorizedResults[404]?.slice(0, 50)),
          writeCategoryExcel('403', categorizedResults[403]),
          writeCategoryExcel('5xx', categorizedResults['5xx']),
        ]);

        log.info(`[LLM-ERROR-PAGES] Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

        if (sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
          const errors404 = categorizedResults[404] || [];

          if (errors404.length > 0) {
            const messageBaseUrl = site.getBaseURL?.() || '';
            const consolidated404 = consolidateErrorsByUrl(errors404);
            const sorted404 = sortErrorsByTrafficVolume(consolidated404).slice(0, 50);

            let alternativeUrls = await getTopAgenticUrlsFromAthena(site, context);

            if (!alternativeUrls || alternativeUrls.length === 0) {
              log.info('[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to Ahrefs');
              const { SiteTopPage } = dataAccess;
              const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');
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
                opportunityId: `llm-404-${periodIdentifier}`,
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
