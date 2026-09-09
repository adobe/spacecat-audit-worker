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

import { limitConcurrencyAllSettled } from '../support/utils.js';
// Caps shared with lib.js (which imports the same constants) so the derive OUTPUT bound
// here and lib.js's runtime ABORT cap stay in lock-step.
import { MAX_FIXED_URLS, MAX_DATE_GROUPS } from './constants.js';
// Timing constants are owned by windows.js (the before/after window math). Derive the
// derive-side lags from them instead of re-hardcoding 84/87/396 here, so the two files
// cannot silently drift apart.
import { DAYS, GSC_LAG_DAYS, RETENTION_DAYS } from './windows.js';

// One FixEntity batch-load per relevant opportunity, bounded by this concurrency limit.
// getAllFixesWithSuggestionsByOpportunityId batches the suggestion lookup inside the
// data-access layer, so DB work is ~constant per opportunity — there is no per-fix
// getSuggestions() N+1 fanning out over the site's whole fix history.
const MAX_CONCURRENT = 10;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const READY_LAG = DAYS + GSC_LAG_DAYS; // 87: after-window completes ~87 days after deploy
// 396: before-window still inside GSC's ~16mo retention
const RETENTION_FLOOR = RETENTION_DAYS - DAYS;

/**
 * Resolve the deploy-date band to source fixes from, from a single optional `since`.
 *   - no input  -> BACKFILL: full measurable band (~13 months ago .. ~3 months ago)
 *   - since:D    -> INCREMENTAL: only fixes that matured (crossed the ~87-day line) since D
 * Explicit from/to still win as low-level overrides (deterministic tests, power users).
 * The `now` arg is injectable so the since/backfill branches are unit-testable.
 * @param {{since?:string, from?:string, to?:string}} opts
 * @param {Date} [now]
 * @returns {{from: string, to: string}}
 */
export function resolveBand(opts = {}, now = new Date()) {
  const { since, from, to } = opts;
  const readyEdge = iso(addDays(now, -READY_LAG)); // ~3 months ago
  const floor = iso(addDays(now, -RETENTION_FLOOR)); // ~13 months ago
  const resolvedTo = to ?? readyEdge;
  let resolvedFrom;
  if (from) {
    resolvedFrom = from;
  } else if (since) {
    const inc = iso(addDays(toUtc(since), -READY_LAG)); // fixes matured since `since`
    resolvedFrom = inc > floor ? inc : floor; // never dip below the retention floor
  } else {
    resolvedFrom = floor;
  }
  return { from: resolvedFrom, to: resolvedTo };
}

// Where the *fixed page's* public URL lives in suggestion.data differs by opportunity
// type (verified across all customers' spacecat.json, 2026-09-01). Reading only `data.url`
// silently drops whole types (broken-internal-links, broken-backlinks, sitemap, alt-text,
// redirect-chains). Map the SEO types we measure to their key; fall through the common
// spellings for anything unlisted.
export const PAGE_URL_KEYS = {
  'meta-tags': ['url', 'pageUrl'],
  // suggestion schema allows either spelling; snake_case (url_from) was silently yielding 0 URLs
  'broken-internal-links': ['urlFrom', 'url_from'],
  'broken-backlinks': ['url_to', 'urlTo'],
  sitemap: ['pageUrl'],
  canonical: ['url'],
  'structured-data': ['url'],
  hreflang: ['url'],
  cwv: ['url'],
  readability: ['pageUrl', 'url'],
  // TODO(validate): redirect-chains key semantics — whether the measured page is the SOURCE
  // (sourceUrl) or the DESTINATION (finalUrl*) — need validation against real suggestion
  // data. sourceUrl is a last-resort fallback only until that is confirmed.
  'redirect-chains': ['finalUrlFull', 'finalUrl', 'sourceUrl'],
};
const FALLBACK_URL_KEYS = ['url', 'pageUrl', 'urlFrom', 'url_to', 'urlTo'];
const isHttp = (v) => typeof v === 'string' && v.startsWith('http');

