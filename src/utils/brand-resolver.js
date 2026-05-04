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
 * Brand resolution helpers shared by:
 *  - `llmo-customer-analysis/handler.js` (v2 onboarding, brandalf-gated)
 *  - offsite audit handlers (wikipedia, youtube, reddit, cited) that emit Mystique messages
 *
 * Looks up the active brand for an organization and matches the audit `siteId` against
 * either `brands.site_id` (baseSiteId, preferred) or the `brand_sites` join table.
 *
 * On any failure or miss the helpers return `null` so callers can omit brand-scoped fields
 * and preserve backwards compatibility with consumers that do not yet understand `scope*`.
 */

const LOG_PREFIX = '[brand-resolver]';

/**
 * Maximum milliseconds to wait for the PostgREST brand-resolution query before
 * failing open (treating the result as "no brand"). Kept short so a PostgREST
 * outage never amplifies offsite-audit latency.
 */
export const BRAND_RESOLUTION_TIMEOUT_MS = 300;

/**
 * Outcome reported via the structured outcome log line. Stable strings so log mining
 * (e.g. CloudWatch metric filters) can build a per-result counter without code changes.
 *
 * @typedef {'success'|'no_match'|'error'|'timeout'|'no_client'|'missing_input'}
 *   BrandResolutionResult
 */

/**
 * Emit one log line per resolver invocation. Keeps the field shape stable across outcomes
 * so dashboards and metric filters can key on `result`.
 *
 * Level policy:
 *  - warn  : infra/query problems that indicate something is wrong
 *            (`error`, `no_client`, `timeout`)
 *  - info  : expected data-layer outcomes (`success`, `no_match`)
 *  - debug : caller-bug guard that should never fire in production (`missing_input`)
 *
 * @param {object} log - Lambda logger
 * @param {object} fields - Structured fields to emit
 * @param {BrandResolutionResult} fields.result
 * @param {string} [fields.orgId]
 * @param {string} [fields.siteId]
 * @param {number} [fields.durationMs]
 * @param {string} [fields.brandId]
 * @param {string} [fields.errorName]
 * @param {string} [fields.via]
 */
function logOutcome(log, fields) {
  const { result } = fields;
  const payload = { ...fields, source: 'brand-resolver' };
  if (result === 'error' || result === 'no_client' || result === 'timeout') {
    log?.warn?.(`${LOG_PREFIX} outcome`, payload);
  } else if (result === 'success' || result === 'no_match') {
    log?.info?.(`${LOG_PREFIX} outcome`, payload);
  } else {
    log?.debug?.(`${LOG_PREFIX} outcome`, payload);
  }
}

/**
 * Run the two targeted PostgREST queries and return the first brand match, or null.
 *
 * Query 1 — direct baseSiteId match (server-side filtered, returns 0-1 rows):
 *   brands WHERE organization_id = orgId AND status = 'active' AND site_id = siteId
 *
 * Query 2 — brand_sites join fallback (server-side filtered via !inner, only if Q1 miss):
 *   brands INNER JOIN brand_sites ON ... WHERE organization_id = orgId
 *   AND status = 'active' AND brand_sites.site_id = siteId
 *
 * `!inner` in the select forces an inner join: only brands that have at least one
 * matching brand_sites row are returned, keeping the result set bounded.
 *
 * @param {object} postgrestClient
 * @param {string} orgId
 * @param {string} siteId
 * @returns {Promise<{brandId: string, via: 'baseSiteId'|'brand_sites'} | null>}
 */
async function resolveQueries(postgrestClient, orgId, siteId) {
  const { data: direct } = await postgrestClient
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('site_id', siteId);

  if (direct?.length) {
    return { brandId: direct[0].id, via: 'baseSiteId' };
  }

  const { data: joined } = await postgrestClient
    .from('brands')
    .select('id, brand_sites!inner(site_id)')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('brand_sites.site_id', siteId);

  if (joined?.length) {
    return { brandId: joined[0].id, via: 'brand_sites' };
  }

  return null;
}

