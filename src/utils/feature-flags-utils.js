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
 * Shared primitives for reading the `feature_flags` table directly via the mysticat
 * PostgREST client (`context.dataAccess.services.postgrestClient`). A generic
 * `feature_flags` schema fact, not tied to any one flag/reader — every LLMO
 * feature-flag reader (`brandalf-utils.js`'s `isBrandalfEnabled`,
 * `semrush-entitlement.js`'s `isSerenityEnabledForBrand`, and whichever comes next)
 * shares this module instead of re-deriving its own copy (PR review, second
 * consumer moment).
 *
 * Two resolution shapes are exported because api-service's own `serenity-active.js`
 * documents that its two are NOT interchangeable: `isSerenityActiveForOrg` ("use only
 * where there is no brand to resolve against") vs `isSerenityActiveForBrand`
 * ("everything that acts on an existing brand must use this instead"). A reader
 * mirroring an org-only predicate for a check that resolves per-brand over-grants or
 * under-grants the moment any brand-scoped override row exists — see ADR 002,
 * Decision 8f, for why `readOrgFeatureFlag` is safe for `isBrandalfEnabled` (no known
 * per-brand override mechanism for that flag) but was NOT safe for the serenity check.
 */

/**
 * The organization's own row, not a brand's override of it. `brand_id` is absent
 * from every row before the brand-scope migration and NULL on the organization's
 * row after it, so this selects correctly under both schemas.
 *
 * The query feeding this predicate must keep selecting the full row. Naming
 * `brand_id` in a projection — or filtering on it — fails against the current
 * schema, where the column does not exist yet; narrowing the projection once it
 * does exist makes every override row arrive with `brand_id: undefined` and read
 * as the organization's own.
 *
 * @param {object} row - Raw PostgREST `feature_flags` row.
 * @returns {boolean} `true` for the organization-level row.
 */
export const isOrgRow = (row) => (row.brand_id ?? null) === null;

/**
 * Fetches every row of one flag for an organization — its own row and any
 * brand-scoped overrides — the single place this query is built so both resolution
 * shapes below stay byte-for-byte identical.
 *
 * @param {object} postgrestClient - mysticat PostgREST client (dataAccess.services.postgrestClient)
 * @param {object} params
 * @param {string} params.organizationId - SpaceCat org UUID
 * @param {string} params.product - `feature_flags.product` (e.g. `'LLMO'`)
 * @param {string} params.flagName - `feature_flags.flag_name` (e.g. `'brandalf'`, `'serenity'`)
 * @param {object} [params.log] - Logger
 * @returns {Promise<object[]|null>} Raw rows, or `null` when the read could not complete
 */
async function fetchFeatureFlagRows(postgrestClient, {
  organizationId, product, flagName, log,
} = {}) {
  if (!postgrestClient?.from) {
    log?.warn(`PostgREST client not available; cannot check ${flagName} flag`);
    return null;
  }

  try {
    // Wildcard projection is required — see `isOrgRow`.
    const { data, error } = await postgrestClient
      .from('feature_flags')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('product', product)
      .eq('flag_name', flagName);

    if (error) {
      log?.warn(`Failed to read ${flagName} flag for org ${organizationId}: ${error.message}`);
      return null;
    }

    return data ?? [];
  } catch (error) {
    log?.warn(`Error checking ${flagName} flag for org ${organizationId}: ${error.message}`);
    return null;
  }
}

/**
 * Reads one org-wide feature flag from the `feature_flags` table, ignoring any
 * brand-scoped override row for the same organization/product/flag_name (see
 * `isOrgRow`). Correct ONLY for a flag with no per-brand resolution mechanism — see
 * the file-level doc comment; a flag whose brand-scoped row overrides the org's
 * (like `serenity`) must use `resolveFeatureFlagForBrand` instead.
 *
 * Fails closed: a missing organization id resolves to `false` (nothing to look
 * up), an unavailable client/query error/thrown exception resolves to `null`
 * (the check itself could not complete — distinct from a confirmed-absent row,
 * which is `false`).
 *
 * @param {object} postgrestClient - mysticat PostgREST client (dataAccess.services.postgrestClient)
 * @param {object} params
 * @param {string} params.organizationId - SpaceCat org UUID
 * @param {string} params.product - `feature_flags.product` (e.g. `'LLMO'`)
 * @param {string} params.flagName - `feature_flags.flag_name` (e.g. `'brandalf'`)
 * @param {object} [params.log] - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function readOrgFeatureFlag(postgrestClient, {
  organizationId, product, flagName, log,
} = {}) {
  if (!organizationId) {
    return false;
  }
  const rows = await fetchFeatureFlagRows(postgrestClient, {
    organizationId, product, flagName, log,
  });
  if (rows === null) {
    return null;
  }

  // Absent row => flag not set => disabled, matching the previous behaviour
  // where a missing flag resolved to `false`.
  return rows.find(isOrgRow)?.flag_value === true;
}

/**
 * Resolves which row governs a flag for one brand — the brand's own override when
 * it has one, otherwise the organization's row — mirroring api-service's
 * `resolveFlagRowForBrand` (`feature-flags-storage.js`) exactly: the brand row is an
 * override rather than a second condition ANDed with the organization's, so a brand
 * can be on while its organization is off (a migration wave before the last one), and
 * a brand row of `false` can hold one brand back from an organization that is on.
 *
 * Before the brand-scope migration no row carries a `brand_id`, so this always
 * resolves to the organization's row for every brand — i.e. the same answer
 * `readOrgFeatureFlag` gives today, under either schema.
 *
 * Fails closed: a missing organization id or brand id resolves to `false`, an
 * unavailable client/query error/thrown exception resolves to `null` (the check
 * itself could not complete — distinct from a confirmed-absent row, which is
 * `false`).
 *
 * @param {object} postgrestClient - mysticat PostgREST client (dataAccess.services.postgrestClient)
 * @param {object} params
 * @param {string} params.organizationId - SpaceCat org UUID
 * @param {string} params.brandId - SpaceCat brand UUID to resolve the override for
 * @param {string} params.product - `feature_flags.product` (e.g. `'LLMO'`)
 * @param {string} params.flagName - `feature_flags.flag_name` (e.g. `'serenity'`)
 * @param {object} [params.log] - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function resolveFeatureFlagForBrand(postgrestClient, {
  organizationId, brandId, product, flagName, log,
} = {}) {
  if (!organizationId || !brandId) {
    return false;
  }
  const rows = await fetchFeatureFlagRows(postgrestClient, {
    organizationId, product, flagName, log,
  });
  if (rows === null) {
    return null;
  }

  const brandRow = rows.find((row) => (row.brand_id ?? null) === brandId);
  const row = brandRow ?? rows.find(isOrgRow) ?? null;
  return row?.flag_value === true;
}
