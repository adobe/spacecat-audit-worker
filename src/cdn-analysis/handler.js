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
import { StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';
import { AuditBuilder } from '../common/audit-builder.js';
import { trafficAnalysisQueries } from './queries/traffic-analysis.js';
import { referrerAnalysisQueries } from './queries/referrer-analysis.js';
import { userAgentAnalysisQueries } from './queries/user-agent-analysis.js';
import { errorAnalysisQueries } from './queries/error-analysis.js';
import { geoAnalysisQueries } from './queries/geo-analysis.js';
import { frequencyAnalysisQueries } from './queries/frequency-analysis.js';
import { saveToS3AsParquet } from './aggregators/parquet-writer.js';
import { getS3Config, getCustomerRawLogsLocation, getRawLogsPartitionConfig } from './config/s3-config.js';

const INTERVAL = 1; // hours

/**
 * Parse Athena results into usable format
 */
function parseAthenaResults(results) {
  if (!results.ResultSet || !results.ResultSet.Rows || results.ResultSet.Rows.length === 0) {
    return [];
  }

  const rows = results.ResultSet.Rows;
  const headers = rows[0].Data.map((col) => col.VarCharValue);

  return rows.slice(1).map((row) => {
    const record = {};
    row.Data.forEach((col, index) => {
      record[headers[index]] = col.VarCharValue;
    });
    return record;
  });
}

/**
 * Wait for Athena query execution to complete
 */
async function waitForQueryExecution(athenaClient, queryExecutionId, maxAttempts = 60) {
  let queryExecution;
  let attempts = 0;

  // eslint-disable-next-line no-await-in-loop
  while (attempts < maxAttempts) {
    // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const getCommand = new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId });
    // eslint-disable-next-line no-await-in-loop
    queryExecution = await athenaClient.send(getCommand);
    attempts += 1;

    const state = queryExecution.QueryExecution.Status.State;
    if (state !== 'RUNNING' && state !== 'QUEUED') {
      break;
    }
  }

  // If we've reached max attempts and query is still running, throw an error
  const finalState = queryExecution.QueryExecution.Status.State;
  if ((finalState === 'RUNNING' || finalState === 'QUEUED') && attempts >= maxAttempts) {
    throw new Error(`Query execution timed out after ${maxAttempts} attempts. Current state: ${finalState}`);
  }

  return queryExecution;
}

/**
 * Execute a setup query and wait for completion
 */
async function executeAthenaSetupQuery(athenaClient, query, description, s3Config, log) {
  try {
    log.info(`🔧 Setting up ${description}...`);

    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: 'default' },
      ResultConfiguration: {
        OutputLocation: s3Config.getAthenaTempLocation(),
      },
    });

    const startResult = await athenaClient.send(startCommand);
    const queryExecutionId = startResult.QueryExecutionId;

    // Wait for completion
    const queryExecution = await waitForQueryExecution(athenaClient, queryExecutionId);

    if (queryExecution.QueryExecution.Status.State === 'SUCCEEDED') {
      log.info(`✅ ${description} setup completed`);
    } else {
      const error = queryExecution.QueryExecution.Status.StateChangeReason || 'Unknown error';
      log.warn(`⚠️ ${description} setup issue: ${error}`);
      // Don't throw for table creation issues - might already exist
    }
  } catch (error) {
    log.warn(`⚠️ ${description} setup warning:`, error.message);
    // Don't throw - continue with analysis even if setup has issues
  }
}

/**
 * Execute Athena query and return results
 */
async function executeAthenaQuery(athenaClient, query, s3Config, log, database = 'cdn_logs') {
  try {
    // Start query execution
    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: {
        OutputLocation: s3Config.getAthenaTempLocation(),
      },
    });

    const startResult = await athenaClient.send(startCommand);
    const queryExecutionId = startResult.QueryExecutionId;

    // Wait for query completion
    const queryExecution = await waitForQueryExecution(athenaClient, queryExecutionId);

    if (queryExecution.QueryExecution.Status.State !== 'SUCCEEDED') {
      throw new Error(`Query failed: ${queryExecution.QueryExecution.Status.StateChangeReason}`);
    }

    // Get query results
    const resultsCommand = new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId });
    const results = await athenaClient.send(resultsCommand);

    return parseAthenaResults(results);
  } catch (error) {
    log.error('Athena query execution failed:', error);
    throw error;
  }
}