// SEO allow-list: the DEFAULT set of opportunity types whose page-level fix has a
// meaningful GSC web-search before/after. Everything else (a11y, forms, security,
// paid-traffic, LLMO summarization/toc, offsite analyses, prerender, llm-error-pages) is
// excluded up front — keeps meaningless measurements out AND bounds the fan-out.
// alt-text is EXCLUDED by default (decision 2026-09-07): its signal is image-search, not
// the web-search clicks/impressions/position this audit records, and it is the largest
// volume driver (caps pressure). It is still reachable by passing fixTypes:['alt-text']
// explicitly, which overrides this default set (see the filter in deriveFixedUrls).
export const SEO_FIX_TYPES = new Set([
  'meta-tags', 'broken-internal-links', 'broken-backlinks', 'sitemap', 'canonical',
  'structured-data', 'hreflang', 'cwv', 'readability', 'redirect-chains',
]);

/**
 * Extract the fixed-page public URL(s) from one suggestion's data, keyed by opportunity
 * type. alt-text has no top-level URL — its per-image entries live under recommendations[].
 * Returns [] when no public URL is present (e.g. author-only fixes carrying only a documentPath).
 * @param {string} oppType
 * @param {object} data - suggestion.getData()
 * @returns {string[]}
 */
export function pageUrlsFromSuggestion(oppType, data) {
  if (!data || typeof data !== 'object') {
    return [];
  }
  // alt-text is the only type whose URL is nested under recommendations[]. Gate on the
  // type: other types (e.g. paid-traffic) ALSO carry a `recommendations` array with a
  // different shape, so this branch must not run for them.
  if (oppType === 'alt-text' && Array.isArray(data.recommendations)) {
    const recs = data.recommendations
      .map((r) => r?.pageUrl ?? r?.url)
      .filter(isHttp);
    if (recs.length) {
      return [...new Set(recs)];
    }
  }
  const keys = PAGE_URL_KEYS[oppType] ?? FALLBACK_URL_KEYS;
  for (const k of keys) {
    if (isHttp(data[k])) {
      return [data[k]];
    }
  }
  return [];
}

/**
 * Source the site's DEPLOYED/PUBLISHED fixed URLs from the data-service.
 * @param {string} siteId
 * @param {{since?:string,from?:string,to?:string,fixStatuses?:string[],fixTypes?:string[]}} opts
 * @param {object} context - { dataAccess: { Opportunity, FixEntity }, log }
 * @returns {Promise<{fixedUrls: Array<{url:string,fixType:string,fixDate:string}>,
 *   sourcing: {mode:string, sourcedDateGroups:number, keptDateGroups:number, truncated:boolean,
 *   opportunitiesErrored:number, partial:boolean, fixesSkippedNoDate:number}}>}
 */
