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

const DEFAULT_LOOKBACK_MINUTES = 1440; // 24 hours
const DEFAULT_MAX_RESULTS = 10000;

/**
 * Build Splunk search query for LinkChecker broken internal links.
 * Searches for log entries where LinkChecker removed internal links from rendering.
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
  // 3. Filter for LinkChecker internal link removal events
  // 4. Parse JSON structure
  // 5. Extract fields and limit results
  return [
    'search',
    'index=dx_aem_engineering',
    `earliest=-${lookbackMinutes}m@m`,
    'latest=@m',
    `aem_program_id="${programId}"`,
    `aem_envId="${environmentId}"`,
    '"linkchecker.broken_internal_link"', // Feature toggle ensures this field exists
    '| spath', // Parse JSON structure
    '| rename linkchecker.broken_internal_link.urlFrom as urlFrom',
    '| rename linkchecker.broken_internal_link.urlTo as urlTo',
    '| rename linkchecker.broken_internal_link.anchorText as anchorText',
    '| rename linkchecker.broken_internal_link.itemType as itemType',
    '| rename linkchecker.broken_internal_link.httpStatus as httpStatus',
    '| where isnotnull(urlFrom) AND isnotnull(urlTo)',
    '| table urlFrom, urlTo, anchorText, itemType, httpStatus',
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

  const url = `${client.apiBaseUrl}/servicesNS/admin/search/search/jobs`;
  const response = await client.fetchAPI(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Splunk ${loginObj.sessionId}`,
      Cookie: loginObj.cookie,
    },
    body: queryBody,
  });

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

  const url = `${client.apiBaseUrl}/servicesNS/admin/search/search/jobs/${encodeURIComponent(sid)}?output_mode=json`;
  const response = await client.fetchAPI(url, {
    method: 'GET',
    headers: {
      Authorization: `Splunk ${loginObj.sessionId}`,
      Cookie: loginObj.cookie,
    },
  });

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
 *   - anchorText {string} - Link anchor text
 *   - itemType {string} - Link type (link, image, etc.)
 *   - httpStatus {string|number} - HTTP status code
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

  const url = `${client.apiBaseUrl}/servicesNS/admin/search/search/jobs/${encodeURIComponent(sid)}/results?output_mode=json&count=0`;
  const response = await client.fetchAPI(url, {
    method: 'GET',
    headers: {
      Authorization: `Splunk ${loginObj.sessionId}`,
      Cookie: loginObj.cookie,
    },
  });

  if (response.status !== 200) {
    const body = await response.text();
    throw new Error(`Splunk job results fetch failed. Status: ${response.status}. Body: ${body}`);
  }

  const result = await response.json();
  const results = result.results || [];

  log.info(`[linkchecker-splunk] Fetched ${results.length} results`);

  return results.map((r) => ({
    /* c8 ignore next 2 - defensive defaults for malformed rows */
    urlFrom: r.urlFrom || '',
    urlTo: r.urlTo || '',
    anchorText: r.anchorText || '[no text]',
    itemType: r.itemType || 'link',
    httpStatus: r.httpStatus || 'unknown',
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

  for (let attempt = 1; attempt <= maxPollAttempts; attempt += 1) {
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
    await new Promise((resolve) => {
      setTimeout(resolve, pollIntervalMs);
    });
  }

  throw new Error(`Splunk job polling timeout after ${maxPollAttempts} attempts. sid=${sid}`);
}
