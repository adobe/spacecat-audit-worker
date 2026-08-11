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
 * Shared helpers for off-site guidance audits (reddit, youtube, cited, etc.):
 * caps on URLs sent to Mystique (SQS payload size), optional `urlLimit` from the audit queue,
 * and DRS availability filtering to ensure only already-scraped URLs are sent for analysis.
 */

import {
  DRS_POLL_INTERVAL_SECONDS,
  DRS_POLL_INTERVAL_UNATTENDED_SECONDS,
} from '../offsite-brand-presence/constants.js';
import { PEER, errorField, appendFields } from './offsite-logging.js';

export const MYSTIQUE_URLS_LIMIT = 50;

/**
 * DRS status-poll interval (seconds): attended (Slack) runs poll frequently for quick feedback,
 * unattended runs poll less often to cut overhead.
 *
 * @param {object} [slackContext] - `{ channelId, threadTs }` when the run is attended
 * @returns {number} Poll interval in seconds
 */
export function resolveDrsPollIntervalSeconds(slackContext) {
  const attended = Boolean(slackContext?.channelId && slackContext?.threadTs);
  return attended ? DRS_POLL_INTERVAL_SECONDS : DRS_POLL_INTERVAL_UNATTENDED_SECONDS;
}

/**
 * Social, search, and deal-aggregator domains that are NOT earned third-party
 * editorial content. Cited analysis measures earned brand perception, so these
 * are dropped entirely.
 *
 * Inclusion criteria: only domains actually observed polluting production
 * cited-URL lists are listed here, kept deliberately narrow to avoid dropping
 * legitimately earned content. Other social platforms (tiktok.com,
 * pinterest.com, linkedin.com) and search engines (bing.com) are intentionally
 * absent until they show up in real data — add them as observed.
 *
 * Note: `youtube.com` / `reddit.com` are also absent because they are routed
 * to their own dedicated analyses via `OFFSITE_DOMAINS` and are therefore
 * already excluded from the top-cited bucket.
 *
 * @type {readonly string[]}
 */
export const NON_EARNED_EXCLUDED_DOMAINS = Object.freeze([
  'google.com',
  'facebook.com',
  'instagram.com',
  'groupon.com',
]);

/**
 * Formats a millisecond duration as a compact human string (e.g. `42s`, `3m`, `3m 10s`).
 * Returns null for a missing/negative/non-finite input so callers can omit the line.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string|null}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return null;
  }
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/**
 * Builds the Slack phase-timing lines for an offsite analysis (cited/youtube/reddit),
 * from the timing anchors persisted on the audit result.
 *
 * - When a DRS scrape ran this cycle (drsStartedAt + drsCompletedAt present): reports the
 *   DRS scrape duration, the Mystique suggestion-generation duration (analysis start → now),
 *   and their sum as the total.
 * - When no scrape ran (content already scraped): reports DRS as n/a and Mystique = total.
 *
 * Returns '' when there is no usable timing anchor, so the caller appends nothing.
 *
 * @param {object} [timings] - { analysisStartedAt, drsStartedAt?, drsCompletedAt? } (epoch ms)
 * @param {number} [nowMs] - Completion instant (defaults to Date.now())
 * @returns {string} Newline-joined Slack lines, or '' when timings are unusable
 */
export function buildOffsiteTimingLines(timings, nowMs = Date.now()) {
  if (!timings || !Number.isFinite(timings.analysisStartedAt)) {
    return '';
  }
  const mystique = formatDuration(nowMs - timings.analysisStartedAt);
  if (mystique === null) {
    return '';
  }

  const { drsStartedAt, drsCompletedAt } = timings;
  const hasDrs = Number.isFinite(drsStartedAt) && Number.isFinite(drsCompletedAt);
  const drsMs = hasDrs ? drsCompletedAt - drsStartedAt : null;
  const drs = hasDrs ? formatDuration(drsMs) : null;

  if (drs === null) {
    return '• DRS scrape: reused prior scrape (n/a)\n'
      + `• Suggestion generation (Mystique): ${mystique}\n`
      + `• Total: ${mystique}`;
  }

  const total = formatDuration(drsMs + (nowMs - timings.analysisStartedAt));
  return `• DRS scrape: ${drs}\n`
    + `• Suggestion generation (Mystique): ${mystique}\n`
    + `• Total (DRS + Mystique): ${total}`;
}

