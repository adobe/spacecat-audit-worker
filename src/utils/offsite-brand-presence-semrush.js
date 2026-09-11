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
import { getImsOrgId } from './data-access.js';
import { classifyAndNormalize } from './offsite-brand-presence-enrichment.js';
import { computeBrandTokens, isExcludedCitedHost } from './offsite-audit-utils.js';
import {
  createOffsiteLogger, errorField, AUDIT, OUTCOME, PEER,
} from './offsite-logging.js';
import {
  TOP_CITED_EXCLUDED_DOMAINS,
  YOUTUBE_URL_REGEX,
  REDDIT_URL_REGEX,
} from '../offsite-brand-presence/constants.js';

/**
 * Default spacecat-api-service base URL (host root, no path prefix). Its Elements proxy
 * (`src/controllers/elements.js`) serves the Semrush-backed Serenity URL-Inspector
 * endpoints at `/v2/orgs/:spaceCatId/brands/:brandId/serenity/brand-presence/url-inspector/*`.
 *
 * This MUST be the **LLMO** host, not the ASO host: the Fastly edge sets the `x-product`
 * header from the request `Host`, and these are LLMO routes. Minting the S2S session token
 * (and calling the data route) on the ASO host yields an ASO-context token that fails the
 * per-product entitlement check even with a valid `brand:read` grant. Prod is
 * `llmo.experiencecloud.live`; dev/CI is `llmo.experiencecloud.page` — override with
 * `LLMO_API_BASE_URL`.
 */
export const LLMO_API_DEFAULT_BASE_URL = 'https://llmo.experiencecloud.live';

/**
 * Path (relative to the LLMO host root) of the S2S login endpoint that exchanges the
 * consumer's IMS access token for a short-lived, customer-scoped SpaceCat session token.
 * The prod prefix is `/api/v1`; non-prod uses `/api/ci`, so the whole URL is overridable
 * with `LLMO_S2S_LOGIN_URL` when the environment's prefix differs.
 */
export const S2S_LOGIN_DEFAULT_PATH = '/api/v1/auth/s2s/login';

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
 * Max chars of a non-2xx response body to log. The body of a rejected serenity/Semrush
 * call identifies the rejecter — an api-service auth/ACL denial vs a Semrush upstream
 * error — which decides where an auth failure needs fixing. Capped defensively.
 */
const ERROR_BODY_SNIPPET_MAX = 500;

/**
 * Default S2S session-token cache TTL. The api-service session token lives 15 min; we cache
 * for a shorter window so a cached token is never handed to a data call at (or near) expiry.
 * The cache is module-level, so a warm Lambda container reuses it across audit invocations —
 * collapsing the IMS mint + login exchange to zero network calls for a brand whose customer
 * org was minted recently. Overridable with `SEMRUSH_S2S_SESSION_TTL_MS` so the window can be
 * retuned (e.g. if the login endpoint's token lifetime changes) without a code deploy.
 */
const SESSION_TOKEN_TTL_MS = 10 * 60 * 1000;

/**
 * Resolves the session-token cache TTL from env, falling back to the default. A non-positive
 * or non-numeric override is ignored (fail-safe to the default rather than a 0/NaN TTL that
 * would disable or corrupt caching).
 *
 * @param {object} env
 * @returns {number} TTL in ms.
 */
function resolveSessionTtlMs(env) {
  const override = Number(env?.SEMRUSH_S2S_SESSION_TTL_MS);
  return Number.isFinite(override) && override > 0 ? override : SESSION_TOKEN_TTL_MS;
}

/**
 * Module-level session-token cache, keyed by customer `imsOrgId` (the scope the token is
 * minted for). Value: `{ token, expiresAt }`. Not keyed by brand/site — one customer-scoped
 * session token authorizes every brand under that org. Only ever accessed with a truthy
 * `imsOrgId` (the `no_ims_org_id` guard above the caching logic returns first), so the key
 * space can't be polluted by a falsy key.
 */
const sessionTokenCache = new Map();

/**
 * @param {string} imsOrgId
 * @param {number} nowMs
 * @returns {string|null} the cached, still-valid session token for this org, or null.
 */
