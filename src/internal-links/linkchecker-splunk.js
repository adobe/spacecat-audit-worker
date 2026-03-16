/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { createSplunkClient } from '../support/splunk-client-loader.js';
import { getTimeoutStatus } from './batch-state.js';
import { sleep } from '../support/utils.js';

const DEFAULT_LOOKBACK_MINUTES = 1440; // 24 hours
const DEFAULT_MAX_RESULTS = 10000;
const TRANSIENT_SPLUNK_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const SPLUNK_REQUEST_MAX_RETRIES = 3;
const SPLUNK_RETRY_BASE_DELAY_MS = 1000;

function escapeSplunkString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getSplunkSearchNamespace(context = {}) {
  const configuredNamespace = context?.env?.SPLUNK_SEARCH_NAMESPACE;
  /* c8 ignore next - fallback coercion branch */
  const normalizedNamespace = String(configuredNamespace || '').replace(/^\/+|\/+$/g, '');

  if (!normalizedNamespace) {
    throw new Error('SPLUNK_SEARCH_NAMESPACE must be configured for internal-links LinkChecker');
  }

  return normalizedNamespace;
}

async function fetchSplunkAPIWithRetry(client, request, log) {
  const { url, options, operation } = request;
  const runAttempt = async (attempt) => {
    try {
      const response = await client.fetchAPI(url, options);

      if (
        TRANSIENT_SPLUNK_STATUS_CODES.has(response.status)
        && attempt < SPLUNK_REQUEST_MAX_RETRIES
      ) {
        const delayMs = SPLUNK_RETRY_BASE_DELAY_MS * attempt;
        log.warn(
          `[linkchecker-splunk] ${operation} returned transient status ${response.status}; retrying in ${delayMs}ms (attempt ${attempt}/${SPLUNK_REQUEST_MAX_RETRIES})`,
        );
        await sleep(delayMs);
        return runAttempt(attempt + 1);
      }

      return response;
    } catch (error) {
      if (attempt === SPLUNK_REQUEST_MAX_RETRIES) {
        throw error;
      }

      const delayMs = SPLUNK_RETRY_BASE_DELAY_MS * attempt;
      log.warn(`[linkchecker-splunk] ${operation} failed with transient error: ${error.message}; retrying in ${delayMs}ms (attempt ${attempt}/${SPLUNK_REQUEST_MAX_RETRIES})`);
      await sleep(delayMs);
      return runAttempt(attempt + 1);
    }
  };

  return runAttempt(1);
}

/**
 * Build Splunk search query for LinkChecker broken internal links.
 * Searches for log entries where LinkChecker removed internal links from rendering.
 * Requires AEM feature toggle FT_SITES-39847 to be enabled.
 *
 * @param {object} params - Query parameters
 * @param {string} params.programId - AEM program ID
 * @param {string} params.environmentId - AEM environment ID
 * @param {number} [params.lookbackMinutes=1440] - How far back to search (default 24 hours)
 * @param {number} [params.maxResults=10000] - Maximum results to return
 * @returns {string} Splunk search query
 */
export function buildLinkCheckerQuery({
  programId,
  environmentId,
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
  maxResults = DEFAULT_MAX_RESULTS,
}) {
  // Query structure:
  // 1. Base index and time range
  // 2. Filter by program and environment (automatically logged by AEM)
  // 3. Filter for LinkChecker internal link removal events (FT_SITES-39847)
  // 4. Parse JSON structure
  // 5. Extract fields and limit results
  return [
    'search',
    'index=dx_aem_engineering',
    `earliest=-${lookbackMinutes}m@m`,
    'latest=@m',
    `aem_program_id="${escapeSplunkString(programId)}"`,
    `aem_envId="${escapeSplunkString(environmentId)}"`,
    '"linkchecker.removed_internal_link"', // FT_SITES-39847 ensures this field exists
    '| spath', // Parse JSON structure
    '| rename linkchecker.removed_internal_link.urlFrom as urlFrom',
    '| rename linkchecker.removed_internal_link.urlTo as urlTo',
    '| rename linkchecker.removed_internal_link.validity as validity',
    '| rename linkchecker.removed_internal_link.elementName as elementName',
    '| rename linkchecker.removed_internal_link.attributeName as attributeName',
    '| rename linkchecker.removed_internal_link.itemType as itemType',
    '| rename linkchecker.removed_internal_link.anchorText as anchorText',
    '| rename linkchecker.removed_internal_link.httpStatus as httpStatus',
    '| rename linkchecker.removed_internal_link.timestamp as timestamp',
    '| where isnotnull(urlFrom) AND isnotnull(urlTo)',
    '| dedup urlFrom, urlTo, itemType',
    '| table urlFrom, urlTo, validity, elementName, attributeName, itemType, anchorText, httpStatus, timestamp',
    `| head ${maxResults}`,
  ].join(' ');
}

