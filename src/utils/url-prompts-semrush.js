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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { resolveBrandResultForSite } from './brand-resolver.js';
import { getDateWindowForPreviousWeeks } from './offsite-brand-presence-postgrest.js';
import { getPreviousWeeks } from './offsite-brand-presence-enrichment.js';
import { getImsOrgId } from './data-access.js';
import {
  resolveApiBaseUrl,
  getS2sSessionAuthorization,
  evictS2sSessionToken,
  decodeS2sConsumerClaims,
} from './offsite-s2s-auth.js';
import { resolveSemrushTimeoutMs } from './offsite-brand-presence-semrush.js';
import { resolveSemrushEntitlement } from './semrush-entitlement.js';
import {
  createOffsiteLogger, errorField, OUTCOME, PEER,
} from './offsite-logging.js';

/**
 * Structured-log event token for the whole url-prompts enrichment attempt (start + summary +
 * skip/failure). One token keeps the lifecycle greppable in Splunk, mirroring
 * `data_acquisition_bp_data_semrush_read` for the domain-urls call.
 */
const URL_PROMPTS_EVENT = 'data_acquisition_url_prompts_read';

/**
 * Max prompts kept per URL. The `url-prompts` endpoint has no pagination/limit
 * param of its own (it returns the full result set for one URL in a single call),
 * so the cap is applied client-side.
 */
export const MAX_URL_PROMPTS = 5;

/**
 * Hard ceiling for the per-URL prompt cap, so an env override can't request an unbounded slice
 * of a large upstream response into stored audit data.
 */
const MAX_URL_PROMPTS_CEILING = 50;

/**
 * Resolves the per-URL prompt cap from env — `OFFSITE_URL_PROMPTS_MAX`, an integer clamped to
 * `[1, MAX_URL_PROMPTS_CEILING]` — falling back to {@link MAX_URL_PROMPTS} for an absent/invalid
 * value (mirrors the `OFFSITE_SEMRUSH_TIMEOUT_MS` knob). Note the Mystique payload path applies
 * its own independent cap, so raising this only affects what is stored, not what is dispatched.
 *
 * @param {object} [env]
 * @returns {number}
 */
export function resolveMaxUrlPrompts(env) {
  const override = Number(env?.OFFSITE_URL_PROMPTS_MAX);
  if (!Number.isInteger(override) || override <= 0) {
    return MAX_URL_PROMPTS;
  }
  return Math.min(override, MAX_URL_PROMPTS_CEILING);
}

/**
 * Max characters kept per prompt string. `prompts` are third-party content flowing into stored
 * audit data and the downstream Mystique dispatch, so each is coerced to a string and truncated
 * at this ingestion boundary rather than relying on the SQS byte-budget as an incidental backstop.
 */
const MAX_PROMPT_LENGTH = 4096;

/**
 * Default per-request timeout for url-prompts: shorter than the domain-urls 60s because each call
 * is a single light per-URL lookup and up to 10 batches run sequentially (concurrency 5 over 50
 * URLs), which bounds the enrichment phase's wall-clock. The shared `OFFSITE_SEMRUSH_TIMEOUT_MS`
 * env override still applies to both loaders.
 */
const URL_PROMPTS_TIMEOUT_MS = 30_000;

/**
 * Max in-flight `url-prompts` requests. The caller forwards up to `MYSTIQUE_URLS_LIMIT` (50)
 * URLs and this loader issues one request per URL; a bounded pool keeps a burst of 50
 * token-bearing GETs off the LLMO edge / api-service connection pool at once.
 */
const REQUEST_CONCURRENCY = 5;

/**
 * `platform` value passed to the `url-prompts` endpoint. Unlike `domain-urls` / `cited-domains`,
 * this endpoint supports a special `all` value that aggregates prompts across every engine
 * server-side in a single request — one request per URL rather than one per (URL x engine) pair.
 */
const URL_PROMPTS_PLATFORM = 'all';

/**
 * Builds a url-inspector `url-prompts` request URL. `baseUrl` must already include the gateway
 * prefix (use {@link resolveApiBaseUrl}) — both the S2S login and the data route carry
 * `/api/v1` on the LLMO edge.
 *
 * @returns {string}
 */
export function buildUrlPromptsUrl({
  baseUrl, spaceCatId, brandId, url, startDate, endDate, platform = URL_PROMPTS_PLATFORM,
}) {
  const params = new URLSearchParams({
    url, startDate, endDate, platform,
  });
  return `${baseUrl}/v2/orgs/${encodeURIComponent(spaceCatId)}/brands/${encodeURIComponent(brandId)}`
    + `/serenity/brand-presence/url-inspector/url-prompts?${params.toString()}`;
}

