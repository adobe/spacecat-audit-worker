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

/**
 * NET-NEW publish path for the strategic-recommendations workbook.
 *
 * The shared `report-uploader.publishToAdminHlx` SWALLOWS non-200 responses
 * (logs and returns, never throws) — so a failed CDN publish would look like a
 * success. This module deliberately does NOT reuse it. Instead it:
 *
 *  1. POSTs to admin.hlx.page preview + live and THROWS on any non-2xx, so a
 *     publish failure is surfaced to the handler (which must not return ok()).
 *  2. Performs a post-publish READ-BACK: GETs the freshly published live JSON and
 *     confirms the row count (and `generated_at`, when available) matches what we
 *     just wrote. This catches the "200-but-stale-CDN" case where the publish
 *     call succeeded but the edge is still serving the old document.
 */

import { sleep } from '../support/utils.js';

const ORG = 'adobe';
const SITE = 'project-elmo-ui-data';
const REF = 'main';
const ADMIN_BASE = 'https://admin.hlx.page';
const LIVE_BASE = `https://${REF}--${SITE}--${ORG}.hlx.live`;
const PUBLISH_STEP_DELAY_MS = 2000;
const READBACK_MAX_ATTEMPTS = 3;
const READBACK_DELAY_MS = 3000;

/**
 * HLX strips the `shared-` worksheet prefix when building the JSON; the
 * `shared-Semrush` sheet surfaces under the `Semrush` key. The multi-sheet JSON
 * is `{ ":names": [...], "Semrush": { data: [...] }, ... }`.
 */
const SEMRUSH_JSON_KEY = 'Semrush';

function toJsonPath(filename, outputLocation) {
  const jsonFilename = `${filename.replace(/\.[^/.]+$/, '')}.json`;
  return `${outputLocation}/${jsonFilename}`;
}

/**
 * Extracts the Semrush rows out of the published multi-sheet HLX JSON, tolerating
 * both the single-sheet shape ({ data: [...] }) and the multi-sheet shape
 * ({ Semrush: { data: [...] } }).
 *
 * @param {object} json
 * @returns {Array<object>|null} rows, or null if the Semrush sheet is absent.
 */
export function extractSemrushRows(json) {
  if (!json || typeof json !== 'object') {
    return null;
  }
  // A multi-sheet HLX document carries a `:names`/`:type` envelope. In that shape
  // the Semrush rows MUST live under the `Semrush` key — we deliberately do NOT
  // fall through to the envelope itself, otherwise any multi-sheet doc that
  // happens to expose some other top-level `data` array would masquerade as a
  // successful read-back. Single-sheet docs ({ data: [...] }) still pass through.
  const isMultiSheet = Array.isArray(json[':names']) || json[':type'] === 'multi-sheet';
  let sheet;
  if (Object.prototype.hasOwnProperty.call(json, SEMRUSH_JSON_KEY)) {
    sheet = json[SEMRUSH_JSON_KEY];
  } else if (isMultiSheet) {
    return null;
  } else {
    sheet = json;
  }
  if (sheet && Array.isArray(sheet.data)) {
    return sheet.data;
  }
  return null;
}

/**
 * Fetches the published live JSON and confirms it reflects what we wrote. Retries
 * a few times to absorb edge-propagation latency before declaring a stale-CDN
 * failure.
 */
