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
 * Semrush/Serenity entitlement check for the offsite-brand-presence Semrush loader.
 *
 * Mirrors the same "flag AND workspace" gate spacecat-api-service uses to decide
 * whether to serve ANY Serenity route for an org (see `serenity-active.js` +
 * `workspace-resolver.js`'s `resolveBrandWorkspace` there):
 * - the `serenity` feature flag must be on for the org — read the same way
 *   `isBrandalfEnabled` (`brandalf-utils.js`) reads its flag, directly via
 *   `context.dataAccess.services.postgrestClient` (no shared-package helper exists
 *   for this; api-service's own `readFeatureFlag` is private application code, not
 *   published), AND
 * - a Semrush workspace must be resolvable for the brand — via the SAME shared
 *   `@adobe/spacecat-shared-data-access` model layer api-service itself uses
 *   (`context.dataAccess.Organization`/`.Brand`, already wired into this worker's
 *   context by `support/data-access.js`), a brand-level sub-workspace
 *   (`Brand#getSemrushSubWorkspaceId()`, current write-of-record) taking precedence
 *   over the org-level flat workspace (`Organization#getSemrushWorkspaceId()`).
 *   Unlike api-service's `workspace-resolver.js`, this does NOT cache: that module's
 *   TTL-bounded caching is private, unexported application code (nothing to import),
 *   and re-implementing it here isn't worth it for a once-per-audit-run check (not a
 *   hot per-request UI path) — see ADR 002, Decision 7.
 *
 * Fails CLOSED: any missing input, missing client/collection, query error, or timeout
 * is treated as "not entitled" for this run (never call the paid Semrush API on an
 * unconfirmed brand) — but `resolved:false` distinguishes an inconclusive check
 * from a confirmed non-entitlement so the caller can log/diagnose accordingly.
 */

const LOG_PREFIX = '[semrush-entitlement]';

const SERENITY_FLAG_PRODUCT = 'LLMO';
const SERENITY_FLAG_NAME = 'serenity';

/**
 * Maximum milliseconds to wait for the combined flag + workspace PostgREST lookup
 * before failing closed. Mirrors `BRAND_RESOLUTION_TIMEOUT_MS` in `brand-resolver.js`
 * — kept short so a PostgREST outage never amplifies offsite-audit latency.
 */
export const SEMRUSH_ENTITLEMENT_TIMEOUT_MS = 300;

/**
 * Checks the org-wide `serenity` feature flag — the same rollout switch
 * spacecat-api-service reads before serving any Serenity/Semrush route for an org.
 * Same query shape as `isBrandalfEnabled` in `brandalf-utils.js`, different flag name.
 *
 * @param {string} organizationId - SpaceCat org UUID
 * @param {object} postgrestClient - mysticat PostgREST client (already validated by caller)
 * @param {object} log - Logger
 * @returns {Promise<boolean|null>} true/false when known, null when the query itself failed
 */
async function isSerenityEnabledForOrg(organizationId, postgrestClient, log) {
  try {
    const { data, error } = await postgrestClient
      .from('feature_flags')
      .select('flag_value')
      .eq('organization_id', organizationId)
      .eq('product', SERENITY_FLAG_PRODUCT)
      .eq('flag_name', SERENITY_FLAG_NAME)
      .maybeSingle();

    if (error) {
      log?.warn(`${LOG_PREFIX} Failed to read serenity flag for org ${organizationId}: ${error.message}`);
      return null;
    }

    // Absent row => flag not set => disabled.
    return data?.flag_value === true;
  } catch (error) {
    log?.warn(`${LOG_PREFIX} Error checking serenity flag for org ${organizationId}: ${error.message}`);
    return null;
  }
}

