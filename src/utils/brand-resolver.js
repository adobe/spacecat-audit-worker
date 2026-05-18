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
 * Brand resolution utilities for LLMO offsite audits and brand-presence handlers.
 *
 * Two resolution strategies:
 *
 * 1. PostgREST-based (`findActiveBrandForSite`, `resolveBrandForSite`) — used by offsite
 *    audit guidance handlers (wikipedia, youtube, reddit, cited) to resolve the active brand
 *    for a given (org, site) pair via direct PostgREST queries against the `brands` table.
 *
 * 2. API-based (`resolveBrandIdForSite`) — used by brand-presence refresh handlers
 *    (geo-brand-presence, geo-brand-presence-daily) to resolve the v2 `brand_id` via
 *    spacecat-api-service (LLMO-4716). Fails closed on 5xx so SQS can retry rather than
 *    silently producing stale brand-presence data.
 */

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

// ---------------------------------------------------------------------------
// PostgREST-based brand resolution (offsite audit handlers)
// ---------------------------------------------------------------------------

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
  const { data: direct, error: directErr } = await postgrestClient
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('site_id', siteId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (directErr) {
    throw Object.assign(new Error('brand Q1 failed'), { name: 'PostgrestError', cause: directErr });
  }

  if (direct?.length) {
    return { brandId: direct[0].id, via: 'baseSiteId' };
  }

  const { data: joined, error: joinedErr } = await postgrestClient
    .from('brands')
    .select('id, brand_sites!inner(site_id)')
    .eq('organization_id', orgId)
    .eq('status', 'active')
    .eq('brand_sites.site_id', siteId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (joinedErr) {
    throw Object.assign(new Error('brand Q2 failed'), { name: 'PostgrestError', cause: joinedErr });
  }

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
 * Producer-side wrapper used by `*-analysis/handler.js` to tag outbound SQS messages.
 * Fail-open (null on error) is safe here: scopeless message → Mystique applies site default.
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
 * Resolve the active brand AND report whether the resolution itself succeeded.
 *
 * Consumer-side wrapper used by `*-analysis/guidance-handler.js`. Unlike
 * `resolveBrandForSite`, this returns a discriminated outcome so the caller can
 * distinguish "confirmed no brand" (clear stale scope) from "resolution failed"
 * (preserve existing scope to avoid data loss during transient PostgREST outages).
 *
 * - { brand: { brandId }, resolved: true }  — match found
 * - { brand: null, resolved: true }          — confirmed no active brand
 * - { brand: null, resolved: false }         — resolution failed (timeout / error / no client)
 *
 * @param {object} context - Lambda context
 * @param {object} site - Site model
 * @returns {Promise<{ brand: {brandId: string}|null, resolved: boolean }>}
 */
export async function resolveBrandResultForSite(context, site) {
  const orgId = site?.getOrganizationId?.();
  const siteId = site?.getId?.();
  const { log, dataAccess } = context || {};

  if (!orgId || !siteId) {
    // Caller-bug guard; nothing to resolve.
    logOutcome(log, {
      result: 'missing_input', orgId, siteId, durationMs: 0,
    });
    return { brand: null, resolved: false };
  }

  if (!dataAccess?.services?.postgrestClient?.from) {
    logOutcome(log, {
      result: 'no_client', orgId, siteId, durationMs: 0,
    });
    return { brand: null, resolved: false };
  }

  const startedAt = Date.now();
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
      resolveQueries(dataAccess.services.postgrestClient, orgId, siteId),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    if (!match) {
      logOutcome(log, {
        result: 'no_match', orgId, siteId, durationMs,
      });
      return { brand: null, resolved: true };
    }
    logOutcome(log, {
      result: 'success', orgId, siteId, durationMs, brandId: match.brandId, via: match.via,
    });
    return { brand: { brandId: match.brandId }, resolved: true };
  } catch (e) {
    clearTimeout(timeoutHandle);
    const durationMs = Date.now() - startedAt;
    const isTimeout = e?.name === 'TimeoutError';
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
    return { brand: null, resolved: false };
  }
}

/**
 * Apply resolved brand scope to an opportunity.
 *
 * Discriminated input avoids two well-known data-loss bugs:
 *
 * 1. **Transient-error preservation** — when `resolved=false` (PostgREST timeout / outage),
 *    existing scope on the opportunity is preserved. A short-lived outage no longer wipes
 *    correct scope from every re-run during the incident.
 *
 * 2. **Setter rollback** — `setScopeType` and `setScopeId` are wrapped separately so a
 *    failure on the second setter does not leave the opportunity in a half-scoped state.
 *    On second-setter throw, the first setter is rolled back to null.
 *
 * @param {object} opportunity - Opportunity model instance
 * @param {{ brand: {brandId: string}|null, resolved: boolean } | null} result
 *   Resolution outcome from `resolveBrandResultForSite`. A bare null or undefined is
 *   treated as `{ brand: null, resolved: false }` (preserve existing scope).
 * @param {object} log - Lambda logger
 * @param {string} [logPrefix=''] - Log prefix for context
 */
export function applyScopeToOpportunity(opportunity, result, log, logPrefix = '') {
  const { brand = null, resolved = false } = result || {};

  if (brand?.brandId) {
    try {
      opportunity.setScopeType('brand');
    } catch (err) {
      log?.warn?.(`${logPrefix} Failed to set scopeType; preserving existing scope: ${err.message}`);
      return;
    }
    try {
      opportunity.setScopeId(brand.brandId);
    } catch (err) {
      // Rollback both fields so the opportunity is not left half-scoped.
      // scopeType was already set to 'brand'; scopeId may still hold a stale value
      // from a prior run — clear both to satisfy the co-presence constraint on save().
      try {
        opportunity.setScopeType(null);
      } catch { /* best-effort */ }
      try {
        opportunity.setScopeId(null);
      } catch { /* best-effort */ }
      log?.warn?.(`${logPrefix} Failed to set scopeId; rolled back scope: ${err.message}`);
    }
    return;
  }

  // Only clear when resolution succeeded with no match. On resolution failure
  // (timeout / error / no client), preserve existing scope — silently clearing
  // it during a transient outage would corrupt every re-run during the incident.
  if (resolved === true) {
    try {
      opportunity.setScopeType(null);
      opportunity.setScopeId(null);
    } catch (err) {
      log?.warn?.(`${logPrefix} Failed to clear stale scope: ${err.message}`);
    }
  }
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

// ---------------------------------------------------------------------------
// API-based brand resolution (geo-brand-presence handlers, LLMO-4716)
// ---------------------------------------------------------------------------

/**
 * Resolve the v2 `brand_id` for a given (organization, site) pair via
 * spacecat-api-service. Used by the brand-presence refresh handlers
 * (geo-brand-presence and geo-brand-presence-daily) to thread `brandId` onto
 * the SNS payload that triggers DRS Fargate brand-presence analysis.
 *
 * The endpoint encapsulates the full v1/v2 decision (brandalf flag,
 * brandalf-migration semantics, kill-switch, multi-brand-per-site rule). Callers
 * stay dumb — they ask "what's the brand?" and get a UUID or null.
 *
 * Failure-mode contract:
 *  - 200  → return brand id
 *  - 404  → return null (deliberate "no v2 brand" — v1 orgs, brandalf-migration-only,
 *           kill-switch-degraded, or no active brand for this site). Callers leave
 *           brand_id unset so the runner takes the v1 path.
 *  - 5xx / network / timeout / parse error → THROW. For brandalf=true orgs,
 *    proceeding without brand_id silently degrades to v1 reads from a
 *    no-longer-published spreadsheet mirror — the BP pipeline keeps running but
 *    produces meaningless output. Failing fast lets SQS retry the audit and
 *    surfaces the issue via DLQ instead of producing silent bad data.
 *
 * @param {string} orgId - SpaceCat organization UUID
 * @param {string} siteId - Site UUID
 * @param {object} env - Lambda environment (must include SPACECAT_API_BASE_URL,
 *   SPACECAT_API_KEY)
 * @param {object} log - Logger
 * @returns {Promise<string|null>} The brand UUID, or null if the org has no v2
 *   brand for this site.
 */
const BP_LOG_PREFIX = '[BrandResolver]';
const FETCH_TIMEOUT_MS = 30000;
const USER_AGENT = 'spacecat-audit-worker/brand-resolver';

export async function resolveBrandIdForSite(orgId, siteId, env, log) {
  const apiBase = env?.SPACECAT_API_BASE_URL;
  const apiKey = env?.SPACECAT_API_KEY;
  if (!apiBase || !apiKey) {
    throw new Error(
      `${BP_LOG_PREFIX} SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured`,
    );
  }
  if (!orgId || !siteId) {
    throw new Error(`${BP_LOG_PREFIX} orgId and siteId are required`);
  }

  const url = `${apiBase}/v2/orgs/${encodeURIComponent(orgId)}/sites/${encodeURIComponent(siteId)}/brand`;
  const headers = {
    'x-api-key': apiKey,
    'User-Agent': USER_AGENT,
  };

  log.info(`${BP_LOG_PREFIX} Resolving brand for org=${orgId} site=${siteId}`);

  let response;
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    // Network/timeout/abort — treat as transient. SQS retry will re-attempt.
    throw new Error(
      `${BP_LOG_PREFIX} Brand resolution failed (network/timeout) for org=${orgId} site=${siteId}: ${error.message}`,
      { cause: error },
    );
  }

  if (response.status === 404) {
    log.info(
      `${BP_LOG_PREFIX} No v2 brand for org=${orgId} site=${siteId} — runner will take v1 path`,
    );
    return null;
  }

  if (!response.ok) {
    // 5xx and any non-404 4xx are surfaced — better to retry than to silently
    // continue without brand_id for what may well be a v2 org.
    let body = '';
    try {
      body = await response.text();
    } catch {
      // ignore body-read failure
    }
    throw new Error(
      `${BP_LOG_PREFIX} Brand resolution failed for org=${orgId} site=${siteId}: `
      + `${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
    );
  }

  let brand;
  try {
    brand = await response.json();
  } catch (error) {
    throw new Error(
      `${BP_LOG_PREFIX} Brand resolution returned non-JSON for org=${orgId} site=${siteId}: ${error.message}`,
      { cause: error },
    );
  }

  if (!brand || typeof brand.id !== 'string' || brand.id.length === 0) {
    log.warn(
      `${BP_LOG_PREFIX} Brand resolution returned no id for org=${orgId} site=${siteId} — treating as no v2 brand`,
    );
    return null;
  }

  log.info(
    `${BP_LOG_PREFIX} Resolved brand=${brand.id} for org=${orgId} site=${siteId}`,
  );
  return brand.id;
}
