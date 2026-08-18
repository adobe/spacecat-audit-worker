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
import {
  resolveSemrushEntitlement,
  SEMRUSH_NOT_ENTITLED_REASON,
  SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON,
} from './semrush-entitlement.js';
import { getDateWindowForPreviousWeeks } from './offsite-brand-presence-postgrest.js';
import { classifyAndNormalize } from './offsite-brand-presence-enrichment.js';
import { computeBrandTokens, isExcludedCitedHost } from './offsite-audit-utils.js';
import {
  createOffsiteLogger, errorField, AUDIT, PEER,
} from './offsite-logging.js';
import {
  TOP_CITED_EXCLUDED_DOMAINS,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
} from '../offsite-brand-presence/constants.js';

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
 * Max chars of a non-2xx response body to log. The body of a rejected
 * serenity/Semrush call identifies the rejecter — api-service `requireImsBearer`
 * ("...send the x-promise-token header instead") vs a Semrush upstream error —
 * which decides who owns the LLMO-6709 auth fix. Capped defensively.
 */
const ERROR_BODY_SNIPPET_MAX = 500;

/**
 * Reads a non-2xx response body as a short diagnostic snippet. Never throws.
 *
 * @param {Response} response
 * @returns {Promise<string>} the body (trimmed + capped), or '' if empty/unreadable.
 */
async function readErrorBodySnippet(response) {
  try {
    const text = await response.text();
    return text ? text.slice(0, ERROR_BODY_SNIPPET_MAX) : '';
  } catch {
    return '';
  }
}

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
 * @returns {Promise<{ rows: object[], ok: boolean, authFailure: boolean, truncated: boolean }>}
 *   `ok` is false on network error / timeout / non-2xx / unparseable body. `authFailure`
 *   distinguishes a 401/403 (auth issue) from other failures. `truncated` is true when a
 *   full page came back (LLMO-6711 shadow-run parity signal — a starved run is visible on
 *   `diagnostics` without grepping logs).
 */
