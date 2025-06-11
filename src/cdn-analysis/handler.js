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
import { ensureAthenaTablesExist, createFormattedLogsTable } from './utils/table-manager.js';
import { runAllAnalysis, createAnalysisSummary } from './utils/analysis-runners.js';
import { filterAndStoreAgenticLogs } from './utils/unload-operations.js';

const INTERVAL = 1; // hours

/**
 * Step 1: Filter and store agentic logs
 */
async function filterAgenticLogsStep(auditUrl, context, site) {
  const { log, athenaClient, s3Client } = context;

  if (!athenaClient) {
    throw new Error('Athena client not available in context');
  }

  if (!s3Client) {
    throw new Error('S3 client not available in context');
  }

  // Get S3 configuration based on customer and environment
  const s3Config = getS3Config(context, site);

  // Get the hour to process (previous hour)
  const now = new Date();
  const hourToProcess = new Date(now.getTime() - (60 * 60 * 1000)); // 1 hour ago

  log.info(`Step 1: Filtering agentic logs for ${auditUrl} - processing hour: ${hourToProcess.toISOString()}`);

  try {
    // Auto-setup: Ensure Athena tables exist
    await ensureAthenaTablesExist(athenaClient, s3Config, log);

    // Note: Using UNLOAD to export directly to S3, no table needed

    // Filter and store agentic logs
    const sourceTableName = `raw_logs_${s3Config.customerDomain}`;
    const agenticLogsCount = await filterAndStoreAgenticLogs(
      athenaClient,
      hourToProcess,
      s3Config,
      sourceTableName,
      log,
    );

    log.info(`✅ Step 1 completed: Filtered and stored ${agenticLogsCount} agentic log entries`);

    return {
      auditResult: {
        step: 'filter-agentic-logs',
        hourProcessed: hourToProcess.toISOString(),
        agenticLogsCount,
        unloadMethod: 'UNLOAD_TO_S3',
        storagePath: `s3://${s3Config.rawLogsBucket}/formatted-logs/`,
        format: 'JSON_GZIPPED',
        customerDomain: s3Config.customerDomain,
        environment: s3Config.environment,
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`Step 1 failed for ${auditUrl}:`, error);
    throw error;
  }
}

/**
 * Step 2: Run aggregated analysis on filtered agentic logs
 */
async function runAggregatedAnalysisStep(auditUrl, context, site) {
  const { log, athenaClient, s3Client } = context;

  // Get S3 configuration based on customer and environment
  const s3Config = getS3Config(context, site);

  // Get the hour to process (previous hour)
  const now = new Date();
  const hourToProcess = new Date(now.getTime() - (60 * 60 * 1000)); // 1 hour ago

  log.info(`Step 2: Running aggregated analysis for ${auditUrl} - processing hour: ${hourToProcess.toISOString()}`);

  try {
    // Create table on-demand to read from UNLOAD files
    await createFormattedLogsTable(athenaClient, s3Config, log);

    // Use formatted logs table for analysis
    const formattedTableName = `formatted_logs_${s3Config.customerDomain}`;

    // Run all analysis types in parallel using utility function
    const analysisResults = await runAllAnalysis(
      athenaClient,
      hourToProcess,
      s3Config,
      formattedTableName,
      log,
    );

    // Save all results to S3 as Parquet files
    const s3SavePromises = Object.entries(analysisResults)
      .map(([analysisType, data]) => saveToS3AsParquet({
        analysisType,
        data,
        hourProcessed: hourToProcess,
        bucket: s3Config.analysisBucket,
        basePrefix: 'cdn-analysis-agentic',
        log,
        customerDomain: s3Config.customerDomain,
        s3Client,
      }));

    await Promise.allSettled(s3SavePromises);

    // Create summary
    const summary = createAnalysisSummary(analysisResults, hourToProcess, s3Config);

    const logMessage = `Step 2 completed: CDN agentic analysis for ${auditUrl} `
      + `(customer: ${s3Config.customerDomain}). `
      + `Processed ${Object.keys(analysisResults).length} analysis types.`;
    log.info(logMessage);

    return {
      auditResult: {
        step: 'aggregated-analysis',
        cdnAgenticAnalysis: summary,
        auditContext: {
          interval: INTERVAL,
          hourProcessed: hourToProcess.toISOString(),
          analysisTypes: Object.keys(analysisResults),
          customerDomain: s3Config.customerDomain,
          environment: s3Config.environment,
        },
      },
      fullAuditRef: auditUrl,
    };
  } catch (error) {
    log.error(`Step 2 failed for ${auditUrl}:`, error);
    throw error;
  }
}

/**
 * Main CDN Analysis Runner - executes both steps sequentially
 */
async function runCdnAnalysis(auditUrl, context) {
  const { log } = context;

  log.info(`Starting CDN Analysis for ${auditUrl}`);

  try {
    // Get site information
    const site = context.site || { baseURL: auditUrl };

    // Step 1: Filter and store agentic logs
    log.info('Executing Step 1: Filter agentic logs');
    const step1Result = await filterAgenticLogsStep(auditUrl, context, site);

    // Step 2: Run aggregated analysis
    log.info('Executing Step 2: Run aggregated analysis');
    const step2Result = await runAggregatedAnalysisStep(auditUrl, context, site);

    // Combine results
    const combinedResult = {
      auditResult: {
        step1: step1Result.auditResult,
        step2: step2Result.auditResult,
        summary: {
          totalSteps: 2,
          completedAt: new Date().toISOString(),
          auditUrl,
        },
      },
      fullAuditRef: auditUrl,
    };

    log.info(`✅ CDN Analysis completed successfully for ${auditUrl}`);
    return combinedResult;
  } catch (error) {
    log.error(`❌ CDN Analysis failed for ${auditUrl}:`, error);
    throw error;
  }
}

export default new AuditBuilder()
  .withRunner(runCdnAnalysis)
  .build();
/* c8 ignore stop */
