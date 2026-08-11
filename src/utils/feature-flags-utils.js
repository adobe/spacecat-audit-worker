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
 * `semrush-entitlement.js`'s `isSerenityEnabledForOrg`, and whichever comes next)
 * shares this module instead of re-deriving its own copy (PR review, second
 * consumer moment).
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
 * Reads one org-wide feature flag from the `feature_flags` table, ignoring any
 * brand-scoped override row for the same organization/product/flag_name (see
 * `isOrgRow`). No caller today writes a brand-scoped override for any flag this
 * reads (confirmed against spacecat-api-service's own `feature-flags-storage.js`,
 * which never combines `brand_id` with `feature_flags`), so this is defensive
 * against a schema state that can exist, not a documented revoke mechanism.
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
 * @param {string} params.flagName - `feature_flags.flag_name` (e.g. `'brandalf'`, `'serenity'`)
 * @param {object} [params.log] - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function readOrgFeatureFlag(postgrestClient, {
  organizationId, product, flagName, log,
} = {}) {
  if (!organizationId) {
    return false;
  }
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

    // Absent row => flag not set => disabled, matching the previous behaviour
    // where a missing flag resolved to `false`.
    return (data ?? []).find(isOrgRow)?.flag_value === true;
  } catch (error) {
    log?.warn(`Error checking ${flagName} flag for org ${organizationId}: ${error.message}`);
    return null;
  }
}
