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

  // The content-scraper could not fetch the page (403, DNS, timeout, etc.). Transient -
  // re-running the audit may succeed once the underlying access/availability issue clears.
  SCRAPE_ERROR: 'SCRAPE_ERROR',
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
  SCRAPE_FORBIDDEN: Object.freeze({
    code: 'PREFLIGHT-101',
    message: 'This page could not be accessed. Confirm you have permission to view it.',
    description: 'The content-scraper received an HTTP 401/403 response for the page.',
    classification: PreflightErrorClassification.SCRAPE_ERROR,
  }),
  SCRAPE_TIMEOUT: Object.freeze({
    code: 'PREFLIGHT-102',
    message: 'This page took too long to load and could not be checked.',
    description: 'The content-scraper timed out navigating to or rendering the page.',
    classification: PreflightErrorClassification.SCRAPE_ERROR,
  }),
  SCRAPE_FAILED: Object.freeze({
    code: 'PREFLIGHT-103',
    message: 'This page could not be checked.',
    description: 'The content-scraper failed to fetch the page for a reason other than an access denial or timeout (e.g. DNS failure).',
    classification: PreflightErrorClassification.SCRAPE_ERROR,
  }),
});
