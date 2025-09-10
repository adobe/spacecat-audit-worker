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
import { createLLMOSharepointClient, saveExcelReport, readFromSharePoint } from '../utils/report-uploader.js';

/**
 * Downloads and parses existing CDN agentic traffic sheet
 * @param {string} periodIdentifier - The period identifier (e.g., 'w35-2025')
 * @param {string} outputLocation - SharePoint folder location
 * @param {Object} sharepointClient - SharePoint client instance
 * @param {Object} log - Logger instance
 * @returns {Promise<Array>} - Array of CDN data rows
 */
async function downloadExistingCdnSheet(periodIdentifier, outputLocation, sharepointClient, log) {
  try {
    const filename = `agentictraffic-${periodIdentifier}.xlsx`;
    log.info(`Attempting to download existing CDN sheet: ${filename}`);

    const buffer = await readFromSharePoint(filename, outputLocation, sharepointClient, log);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const worksheet = workbook.worksheets[0]; // First sheet
    const rows = [];

    // Skip header row, start from row 2
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const { values } = row;
      // Map to expected structure based on CDN sheet format
      // Allow null values to pass through - fallbacks will be handled in Excel generation
      rows.push({
        agent_type: values[1],
        user_agent_display: values[2],
        status: values[3],
        number_of_hits: Number(values[4]) || 0,
        avg_ttfb_ms: Number(values[5]) || 0,
        country_code: values[6],
        url: values[7],
        product: values[8],
        category: values[9],
      });
    });

    log.info(`Successfully loaded ${rows.length} rows from existing CDN sheet`);
    return rows;
  } catch (error) {
    log.warn(`Could not download existing CDN sheet: ${error.message}`);
    return null;
  }
}

/**
 * Matches error data with existing CDN data and enriches it
 * @param {Array} errors - Error data from Athena
 * @param {Array} cdnData - Existing CDN data from sheet
 * @param {string} baseUrl - Base URL for path conversion
 * @returns {Array} - Enriched error data with CDN fields
 */
function matchErrorsWithCdnData(errors, cdnData, baseUrl) {
  const enrichedErrors = [];

  errors.forEach((error) => {
    const errorUrl = toPathOnly(error.url, baseUrl);
    const errorUserAgent = error.user_agent;

    // Try to find matching row in CDN data
    // Match by URL and user agent (flexible matching)
    const match = cdnData.find((cdnRow) => {
      let cdnUrl;
      if (cdnRow.url === '/') {
        cdnUrl = '/';
      } else {
        cdnUrl = cdnRow.url || '';
      }

      const urlMatch = errorUrl === cdnUrl
        || errorUrl.includes(cdnUrl)
        || cdnUrl.includes(errorUrl);

      const userAgentMatch = cdnRow.user_agent_display === errorUserAgent
        || (cdnRow.user_agent_display && errorUserAgent
          && cdnRow.user_agent_display.toLowerCase().includes(errorUserAgent.toLowerCase()))
        || (errorUserAgent && cdnRow.user_agent_display
          && errorUserAgent.toLowerCase().includes(cdnRow.user_agent_display.toLowerCase()));

      return urlMatch && userAgentMatch;
    });

    if (match) {
      enrichedErrors.push({
        agent_type: match.agent_type,
        user_agent_display: match.user_agent_display,
        number_of_hits: error.total_requests || match.number_of_hits,
        avg_ttfb_ms: match.avg_ttfb_ms,
        country_code: match.country_code,
        url: errorUrl,
        product: match.product,
        category: match.category,
      });
    } else {
      // Create fallback record for unmatched errors - allow nulls to pass through for Excel
      // fallbacks
      enrichedErrors.push({
        agent_type: null, // Will trigger || 'Other' in Excel generation
        user_agent_display: error.user_agent, // Will trigger || 'Unknown' in Excel generation
        number_of_hits: error.total_requests, // Will trigger || 0 in Excel generation
        avg_ttfb_ms: 0, // Keep as 0 since no CDN data available
        country_code: null, // Will trigger || 'GLOBAL' in Excel generation
        url: errorUrl,
        product: null, // Will trigger || 'Other' in Excel generation
        category: null, // Will trigger || 'Uncategorized' in Excel generation
        // Keep these for backward compatibility in Excel generation
        userAgent: error.user_agent,
        totalRequests: error.total_requests,
      });
    }
  });

  return enrichedErrors;
}

