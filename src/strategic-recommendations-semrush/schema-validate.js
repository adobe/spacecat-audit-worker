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
 * Validates `shared-Semrush` rows against the vendored row contract.
 *
 * The authoritative schema lives in DRS
 * (`docs/contracts/shared-semrush-row.schema.v1.json`); a sha-pinned copy is
 * vendored here and the checksum-drift test fails CI if the two diverge. This
 * validator enforces the parts of that draft-07 schema that matter at ingest:
 * required keys, the `tag`/`deleted` enums, and the integer/string types. It is
 * intentionally dependency-free so the writer never accepts rows the schema would
 * reject.
 */

import {
  TAG_VALUES, DELETED_VALUES, REQUIRED_FIELDS, MAX_LENGTHS,
} from './schema-derived.js';

const INTEGER_FIELDS = [
  'volume',
  'adobe_mentions',
  'competitor_1_mentions',
  'competitor_2_mentions',
  'competitor_3_mentions',
];

const STRING_FIELDS = ['strategy', 'strategy_reasoning', 'topic_id', 'topic', 'prompt'];

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

function validateRow(row, index) {
  const errors = [];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return [`row[${index}] is not an object`];
  }

  REQUIRED_FIELDS.forEach((field) => {
    if (row[field] === undefined || row[field] === null) {
      errors.push(`row[${index}] missing required field '${field}'`);
    }
  });

  if (row.tag !== undefined && !TAG_VALUES.includes(row.tag)) {
    errors.push(`row[${index}] tag '${row.tag}' not in enum`);
  }

  if (row.deleted !== undefined && !DELETED_VALUES.includes(row.deleted)) {
    errors.push(`row[${index}] deleted '${row.deleted}' not in enum`);
  }

  STRING_FIELDS.forEach((field) => {
    if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') {
      errors.push(`row[${index}] '${field}' must be a string`);
    }
  });
  // minLength: 1 on the required string fields.
  STRING_FIELDS.forEach((field) => {
    if (typeof row[field] === 'string' && row[field].length === 0) {
      errors.push(`row[${index}] '${field}' must be non-empty`);
    }
  });
  // maxLength bounds from the contract (applies to any present string field,
  // including the nullable competitor_*/category/prompt_id columns).
  Object.entries(MAX_LENGTHS).forEach(([field, max]) => {
    const value = row[field];
    if (typeof value === 'string' && value.length > max) {
      errors.push(`row[${index}] '${field}' exceeds maxLength ${max}`);
    }
  });

  // adobe_mentions/volume are required (caught above); competitor_* are nullable,
  // so only type-check integer fields that are actually present.
  INTEGER_FIELDS.forEach((field) => {
    const value = row[field];
    if (value === undefined || value === null) {
      return;
    }
    if (!isInteger(value)) {
      errors.push(`row[${index}] '${field}' must be an integer`);
    } else if (value < 0) {
      errors.push(`row[${index}] '${field}' must be >= 0`);
    }
  });

  return errors;
}

/**
 * Validates an array of rows.
 *
 * @param {Array<object>} rows
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSemrushRows(rows) {
  if (!Array.isArray(rows)) {
    return { valid: false, errors: ['rows is not an array'] };
  }
  const errors = [];
  rows.forEach((row, index) => {
    errors.push(...validateRow(row, index));
  });
  return { valid: errors.length === 0, errors };
}

export default validateSemrushRows;
