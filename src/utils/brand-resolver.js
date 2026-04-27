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
 * Outcome reported via the structured outcome log line. Stable strings so log mining
 * (e.g. CloudWatch metric filters) can build a per-result counter without code changes.
 *
 * @typedef {'success'|'no_match'|'error'|'no_client'|'missing_input'} BrandResolutionResult
 */

/**
 * Emit one info-or-warn log line per resolver invocation. Keeps the field shape stable
 * across outcomes so dashboards and metric filters can key on `result`.
 *
 * @param {object} log - Lambda logger
 * @param {object} fields - Structured fields to emit
 * @param {BrandResolutionResult} fields.result
 * @param {string} [fields.orgId]
 * @param {string} [fields.siteId]
 * @param {number} [fields.durationMs]
 * @param {string} [fields.brandId]
 * @param {string} [fields.errorName]
 */
function logOutcome(log, fields) {
  const { result } = fields;
  const payload = { ...fields, source: 'brand-resolver' };
  if (result === 'error') {
    log?.warn?.(`${LOG_PREFIX} outcome`, payload);
  } else if (result === 'success' || result === 'no_match') {
    log?.info?.(`${LOG_PREFIX} outcome`, payload);
  } else {
    log?.debug?.(`${LOG_PREFIX} outcome`, payload);
  }
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
 * @returns {Promise<{brandId: string, via: 'baseSiteId'|'brand_sites'} | null>}
 *   `null` when inputs are missing, the PostgREST client is unavailable,
 *   no active brand matches, or the query throws.
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

  try {
    const { data: brands } = await postgrestClient
      .from('brands')
      .select('id, site_id, brand_sites(site_id)')
      .eq('organization_id', orgId)
      .eq('status', 'active');

    const baseSiteMatch = brands?.find((b) => b.site_id === siteId);
    const brandSiteMatch = !baseSiteMatch && brands?.find(
      (b) => b.brand_sites?.some((bs) => bs.site_id === siteId),
    );
    const match = baseSiteMatch || brandSiteMatch;
    const durationMs = Date.now() - startedAt;

    if (!match) {
      logOutcome(log, {
        result: 'no_match', orgId, siteId, durationMs,
      });
      return null;
    }

    const via = baseSiteMatch ? 'baseSiteId' : 'brand_sites';
    logOutcome(log, {
      result: 'success', orgId, siteId, durationMs, brandId: match.id, via,
    });
    return { brandId: match.id, via };
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    // surface the error type at warn so PostgREST shape mismatches and column-name typos
    // are not silently lumped in with "no brand"; full stack at debug for triage.
    logOutcome(log, {
      result: 'error',
      orgId,
      siteId,
      durationMs,
      errorName: e?.name,
      errorMessage: e?.message,
    });
    log?.debug?.(`${LOG_PREFIX} stack`, { stack: e?.stack });
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
 * @returns {Promise<{brandId: string, via: 'baseSiteId'|'brand_sites'} | null>}
 */
export async function resolveBrandForSite(context, site) {
  const orgId = site?.getOrganizationId?.();
  const siteId = site?.getId?.();
  return findActiveBrandForSite(context, { orgId, siteId });
}

/**
 * Merge brand-scope fields into a Mystique-bound SQS message envelope.
 *
 * When `brand` is non-null, sets:
 *   - `scopeType: 'brand'`
 *   - `scopeId: brand.brandId`
 *
 * `siteId` is intentionally NOT touched: it keeps its original meaning ("the site that
 * triggered the audit"). The brand is identified solely by `scopeId` when present.
 *
 * When `brand` is null, the message is returned unchanged.
 *
 * @param {object} message - The outbound SQS message
 * @param {{brandId: string} | null} brand
 * @returns {object} A new message object with the scope fields applied (or the input unchanged)
 */
export function applyBrandScope(message, brand) {
  if (!brand) {
    return message;
  }
  return {
    ...message,
    scopeType: 'brand',
    scopeId: brand.brandId,
  };
}