/**
 * Run traffic analysis
 */
async function runTrafficAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = trafficAnalysisQueries.hourlyTraffic(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run referrer analysis
 */
async function runReferrerAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = referrerAnalysisQueries.hourlyReferrers(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run user agent analysis
 */
async function runUserAgentAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = userAgentAnalysisQueries.hourlyUserAgents(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run error analysis
 */
async function runErrorAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = errorAnalysisQueries.hourlyErrors(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run geographic analysis
 */
async function runGeoAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = geoAnalysisQueries.hourlyByCountry(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run frequency analysis
 */
async function runFrequencyAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log) {
  const query = frequencyAnalysisQueries.hourlyFrequencyPatterns(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Create summary of all analysis results
 */
function createAnalysisSummary(analysisResults, hourProcessed, s3Config) {
  const summary = {
    timestamp: new Date().toISOString(),
    hourProcessed: hourProcessed.toISOString(),
    customerDomain: s3Config.customerDomain,
    environment: s3Config.environment,
    analysisTypes: Object.keys(analysisResults),
    recordCounts: {},
    totalRequests: 0,
    agenticRequests: 0,
  };

  // Count records in each analysis
  Object.entries(analysisResults).forEach(([type, data]) => {
    summary.recordCounts[type] = Array.isArray(data) ? data.length : 0;
  });

  // Extract key metrics
  if (analysisResults.traffic && analysisResults.traffic.length > 0) {
    summary.totalRequests = parseInt(analysisResults.traffic[0].total_requests || 0, 10);
  }

  if (analysisResults.userAgent) {
    summary.agenticRequests = analysisResults.userAgent
      .filter((ua) => ua.is_agentic === 'true')
      .reduce((sum, ua) => sum + parseInt(ua.count || 0, 10), 0);
  }

  summary.agenticPercentage = summary.totalRequests > 0
    ? (summary.agenticRequests / summary.totalRequests) * 100
    : 0;

  return summary;
}

/**
 * Ensure Athena tables exist, create them if they don't
 */
async function ensureAthenaTablesExist(athenaClient, s3Config, log) {
  try {
    log.info('🔧 Checking Athena tables setup...');

    // Create database first
    await executeAthenaSetupQuery(
      athenaClient,
      'CREATE DATABASE IF NOT EXISTS cdn_logs',
      'cdn_logs database',
      s3Config,
      log,
    );

    // Create customer-specific raw logs table
    const rawLogsLocation = getCustomerRawLogsLocation(s3Config);
    const customerTableName = `raw_logs_${s3Config.customerDomain}`;
    const partitionConfig = getRawLogsPartitionConfig(s3Config);

    const rawLogsTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS cdn_logs.${customerTableName} (
        timestamp string,
        geo_country string,
        host string,
        url string,
        request_method string,
        request_protocol string,
        request_user_agent string,
        response_state string,
        response_status int,
        response_reason string,
        referer string
      )
      PARTITIONED BY (
        year string,
        month string,
        day string,
        hour string
      )
      ROW FORMAT SERDE 'org.apache.hive.hcatalog.data.JsonSerDe'
      LOCATION '${rawLogsLocation}'
      TBLPROPERTIES (
        'projection.enabled' = '${partitionConfig.projectionEnabled}',
        'storage.location.template' = '${partitionConfig.locationTemplate}',
        ${Object.entries(partitionConfig.partitionProjections).map(([key, value]) => `'${key}' = '${value}'`).join(',\n        ')},
        'has_encrypted_data' = 'false'
      )
    `;

    await executeAthenaSetupQuery(
      athenaClient,
      rawLogsTableDDL,
      `${customerTableName} table`,
      s3Config,
      log,
    );

    // Create new Parquet analysis table for improved performance
    const parquetAnalysisTableDDL = `
      CREATE EXTERNAL TABLE IF NOT EXISTS cdn_logs.cdn_analysis_data (
        analysis_type string,
        customer_domain string,
        hour_processed timestamp,
        generated_at timestamp,
        record_index int,
        total_requests bigint,
        success_rate double,
        agentic_requests bigint,
        geo_country string,
        response_status bigint,
        request_user_agent string,
        referer string,
        additional_data string
      )
      PARTITIONED BY (
        customer string,
        year string,
        month string,
        day string,
        hour string
      )
      STORED AS PARQUET
      LOCATION '${s3Config.analysisBucket}/cdn-analysis/'
      TBLPROPERTIES (
        'projection.enabled' = 'true',
        'projection.customer.type' = 'enum',
        'projection.customer.values' = 'blog_adobe_com,other_domains',
        'projection.year.type' = 'integer',
        'projection.year.range' = '2024,2030',
        'projection.year.format' = 'yyyy',
        'projection.month.type' = 'integer',
        'projection.month.range' = '1,12',
        'projection.month.format' = 'MM',
        'projection.day.type' = 'integer',
        'projection.day.range' = '1,31',
        'projection.day.format' = 'dd',
        'projection.hour.type' = 'integer',
        'projection.hour.range' = '0,23',
        'projection.hour.format' = 'HH',
        'storage.location.template' = 's3://${s3Config.analysisBucket}/cdn-analysis/customer=\${customer}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/',
        'has_encrypted_data' = 'false'
      )
    `;

    await executeAthenaSetupQuery(
      athenaClient,
      parquetAnalysisTableDDL,
      'cdn_analysis_parquet table',
      s3Config,
      log,
    );

    log.info('✅ Athena tables setup completed successfully!');
  } catch (error) {
    log.error('❌ Failed to setup Athena tables:', error);
    throw error;
  }
}

/**
 * CDN Analysis Runner - Comprehensive CDN log analysis
 * Supports 6 analysis types: Traffic, Referrer, User Agent, Error, Geographic, Frequency
 */
export async function CDNAnalysisRunner(auditUrl, context, site) {
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

  log.info(`Starting CDN analysis for ${auditUrl} - processing hour: ${hourToProcess.toISOString()}`);

  const analysisResults = {};

  try {
    // Auto-setup: Ensure Athena tables exist
    await ensureAthenaTablesExist(athenaClient, s3Config, log);
    // Run all 6 analysis types in parallel
    const customerTableName = `raw_logs_${s3Config.customerDomain}`;
    const analysisPromises = [
      runTrafficAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
      runReferrerAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
      runUserAgentAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
      runErrorAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
      runGeoAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
      runFrequencyAnalysis(athenaClient, hourToProcess, s3Config, customerTableName, log),
    ];

    const [
      trafficData,
      referrerData,
      userAgentData,
      errorData,
      geoData,
      frequencyData,
    ] = await Promise.allSettled(analysisPromises);

    // Collect successful results
    if (trafficData.status === 'fulfilled') analysisResults.traffic = trafficData.value;
    if (referrerData.status === 'fulfilled') analysisResults.referrer = referrerData.value;
    if (userAgentData.status === 'fulfilled') analysisResults.userAgent = userAgentData.value;
    if (errorData.status === 'fulfilled') analysisResults.error = errorData.value;
    if (geoData.status === 'fulfilled') analysisResults.geo = geoData.value;
    if (frequencyData.status === 'fulfilled') analysisResults.frequency = frequencyData.value;

    // Save all results to S3 as Parquet files
    const s3SavePromises = Object.entries(analysisResults)
      .map(([analysisType, data]) => saveToS3AsParquet({
        analysisType,
        data,
        hourProcessed: hourToProcess,
        bucket: s3Config.analysisBucket,
        basePrefix: 'cdn-analysis',
        log,
        customerDomain: s3Config.customerDomain,
        s3Client,
      }));

    await Promise.allSettled(s3SavePromises);

    // Create summary
    const summary = createAnalysisSummary(analysisResults, hourToProcess, s3Config);

    const logMessage = `CDN analysis completed for ${auditUrl} (customer: ${s3Config.customerDomain}).`
      + ` Processed ${Object.keys(analysisResults).length} analysis types.`;
    log.info(logMessage);

    return {
      auditResult: {
        cdnAnalysis: summary,
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
    log.error(`CDN analysis failed for ${auditUrl}:`, error);
    throw error;
  }
}

export default new AuditBuilder()
  .withRunner(CDNAnalysisRunner)
  .build();
/* c8 ignore stop */
