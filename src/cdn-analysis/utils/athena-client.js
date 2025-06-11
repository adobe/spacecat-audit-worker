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

/**
 * Parse Athena results into usable format
 */
export function parseAthenaResults(results) {
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
export async function waitForQueryExecution(athenaClient, queryExecutionId, maxAttempts = 60) {
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
export async function executeAthenaSetupQuery(athenaClient, query, description, s3Config, log) {
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
export async function executeAthenaQuery(athenaClient, query, s3Config, log, database = 'cdn_logs') {
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
/* c8 ignore stop */
