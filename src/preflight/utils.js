/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { Site } from '@adobe/spacecat-shared-data-access';
import { isNonEmptyArray, isValidUrl, stripTrailingSlash } from '@adobe/spacecat-shared-utils';
import { PreflightError } from './error-constants.js';

export async function saveIntermediateResults(context, result, auditName) {
  const {
    site, job, step, dataAccess, log,
  } = context;
  const { AsyncJob } = dataAccess;

  try {
    const jobEntity = await AsyncJob.findById(job.getId());
    jobEntity.setResult(result);
    await jobEntity.save();
    log.debug(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${auditName}: Intermediate results saved successfully`);
  } catch (error) {
    log.warn(`[preflight-audit] site: ${site.getId()}, job: ${job.getId()}, step: ${step}. ${auditName}: Failed to save intermediate results: ${error.message}`);
  }
}

export function isValidUrls(urls) {
  return (
    isNonEmptyArray(urls)
    && urls.every((url) => isValidUrl(url))
  );
}

/**
 * Builds a lookup of URLs whose page scrape failed outright (e.g. 401/403, DNS, timeout), from
 * the content-scraper's completion message. A failed scrape never writes a scrape record to S3,
 * so without this signal a check has no way to distinguish "genuinely clean page" from "page was
 * never actually analyzed" - it would silently report the pre-initialized empty/"clean" result.
 * @param {Array<{ metadata?: { url?: string, status?: string, reason?: string } }>} scrapeResults
 *   - The content-scraper completion message's per-URL results.
 * @param {object} log
 * @returns {Map<string, { code: string, message: string }>} Keyed by `stripTrailingSlash(url)`
 *   to match the normalization already used when matching scraped pages back to their preview URL.
 */
export function buildFailedScrapesMap(scrapeResults, log) {
  const failedScrapes = new Map();

  if (!isNonEmptyArray(scrapeResults)) {
    return failedScrapes;
  }

  scrapeResults.forEach((result) => {
    const { url, status, reason } = result?.metadata || {};
    if (status !== 'FAILED' || !isValidUrl(url)) {
      return;
    }

    let preflightError = PreflightError.SCRAPE_FAILED;
    if (/HTTP 40[13]/.test(reason || '')) {
      preflightError = PreflightError.SCRAPE_FORBIDDEN;
    } else if (/timeout/i.test(reason || '')) {
      preflightError = PreflightError.SCRAPE_TIMEOUT;
    }

    log.warn(`[preflight-audit] Scrape failed for ${url}, reason: ${reason}. Marking checks with ${preflightError.code}.`);
    failedScrapes.set(stripTrailingSlash(url), {
      code: preflightError.code,
      message: preflightError.message,
    });
  });

  return failedScrapes;
}

export function getPrefixedPageAuthToken(site, token, options) {
  if (site.getDeliveryType() === Site.DELIVERY_TYPES.AEM_CS && options.promiseToken) {
    return `Bearer ${token}`;
  } else {
    return `token ${token}`;
  }
}

/**
 * Rare, breaker-free marker token that leads every structured completion suffix. Its whole job
 * is Splunk query performance: `audit`/`status`/`duration_ms` are all common terms in the
 * high-volume `dx_aem_sites_spacecat_backend_*` sourcetype, so a dashboard anchored on them has
 * to intersect enormous postings lists across the whole time window (a 14-day search on that
 * shared index hangs). `pfauditmetric` appears ONLY on these lines, so it is a single, rare
 * indexed term (no Splunk breakers — all lowercase letters) with a tiny postings list; anchoring
 * on it makes the search cost proportional to preflight volume alone, fast at any window.
 * Keep it in sync with the SITES-49489 dashboard base search (`... "pfauditmetric" | rex ...`).
 */
export const PREFLIGHT_METRIC_MARKER = 'pfauditmetric';

/**
 * Builds the structured completion-log suffix: the `pfauditmetric` marker (query anchor) followed
 * by logfmt-style `key=value` pairs (`audit`/`status`/`duration_ms`/`error`). Appended to the
 * existing `[preflight-audit] site: ..., job: ...` message, never replacing it. The sourcetype is
 * `KV_MODE=json`, so these live inside the JSON `message` string and are NOT auto-extracted — the
 * dashboard `rex`-extracts them; the marker + logfmt shape is what makes that rex cheap and robust.
 * @param {{ audit: string, status: 'ok'|'fail', durationMs: number, error?: string }} params
 * @returns {string} A leading-space-prefixed suffix, e.g.
 *   ` pfauditmetric audit=canonical status=ok duration_ms=120`
 */
export function formatStructuredAuditLog({
  audit, status, durationMs, error,
}) {
  const parts = [PREFLIGHT_METRIC_MARKER, `audit=${audit}`, `status=${status}`, `duration_ms=${durationMs}`];
  if (status === 'fail' && error) {
    // Collapse newlines/CRs to spaces BEFORE quoting: a raw newline inside the quoted value
    // would split the log entry into two lines and corrupt Splunk's per-line field extraction
    // (error messages from stack traces / multi-line assertions commonly contain them).
    const escaped = String(error)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500);
    parts.push(`error="${escaped}"`);
  }
  return ` ${parts.join(' ')}`;
}