/**
 * Submit an async Splunk search job.
 *
 * @param {object} client - SplunkAPIClient instance
 * @param {string} searchQuery - Splunk search query string
 * @param {object} log - Logger instance
 * @returns {Promise<string>} Job ID (sid)
 * @throws {Error} If job submission fails
 */
export async function submitSplunkJob(client, searchQuery, log) {
  log.info('[linkchecker-splunk] Submitting async Splunk job');

  const loginObj = client.loginObj || await client.login();
  if (loginObj?.error) {
    const err = loginObj.error;
    /* c8 ignore next - covered via equivalent branch in submit/fetch paths */
    throw (err instanceof Error ? err : new Error(String(err)));
  }

  const queryBody = new URLSearchParams({
    search: searchQuery,
    exec_mode: 'normal', // Async job
    output_mode: 'json',
  });

  const namespace = getSplunkSearchNamespace({ env: client.env });
  const url = `${client.apiBaseUrl}/servicesNS/${namespace}/search/search/jobs`;
  const response = await fetchSplunkAPIWithRetry(client, {
    url,
    operation: 'Splunk job submission',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Splunk ${loginObj.sessionId}`,
        Cookie: loginObj.cookie,
      },
      body: queryBody,
    },
  }, log);

  if (response.status !== 201) {
    const body = await response.text();
    throw new Error(`Splunk job submission failed. Status: ${response.status}. Body: ${body}`);
  }

  const result = await response.json();
  const { sid } = result;

  if (!sid) {
    throw new Error('Splunk job submission did not return a job ID (sid)');
  }

  log.info(`[linkchecker-splunk] Job submitted successfully. sid=${sid}`);
  return sid;
}

/**
 * Poll the status of a Splunk search job.
 *
 * @param {object} client - SplunkAPIClient instance
 * @param {string} sid - Job ID
 * @param {object} log - Logger instance
 * @returns {Promise<object>} Job status object with properties:
 *   - isDone {boolean} - Whether job is complete
 *   - isFailed {boolean} - Whether job failed
 *   - dispatchState {string} - Job dispatch state
 *   - resultCount {number} - Number of results (if done)
 * @throws {Error} If status check fails
 */
export async function pollJobStatus(client, sid, log) {
  log.info(`[linkchecker-splunk] Polling job status for sid=${sid}`);

  const loginObj = client.loginObj || await client.login();
  if (loginObj?.error) {
    const err = loginObj.error;
    /* c8 ignore next - equivalent branch covered in fetchJobResults */
    throw (err instanceof Error ? err : new Error(String(err)));
  }

  const namespace = getSplunkSearchNamespace({ env: client.env });
  const url = `${client.apiBaseUrl}/servicesNS/${namespace}/search/search/jobs/${encodeURIComponent(sid)}?output_mode=json`;
  const response = await fetchSplunkAPIWithRetry(client, {
    url,
    operation: `Splunk job status check for sid=${sid}`,
    options: {
      method: 'GET',
      headers: {
        Authorization: `Splunk ${loginObj.sessionId}`,
        Cookie: loginObj.cookie,
      },
    },
  }, log);

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Splunk job status check failed. Status: ${response.status}. Body: ${body}`);
  }

  const result = await response.json();
  const entry = result.entry?.[0];
  const content = entry?.content;

  if (!content) {
    throw new Error('Splunk job status response missing content');
  }

  const isDone = content.isDone === true || content.dispatchState === 'DONE';
  const isFailed = content.isFailed === true || content.dispatchState === 'FAILED';
  /* c8 ignore next - fallback when Splunk omits dispatchState */
  const dispatchState = content.dispatchState || 'UNKNOWN';
  const resultCount = parseInt(content.resultCount, 10) || 0;

  log.info(`[linkchecker-splunk] Job status: isDone=${isDone}, isFailed=${isFailed}, dispatchState=${dispatchState}, resultCount=${resultCount}`);

  return {
    isDone,
    isFailed,
    dispatchState,
    resultCount,
  };
}

