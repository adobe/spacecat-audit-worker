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
import { getCdnProvider } from './providers/cdn-provider-factory.js';
import { runAllAnalysis } from './utils/analysis-runners.js';

async function runCdnAnalysis(auditUrl, context, site) {
  const { log, athenaClient } = context;
  const provider = getCdnProvider(site, context);
  const hourToProcess = new Date(Date.now() - 60 * 60 * 1000);

  log.info(`Starting CDN Analysis for ${auditUrl} using ${provider.constructor.config.cdnType.toUpperCase()} provider`);

  // make sure athena tables exist
  await provider.ensureTablesExist(athenaClient, log);

  // filter agentic logs
  log.info(`Filtering agentic logs for ${hourToProcess.toISOString()}`);
  const agenticLogCount = await provider.filterAndStoreAgenticLogs(
    athenaClient,
    hourToProcess,
    log,
  );
  log.info(`Filtered ${agenticLogCount} agentic logs`);

  // create filtered logs table
  log.info(`Creating filtered logs table for ${hourToProcess.toISOString()}`);
  await provider.createFilteredLogsTable(athenaClient, log);

  // run all analyses
  log.info(`Running analysis for ${hourToProcess.toISOString()}`);
  const executionResults = await runAllAnalysis(
    athenaClient,
    hourToProcess,
    provider.s3Config,
    provider.filteredTableName,
    provider,
    log,
  );
  log.info(`CDN log analysis execution completed: ${executionResults.completed}/${executionResults.total} succeeded`);

  return {
    auditResult: {
      hourProcessed: hourToProcess.toISOString(),
      agenticLogCount,
      executionResults,
      cdnType: provider.constructor.config.cdnType,
      databaseName: provider.databaseName,
      customerDomain: provider.customerDomain,
      environment: provider.environment,
      sourceTable: provider.rawTableName,
      filteredTable: provider.filteredTableName,
      completedAt: new Date().toISOString(),
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnAnalysis)
  .build();
/* c8 ignore stop */
