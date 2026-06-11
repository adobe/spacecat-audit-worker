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
 * Shared spreadsheet/CSV safety helpers.
 *
 * Several reports (weekly Excel + multiple daily CSV exports) write
 * visitor-influenceable RUM values into spreadsheets. A cell whose value begins
 * with a formula trigger (`= + - @`, tab, CR, or LF) is interpreted as a formula
 * by Excel/Sheets — a CSV/formula-injection vector. Leading whitespace does not
 * defang the operator: `' =1+1'` is still evaluated. These helpers neutralize
 * that by prefixing a single quote, and (for CSV) apply RFC-4180 quoting.
 *
 * Consolidated here so every report shares one definition; previously each site
 * carried its own near-duplicate copy that could drift.
 */

/**
 * Leading characters that turn a spreadsheet cell into a formula.
 */
export const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r', '\n'];

/**
 * A value needs formula neutralization when it either begins with a bare control
 * character (tab/CR/LF, dangerous on their own) or has optional leading
 * whitespace followed by a formula operator (`= + - @`). Leading whitespace is
 * NOT a safe guard — Excel/Sheets trim it before evaluating — so `' =x'`,
 * `'\t=x'`, and `'\n=x'` are all treated as formulas. Plain leading-whitespace
 * text without an operator (`' foo'`, `'   '`) is left alone.
 *
 * Note on `-`: a leading `-` is a formula trigger, so a value like `-5` would
 * be prefixed (`'-5`). No column in these reports holds a negative number
 * today, so this is not hit in practice; quoting is the deliberate safe default
 * because `-2+cmd(...)` is a valid formula. If a future column can carry a
 * genuine negative numeric, add a numeric-skip guard (e.g. `!Number.isNaN`).
 */
const NEUTRALIZE_PATTERN = /^[\t\r\n]|^\s*[=+\-@]/;

/**
 * Prefixes a single quote when the (already-stringified) value would be
 * interpreted as a formula. The original text is preserved verbatim — only the
 * leading quote is added; no trimming or rewriting.
 *
 * @param {string} str
 * @returns {string}
 */
function neutralizeFormula(str) {
  return NEUTRALIZE_PATTERN.test(str) ? `'${str}` : str;
}

/**
 * Excel-cell sanitizer (for values handed to a spreadsheet library, e.g. ExcelJS
 * `addRow`, where RFC-4180 quoting is the library's job — only formula
 * neutralization is needed here). String values starting with a formula trigger
 * are prefixed with a single quote; all other values pass through unchanged
 * (numbers, booleans, null, etc. are not formula vectors).
 *
 * @param {*} value
 * @returns {*}
 */
export function sanitizeSpreadsheetValue(value) {
  if (typeof value === 'string') {
    return neutralizeFormula(value);
  }
  return value;
}

/**
 * CSV field escaper. Normalizes the value to a string, neutralizes a leading
 * formula trigger, then applies RFC-4180 quoting when the field contains a
 * quote, CR, LF, or comma.
 *
 *   - `null`/`undefined` → `''` (empty field).
 *   - objects → `JSON.stringify` (so structured cells serialize deterministically).
 *   - everything else → `String(value)`.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeCsvValue(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const normalized = neutralizeFormula(
    typeof value === 'object' ? JSON.stringify(value) : String(value),
  );

  if (/["\r\n,]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

/**
 * Serializes rows to a CSV string. `columns` is REQUIRED (no default): each
 * caller passes its own explicit column list so the projected schema is always
 * stated at the call site and cannot silently fall back to a wrong default.
 * Rows are joined with CRLF (`\r\n`), matching the existing exports.
 *
 * @param {Array<object>} rows
 * @param {Array<string>} columns - explicit, ordered column keys
 * @returns {string}
 */
export function serializeCsv(rows, columns) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => escapeCsvValue(row[col])).join(','));
  return [header, ...body].join('\r\n');
}