/**
 * Look up the active brand for an org and match against the given site id.
 *
 * Pure mechanics: query + match order. Callers own the policy for whether to call
 * (e.g. brandalf gating, offsite-only) and what to do on null.
 *
 * @param {object} context - Lambda context (uses `dataAccess.services.postgrestClient`, `log`)
 * @param {object} params
 * @param {string} params.orgId - SpaceCat organization UUID
 * @param {string} params.siteId - SpaceCat site UUID to match
 * @returns {Promise<{brandId: string} | null>}
 *   `null` when inputs are missing, the PostgREST client is unavailable,
 *   no active brand matches, the query throws, or the query times out.
 *   `via` ('baseSiteId' | 'brand_sites') is emitted in the structured outcome log
 *   but intentionally excluded from the return value to keep the match strategy
 *   internal and prevent callers from branching on it.
 */
export async function findActiveBrandForSite(context, { orgId, siteId } = {}) {
  const { log, dataAccess } = context || {};
  const startedAt = Date.now();

  if (!orgId || !siteId) {
    logOutcome(log, {
      result: 'missing_input', orgId, siteId, durationMs: 0,
    });
    return null;
  }

  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient?.from) {
    logOutcome(log, {
      result: 'no_client', orgId, siteId, durationMs: 0,
    });
    return null;
  }

  let timeoutHandle;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const e = new Error(`brand resolution timed out after ${BRAND_RESOLUTION_TIMEOUT_MS}ms`);
        e.name = 'TimeoutError';
        reject(e);
      }, BRAND_RESOLUTION_TIMEOUT_MS);
    });

    const match = await Promise.race([
      resolveQueries(postgrestClient, orgId, siteId),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);

    const durationMs = Date.now() - startedAt;

    if (!match) {
      logOutcome(log, {
        result: 'no_match', orgId, siteId, durationMs,
      });
      return null;
    }

    logOutcome(log, {
      result: 'success', orgId, siteId, durationMs, brandId: match.brandId, via: match.via,
    });
    return { brandId: match.brandId };
  } catch (e) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const isTimeout = e?.name === 'TimeoutError';
    // Log error type at warn so PostgREST failures are visible without exposing
    // raw SQL/error messages (which may contain schema internals) at warn level.
    logOutcome(log, {
      result: isTimeout ? 'timeout' : 'error',
      orgId,
      siteId,
      durationMs,
      errorName: e?.name,
    });
    if (!isTimeout) {
      log?.debug?.(`${LOG_PREFIX} error detail`, { errorMessage: e?.message, stack: e?.stack });
    }
    return null;
  }
}

/**
 * Resolve the active brand for a Site model (offsite-audit convenience wrapper).
 *
 * Pulls `orgId` and `siteId` off the Site and delegates to `findActiveBrandForSite`.
 *
 * @param {object} context - Lambda context
 * @param {object} site - Site model (uses `getId()` and `getOrganizationId()`)
 * @returns {Promise<{brandId: string} | null>}
 */
export async function resolveBrandForSite(context, site) {
  const orgId = site?.getOrganizationId?.();
  const siteId = site?.getId?.();
  return findActiveBrandForSite(context, { orgId, siteId });
}

/**
 * Merge brand-scope fields into a Mystique-bound SQS message envelope.
 *
 * When `brand` is non-null and has a `brandId`, sets:
 *   - `scopeType: 'brand'`
 *   - `brandId: brand.brandId`
 *
 * `siteId` is intentionally NOT touched: it keeps its original meaning ("the site that
 * triggered the audit"). The brand is identified solely by `brandId` when present.
 *
 * When `brand` is null or has no `brandId`, the message is returned unchanged.
 * Mystique consumers must treat absent `scopeType`/`brandId` as "apply site-level
 * defaults", not as broader access — confirm this contract with the Mystique team
 * to prevent privilege-confusion when fail-open occurs during outages.
 *
 * @param {object} message - The outbound SQS message
 * @param {{brandId: string} | null} brand
 * @returns {object} A new message object with the scope fields applied (or the input unchanged)
 */
export function applyBrandScope(message, brand) {
  if (!brand?.brandId) {
    return message;
  }
  return {
    ...message,
    scopeType: 'brand',
    brandId: brand.brandId,
  };
}
