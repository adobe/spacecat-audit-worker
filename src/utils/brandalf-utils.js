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

import { readOrgFeatureFlag } from './feature-flags-utils.js';

const BRANDALF_FLAG_NAME = 'brandalf';
const FEATURE_FLAG_PRODUCT = 'LLMO';

/**
 * Checks whether the brandalf feature flag is enabled for an organization by
 * reading the `feature_flags` table directly via the mysticat PostgREST client
 * (available at `context.dataAccess.services.postgrestClient`).
 *
 * Resolves the organization's own value, ignoring any brand's override of it —
 * see `readOrgFeatureFlag` (`feature-flags-utils.js`) for the shared query/
 * fail-closed shape every `feature_flags` reader in this worker uses.
 *
 * @param {string} organizationId - SpaceCat org UUID
 * @param {object} postgrestClient - mysticat PostgREST client (dataAccess.services.postgrestClient)
 * @param {object} log - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function isBrandalfEnabled(organizationId, postgrestClient, log) {
  return readOrgFeatureFlag(postgrestClient, {
    organizationId, product: FEATURE_FLAG_PRODUCT, flagName: BRANDALF_FLAG_NAME, log,
  });
}

/**
 * Resolves the organization ID for a site, preferring the provided site object,
 * then an explicit fallback value, then a Site.findById lookup.
 *
 * @param {object} options
 * @param {object} [options.site] - Site entity/model instance
 * @param {string} [options.siteId] - Site ID for fallback lookup
 * @param {object} [options.dataAccess] - Worker dataAccess object
 * @param {string|null} [options.fallbackOrganizationId] - Optional explicit fallback org ID
 * @param {object} [options.log] - Logger
 * @returns {Promise<string|null>} Resolved org ID or null when unavailable
 */
export async function resolveOrganizationIdForSite({
  site,
  siteId,
  dataAccess,
  fallbackOrganizationId = null,
  log,
} = {}) {
  const organizationId = site?.getOrganizationId?.();
  if (organizationId) {
    return organizationId;
  }

  if (fallbackOrganizationId) {
    return fallbackOrganizationId;
  }

  const Site = dataAccess?.Site;
  if (!siteId || !Site?.findById) {
    return null;
  }

  try {
    const resolvedSite = await Site.findById(siteId);
    return resolvedSite?.getOrganizationId?.() || null;
  } catch (error) {
    log?.warn(`Failed to resolve organization for site ${siteId}: ${error.message}`);
    return null;
  }
}
