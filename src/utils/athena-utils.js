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

import { StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';

/* c8 ignore start */
/**
 * Retry configuration for Athena operations
 */
const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableErrors: [
    'TooManyRequestsException',
    'ThrottlingException',
    'InternalServerException',
    'ServiceUnavailableException',
    'RequestTimeoutException',
  ],
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
  if (!error) return false;

  // Check AWS SDK error codes
  if (error.name && RETRY_CONFIG.retryableErrors.includes(error.name)) {
    return true;
  }

  // Check for throttling in message
  if (error.message && error.message.toLowerCase().includes('throttl')) {
    return true;
  }

  // Check for rate limit
  if (error.message && error.message.toLowerCase().includes('rate limit')) {
    return true;
  }

  return false;
}

/**
 * Execute function with exponential backoff retry
 */
async function executeWithRetry(fn, operation, log) {
  let lastError;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === RETRY_CONFIG.maxAttempts || !isRetryableError(error)) {
        // Last attempt or non-retryable error
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        RETRY_CONFIG.baseDelayMs * 2 ** (attempt - 1),
        RETRY_CONFIG.maxDelayMs,
      );

      log.warn(`${operation} attempt ${attempt} failed, retrying in ${delay}ms:`, {
        error: error.message,
        errorCode: error.name,
        attempt,
        maxAttempts: RETRY_CONFIG.maxAttempts,
      });

      // eslint-disable-next-line no-await-in-loop
      await sleep(delay);
    }
  }

  throw lastError;
}

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

  while (attempts < maxAttempts) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
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

    await executeWithRetry(async () => {
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
    }, `${description} setup`, log);
  } catch (error) {
    log.warn(`⚠️ ${description} setup warning:`, error.message);
    // Don't throw - continue with analysis even if setup has issues
  }
}

/**
 * Execute Athena query and return results
 */
export async function executeAthenaQuery(athenaClient, query, s3Config, log, database = 'cdn_logs') {
  return executeWithRetry(async () => {
    // Start query execution with retry
    const startCommand = new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: {
        OutputLocation: s3Config.getAthenaTempLocation(),
      },
    });

    const startResult = await athenaClient.send(startCommand);
    const queryExecutionId = startResult.QueryExecutionId;

    // Wait for query completion (this includes its own retry logic)
    const queryExecution = await waitForQueryExecution(athenaClient, queryExecutionId);

    if (queryExecution.QueryExecution.Status.State !== 'SUCCEEDED') {
      const errorMessage = queryExecution.QueryExecution.Status.StateChangeReason || 'Unknown query failure';
      const error = new Error(`Query failed: ${errorMessage}`);

      // Mark certain query failures as retryable
      if (errorMessage.toLowerCase().includes('resource')
        || errorMessage.toLowerCase().includes('capacity')
        || errorMessage.toLowerCase().includes('limit')) {
        error.name = 'ThrottlingException';
      }

      throw error;
    }

    // Get query results with retry
    const resultsCommand = new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId });
    const results = await athenaClient.send(resultsCommand);

    return parseAthenaResults(results);
  }, 'Athena query execution', log);
}

/* c8 ignore end */
