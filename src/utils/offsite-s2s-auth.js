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
 * Shared S2S (service-to-service) authentication for the offsite Semrush-backed Serenity
 * endpoints. Both loaders — `domain-urls` (offsite-brand-presence-semrush.js) and `url-prompts`
 * (url-prompts-semrush.js) — go through {@link getS2sSessionAuthorization} here, so the auth
 * orchestration (IMS mint → S2S login exchange), the `imsOrgId`-keyed session-token cache, and
 * the LLMO host/prefix resolution live in exactly one place. This module has no internal
 * dependencies (only the IMS client + tracing fetch), so it introduces no import cycle.
 */

import { ImsClient } from '@adobe/spacecat-shared-ims-client';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

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
 * API gateway prefix in front of the host root. The LLMO Fastly edge routes api-service
 * under this prefix — the internal routes are registered bare (`/v2/orgs/...`,
 * `/auth/s2s/login`), and both the login AND the data call must carry the prefix externally
 * (confirmed against the UI's own network calls, which use `/api/v1/v2/...`). Prod is
 * `/api/v1`; non-prod uses `/api/ci` — override with `LLMO_API_PREFIX`.
 */
export const LLMO_API_DEFAULT_PREFIX = '/api/v1';

/** Per-request timeout for the IMS mint + S2S login exchange (not the data call). */
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
 * `imsOrgId` (the `no_ims_org_id` guard in the callers returns first), so the key space
 * can't be polluted by a falsy key.
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
 * Reads a non-2xx response body as a short diagnostic snippet. Never throws. Exported so the
 * data loaders can log an api-service/Semrush rejection body with the same cap.
 *
 * @param {Response} response
 * @returns {Promise<string>} the body (trimmed + capped), or '' if empty/unreadable.
 */
export async function readErrorBodySnippet(response) {
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
 * The two derived flags target the exact mistakes hand-edited IMS host/scope values recur
 * with across environments — a scheme in the host (`https://ims...` → `getaddrinfo ENOTFOUND
 * https`) and whitespace in the scope (`invalid_scope`) — and are emitted only when true.
 *
 * @param {object} [env]
 * @returns {object} log fields
 */
export function imsConfigDiagnostics(env) {
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
export function decodeS2sConsumerClaims(sessionToken) {
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
 * Resolves the fully-qualified api-service base URL (host root + gateway prefix) for the
 * Semrush-backed Serenity endpoints. Both the S2S login and every data route must carry the
 * `/api/v1` prefix on the LLMO edge (see {@link LLMO_API_DEFAULT_BASE_URL} /
 * {@link LLMO_API_DEFAULT_PREFIX}). Shared by every Semrush loader (`domain-urls`,
 * `url-prompts`) so host/prefix resolution stays in one place.
 *
 * @param {object} [env]
 * @returns {string} e.g. `https://llmo.experiencecloud.live/api/v1`
 */
export function resolveApiBaseUrl(env) {
  const baseUrl = env?.LLMO_API_BASE_URL || LLMO_API_DEFAULT_BASE_URL;
  return `${baseUrl}${env?.LLMO_API_PREFIX || LLMO_API_DEFAULT_PREFIX}`;
}

/**
 * Obtains a customer-scoped S2S session-token `Authorization` header for `imsOrgId`, reusing
 * the module-level session-token cache so a warm container mints once per org per TTL no matter
 * which loader (`domain-urls` or `url-prompts`) asks first. Mints the consumer IMS token
 * (`client_credentials`), then exchanges it for a session token whose `tenants` claim names
 * `imsOrgId`.
 *
 * On failure the thrown error carries a `.reason` fallback code (`ims_token_failed` |
 * `session_token_auth_failed` | `session_token_failed`) — plus `.status`/`.responseBody` on the
 * exchange leg — so callers can log/branch without re-deriving the classification. On a
 * data-call `401/403` the caller should {@link evictS2sSessionToken} to drop a stale cached
 * token so the next run self-heals.
 *
 * Returns `fromCache` and the raw `sessionToken` (not just the header) so a caller that wants
 * richer telemetry can log the decoded consumer claims on a fresh mint and distinguish a
 * cache-hit from a re-mint without re-implementing the flow.
 *
 * @param {object} params
 * @param {object} params.context - Lambda context (env + log).
 * @param {string} params.imsOrgId - Customer IMS org id (`...@AdobeOrg`) to scope the token.
 * @returns {Promise<{ authorization: string, sessionToken: string, fromCache: boolean }>}
 *   `authorization` is `Bearer <sessionToken>`.
 * @throws {Error} with `.reason` (and `.status`/`.responseBody` on exchange failure).
 */
export async function getS2sSessionAuthorization({ context, imsOrgId }) {
  const { env } = context;
  const nowMs = Date.now();
  const cached = getCachedSessionToken(imsOrgId, nowMs);
  if (cached) {
    return { authorization: `Bearer ${cached}`, sessionToken: cached, fromCache: true };
  }

  let imsAuthorization;
  try {
    imsAuthorization = await getImsAuthorizationHeader(context);
  } catch (error) {
    error.reason = 'ims_token_failed';
    throw error;
  }

  const loginUrl = env?.LLMO_S2S_LOGIN_URL || `${resolveApiBaseUrl(env)}/auth/s2s/login`;
  let sessionToken;
  try {
    sessionToken = await exchangeForSessionToken({ loginUrl, imsAuthorization, imsOrgId });
  } catch (error) {
    error.reason = (error.status === 401 || error.status === 403)
      ? 'session_token_auth_failed'
      : 'session_token_failed';
    throw error;
  }

  cacheSessionToken(imsOrgId, sessionToken, nowMs, resolveSessionTtlMs(env));
  return { authorization: `Bearer ${sessionToken}`, sessionToken, fromCache: false };
}

/**
 * Drops the cached session token for `imsOrgId` (exported wrapper over the module-level cache)
 * so a best-effort caller that sees a `401/403` on a data call can force the next run to
 * re-mint instead of replaying a revoked/rotated token for the rest of its TTL.
 *
 * @param {string} imsOrgId
 */
export function evictS2sSessionToken(imsOrgId) {
  evictSessionToken(imsOrgId);
}