/**
 * Runs `mapper` over `items` with at most `concurrency` in flight at once, preserving input
 * order in the resolved array. Best-effort: `mapper` is expected never to reject (each
 * {@link fetchUrlPrompts} resolves to a result object rather than throwing).
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      // Sequential within a worker is intentional — N workers give the bounded concurrency.
      // eslint-disable-next-line no-await-in-loop
      results[index] = await mapper(items[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Fetches the prompts associated with a single URL. Never throws — network errors, non-2xx
 * responses, and unparseable bodies resolve to an empty list (best-effort enrichment must not
 * fail the audit). Returns a `category` (`ok` | `non2xx` | `error`) for the aggregate summary
 * and an `authFailure` flag (401/403) so the caller can evict a stale cached session token.
 * Per-URL outcomes are NOT logged here — the loader emits a single aggregate summary instead.
 *
 * @returns {Promise<{ url: string, prompts: string[], authFailure: boolean, category: string }>}
 */
async function fetchUrlPrompts({ url, requestUrl }, headers, timeoutMs, maxPrompts) {
  let response;
  try {
    response = await fetch(requestUrl, { headers, timeout: timeoutMs });
  } catch {
    return {
      url, prompts: [], authFailure: false, category: 'error',
    };
  }

  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    // Drain the body so the connection can be released back to the pool (some fetch impls
    // retain the socket until the body is consumed); best-effort, ignore any read error and
    // tolerate a response with no `text()` (Promise.resolve keeps this from throwing).
    await Promise.resolve(response.text?.()).catch(() => {});
    return {
      url, prompts: [], authFailure, category: 'non2xx',
    };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return {
      url, prompts: [], authFailure: false, category: 'error',
    };
  }

  const rows = Array.isArray(body?.prompts) ? body.prompts : [];
  // Cap first (stop at maxPrompts), coerce to a non-empty string, and truncate length —
  // `prompts` are third-party content, validated at this ingestion boundary.
  const prompts = [];
  for (const row of rows) {
    if (prompts.length >= maxPrompts) {
      break;
    }
    const prompt = row?.prompt;
    if (typeof prompt === 'string' && prompt.length > 0) {
      prompts.push(prompt.length > MAX_PROMPT_LENGTH ? prompt.slice(0, MAX_PROMPT_LENGTH) : prompt);
    }
  }
  return {
    url, prompts, authFailure: false, category: 'ok',
  };
}

/**
 * Loads the prompts associated with each given URL from the Semrush-backed Serenity
 * `url-prompts` endpoint (one request per URL), capped at {@link MAX_URL_PROMPTS} each.
 *
 * Best-effort: returns an empty `Map` (rather than throwing) when the brand/org/IMS org cannot
 * be resolved, the date window can't be derived, or the S2S session token can't be obtained — a
 * failure here must not fail the analysis audit, since prompts are enrichment only. Auth uses
 * the shared S2S session-token flow ({@link getS2sSessionAuthorization}), scoped to the
 * customer's IMS org and cached across the offsite loaders; the request timeout is the shared
 * {@link resolveSemrushTimeoutMs} (`OFFSITE_SEMRUSH_TIMEOUT_MS`).
 *
 * Emits structured logs under {@link URL_PROMPTS_EVENT}: a `start` line (request template, base
 * URL, sample request URL, date window) for routing debug, and a single aggregate `summary`
 * line (`tried`/`urlsWithPrompts`/`totalPrompts`/`ok`/`non2xx`/`errors`) — no per-URL lines.
 *
 * @param {object} params
 * @param {object} params.site - Site model (`getId()`, `getOrganizationId()`).
 * @param {Array<{url: string}>} params.urls - URLs to fetch prompts for.
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @param {object} [params.olog] - Bound offsite logger from the calling audit; a generic one is
 *   created from `context.log` when omitted.
 * @returns {Promise<Map<string, string[]>>} url -> prompt strings (only URLs with
 *   at least one prompt are present).
 */