/**
 * Fetch results from a completed Splunk search job.
 *
 * @param {object} client - SplunkAPIClient instance
 * @param {string} sid - Job ID
 * @param {object} log - Logger instance
 * @returns {Promise<Array<object>>} Array of result objects with fields:
 *   - urlFrom {string} - Source page URL
 *   - urlTo {string} - Broken link destination URL
 *   - validity {string} - Link validity: INVALID, EXPIRED, PREDATED, or UNKNOWN
 *   - elementName {string} - HTML element type: a, img, script, link, etc.
 *   - attributeName {string} - Link attribute: href, src, action
 *   - itemType {string} - Semantic type: link, image, script, stylesheet, etc.
 *   - anchorText {string} - Link anchor text (currently empty string)
 *   - httpStatus {string|number} - HTTP status code (currently "404")
 *   - timestamp {number} - Unix timestamp in milliseconds
 * @throws {Error} If fetch fails
 */
export async function fetchJobResults(client, sid, log) {
  log.info(`[linkchecker-splunk] Fetching results for sid=${sid}`);

  const loginObj = client.loginObj || await client.login();
  if (loginObj?.error) {
    const err = loginObj.error;
    /* c8 ignore next - covered via equivalent branch in submit/poll paths */
    throw (err instanceof Error ? err : new Error(String(err)));
  }

  const namespace = getSplunkSearchNamespace({ env: client.env });
  const url = `${client.apiBaseUrl}/servicesNS/${namespace}/search/search/jobs/${encodeURIComponent(sid)}/results?output_mode=json&count=0`;
  const response = await fetchSplunkAPIWithRetry(client, {
    url,
    operation: `Splunk job results fetch for sid=${sid}`,
    options: {
      method: 'GET',
      headers: {
        Authorization: `Splunk ${loginObj.sessionId}`,
        Cookie: loginObj.cookie,
      },
    },
  }, log);

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Splunk job results fetch failed. Status: ${response.status}. Body: ${body}`);
  }

  const result = await response.json();
  const results = result.results || [];

  log.info(`[linkchecker-splunk] Fetched ${results.length} results`);

  return results.map((r) => ({
    urlFrom: r.urlFrom || '',
    urlTo: r.urlTo || '',
    validity: r.validity || 'UNKNOWN',
    elementName: r.elementName || 'a',
    attributeName: r.attributeName || 'href',
    itemType: r.itemType || 'link',
    anchorText: r.anchorText || '',
    httpStatus: r.httpStatus || 'unknown',
    timestamp: r.timestamp ? parseInt(r.timestamp, 10) : Date.now(),
  }));
}

/**
 * Process LinkChecker logs from Splunk.
 * Complete workflow: submit job → poll until done → fetch results.
 * This is the synchronous version for testing or when timeout is not a concern.
 *
 * @param {object} params - Parameters
 * @param {string} params.programId - AEM program ID
 * @param {string} params.environmentId - AEM environment ID
 * @param {number} [params.lookbackMinutes=1440] - Lookback window
 * @param {object} params.context - Lambda context with log and env
 * @returns {Promise<Array<object>>} Array of broken link records
 */
export async function fetchLinkCheckerLogs({
  programId,
  environmentId,
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
  context,
}) {
  const { log } = context;

  // Dynamic import to avoid loading external dependency at module load time
  const client = await createSplunkClient(context);
  client.env = context?.env;
  await client.login();

  const searchQuery = buildLinkCheckerQuery({
    programId,
    environmentId,
    lookbackMinutes,
  });

  log.info('[linkchecker-splunk] Built search query', { searchQuery: searchQuery.slice(0, 200) });

  const sid = await submitSplunkJob(client, searchQuery, log);

  // Poll until done (with timeout)
  const maxPollAttempts = 30; // 30 attempts * 2 seconds = 1 minute max
  const pollIntervalMs = 2000;
  const lambdaStartTime = context?.lambdaStartTime;

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
    if (lambdaStartTime !== undefined
      && lambdaStartTime !== null
      && getTimeoutStatus(lambdaStartTime, context).isApproachingTimeout) {
      throw new Error(`Splunk job polling aborted due to Lambda timeout guard. sid=${sid}`);
    }

    // eslint-disable-next-line no-await-in-loop
    const status = await pollJobStatus(client, sid, log);

    if (status.isFailed) {
      throw new Error(`Splunk job failed. sid=${sid}, dispatchState=${status.dispatchState}`);
    }

    if (status.isDone) {
      log.info(`[linkchecker-splunk] Job completed after ${attempt} poll(s)`);
      // eslint-disable-next-line no-await-in-loop
      const results = await fetchJobResults(client, sid, log);
      return results;
    }

    log.info(`[linkchecker-splunk] Job not ready, waiting ${pollIntervalMs}ms before retry (attempt ${attempt}/${maxPollAttempts})`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(pollIntervalMs);
  }

  throw new Error(`Splunk job polling timeout after ${maxPollAttempts} attempts. sid=${sid}`);
}
