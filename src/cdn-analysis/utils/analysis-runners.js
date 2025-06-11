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
import { executeAthenaQuery } from './athena-client.js';
import { requestAnalysisQueries } from '../queries/request-analysis.js';
import { urlTrafficAnalysisQueries } from '../queries/url-traffic-analysis.js';
import { userAgentRequestAnalysisQueries } from '../queries/user-agent-request-analysis.js';
import { querySourceAnalysisQueries } from '../queries/query-source-analysis.js';
import { urlUserAgentStatusAnalysisQueries } from '../queries/url-user-agent-status-analysis.js';
import { urlStatusAnalysisQueries } from '../queries/url-status-analysis.js';
import { geographicAnalysisQueries } from '../queries/geographic-analysis.js';

/**
 * 1. Run request analysis - UNLOAD to S3
 */
export async function runRequestAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = requestAnalysisQueries.hourlyRequests(hourToProcess, customerTableName, s3Config);
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('Request analysis UNLOAD completed');
}

/**
 * 2. Run URL-level traffic breakdown analysis - UNLOAD to S3
 */
export async function runUrlTrafficAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = urlTrafficAnalysisQueries.hourlyUrlTraffic(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('URL traffic analysis UNLOAD completed');
}

/**
 * 3. Run user agent request analysis (agentic traffic only) - UNLOAD to S3
 */
export async function runUserAgentRequestAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = userAgentRequestAnalysisQueries.hourlyUserAgentRequests(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('User agent request analysis UNLOAD completed');
}

/**
 * 4. Run query source analysis (UTM parameters) - UNLOAD to S3
 */
export async function runQuerySourceAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = querySourceAnalysisQueries.hourlyQuerySource(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('Query source analysis UNLOAD completed');
}

/**
 * 5. Run URL-User-Agent-Status analysis - UNLOAD to S3
 */
export async function runUrlUserAgentStatusAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = urlUserAgentStatusAnalysisQueries.hourlyUrlUserAgentStatus(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('URL-User-Agent-Status analysis UNLOAD completed');
}

/**
 * 6. Run URL-Status analysis - UNLOAD to S3
 */
export async function runUrlStatusAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = urlStatusAnalysisQueries.hourlyUrlStatus(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('URL-Status analysis UNLOAD completed');
}

/**
 * 7. Run geographic analysis (hits by country) - UNLOAD to S3
 */
export async function runGeographicAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = geographicAnalysisQueries.hourlyHitsByCountry(
    hourToProcess,
    customerTableName,
    s3Config,
  );
  await executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
  log.info('Geographic analysis UNLOAD completed');
}

/**
 * Run all 7 agentic analysis types in parallel - All UNLOAD to S3
 */
export async function runAllAnalysis(athenaClient, hourToProcess, s3Config, tableName, log) {
  const analysisPromises = [
    runRequestAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runUrlTrafficAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runUserAgentRequestAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runQuerySourceAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runUrlUserAgentStatusAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runUrlStatusAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runGeographicAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
  ];

  const results = await Promise.allSettled(analysisPromises);

  const failures = results.filter((result) => result.status === 'rejected');
  const successes = results.filter((result) => result.status === 'fulfilled');

  if (failures.length > 0) {
    log.error(`${failures.length} analysis UNLOAD operations failed:`, {
      failures: failures.map((failure, index) => ({
        analysisIndex: index,
        error: failure.reason?.message || failure.reason,
      })),
    });

    if (failures.length > successes.length) {
      throw new Error(`Critical failure: ${failures.length}/${results.length} analysis UNLOADs failed`);
    }
  }

  log.info(`All analysis UNLOAD operations completed: ${successes.length} succeeded, ${failures.length} failed`);

  return {
    completed: successes.length,
    failed: failures.length,
    total: results.length,
  };
}

/**
 * Create summary of analysis execution (no data processing needed)
 */
export function createAnalysisExecutionSummary(executionResults, hourProcessed, s3Config) {
  return {
    timestamp: new Date().toISOString(),
    hourProcessed: hourProcessed.toISOString(),
    customerDomain: s3Config.customerDomain,
    environment: s3Config.environment,
    executionResults,
    analysisTypes: [
      'request',
      'urlTraffic',
      'userAgentRequest',
      'querySource',
      'urlUserAgentStatus',
      'urlStatus',
      'geographic',
    ],
    s3OutputLocation: `s3://${s3Config.analysisBucket}/aggregated/`,
  };
}
/* c8 ignore stop */
