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

import { ok, internalServerError } from '@adobe/spacecat-shared-http-utils';
import { tracingFetch } from '@adobe/spacecat-shared-utils';
import ExcelJS from 'exceljs';
import {
  createLLMOSharepointClient,
  readFromSharePoint,
  uploadToSharePoint,
} from '../utils/report-uploader.js';
import { scrubUrlForLog } from '../utils/analysis-fetch.js';
import { assertResultLocation } from './result-location.js';
import { publishWorkbookWithReadback } from './publish.js';
import { mergeRowsByKey } from './merge.js';
import { validateSemrushRows, validateCitationRows, validatePersonaRows } from './schema-validate.js';
import {
  SEMRUSH_SHEET,
  CITATION_SHEET,
  PERSONAS_SHEET,
  NOTES_SHEET,
  SEMRUSH_JSON_KEY,
  CITATION_JSON_KEY,
  PERSONAS_JSON_KEY,
  SEMRUSH_COLUMNS,
  CITATION_COLUMNS,
  PERSONA_COLUMNS,
  WORKBOOK_FILENAME,
} from './constants.js';
import { postMessageSafe } from '../utils/slack-utils.js';

const AUDIT_NAME = 'STRATEGIC_RECOMMENDATIONS_SEMRUSH';
const MAX_RESULT_BYTES = 25 * 1024 * 1024; // 25 MB
const RESULT_FETCH_TIMEOUT_MS = 30_000;

/**
 * The three worksheets written on every run. `jsonKey` is the key in the DRS
 * result `sheets` map (the un-prefixed, HLX-stripped name); `sheetName` is the
 * `shared-*` worksheet name. `primary: true` marks the Semrush sheet — the only
 * one whose emptiness fails the run (the auxiliary sheets are best-effort and a
 * header-only sheet is a valid "no data yet" outcome). Each sheet preserves the
 * UI's `deleted` markers across refreshes by its own `matchKeyFields`.
 */
const SHEET_SPECS = [
  {
    jsonKey: SEMRUSH_JSON_KEY,
    sheetName: SEMRUSH_SHEET,
    columns: SEMRUSH_COLUMNS,
    matchKeyFields: ['topic_id', 'prompt'],
    validate: validateSemrushRows,
    primary: true,
  },
  {
    jsonKey: CITATION_JSON_KEY,
    sheetName: CITATION_SHEET,
    columns: CITATION_COLUMNS,
    matchKeyFields: ['source_url', 'prompt'],
    validate: validateCitationRows,
    primary: false,
  },
  {
    jsonKey: PERSONAS_JSON_KEY,
    sheetName: PERSONAS_SHEET,
    columns: PERSONA_COLUMNS,
    matchKeyFields: ['category', 'prompt'],
    validate: validatePersonaRows,
    primary: false,
  },
];

/**
 * Normalizes the DRS result into the `{ jsonKey: rows }` sheets map. New
 * producers emit `result.sheets`; older producers only emit `result.rows` (the
 * Semrush sheet) — that transition shape is mapped to `{ Semrush: rows }`.
 *
 * @param {object} result
 * @returns {object} A sheets map keyed by un-prefixed sheet name.
 */
function normalizeSheets(result) {
  if (result.sheets && typeof result.sheets === 'object' && !Array.isArray(result.sheets)) {
    return result.sheets;
  }
  return { [SEMRUSH_JSON_KEY]: Array.isArray(result.rows) ? result.rows : [] };
}

/**
 * Validates each known sheet against its vendored contract and returns the
 * per-sheet new-row arrays keyed by jsonKey. Pure (no IO, no alerting) so the
 * caller owns the single failure path. The Semrush sheet additionally fails when
 * empty; auxiliary sheets may be empty (header-only).
 *
 * @param {object} sheets - The normalized sheets map.
 * @returns {{ byKey?: object, error?: string }}
 */
