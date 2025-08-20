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

import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import { AuditBuilder } from '../common/audit-builder.js';
import { generateOpportunities } from './opportunity-handler.js';
import {
  getS3Config,
  validateDatabaseAndTable,
  generateReportingPeriods,
  createDateRange,
  buildSiteFilters,
  processLlmErrorPagesResults,
  buildLlmErrorPagesQuery,
  getAllLlmProviders,
} from './utils.js';
import { wwwUrlResolver } from '../common/index.js';

async function runLlmErrorPagesAudit(url, context, site) {
  const { log, message = {} } = context;
  const s3Config = getS3Config(site);

  log.info(`Starting LLM error pages audit for ${url}`);

  try {
    const athenaClient = AWSAthenaClient.fromContext(context, s3Config.getAthenaTempLocation());

    // Validate database and table exist
    await validateDatabaseAndTable(athenaClient, s3Config, log);

    let startDate;
    let endDate;
    let periodIdentifier;

    // Handle date range - custom dates or default to previous week
    if (message.startDate && message.endDate) {
      const parsedRange = createDateRange(message.startDate, message.endDate);
      startDate = parsedRange.startDate;
      endDate = parsedRange.endDate;
      periodIdentifier = `${message.startDate}_to_${message.endDate}`;
      log.info(`Running custom date range audit: ${message.startDate} to ${message.endDate}`);
    } else {
      // Default to previous week
      const week = generateReportingPeriods().weeks[0];
      startDate = week.startDate;
      endDate = week.endDate;
      periodIdentifier = `w${week.weekNumber}-${week.year}`;
      log.info(`Running weekly audit for ${periodIdentifier}`);
    }

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
    const processedResults = processLlmErrorPagesResults(results);

    log.info(`Found ${processedResults.totalErrors} total errors across ${processedResults.summary.uniqueUrls} unique URLs`);

    // Attach site to context for downstream opportunity generation
    const downstreamContext = { ...context, site };

    await generateOpportunities(processedResults, message, downstreamContext);

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
  .withRunner(runLlmErrorPagesAudit)
  .withUrlResolver(wwwUrlResolver)
  .build();
