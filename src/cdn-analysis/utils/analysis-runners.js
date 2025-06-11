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
import { trafficAnalysisQueries } from '../queries/traffic-analysis.js';
import { referrerAnalysisQueries } from '../queries/referrer-analysis.js';
import { userAgentAnalysisQueries } from '../queries/user-agent-analysis.js';
import { errorAnalysisQueries } from '../queries/error-analysis.js';
import { geoAnalysisQueries } from '../queries/geo-analysis.js';
import { frequencyAnalysisQueries } from '../queries/frequency-analysis.js';

/**
 * Run traffic analysis
 */
export async function runTrafficAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = trafficAnalysisQueries.hourlyTraffic(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run referrer analysis
 */
export async function runReferrerAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = referrerAnalysisQueries.hourlyReferrers(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run user agent analysis
 */
export async function runUserAgentAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = userAgentAnalysisQueries.hourlyUserAgents(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run error analysis
 */
export async function runErrorAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = errorAnalysisQueries.hourlyErrors(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run geographic analysis
 */
export async function runGeoAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = geoAnalysisQueries.hourlyByCountry(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run frequency analysis
 */
export async function runFrequencyAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = frequencyAnalysisQueries.hourlyFrequencyPatterns(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run all analysis types in parallel
 */
export async function runAllAnalysis(athenaClient, hourToProcess, s3Config, tableName, log) {
  const analysisPromises = [
    runTrafficAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runReferrerAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runUserAgentAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runErrorAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runGeoAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
    runFrequencyAnalysis(athenaClient, hourToProcess, s3Config, tableName, log),
  ];

  const [
    trafficData,
    referrerData,
    userAgentData,
    errorData,
    geoData,
    frequencyData,
  ] = await Promise.allSettled(analysisPromises);

  const analysisResults = {};

  // Collect successful results
  if (trafficData.status === 'fulfilled') analysisResults.traffic = trafficData.value;
  if (referrerData.status === 'fulfilled') analysisResults.referrer = referrerData.value;
  if (userAgentData.status === 'fulfilled') analysisResults.userAgent = userAgentData.value;
  if (errorData.status === 'fulfilled') analysisResults.error = errorData.value;
  if (geoData.status === 'fulfilled') analysisResults.geo = geoData.value;
  if (frequencyData.status === 'fulfilled') analysisResults.frequency = frequencyData.value;

  return analysisResults;
}

/**
 * Create summary of all analysis results
 */
export function createAnalysisSummary(analysisResults, hourProcessed, s3Config) {
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
/* c8 ignore stop */
