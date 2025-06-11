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
 * 1. Run request analysis
 */
export async function runRequestAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = requestAnalysisQueries.hourlyRequests(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 2. Run URL-level traffic breakdown analysis
 */
export async function runUrlTrafficAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = urlTrafficAnalysisQueries.hourlyUrlTraffic(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 3. Run user agent request analysis (agentic traffic only)
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
  );
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 4. Run query source analysis (UTM parameters)
 */
export async function runQuerySourceAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = querySourceAnalysisQueries.hourlyQuerySource(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 5. Run URL-User-Agent-Status analysis
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
  );
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 6. Run URL-Status analysis
 */
export async function runUrlStatusAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = urlStatusAnalysisQueries.hourlyUrlStatus(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * 7. Run geographic analysis (hits by country)
 */
export async function runGeographicAnalysis(
  athenaClient,
  hourToProcess,
  s3Config,
  customerTableName,
  log,
) {
  const query = geographicAnalysisQueries.hourlyHitsByCountry(hourToProcess, customerTableName);
  return executeAthenaQuery(athenaClient, query, s3Config, log, 'cdn_logs');
}

/**
 * Run all 7 agentic analysis types in parallel
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

  const [
    requestData,
    urlTrafficData,
    userAgentRequestData,
    querySourceData,
    urlUserAgentStatusData,
    urlStatusData,
    geographicData,
  ] = await Promise.allSettled(analysisPromises);

  const analysisResults = {};

  // Collect successful results
  if (requestData.status === 'fulfilled') analysisResults.request = requestData.value;
  if (urlTrafficData.status === 'fulfilled') analysisResults.urlTraffic = urlTrafficData.value;
  if (userAgentRequestData.status === 'fulfilled') analysisResults.userAgentRequest = userAgentRequestData.value;
  if (querySourceData.status === 'fulfilled') analysisResults.querySource = querySourceData.value;
  if (urlUserAgentStatusData.status === 'fulfilled') analysisResults.urlUserAgentStatus = urlUserAgentStatusData.value;
  if (urlStatusData.status === 'fulfilled') analysisResults.urlStatus = urlStatusData.value;
  if (geographicData.status === 'fulfilled') analysisResults.geographic = geographicData.value;

  return analysisResults;
}

/**
 * Create summary of all analysis results for agentic-only data
 */
export function createAnalysisSummary(analysisResults, hourProcessed, s3Config) {
  const summary = {
    timestamp: new Date().toISOString(),
    hourProcessed: hourProcessed.toISOString(),
    customerDomain: s3Config.customerDomain,
    environment: s3Config.environment,
    analysisTypes: Object.keys(analysisResults),
    recordCounts: {},
    totalAgenticRequests: 0,
    totalOverallTraffic: 0,
    agentTypeBreakdown: {},
    statusCodeBreakdown: {},
    geographicSummary: {},
  };

  // Count records in each analysis
  Object.entries(analysisResults).forEach(([type, data]) => {
    summary.recordCounts[type] = Array.isArray(data) ? data.length : 0;
  });

  // Extract key metrics from request analysis
  if (analysisResults.request && analysisResults.request.length > 0) {
    const requestData = analysisResults.request[0];
    summary.totalAgenticRequests = parseInt(requestData.total_agentic_requests || 0, 10);
    summary.totalOverallTraffic = parseInt(requestData.total_overall_traffic || 0, 10);

    // Extract agentic type breakdown
    const agentBreakdown = {};
    if (requestData.chatgpt_requests) {
      agentBreakdown.chatgpt = parseInt(requestData.chatgpt_requests, 10);
    }
    if (requestData.perplexity_requests) {
      agentBreakdown.perplexity = parseInt(requestData.perplexity_requests, 10);
    }
    if (requestData.claude_requests) {
      agentBreakdown.claude = parseInt(requestData.claude_requests, 10);
    }

    summary.agentTypeBreakdown = agentBreakdown;

    // Extract status code breakdown
    const statusBreakdown = {};
    if (requestData.status_2xx) statusBreakdown.status_2xx = parseInt(requestData.status_2xx, 10);
    if (requestData.status_3xx) statusBreakdown.status_3xx = parseInt(requestData.status_3xx, 10);
    if (requestData.status_401) statusBreakdown.status_401 = parseInt(requestData.status_401, 10);
    if (requestData.status_403) statusBreakdown.status_403 = parseInt(requestData.status_403, 10);
    if (requestData.status_404) statusBreakdown.status_404 = parseInt(requestData.status_404, 10);
    if (requestData.status_5xx) statusBreakdown.status_5xx = parseInt(requestData.status_5xx, 10);

    summary.statusCodeBreakdown = statusBreakdown;
  }

  // Calculate agent type diversity
  const activeAgentTypes = Object.keys(summary.agentTypeBreakdown).filter(
    (type) => summary.agentTypeBreakdown[type] > 0,
  );
  summary.uniqueAgentTypes = activeAgentTypes.length;

  // Calculate success rate from status codes
  const total2xx = summary.statusCodeBreakdown.status_2xx || 0;
  if (summary.totalAgenticRequests > 0) {
    summary.successRate = parseFloat(((total2xx / summary.totalAgenticRequests) * 100).toFixed(2));
  }

  // Extract geographic diversity
  if (analysisResults.geographic && Array.isArray(analysisResults.geographic)) {
    summary.geographicSummary.uniqueCountries = analysisResults.geographic.length;

    // Top 3 countries by traffic
    const topCountries = analysisResults.geographic
      .slice(0, 3)
      .map((country) => ({
        code: country.country_code,
        requests: parseInt(country.request_count || 0, 10),
      }));
    summary.geographicSummary.topCountries = topCountries;
  }

  // Extract URL analysis summary
  if (analysisResults.urlTraffic && Array.isArray(analysisResults.urlTraffic)) {
    summary.uniqueUrls = analysisResults.urlTraffic.length;
  }

  // Extract query source summary
  if (analysisResults.querySource && Array.isArray(analysisResults.querySource)) {
    summary.urlsWithUtmSource = analysisResults.querySource.length;
  }

  return summary;
}
/* c8 ignore stop */
