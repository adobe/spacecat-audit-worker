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
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import {
  getS3Config,
  generateReportingPeriods,
  buildSiteFilters,
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
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

    if (topPages.length === 0) {
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

    log.info(`[LLM-ERROR-PAGES] Found ${topPages.length} top pages for site ${site.getId()}`);

    return {
      type: 'top-pages',
      siteId: site.getId(),
      auditResult: {
        success: true,
        topPages: topPages.map((page) => page.getUrl()),
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
 * Step 3: Run audit, generate Excel reports, and send to Mystique
 */
export async function runAuditAndSendToMystique(context) {
  const { log, site } = context;
  const s3Config = await getS3Config(site, context);
  const url = site.getBaseURL();

  log.info(`[LLM-ERROR-PAGES] Starting audit for ${url}`);

  try {
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

    const week = generateReportingPeriods().weeks[0];
    const { startDate, endDate } = week;
    const periodIdentifier = `w${week.weekNumber}-${week.year}`;
    log.info(`[LLM-ERROR-PAGES] Running weekly audit for ${periodIdentifier}`);

    // Get site configuration
    const filters = site.getConfig()?.getLlmoCdnlogsFilter?.() || [];
    const siteFilters = buildSiteFilters(filters, site);

    // Build and execute query
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

    // Process results
    const processedResults = processErrorPagesResults(results);
    const categorizedResults = categorizeErrorsByStatusCode(processedResults.errorPages);

    // Prepare SharePoint client and output location
    const sharepointClient = await createLLMOSharepointClient(context);
    const llmoFolder = site.getConfig()?.getLlmoDataFolder?.() || s3Config.customerName;
    const outputLocation = `${llmoFolder}/agentic-traffic`;

    const buildFilename = (code) => `agentictraffic-errors-${code}-${periodIdentifier}.xlsx`;

    const writeCategoryExcel = async (code, errors) => {
      if (!errors || errors.length === 0) return;

      /* c8 ignore next */
      const sorted = [...errors].sort((a, b) => (b.total_requests || 0) - (a.total_requests || 0));

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
          e.country_code ?? '',
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

    // Generate and upload Excel files for each category
    await Promise.all([
      writeCategoryExcel('404', categorizedResults[404]?.slice(0, 50)),
      writeCategoryExcel('403', categorizedResults[403]),
      writeCategoryExcel('5xx', categorizedResults['5xx']),
    ]);

    log.info(`[LLM-ERROR-PAGES] Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

    // Send to Mystique if configured
    const {
      dataAccess, sqs, env, audit,
    } = context;
    const { SiteTopPage } = dataAccess;

    if (sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
      const errors404 = categorizedResults[404] || [];

      if (errors404.length > 0) {
        const messageBaseUrl = site.getBaseURL?.() || '';
        const consolidated404 = consolidateErrorsByUrl(errors404);
        const sorted404 = sortErrorsByTrafficVolume(consolidated404).slice(0, 50);
        const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

        // Consolidate by URL and combine user agents
        const urlToUserAgentsMap = new Map();
        sorted404.forEach((errorPage) => {
          const path = toPathOnly(errorPage.url, messageBaseUrl);
          const fullUrl = messageBaseUrl ? new URL(path, messageBaseUrl).toString() : path;
          if (!urlToUserAgentsMap.has(fullUrl)) {
            urlToUserAgentsMap.set(fullUrl, new Set());
          }
          urlToUserAgentsMap.get(fullUrl).add(errorPage.userAgent);
        });

        const message = {
          type: 'guidance:llm-error-pages',
          siteId: site.getId(),
          auditId: audit.getId() || 'llm-error-pages-audit',
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
            alternativeUrls: topPages.map((topPage) => topPage.getUrl()),
            opportunityId: `llm-404-${periodIdentifier}`,
          },
        };

        await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
        log.info(`[LLM-ERROR-PAGES] Sent ${urlToUserAgentsMap.size} consolidated 404 URLs to Mystique for AI processing`);
      } else {
        log.warn('[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message');
      }
    } else {
      log.warn('[LLM-ERROR-PAGES] SQS or Mystique queue not configured, skipping message');
    }

    return {
      type: 'audit-result',
      siteId: site.getId(),
      auditResult: {
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
      },
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`[LLM-ERROR-PAGES] Audit failed: ${error.message}`, error);

    return {
      type: 'audit-result',
      siteId: site.getId(),
      auditResult: {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        database: s3Config?.databaseName,
        table: s3Config?.tableName,
        customer: s3Config?.customerName,
      },
      fullAuditRef: url,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .addStep('import-top-pages', importTopPagesAndScrape, AUDIT_STEP_DESTINATIONS.IMPORT_WORKER)
  .addStep('submit-for-scraping', submitForScraping, AUDIT_STEP_DESTINATIONS.SCRAPE_CLIENT)
  .addStep('run-audit-and-send-to-mystique', runAuditAndSendToMystique)
  .build();
