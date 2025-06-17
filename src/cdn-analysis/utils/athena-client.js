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
import {
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';

/**
 * Polls Athena until the query finishes (SUCCEEDED, FAILED, or CANCELLED).
 * @param {AthenaClient} client
 * @param {string} queryExecutionId
 * @param {number} [maxAttempts=60]
 * @throws {Error} if the query fails or times out
 */
export async function waitForCompletion(client, queryExecutionId, maxAttempts = 60) {
  let attempts = 0;

  // Poll every second until success or failure
  // eslint-disable-next-line no-constant-condition
  while (attempts < maxAttempts) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });

    // eslint-disable-next-line no-await-in-loop
    const { QueryExecution } = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }),
    );
    const { State, StateChangeReason } = QueryExecution.Status;

    if (State === 'SUCCEEDED') {
      return;
    }

    if (State === 'FAILED' || State === 'CANCELLED') {
      throw new Error(StateChangeReason || `Athena query ${State}`);
    }

    attempts += 1;
  }

  throw new Error('Athena query polling timed out');
}

/**
 * Flattens Athena GetQueryResultsCommand output into an array of objects.
 * @param {object} result
 * @returns {Array<Record<string, string>>}
 */
export function parseResults(result) {
  const rows = result.ResultSet?.Rows ?? [];
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].Data.map((col) => col.VarCharValue || '');

  return rows.slice(1).map((row) => {
    const record = {};
    row.Data.forEach((col, index) => {
      record[headers[index]] = col.VarCharValue || '';
    });
    return record;
  });
}

/**
 * Executes a DDL or setup query (e.g., CREATE TABLE) in Athena.
 * @param {AthenaClient} athenaClient
 * @param {string} sql
 * @param {string} description
 * @param {{ getAthenaTempLocation: () => string }} s3Config
 * @param {{ info: Function, warn: Function }} log
 */
export async function executeAthenaSetupQuery(athenaClient, sql, description, s3Config, log) {
  try {
    log.info(`Setting up ${description}...`);

    const startResult = await athenaClient.send(
      new StartQueryExecutionCommand({
        QueryString: sql,
        QueryExecutionContext: { Database: 'default' },
        ResultConfiguration: { OutputLocation: s3Config.getAthenaTempLocation() },
      }),
    );

    await waitForCompletion(athenaClient, startResult.QueryExecutionId);

    log.info(`${description} setup completed`);
  } catch (error) {
    log.warn(`${description} setup warning: ${error.message}`);
    // Continue even if setup had issues (e.g., table already exists)
  }
}

/**
 * Executes a query in Athena and returns parsed results.
 * @param {AthenaClient} athenaClient
 * @param {string} sql
 * @param {{ getAthenaTempLocation: () => string }} s3Config
 * @param {{ info: Function }} log
 * @param {string} [database='cdn_logs']
 * @returns {Promise<Array<Record<string, string>>>}
 */
export async function executeAthenaQuery(athenaClient, sql, s3Config, log, database = 'cdn_logs') {
  log.info('Executing Athena query');

  const startResult = await athenaClient.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: { Database: database },
      ResultConfiguration: { OutputLocation: s3Config.getAthenaTempLocation() },
    }),
  );

  await waitForCompletion(athenaClient, startResult.QueryExecutionId);

  const results = await athenaClient.send(
    new GetQueryResultsCommand({ QueryExecutionId: startResult.QueryExecutionId }),
  );

  return parseResults(results);
}
/* c8 ignore stop */
