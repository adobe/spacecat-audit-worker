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

const BRANDALF_FLAG_NAME = 'brandalf';
const FEATURE_FLAG_PRODUCT = 'LLMO';

/**
 * Checks whether the brandalf feature flag is enabled for an organization by
 * reading the `feature_flags` table directly via the mysticat PostgREST client
 * (available at `context.dataAccess.services.postgrestClient`).
 *
 * @param {string} organizationId - SpaceCat org UUID
 * @param {object} postgrestClient - mysticat PostgREST client (dataAccess.services.postgrestClient)
 * @param {object} log - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function isBrandalfEnabled(organizationId, postgrestClient, log) {
  if (!organizationId) {
    return false;
  }
  if (!postgrestClient?.from) {
    log?.warn('PostgREST client not available; cannot check brandalf flag');
    return null;
  }

  try {
    const { data, error } = await postgrestClient
      .from('feature_flags')
      .select('flag_value')
      .eq('organization_id', organizationId)
      .eq('product', FEATURE_FLAG_PRODUCT)
      .eq('flag_name', BRANDALF_FLAG_NAME)
      .maybeSingle();

    if (error) {
      log?.warn(`Failed to read brandalf flag for org ${organizationId}: ${error.message}`);
      return null;
    }

    // Absent row => flag not set => disabled, matching the previous behaviour
    // where a missing flag resolved to `false`.
    return data?.flag_value === true;
  } catch (error) {
    log?.warn(`Error checking brandalf flag for org ${organizationId}: ${error.message}`);
    return null;
  }
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
