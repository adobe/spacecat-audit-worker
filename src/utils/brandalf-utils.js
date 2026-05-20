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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Checks whether the brandalf feature flag is enabled for an organization
 * by calling the SpaceCat API feature-flags endpoint.
 *
 * @param {string} organizationId - SpaceCat org UUID
 * @param {object} env - Environment variables (needs SPACECAT_API_BASE_URL, SPACECAT_API_KEY)
 * @param {object} log - Logger
 * @returns {Promise<boolean|null>} true/false when the flag state is known, null when unknown
 */
export async function isBrandalfEnabled(organizationId, env, log) {
  const { SPACECAT_API_BASE_URL: apiBase, SPACECAT_API_KEY: apiKey } = env || {};
  if (!organizationId) {
    return false;
  }
  if (!apiBase || !apiKey) {
    log?.warn('SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured; cannot check brandalf flag');
    return null;
  }

  try {
    const url = `${apiBase}/organizations/${encodeURIComponent(organizationId)}/feature-flags?product=LLMO`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      log?.warn(`Failed to fetch feature flags for org ${organizationId}: ${response.status}`);
      return null;
    }

    const flags = await response.json();
    if (!Array.isArray(flags)) {
      log?.warn(`Unexpected feature flags payload for org ${organizationId}; cannot check brandalf flag`);
      return null;
    }

    return flags.some(
      (flag) => flag.flagName === 'brandalf' && flag.flagValue === true,
    );
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