/**
 * Resolves the Semrush workspace for a (org, brand) pair via the shared
 * `Organization`/`Brand` data-access models — the same entities and getters
 * spacecat-api-service's `workspace-resolver.js` reads (minus its caching; see the
 * file-level doc comment). Dual-mode: a brand's own sub-workspace takes precedence;
 * the org's flat workspace is the fallback.
 *
 * @param {object} dataAccess - `context.dataAccess` (already validated by caller)
 * @param {{orgId: string, brandId: string}} params
 * @returns {Promise<{workspaceId: string, mode: 'subworkspace'|'flat'} | null>}
 * @throws when either underlying lookup throws (caller decides how to treat it)
 */
async function resolveSemrushWorkspace(dataAccess, { orgId, brandId }) {
  const [organization, brand] = await Promise.all([
    dataAccess.Organization.findById(orgId),
    dataAccess.Brand.findById(brandId),
  ]);

  const subWorkspaceId = brand?.getSemrushSubWorkspaceId?.();
  if (subWorkspaceId) {
    return { workspaceId: subWorkspaceId, mode: 'subworkspace' };
  }
  const workspaceId = organization?.getSemrushWorkspaceId?.();
  if (workspaceId) {
    return { workspaceId, mode: 'flat' };
  }
  return null;
}

/**
 * Resolves whether a brand is entitled to be queried against the Semrush-backed
 * Serenity API — i.e. whether calling it is expected to return real data rather
 * than an access-denied/empty response.
 *
 * @param {object} context - Lambda context (`dataAccess` incl. `.services.postgrestClient`, `log`)
 * @param {{orgId: string, brandId: string}} params
 * @returns {Promise<{
 *   entitled: boolean,
 *   resolved: boolean,
 *   reason: 'entitled'|'flag-disabled'|'no-workspace'|'missing-input'|'no-client'|'check-failed',
 *   mode?: 'subworkspace'|'flat',
 * }>}
 *   `resolved:true` means the non-entitlement is CONFIRMED (flag off, or no workspace);
 *   `resolved:false` means the check itself could not complete (treat as a transient
 *   skip for this run, not a permanent verdict).
 */
export async function resolveSemrushEntitlement(context, { orgId, brandId } = {}) {
  const { log, dataAccess } = context || {};

  if (!orgId || !brandId) {
    return { entitled: false, resolved: false, reason: 'missing-input' };
  }

  const postgrestClient = dataAccess?.services?.postgrestClient;
  const hasWorkspaceModels = typeof dataAccess?.Organization?.findById === 'function'
    && typeof dataAccess?.Brand?.findById === 'function';
  if (!postgrestClient?.from || !hasWorkspaceModels) {
    log?.warn(`${LOG_PREFIX} PostgREST client or Organization/Brand data-access not available; cannot resolve Semrush entitlement`, {
      orgId, brandId,
    });
    return { entitled: false, resolved: false, reason: 'no-client' };
  }

  let timeoutHandle;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        const e = new Error(`Semrush entitlement check timed out after ${SEMRUSH_ENTITLEMENT_TIMEOUT_MS}ms`);
        e.name = 'TimeoutError';
        reject(e);
      }, SEMRUSH_ENTITLEMENT_TIMEOUT_MS);
    });

    const [flagEnabled, workspace] = await Promise.race([
      Promise.all([
        isSerenityEnabledForOrg(orgId, postgrestClient, log),
        resolveSemrushWorkspace(dataAccess, { orgId, brandId }),
      ]),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);

    // null = the flag query itself failed (distinct from a confirmed-absent row,
    // which resolves to `false`) — an inconclusive check must not read as
    // "confirmed disabled".
    if (flagEnabled === null) {
      return { entitled: false, resolved: false, reason: 'check-failed' };
    }
    if (flagEnabled === false) {
      return { entitled: false, resolved: true, reason: 'flag-disabled' };
    }
    if (!workspace) {
      return { entitled: false, resolved: true, reason: 'no-workspace' };
    }
    return {
      entitled: true, resolved: true, reason: 'entitled', mode: workspace.mode,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    log?.warn(`${LOG_PREFIX} Semrush entitlement check failed for org ${orgId} / brand ${brandId}: ${error.message}`, {
      orgId, brandId, errorName: error.name,
    });
    return { entitled: false, resolved: false, reason: 'check-failed' };
  }
}
