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
 * Builds the deleted-preservation match key for a row from an ordered list of
 * key fields, or null if the row lacks any of them. Each field value is coerced
 * to a string and joined with the ASCII Unit Separator (U+001F) — a control char
 * that cannot appear in the human-authored prompt/topic text, so it removes the
 * delimiter ambiguity a printable separator (e.g. a space) would carry when one
 * field ends with, or the next starts with, that character.
 *
 * @param {object} row
 * @param {string[]} keyFields
 * @returns {string|null}
 */
const MATCH_KEY_DELIMITER = '\x1F';

function matchKey(row, keyFields) {
  const parts = [];
  for (const field of keyFields) {
    const value = row[field];
    if (value === undefined || value === null) {
      return null;
    }
    parts.push(String(value));
  }
  return parts.join(MATCH_KEY_DELIMITER);
}

/**
 * Pure, sheet-agnostic row-merge helper.
 *
 * The DRS runner emits a fresh, complete set of rows for each `shared-*` worksheet
 * on every run. The UI lets users soft-delete (dismiss / manually-add) individual
 * prompt rows by stamping a `deleted` marker ('ignored' / 'added'). Because the
 * runner does not know about those user edits, a naive replace-all would wipe them
 * out on every refresh.
 *
 * `mergeRowsByKey` re-applies the user's `deleted` markers from the previously
 * published rows onto the newly generated rows, matching on `keyFields`.
 *
 * MATCH KEY per sheet (see each row contract's
 * `x-contract.match_key_for_deleted_preservation`):
 *   - Semrush:            (topic_id, prompt)
 *   - Citation Attempt:   (source_url, prompt)
 *   - Synthetic Personas: (category, prompt)
 *
 * BEST-EFFORT (v1): the match includes the verbatim `prompt` text. If a regeneration
 * rephrases the prompt, the match misses and a prior dismissal lapses (the card may
 * reappear). This is ACCEPTED for v1 and the UI states dismissals are best-effort
 * across refreshes. Forward hardening (Semrush): populate the reserved `prompt_id`
 * field and switch the key to it — an additive value change, not a schema bump.
 *
 * This function performs no IO and never mutates its inputs.
 *
 * @param {Array<object>} existingRows - Rows parsed from the currently published workbook.
 * @param {Array<object>} newRows - Freshly generated rows from the DRS result.
 * @param {string[]} keyFields - Ordered match-key fields for this sheet.
 * @returns {Array<object>} New rows, with `deleted` markers carried over by match key.
 */
export function mergeRowsByKey(existingRows, newRows, keyFields) {
  const safeNew = Array.isArray(newRows) ? newRows : [];
  const safeExisting = Array.isArray(existingRows) ? existingRows : [];

  // Build a lookup of prior `deleted` markers keyed on `keyFields`. Only carry
  // over a non-empty marker; '' / null / undefined mean "active" and are the
  // default anyway, so there is nothing to preserve for them. First write wins,
  // so a duplicate key keeps the earliest marker.
  const priorDeleted = new Map();
  safeExisting.forEach((row) => {
    if (!row || typeof row !== 'object') {
      return;
    }
    const marker = row.deleted;
    if (marker === undefined || marker === null || marker === '') {
      return;
    }
    const key = matchKey(row, keyFields);
    if (key !== null && !priorDeleted.has(key)) {
      priorDeleted.set(key, marker);
    }
  });

  return safeNew.map((row) => {
    if (!row || typeof row !== 'object') {
      return row;
    }
    const key = matchKey(row, keyFields);
    const carried = key !== null ? priorDeleted.get(key) : undefined;
    if (carried !== undefined) {
      return { ...row, deleted: carried };
    }
    // No prior match - return a shallow copy so callers never see input aliasing.
    return { ...row };
  });
}

/**
 * Semrush convenience wrapper — merges on the `(topic_id, prompt)` match key.
 *
 * @param {Array<object>} existingRows
 * @param {Array<object>} newRows
 * @returns {Array<object>}
 */
export function mergeSemrushRows(existingRows, newRows) {
  return mergeRowsByKey(existingRows, newRows, ['topic_id', 'prompt']);
}

export default mergeSemrushRows;
