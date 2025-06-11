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

/* c8 ignore start */
import { AuditBuilder } from '../common/audit-builder.js';
import { getS3Config } from './config/s3-config.js';
import { ensureAthenaTablesExist, createFilteredLogsTable } from './utils/table-manager.js';
import { runAllAnalysis, createAnalysisExecutionSummary } from './utils/analysis-runners.js';
import { filterAndStoreAgenticLogs } from './utils/unload-operations.js';

async function runCdnAnalysis(auditUrl, context) {
  const { log } = context;
  const site = context.site || { baseURL: auditUrl };
  const { athenaClient } = context;
  const s3Config = getS3Config(context, site);
  const hourToProcess = new Date(Date.now() - 60 * 60 * 1000);

  log.info(`Starting CDN Analysis for ${auditUrl}`);

  // Ensure tables exist
  await ensureAthenaTablesExist(athenaClient, s3Config, log);

  // Filter agentic logs
  log.info(`Filtering agentic logs for ${hourToProcess.toISOString()}`);
  const sourceTableName = `raw_logs_${s3Config.customerDomain}`;
  const agenticLogCount = await filterAndStoreAgenticLogs(
    athenaClient,
    hourToProcess,
    s3Config,
    sourceTableName,
    log,
  );
  log.info(`Filtered ${agenticLogCount} agentic logs`);

  // Run analysis
  log.info(`Running analysis for ${hourToProcess.toISOString()}`);
  await createFilteredLogsTable(athenaClient, s3Config, log);

  const filteredTableName = `filtered_logs_${s3Config.customerDomain}`;
  const executionResults = await runAllAnalysis(
    athenaClient,
    hourToProcess,
    s3Config,
    filteredTableName,
    log,
  );
  log.info(`Analysis execution completed: ${executionResults.completed}/${executionResults.total} succeeded`);

  const summary = createAnalysisExecutionSummary(executionResults, hourToProcess, s3Config);

  log.info(`CDN Analysis completed for ${auditUrl}`);

  return {
    auditResult: {
      hourProcessed: hourToProcess.toISOString(),
      agenticLogCount,
      cdnAgenticAnalysis: summary,
      customerDomain: s3Config.customerDomain,
      environment: s3Config.environment,
      analysisTypes: summary.analysisTypes,
      s3OutputLocation: summary.s3OutputLocation,
      sourceTable: sourceTableName,
      filteredTable: filteredTableName,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnAnalysis)
  .build();
/* c8 ignore stop */
