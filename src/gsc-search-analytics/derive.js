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
// Shared with lib.js so the derive OUTPUT bound and the runtime ABORT cap can never drift.
// (Extract lib.js's existing MAX_FIXED_URLS/MAX_DATE_GROUPS into this new constants.js and
// import them in both files — see Task 2, Step 3.)
import { MAX_FIXED_URLS, MAX_DATE_GROUPS } from './constants.js';

const MAX_CONCURRENT = 10; // bound the per-opportunity FixEntity fan-out (no N+1)

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const READY_LAG = 84 + 3; // a fix matures (after-window complete) ~87 days after deploy
const RETENTION_FLOOR = 396; // older fixes lose their before-window to GSC's ~16mo retention

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
const PAGE_URL_KEYS = {
  'meta-tags': ['url', 'pageUrl'],
  'broken-internal-links': ['urlFrom'],
  'broken-backlinks': ['url_to', 'urlTo'],
  sitemap: ['pageUrl'],
  canonical: ['url'],
  'structured-data': ['url'],
  hreflang: ['url'],
  cwv: ['url'],
  readability: ['pageUrl', 'url'],
  'redirect-chains': ['finalUrlFull', 'finalUrl'],
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
 *   sourcing: {mode:string, sourcedDateGroups:number, keptDateGroups:number, truncated:boolean}}>}
 */
export async function deriveFixedUrls(siteId, opts, context) {
  const { dataAccess, log } = context;
  const { Opportunity, FixEntity } = dataAccess;
  const { from, to } = resolveBand(opts);
  const statuses = opts.fixStatuses ?? [FixEntity.STATUSES.DEPLOYED, FixEntity.STATUSES.PUBLISHED];
  const typeFilter = Array.isArray(opts.fixTypes) ? new Set(opts.fixTypes) : null;
  const inRange = (d) => !!d && d >= from && d <= to;

  // Explicit fixTypes OVERRIDE the default set (so `fixTypes:['alt-text']` works); with no
  // fixTypes we fall back to the SEO_FIX_TYPES default (which excludes alt-text). Either
  // way this bounds the FixEntity fan-out to just the relevant opportunities.
  const opps = await Opportunity.allBySiteId(siteId);
  const relevant = opps.filter((o) => {
    const t = o.getType();
    return typeFilter ? typeFilter.has(t) : SEO_FIX_TYPES.has(t);
  });

  const tasks = relevant.map((opp) => async () => {
    const rows = [];
    for (const status of statuses) {
      // eslint-disable-next-line no-await-in-loop
      const fes = await FixEntity.allByOpportunityIdAndStatus(opp.getId(), status);
      for (const fe of fes) {
        const raw = fe.getPublishedAt?.() ?? fe.getExecutedAt?.();
        const fixDate = raw ? String(raw).slice(0, 10) : null;
        if (!inRange(fixDate)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        const cd = fe.getChangeDetails?.() ?? {};
        let urls = isHttp(cd.url) ? [cd.url] : [];
        if (urls.length === 0) {
          // eslint-disable-next-line no-await-in-loop
          const sugs = (await fe.getSuggestions?.()) ?? [];
          // Type-aware: the fixed-page URL key varies by opportunity type (see PAGE_URL_KEYS).
          urls = sugs.flatMap((s) => pageUrlsFromSuggestion(opp.getType(), s.getData?.()));
        }
        for (const url of urls) {
          rows.push({ url, fixType: opp.getType(), fixDate });
        }
      }
    }
    return rows;
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
  const sourcing = {
    mode: opts.since ? 'incremental' : 'backfill',
    sourcedDateGroups: allDates.length,
    // distinct dates ACTUALLY in the output — recomputed AFTER the URL cap, which can trim
    // the tail of a kept date-group, so this can be < min(allDates, MAX_DATE_GROUPS).
    keptDateGroups: new Set(fixedUrls.map((f) => f.fixDate)).size,
    truncated: allDates.length > MAX_DATE_GROUPS || urlTruncated,
  };
  if (sourcing.truncated) {
    log.warn(`gsc-search-analytics: sourcing truncated for site ${siteId} — kept newest ${sourcing.keptDateGroups}/${sourcing.sourcedDateGroups} date-groups (${fixedUrls.length} URLs). Narrow with an explicit window to reach older fixes.`);
  }
  log.info(`gsc-search-analytics: derived ${fixedUrls.length} fixed URLs for site ${siteId} in ${from}..${to} (${sourcing.mode})`);
  return { fixedUrls, sourcing };
}
