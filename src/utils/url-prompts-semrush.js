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
} from './offsite-brand-presence-semrush.js';

const LOG_PREFIX = '[url-prompts][semrush]';

/**
 * Max prompts kept per URL. The `url-prompts` endpoint has no pagination/limit
 * param of its own (it returns the full result set for one URL in a single call),
 * so the cap is applied client-side.
 */
export const MAX_URL_PROMPTS = 5;

/**
 * Per-request timeout. `url-prompts` returns the prompts for a single URL (far lighter than
 * the `domain-urls` page the offsite loader pulls, which needs ~60s), so a tight 10s guards
 * the audit against a slow best-effort enrichment hop without starving a normal response.
 */
const FETCH_TIMEOUT_MS = 10_000;

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
 * responses, and unparseable bodies are logged and resolved as an empty list, since this is
 * best-effort enrichment and must not fail the audit. A `401/403` is surfaced via
 * `authFailure` so the caller can evict a stale cached session token.
 *
 * @returns {Promise<{ url: string, prompts: string[], authFailure: boolean }>}
 */
async function fetchUrlPrompts({ url, requestUrl }, headers, log, siteId) {
  const ctx = { siteId, url };
  let response;
  try {
    response = await fetch(requestUrl, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    log.warn(`${LOG_PREFIX} Fetch failed for ${url}: ${error.message}`, { ...ctx, error: error.message });
    return { url, prompts: [], authFailure: false };
  }

  if (!response.ok) {
    const authFailure = response.status === 401 || response.status === 403;
    log.warn(`${LOG_PREFIX} ${url} returned HTTP ${response.status}`, { ...ctx, status: response.status });
    return { url, prompts: [], authFailure };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.warn(`${LOG_PREFIX} Could not parse response for ${url}: ${error.message}`, { ...ctx, error: error.message });
    return { url, prompts: [], authFailure: false };
  }

  const rows = Array.isArray(body?.prompts) ? body.prompts : [];
  const prompts = rows
    .map((row) => row?.prompt)
    .filter(Boolean)
    .slice(0, MAX_URL_PROMPTS);
  return { url, prompts, authFailure: false };
}

/**
 * Loads the prompts associated with each given URL from the Semrush-backed Serenity
 * `url-prompts` endpoint (one request per URL), capped at {@link MAX_URL_PROMPTS} each.
 *
 * Best-effort: returns an empty `Map` (rather than throwing) when the brand/org/IMS org cannot
 * be resolved, the date window can't be derived, or the S2S session token can't be obtained — a
 * failure here must not fail the analysis audit, since prompts are enrichment only. Auth uses
 * the shared S2S session-token flow ({@link getS2sSessionAuthorization}), scoped to the
 * customer's IMS org and cached across the offsite loaders.
 *
 * @param {object} params
 * @param {object} params.site - Site model (`getId()`, `getOrganizationId()`).
 * @param {Array<{url: string}>} params.urls - URLs to fetch prompts for.
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @returns {Promise<Map<string, string[]>>} url -> prompt strings (only URLs with
 *   at least one prompt are present).
 */
export async function loadUrlPromptsFromSemrush({ site, urls, context }) {
  const { log, env, dataAccess } = context;
  const siteId = site?.getId?.();

  if (!urls?.length) {
    return new Map();
  }

  const spaceCatId = site?.getOrganizationId?.();
  if (!spaceCatId) {
    log.warn(`${LOG_PREFIX} Site has no organization id; skipping url-prompts lookup`, { siteId });
    return new Map();
  }

  const { brand } = await resolveBrandResultForSite(context, site);
  if (!brand?.brandId) {
    log.info(`${LOG_PREFIX} No active brand for org ${spaceCatId}; skipping url-prompts lookup`, {
      siteId, orgId: spaceCatId,
    });
    return new Map();
  }

  const dateWindow = getDateWindowForPreviousWeeks(getPreviousWeeks());
  if (!dateWindow) {
    log.warn(`${LOG_PREFIX} Could not derive a date window; skipping url-prompts lookup`, { siteId });
    return new Map();
  }
  const { startDate, endDate } = dateWindow;

  // The session token must be scoped to the customer's IMS org (…@AdobeOrg), which is distinct
  // from spaceCatId (the SpaceCat org UUID in the route path) — same value api-service's
  // hasAccess(organization) checks. Resolve it the same way the offsite loader does.
  const imsOrgId = await getImsOrgId(site, dataAccess || {}, log);
  if (!imsOrgId) {
    log.warn(`${LOG_PREFIX} Could not resolve customer IMS org id; skipping url-prompts lookup`, {
      siteId, orgId: spaceCatId,
    });
    return new Map();
  }

  let authorization;
  try {
    authorization = await getS2sSessionAuthorization({ context, imsOrgId });
  } catch (error) {
    const reason = error.reason || 'unknown';
    log.error(`${LOG_PREFIX} Failed to obtain S2S session token (${reason}): ${error.message}`, {
      siteId,
      orgId: spaceCatId,
      reason: error.reason,
      ...(error.status && { status: error.status }),
    });
    return new Map();
  }

  const headers = {
    // The customer-scoped S2S session token authorizes the read as an S2S consumer; it is
    // self-contained (no x-promise-token / IMS-forwarding needed on this path).
    Authorization: authorization,
    Accept: 'application/json',
  };

  const baseUrl = resolveApiBaseUrl(env);
  const requests = urls.map(({ url }) => ({
    url,
    requestUrl: buildUrlPromptsUrl({
      baseUrl, spaceCatId, brandId: brand.brandId, url, startDate, endDate,
    }),
  }));

  const results = await mapWithConcurrency(
    requests,
    REQUEST_CONCURRENCY,
    (request) => fetchUrlPrompts(request, headers, log, siteId),
  );

  // If the data call rejected the session token, drop it so the next run re-mints rather than
  // replaying a revoked/rotated token for the rest of its TTL.
  if (results.some((result) => result.authFailure)) {
    evictS2sSessionToken(imsOrgId);
  }

  const promptsByUrl = new Map();
  for (const result of results) {
    if (result.prompts.length > 0) {
      promptsByUrl.set(result.url, result.prompts);
    }
  }
  log.info(`${LOG_PREFIX} Loaded prompts for ${promptsByUrl.size}/${urls.length} URL(s)`, { siteId });
  return promptsByUrl;
}
