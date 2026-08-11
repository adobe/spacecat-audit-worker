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
import {
  SPACECAT_API_DEFAULT_BASE_URL,
  getAuthorizationHeader,
} from './offsite-brand-presence-semrush.js';

const LOG_PREFIX = '[url-prompts][semrush]';

/**
 * Max prompts kept per URL. The `url-prompts` endpoint has no pagination/limit
 * param of its own (it returns the full result set for one URL in a single call),
 * so the cap is applied client-side.
 */
export const MAX_URL_PROMPTS = 5;

/** Per-request timeout — same rationale as offsite-brand-presence-semrush.js. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * `model`/`platform` value passed to the `url-prompts` endpoint. Unlike `domain-urls` /
 * `cited-domains`, this endpoint supports a special `all` value that aggregates prompts
 * across every engine server-side in a single request, which is what "associated
 * prompts for this URL" should mean here — one request per URL rather than one per
 * (URL x engine) pair.
 */
const URL_PROMPTS_PLATFORM = 'all';

/**
 * Builds a url-inspector `url-prompts` request URL.
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
 * Fetches the prompts associated with a single URL. Never throws — network errors,
 * non-2xx responses, and unparseable bodies are logged and resolved as an empty list,
 * since this is best-effort enrichment and must not fail the audit.
 *
 * @returns {Promise<{ url: string, prompts: string[] }>}
 */
async function fetchUrlPrompts({ url, requestUrl }, headers, log, siteId) {
  const ctx = { siteId, url };
  let response;
  try {
    response = await fetch(requestUrl, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    log.warn(`${LOG_PREFIX} Fetch failed for ${url}: ${error.message}`, { ...ctx, error: error.message });
    return { url, prompts: [] };
  }

  if (!response.ok) {
    log.warn(`${LOG_PREFIX} ${url} returned HTTP ${response.status}`, { ...ctx, status: response.status });
    return { url, prompts: [] };
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.warn(`${LOG_PREFIX} Could not parse response for ${url}: ${error.message}`, { ...ctx, error: error.message });
    return { url, prompts: [] };
  }

  const rows = Array.isArray(body?.prompts) ? body.prompts : [];
  const prompts = rows
    .map((row) => row?.prompt)
    .filter(Boolean)
    .slice(0, MAX_URL_PROMPTS);
  return { url, prompts };
}

/**
 * Loads the prompts associated with each given URL from the Semrush-backed Serenity
 * `url-prompts` endpoint (one request per URL), capped at {@link MAX_URL_PROMPTS} each.
 *
 * Best-effort: returns an empty `Map` (rather than throwing) when the brand/org cannot
 * be resolved, the date window can't be derived, or the IMS token can't be minted — a
 * failure here must not fail the analysis audit, since prompts are enrichment only.
 *
 * @param {object} params
 * @param {object} params.site - Site model (`getId()`, `getOrganizationId()`).
 * @param {Array<{url: string}>} params.urls - URLs to fetch prompts for.
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @returns {Promise<Map<string, string[]>>} url -> prompt strings (only URLs with
 *   at least one prompt are present).
 */
export async function loadUrlPromptsFromSemrush({ site, urls, context }) {
  const { log, env } = context;
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

  let authorization;
  try {
    authorization = await getAuthorizationHeader(context);
  } catch (error) {
    log.error(`${LOG_PREFIX} Failed to obtain IMS service token: ${error.message}`, { siteId, error: error.message });
    return new Map();
  }

  const headers = {
    Authorization: authorization,
    Accept: 'application/json',
    ...(context.promiseToken ? { 'x-promise-token': context.promiseToken } : {}),
  };

  const baseUrl = env?.SPACECAT_API_URI || SPACECAT_API_DEFAULT_BASE_URL;
  const requests = urls.map(({ url }) => ({
    url,
    requestUrl: buildUrlPromptsUrl({
      baseUrl, spaceCatId, brandId: brand.brandId, url, startDate, endDate,
    }),
  }));

  const results = await Promise.all(requests.map((r) => fetchUrlPrompts(r, headers, log, siteId)));

  const promptsByUrl = new Map();
  for (const result of results) {
    if (result.prompts.length > 0) {
      promptsByUrl.set(result.url, result.prompts);
    }
  }
  log.info(`${LOG_PREFIX} Loaded prompts for ${promptsByUrl.size}/${urls.length} URL(s)`, { siteId });
  return promptsByUrl;
}
