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

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { resolveBrandResultForSite } from './brand-resolver.js';
import { getDateWindowForPreviousWeeks } from './offsite-brand-presence-postgrest.js';
import { classifyAndNormalize } from './offsite-brand-presence-enrichment.js';
import {
  OFFSITE_DOMAINS,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
  SEMRUSH_PLATFORM_BY_PROVIDER,
} from '../offsite-brand-presence/constants.js';

const LOG_PREFIX = '[offsite-brand-presence][semrush]';

/**
 * Default spacecat-api-service base URL. Its Elements proxy
 * (`src/controllers/elements.js`) serves the Semrush-backed Serenity
 * URL-Inspector endpoints at
 * `/v2/orgs/:spaceCatId/brands/:brandId/serenity/brand-presence/url-inspector/*`.
 * Overridable per-environment with `SPACECAT_API_URI`.
 */
export const SPACECAT_API_DEFAULT_BASE_URL = 'https://spacecat.experiencecloud.live/api/v1';

/**
 * Rows requested per url-inspector page — covers the per-surface top-70
 * (`DRS_URLS_LIMIT`) in a single page. NOTE: a server-side citations-descending
 * sort is *assumed but not confirmed* for `domain-urls`; `fetchRows` logs a
 * truncation warning when a full page comes back and hard-caps the array at
 * `PAGE_SIZE` as defence against a malfunctioning upstream.
 */
const PAGE_SIZE = 100;

/**
 * Per-request timeout. A hung upstream must never stall the audit, or the whole
 * Semrush attempt (and therefore the legacy fallback in the handler) would never
 * resolve and the Lambda would run to its own timeout — worse than legacy-only.
 * (Unit tests stub the fetch; actual abort behaviour is a shadow-run integration
 * concern, not covered here.)
 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Default engine (serenity `platform`) values to query — the full offsite
 * provider set mapped to serenity models (`SEMRUSH_PLATFORM_BY_PROVIDER`).
 *
 * IMPORTANT: omitting `platform` does NOT aggregate across engines on the
 * `domain-urls` / `cited-domains` endpoints — the proxy resolves an absent value
 * to a single default engine. To mirror the legacy multi-engine mix we query each
 * engine explicitly and SUM citations per URL.
 */
export const DEFAULT_SEMRUSH_PLATFORMS = Object.freeze(
  Object.values(SEMRUSH_PLATFORM_BY_PROVIDER),
);

/**
 * Resolves which engine platform values to query. `OFFSITE_SEMRUSH_PLATFORMS`
 * (comma-separated) overrides the default list; a blank / separators-only value
 * falls back to the default rather than disabling all requests.
 *
 * @param {object} env - Lambda env.
 * @returns {string[]} platform values (always at least one).
 */
export function getSemrushPlatforms(env) {
  const raw = env?.OFFSITE_SEMRUSH_PLATFORMS;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = raw.split(',').map((p) => p.trim()).filter(Boolean);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  return [...DEFAULT_SEMRUSH_PLATFORMS];
}

/**
 * Mints an IMS service access token as an Authorization header value. The scheme
 * is normalised to `Bearer` (the token endpoint may return `token_type: "bearer"`
 * lowercase, which a strict `startsWith('Bearer ')` parser upstream would reject).
 *
 * @param {object} context - Lambda context (env + log).
 * @returns {Promise<string>} e.g. "Bearer eyJ...".
 * @throws {Error} when the token response has no access_token.
 */
async function getAuthorizationHeader(context) {
  const imsClient = ImsClient.createFrom(context);
  const token = await imsClient.getServiceAccessTokenV3();
  if (!token?.access_token) {
    throw new Error('IMS service token response missing access_token');
  }
  return `Bearer ${token.access_token}`;
}

/**
 * Builds a url-inspector `domain-urls` request URL. Path segments are
 * URL-encoded (matching `brand-resolver.js`); `platform` is included only when
 * provided.
 *
 * @returns {string}
 */
