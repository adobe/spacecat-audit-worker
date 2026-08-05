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
 * Fetches one (hostname, platform) page.
 *
 * @returns {Promise<{ hostname: string, rows: object[], ok: boolean }>} `ok` is
 *   false on network error / timeout / non-2xx / unparseable body. The array is
 *   hard-capped at `PAGE_SIZE`.
 */
async function fetchRows({ hostname, url }, headers, log) {
  let response;
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    log.error(`${LOG_PREFIX} Fetch failed for ${hostname}: ${error.message}`);
    return { hostname, rows: [], ok: false };
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      // Distinct branch so a rejected service token is visible instead of being
      // masked as "Semrush returned nothing" (LLMO-6709 verification).
      log.error(`${LOG_PREFIX} Service token rejected for ${hostname} (HTTP ${response.status}) — verify the IMS service token is authorized by the Semrush proxy (LLMO-6709)`);
    } else {
      log.error(`${LOG_PREFIX} ${hostname} returned HTTP ${response.status}`);
    }
    return { hostname, rows: [], ok: false };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Could not parse ${hostname} response: ${error.message}`);
    return { hostname, rows: [], ok: false };
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  if (raw.length >= PAGE_SIZE) {
    log.warn(`${LOG_PREFIX} ${hostname} returned a full page (${raw.length} >= ${PAGE_SIZE}); response may be truncated — top URLs by citations could be missing`);
  }
  return { hostname, rows: raw.slice(0, PAGE_SIZE), ok: true };
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
 * @returns {Promise<Map<string, {count:number, domain:string|null}> | null>}
 */
export async function loadCitedUrlsFromSemrush({
  site, previousWeeks, context, siteHostname,
}) {
  const { log, env } = context;
  const baseUrl = env?.SPACECAT_API_URI || SPACECAT_API_DEFAULT_BASE_URL;

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    log.warn(`${LOG_PREFIX} Site has no organization id; skipping Semrush source`);
    return null;
  }

  // Distinguish "confirmed no brand" from "resolution failed" (transient), so a
  // PostgREST blip doesn't read like a permanently-unconfigured brand in logs.
  const { brand, resolved } = await resolveBrandResultForSite(context, site);
  if (!brand?.brandId) {
    if (resolved) {
      log.info(`${LOG_PREFIX} No active brand for org ${spaceCatId}; skipping Semrush source`);
    } else {
      log.warn(`${LOG_PREFIX} Brand resolution failed (transient) for org ${spaceCatId}; using legacy fallback`);
    }
    return null;
  }

  const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
  if (!dateWindow) {
    log.warn(`${LOG_PREFIX} Could not derive a date window; skipping Semrush source`);
    return null;
  }
  const { startDate, endDate } = dateWindow;

  let authorization;
  try {
    authorization = await getAuthorizationHeader(context);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to obtain IMS service token: ${error.message}`);
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
        url: buildDomainUrlsUrl({
          baseUrl, spaceCatId, brandId: brand.brandId, hostname, startDate, endDate, platform,
        }),
      });
    }
  }

  const results = await Promise.all(requests.map((r) => fetchRows(r, headers, log)));

  // Group by surface (hostname). Fall back to legacy only when a whole surface
  // produced ZERO successful responses (that surface would be dropped) — a single
  // failed engine is a partial count, not a dropped surface, and is tolerated.
  const byHost = new Map();
  for (const hostname of Object.keys(OFFSITE_DOMAINS)) {
    byHost.set(hostname, { anyOk: false, rows: [] });
  }
  for (const result of results) {
    const entry = byHost.get(result.hostname);
    if (result.ok) {
      entry.anyOk = true;
      entry.rows.push(...result.rows);
    }
  }
  for (const [hostname, entry] of byHost) {
    if (!entry.anyOk) {
      log.warn(`${LOG_PREFIX} No successful Semrush response for ${hostname}; using legacy fallback`);
      return null;
    }
  }

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

  // Drop URLs whose total citation volume is <= 0 (malformed / all-zero rows): a
  // zero-citation URL is not a real cited source and must not be scraped.
  for (const [url, info] of allUrls) {
    if (info.count <= 0) {
      allUrls.delete(url);
    }
  }

  log.info(`${LOG_PREFIX} Collected ${allUrls.size} cited URLs from Semrush`);
  return allUrls;
}
