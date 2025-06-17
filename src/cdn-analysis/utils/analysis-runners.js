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
import { RequestAnalysisQuery } from '../queries/request-analysis.js';
import { UrlTrafficAnalysisQuery } from '../queries/url-traffic-analysis.js';
import { UserAgentRequestAnalysisQuery } from '../queries/user-agent-request-analysis.js';
import { QuerySourceAnalysisQuery } from '../queries/query-source-analysis.js';
import { UrlUserAgentStatusAnalysisQuery } from '../queries/url-user-agent-status-analysis.js';
import { UrlStatusAnalysisQuery } from '../queries/url-status-analysis.js';
import { GeographicAnalysisQuery } from '../queries/geographic-analysis.js';

/**
 * Run all 7 agentic analyses in parallel and summarize results
 */
export async function runAllAnalysis(athenaClient, hour, s3Config, tableName, cdnProvider, log) {
  const databaseName = cdnProvider.getDatabaseName();
  const queries = [
    new RequestAnalysisQuery(hour, tableName, s3Config),
    new UrlTrafficAnalysisQuery(hour, tableName, s3Config),
    new UserAgentRequestAnalysisQuery(hour, tableName, s3Config),
    new QuerySourceAnalysisQuery(hour, tableName, s3Config),
    new UrlUserAgentStatusAnalysisQuery(hour, tableName, s3Config),
    new UrlStatusAnalysisQuery(hour, tableName, s3Config),
    new GeographicAnalysisQuery(hour, tableName, s3Config),
  ];

  const analysisTypes = queries.map((q) => q.constructor.analysisType);

  const results = await Promise.allSettled(
    queries.map((q) => q.run(athenaClient, log, databaseName)),
  );

  const failures = results.filter((r) => r.status === 'rejected');
  const successes = results.filter((r) => r.status === 'fulfilled');

  if (failures.length > 0) {
    log.error(`${failures.length} analysis UNLOAD operations failed:`, {
      failures: failures.map((f, i) => ({
        analysisIndex: i,
        error: f.reason?.message || f.reason,
      })),
    });

    if (failures.length > successes.length) {
      throw new Error(`Critical failure: ${failures.length}/${results.length} analysis UNLOADs failed`);
    }
  }

  log.info(`All analysis UNLOAD operations completed: ${successes.length} succeeded, ${failures.length} failed`);

  return {
    analysisTypes,
    completed: successes.length,
    failed: failures.length,
    total: results.length,
  };
}
/* c8 ignore stop */
