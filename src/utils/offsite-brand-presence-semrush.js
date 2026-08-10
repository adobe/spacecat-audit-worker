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
import { computeBrandTokens, isExcludedCitedHost } from './offsite-audit-utils.js';
import {
  TOP_CITED_EXCLUDED_DOMAINS,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
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
 * `domain-urls` page size. One request (no `hostname`, `platform=all`) covers all three
 * buckets (youtube.com, reddit.com, cited third-party), sorted by citations globally, so
 * this needs to be generous or a low-citation bucket gets starved. 1000 is the server-side
 * clamp (`domain-urls` in spacecat-api-service), so this is the max we can actually get.
 */
export const PAGE_SIZE = 1000;

/**
 * Per-request timeout so a hung upstream can't stall the whole audit past the Lambda's
 * own timeout.
 */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Mints an IMS service access token as an Authorization header value.
 *
 * Uses the v2 `getServiceAccessToken()` (`authorization_code` grant) with the
 * worker's default IMS client — the same S2S path `commerce-product-enrichments`,
 * `vulnerabilities` and `permissions` use. The default client is provisioned for
 * `authorization_code`, NOT the `client_credentials` grant that
 * `getServiceAccessTokenV3()` requests (which returns IMS `400 unauthorized_client`
 * unless a dedicated client_credentials integration is configured, e.g. content-ai's
 * `CONTENTAI_*`). The scheme is normalised to `Bearer` (the endpoint may return
 * `token_type: "bearer"` lowercase, which a strict `startsWith('Bearer ')` parser
 * upstream would reject).
 *
 * @param {object} context - Lambda context (env + log).
 * @returns {Promise<string>} e.g. "Bearer eyJ...".
 * @throws {Error} when the token response has no access_token.
 */
async function getAuthorizationHeader(context) {
  const imsClient = ImsClient.createFrom(context);
  const token = await imsClient.getServiceAccessToken();
  if (!token?.access_token) {
    throw new Error('IMS service token response missing access_token');
  }
  return `Bearer ${token.access_token}`;
}

/**
 * Builds the single `domain-urls` request URL: no `hostname` (returns every source host)
 * and `platform=all` (Semrush aggregates citations across every AI engine server-side).
 *
 * @returns {string}
 */
export function buildDomainUrlsUrl({
  baseUrl, spaceCatId, brandId, startDate, endDate, pageSize,
}) {
  const params = new URLSearchParams({
    startDate,
    endDate,
    platform: 'all',
    pageSize: String(pageSize),
  });
  return `${baseUrl}/v2/orgs/${encodeURIComponent(spaceCatId)}/brands/${encodeURIComponent(brandId)}`
    + `/serenity/brand-presence/url-inspector/domain-urls?${params.toString()}`;
}

/**
 * Fetches the single `domain-urls` page (all hosts, all platforms).
 *
 * @returns {Promise<{ rows: object[], ok: boolean, authFailure: boolean }>} `ok` is false
 *   on network error / timeout / non-2xx / unparseable body. `authFailure` distinguishes a
 *   401/403 (auth issue) from other failures.
 */
async function fetchDomainUrls(url, headers, log, siteId, pageSize) {
  const ctx = { siteId };
  let response;
  const startedAt = Date.now();
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    log.error(`${LOG_PREFIX} Fetch failed for domain-urls: ${error.message}`, {
      ...ctx, error: error.message, durationMs: Date.now() - startedAt,
    });
    return { rows: [], ok: false, authFailure: false };
  }

  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    if (authFailure) {
      log.error(`${LOG_PREFIX} Service token rejected for domain-urls (HTTP ${response.status}) — verify the IMS service token is authorized by the Semrush proxy (LLMO-6709)`, {
        ...ctx, status: response.status, durationMs: Date.now() - startedAt,
      });
    } else {
      log.error(`${LOG_PREFIX} domain-urls returned HTTP ${response.status}`, {
        ...ctx, status: response.status, durationMs: Date.now() - startedAt,
      });
    }
    return { rows: [], ok: false, authFailure };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Could not parse domain-urls response: ${error.message}`, {
      ...ctx, error: error.message, durationMs: Date.now() - startedAt,
    });
    return { rows: [], ok: false, authFailure: false };
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  if (raw.length >= pageSize) {
    log.warn(`${LOG_PREFIX} domain-urls returned a full page (${raw.length} >= ${pageSize}); response may be truncated`, {
      ...ctx, rowCount: raw.length, pageSize,
    });
  }
  return { rows: raw.slice(0, pageSize), ok: true, authFailure: false };
}

/**
 * Classifies one `domain-urls` row into a bucket, or drops it.
 *
 * - `youtube.com` / `reddit.com` — matched via `classifyAndNormalize`, then the strict
 *   format regexes (drops non-thread Reddit URLs and lookalike YouTube hosts).
 * - Everything else is the third-party "cited" bucket (`domain: null`), unless it's
 *   `contentType: 'Owned'`, in `TOP_CITED_EXCLUDED_DOMAINS` (e.g. `wikipedia.org`), or a
 *   social/search/brand-lookalike host per `isExcludedCitedHost`.
 *
 * @returns {{url: string, domain: string|null}|null} `null` when the row is dropped.
 */
function classifyRow(row, siteHostname, brandTokens) {
  const classified = row?.url ? classifyAndNormalize(row.url, siteHostname) : null;
  if (!classified) {
    return null;
  }
  if (classified.domain === 'youtube.com') {
    return YOUTUBE_URL_REGEX.test(row.url) ? { url: classified.url, domain: 'youtube.com' } : null;
  }
  if (classified.domain === 'reddit.com') {
    return REDDIT_URL_REGEX.test(row.url) ? { url: classified.url, domain: 'reddit.com' } : null;
  }
  if (row?.contentType === 'Owned') {
    return null;
  }
  const host = new URL(classified.url).hostname.toLowerCase().replace(/^www\./, '');
  if (TOP_CITED_EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) {
    return null;
  }
  if (isExcludedCitedHost(host, brandTokens)) {
    return null;
  }
  return { url: classified.url, domain: null };
}

/**
 * Loads the offsite cited URLs from the Semrush-backed `domain-urls` endpoint (via the
 * spacecat-api-service Elements proxy) in a single request — no `hostname`, `platform=all`
 * — producing the `allUrls: Map<url, { count, domain }>` shape `selectTopUrls` -> DRS
 * consumes. `count` = exact citations, aggregated across every AI engine by Semrush.
 *
 * Returns `null` (so the handler falls back to the legacy source) when no usable result can be
 * produced: no org/brand, transient brand-resolution failure, no date window, IMS token
 * failure, or the `domain-urls` request itself failed.
 *
 * The response is split client-side into three buckets: `youtube.com`, `reddit.com`, and
 * third-party "cited" — see `classifyRow`. Region scoping remains a follow-up (LLMO-6710).
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

  const url = buildDomainUrlsUrl({
    baseUrl, spaceCatId, brandId: brand.brandId, startDate, endDate, pageSize: PAGE_SIZE,
  });
  log.info(`${LOG_PREFIX} Querying domain-urls (all hosts, all platforms)`, {
    siteId, orgId: spaceCatId, brandId: brand.brandId, pageSize: PAGE_SIZE,
  });
  await notify(':satellite: Querying `domain-urls` (all hosts, all platforms) in a single request...');

  const result = await fetchDomainUrls(url, headers, log, siteId, PAGE_SIZE);
  if (!result.ok) {
    log.warn(`${LOG_PREFIX} domain-urls request failed; using legacy fallback`, {
      siteId, orgId: spaceCatId, durationMs: elapsed(),
    });
    await notify(':x: `domain-urls` request failed — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: result.authFailure ? 'domain-urls-auth-failed' : 'domain-urls-failed' });
    return null;
  }

  const brandKeywords = site.getConfig?.()?.getBrandKeywords?.() || [];
  const brandTokens = computeBrandTokens(siteHostname, brandKeywords);

  const allUrls = new Map();
  const bucketCounts = { 'youtube.com': 0, 'reddit.com': 0, cited: 0 };
  for (const row of result.rows) {
    const bucketed = classifyRow(row, siteHostname, brandTokens);
    if (!bucketed) {
      // eslint-disable-next-line no-continue
      continue;
    }
    // Clamp so a negative/non-numeric value can't corrupt the citations ranking; a
    // zero-citation URL is dropped as not a real cited source.
    const citations = Math.max(0, Number(row.citations) || 0);
    if (citations === 0) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const existing = allUrls.get(bucketed.url);
    if (existing) {
      existing.count += citations;
    } else {
      allUrls.set(bucketed.url, { count: citations, domain: bucketed.domain });
      bucketCounts[bucketed.domain ?? 'cited'] += 1;
    }
  }

  log.info(`${LOG_PREFIX} Bucketed domain-urls response`, {
    siteId,
    orgId: spaceCatId,
    brandId: brand.brandId,
    receivedCount: result.rows.length,
    uniqueUrlCount: allUrls.size,
    youtubeCount: bucketCounts['youtube.com'],
    redditCount: bucketCounts['reddit.com'],
    citedCount: bucketCounts.cited,
  });
  await notify(`:package: Loaded ${bucketCounts['youtube.com']} \`youtube.com\`, ${bucketCounts['reddit.com']} \`reddit.com\`, and ${bucketCounts.cited} cited (third-party) URL(s).`);

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