export async function deriveFixedUrls(siteId, opts, context) {
  const { dataAccess, log } = context;
  const { Opportunity, FixEntity } = dataAccess;
  const { from, to } = resolveBand(opts);
  const statuses = new Set(
    opts.fixStatuses ?? [FixEntity.STATUSES.DEPLOYED, FixEntity.STATUSES.PUBLISHED],
  );
  const typeFilter = Array.isArray(opts.fixTypes) ? new Set(opts.fixTypes) : null;
  // d is a real YYYY-MM-DD here — the null case is already filtered out below.
  const inRange = (d) => d >= from && d <= to;

  // Explicit fixTypes OVERRIDE the default set (so `fixTypes:['alt-text']` works); with no
  // fixTypes we fall back to the SEO_FIX_TYPES default (which excludes alt-text). Either
  // way this bounds the FixEntity fan-out to just the relevant opportunities.
  const opps = await Opportunity.allBySiteId(siteId);
  const relevant = opps.filter((o) => {
    const t = o.getType();
    return typeFilter ? typeFilter.has(t) : SEO_FIX_TYPES.has(t);
  });

  // Partial-sourcing telemetry (surfaced on the audit row): a run that silently lost some
  // opportunities to fetch errors, or dropped fixes with no usable date, must be
  // distinguishable from a genuine clean zero.
  let opportunitiesErrored = 0;
  let fixesSkippedNoDate = 0;

  const tasks = relevant.map((opp) => async () => {
    const oppType = opp.getType();
    try {
      const rows = [];
      // Batch-load every fix for this opportunity WITH its suggestions attached in ~constant
      // queries, then filter status + date in memory. DB suggestion-resolution is bounded by
      // the opportunity count, not by total site fix history — no per-fix getSuggestions() N+1.
      const fixesWithSuggestions = await FixEntity
        .getAllFixesWithSuggestionsByOpportunityId(opp.getId());
      for (const { fixEntity: fe, suggestions } of fixesWithSuggestions) {
        // getAllFixesWithSuggestionsByOpportunityId returns every status; keep only ours.
        if (!statuses.has(fe.getStatus?.())) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const raw = fe.getPublishedAt?.() ?? fe.getExecutedAt?.();
        const fixDate = raw ? String(raw).slice(0, 10) : null;
        if (!fixDate) {
          fixesSkippedNoDate += 1;
          // eslint-disable-next-line no-continue
          continue;
        }
        if (!inRange(fixDate)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        // v1-only fast-path: v1 changeDetails carried a top-level `url`; v2 changeDetails has
        // no top-level url, so this rarely hits and the suggestion fallback is the common path.
        const cd = fe.getChangeDetails?.() ?? {};
        let urls = isHttp(cd.url) ? [cd.url] : [];
        if (urls.length === 0) {
          // Type-aware: the fixed-page URL key varies by opportunity type (see PAGE_URL_KEYS).
          urls = suggestions.flatMap((s) => pageUrlsFromSuggestion(oppType, s.getData?.()));
        }
        for (const url of urls) {
          rows.push({ url, fixType: oppType, fixDate });
        }
      }
      return rows;
    } catch (e) {
      opportunitiesErrored += 1;
      log.warn(`gsc-search-analytics: fix-entity fetch failed for opp ${opp.getId()} (${oppType}): ${e.message}`);
      return [];
    }
  });

  // limitConcurrencyAllSettled returns only the fulfilled task values (rejected ones
  // are dropped — one opportunity's fetch failing must not sink the whole derive).
  const settled = await limitConcurrencyAllSettled(tasks, MAX_CONCURRENT);
  const flat = settled.flat();

  // Dedupe on (url, fixDate). NOTE: if two opportunity types fixed the SAME url on the SAME
  // day, only the first fixType survives — acceptable for a tracking record (lossy
  // attribution), not a measurement error.
  const seen = new Set();
  const deduped = [];
  for (const f of flat) {
    const key = `${f.url} ${f.fixDate}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  // Bound the output so a wide backfill can't trip lib.js's hard caps (which ABORT the
  // whole run). Keep the MOST-RECENT MAX_DATE_GROUPS distinct fix-dates, then cap total
  // URLs at MAX_FIXED_URLS. Report truncation honestly (it surfaces in the audit row);
  // older history stays reachable with an explicit from/to (or an earlier `since`) window.
  deduped.sort((a, b) => b.fixDate.localeCompare(a.fixDate)); // newest fix-date first
  const allDates = [...new Set(deduped.map((f) => f.fixDate))];
  const keptDates = new Set(allDates.slice(0, MAX_DATE_GROUPS));
  let fixedUrls = deduped.filter((f) => keptDates.has(f.fixDate));
  const urlTruncated = fixedUrls.length > MAX_FIXED_URLS;
  if (urlTruncated) {
    fixedUrls = fixedUrls.slice(0, MAX_FIXED_URLS);
  }
  // BACKFILL = full measurable band (no bounds given). INCREMENTAL = since a date.
  // EXPLICIT = a from/to window was pinned; that is a bounded, deterministic pull, NOT a
  // backfill, so don't mislabel it.
  let mode;
  if (opts.since) {
    mode = 'incremental';
  } else if (opts.from || opts.to) {
    mode = 'explicit';
  } else {
    mode = 'backfill';
  }
  const sourcing = {
    mode,
    sourcedDateGroups: allDates.length,
    // distinct dates ACTUALLY in the output — recomputed AFTER the URL cap, which can trim
    // the tail of a kept date-group, so this can be < min(allDates, MAX_DATE_GROUPS).
    keptDateGroups: new Set(fixedUrls.map((f) => f.fixDate)).size,
    truncated: allDates.length > MAX_DATE_GROUPS || urlTruncated,
    opportunitiesErrored,
    partial: opportunitiesErrored > 0,
    fixesSkippedNoDate,
  };
  if (sourcing.truncated) {
    log.warn(`gsc-search-analytics: sourcing truncated for site ${siteId} — kept newest ${sourcing.keptDateGroups}/${sourcing.sourcedDateGroups} date-groups (${fixedUrls.length} URLs). Narrow with an explicit window to reach older fixes.`);
  }
  log.info(`gsc-search-analytics: derived ${fixedUrls.length} fixed URLs for site ${siteId} in ${from}..${to} (${sourcing.mode})`);
  return { fixedUrls, sourcing };
}