function collectAndValidateSheets(sheets) {
  const byKey = {};
  for (const spec of SHEET_SPECS) {
    const rows = Array.isArray(sheets[spec.jsonKey]) ? sheets[spec.jsonKey] : [];
    const validation = spec.validate(rows);
    if (!validation.valid) {
      return { error: `schema validation failed for sheet '${spec.jsonKey}': ${validation.errors.slice(0, 5).join('; ')}` };
    }
    if (spec.primary && rows.length === 0) {
      return { error: 'DRS result contained zero Semrush rows' };
    }
    byKey[spec.jsonKey] = rows;
  }
  return { byKey };
}

/**
 * Sends a Slack alert to the LLMO onboarding channel when the strategy run or its
 * publish step fails. Best-effort — never throws.
 *
 * @param {object} context
 * @param {string} siteId
 * @param {string} drsJobId
 * @param {string} reason
 */
async function alertFailure(context, siteId, drsJobId, reason) {
  const channelId = context.env?.SLACK_CHANNEL_LLMO_ONBOARDING_ID;
  if (!channelId) {
    return;
  }
  await postMessageSafe(context, channelId, '', {
    attachments: [{
      color: '#CB3837',
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: 'Strategic Recommendations (Semrush) Failed', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Site ID:*\n\`${siteId}\`` },
            { type: 'mrkdwn', text: `*DRS Job:*\n\`${drsJobId || 'N/A'}\`` },
          ],
        },
        { type: 'section', text: { type: 'mrkdwn', text: `*Reason:* ${reason}` } },
        { type: 'divider' },
      ],
    }],
  });
}

/**
 * Fetches and parses the DRS result envelope from the provided result location.
 * The location is SSRF-guarded by the caller before this runs.
 *
 * @param {string} resultLocation
 * @param {object} log
 * @returns {Promise<object>} Parsed result envelope.
 */