/**
 * Logs the LLM cost/usage Mystique reported for an offsite analysis, at the end of
 * the run. Mystique stamps `opportunity.llmUsage`
 * ({ totalLlmCalls, totalTokens, totalCostUsd }) into the BO JSON; this surfaces it
 * as a structured, greppable log line alongside the timing lines.
 *
 * No-ops when `llmUsage` is absent or not an object (e.g. an analysis that doesn't
 * track token usage, or a tracking-degraded run) so the caller never has to guard.
 * Numeric fields are coerced defensively so a malformed payload can't throw.
 *
 * @param {object} log - Logger with an `info` method
 * @param {string} logPrefix - Per-audit log prefix (e.g. '[offsite:cited]')
 * @param {string} siteId - The site the analysis ran for
 * @param {object} [llmUsage] - { totalLlmCalls, totalTokens, totalCostUsd } from Mystique
 */
export function logOffsiteLlmUsage(log, logPrefix, siteId, llmUsage) {
  if (!llmUsage || typeof llmUsage !== 'object') {
    return;
  }
  const calls = Number(llmUsage.totalLlmCalls) || 0;
  const tokens = Number(llmUsage.totalTokens) || 0;
  const cost = Number(llmUsage.totalCostUsd) || 0;
  log.info(
    `${logPrefix} LLM usage for siteId: ${siteId}: ${calls} calls, `
    + `${tokens} tokens, est. cost $${cost.toFixed(4)}`,
  );
}

/**
 * Builds the Slack bullet line reporting the LLM cost/usage Mystique stamped onto
 * `opportunity.llmUsage`, for the "audit finished" summary. Mirrors {@link logOffsiteLlmUsage}
 * so the Slack line and the CloudWatch log line stay in sync: same fields, same 4-decimal cost.
 *
 * Returns an empty string when `llmUsage` is absent or not an object (e.g. an analysis that
 * doesn't track token usage, or a tracking-degraded run) so callers can append it
 * unconditionally. Numeric fields are coerced defensively so a malformed payload can't throw.
 *
 * @param {object} [llmUsage] - { totalLlmCalls, totalTokens, totalCostUsd } from Mystique
 * @returns {string} A Slack bullet line, or '' when there is nothing to report
 */
export function buildOffsiteLlmUsageLine(llmUsage) {
  if (!llmUsage || typeof llmUsage !== 'object') {
    return '';
  }
  const calls = Number(llmUsage.totalLlmCalls) || 0;
  const tokens = Number(llmUsage.totalTokens) || 0;
  const cost = Number(llmUsage.totalCostUsd) || 0;
  return `• :moneybag: LLM usage: ${calls} calls, ${tokens} tokens, est. cost $${cost.toFixed(4)}`;
}

// Tokens shorter than this are dropped from brand-token matching: a 1-2 char
// substring would match almost any host and turn the branded filter into a
// blunt instrument.
const MIN_BRAND_TOKEN_LENGTH = 3;

/**
 * Builds the set of lowercase brand tokens used to detect brand-owned lookalike
 * domains that are not subdomains of the brand apex (e.g. `lovedbylovesac.com`
 * for `lovesac.com`, which does not end in `.lovesac.com`).
 *
 * Tokens are sourced from:
 *  - the site apex label (`lovesac.com` → `lovesac`), and
 *  - each configured brand keyword, normalized to `[a-z0-9]` only.
 *
 * @param {string} [siteHostname] - www-stripped client hostname (e.g. `lovesac.com`)
 * @param {string[]} [brandKeywords] - brand keywords from site config
 * @returns {Set<string>} lowercase tokens at least `MIN_BRAND_TOKEN_LENGTH` chars long
 */
export function computeBrandTokens(siteHostname, brandKeywords = []) {
  const tokens = new Set();
  const apexLabel = String(siteHostname || '').toLowerCase().split('.')[0];
  if (apexLabel.length >= MIN_BRAND_TOKEN_LENGTH) {
    tokens.add(apexLabel);
  }
  // The parameter default ([]) covers a missing argument; the `|| []` guard
  // covers an explicit null/undefined passed by a caller (e.g. an unconfigured
  // `getBrandKeywords()` returning null). Both are needed.
  for (const keyword of brandKeywords || []) {
    const normalized = String(keyword).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.length >= MIN_BRAND_TOKEN_LENGTH) {
      tokens.add(normalized);
    }
  }
  return tokens;
}

