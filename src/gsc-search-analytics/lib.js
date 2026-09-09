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
import { composeAuditURL, stripWWW } from '@adobe/spacecat-shared-utils';
import { computeWindows, assessCompleteness, isValidFixDate } from './windows.js';
import { fetchWindow } from './fetch.js';
import { indexRows, lookup, normalizeUrl } from './match.js';
import { buildDelta } from './summarize.js';
import { deriveFixedUrls } from './derive.js';
// Shared caps (single source of truth): derive.js bounds its output to the same
// numbers this file uses as the runtime abort cap, so they cannot drift apart.
import { MAX_FIXED_URLS, MAX_DATE_GROUPS } from './constants.js';

const SCHEMA_VERSION = 1;
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
 *   measured | not_found | incomplete | invalid_date | out_of_scope | failed
 * plus before/after/delta/found and a dataQuality marker so a later reader can tell a
 * real signal from a data gap. Envelope-level `status` may also be one of:
 *   ok | not_connected | missing_fixed_urls | too_many_fixed_urls |
 *   too_many_date_groups | sourcing_failed
 *
 * @param {string} finalUrl - resolved site base URL.
 * @param {object} context - audit context ({ log, ... }).
 * @param {object} site - the site under audit.
 * @param {object} auditContext - carries fixedUrls (or messageData.fixedUrls).
 * @returns {Promise<{auditResult: object, fullAuditRef: string}>}
 */
export async function runGscSearchAnalytics(finalUrl, context, site, auditContext = {}) {
  const { log } = context;
  let fixedUrls = auditContext.fixedUrls ?? auditContext.messageData?.fixedUrls;
  let sourcing; // set only on the self-sourced path; surfaced in the final envelope

  // Self-source when no explicit list is supplied: read the deploy-date range (and
  // optional filters) from the Slack/API keyword args (messageData) or auditContext,
  // and gather the site's DEPLOYED/PUBLISHED fixed URLs from the data-service.
  // Trigger: an absent OR empty fixedUrls both self-source (empty list == not supplied).
  if (!Array.isArray(fixedUrls) || fixedUrls.length === 0) {
    const kwargs = auditContext.messageData ?? auditContext;
    let derived;
    try {
      derived = await deriveFixedUrls(
        site.getId(),
        {
          since: kwargs.since, // single watermark: incremental when set, backfill when absent
          from: kwargs.from, // low-level overrides (tests / power users)
          to: kwargs.to,
          fixStatuses: kwargs.fixStatuses,
          fixTypes: kwargs.fixTypes,
        },
        context,
      );
    } catch (e) {
      // Mirror the createFrom handling below: a data-layer failure records a status
      // instead of rejecting out of the whole audit.
      log.error(`gsc-search-analytics: self-source failed for ${finalUrl}: ${e.message}`);
      return envelope({
        connected: null, status: 'sourcing_failed', reason: clip(e.message), fixCount: 0, measuredCount: 0, fixes: [],
      }, finalUrl);
    }
    fixedUrls = derived.fixedUrls;
    sourcing = derived.sourcing; // { mode, sourcedDateGroups, keptDateGroups, truncated }
  }

  if (!Array.isArray(fixedUrls) || fixedUrls.length === 0) {
    log.info(`gsc-search-analytics: no fixedUrls supplied or derived for ${finalUrl}`);
    return envelope({
      connected: null, status: 'missing_fixed_urls', fixCount: 0, measuredCount: 0, fixes: [], ...(sourcing && { sourcing }),
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

  // The GSC client scopes every query to `page contains composeAuditURL(finalUrl)` — for
  // krisshop that resolves (following redirects) to www.krisshop.com/en. A fixed URL
  // outside that host+path is never queried, so it must be distinguished from "queried,
  // no data" (not_found).
  // composeAuditURL does a live HTTP GET; every other external call in this runner records
  // a status instead of throwing. A DNS/transport error here must not reject the whole audit
  // now that GSC is already connected — degrade to prior behavior (all URLs in scope).
  let scope;
  try {
    scope = await composeAuditURL(finalUrl); // e.g. "www.krisshop.com/en"
  } catch (e) {
    log.warn(`gsc-search-analytics: scope resolution failed for ${finalUrl}: ${e.message}; treating all fixed URLs as in scope`);
    scope = null;
  }
  let inScope;
  if (!scope) {
    inScope = () => true;
  } else {
    const slash = scope.indexOf('/');
    const scopeHost = stripWWW((slash >= 0 ? scope.slice(0, slash) : scope).toLowerCase());
    // composeAuditURL leaves a trailing slash on multi-segment paths ("/en/") while the
    // fixed-URL side is normalized (match.js normalizeUrl strips it), so strip it here too
    // to keep both sides aligned; a bare-root path ("/") is left as-is.
    const rawPath = slash >= 0 ? scope.slice(slash) : '/';
    const scopePath = rawPath.length > 1 ? rawPath.replace(/\/+$/, '') : rawPath;
    inScope = (url) => {
      try {
        const u = new URL(normalizeUrl(url));
        // path-boundary safe: `/en` must not match `/enterprise`; a bare-root base
        // (scopePath === '/') treats every same-host URL as in scope.
        const p = u.pathname;
        const pathOk = p === scopePath || p.startsWith(`${scopePath}/`) || scopePath === '/';
        return stripWWW(u.host) === scopeHost && pathOk;
      } catch {
        return false;
      }
    };
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
        // out_of_scope is checked FIRST: a URL outside the GSC page-filter's host+path
        // scope was never queried, so it must not masquerade as 'not_found'. Completeness
        // is next: a not-yet-elapsed after-window legitimately returns no rows, which must
        // read as 'incomplete', not 'not_found'.
        if (!inScope(f.url)) {
          status = 'out_of_scope';
        } else if (!completeness.afterComplete || !completeness.beforeComplete) {
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
      // Prefer the real cause when any URL in this group is structurally out of scope
      // (locale/path filtering); otherwise fall back to the host-mismatch signal — rows
      // came back but no in-scope fixed URL matched (www/apex, or fixedUrls built from a
      // different host than the GSC property).
      const rowsSeen = beforeMap.size + afterMap.size > 0;
      const anyOutOfScope = group.some((f) => !inScope(f.url));
      if (anyOutOfScope) {
        log.warn(`gsc-search-analytics: ${fixDate} — one or more fixed URLs are outside the GSC fetch scope (${scope}); locale/path scoping, reported as out_of_scope for ${finalUrl}`);
      } else if (!matchedAny && rowsSeen) {
        log.warn(`gsc-search-analytics: ${fixDate} returned rows but no in-scope fixed URL matched for ${finalUrl}`);
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
    connected: true, status: 'ok', fixCount: fixes.length, measuredCount, fixes, ...(sourcing && { sourcing }),
  }, finalUrl);
}
