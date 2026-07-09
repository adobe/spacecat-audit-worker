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
 * Classification of preflight error types, used to group codes by how a
 * consumer should react to them.
 */
export const PreflightErrorClassification = Object.freeze({
  // Site/org configuration prevents the audit from running (e.g. handler disabled,
  // missing entitlement). Not transient - retrying the job won't help.
  CONFIG_ERROR: 'CONFIG_ERROR',
});

/**
 * Preflight error catalog. Each entry is surfaced via `errorCode` on a cancelled/failed
 * AsyncJob's metadata payload, so consumers (e.g. the preflight MFE) can look up a
 * stable code instead of parsing the freeform `reason` string.
 *
 * NOTE: `code` values are part of the external contract with consumers (e.g. the MFE).
 * Do not change or reuse an existing code - add a new entry instead.
 */
export const PreflightError = Object.freeze({
  PREFLIGHT_DISABLED: Object.freeze({
    code: 'PREFLIGHT-100',
    message: 'The Preflight audit is not enabled for this site.',
    description: 'The preflight handler is disabled in the site configuration.',
    classification: PreflightErrorClassification.CONFIG_ERROR,
  }),
});
