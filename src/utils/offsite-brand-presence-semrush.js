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
import { resolveBrandForSite } from './brand-resolver.js';
import { getDateWindowForPreviousWeeks } from './offsite-brand-presence-postgrest.js';
import { classifyAndNormalize } from './offsite-brand-presence-enrichment.js';
import { OFFSITE_DOMAINS } from '../offsite-brand-presence/constants.js';

const LOG_PREFIX = '[offsite-brand-presence][semrush]';

/**
 * Default spacecat-api-service base URL. Its Elements proxy
 * (`src/controllers/elements.js`) serves the Semrush-backed Serenity
 * URL-Inspector endpoints at
 * `/v2/orgs/:spaceCatId/brands/:brandId/serenity/brand-presence/url-inspector/*`.
 * Overridable per-environment with `SPACECAT_API_URI` (the standard worker
 * override, e.g. used by paid-cookie-consent).
 */
export const SPACECAT_API_DEFAULT_BASE_URL = 'https://spacecat.experiencecloud.live/api/v1';

/**
 * Page size accepted by the url-inspector endpoints. The proxy paginates
 * client-side, so a single large page avoids a fetch loop for the bounded
 * youtube/reddit sets.
 */
const PAGE_SIZE = 1000;

/**
 * Resolves which AI-engine platform values to query.
 *
 * Default: a single call with NO `platform` param, so the gateway aggregates
 * citations across every engine it has (mirroring the legacy all-providers
 * behaviour). Set `OFFSITE_SEMRUSH_PLATFORMS` (comma-separated, e.g.
 * `"search-gpt,google-ai-mode"`) to query each engine explicitly and sum the
 * citations per URL — use this if the gateway does not aggregate on an absent
 * `platform`. See LLMO-6710.
 *
 * @param {object} env - Lambda env.
 * @returns {Array<string|undefined>} platform values (`[undefined]` = omit param).
 */
export function getSemrushPlatforms(env) {
  const raw = env?.OFFSITE_SEMRUSH_PLATFORMS;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(',').map((p) => p.trim()).filter(Boolean);
  }
  return [undefined];
}

/**
 * Mints an IMS service access token and returns it as an Authorization header value.
 * Reuses the standard IMS_* env the worker already configures for other
 * service-to-service calls.
 *
 * @param {object} context - Lambda context (env + log).
 * @returns {Promise<string>} e.g. "Bearer eyJ...".
 */
async function getAuthorizationHeader(context) {
  const imsClient = ImsClient.createFrom(context);
  const token = await imsClient.getServiceAccessTokenV3();
  return `${token.token_type} ${token.access_token}`;
}

/**
 * Builds a url-inspector `domain-urls` request URL for one hostname (and optional
 * platform).
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
  return `${baseUrl}/v2/orgs/${spaceCatId}/brands/${brandId}`
    + `/serenity/brand-presence/url-inspector/domain-urls?${params.toString()}`;
}

/**
 * Fetches the cited URLs for a single (hostname, platform) request and folds them
 * into `allUrls`. `count` is the exact Semrush citation number (never recounted by
 * repetition) and is SUMMED across platforms; `url` + `domain` come from the shared
 * `classifyAndNormalize` so normalisation, owned-URL filtering and domain bucketing
 * match the legacy path exactly.
 *
 * @returns {Promise<void>}
 */
async function collectRequest({
  hostname, url, headers, allUrls, siteHostname, log,
}) {
  let response;
  try {
    response = await fetch(url, { headers });
  } catch (error) {
    log.error(`${LOG_PREFIX} Fetch failed for ${hostname}: ${error.message}`);
    return;
  }

  if (!response.ok) {
    log.error(`${LOG_PREFIX} ${hostname} returned HTTP ${response.status}`);
    return;
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    log.error(`${LOG_PREFIX} Could not parse ${hostname} response: ${error.message}`);
    return;
  }

  const rows = Array.isArray(body?.urls) ? body.urls : [];
  let added = 0;
  for (const row of rows) {
    const classified = row?.url ? classifyAndNormalize(row.url, siteHostname) : null;
    if (!classified) {
      // eslint-disable-next-line no-continue
      continue;
    }
    const citations = Number(row.citations) || 0;
    const existing = allUrls.get(classified.url);
    if (existing) {
      // Same URL seen under another platform — sum the citations so ranking
      // reflects total cross-engine citation volume.
      existing.count += citations;
    } else {
      allUrls.set(classified.url, { count: citations, domain: classified.domain });
    }
    added += 1;
  }
  log.info(`${LOG_PREFIX} ${hostname}: ${added} cited URLs`);
}

/**
 * Loads the offsite cited URLs from the live Semrush-backed Serenity URL-Inspector
 * endpoints, producing the exact `allUrls: Map<url, { count, domain }>` shape that
 * the existing `selectTopUrls` -> DRS pipeline consumes. Ranking is preserved
 * (`count` = citation volume), so `selectTopUrls` still takes the top
 * `DRS_URLS_LIMIT` per surface, unchanged.
 *
 * Scope: `youtube.com` + `reddit.com` (fixed hostnames — one `domain-urls` call
 * each, per platform). The generic "cited" bucket needs a `cited-domains`
 * discovery hop and is a follow-up (LLMO-6709). Gated by the caller behind
 * `OFFSITE_BRAND_PRESENCE_SEMRUSH_ENABLED`.
 *
 * @param {object} params
 * @param {object} params.site - Site model (`getOrganizationId()`).
 * @param {Array<{week:number, year:number}>} params.previousWeeks
 * @param {object} params.context - Lambda context (env, log, dataAccess).
 * @param {string} [params.siteHostname] - www-stripped site hostname for owned-URL filtering.
 * @returns {Promise<Map<string, {count:number, domain:string|null}> | null>}
 *   The URL map, or `null` when the source cannot be queried (caller falls back
 *   to an empty run).
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

  const brand = await resolveBrandForSite(context, site);
  if (!brand?.brandId) {
    log.warn(`${LOG_PREFIX} No active brand for org ${spaceCatId}; skipping Semrush source`);
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
    'Content-Type': 'application/json',
    // The api-service Elements proxy authenticates IMS callers directly and
    // forwards this Bearer token to Semrush (resolveElementsImsToken's fallback
    // path), so a promise token is NOT required for a service caller. Forward
    // one only if the platform later threads it onto the context (non-IMS callers).
    ...(context.promiseToken ? { 'x-promise-token': context.promiseToken } : {}),
  };

  const platforms = getSemrushPlatforms(env);
  const allUrls = new Map();

  for (const hostname of Object.keys(OFFSITE_DOMAINS)) {
    for (const platform of platforms) {
      const requestUrl = buildDomainUrlsUrl({
        baseUrl, spaceCatId, brandId: brand.brandId, hostname, startDate, endDate, platform,
      });
      // eslint-disable-next-line no-await-in-loop
      await collectRequest({
        hostname, url: requestUrl, headers, allUrls, siteHostname, log,
      });
    }
  }

  log.info(`${LOG_PREFIX} Collected ${allUrls.size} cited URLs from Semrush`);
  return allUrls;
}