/**
 * Extracts the hostname from a URL or bare host string, stripping the leading
 * `www.` so apex-to-apex comparison works regardless of how the brand domain is
 * configured (`bmw.com` vs `https://www.bmw.com/`).
 *
 * Returns an empty string for unparseable input — callers then treat the check
 * as a no-op rather than dropping URLs based on garbage.
 * @param {string} value
 * @returns {string}
 */
export function toApexHost(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Returns the reason a cited URL host must NOT enter the URL Store / cited
 * analysis, or `null` when the host is allowed.
 *
 * A host is excluded when it is (or is a subdomain of) a non-earned domain, or
 * when it contains a brand token as a substring (branded-lookalike match).
 * Matching is on the host only — never the path — so a third-party review at
 * `techradar.com/is-lovesac-good` is kept while `lovedbylovesac.com` is dropped.
 *
 * The reason string is intended for debug logging so operators can see exactly
 * which domain or brand token dropped a URL (important for short/common-word
 * brand tokens like `gap` or `art`). A non-null return is truthy, so existing
 * boolean call sites (`if (isExcludedCitedHost(...))`) keep working.
 *
 * @param {string} hostname - URL hostname (may include a leading `www.`)
 * @param {Set<string>} [brandTokens] - tokens from {@link computeBrandTokens}
 * @returns {string|null} reason (e.g. `domain:google.com` / `brand-token:lovesac`) or null
 */
export function isExcludedCitedHost(hostname, brandTokens) {
  if (!hostname) {
    return null;
  }
  const bare = String(hostname).toLowerCase().replace(/^www\./, '');
  for (const domain of NON_EARNED_EXCLUDED_DOMAINS) {
    if (bare === domain || bare.endsWith(`.${domain}`)) {
      return `domain:${domain}`;
    }
  }
  if (brandTokens) {
    for (const token of brandTokens) {
      if (bare.includes(token)) {
        return `brand-token:${token}`;
      }
    }
  }
  return null;
}

/**
 * Effective max URLs to send to Mystique for store-backed guidance audits
 * (reddit / youtube / cited). Optional limit from `auditContext.messageData.urlLimit`
 * (RunnerAudit). Runners merge the resolved value into `auditResult.config.urlLimit` for
 * post-processors and persistence (same field name as Slack).
 * Capped at MYSTIQUE_URLS_LIMIT.
 *
 * @param {object} [auditContext]
 * @param {number|string} [auditContext.messageData.urlLimit]
 * @param {object} [olog] - bound offsite logger (createOffsiteLogger); emits `url_limit_resolve`
 * @returns {number}
 */
/**
 * Error thrown when DRS successfully responded but reported no available scraped content.
 * Signals that scraping has not completed yet for any of the requested URLs.
 *
 * @param {string} message
 * @param {{total: number, available: number, scraping: number, notFound: number,
 *   determined: boolean}} [counts] - DRS status breakdown at the time of the failure, so
 *   callers can report why nothing was available (e.g. "67 not yet scraped"). Exposed as a
 *   constructor parameter rather than a post-hoc property so the contract is explicit and
 *   survives re-throwing / serialization.
 */
export class DrsNoContentAvailableError extends Error {
  constructor(message, counts) {
    super(message);
    this.name = 'DrsNoContentAvailableError';
    this.counts = counts;
  }
}

/**
 * Builds a per-URL DRS status breakdown that could not be determined (DRS unconfigured or
 * every lookup failed). The URLs are passed through unfiltered, so they are all treated as
 * "available" for downstream purposes, but `determined: false` lets callers omit misleading
 * counts from their logs and Slack messages.
 *
 * @param {number} total
 * @returns {{total: number, available: number, scraping: number, notFound: number,
 *   determined: boolean}}
 */
function undeterminedDrsCounts(total) {
  return {
    total, available: total, scraping: 0, notFound: 0, determined: false,
  };
}

/**
 * Renders the non-available portion of a DRS status breakdown as a short parenthetical,
 * e.g. ` (3 still scraping, 2 not yet scraped)`. Returns '' when the breakdown is undetermined
 * or every URL is already available, so callers can append it unconditionally without adding
 * noise to the common case.
 *
 * @param {{scraping: number, notFound: number, determined: boolean}} [counts]
 * @returns {string}
 */
export function formatDrsExtras(counts) {
  if (!counts || counts.determined === false) {
    return '';
  }
  const parts = [];
  if (counts.scraping > 0) {
    parts.push(`${counts.scraping} still scraping`);
  }
  if (counts.notFound > 0) {
    parts.push(`${counts.notFound} not yet scraped`);
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/**
 * Builds the Slack line an analysis audit posts when it has DRS content ready to send to
 * Mystique. Two things the wording must make unambiguous, because both previously confused
 * readers of the thread:
 *
 *  1. Destination — these URLs are sent to *Mystique for analysis*, NOT submitted to DRS for
 *     scraping. (Scraping is the offsite-brand-presence run's job; this is the consume side.)
 *  2. Source/scope — `urlCount` is the count of available URLs in the *full* URL store for
 *     this audit type (accumulated across runs), not this run's freshly-selected scrape batch.
 *     That is why it can exceed the "selected N to scrape this run" number the offsite run
 *     reports (e.g. 156 to Mystique vs. 70 selected this run).
 *  3. Cap — the post-processor caps the payload at `urlLimit` (MYSTIQUE_URLS_LIMIT, or a Slack
 *     override) before sending. When the store exceeds the cap, report BOTH the sent count and
 *     the store total (e.g. "50 of 68") so the line matches what Mystique actually receives
 *     rather than overstating it as the full store size.
 *
 * The lead-in is conditioned on whether a DRS scrape actually ran *this cycle*:
 *  - `scrapedNow` true  → "DRS scrape finished." (the offsite run scraped this cycle and the
 *    poll dispatched this analysis on completion).
 *  - `scrapedNow` false → "reusing previously scraped DRS content (no new scrape needed)."
 *    (a direct/scheduled analysis run consuming a prior scrape).
 *
 * @param {object} params
 * @param {string} params.analysisName - e.g. 'reddit-analysis'
 * @param {string} params.baseUrl
 * @param {number} params.urlCount - available URLs from the full store
 * @param {number} [params.urlLimit] - cap the post-processor applies before sending to Mystique
 * @param {object} [params.counts] - DRS status breakdown from {@link filterUrlsByDrsStatus}
 * @param {boolean} params.scrapedNow - whether a DRS scrape ran during this cycle
 * @returns {string}
 */
export function buildAnalysisScrapeStatusMessage({
  analysisName, baseUrl, urlCount, urlLimit, counts, scrapedNow,
}) {
  const extras = formatDrsExtras(counts);
  const leadIn = scrapedNow
    ? 'DRS scrape finished.'
    : 'reusing previously scraped DRS content (no new scrape needed).';
  // When the store holds more than the cap, the post-processor only sends `urlLimit` of them,
  // so show both counts; otherwise the plain store count is exactly what gets sent.
  const capped = Number.isFinite(urlLimit) && urlCount > urlLimit;
  const countPhrase = capped
    ? `Sending *${urlLimit}* of *${urlCount}* available URL(s)`
    : `Sending *${urlCount}* available URL(s)`;
  return `:mag: *${analysisName}* for *${baseUrl}* — ${leadIn} `
    + `${countPhrase} from the URL store to Mystique for analysis${extras}.`;
}

/**
 * Whether a DRS scrape ran during this audit cycle, inferred from the phase-timing anchors
 * threaded onto `auditContext.timings` by the offsite-brand-presence DRS status poll. Both
 * anchors are present only when the poll dispatched this analysis after a scrape completed;
 * a direct/scheduled run (reusing prior content) has neither.
 *
 * @param {object} [auditContext]
 * @returns {boolean}
 */
export function scrapedThisCycle(auditContext) {
  const t = auditContext?.timings;
  return Number.isFinite(t?.drsStartedAt) && Number.isFinite(t?.drsCompletedAt);
}

/**
 * Filters an array of URL objects to only those whose content is already available in DRS,
 * and returns a per-URL status breakdown alongside the filtered list.
 *
 * Runs one `lookupScrapeResults` call per dataset ID. A URL is counted as `available` when it
 * has `status === 'available'` in **at least one** of the provided datasets (Mystique can then
 * retrieve its scraped content); as `scraping` when it is not available anywhere but is
 * `scraping` in at least one dataset; otherwise it is `notFound`.
 *
 * Falls back gracefully (returns the original list unchanged, `counts.determined === false`)
 * when DRS is not configured or every dataset lookup fails / returns null — i.e. when DRS
 * availability cannot be determined.
 *
 * Throws a `DrsNoContentAvailableError` (with the breakdown attached as `.counts`) when DRS is
 * reachable and successfully responded but reported zero available URLs, meaning scraping has
 * not completed yet.
 *
 * @param {Array<{url: string}>} urls - URL objects from the URL Store
 * @param {string[]} datasetIds - DRS dataset IDs to check
 *   (e.g. ['reddit_posts', 'reddit_comments'])
 * @param {string} siteId - Site ID required by the DRS lookup API
 * @param {object|null} drsClient - Configured DrsClient instance (or null / unconfigured)
 * @param {object} [olog] - bound offsite logger (see createOffsiteLogger); emits `drs_availability`
 * @returns {Promise<{urls: Array<{url: string}>, counts: {total: number, available: number,
 *   scraping: number, notFound: number, determined: boolean}}>}
 * @throws {DrsNoContentAvailableError} When DRS responded but no URLs are available yet
 */
export async function filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, olog) {
  if (!drsClient || !drsClient.isConfigured()) {
    olog?.skip('drs_availability', 'DRS client not configured, skipping availability filter', {
      peer: PEER.DRS, direction: 'outbound', reason: 'not_configured',
    });
    return { urls, counts: undeterminedDrsCounts(urls.length) };
  }

  const rawUrls = urls.map((item) => item.url);
  const availableUrls = new Set();
  const scrapingUrls = new Set();
  let atLeastOneLookupSucceeded = false;

  for (const datasetId of datasetIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await drsClient.lookupScrapeResults({ datasetId, siteId, urls: rawUrls });
      if (!response) {
        olog?.warn('drs_availability', `DRS lookup returned null for datasetId=${datasetId}, skipping`, {
          peer: PEER.DRS, direction: 'outbound', datasetId, reason: 'null_response',
        });
        // eslint-disable-next-line no-continue
        continue;
      }
      atLeastOneLookupSucceeded = true;
      for (const result of response.results) {
        if (result.status === 'available') {
          availableUrls.add(result.url);
        } else if (result.status === 'scraping') {
          scrapingUrls.add(result.url);
        }
      }
      olog?.debug(
        'drs_availability',
        `DRS lookup datasetId=${datasetId}: `
        + `${response.summary?.available ?? 0}/${response.summary?.total ?? rawUrls.length} available, `
        + `${response.summary?.scraping ?? 0} scraping, ${response.summary?.not_found ?? 0} not-found`,
        { peer: PEER.DRS, direction: 'outbound', datasetId },
      );
    } catch (error) {
      olog?.warn('drs_availability', `DRS lookup failed for datasetId=${datasetId}, skipping`, {
        peer: PEER.DRS, direction: 'outbound', datasetId, ...errorField(error),
      });
    }
  }

  if (!atLeastOneLookupSucceeded) {
    olog?.warn('drs_availability', `All DRS lookups failed or returned null for datasets [${datasetIds.join(', ')}], skipping availability filter`, {
      peer: PEER.DRS, direction: 'outbound', reason: 'all_failed',
    });
    return { urls, counts: undeterminedDrsCounts(urls.length) };
  }

  const total = urls.length;
  const available = availableUrls.size;
  // A URL only counts as "scraping" when it is not already available in any dataset — an
  // in-progress scrape for a URL we can already read shouldn't inflate the scraping tally.
  const scraping = [...scrapingUrls].filter((url) => !availableUrls.has(url)).length;
  const notFound = Math.max(0, total - available - scraping);
  const counts = {
    total, available, scraping, notFound, determined: true,
  };

  if (available === 0) {
    throw new DrsNoContentAvailableError(
      `No scraped content available in DRS for datasets [${datasetIds.join(', ')}] and siteId: ${siteId}`,
      counts,
    );
  }

  const filtered = urls.filter((item) => availableUrls.has(item.url));
  const removed = total - filtered.length;
  if (removed > 0) {
    olog?.debug('drs_availability', `DRS availability filter: removed ${removed} URL(s) not yet scraped (${scraping} scraping, ${notFound} not-found), ${filtered.length} remaining`, {
      peer: PEER.DRS, direction: 'outbound', removed, remaining: filtered.length,
    });
  }
  return { urls: filtered, counts };
}

export function resolveMystiqueUrlLimit(auditContext, olog) {
  const ctx = auditContext ?? {};
  const raw = ctx.messageData?.urlLimit;
  if (raw === undefined || raw === null || raw === '') {
    return MYSTIQUE_URLS_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    olog?.warn(
      'url_limit_resolve',
      `Invalid urlLimit in auditContext (${JSON.stringify(raw)}), using default ${MYSTIQUE_URLS_LIMIT}`,
      { reason: 'invalid', urlLimit: MYSTIQUE_URLS_LIMIT },
    );
    return MYSTIQUE_URLS_LIMIT;
  }
  if (n > MYSTIQUE_URLS_LIMIT) {
    olog?.debug('url_limit_resolve', `urlLimit ${n} exceeds cap ${MYSTIQUE_URLS_LIMIT}, using ${MYSTIQUE_URLS_LIMIT}`, {
      requested: n, cap: MYSTIQUE_URLS_LIMIT, urlLimit: MYSTIQUE_URLS_LIMIT,
    });
    return MYSTIQUE_URLS_LIMIT;
  }
  return n;
}

/**
 * Builds a tri-state resolver for a single boolean flag delivered via
 * `auditContext.messageData[fieldName]` from a Slack custom arg — the shared shape
 * behind {@link resolveEnableBrandProfile} and {@link resolveEnableSemrush} (and any
 * future per-run override), so a third copy-paste doesn't drift from the first two.
 *
 * Tri-state by design: an explicit `true`/`false` (or the strings `'true'`/`'false'`)
 * overrides the caller's own default for this run only; `undefined` (absent, empty, or
 * invalid input) means the caller's default applies unchanged. Slack delivers keyword
 * values as strings, so only those two string forms or real booleans are accepted as
 * explicit values; anything else is invalid and resolves to `undefined` with a warning.
 *
 * @param {string} fieldName - Key read from `auditContext.messageData`.
 * @returns {function(object, object, string): boolean|undefined}
 */
function makeResolveOverride(fieldName) {
  return function resolveOverride(auditContext, log, logPrefix) {
    const prefix = logPrefix ?? '';
    const ctx = auditContext ?? {};
    const raw = ctx.messageData?.[fieldName];
    if (raw === true || raw === 'true') {
      return true;
    }
    if (raw === false || raw === 'false') {
      return false;
    }
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    // Route the Slack-controlled `raw` value through appendFields so renderField
    // quotes/sanitizes it as a single token — a crafted value cannot split the line
    // or forge a second key=value. (This helper is audit-agnostic, so it takes the
    // platform `log`, not an `olog`; the value must still be field-rendered, never
    // interpolated raw into the message.)
    log?.warn(appendFields(`${prefix} Invalid ${fieldName} in auditContext, omitting`, {
      reason: 'invalid_override',
      field: fieldName,
      raw: JSON.stringify(raw).slice(0, 100),
    }));
    return undefined;
  };
}

/**
 * Optional `enableBrandProfile` flag from `auditContext.messageData.enableBrandProfile`
 * (RunnerAudit). Runners merge the resolved value into `auditResult.config.enableBrandProfile`
 * for post-processors, which forward it to Mystique on `data.enableBrandProfile`; `undefined`
 * omits the flag entirely from the outgoing message so Mystique's own default applies.
 *
 * @param {object} [auditContext]
 * @param {boolean|string} [auditContext.messageData.enableBrandProfile]
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {boolean|undefined}
 */
export const resolveEnableBrandProfile = makeResolveOverride('enableBrandProfile');

/**
 * Optional `enableSemrush` flag from `auditContext.messageData.enableSemrush`. Lets a
 * Slack-triggered run override the global `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` env
 * var for that single run — e.g. to test the Semrush URL-Inspector source ahead of a
 * fleet-wide env var flip, or to force the legacy source for one run while the env var is
 * on. `undefined` means the env var's value applies unchanged.
 *
 * @param {object} [auditContext]
 * @param {boolean|string} [auditContext.messageData.enableSemrush]
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {boolean|undefined}
 */
export const resolveEnableSemrush = makeResolveOverride('enableSemrush');

/**
 * Same validation/cap as {@link resolveMystiqueUrlLimit}, but returns `undefined` when
 * `urlLimit` is absent instead of defaulting to `MYSTIQUE_URLS_LIMIT`. Used by
 * offsite-brand-presence to forward an explicitly-requested urlLimit through the DRS
 * scrape round-trip (poll → analysis audit) without forcing the default onto every run
 * that didn't ask for one — mirrors the tri-state {@link resolveEnableBrandProfile}.
 *
 * @param {object} [auditContext]
 * @param {number|string} [auditContext.messageData.urlLimit]
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {number|undefined}
 */
export function resolveForwardedUrlLimit(auditContext, log, logPrefix) {
  const raw = auditContext?.messageData?.urlLimit;
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  return resolveMystiqueUrlLimit(auditContext, log, logPrefix);
}

/**
 * Enqueues a domain-scoped offsite-brand-presence run so a single analysis audit can
 * obtain its own DRS-scraped content when none is available yet. The scoped run
 * collects + scrapes only `domainScope`, then (after DRS completes) re-triggers the
 * analysis audit — by which point its scraped content is available.
 *
 * @param {object} context - Universal context (sqs, dataAccess, log)
 * @param {string} siteId - The site ID
 * @param {string} domainScope - An OFFSITE_DOMAINS key (e.g. 'reddit.com') or 'top-cited'
 * @param {object} [slackContext] - Forwarded so notifications/results post to the thread
 * @param {boolean} [enableBrandProfile] - Forwarded so the re-triggered analysis audit (once
 *   this scoped offsite-brand-presence run completes DRS scraping) still resolves the flag
 *   originally requested on Slack, instead of losing it across the scrape round-trip.
 * @param {number} [urlLimit] - Forwarded so the re-triggered analysis audit still resolves the
 *   urlLimit originally requested on Slack, instead of losing it across the scrape round-trip.
 * @param {boolean} [enableSemrush] - Forwarded so this scoped offsite-brand-presence run honors
 *   the same `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED` override originally requested on Slack for
 *   the analysis audit that triggered it, instead of falling back to the plain env var.
 * @param {object} [olog] - bound offsite logger (see createOffsiteLogger); emits `scrape_request`
 *   with `reason=self_heal`. Threaded from the analysis-handler caller so the audit slug/ids are
 *   bound (this generic util does not know which analysis triggered the self-heal).
 *
 * Best-effort: a transient Configuration/SQS failure is logged and swallowed rather than
 * thrown, so the analysis audit degrades to its pending_scrape result instead of failing
 * the run with an opaque infra error.
 */
export async function requestOffsiteScrape(
  context,
  siteId,
  domainScope,
  slackContext,
  enableBrandProfile,
  urlLimit,
  enableSemrush,
  olog,
) {
  const { sqs, dataAccess } = context;
  // enableSemrush is included so a Splunk search on siteId shows whether a per-run
  // Semrush override survives this scrape round-trip, or gets lost/swallowed here.
  const overrides = {
    ...(enableBrandProfile != null && { enableBrandProfile }),
    ...(urlLimit != null && { urlLimit }),
    ...(enableSemrush != null && { enableSemrush }),
  };
  try {
    const configuration = await dataAccess.Configuration.findLatest();
    await sqs.sendMessage(configuration.getQueues().audits, {
      type: 'offsite-brand-presence',
      siteId,
      auditContext: {
        ...(slackContext && { slackContext }),
        messageData: { domainScope, ...overrides },
      },
    });
    olog?.success('scrape_request', `Requested DRS scrape for '${domainScope}' (site ${siteId})`, {
      peer: PEER.SQS, direction: 'outbound', reason: 'self_heal', domainScope, ...overrides,
    });
  } catch (error) {
    olog?.warn('scrape_request', `Failed to request DRS scrape for '${domainScope}' (site ${siteId})`, {
      peer: PEER.SQS, direction: 'outbound', reason: 'self_heal', domainScope, ...overrides, ...errorField(error),
    });
  }
}
