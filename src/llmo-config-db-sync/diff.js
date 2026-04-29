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

export function normalizeForCompare(field, value) {
  if (Array.isArray(value)) {
    const items = field === 'regions' ? value.map((r) => r.toUpperCase()) : value;
    return JSON.stringify([...items].sort());
  }
  return JSON.stringify(value);
}

export function changedFields(newRow, existingRow, fields) {
  return fields.filter(
    (f) => normalizeForCompare(f, newRow[f]) !== normalizeForCompare(f, existingRow[f]),
  );
}

export function diffRows(desiredRows, existingByKey, keyFn, compareFields) {
  const toUpsert = [];
  const dryRunInserts = [];
  const dryRunUpdates = [];
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const row of desiredRows) {
    const existing = existingByKey.get(keyFn(row));
    if (!existing) {
      toUpsert.push(row);
      dryRunInserts.push(row);
      inserted += 1;
    } else {
      const changed = changedFields(row, existing, compareFields);
      if (changed.length > 0) {
        toUpsert.push(row);
        dryRunUpdates.push({ ...row, _changedFields: changed, _existing: existing });
        updated += 1;
      } else {
        unchanged += 1;
      }
    }
  }

  return {
    toUpsert, dryRunInserts, dryRunUpdates, stats: { inserted, updated, unchanged },
  };
}

export function logDiffSummary(log, label, toInsert, toUpdate) {
  log.info(`[DIFF] ${label}: ${toInsert.length} to insert, ${toUpdate.length} to update`);

  toUpdate.slice(0, 5).forEach((row) => {
    const { _changedFields, _existing, ...data } = row;
    const keyFields = Object.entries(data)
      .filter(([k]) => k.endsWith('_id') && !_changedFields.includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');

    const diff = _changedFields.map((f) => {
      const oldVal = JSON.stringify(_existing[f]);
      const newVal = JSON.stringify(data[f]);
      return `  ${f}: ${oldVal} → ${newVal}`;
    }).join('\n');

    log.info(`[DIFF] ${label} UPDATE [${keyFields}]:\n${diff}`);
  });

  toInsert.slice(0, 5).forEach((row) => {
    log.info(`[DIFF] ${label} INSERT: ${JSON.stringify(row)}`);
  });

  if (toUpdate.length > 0) {
    const fieldFreq = {};
    toUpdate.forEach(({ _changedFields }) => {
      _changedFields.forEach((f) => {
        fieldFreq[f] = (fieldFreq[f] || 0) + 1;
      });
    });
    const summary = Object.entries(fieldFreq)
      .map(([f, count]) => `${f}: ${count}`)
      .join(', ');
    log.info(`[DIFF] ${label} changed-field distribution: ${summary}`);
  }
}