async function readBack({
  path, expectedRowCount, expectedGeneratedAt, log, fetchImpl,
}) {
  let lastReason = 'unknown';

  for (let attempt = 1; attempt <= READBACK_MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(READBACK_DELAY_MS);
    }
    // Cache-bust per attempt so a retry never re-hits the same stale CDN edge that
    // served the pre-publish document on the previous attempt.
    const url = `${LIVE_BASE}/${path}?cb=${Date.now()}-${attempt}`;
    let json;
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetchImpl(url, { method: 'GET' });
      if (!response.ok) {
        lastReason = `read-back fetch failed: ${response.status} ${response.statusText}`;
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      json = await response.json();
    } catch (e) {
      lastReason = `read-back fetch error: ${e.message}`;
      // eslint-disable-next-line no-continue
      continue;
    }

    const rows = extractSemrushRows(json);
    if (rows === null) {
      lastReason = 'read-back JSON did not contain a Semrush sheet';
      // eslint-disable-next-line no-continue
      continue;
    }
    if (rows.length !== expectedRowCount) {
      lastReason = `read-back row count ${rows.length} != expected ${expectedRowCount} (stale CDN?)`;
      // eslint-disable-next-line no-continue
      continue;
    }
    if (expectedGeneratedAt) {
      const seen = json.generated_at
        ?? json[SEMRUSH_JSON_KEY]?.generated_at
        ?? (rows[0] && rows[0].generated_at);
      if (seen && seen !== expectedGeneratedAt) {
        lastReason = `read-back generated_at ${seen} != expected ${expectedGeneratedAt} (stale CDN?)`;
        // eslint-disable-next-line no-continue
        continue;
      }
    }

    log.info(`STRATEGIC_RECOMMENDATIONS_SEMRUSH: post-publish read-back OK (${rows.length} rows) on attempt ${attempt}`);
    return;
  }

  throw new Error(`post-publish read-back failed after ${READBACK_MAX_ATTEMPTS} attempts: ${lastReason}`);
}

/**
 * Publishes a workbook to admin.hlx.page (preview + live), surfacing any non-2xx
 * by throwing, then reads the published live JSON back to confirm the write
 * landed.
 *
 * @param {object} params
 * @param {string} params.filename - Workbook filename (e.g. strategic-recommendations.xlsx).
 * @param {string} params.outputLocation - SharePoint folder path (relative).
 * @param {number} params.expectedRowCount - Number of Semrush rows just written.
 * @param {string|null} params.expectedGeneratedAt - Stamp to confirm on read-back, if any.
 * @param {string} params.adminApiKey - admin.hlx.page auth token (context.env.ADMIN_HLX_API_KEY).
 * @param {object} params.log - Logger.
 * @param {Function} params.fetchImpl - fetch implementation (injectable for tests).
 * @throws {Error} on a missing admin API key, any publish non-2xx, or a read-back mismatch.
 */
export async function publishWorkbookWithReadback({
  filename,
  outputLocation,
  expectedRowCount,
  expectedGeneratedAt,
  adminApiKey,
  log,
  fetchImpl,
}) {
  if (!adminApiKey || typeof adminApiKey !== 'string') {
    throw new Error('publish aborted: ADMIN_HLX_API_KEY is not configured');
  }
  const path = toJsonPath(filename, outputLocation);
  const headers = { Cookie: `auth_token=${adminApiKey}` };

  const endpoints = [
    { name: 'preview', url: `${ADMIN_BASE}/preview/${ORG}/${SITE}/${REF}/${path}` },
    { name: 'live', url: `${ADMIN_BASE}/live/${ORG}/${SITE}/${REF}/${path}` },
  ];

  for (const endpoint of endpoints) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(PUBLISH_STEP_DELAY_MS);
    log.info(`STRATEGIC_RECOMMENDATIONS_SEMRUSH: publishing to ${endpoint.name}: ${endpoint.url}`);
    // eslint-disable-next-line no-await-in-loop
    const response = await fetchImpl(endpoint.url, { method: 'POST', headers });
    if (!response.ok) {
      // SURFACE the failure — unlike publishToAdminHlx, do not swallow it.
      throw new Error(`publish to ${endpoint.name} failed: ${response.status} ${response.statusText}`);
    }
    log.info(`STRATEGIC_RECOMMENDATIONS_SEMRUSH: published to ${endpoint.name}`);
  }

  await readBack({
    path, expectedRowCount, expectedGeneratedAt, log, fetchImpl,
  });
}

export default publishWorkbookWithReadback;
