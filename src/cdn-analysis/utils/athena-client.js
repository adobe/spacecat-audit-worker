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
/* eslint-disable no-await-in-loop */

/* c8 ignore start */
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState,
} from '@aws-sdk/client-athena';
import { hasText, instrumentAWSClient } from '@adobe/spacecat-shared-utils';
import { sleep } from '../../support/utils.js';

export class AWSAthenaClient {
  /**
   * @param {import('@aws-sdk/client-athena').AthenaClient} client
   * @param {string} tempLocation   – S3 URI for Athena temp results
   * @param {{ info: Function, warn: Function, error: Function, debug: Function }} log
   * @param {object} opts
   * @param {number} [opts.backoffMs=100]
   * @param {number} [opts.maxRetries=3]
   * @param {number} [opts.pollIntervalMs=1000]
   * @param {number} [opts.maxPollAttempts=60]
   */
  constructor(client, tempLocation, log, opts = {}) {
    const {
      backoffMs = 100,
      maxRetries = 3,
      pollIntervalMs = 1000,
      maxPollAttempts = 60,
    } = opts;

    if (!hasText(tempLocation)) {
      throw new Error('"tempLocation" is required');
    }

    this.client = instrumentAWSClient(client);
    this.log = log;
    this.tempLocation = tempLocation;
    this.backoffMs = backoffMs;
    this.maxRetries = maxRetries;
    this.pollIntervalMs = pollIntervalMs;
    this.maxPollAttempts = maxPollAttempts;
  }

  /**
   * @param {object} context   – must contain `env.AWS_REGION` and `log`
   * @param {string} tempLocation   – S3 URI for Athena temp results
   * @param {object} opts      – same opts as constructor
   * @returns {AWSAthenaClient}
   */
  static fromContext(context, tempLocation, opts = {}) {
    if (context.athenaClient) return context.athenaClient;

    const { env = {}, log } = context;
    const region = env.AWS_REGION || 'us-east-1';
    const rawClient = new AthenaClient({ region });
    return new AWSAthenaClient(rawClient, tempLocation, log, opts);
  }

  /**
   * @private
   * Start the query, with retries on StartQueryExecution errors
   * @returns {Promise<string>} – QueryExecutionId
   */
  async #startQueryWithRetry(sql, database, description, backoffMs, maxRetries) {
    let lastError = new Error('No attempts were made');
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const { QueryExecutionId } = await this.client.send(
          new StartQueryExecutionCommand({
            QueryString: sql,
            QueryExecutionContext: { Database: database },
            ResultConfiguration: { OutputLocation: this.tempLocation },
          }),
        );
        if (!QueryExecutionId) {
          throw new Error('No QueryExecutionId returned');
        }
        this.log.debug(`[Athena Client] QueryExecutionId=${QueryExecutionId}`);
        return QueryExecutionId;
      } catch (err) {
        lastError = err;
        this.log.warn(`[Athena Client] Start attempt ${attempt} failed: ${err.message}`);
        if (attempt < maxRetries) {
          const waitMs = 2 ** attempt * backoffMs;
          this.log.debug(`[Athena Client] Retrying start in ${waitMs}ms`);
          // eslint-disable-next-line no-await-in-loop
          await sleep(waitMs);
        } else {
          this.log.error(`[Athena Client] All ${maxRetries} start attempts failed: ${lastError.message}`);
        }
      }
    }
    throw lastError;
  }

  /**
   * @private
   * Poll the given query until it finishes or fails
   */
  async #pollToCompletion(queryExecutionId, description, pollIntervalMs, maxPollAttempts) {
    // eslint-disable-next-line no-await-in-loop
    for (let i = 0; i < maxPollAttempts; i += 1) {
      await sleep(pollIntervalMs);
      const { QueryExecution } = await this.client.send(
        new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }),
      );
      const status = QueryExecution?.Status;
      if (!status) {
        throw new Error('No status returned');
      }

      const { State, StateChangeReason } = status;
      this.log.debug(`State=${State}`);

      if (State === QueryExecutionState.SUCCEEDED) {
        return;
      }
      if (State === QueryExecutionState.FAILED || State === QueryExecutionState.CANCELLED) {
        throw new Error(StateChangeReason || `Query ${State}`);
      }
    }
    throw new Error('[Athena Client] Polling timed out');
  }

  /**
   * Execute an Athena SQL query with retry + polling.
   *
   * @param {string} sql - sql query to run
   * @param {string} database - database to run against
   * @param {string} [description='Athena query'] – human-readable for logs
   * @param {object} [opts]
   * @param {number} [opts.backoffMs]
   * @param {number} [opts.maxRetries]
   * @param {number} [opts.pollIntervalMs]
   * @param {number} [opts.maxPollAttempts]
   * @returns {Promise<string>} – QueryExecutionId
   */
  async execute(sql, database, description = 'Athena query', opts = {}) {
    const {
      backoffMs = this.backoffMs,
      maxRetries = this.maxRetries,
      pollIntervalMs = this.pollIntervalMs,
      maxPollAttempts = this.maxPollAttempts,
    } = opts;

    this.log.info(`[Athena Client] Starting ${description}`);
    const startTime = Date.now();

    // start the query with retry logic
    const queryExecutionId = await this.#startQueryWithRetry(
      sql,
      database,
      description,
      backoffMs,
      maxRetries,
    );

    // poll to completion (throws on failure or timeout)
    await this.#pollToCompletion(
      queryExecutionId,
      description,
      pollIntervalMs,
      maxPollAttempts,
    );

    const durationMs = Date.now() - startTime;
    this.log.info(`[Athena Client] ${description} finished in ${durationMs}ms`);

    return queryExecutionId;
  }
}
/* c8 ignore stop */
