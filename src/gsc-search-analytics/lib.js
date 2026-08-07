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

import GoogleClient from '@adobe/spacecat-shared-google-client';
import { computeWindows, assessCompleteness, isValidFixDate } from './windows.js';
import { fetchWindow } from './fetch.js';
import { indexRows, lookup } from './match.js';
import { buildDelta } from './summarize.js';

const SCHEMA_VERSION = 1;
const MAX_FIXED_URLS = 500; // guard against an unbounded, Lambda-timeout-risking run
// Each distinct fix date is one date-group = up to two paginated window pulls run
// sequentially, so cap the number of groups to stay well inside the Lambda timeout.
const MAX_DATE_GROUPS = 30;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const clip = (s) => String(s).slice(0, 300); // bound stored error text

// A fix entry with the stable shape every consumer can rely on.
function baseFix(f, status, extra) {
  return {
    url: f.url,
    fixType: f.fixType,
    fixDate: f.fixDate,
    status,
    windows: null,
    before: null,
    after: null,
    delta: null,
    found: { before: false, after: false },
    dataQuality: null,
    ...extra,
  };
}

function envelope(fields, finalUrl) {
  return {
    auditResult: {
      schemaVersion: SCHEMA_VERSION,
      // Self-describing guard for anyone reading the raw row via PostgREST: these are
      // raw recorded figures, NOT a causal or attributed claim about the fix.
      interpretation: 'raw before/after GSC figures per fixed URL; not a causal or attributed measurement',
      ...fields,
    },
    fullAuditRef: finalUrl,
  };
}

