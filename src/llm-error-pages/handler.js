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
  toPathOnly,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';
import { createLLMOSharepointClient, saveExcelReport } from '../utils/report-uploader.js';

async function runLlmErrorPagesAudit(url, context, site) {
  const {
    log, audit, sqs, env, dataAccess,
  } = context;
  const s3Config = getS3Config(site);

  log.info(`Starting LLM error pages audit for ${url}`);

  try {
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

    const week = generateReportingPeriods().weeks[0];
    const { startDate } = week;
    const { endDate } = week;
    const periodIdentifier = `w${week.weekNumber}-${week.year}`;
    log.info(`Running weekly audit for ${periodIdentifier}`);

    // Get site configuration
    const cdnLogsConfig = site.getConfig()?.getCdnLogsConfig?.() || {};
    const { filters } = cdnLogsConfig;
    const siteFilters = buildSiteFilters(filters);

    // Build and execute query
    const query = await buildLlmErrorPagesQuery({
      databaseName: s3Config.databaseName,
      tableName: s3Config.tableName,
      startDate,
      endDate,
      llmProviders: getAllLlmProviders(), // Query all LLM providers
      siteFilters,
    });

    log.info('Executing LLM error pages query...');
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

    const baseUrl = site.getBaseURL?.() || 'https://example.com';

    const buildFilename = (code) => `agentictraffic-${periodIdentifier}-${code}-ui.xlsx`;

    const writeCategoryExcel = async (code, errors) => {
      if (!errors || errors.length === 0) return;
      const consolidated = consolidateErrorsByUrl(errors);
      const sorted = sortErrorsByTrafficVolume(consolidated);

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('data');
      sheet.addRow(['User Agent', 'URL', 'Suggested URLs', 'AI Rationale', 'Confidence score']);
      sorted.forEach((e) => {
        sheet.addRow([
          e.userAgent,
          toPathOnly(e.url, baseUrl),
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
      log.info(`Uploaded Excel for ${code}: ${filename} (${sorted.length} rows)`);
    };

    // Generate and upload Excel files for each category
    await Promise.all([
      writeCategoryExcel('404', categorizedResults[404]),
      writeCategoryExcel('403', categorizedResults[403]),
      writeCategoryExcel('5xx', categorizedResults['5xx']),
    ]);

    // Send SQS message to Mystique for 404 errors only (no DB dependencies)
    const errors404 = categorizedResults[404] || [];
    if (errors404.length > 0 && sqs && env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
      const messageBaseUrl = site.getBaseURL?.() || '';
      const consolidated404 = consolidateErrorsByUrl(errors404);
      const sorted404 = sortErrorsByTrafficVolume(consolidated404);
      const { SiteTopPage } = dataAccess;
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'ahrefs', 'global');

      // Consolidate by URL and combine user agents
      const urlToUserAgentsMap = new Map();
      sorted404.forEach((errorPage) => {
        const fullUrl = messageBaseUrl ? `${messageBaseUrl}${errorPage.url}` : errorPage.url;
        if (!urlToUserAgentsMap.has(fullUrl)) {
          urlToUserAgentsMap.set(fullUrl, new Set());
        }
        urlToUserAgentsMap.get(fullUrl).add(errorPage.userAgent);
      });

      const message = {
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
          alternativeUrls: topPages.map((topPage) => topPage.getUrl()),
          opportunityId: `llm-404-${periodIdentifier}`,
        },
      };

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
      log.info(`Queued ${urlToUserAgentsMap.size} consolidated 404 URLs to Mystique for AI processing`);
    }

    log.info(`Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

    const auditResult = {
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
    };

    return {
      auditResult,
      fullAuditRef: url,
    };
  } catch (error) {
    log.error(`LLM error pages audit failed: ${error.message}`);

    return {
      auditResult: {
        success: false,
        timestamp: new Date().toISOString(),
        error: error.message,
        database: s3Config.databaseName,
        table: s3Config.tableName,
        customer: s3Config.customerName,
      },
      fullAuditRef: url,
    };
  }
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runLlmErrorPagesAudit)
  .build();
