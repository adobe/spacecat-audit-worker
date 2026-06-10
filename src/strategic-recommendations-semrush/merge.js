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
 * Builds the deleted-preservation match key for a row, or null if the row lacks
 * the fields needed to match. `topic_id` and `prompt` are coerced to strings and
 * joined with the ASCII Unit Separator (U+001F) — a control char that cannot
 * appear in the human-authored prompt/topic text, so it removes the delimiter
 * ambiguity a printable separator (e.g. a space) would carry when a `topic_id`
 * ends with, or a `prompt` starts with, that character.
 *
 * @param {object} row
 * @returns {string|null}
 */
const MATCH_KEY_DELIMITER = '\x1F';

function matchKey(row) {
  const topicId = row.topic_id;
  const { prompt } = row;
  if (topicId === undefined || topicId === null || prompt === undefined || prompt === null) {
    return null;
  }
  return `${String(topicId)}${MATCH_KEY_DELIMITER}${String(prompt)}`;
}

/**
 * Pure row-merge helper for the `shared-Semrush` worksheet.
 *
 * The DRS runner emits a fresh, complete set of `shared-Semrush` rows on every run.
 * The UI lets users soft-delete (dismiss / manually-add) individual prompt rows by
 * stamping a `deleted` marker ('ignored' / 'added'). Because the runner does not know
 * about those user edits, a naive replace-all would wipe them out on every refresh.
 *
 * `mergeSemrushRows` re-applies the user's `deleted` markers from the previously
 * published rows onto the newly generated rows.
 *
 * MATCH KEY = `(topic_id, prompt)` - see the row contract
 * `shared-semrush-row.schema.v1.json` `x-contract.match_key_for_deleted_preservation`.
 *
 * BEST-EFFORT (v1): the match is on the stable `topic_id` plus the verbatim `prompt`
 * text. If a regeneration rephrases the prompt text, the match misses and a prior
 * dismissal lapses (the card may reappear). This is ACCEPTED for v1 and the UI states
 * that dismissals are best-effort across refreshes. Forward hardening: populate the
 * reserved `prompt_id` field (nullable, emitted null in v1) and switch the match key
 * to it - an additive value change, not a schema bump.
 *
 * This function performs no IO and never mutates its inputs.
 *
 * @param {Array<object>} existingRows - Rows parsed from the currently published workbook.
 * @param {Array<object>} newRows - Freshly generated rows from the DRS result.
 * @returns {Array<object>} New rows, with `deleted` markers carried over by match key.
 */
export function mergeSemrushRows(existingRows, newRows) {
  const safeNew = Array.isArray(newRows) ? newRows : [];
  const safeExisting = Array.isArray(existingRows) ? existingRows : [];

  // Build a lookup of prior `deleted` markers keyed on (topic_id, prompt).
  // Only carry over a non-empty marker; '' / null / undefined mean "active" and
  // are the default anyway, so there is nothing to preserve for them. First write
  // wins, so a duplicate (topic_id, prompt) keeps the earliest marker.
  const priorDeleted = new Map();
  safeExisting.forEach((row) => {
    if (!row || typeof row !== 'object') {
      return;
    }
    const marker = row.deleted;
    if (marker === undefined || marker === null || marker === '') {
      return;
    }
    const key = matchKey(row);
    if (key !== null && !priorDeleted.has(key)) {
      priorDeleted.set(key, marker);
    }
  });

  return safeNew.map((row) => {
    if (!row || typeof row !== 'object') {
      return row;
    }
    const key = matchKey(row);
    const carried = key !== null ? priorDeleted.get(key) : undefined;
    if (carried !== undefined) {
      return { ...row, deleted: carried };
    }
    // No prior match - return a shallow copy so callers never see input aliasing.
    return { ...row };
  });
}

export default mergeSemrushRows;
