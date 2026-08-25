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
 * whether to serve the Serenity experience for one BRAND (see `serenity-active.js` +
 * `workspace-resolver.js`'s `resolveBrandWorkspace` there):
 * - the `serenity` feature flag must resolve `true` for the brand — a brand-scoped
 *   override row wins over the organization's own row when one exists, exactly like
 *   api-service's `isSerenityActiveForBrand` (NOT its org-only `isSerenityActiveForOrg`,
 *   which that module's own doc reserves for brand-creation-time checks with no brand
 *   to resolve against yet — this check always has one). Read directly via
 *   `context.dataAccess.services.postgrestClient` (no shared-package helper exists for
 *   this; api-service's own `readFeatureFlagScopes`/`resolveFlagRowForBrand` are private
 *   application code, not published) — see ADR 002, Decision 8f, AND
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

import { resolveFeatureFlagForBrand } from './feature-flags-utils.js';
import {
  createOffsiteLogger, errorField, AUDIT, OUTCOME, PEER,
} from './offsite-logging.js';

const SERENITY_FLAG_PRODUCT = 'LLMO';
const SERENITY_FLAG_NAME = 'serenity';

/**
 * Reason code the loader (`offsite-brand-presence-semrush.js`) sets on
 * `diagnostics.fallbackReason` for a CONFIRMED non-entitlement (`resolved:true`).
 * Exported so both the loader (producer) and the handler's hard-stop-exemption
 * check (`offsite-brand-presence/handler.js`) share one literal instead of two
 * independently-typed copies that could drift.
 */
export const SEMRUSH_NOT_ENTITLED_REASON = 'not_entitled';

/**
 * Reason code the loader sets on `diagnostics.fallbackReason` when the entitlement
 * check itself could not complete (`resolved:false` — see `entitlementReason` on the
 * same diagnostics object for the granular cause: `no_client` vs `check_failed`).
 */
export const SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON = 'entitlement_check_failed';

/**
 * Both entitlement-based skip reasons — a deliberate skip (confirmed or
 * inconclusive), never a Semrush/technical failure. Consumed directly by the
 * handler's hard-stop-exemption check so it never has to know the literal values.
 */
export const SEMRUSH_ENTITLEMENT_SKIP_REASONS = Object.freeze(
  new Set([SEMRUSH_NOT_ENTITLED_REASON, SEMRUSH_ENTITLEMENT_CHECK_FAILED_REASON]),
);

/**
 * Granular causes behind `resolveSemrushEntitlement`'s `reason` field (and, for every
 * value but `ENTITLED`, the `entitlementReason` it becomes downstream on
 * `diagnostics`/`auditResult`). Exported as one frozen lookup — rather than one bare
 * string literal per branch — so a future rename can't silently drift between this
 * module and whatever reads `entitlementReason` off `auditResult` (PR review).
 */
export const SEMRUSH_ENTITLEMENT_REASONS = Object.freeze({
  ENTITLED: 'entitled',
  FLAG_DISABLED: 'flag_disabled',
  NO_WORKSPACE: 'no_workspace',
  MISSING_INPUT: 'missing_input',
  NO_CLIENT: 'no_client',
  CHECK_FAILED: 'check_failed',
});

/**
 * Maximum milliseconds to wait for the combined flag + workspace lookup before
 * failing closed. Mirrors `BRAND_RESOLUTION_TIMEOUT_MS` in `brand-resolver.js`, whose
 * budget covers a WORSE (more sequential) shape: up to two SEQUENTIAL PostgREST round
 * trips (its Q2 only runs after Q1 misses). This check's three lookups (the flag read,
 * `Organization.findById`, `Brand.findById`) all run CONCURRENTLY via `Promise.all`, so
 * the critical path here is one round-trip deep, not two — the same budget is, if
 * anything, more generous for this shape. Re-validate against real p99s post-rollout
 * if `check_failed` volume looks high (a symptom the timeout is too tight for
 * `Organization`/`Brand`'s data-access-layer overhead vs a raw PostgREST query).
 */
export const SEMRUSH_ENTITLEMENT_TIMEOUT_MS = 300;

/**
 * Checks the `serenity` feature flag for one brand — the same per-brand rollout
 * switch spacecat-api-service's `isSerenityActiveForBrand` reads before serving the
 * Serenity/Semrush experience for that brand. Delegates to the shared
 * `resolveFeatureFlagForBrand` (`feature-flags-utils.js`), which resolves a
 * brand-scoped override row over the organization's own row for the same
 * `organization_id`/`product`/`flag_name` when one exists — see that module for why
 * reading only the organization's row is unsafe for a check that resolves per brand.
 *
 * @param {string} organizationId - SpaceCat org UUID
 * @param {string} brandId - SpaceCat brand UUID to resolve the override for
 * @param {object} postgrestClient - mysticat PostgREST client (already validated by caller)
 * @param {object} log - Logger
 * @returns {Promise<boolean|null>} true/false when known, null when the query itself failed
 */