async function fetchResult(resultLocation, log) {
  const safeUrl = scrubUrlForLog(resultLocation);
  log.info(`%s: Fetching DRS result from ${safeUrl}`, AUDIT_NAME);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESULT_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await tracingFetch(resultLocation, { signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`DRS result fetch timed out after ${RESULT_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch DRS result: ${response.status} ${response.statusText}`);
  }

  const declared = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_RESULT_BYTES) {
    throw new Error(`DRS result too large: declared ${declared} bytes exceeds cap ${MAX_RESULT_BYTES}`);
  }

  const text = await response.text();
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > MAX_RESULT_BYTES) {
    throw new Error(`DRS result too large: ${byteLength} bytes exceeds cap ${MAX_RESULT_BYTES}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`DRS result is not JSON: ${err.message}`);
  }
}

/**
 * Reads a worksheet's rows out of a workbook as plain objects keyed by the
 * header cell values (template column order). Returns [] when the sheet is absent.
 *
 * @param {ExcelJS.Workbook} workbook
 * @param {string} sheetName
 * @returns {Array<object>}
 */
function readSheetRows(workbook, sheetName) {
  const sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    return [];
  }
  const headerRow = sheet.getRow(1);
  /* c8 ignore next -- ExcelJS row.values is always an array; `|| []` is defensive */
  const headers = (headerRow.values || []).slice(1).map((h) => (h == null ? '' : String(h)));
  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    /* c8 ignore next -- ExcelJS row.values is always an array; `|| []` is defensive */
    const values = (row.values || []).slice(1);
    const obj = {};
    headers.forEach((header, idx) => {
      if (header) {
        obj[header] = values[idx] ?? null;
      }
    });
    rows.push(obj);
  });
  return rows;
}

/**
 * Reads the currently published workbook from SharePoint, returning the loaded
 * ExcelJS workbook and the existing rows of each `shared-*` worksheet (keyed by
 * jsonKey, used to preserve `deleted` markers). If no workbook exists yet (first
 * run), returns `{ workbook: null, existingRowsByKey: {} }` — the caller builds a
 * fresh workbook rather than failing closed.
 *
 * @param {string} dataFolder
 * @param {object} sharepointClient
 * @param {object} log
 * @returns {Promise<{ workbook: ExcelJS.Workbook|null, existingRowsByKey: object }>}
 */
async function loadWorkbook(dataFolder, sharepointClient, log) {
  const outputLocation = `${dataFolder}/strategic-recommendations-template`;
  const workbook = new ExcelJS.Workbook();
  try {
    const buffer = await readFromSharePoint(
      WORKBOOK_FILENAME,
      outputLocation,
      sharepointClient,
      log,
    );
    await workbook.xlsx.load(buffer);
    const existingRowsByKey = {};
    for (const spec of SHEET_SPECS) {
      existingRowsByKey[spec.jsonKey] = readSheetRows(workbook, spec.sheetName);
    }
    return { workbook, existingRowsByKey };
  } catch (error) {
    const notFound = error.message?.includes('resource could not be found')
      || error.message?.includes('itemNotFound');
    if (!notFound) {
      throw error;
    }
    log.info(`%s: No existing workbook at ${outputLocation}/${WORKBOOK_FILENAME}; building fresh`, AUDIT_NAME);
    return { workbook: null, existingRowsByKey: {} };
  }
}

/**
 * Replaces a worksheet's contents with the given rows, one row per prompt, in the
 * canonical column order. Creates the sheet if absent (so a first-run build, or a
 * workbook missing a sheet, is handled). Empty `rows` yields a header-only sheet.
 *
 * @param {ExcelJS.Workbook} workbook
 * @param {string} sheetName
 * @param {string[]} columns
 * @param {Array<object>} rows
 */
function writeSheet(workbook, sheetName, columns, rows) {
  let sheet = workbook.getWorksheet(sheetName);
  if (!sheet) {
    sheet = workbook.addWorksheet(sheetName);
  }
  // Clear existing rows by spliceing everything below the header, then rewrite.
  if (sheet.rowCount > 0) {
    sheet.spliceRows(1, sheet.rowCount);
  }
  sheet.addRow(columns);
  for (const row of rows) {
    sheet.addRow(columns.map((col) => {
      const value = row[col];
      return value === undefined ? null : value;
    }));
  }
}

/**
 * Removes the legacy `Notes` worksheet if present. elmo-ui does not consume it,
 * and carrying it forward bloats every published workbook. No-op when absent.
 *
 * @param {ExcelJS.Workbook} workbook
 */
function dropNotesSheet(workbook) {
  const notes = workbook.getWorksheet(NOTES_SHEET);
  if (notes) {
    workbook.removeWorksheet(notes.id);
  }
}

/**
 * Handles `drs:strategic_recommendations_semrush` job completion notifications.
 *
 * On JOB_FAILED: Slack alert, leave the prior sheet untouched, return ok().
 * On JOB_COMPLETED: SSRF-guard the result location, fetch + schema-validate the
 * rows, cross-tenant guard, load + merge with the existing workbook (preserving
 * `deleted` markers by (topic_id, prompt)), then upload and publish. Publish
 * failures and post-publish read-back mismatches are surfaced (handler does NOT
 * return ok() on those).
 *
 * @param {object} message - Normalized SQS message with DRS notification data.
 * @param {object} context - Universal context.
 * @returns {Promise<Response>}
 */
export default async function strategicRecommendationsSemrushHandler(message, context) {
  const { log, dataAccess } = context;
  const { Site } = dataAccess;
  const { siteId, auditContext = {} } = message;
  const { drsEventType, drsJobId, resultLocation } = auditContext;

  if (!siteId) {
    log.error('%s: notification missing site_id in metadata', AUDIT_NAME);
    return ok();
  }

  if (drsEventType === 'JOB_FAILED') {
    log.error(`%s: DRS job ${drsJobId} FAILED for site ${siteId}; leaving prior sheet in place`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, 'DRS job failed');
    return ok();
  }

  if (drsEventType !== 'JOB_COMPLETED') {
    log.warn(`%s: unexpected DRS event type ${drsEventType} for site ${siteId}`, AUDIT_NAME);
    return ok();
  }

  // SSRF guard — reject any result location not under the expected results
  // bucket/prefix BEFORE any network call.
  try {
    assertResultLocation(resultLocation, context.env);
  } catch (e) {
    log.error(`%s: rejected result location for site ${siteId}: ${e.message}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, `Invalid result location: ${e.message}`);
    return internalServerError(`Invalid result location: ${e.message}`);
  }

  let result;
  try {
    result = await fetchResult(resultLocation, log);
  } catch (e) {
    log.error(`%s: failed to fetch DRS result for site ${siteId}, job ${drsJobId}: ${e.message}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, `Failed to fetch result: ${e.message}`);
    return internalServerError(`Failed to fetch result: ${e.message}`);
  }

  // Cross-tenant guard — the result must be for the site this message targets.
  if (result.siteId && result.siteId !== siteId) {
    const msg = `cross-tenant mismatch: result.siteId=${result.siteId} != message.siteId=${siteId}`;
    log.error(`%s: ${msg}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, msg);
    return internalServerError(msg);
  }

  // Resolve + validate all three sheets. The new contract carries them in
  // `result.sheets`; an older producer's `result.rows` maps to the Semrush sheet.
  const sheets = normalizeSheets(result);
  const { byKey: newRowsByKey, error: sheetError } = collectAndValidateSheets(sheets);
  if (sheetError) {
    log.error(`%s: ${sheetError} for site ${siteId}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, sheetError);
    return internalServerError(sheetError);
  }

  const site = await Site.findById(siteId);
  if (!site) {
    const msg = `site not found: ${siteId}`;
    log.error(`%s: ${msg}`, AUDIT_NAME);
    return internalServerError(msg);
  }
  const dataFolder = site.getConfig?.()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    const msg = `no LLMO data folder configured for site ${siteId}`;
    log.error(`%s: ${msg}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, msg);
    return internalServerError(msg);
  }

  const sharepointClient = await createLLMOSharepointClient(context);
  const outputLocation = `${dataFolder}/strategic-recommendations-template`;

  let workbook;
  let existingRowsByKey;
  try {
    ({ workbook, existingRowsByKey } = await loadWorkbook(dataFolder, sharepointClient, log));
  } catch (e) {
    const msg = `failed to read existing workbook: ${e.message}`;
    log.error(`%s: ${msg} for site ${siteId}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, msg);
    return internalServerError(msg);
  }

  // First run (no published workbook yet): build a fresh one rather than failing
  // closed — the runner is the source of truth for all `shared-*` sheets.
  if (!workbook) {
    workbook = new ExcelJS.Workbook();
    existingRowsByKey = {};
  }

  // Drop the legacy Notes sheet, then (re)write every shared sheet from the
  // merged rows. Auxiliary sheets with no rows become header-only.
  dropNotesSheet(workbook);
  let semrushRowCount = 0;
  for (const spec of SHEET_SPECS) {
    const merged = mergeRowsByKey(
      existingRowsByKey[spec.jsonKey] || [],
      newRowsByKey[spec.jsonKey],
      spec.matchKeyFields,
    );
    writeSheet(workbook, spec.sheetName, spec.columns, merged);
    if (spec.primary) {
      semrushRowCount = merged.length;
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  try {
    await uploadToSharePoint(buffer, WORKBOOK_FILENAME, outputLocation, sharepointClient, log);
  } catch (e) {
    const msg = `SharePoint upload failed: ${e.message}`;
    log.error(`%s: ${msg} for site ${siteId}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, msg);
    return internalServerError(msg);
  }

  // Publish with NET-NEW failure surfacing + post-publish read-back.
  try {
    await publishWorkbookWithReadback({
      filename: WORKBOOK_FILENAME,
      outputLocation,
      expectedRowCount: semrushRowCount,
      expectedGeneratedAt: result.generated_at ?? null,
      adminApiKey: context.env?.ADMIN_HLX_API_KEY,
      log,
      fetchImpl: tracingFetch,
    });
  } catch (e) {
    const msg = `publish failed: ${e.message}`;
    log.error(`%s: ${msg} for site ${siteId}`, AUDIT_NAME);
    await alertFailure(context, siteId, drsJobId, msg);
    return internalServerError(msg);
  }

  log.info(`%s: published ${semrushRowCount} Semrush rows for site ${siteId}, job ${drsJobId}`, AUDIT_NAME);
  return ok();
}