async function runLlmErrorPagesAudit(url, context, site) {
  const {
    log, audit,
  } = context;
  const s3Config = await getS3Config(site, context);

  log.info(`Starting LLM error pages audit for ${url}`);
  log.info(`Running LLM error pages audit ${audit}`);

  try {
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

    const week = generateReportingPeriods().weeks[0];
    const { startDate } = week;
    const { endDate } = week;
    const periodIdentifier = `w${week.weekNumber}-${week.year}`;
    log.info(`Running weekly audit for ${periodIdentifier}`);

    // Get site configuration
    const filters = site.getConfig()?.getLlmoCdnlogsFilter?.() || [];
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

    const buildFilename = (code) => `agentictraffic-errors-${code}-${periodIdentifier}.xlsx`;

    const writeCategoryExcel = async (code, errors) => {
      if (!errors || errors.length === 0) return;

      // Download existing CDN sheet for data enrichment
      const existingCdnData = await downloadExistingCdnSheet(
        periodIdentifier,
        outputLocation,
        sharepointClient,
        log,
      );

      if (!existingCdnData || existingCdnData.length === 0) {
        log.warn(`No existing CDN data found for ${periodIdentifier}, skipping ${code} error report`);
        return;
      }

      // Match error data with existing CDN data
      log.info(`Found existing CDN data with ${existingCdnData.length} rows, enriching error data`);
      const enrichedErrors = matchErrorsWithCdnData(errors, existingCdnData, baseUrl);

      // Sort by traffic volume
      const sorted = enrichedErrors.sort((a, b) => (b.number_of_hits || b.totalRequests || 0)
        - (a.number_of_hits || a.totalRequests || 0));

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('data');

      // Use CDN-style headers (same as agentic traffic report)
      sheet.addRow(['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score']);

      sorted.forEach((e) => {
        sheet.addRow([
          e.agent_type || 'Other',
          e.user_agent_display || e.userAgent || 'Unknown',
          e.number_of_hits || e.totalRequests || 0,
          e.avg_ttfb_ms || 0,
          e.country_code || 'GLOBAL',
          e.url,
          e.product || 'Other',
          e.category || 'Uncategorized',
          '', // Suggested URLs (filled by Mystique)
          '', // AI Rationale (filled by Mystique)
          '', // Confidence score (filled by Mystique)
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
      writeCategoryExcel('404', categorizedResults[404]?.slice(0, 50)),
      writeCategoryExcel('403', categorizedResults[403]),
      writeCategoryExcel('5xx', categorizedResults['5xx']),
    ]);

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
      categorizedResults,
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

// Post processor for sending message to Mystique
async function sendMystiqueMessagePostProcessor(auditUrl, auditData, context) {
  const {
    log, sqs, env, dataAccess, audit,
  } = context;
  const { siteId, auditResult } = auditData;

  // Skip if audit failed
  if (!auditResult.success) {
    log.info('Audit failed, skipping Mystique message');
    return auditData;
  }

  const { categorizedResults, periodIdentifier } = auditResult;
  const errors404 = categorizedResults[404] || [];

  if (errors404.length === 0) {
    log.info('No 404 errors found, skipping Mystique message');
    return auditData;
  }

  if (!sqs || !env?.QUEUE_SPACECAT_TO_MYSTIQUE) {
    log.warn('SQS or Mystique queue not configured, skipping message');
    return auditData;
  }

  try {
    // Get site for additional data
    const { Site } = dataAccess;
    const site = await Site.findById(siteId);
    if (!site) {
      log.warn('Site not found, skipping Mystique message');
      return auditData;
    }

    const messageBaseUrl = site.getBaseURL?.() || '';
    const consolidated404 = consolidateErrorsByUrl(errors404);
    const sorted404 = sortErrorsByTrafficVolume(consolidated404).slice(0, 50);
    const { SiteTopPage } = dataAccess;
    const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');

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
      siteId,
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
    log.info(`Queued ${urlToUserAgentsMap.size} consolidated 404 URLs to Mystique for AI processing`);
  } catch (error) {
    log.error(`Failed to send Mystique message: ${error.message}`);
  }

  return auditData;
}

export default new AuditBuilder()
  .withUrlResolver(wwwUrlResolver)
  .withRunner(runLlmErrorPagesAudit)
  .withPostProcessors([sendMystiqueMessagePostProcessor])
  .build();