function getCachedSessionToken(imsOrgId, nowMs) {
  const entry = sessionTokenCache.get(imsOrgId);
  return entry && entry.expiresAt > nowMs ? entry.token : null;
}

/**
 * Caches a freshly-minted session token. Opportunistically sweeps expired entries on each
 * write so the map stays bounded by the number of distinct orgs seen within one TTL window
 * (not the life of the warm container) — a slow leak this shape would otherwise cause.
 *
 * @param {string} imsOrgId
 * @param {string} token
 * @param {number} nowMs
 * @param {number} ttlMs
 */
function cacheSessionToken(imsOrgId, token, nowMs, ttlMs) {
  for (const [key, entry] of sessionTokenCache) {
    if (entry.expiresAt <= nowMs) {
      sessionTokenCache.delete(key);
    }
  }
  sessionTokenCache.set(imsOrgId, { token, expiresAt: nowMs + ttlMs });
}

/**
 * Drops the cached token for an org — called when a cached token is rejected downstream by
 * the data call (401/403), so a revoked/rotated token can't be replayed for the rest of its
 * TTL and the next run re-mints (restoring the pre-caching self-heal-on-next-invocation).
 *
 * @param {string} imsOrgId
 */
function evictSessionToken(imsOrgId) {
  sessionTokenCache.delete(imsOrgId);
}

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
 * Mints an IMS access token for the audit-worker's dedicated Semrush S2S consumer, as an
 * Authorization header value.
 *
 * Unlike the worker's default IMS client (provisioned for `authorization_code`), the S2S
 * consumer is a dedicated `client_credentials` OAuth Server-to-Server integration — the
 * same shape content-ai uses (`CONTENTAI_*`). Its credentials come from `SEMRUSH_S2S_*`
 * env vars and are minted with `getServiceAccessTokenV3()` (the `client_credentials`
 * grant). This IMS token is only the FIRST leg — it is not sent to the data route
 * directly; it is exchanged for a customer-scoped session token (see
 * `exchangeForSessionToken`).
 *
 * The scheme is normalised to `Bearer` (IMS may return `token_type: "bearer"` lowercase,
 * which a strict `startsWith('Bearer ')` parser upstream would reject).
 *
 * Returns the full `Bearer <token>` header string (not a bare token) — named accordingly.
 *
 * @param {object} context - Lambda context (env + log).
 * @returns {Promise<string>} e.g. "Bearer eyJ...".
 * @throws {Error} when the token response has no access_token.
 */
async function getImsAuthorizationHeader(context) {
  const { env } = context;
  const imsClient = ImsClient.createFrom({
    ...context,
    env: {
      ...env,
      IMS_HOST: env?.SEMRUSH_S2S_IMS_HOST,
      IMS_CLIENT_ID: env?.SEMRUSH_S2S_CLIENT_ID,
      IMS_CLIENT_SECRET: env?.SEMRUSH_S2S_CLIENT_SECRET,
      IMS_SCOPE: env?.SEMRUSH_S2S_CLIENT_SCOPE,
      // `ImsClient.createFrom` validates clientCode as required, but the client_credentials
      // grant (`getServiceAccessTokenV3`) never sends it. Set it explicitly so a stripped
      // env (or the default authorization_code client being retired) can't surface as a
      // confusing `createFrom` throw masquerading as a token-mint failure.
      IMS_CLIENT_CODE: env?.SEMRUSH_S2S_CLIENT_CODE || 'unused-for-client-credentials',
    },
  });
  const token = await imsClient.getServiceAccessTokenV3();
  if (!token?.access_token) {
    throw new Error('IMS S2S token response missing access_token');
  }
  return `Bearer ${token.access_token}`;
}

/**
 * Non-secret IMS config fields for the `ims_token_failed` diagnostic log, so a misconfig is
 * obvious from the log line alone rather than needing a repro. Every field below is safe to
 * log: `imsHost`/`imsClientId`/`imsScope` are identifiers/config (not credentials), and the
 * client secret is reported only as a presence boolean (`hasClientSecret`), never its value.
 * The two derived flags target the exact mistakes seen in practice — a scheme in the host
 * (`https://ims...` → `getaddrinfo ENOTFOUND https`) and whitespace in the scope
 * (`invalid_scope`) — and are emitted only when true, so they stand out.
 *
 * @param {object} [env]
 * @returns {object} log fields
 */