export function buildDomainUrlsUrl({
  baseUrl, spaceCatId, brandId, hostname, startDate, endDate, platform,
}) {
  const params = new URLSearchParams({
    startDate,
    endDate,
    hostname,
    pageSize: String(PAGE_SIZE),
  });
  if (platform) {
    params.set('platform', platform);
  }
  return `${baseUrl}/v2/orgs/${encodeURIComponent(spaceCatId)}/brands/${encodeURIComponent(brandId)}`
    + `/serenity/brand-presence/url-inspector/domain-urls?${params.toString()}`;
}

/**
 * Fetches one (hostname, platform) page. Every log call carries `siteId`/`hostname`/
 * `platform` as structured fields (in addition to the human-readable message) so a
 * Splunk query can isolate which site/surface/engine combination failed and why,
 * without parsing the message string.
 *
 * @returns {Promise<{ hostname: string, rows: object[], ok: boolean, authFailure: boolean }>}
 *   `ok` is false on network error / timeout / non-2xx / unparseable body. `authFailure` is
 *   true specifically for a 401/403 (distinct from other failure causes, since an
 *   intermittent auth/token rejection is the signal to watch during the pre-LLMO-6709
 *   verification window even when tolerated as a partial engine failure). The rows array is
 *   hard-capped at `PAGE_SIZE`.
 */