/**
 * Tracking-only audit: for each URL ASO fixed, record its GSC clicks/impressions/
 * ctr/position for the 84 days before and after the URL's own fix date. No causal
 * claim — this is the "Measured" layer. Input is a manually-supplied list of
 * { url, fixType, fixDate } in auditContext.fixedUrls.
 *
 * Result envelope (audit_result JSON): { schemaVersion, connected, status, fixCount,
 * measuredCount, fixes[] }. Each fix carries a `status` of one of:
 *   measured | not_found | incomplete | invalid_date | failed
 * plus before/after/delta/found and a dataQuality marker so a later reader can tell a
 * real signal from a data gap.
 *
 * @param {string} finalUrl - resolved site base URL.
 * @param {object} context - audit context ({ log, ... }).
 * @param {object} site - the site under audit.
 * @param {object} auditContext - carries fixedUrls (or messageData.fixedUrls).
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
export async function runGscSearchAnalytics(finalUrl, context, site, auditContext = {}) {
  const { log } = context;
  const fixedUrls = auditContext.fixedUrls ?? auditContext.messageData?.fixedUrls;

  if (!Array.isArray(fixedUrls) || fixedUrls.length === 0) {
    log.info(`gsc-search-analytics: no fixedUrls supplied for ${finalUrl}`);
    return envelope({
      connected: null, status: 'missing_fixed_urls', fixCount: 0, measuredCount: 0, fixes: [],
    }, finalUrl);
  }

  if (fixedUrls.length > MAX_FIXED_URLS) {
    log.warn(`gsc-search-analytics: ${fixedUrls.length} fixedUrls exceeds cap ${MAX_FIXED_URLS} for ${finalUrl}`);
    return envelope({
      connected: null, status: 'too_many_fixed_urls', fixCount: 0, measuredCount: 0, fixes: [],
    }, finalUrl);
  }

  // Each distinct valid fix date becomes one sequentially-processed date-group; bound the
  // count so a spread-out list can't exhaust the Lambda timeout.
  const distinctDateCount = new Set(
    fixedUrls.filter((f) => isValidFixDate(f.fixDate)).map((f) => f.fixDate),
  ).size;
  if (distinctDateCount > MAX_DATE_GROUPS) {
    log.warn(`gsc-search-analytics: ${distinctDateCount} distinct fix dates exceeds cap ${MAX_DATE_GROUPS} for ${finalUrl}`);
    return envelope({
      connected: null, status: 'too_many_date_groups', fixCount: 0, measuredCount: 0, fixes: [],
    }, finalUrl);
  }

  let google;
  try {
    google = await GoogleClient.createFrom(context, finalUrl);
  } catch (e) {
    // Repo convention (see structured-data/lib.js, opportunity-utils.checkGoogleConnection):
    // any createFrom failure means the site is not connected to GSC. Record it, don't crash.
    log.info(`gsc-search-analytics: GSC not connected for ${finalUrl}: ${e.message}`);
    return envelope({
      connected: false, status: 'not_connected', reason: clip(e.message), fixCount: 0, measuredCount: 0, fixes: [],
    }, finalUrl);
  }

  const now = new Date();
  const fixes = [];
  const byDate = new Map();

  // Split invalid dates out (recorded, never fetched); group the rest by fix date so
  // URLs sharing a date share one pair of pulls.
  for (const f of fixedUrls) {
    if (!isValidFixDate(f.fixDate)) {
      fixes.push(baseFix(f, 'invalid_date', { error: `Invalid fix date: ${f.fixDate}` }));
    } else if (!byDate.has(f.fixDate)) {
      byDate.set(f.fixDate, [f]);
    } else {
      byDate.get(f.fixDate).push(f);
    }
  }

  for (const [fixDate, group] of byDate) {
    const windows = computeWindows(fixDate);
    const completeness = assessCompleteness(windows, now);
    try {
      /* eslint-disable no-await-in-loop */
      const [beforeRes, afterRes] = await Promise.all([
        fetchWindow(google, toDate(windows.before.start), toDate(windows.before.end)),
        fetchWindow(google, toDate(windows.after.start), toDate(windows.after.end)),
      ]);
      /* eslint-enable no-await-in-loop */
      const beforeMap = indexRows(beforeRes.rows);
      const afterMap = indexRows(afterRes.rows);
      const dataQuality = {
        beforeComplete: completeness.beforeComplete,
        afterComplete: completeness.afterComplete,
        truncated: [beforeRes, afterRes].some((r) => r.truncated),
      };
      let matchedAny = false;
      for (const f of group) {
        const b = lookup(beforeMap, f.url);
        const a = lookup(afterMap, f.url);
        const found = { before: !!b, after: !!a };
        if (found.before || found.after) {
          matchedAny = true;
        }
        let status;
        // Completeness is checked FIRST: a not-yet-elapsed after-window legitimately
        // returns no rows, which must read as 'incomplete', not 'not_found'.
        if (!completeness.afterComplete || !completeness.beforeComplete) {
          status = 'incomplete';
        } else if (!found.before || !found.after) {
          status = 'not_found';
        } else {
          status = 'measured';
        }
        fixes.push({
          url: f.url,
          fixType: f.fixType,
          fixDate,
          status,
          windows,
          before: b,
          after: a,
          delta: status === 'measured' ? buildDelta(b, a) : null,
          found,
          dataQuality,
        });
      }
      // Rows came back but none of this group's fixed URLs matched -> almost always a
      // host mismatch (www/apex, or fixedUrls built from a different host than the GSC
      // property). Surface it instead of silently reporting not_found.
      const rowsSeen = beforeMap.size + afterMap.size > 0;
      if (!matchedAny && rowsSeen) {
        log.warn(`gsc-search-analytics: ${fixDate} returned rows but no fixed URL matched for ${finalUrl} - likely host mismatch (www/apex or GSC property host)`);
      }
    } catch (e) {
      // A failure on one date-group must not wipe the others; leave a diagnostic entry.
      log.error(`gsc-search-analytics: fetch failed for ${fixDate} / ${finalUrl}: ${e.message}`);
      for (const f of group) {
        fixes.push(baseFix(f, 'failed', { windows, error: clip(e.message) }));
      }
    }
  }

  const measuredCount = fixes.filter((f) => f.status === 'measured').length;
  return envelope({
    connected: true, status: 'ok', fixCount: fixes.length, measuredCount, fixes,
  }, finalUrl);
}