async function isSerenityEnabledForBrand(organizationId, brandId, postgrestClient, log) {
  return resolveFeatureFlagForBrand(postgrestClient, {
    organizationId, brandId, product: SERENITY_FLAG_PRODUCT, flagName: SERENITY_FLAG_NAME, log,
  });
}

/**
 * Resolves the Semrush workspace for a (org, brand) pair via the shared
 * `Organization`/`Brand` data-access models — the same entities and getters
 * spacecat-api-service's `workspace-resolver.js` reads (minus its caching; see the
 * file-level doc comment). Dual-mode: a brand's own sub-workspace takes precedence;
 * the org's flat workspace is the fallback.
 *
 * CONTRACT — `brandId` MUST already belong to `orgId`; this function does NOT verify
 * that membership itself. The shared `Brand` data-access model
 * (`@adobe/spacecat-shared-data-access`) is deliberately minimal — it does not declare
 * `organizationId` at all (see `brand.schema.js` / `brand.model.js`: "columns this
 * entity does not declare (organization_id, site_id, regions, …) are simply never
 * touched by it") — so there is no getter here to check against. Verifying it would
 * require a raw PostgREST query against `brands.organization_id`, reintroducing the
 * table-level dependency this module deliberately moved away from (see the file-level
 * doc comment) for a scenario the sole caller (`offsite-brand-presence-semrush.js`,
 * via `resolveBrandResultForSite`) cannot hit today — that resolver is already
 * server-side scoped by `organization_id`. A future caller that resolves `orgId` and
 * `brandId` from independent sources MUST enforce this invariant itself before calling
 * `resolveSemrushEntitlement` — passing a mismatched pair here can attribute a
 * different org's Semrush provisioning to this one.
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
 * CONTRACT — caller must guarantee `brandId` belongs to `orgId`; see
 * `resolveSemrushWorkspace`'s doc comment for why this is not verified internally.
 *
 * @param {object} context - Lambda context (`dataAccess` incl. `.services.postgrestClient`, `log`)
 * @param {{orgId: string, brandId: string}} params
 * @returns {Promise<{
 *   entitled: boolean,
 *   resolved: boolean,
 *   reason: string,
 *   mode?: 'subworkspace'|'flat',
 * }>} `reason` is one of `SEMRUSH_ENTITLEMENT_REASONS`'s values.
 *   `resolved:true` means the non-entitlement is CONFIRMED (flag off, or no workspace);
 *   `resolved:false` means the check itself could not complete (treat as a transient
 *   skip for this run, not a permanent verdict).
 */
export async function resolveSemrushEntitlement(context, { orgId, brandId } = {}) {
  const { log, dataAccess } = context || {};

  if (!orgId || !brandId) {
    return { entitled: false, resolved: false, reason: SEMRUSH_ENTITLEMENT_REASONS.MISSING_INPUT };
  }

  const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE });

  const postgrestClient = dataAccess?.services?.postgrestClient;
  const hasWorkspaceModels = typeof dataAccess?.Organization?.findById === 'function'
    && typeof dataAccess?.Brand?.findById === 'function';
  if (!postgrestClient?.from || !hasWorkspaceModels) {
    olog.warn('data_acquisition_bp_data_semrush_read', 'PostgREST client or Organization/Brand data-access not available; cannot resolve Semrush entitlement', {
      peer: PEER.SEMRUSH, direction: 'inbound', reason: 'no_client', reasonCategory: 'infra', outcome: OUTCOME.SKIP, orgId, brandId,
    });
    return { entitled: false, resolved: false, reason: SEMRUSH_ENTITLEMENT_REASONS.NO_CLIENT };
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
        isSerenityEnabledForBrand(orgId, brandId, postgrestClient, log),
        resolveSemrushWorkspace(dataAccess, { orgId, brandId }),
      ]),
      timeoutPromise,
    ]);
    clearTimeout(timeoutHandle);

    // null = the flag query itself failed (distinct from a confirmed-absent row,
    // which resolves to `false`) — an inconclusive check must not read as
    // "confirmed disabled".
    if (flagEnabled === null) {
      return { entitled: false, resolved: false, reason: SEMRUSH_ENTITLEMENT_REASONS.CHECK_FAILED };
    }
    if (flagEnabled === false) {
      return { entitled: false, resolved: true, reason: SEMRUSH_ENTITLEMENT_REASONS.FLAG_DISABLED };
    }
    if (!workspace) {
      return { entitled: false, resolved: true, reason: SEMRUSH_ENTITLEMENT_REASONS.NO_WORKSPACE };
    }
    return {
      entitled: true,
      resolved: true,
      reason: SEMRUSH_ENTITLEMENT_REASONS.ENTITLED,
      mode: workspace.mode,
    };
  } catch (error) {
    clearTimeout(timeoutHandle);
    olog.warn('data_acquisition_bp_data_semrush_read', 'Semrush entitlement check failed', {
      peer: PEER.SEMRUSH, direction: 'inbound', reason: 'entitlement_check_failed', reasonCategory: 'infra', outcome: OUTCOME.DEGRADED, orgId, brandId, ...errorField(error),
    });
    return { entitled: false, resolved: false, reason: SEMRUSH_ENTITLEMENT_REASONS.CHECK_FAILED };
  }
}