export async function loadUrlPromptsFromSemrush({
  site, urls, context, olog: providedOlog,
}) {
  const { log, env, dataAccess } = context;
  const siteId = site?.getId?.();
  const olog = providedOlog || createOffsiteLogger(log, { siteId });

  if (!urls?.length) {
    return new Map();
  }

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    olog.warn(URL_PROMPTS_EVENT, 'Site has no organization id; skipping url-prompts', {
      peer: PEER.SEMRUSH, direction: 'inbound', reason: 'no_organization_id',
    });
    return new Map();
  }

  // Resolve prerequisites (brand, date window, customer IMS org). Any of these can reject on a
  // transient data-access/brand-resolver error; guard them so a failure degrades to "no prompts"
  // rather than throwing out of fetchStoreData and failing the whole analysis audit (the
  // best-effort contract). Null results (no brand/date/org) are deliberate skips, logged with a
  // specific reason; a thrown error is the catch-all below.
  let brand;
  let startDate;
  let endDate;
  let imsOrgId;
  try {
    const brandResult = await resolveBrandResultForSite(context, site);
    brand = brandResult?.brand;
    if (!brand?.brandId) {
      olog.warn(URL_PROMPTS_EVENT, 'No active brand; skipping url-prompts', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, reason: 'no_active_brand',
      });
      return new Map();
    }

    // Gate on Semrush entitlement using the SAME shared flag-AND-workspace check the domain-urls
    // source uses (resolveSemrushEntitlement) — BEFORE minting an IMS token / S2S login — so a
    // brand not provisioned for Semrush doesn't pay the wasted auth round-trip. This is a local
    // DB check (feature flag + workspace lookup), NOT a Semrush API call, and fails closed (any
    // error/timeout → skip). Mirrors the offsite-brand-presence gate; keeps the two audits'
    // "should we call Semrush?" decision in one reusable place.
    const entitlement = await resolveSemrushEntitlement(context, {
      orgId: spaceCatId, brandId: brand.brandId,
    });
    if (!entitlement.entitled) {
      olog.warn(
        URL_PROMPTS_EVENT,
        entitlement.resolved
          ? 'Brand not entitled for Semrush; skipping url-prompts'
          : 'Semrush entitlement check inconclusive; skipping url-prompts',
        {
          peer: PEER.SEMRUSH,
          direction: 'inbound',
          orgId: spaceCatId,
          brandId: brand.brandId,
          reason: entitlement.resolved ? 'not_entitled' : 'entitlement_check_failed',
          entitlementReason: entitlement.reason,
          outcome: OUTCOME.SKIP,
        },
      );
      return new Map();
    }

    const dateWindow = getDateWindowForPreviousWeeks(getPreviousWeeks());
    if (!dateWindow) {
      olog.warn(URL_PROMPTS_EVENT, 'Could not derive a date window; skipping url-prompts', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, reason: 'no_date_window',
      });
      return new Map();
    }
    ({ startDate, endDate } = dateWindow);

    // The session token must be scoped to the customer's IMS org (…@AdobeOrg), which is distinct
    // from spaceCatId (the SpaceCat org UUID in the route path) — same value api-service's
    // hasAccess(organization) checks. Resolve it the same way the offsite loader does.
    imsOrgId = await getImsOrgId(site, dataAccess || {}, log);
    if (!imsOrgId) {
      olog.warn(URL_PROMPTS_EVENT, 'Could not resolve customer IMS org id; skipping url-prompts', {
        peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, reason: 'no_ims_org_id',
      });
      return new Map();
    }
  } catch (error) {
    olog.failure(URL_PROMPTS_EVENT, 'Failed to resolve url-prompts prerequisites', {
      peer: PEER.SEMRUSH, direction: 'inbound', orgId: spaceCatId, reason: 'prerequisites_failed', ...errorField(error),
    }, error);
    return new Map();
  }

  let authorization;
  try {
    const auth = await getS2sSessionAuthorization({ context, imsOrgId });
    authorization = auth.authorization;
    // Observability parity with domain-urls: log which consumer identity we were granted
    // (decoded from the token, never the token itself) and whether it came from the warm cache.
    olog.debug(URL_PROMPTS_EVENT, 'Using S2S session token', {
      peer: PEER.SEMRUSH,
      direction: 'inbound',
      orgId: spaceCatId,
      fromCache: auth.fromCache,
      ...decodeS2sConsumerClaims(auth.sessionToken),
    });
  } catch (error) {
    olog.failure(URL_PROMPTS_EVENT, 'Failed to obtain S2S session token for url-prompts', {
      peer: PEER.SEMRUSH,
      direction: 'inbound',
      orgId: spaceCatId,
      reason: error.reason || 'session_token_failed',
      ...(error.status && { status: error.status }),
      ...errorField(error),
    }, error);
    return new Map();
  }

  const headers = {
    // The customer-scoped S2S session token authorizes the read as an S2S consumer; it is
    // self-contained (no x-promise-token / IMS-forwarding needed on this path).
    Authorization: authorization,
    Accept: 'application/json',
  };

  const baseUrl = resolveApiBaseUrl(env);
  const timeoutMs = resolveSemrushTimeoutMs(env, URL_PROMPTS_TIMEOUT_MS);
  const maxPrompts = resolveMaxUrlPrompts(env);
  // Guard against an entry with no usable `url` — it would otherwise build a `url=undefined`
  // query and waste a request. (Store URLs always carry one; this is defense in depth.)
  const requests = urls
    .filter(({ url }) => url)
    .map(({ url }) => ({
      url,
      requestUrl: buildUrlPromptsUrl({
        baseUrl, spaceCatId, brandId: brand.brandId, url, startDate, endDate,
      }),
    }));
  if (requests.length === 0) {
    return new Map();
  }

  // Routing-debug line (mirrors domain-urls): surfaces the resolved base URL + prefix, a full
  // sample request URL, and the date window/platform so a misroute (e.g. missing `/api/v1`)
  // is obvious from the log alone.
  olog.start(URL_PROMPTS_EVENT, 'Querying url-prompts (per URL, platform=all)', {
    peer: PEER.SEMRUSH,
    direction: 'inbound',
    orgId: spaceCatId,
    brandId: brand.brandId,
    urlCount: requests.length,
    apiBaseUrl: baseUrl,
    requestUrlSample: requests[0].requestUrl,
    startDate,
    endDate,
    platform: URL_PROMPTS_PLATFORM,
    timeoutMs,
  });

  const results = await mapWithConcurrency(
    requests,
    REQUEST_CONCURRENCY,
    (request) => fetchUrlPrompts(request, headers, timeoutMs, maxPrompts),
  );

  // If the data call rejected the session token, drop it so the next run re-mints rather than
  // replaying a revoked/rotated token for the rest of its TTL.
  if (results.some((result) => result.authFailure)) {
    evictS2sSessionToken(imsOrgId);
  }

  const counts = { ok: 0, non2xx: 0, error: 0 };
  const promptsByUrl = new Map();
  let totalPrompts = 0;
  for (const result of results) {
    counts[result.category] += 1;
    if (result.prompts.length > 0) {
      promptsByUrl.set(result.url, result.prompts);
      totalPrompts += result.prompts.length;
    }
  }

  const summary = {
    peer: PEER.SEMRUSH,
    direction: 'inbound',
    orgId: spaceCatId,
    brandId: brand.brandId,
    tried: requests.length,
    urlsWithPrompts: promptsByUrl.size,
    totalPrompts,
    ok: counts.ok,
    non2xx: counts.non2xx,
    errors: counts.error,
  };
  if (counts.non2xx + counts.error > 0) {
    olog.warn(URL_PROMPTS_EVENT, 'Loaded url-prompts (with per-URL failures)', {
      ...summary, outcome: OUTCOME.DEGRADED,
    });
  } else {
    olog.success(URL_PROMPTS_EVENT, 'Loaded url-prompts', summary);
  }
  return promptsByUrl;
}