function imsConfigDiagnostics(env) {
  const imsHost = env?.SEMRUSH_S2S_IMS_HOST;
  const imsScope = env?.SEMRUSH_S2S_CLIENT_SCOPE;
  return {
    imsHost,
    imsClientId: env?.SEMRUSH_S2S_CLIENT_ID,
    imsScope,
    hasClientSecret: Boolean(env?.SEMRUSH_S2S_CLIENT_SECRET),
    ...(/^https?:\/\//i.test(imsHost || '') && { imsHostHasScheme: true }),
    ...(/\s/.test(imsScope || '') && { imsScopeHasSpaces: true }),
  };
}

/**
 * Decodes the non-sensitive identity claims from an S2S session-token JWT for logging, so a
 * run's logs show WHICH consumer identity (and tenant scope) api-service actually granted —
 * the client-side counterpart to api-service's own `[s2s] granted clientId=... consumerId=...`
 * line. Reads the JWT payload only (never the signature) and never logs the token itself.
 * Never throws — returns `{}` for a malformed/opaque token, so nothing is logged then.
 *
 * The token carries `client_id`/`is_s2s_consumer`/`tenants`; `consumerId`/`consumer_id` are
 * logged defensively only if the real token includes them (it's primarily a server-side id).
 *
 * @param {string} sessionToken - raw JWT (`header.payload.signature`).
 * @returns {object} selected claim fields (empty when undecodable).
 */
function decodeS2sConsumerClaims(sessionToken) {
  try {
    const payload = String(sessionToken).split('.')[1];
    if (!payload) {
      return {};
    }
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const claims = JSON.parse(json);
    const tenants = Array.isArray(claims.tenants) ? claims.tenants : undefined;
    return {
      consumerClientId: claims.client_id,
      consumerSub: claims.sub,
      isS2sConsumer: claims.is_s2s_consumer,
      ...(claims.consumerId !== undefined && { consumerId: claims.consumerId }),
      ...(claims.consumer_id !== undefined && { consumerId: claims.consumer_id }),
      ...(tenants && { tenantCount: tenants.length }),
    };
  } catch {
    return {};
  }
}

/**
 * Exchanges the consumer's IMS access token for a short-lived (15-min), customer-scoped
 * SpaceCat session token via the S2S login endpoint. The returned session token is a JWT
 * whose `tenants` claim names `imsOrgId` — this is what api-service's
 * `hasAccess(organization)` actually checks to authorize the domain-urls read as an S2S
 * consumer. Both this call and the subsequent data call must hit the LLMO host (see
 * `LLMO_API_DEFAULT_BASE_URL`).
 *
 * On a non-2xx response the thrown error carries `.status` and `.responseBody` so the
 * caller can (a) split an authz denial (401/403 — a static config problem retries won't
 * fix) from a transient/other failure, and (b) log the full body while keeping it OUT of
 * any user-facing (Slack) message — the login endpoint's error body is untrusted upstream
 * content. The error `.message` deliberately holds only the status, never the body.
 *
 * @param {object} params
 * @param {string} params.loginUrl - Fully-qualified S2S login URL.
 * @param {string} params.imsAuthorization - `Bearer <ims-token>` from
 *   `getImsAuthorizationHeader`.
 * @param {string} params.imsOrgId - Target customer IMS org id (e.g. `...@AdobeOrg`).
 * @returns {Promise<string>} the session token (raw JWT, no scheme prefix).
 * @throws {Error} on network error, non-2xx (with `.status`/`.responseBody`), unparseable
 *   body, or a missing sessionToken.
 */
async function exchangeForSessionToken({ loginUrl, imsAuthorization, imsOrgId }) {
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      Authorization: imsAuthorization,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ imsOrgId }),
    timeout: FETCH_TIMEOUT_MS,
  });
  if (!response.ok) {
    const error = new Error(`s2s login returned ${response.status}`);
    error.status = response.status;
    error.responseBody = await readErrorBodySnippet(response);
    throw error;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error('s2s login response was not parseable JSON');
  }
  if (!body?.sessionToken) {
    throw new Error('s2s login response missing sessionToken');
  }
  return body.sessionToken;
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
    olog.warn('data_acquisition_bp_data_semrush_read', 'Fetch failed for domain-urls', {
      peer: PEER.SEMRUSH, direction: 'inbound', requestUrl: url, durationMs: Date.now() - startedAt, reason: 'fetch_failed', outcome: OUTCOME.DEGRADED, ...errorField(error),
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
      peer: PEER.SEMRUSH, direction: 'inbound', requestUrl: url, status: response.status, responseBody, durationMs,
    };
    if (authFailure) {
      // Distinct branch so a rejected session token is visible instead of being
      // masked as "Semrush returned nothing". On the S2S path a 401/403 here means the
      // session token expired/was invalid, or the consumer lacks `brand:read` / its
      // token's `tenants` claim doesn't name this org.
      olog.warn('data_acquisition_bp_data_semrush_read', 'S2S session token rejected for domain-urls; verify the consumer has brand:read and the session token names this org', {
        ...logFields, reason: 'auth_rejected', outcome: OUTCOME.DEGRADED,
      });
    } else {
      olog.warn('data_acquisition_bp_data_semrush_read', 'domain-urls returned a non-2xx status', {
        ...logFields, reason: 'non_2xx_status', outcome: OUTCOME.DEGRADED,
      });
    }
    return {
      rows: [], ok: false, authFailure, truncated: false,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    olog.warn('data_acquisition_bp_data_semrush_read', 'Could not parse domain-urls response', {
      peer: PEER.SEMRUSH, direction: 'inbound', durationMs: Date.now() - startedAt, reason: 'parse_failed', outcome: OUTCOME.DEGRADED, ...errorField(error),
    }, error);
    return {
      rows: [], ok: false, authFailure: false, truncated: false,
    };
  }

  const raw = Array.isArray(body?.urls) ? body.urls : [];
  const truncated = raw.length >= pageSize;
  if (truncated) {
    // A full page is a possibly-truncated result (potential starvation) — a data-completeness
    // caveat, not a full success, so the outcome is degraded rather than success.
    olog.warn('data_acquisition_bp_data_semrush_read', 'domain-urls returned a full page; response may be truncated', {
      peer: PEER.SEMRUSH, direction: 'inbound', rowCount: raw.length, pageSize, outcome: OUTCOME.DEGRADED,
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
 * @param {string} [params.imsOrgId] - Customer IMS org id (`...@AdobeOrg`) the session token
 *   is scoped to. The handler already resolves this (for DRS scraping too), so it threads it
 *   in to avoid a second, independently-fetched lookup that could scope the session token to
 *   a different org than the rest of the run. Falls back to `getImsOrgId(site, ...)` only when
 *   the caller omits it.
 * @param {string} [params.siteHostname] - www-stripped site hostname for owned-URL filtering.
 * @param {function(string): Promise<*>} [params.onProgress] - Optional best-effort progress
 *   callback (e.g. a Slack thread reply), invoked with a short human-readable status string at
 *   each stage of the attempt. Kept generic (not a Slack import) so this module stays testable
 *   without a Slack dependency; a failure here is logged and swallowed, never thrown — a Slack
 *   outage must not affect the Semrush attempt itself.
 * @param {object} [params.diagnostics] - Optional out-param, mutated in place. On a null
 *   return, set to `{ fallbackReason }` with a specific code (`no_organization_id`,
 *   `no_active_brand`, `brand_resolution_failed`, `not_entitled`, `entitlement_check_failed`,
 *   `no_date_window`, `no_ims_org_id`, `ims_token_failed`, `session_token_auth_failed`,
 *   `session_token_failed`, `domain_urls_auth_failed`, or `domain_urls_failed`).
 *   The two entitlement reasons additionally set `entitlementReason` to the granular cause
 *   from `resolveSemrushEntitlement` (`flag_disabled` | `no_workspace` | `no_client` |
 *   `check_failed`) — `fallbackReason` alone cannot distinguish a confirmed non-entitlement
 *   from a wiring bug (`no_client`) vs a transient blip (`check_failed`). On a successful
 *   return, set to `{ truncated }` — true when the response came back at `PAGE_SIZE`, so a
 *   bucket may be starved (LLMO-6711 shadow-run parity signal).
 * @returns {Promise<Map<string, {count:number, domain:string|null}> | null>}
 */
export async function loadCitedUrlsFromSemrush({
  site, previousWeeks, context, imsOrgId: providedImsOrgId, siteHostname, onProgress, diagnostics,
}) {
  const { log, env } = context;
  const startedAt = Date.now();
  const siteId = site?.getId?.();
  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE, siteId });
  const elapsed = () => Date.now() - startedAt;
  const baseUrl = env?.LLMO_API_BASE_URL || LLMO_API_DEFAULT_BASE_URL;

  const notify = async (text) => {
    if (typeof onProgress !== 'function') {
      return;
    }
    try {
      await onProgress(text);
    } catch (error) {
      olog.warn('data_acquisition_bp_data_semrush_read', 'Failed to post Semrush progress update', {
        peer: PEER.SLACK, direction: 'outbound', reason: 'slack_notify_failed', outcome: OUTCOME.DEGRADED, ...errorField(error),
      });
    }
  };
  const setDiagnostics = (patch) => {
    if (diagnostics && typeof diagnostics === 'object') {
      Object.assign(diagnostics, patch);
    }
  };

  olog.start('data_acquisition_bp_data_semrush_read', 'Starting Semrush source attempt', { peer: PEER.SEMRUSH, direction: 'inbound', baseUrl });
  await notify(':mag: Starting Semrush URL-Inspector lookup...');

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    olog.warn('data_acquisition_bp_data_semrush_read', 'Site has no organization id; skipping Semrush source', {
      peer: PEER.SEMRUSH, direction: 'inbound', durationMs: elapsed(), reason: 'no_organization_id', outcome: OUTCOME.SKIP,
    });
    await notify(':warning: Site has no organization id — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: 'no_organization_id' });
    return null;
  }

  // Distinguish "confirmed no brand" from "resolution failed" (transient), so a
  // PostgREST blip doesn't read like a permanently-unconfigured brand in logs.
  const { brand, resolved } = await resolveBrandResultForSite(context, site);
  if (!brand?.brandId) {
    if (resolved) {
      olog.warn('data_acquisition_bp_data_semrush_read', 'No active brand; skipping Semrush source', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, durationMs: elapsed(), reason: 'no_active_brand', outcome: OUTCOME.SKIP,
      });
      await notify(':information_source: No active brand configured for this org — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'no_active_brand' });
    } else {
      olog.warn('data_acquisition_bp_data_semrush_read', 'Brand resolution failed (transient); using legacy fallback', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, durationMs: elapsed(), reason: 'brand_resolution_failed', outcome: OUTCOME.DEGRADED,
      });
      await notify(':warning: Brand resolution failed (transient) — falling back to the legacy source.');
      setDiagnostics({ fallbackReason: 'brand_resolution_failed' });
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
      olog.warn('data_acquisition_bp_data_semrush_read', 'Brand not entitled for Semrush; skipping Semrush source', {
        peer: PEER.SEMRUSH,
        direction: 'inbound',
        orgId: spaceCatId,
        brandId: brand.brandId,
        entitlementReason: entitlement.reason,
        durationMs: elapsed(),
        reason: 'not_entitled',
        outcome: OUTCOME.SKIP,
      });
      await notify(':information_source: Brand is not entitled for Semrush — falling back to the legacy source.');
      // fallbackReason is the coarse, contract-level signal the handler's hard-stop
      // exemption keys off (SEMRUSH_ENTITLEMENT_SKIP_REASONS); entitlementReason keeps
      // the granular cause (`flag_disabled` | `no_workspace` | `no_client` |
      // `check_failed`) visible in diagnostics/auditResult without changing that
      // contract — see ADR 002, Decision 7.
      setDiagnostics({
        fallbackReason: SEMRUSH_NOT_ENTITLED_REASON,
        entitlementReason: entitlement.reason,
      });
    } else {
      olog.warn('data_acquisition_bp_data_semrush_read', 'Semrush entitlement check failed (transient); using legacy fallback', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(), reason: 'entitlement_check_failed', outcome: OUTCOME.DEGRADED,
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
    olog.warn('data_acquisition_bp_data_semrush_read', 'Could not derive a date window; skipping Semrush source', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(), reason: 'no_date_window', outcome: OUTCOME.SKIP,
    });
    await notify(':warning: Could not derive a date window — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: 'no_date_window' });
    return null;
  }
  const { startDate, endDate } = dateWindow;

  // S2S auth (3 legs). api-service serves the Semrush-backed domain-urls route to S2S
  // consumers, not to raw IMS service tokens (which carry no `tenants`/org membership and
  // are rejected by the IMS path). So we:
  //   1. resolve the customer's IMS org id (the session token must be scoped to it),
  //   2. mint the consumer's own IMS token (client_credentials),
  //   3. exchange it for a 15-min session token whose `tenants` claim names that org.
  // The domain-urls call then presents that session token.

  // Leg 1: the customer IMS org id (…@AdobeOrg) — distinct from spaceCatId (the SpaceCat
  // org UUID used in the route path). This is what the session token's `tenants` claim,
  // and thus api-service's hasAccess(organization), is keyed on. The handler already
  // resolves this (and reuses it for DRS scraping), so prefer the threaded value; the
  // lookup is only a fallback for callers that don't provide it.
  const imsOrgId = providedImsOrgId || await getImsOrgId(site, context.dataAccess || {}, log);
  if (!imsOrgId) {
    olog.warn('data_acquisition_bp_data_semrush_read', 'Could not resolve customer IMS org id; skipping Semrush source', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(), reason: 'no_ims_org_id', outcome: OUTCOME.DEGRADED,
    });
    await notify(':x: Could not resolve the customer IMS org id — falling back to the legacy source.');
    setDiagnostics({ fallbackReason: 'no_ims_org_id' });
    return null;
  }

  // Legs 2 + 3 — mint the consumer IMS token (client_credentials), then exchange it for a
  // customer-scoped session token. Both are skipped on a warm-container cache hit: one
  // customer-scoped token authorizes every brand under the org, so it is cached by imsOrgId
  // with a TTL under the 15-min server expiry.
  const nowMs = Date.now();
  let sessionToken = getCachedSessionToken(imsOrgId, nowMs);
  // Tracked so that a downstream 401/403 on the data call can distinguish "our cached token
  // went stale mid-window" (evict + self-heal next run) from "a freshly-minted token was
  // rejected" (the consumer registration / grant is actually broken).
  const sessionTokenFromCache = sessionToken !== null;
  if (!sessionToken) {
    // Leg 2: the consumer's IMS access token (dedicated client_credentials integration).
    let imsAuthorization;
    try {
      imsAuthorization = await getImsAuthorizationHeader(context);
    } catch (error) {
      olog.warn('data_acquisition_bp_data_semrush_read', 'Failed to obtain IMS service token', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, durationMs: elapsed(), reason: 'ims_token_failed', outcome: OUTCOME.DEGRADED, ...imsConfigDiagnostics(env), ...errorField(error),
      }, error);
      await notify(`:x: Failed to obtain an IMS service token (\`${error.message}\`) — falling back to the legacy source.`);
      setDiagnostics({ fallbackReason: 'ims_token_failed' });
      return null;
    }

    // Leg 3: exchange it for a customer-scoped SpaceCat session token via the LLMO host.
    const loginUrl = env?.LLMO_S2S_LOGIN_URL || `${baseUrl}${S2S_LOGIN_DEFAULT_PATH}`;
    try {
      sessionToken = await exchangeForSessionToken({ loginUrl, imsAuthorization, imsOrgId });
    } catch (error) {
      // Split an authz denial (401/403 — a static config problem retries won't fix: missing
      // brand:read, or the token's tenants claim doesn't name this org) from a transient/
      // other failure, mirroring fetchDomainUrls' authFailure branch.
      const authFailure = error.status === 401 || error.status === 403;
      const reason = authFailure ? 'session_token_auth_failed' : 'session_token_failed';
      olog.warn(
        'data_acquisition_bp_data_semrush_read',
        authFailure
          ? 'S2S session-token exchange denied (401/403); verify the consumer has brand:read and the token names this org'
          : 'Failed to exchange for an S2S session token',
        {
          peer: PEER.SEMRUSH,
          direction: 'inbound',
          orgId: spaceCatId,
          brandId: brand.brandId,
          status: error.status,
          responseBody: error.responseBody,
          durationMs: elapsed(),
          reason,
          outcome: OUTCOME.DEGRADED,
          ...errorField(error),
        },
        error,
      );
      // Forward only the status to Slack — the login endpoint's error body is untrusted
      // upstream content and must never be echoed into a user-facing channel (it stays in
      // the structured `responseBody` log field above).
      await notify(`:x: Failed to obtain an S2S session token${error.status ? ` (HTTP ${error.status})` : ''} — falling back to the legacy source.`);
      setDiagnostics({ fallbackReason: reason });
      return null;
    }
    cacheSessionToken(imsOrgId, sessionToken, nowMs, resolveSessionTtlMs(env));
    // Log the consumer identity we were granted (decoded from the token's claims, never the
    // token itself) — the client-side match to api-service's `[s2s] granted ...` audit line.
    olog.success('data_acquisition_bp_data_semrush_read', 'Obtained S2S session token', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, ...decodeS2sConsumerClaims(sessionToken),
    });
  }

  const headers = {
    // The customer-scoped S2S session token authorizes the read as an S2S consumer; it is
    // self-contained (no x-promise-token / IMS-forwarding needed on this path).
    Authorization: `Bearer ${sessionToken}`,
    // GET has no body — advertise the desired representation with Accept rather
    // than Content-Type (some proxies buffer/reject a Content-Type on a bodyless GET).
    Accept: 'application/json',
  };

  const url = buildDomainUrlsUrl({
    baseUrl, spaceCatId, brandId: brand.brandId, startDate, endDate, pageSize: PAGE_SIZE,
  });
  olog.start('data_acquisition_bp_data_semrush_read', 'Querying domain-urls (all hosts, all platforms)', {
    peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, requestUrl: url, pageSize: PAGE_SIZE,
  });
  await notify(':satellite: Querying `domain-urls` (all hosts, all platforms) in a single request...');

  const result = await fetchDomainUrls(url, headers, olog, PAGE_SIZE);
  if (!result.ok) {
    if (result.authFailure) {
      // The session token was rejected by the data call — evict it so a revoked/rotated
      // token can't be replayed from the cache for the rest of its TTL; the next run
      // re-mints. `wasCachedToken` lets ops tell a mid-window staleness (self-heals next
      // run) from a genuinely broken registration (a freshly-minted token rejected).
      evictSessionToken(imsOrgId);
    }
    olog.warn('data_acquisition_bp_data_semrush_read', 'domain-urls request failed; using legacy fallback', {
      peer: PEER.SEMRUSH,
      direction: 'inbound',
      orgId: spaceCatId,
      durationMs: elapsed(),
      reason: 'domain_urls_failed',
      outcome: OUTCOME.DEGRADED,
      ...(result.authFailure && { wasCachedToken: sessionTokenFromCache }),
    });
    await notify(':x: `domain-urls` request failed — falling back to the legacy source.');
    setDiagnostics({
      fallbackReason: result.authFailure ? 'domain_urls_auth_failed' : 'domain_urls_failed',
    });
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

  olog.success('data_acquisition_bp_data_semrush_read', 'Bucketed domain-urls response', {
    peer: PEER.SEMRUSH,
    direction: 'inbound',
    orgId: spaceCatId,
    brandId: brand.brandId,
    requestUrl: url,
    receivedCount: result.rows.length,
    uniqueUrlCount: allUrls.size,
    droppedCount: result.rows.length - allUrls.size,
    youtubeCount: bucketCounts['youtube.com'],
    redditCount: bucketCounts['reddit.com'],
    citedCount: bucketCounts.cited,
  });
  await notify(`:package: Loaded ${bucketCounts['youtube.com']} \`youtube.com\`, ${bucketCounts['reddit.com']} \`reddit.com\`, and ${bucketCounts.cited} cited (third-party) URL(s).`);

  olog.success('data_acquisition_bp_data_semrush_read', 'Collected cited URLs from Semrush', {
    peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, brandId: brand.brandId, urlCount: allUrls.size, durationMs: elapsed(),
  });
  await notify(`:tada: Semrush source succeeded — *${allUrls.size}* total cited URL(s) in ${elapsed()}ms.`);
  return allUrls;
}
