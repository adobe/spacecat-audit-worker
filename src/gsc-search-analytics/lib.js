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
// Bound the scope-resolution HTTP GET: composeAuditURL follows redirects against a live
// origin, and a hung origin would otherwise stall the whole Lambda. On timeout we degrade
// to all-in-scope (same as any other scope-resolution failure).
const SCOPE_TIMEOUT_MS = 8000;
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
 * claim — this is the "Measured" layer.
 *
 * Input: by DEFAULT the runner SELF-SOURCES the site's DEPLOYED/PUBLISHED fixed URLs from
 * the data-service (deriveFixedUrls). An explicit `{ url, fixType, fixDate }[]` list in
 * auditContext.fixedUrls (or auditContext.messageData.fixedUrls) overrides that path. On the
 * self-source path these keyword args (from messageData, else auditContext) tune the pull:
 *   - since        — single watermark; incremental when set, full backfill when absent.
 *   - from / to    — low-level explicit band overrides (deterministic tests / power users).
 *   - fixStatuses  — FixEntity statuses to source (default DEPLOYED + PUBLISHED).
 *   - fixTypes     — opportunity types to source (default SEO set; alt-text is opt-in only).
 * A lone scalar arg (e.g. fixTypes:'meta-tags') is coerced to a one-element array; a
 * malformed since/from/to short-circuits to status 'invalid_input'.
 *
 * Result envelope (audit_result JSON): { schemaVersion, connected, status, fixCount,
 * measuredCount, fixes[], scopeResolved?, sourcing? }. `sourcing` is present only on a
 * self-sourced run ({ mode, sourcedDateGroups, keptDateGroups, truncated, ... }).
 * `scopeResolved` is false when the page-scope lookup failed or timed out and every URL was
 * therefore treated as in scope. Each fix carries a `status` of one of:
 *   measured | not_found | incomplete | invalid_date | out_of_scope | failed
 * plus before/after/delta/found and a dataQuality marker so a later reader can tell a
 * real signal from a data gap. Envelope-level `status` may also be one of:
 *   ok | not_connected | missing_fixed_urls | too_many_fixed_urls |
 *   too_many_date_groups | sourcing_failed | invalid_input
 *
 * @param {string} finalUrl - resolved site base URL.
 * @param {object} context - audit context ({ log, dataAccess, ... }).
 * @param {object} site - the site under audit.
 * @param {object} auditContext - explicit fixedUrls, or messageData keyword args (since,
 *   from, to, fixStatuses, fixTypes) driving the self-sourcing default.
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

    // Fix 2: a malformed since/from/to (e.g. '2026-5-1') would otherwise throw a RangeError
    // out of resolveBand and surface as an opaque 'sourcing_failed'. Reject any supplied-but-
    // invalid date up front with a distinct, self-describing status. Reached only on the
    // self-source path, so an explicit fixedUrls override with its own dates is never gated.
    const badDateField = ['since', 'from', 'to']
      .find((k) => kwargs[k] != null && !isValidFixDate(kwargs[k]));
    if (badDateField) {
      log.warn(`gsc-search-analytics: invalid ${badDateField} '${kwargs[badDateField]}' for ${finalUrl}`);
      return envelope({
        connected: null,
        status: 'invalid_input',
        reason: `invalid ${badDateField}: ${clip(String(kwargs[badDateField]))}`,
        fixCount: 0,
        measuredCount: 0,
        fixes: [],
      }, finalUrl);
    }

    // Fix 1: a single Slack/API value arrives scalar (fixTypes:'meta-tags'), but derive.js
    // gates on Array.isArray — a bare string silently falls back to the default set
    // (fixTypes) or iterates the string's characters (fixStatuses). Coerce a lone value to a
    // one-element array; leave an absent arg undefined so derive keeps its own defaults.
    const toList = (v) => (v == null ? undefined : [].concat(v));

    let derived;
    try {
      derived = await deriveFixedUrls(
        site.getId(),
        {
          since: kwargs.since, // single watermark: incremental when set, backfill when absent
          from: kwargs.from, // low-level overrides (tests / power users)
          to: kwargs.to,
          fixStatuses: toList(kwargs.fixStatuses),
          fixTypes: toList(kwargs.fixTypes),
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
    // Fix 4: a self-sourced run that connected fine but then fails createFrom keeps its
    // sourcing telemetry, so a partial failure stays diagnosable (invalid_input deliberately
    // does NOT — sourcing hasn't run yet at that point).
    return envelope({
      connected: false, status: 'not_connected', reason: clip(e.message), fixCount: 0, measuredCount: 0, fixes: [], ...(sourcing && { sourcing }),
    }, finalUrl);
  }

  // The GSC client scopes every query to `page contains composeAuditURL(finalUrl)` — for
  // krisshop that resolves (following redirects) to www.krisshop.com/en. A fixed URL
  // outside that host+path is never queried, so it must be distinguished from "queried,
  // no data" (not_found).
  // composeAuditURL does a live HTTP GET; every other external call in this runner records
  // a status instead of throwing. A DNS/transport error here must not reject the whole audit
  // now that GSC is already connected — degrade to prior behavior (all URLs in scope).
  // Fix 3: the try/catch below already degrades a THROW to all-in-scope, but a hung origin
  // would never throw — it would just stall the whole Lambda. Race the live GET against a
  // bounded timeout that rejects, so a slow origin routes into the same degrade path.
  let scope;
  let scopeTimer;
  try {
    const timeout = new Promise((_, reject) => {
      scopeTimer = setTimeout(
        () => reject(new Error(`scope resolution timed out after ${SCOPE_TIMEOUT_MS}ms`)),
        SCOPE_TIMEOUT_MS,
      );
    });
    scope = await Promise.race([composeAuditURL(finalUrl), timeout]); // e.g. "www.krisshop.com/en"
  } catch (e) {
    log.warn(`gsc-search-analytics: scope resolution failed for ${finalUrl}: ${e.message}; treating all fixed URLs as in scope`);
    scope = null;
  } finally {
    clearTimeout(scopeTimer); // cancel the pending timer whichever side of the race won
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
    // Fix 5: compute each fix's in-scope-ness ONCE and reuse it below (classification, the
    // group-level warning, and the whole-group skip) instead of calling inScope(f.url) twice
    // per URL.
    const groupInScope = group.map((f) => inScope(f.url));
    const anyOutOfScope = groupInScope.some((v) => !v);

    // Fix 5: if EVERY URL in this date-group is out of scope, none of them will ever be
    // queried — skip BOTH paginated GSC pulls entirely and record them straight as
    // out_of_scope. (A GSC round-trip for a group with no in-scope URL is pure waste.)
    if (!groupInScope.some((v) => v)) {
      log.warn(`gsc-search-analytics: ${fixDate} — all fixed URLs are outside the GSC fetch scope (${scope}); skipping GSC fetch, reported as out_of_scope for ${finalUrl}`);
      for (const f of group) {
        // Fix 6: never queried, so windows/before/after/delta stay null (baseFix shape).
        fixes.push(baseFix(f, 'out_of_scope'));
      }
      // eslint-disable-next-line no-continue
      continue;
    }

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
      for (let i = 0; i < group.length; i += 1) {
        const f = group[i];
        // out_of_scope is checked FIRST: a URL outside the GSC page-filter's host+path scope
        // was never queried, so it must not masquerade as 'not_found' — and Fix 6 nulls its
        // windows/before/after/delta (baseFix shape) so the row isn't misleading.
        if (!groupInScope[i]) {
          fixes.push(baseFix(f, 'out_of_scope'));
          // eslint-disable-next-line no-continue
          continue;
        }
        const b = lookup(beforeMap, f.url);
        const a = lookup(afterMap, f.url);
        const found = { before: !!b, after: !!a };
        if (found.before || found.after) {
          matchedAny = true;
        }
        let status;
        // Completeness is next: a not-yet-elapsed after-window legitimately returns no rows,
        // which must read as 'incomplete', not 'not_found'.
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
      // Prefer the real cause when SOME (but not all) URLs in this group are structurally out
      // of scope (locale/path filtering); otherwise fall back to the host-mismatch signal —
      // rows came back but no in-scope fixed URL matched (www/apex, or fixedUrls built from a
      // different host than the GSC property).
      const rowsSeen = beforeMap.size + afterMap.size > 0;
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
    // Fix 4: surface whether page-scope resolution succeeded. false => composeAuditURL failed
    // or timed out and every URL was treated as in scope (out_of_scope verdicts are then
    // unreliable), so the degraded run stays queryable.
    connected: true, status: 'ok', fixCount: fixes.length, measuredCount, fixes, scopeResolved: scope !== null, ...(sourcing && { sourcing }),
  }, finalUrl);
}
