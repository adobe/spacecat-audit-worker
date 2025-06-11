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
import { saveToS3AsParquet } from './aggregators/parquet-writer.js';
import { getS3Config } from './config/s3-config.js';
import { ensureAthenaTablesExist, createFilteredLogsTable } from './utils/table-manager.js';
import { runAllAnalysis, createAnalysisSummary } from './utils/analysis-runners.js';
import { filterAndStoreAgenticLogs } from './utils/unload-operations.js';

async function filterAgenticLogs(auditUrl, context, site) {
  const { log, athenaClient, s3Client } = context;

  if (!athenaClient || !s3Client) {
    throw new Error('Missing required AWS clients in context');
  }

  const s3Config = getS3Config(context, site);
  const hourToProcess = new Date(Date.now() - 60 * 60 * 1000);

  log.info(`Filtering agentic logs for ${hourToProcess.toISOString()}`);

  await ensureAthenaTablesExist(athenaClient, s3Config, log);

  const sourceTableName = `raw_logs_${s3Config.customerDomain}`;
  const agenticLogsCount = await filterAndStoreAgenticLogs(
    athenaClient,
    hourToProcess,
    s3Config,
    sourceTableName,
    log,
  );

  log.info(`Filtered ${agenticLogsCount} agentic log entries`);

  return {
    auditResult: {
      step: 'filter-agentic-logs',
      hourProcessed: hourToProcess.toISOString(),
      agenticLogsCount,
      storagePath: `s3://${s3Config.rawLogsBucket}/filtered/`,
      customerDomain: s3Config.customerDomain,
      environment: s3Config.environment,
    },
    fullAuditRef: auditUrl,
  };
}

async function runAnalysis(auditUrl, context, site) {
  const { log, athenaClient, s3Client } = context;
  const s3Config = getS3Config(context, site);
  const hourToProcess = new Date(Date.now() - 60 * 60 * 1000);

  log.info(`Running analysis for ${hourToProcess.toISOString()}`);

  await createFilteredLogsTable(athenaClient, s3Config, log);

  const filteredTableName = `filtered_logs_${s3Config.customerDomain}`;
  const analysisResults = await runAllAnalysis(
    athenaClient,
    hourToProcess,
    s3Config,
    filteredTableName,
    log,
  );

  const s3SavePromises = Object.entries(analysisResults)
    .map(([analysisType, data]) => saveToS3AsParquet({
      analysisType,
      data,
      hourProcessed: hourToProcess,
      bucket: s3Config.analysisBucket,
      log,
      customerDomain: s3Config.customerDomain,
      s3Client,
    }));

  const s3SaveResults = await Promise.allSettled(s3SavePromises);
  const failures = s3SaveResults.filter((result) => result.status === 'rejected');
  const successes = s3SaveResults.filter((result) => result.status === 'fulfilled');

  if (failures.length > 0) {
    log.error(`${failures.length} S3 save operations failed:`, {
      failures: failures.map((failure, index) => ({
        analysisType: Object.keys(analysisResults)[index],
        error: failure.reason?.message || failure.reason,
      })),
    });

    if (failures.length > successes.length) {
      throw new Error(`Critical failure: ${failures.length}/${s3SaveResults.length} S3 saves failed`);
    }
  }

  log.info(`Analysis complete: ${successes.length} succeeded, ${failures.length} failed`);

  const summary = createAnalysisSummary(analysisResults, hourToProcess, s3Config);

  return {
    auditResult: {
      step: 'aggregated-analysis',
      cdnAgenticAnalysis: summary,
      auditContext: {
        hourProcessed: hourToProcess.toISOString(),
        analysisTypes: Object.keys(analysisResults),
        customerDomain: s3Config.customerDomain,
        environment: s3Config.environment,
      },
    },
    fullAuditRef: auditUrl,
  };
}

async function runCdnAnalysis(auditUrl, context) {
  const { log } = context;
  const site = context.site || { baseURL: auditUrl };

  log.info(`Starting CDN Analysis for ${auditUrl}`);

  const step1Result = await filterAgenticLogs(auditUrl, context, site);
  const step2Result = await runAnalysis(auditUrl, context, site);

  log.info(`CDN Analysis completed for ${auditUrl}`);

  return {
    auditResult: {
      step1: step1Result.auditResult,
      step2: step2Result.auditResult,
      summary: {
        completedAt: new Date().toISOString(),
        auditUrl,
      },
    },
    fullAuditRef: auditUrl,
  };
}

export default new AuditBuilder()
  .withRunner(runCdnAnalysis)
  .build();
/* c8 ignore stop */