async function fetchRows({ hostname, platform, url }, headers, log, siteId) {
  const ctx = { siteId, hostname, platform };
  let response;
  const startedAt = Date.now();
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    log.error(`${LOG_PREFIX} Fetch failed for ${hostname}: ${error.message}`, {
      ...ctx, error: error.message, durationMs: Date.now() - startedAt,
    });
    return {
      hostname, rows: [], ok: false, authFailure: false,
    };
  }

  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    if (authFailure) {
      // Distinct branch so a rejected service token is visible instead of being
      // masked as "Semrush returned nothing" (LLMO-6709 verification).
      log.error(`${LOG_PREFIX} Service token rejected for ${hostname} (HTTP ${response.status}) — verify the IMS service token is authorized by the Semrush proxy (LLMO-6709)`, {
        ...ctx, status: response.status, durationMs: Date.now() - startedAt,
      });
    } else {
      log.error(`${LOG_PREFIX} ${hostname} returned HTTP ${response.status}`, {
        ...ctx, status: response.status, durationMs: Date.now() - startedAt,
      });
    }
    return {
      hostname, rows: [], ok: false, authFailure,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Could not parse ${hostname} response: ${error.message}`, {
      ...ctx, error: error.message, durationMs: Date.now() - startedAt,
    });
    return {
      hostname, rows: [], ok: false, authFailure: false,
    };
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  if (raw.length >= PAGE_SIZE) {
    log.warn(`${LOG_PREFIX} ${hostname} returned a full page (${raw.length} >= ${PAGE_SIZE}); response may be truncated — top URLs by citations could be missing`, {
      ...ctx, rowCount: raw.length, pageSize: PAGE_SIZE,
    });
  }
  return {
    hostname, rows: raw.slice(0, PAGE_SIZE), ok: true, authFailure: false,
  };
}

/**
 * Loads the offsite cited URLs from the Semrush-backed Serenity URL-Inspector
 * endpoints (via the spacecat-api-service Elements proxy), producing the exact
 * `allUrls: Map<url, { count, domain }>` shape the existing `selectTopUrls` -> DRS
 * pipeline consumes. `count` = exact citation volume (summed across engines).
 *
 * Returns `null` (so the handler falls back to the legacy source) when a usable
 * result cannot be produced: no org/brand, transient brand-resolution failure,
 * no date window, auth failure, or when a whole surface (hostname) produced zero
 * successful responses. A single failed engine is tolerated as a partial count.
 *
 * Scope: youtube.com + reddit.com only — off-host rows are dropped so nothing
 * leaks into the top-cited bucket. Region scoping and the generic cited bucket
 * are follow-ups (LLMO-6709 / LLMO-6710).
 *
 * @param {object} params
 * @param {object} params.site - Site model (`getOrganizationId()`).
 * @param {Array<{week:number, year:number}>} params.previousWeeks
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @param {string} [params.siteHostname] - www-stripped site hostname for owned-URL filtering.
 * @param {function(string): Promise<*>} [params.onProgress] - Optional best-effort progress
 *   callback (e.g. a Slack thread reply), invoked with a short human-readable status string at
 *   each stage of the attempt. Kept generic (not a Slack import) so this module stays testable
 *   without a Slack dependency; a failure here is logged and swallowed, never thrown — a Slack
 *   outage must not affect the Semrush attempt itself.
 * @param {object} [params.diagnostics] - Optional out-param, mutated in place. On a null return,
 *   set to `{ fallbackReason }` with a specific code (`no-organization-id`, `no-active-brand`,
 *   `brand-resolution-failed`, `no-date-window`, `ims-token-failed`, or `surface-failed:<host>`)
 *   instead of the single generic reason the handler used to report for every case. On a
 *   successful (non-null) return, set to
 *   `{ engineFailureCount, degradedHosts, authFailureDetected }` so a surface that tolerated
 *   partial engine failures is distinguishable from a clean run — both `dataSource` and
 *   `fallbackReason` alone report success/fail but not degradation.
 * @returns {Promise<Map<string, {count:number, domain:string|null}> | null>}
 */
export async function loadCitedUrlsFromSemrush({
  site, previousWeeks, context, siteHostname, onProgress, diagnostics,
}) {
  const { log, env } = context;
  const startedAt = Date.now();
  const siteId = site?.getId?.();
  const elapsed = () => Date.now() - startedAt;
  const baseUrl = env?.SPACECAT_API_URI || SPACECAT_API_DEFAULT_BASE_URL;

  const notify = async (text) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    try {
      await onProgress(text);
    } catch (error) {
      log.warn(`${LOG_PREFIX} Failed to post Semrush progress update: ${error.message}`, { siteId });
    }
  };
  const setDiagnostics = (patch) => {
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, patch);
    }
  };

  log.info(`${LOG_PREFIX} Starting Semrush source attempt`, { siteId, baseUrl });
  await notify(':mag: Starting Semrush URL-Inspector lookup...');

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    log.warn(`${LOG_PREFIX} Site has no organization id; skipping Semrush source`, {
      siteId, durationMs: elapsed(),
    });
    await notify(':warning: Site has no organization id — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: 'no-organization-id' });
    return null;
  }

  // Distinguish "confirmed no brand" from "resolution failed" (transient), so a
  // PostgREST blip doesn't read like a permanently-unconfigured brand in logs.
  const { brand, resolved } = await resolveBrandResultForSite(context, site);
  if (!brand?.brandId) {
    if (resolved) {
      log.info(`${LOG_PREFIX} No active brand for org ${spaceCatId}; skipping Semrush source`, {
        siteId, orgId: spaceCatId, durationMs: elapsed(),
      });
      await notify(':information_source: No active brand configured for this org — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'no-active-brand' });
    } else {
      log.warn(`${LOG_PREFIX} Brand resolution failed (transient) for org ${spaceCatId}; using legacy fallback`, {
        siteId, orgId: spaceCatId, durationMs: elapsed(),
      });
      await notify(':warning: Brand resolution failed (transient) — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'brand-resolution-failed' });
    }
    return null;
  }

  const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
  if (!dateWindow) {
    log.warn(`${LOG_PREFIX} Could not derive a date window; skipping Semrush source`, {
      siteId, orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(),
    });
    await notify(':warning: Could not derive a date window — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: 'no-date-window' });
    return null;
  }
  const { startDate, endDate } = dateWindow;

  let authorization;
  try {
    authorization = await getAuthorizationHeader(context);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to obtain IMS service token: ${error.message}`, {
      siteId,
      orgId: spaceCatId,
      brandId: brand.brandId,
      error: error.message,
      durationMs: elapsed(),
    });
    await notify(`:x: Failed to obtain an IMS service token (\`${error.message}\`) — falling back to the legacy source.`);
    setDiagnostics({ fallbackReason: 'ims-token-failed' });
    return null;
  }

  const headers = {
    Authorization: authorization,
    // GET has no body — advertise the desired representation with Accept rather
    // than Content-Type (some proxies buffer/reject a Content-Type on a bodyless GET).
    Accept: 'application/json',
    // The api-service Elements proxy authenticates IMS callers directly and
    // forwards this Bearer to Semrush (resolveElementsImsToken fallback), so a
    // promise token is not required for a service caller. Forward one only if
    // the platform later threads it onto the context (non-IMS callers).
    ...(context.promiseToken ? { 'x-promise-token': context.promiseToken } : {}),
  };

  const platforms = getSemrushPlatforms(env);
  const requests = [];
  for (const hostname of Object.keys(OFFSITE_DOMAINS)) {
    for (const platform of platforms) {
      requests.push({
        hostname,
        platform,
        url: buildDomainUrlsUrl({
          baseUrl, spaceCatId, brandId: brand.brandId, hostname, startDate, endDate, platform,
        }),
      });
    }
  }
  const hostnames = Object.keys(OFFSITE_DOMAINS);
  log.info(`${LOG_PREFIX} Querying ${hostnames.length} hostnames x ${platforms.length} platforms (${requests.length} requests)`, {
    siteId, orgId: spaceCatId, brandId: brand.brandId, hostnames, platforms,
  });
  await notify(`:satellite: Querying ${hostnames.length} surface(s) x ${platforms.length} engine(s) (${requests.length} requests)...`);

  const results = await Promise.all(requests.map((r) => fetchRows(r, headers, log, siteId)));

  // Group by surface (hostname). Fall back to legacy only when a whole surface
  // produced ZERO successful responses (that surface would be dropped) — a single
  // failed engine is a partial count, not a dropped surface, and is tolerated.
  const byHost = new Map();
  for (const hostname of Object.keys(OFFSITE_DOMAINS)) {
    byHost.set(hostname, {
      anyOk: false, okCount: 0, failCount: 0, authFailureCount: 0, rows: [],
    });
  }
  for (const result of results) {
    const entry = byHost.get(result.hostname);
    if (result.ok) {
      entry.anyOk = true;
      entry.okCount += 1;
      entry.rows.push(...result.rows);
    } else {
      entry.failCount += 1;
      if (result.authFailure) {
        entry.authFailureCount += 1;
      }
    }
  }
  for (const [hostname, entry] of byHost) {
    // One summary line per hostname (not per-request) — enough to see partial engine
    // degradation in Splunk without a log line per one of the ~12 concurrent requests.
    log.info(`${LOG_PREFIX} ${hostname}: ${entry.okCount}/${entry.okCount + entry.failCount} engine requests succeeded`, {
      siteId, hostname, okCount: entry.okCount, failCount: entry.failCount,
    });
    if (!entry.anyOk) {
      log.warn(`${LOG_PREFIX} No successful Semrush response for ${hostname}; using legacy fallback`, {
        siteId, orgId: spaceCatId, hostname, platformsQueried: platforms, durationMs: elapsed(),
      });
      // Sequential, not Promise.all: these post to a Slack thread where message
      // order is the whole point (a readable narrative), not a perf-sensitive loop.
      // eslint-disable-next-line no-await-in-loop
      await notify(`:x: \`${hostname}\`: 0/${entry.okCount + entry.failCount} engine requests succeeded — falling back to the legacy source.`);
      setDiagnostics({ fallbackReason: `surface-failed:${hostname}` });
      return null;
    }
    // eslint-disable-next-line no-await-in-loop
    await notify(`:white_check_mark: \`${hostname}\`: ${entry.okCount}/${entry.okCount + entry.failCount} engine requests succeeded.`);
  }

  // Partial-degradation signal for LLMO-6711 shadow-run parity: a surface that
  // tolerated failed engines (see above) still reports dataSource: 'semrush' below
  // with no fallbackReason, so this is the only structured way to tell "clean run"
  // from "succeeded, but N engine requests failed" without going back to logs. Any
  // 401/403 is called out distinctly since an intermittent auth rejection is the
  // signal to watch for during the pre-LLMO-6709 verification window specifically.
  const engineFailureCount = [...byHost.values()].reduce((sum, entry) => sum + entry.failCount, 0);
  const degradedHosts = [...byHost.entries()]
    .filter(([, entry]) => entry.failCount > 0)
    .map(([hostname]) => hostname);
  const authFailureDetected = [...byHost.values()].some((entry) => entry.authFailureCount > 0);
  setDiagnostics({ engineFailureCount, degradedHosts, authFailureDetected });

  const allUrls = new Map();
  for (const [, entry] of byHost) {
    for (const row of entry.rows) {
      const classified = row?.url ? classifyAndNormalize(row.url, siteHostname) : null;
      if (!classified) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // Enforce the youtube/reddit-only scope on the OUTPUT. A `domain: null`
      // (off-host) row would otherwise pass both regex guards below and reach
      // selectTopUrls' top-cited bucket -> live TOP_CITED scrape, bypassing the
      // legacy isExcludedCitedHost / brand-token filtering this PR scopes out.
      if (classified.domain !== 'youtube.com' && classified.domain !== 'reddit.com') {
        // eslint-disable-next-line no-continue
        continue;
      }
      // Strict-format parity with the legacy handler path (non-thread Reddit,
      // lookalike YouTube host).
      if (classified.domain === 'youtube.com' && !YOUTUBE_URL_REGEX.test(row.url)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      if (classified.domain === 'reddit.com' && !REDDIT_URL_REGEX.test(row.url)) {
        // eslint-disable-next-line no-continue
        continue;
      }
      // Clamp: a negative value would subtract when summed and corrupt the
      // citations-descending ranking; NaN / non-numeric -> 0.
      const citations = Math.max(0, Number(row.citations) || 0);
      const existing = allUrls.get(classified.url);
      if (existing) {
        existing.count += citations;
      } else {
        allUrls.set(classified.url, { count: citations, domain: classified.domain });
      }
    }
  }

  // Drop URLs whose total citation volume is zero (malformed / all-zero rows): a
  // zero-citation URL is not a real cited source and must not be scraped. count can
  // never go negative here — each contribution is Math.max(0, ...)-clamped above, so
  // a sum of non-negative values is always >= 0; the check is `=== 0`, not `<= 0`.
  for (const [url, info] of allUrls) {
    if (info.count === 0) {
      allUrls.delete(url);
    }
  }

  // Loaded-per-surface counts, for the "loaded N results from <hostname>" progress
  // update — distinct from the engine-success-ratio message above, since a surface can
  // have every engine succeed yet contribute zero URLs (e.g. all filtered as off-format).
  const loadedByHostname = new Map(hostnames.map((hostname) => [hostname, 0]));
  for (const [, info] of allUrls) {
    // info.domain is always youtube.com/reddit.com here — the earlier scope guard
    // already dropped any other domain, so loadedByHostname always has this key.
    loadedByHostname.set(info.domain, loadedByHostname.get(info.domain) + 1);
  }
  for (const [hostname, count] of loadedByHostname) {
    // eslint-disable-next-line no-await-in-loop
    await notify(`:package: Loaded ${count} URL(s) from \`${hostname}\`.`);
  }

  log.info(`${LOG_PREFIX} Collected ${allUrls.size} cited URLs from Semrush`, {
    siteId,
    orgId: spaceCatId,
    brandId: brand.brandId,
    urlCount: allUrls.size,
    durationMs: elapsed(),
  });
  await notify(`:tada: Semrush source succeeded — *${allUrls.size}* total cited URL(s) in ${elapsed()}ms.`);
  return allUrls;
}