/**
 * Enriches `urls` in place (returns a new array) with Semrush url-prompts: tags each candidate
 * with `isUrlFromSemrush` and attaches its `prompts` when Semrush returned any. Shared by the
 * cited/youtube/reddit analysis handlers so the enrichment logic lives in one place.
 *
 * Only the first `limit` URLs are enriched — the caller passes the run's effective Mystique URL
 * limit so the fan-out matches the set that will actually be dispatched (a run scoped to fewer
 * URLs doesn't issue token-bearing requests for URLs that get dropped downstream). URLs beyond
 * `limit` are returned unchanged. Best-effort: never throws (see
 * {@link loadUrlPromptsFromSemrush}).
 *
 * @param {object} params
 * @param {Array<{url: string}>} params.urls - The full ordered URL list from the store.
 * @param {object} params.site - Site model.
 * @param {object} params.context - Lambda context.
 * @param {object} [params.olog] - Bound offsite logger from the calling audit.
 * @param {number} [params.limit] - Max URLs to enrich (defaults to all).
 * @returns {Promise<Array<object>>} the URL list with the first `limit` entries enriched.
 */
export async function enrichUrlsWithSemrushPrompts({
  urls, site, context, olog, limit,
}) {
  const candidates = Number.isInteger(limit) ? urls.slice(0, limit) : urls;
  const promptsByUrl = await loadUrlPromptsFromSemrush({
    site, urls: candidates, context, olog,
  });
  const candidateSet = new Set(candidates.map((item) => item.url));
  return urls.map((item) => (candidateSet.has(item.url) ? {
    ...item,
    isUrlFromSemrush: true,
    ...(promptsByUrl.get(item.url)?.length > 0 && { prompts: promptsByUrl.get(item.url) }),
  } : item));
}