async function fetchDomainUrls(url, headers, olog, pageSize) {
  let response;
  const startedAt = Date.now();
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    olog.failure('domain_urls_fetch', 'Fetch failed for domain-urls', {
      peer: PEER.SEMRUSH, direction: 'inbound', durationMs: Date.now() - startedAt, ...errorField(error),
    }, error);
    return {
      rows: [], ok: false, authFailure: false, truncated: false,
    };
  }

  if (!response.ok) {
    const durationMs = Date.now() - startedAt;
    const authFailure = response.status === 401 || response.status === 403;
    // Capture the body so the rejecter is identifiable (api-service requireImsBearer
    // vs Semrush upstream) — the key signal for the LLMO-6709 auth gate.
    const responseBody = await readErrorBodySnippet(response);
    const logFields = {
      peer: PEER.SEMRUSH, direction: 'inbound', status: response.status, responseBody, durationMs,
    };
    if (authFailure) {
      // Distinct branch so a rejected service token is visible instead of being
      // masked as "Semrush returned nothing" (LLMO-6709 verification).
      olog.failure('domain_urls_fetch', `Service token rejected for domain-urls (HTTP ${response.status}) — verify the IMS service token is authorized by the Semrush proxy (LLMO-6709)`, logFields);
    } else {
      olog.failure('domain_urls_fetch', `domain-urls returned HTTP ${response.status}`, logFields);
    }
    return {
      rows: [], ok: false, authFailure, truncated: false,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    olog.failure('domain_urls_fetch', 'Could not parse domain-urls response', {
      peer: PEER.SEMRUSH, direction: 'inbound', durationMs: Date.now() - startedAt, ...errorField(error),
    }, error);
    return {
      rows: [], ok: false, authFailure: false, truncated: false,
    };
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  const truncated = raw.length >= pageSize;
  if (truncated) {
    olog.warn('domain_urls_fetch', `domain-urls returned a full page (${raw.length} >= ${pageSize}); response may be truncated`, {
      peer: PEER.SEMRUSH, direction: 'inbound', rowCount: raw.length, pageSize,
    });
  }
  return {
    rows: raw.slice(0, pageSize), ok: true, authFailure: false, truncated,
  };
}

/**
 * Classifies one `domain-urls` row into a bucket, or drops it.
 *
 * - Non-`http(s)` schemes (`mailto:`, `tel:`, `data:`, `javascript:`, `ftp:`, `ws:`, ...) are
 *   dropped upfront via an explicit allowlist on the raw `row.url`, rather than relying on
 *   `classifyAndNormalize` happening to produce an unparseable value for some of them
 *   (opaque schemes serialize `origin` to the literal string `"null"`) — that's incidental
 *   for opaque schemes and doesn't catch a scheme that reparses cleanly (`ftp:`, `ws:`) but
 *   is never a real citation source.
 * - `youtube.com` / `reddit.com` — matched via `classifyAndNormalize`, then the strict
 *   format regexes (drops non-thread Reddit URLs and lookalike YouTube hosts).
 * - Everything else is the third-party "cited" bucket (`domain: null`), unless it's
 *   `contentType: 'Owned'`, in `TOP_CITED_EXCLUDED_DOMAINS` (e.g. `wikipedia.org`), or a
 *   social/search/brand-lookalike host per `isExcludedCitedHost`.
 *
 * @returns {{url: string, domain: string|null}|null} `null` when the row is dropped.
 */
function classifyRow(row, siteHostname, brandTokens) {
  if (!row?.url) {
    return null;
  }
  let scheme;
  try {
    scheme = new URL(row.url).protocol;
  } catch {
    return null;
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    return null;
  }

  const classified = classifyAndNormalize(row.url, siteHostname);
  if (!classified) {
    return null;
  }
  if (classified.domain === 'youtube.com') {
    return YOUTUBE_URL_REGEX.test(row.url) ? { url: classified.url, domain: 'youtube.com' } : null;
  }
  if (classified.domain === 'reddit.com') {
    return REDDIT_URL_REGEX.test(row.url) ? { url: classified.url, domain: 'reddit.com' } : null;
  }
  if (row.contentType === 'Owned') {
    return null;
  }
  // The allowlist above guarantees classified.url is always a reparseable http(s) URL here.
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
 * @param {object} [params.diagnostics] - Optional out-param, mutated in place. On a null
 *   return, set to `{ fallbackReason }` with a specific code (`no-organization-id`,
 *   `no-active-brand`, `brand-resolution-failed`, `not-entitled`, `entitlement-check-failed`,
 *   `no-date-window`, `ims-token-failed`, `domain-urls-auth-failed`, or `domain-urls-failed`).
 *   The two entitlement reasons additionally set `entitlementReason` to the granular cause
 *   from `resolveSemrushEntitlement` (`flag-disabled` | `no-workspace` | `no-client` |
 *   `check-failed`) — `fallbackReason` alone cannot distinguish a confirmed non-entitlement
 *   from a wiring bug (`no-client`) vs a transient blip (`check-failed`). On a successful
 *   return, set to `{ truncated }` — true when the response came back at `PAGE_SIZE`, so a
 *   bucket may be starved (LLMO-6711 shadow-run parity signal).
 * @returns {Promise<Map<string, {count:number, domain:string|null}> | null>}
 */
export async function loadCitedUrlsFromSemrush({
  site, previousWeeks, context, siteHostname, onProgress, diagnostics,
}) {
  const { log, env } = context;
  const startedAt = Date.now();
  const siteId = site?.getId?.();
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });
  const elapsed = () => Date.now() - startedAt;
  const baseUrl = env?.SPACECAT_API_URI || SPACECAT_API_DEFAULT_BASE_URL;

  const notify = async (text) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    try {
      await onProgress(text);
    } catch (error) {
      olog.warn('brand_data_load', 'Failed to post Semrush progress update', {
        peer: PEER.SLACK, direction: 'outbound', ...errorField(error),
      });
    }
  };
  const setDiagnostics = (patch) => {
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, patch);
    }
  };

  olog.start('brand_data_load', 'Starting Semrush source attempt', { peer: PEER.SEMRUSH, direction: 'inbound', baseUrl });
  await notify(':mag: Starting Semrush URL-Inspector lookup...');

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    olog.warn('brand_data_load', 'Site has no organization id; skipping Semrush source', {
      peer: PEER.SEMRUSH, direction: 'inbound', durationMs: elapsed(), reason: 'no-organization-id',
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
      olog.skip('brand_data_load', `No active brand for org ${spaceCatId}; skipping Semrush source`, {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, durationMs: elapsed(), reason: 'no-active-brand',
      });
      await notify(':information_source: No active brand configured for this org — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'no-active-brand' });
    } else {
      olog.warn('brand_data_load', `Brand resolution failed (transient) for org ${spaceCatId}; using legacy fallback`, {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, durationMs: elapsed(), reason: 'brand-resolution-failed',
      });
      await notify(':warning: Brand resolution failed (transient) — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'brand-resolution-failed' });
    }
    return null;
  }

  // Gate on entitlement BEFORE any Semrush HTTP call (or minting an IMS token for
  // one): Semrush data only exists for brands provisioned in Semrush (serenity flag
  // on AND a resolvable workspace — same "flag AND workspace" gate api-service uses
  // to serve any Serenity route). Calling it for a non-entitled brand is a wasted
  // request on a paid, rate-limited product, and reliably yields an error/empty
  // response that would just fall back anyway.
  const entitlement = await resolveSemrushEntitlement(context, {
    orgId: spaceCatId, brandId: brand.brandId,
  });
  if (!entitlement.entitled) {
    if (entitlement.resolved) {
      olog.skip('brand_data_load', `Brand not entitled for Semrush (${entitlement.reason}) for org ${spaceCatId}; skipping Semrush source`, {
        peer: PEER.SEMRUSH,
        direction: 'inbound',
        orgId: spaceCatId,
        brandId: brand.brandId,
        entitlementReason: entitlement.reason,
        durationMs: elapsed(),
        reason: 'not-entitled',
      });
      await notify(':information_source: Brand is not entitled for Semrush — falling back to the legacy source.');
      // fallbackReason is the coarse, contract-level signal the handler's hard-stop
      // exemption keys off (SEMRUSH_ENTITLEMENT_SKIP_REASONS); entitlementReason keeps
      // the granular cause (`flag-disabled` | `no-workspace` | `no-client` |
      // `check-failed`) visible in diagnostics/auditResult without changing that
      // contract — see ADR 002, Decision 7.
      setDiagnostics({
        fallbackReason: SEMRUSH_NOT_ENTITLED_REASON,
        entitlementReason: entitlement.reason,
      });
    } else {
      olog.warn('brand_data_load', `Semrush entitlement check failed (transient) for org ${spaceCatId}; using legacy fallback`, {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(),
      });
      await notify(':warning: Could not verify Semrush entitlement (transient) — falling back to the legacy source.');
      setDiagnostics({
        fallbackReason: SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON,
        entitlementReason: entitlement.reason,
      });
    }
    return null;
  }

  const dateWindow = getDateWindowForPreviousWeeks(previousWeeks);
  if (!dateWindow) {
    olog.warn('brand_data_load', 'Could not derive a date window; skipping Semrush source', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(),
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
    olog.failure('brand_data_load', 'Failed to obtain IMS service token', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(), ...errorField(error),
    }, error);
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
  olog.start('brand_data_load', 'Querying domain-urls (all hosts, all platforms)', {
    peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, pageSize: PAGE_SIZE,
  });
  await notify(':satellite: Querying `domain-urls` (all hosts, all platforms) in a single request...');

  const result = await fetchDomainUrls(url, headers, olog, PAGE_SIZE);
  if (!result.ok) {
    olog.warn('brand_data_load', 'domain-urls request failed; using legacy fallback', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, durationMs: elapsed(),
    });
    await notify(':x: `domain-urls` request failed — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: result.authFailure ? 'domain-urls-auth-failed' : 'domain-urls-failed' });
    return null;
  }
  setDiagnostics({ truncated: result.truncated });

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

  olog.success('url_extract', 'Bucketed domain-urls response', {
    peer: PEER.SEMRUSH,
    direction: 'inbound',
    orgId: spaceCatId,
    brandId: brand.brandId,
    receivedCount: result.rows.length,
    uniqueUrlCount: allUrls.size,
    droppedCount: result.rows.length - allUrls.size,
    youtubeCount: bucketCounts['youtube.com'],
    redditCount: bucketCounts['reddit.com'],
    citedCount: bucketCounts.cited,
  });
  await notify(`:package: Loaded ${bucketCounts['youtube.com']} \`youtube.com\`, ${bucketCounts['reddit.com']} \`reddit.com\`, and ${bucketCounts.cited} cited (third-party) URL(s).`);

  olog.success('brand_data_load', `Collected ${allUrls.size} cited URLs from Semrush`, {
    peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, urlCount: allUrls.size, durationMs: elapsed(),
  });
  await notify(`:tada: Semrush source succeeded — *${allUrls.size}* total cited URL(s) in ${elapsed()}ms.`);
  return allUrls;
}
