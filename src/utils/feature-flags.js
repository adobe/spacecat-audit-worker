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
 * Fetches the set of LLMO feature flags currently enabled for an organization.
 * Errors and missing configuration are logged and treated as "no flags enabled"
 * so callers fail-open (preserve current behavior on transient failures).
 *
 * @param {string} organizationId - SpaceCat internal org UUID
 * @param {object} env - Environment variables (needs SPACECAT_API_BASE_URL, SPACECAT_API_KEY)
 * @param {object} log - Logger
 * @returns {Promise<Set<string>>} Set of enabled flag names (empty on any failure)
 */
async function fetchEnabledLlmoFlags(organizationId, env, log) {
  const { SPACECAT_API_BASE_URL: apiBase, SPACECAT_API_KEY: apiKey } = env;
  if (!apiBase || !apiKey) {
    log.warn('SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured; cannot read LLMO feature flags');
    return new Set();
  }

  try {
    const url = `${apiBase}/organizations/${encodeURIComponent(organizationId)}/feature-flags?product=LLMO`;
    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      log.warn(`Failed to fetch LLMO feature flags for org ${organizationId}: ${response.status}`);
      return new Set();
    }

    const flags = await response.json();
    if (!Array.isArray(flags)) {
      return new Set();
    }
    return new Set(
      flags.filter((f) => f && f.flagValue === true && typeof f.flagName === 'string')
        .map((f) => f.flagName),
    );
  } catch (error) {
    log.warn(`Error checking LLMO feature flags for org ${organizationId}: ${error.message}`);
    return new Set();
  }
}

/**
 * Returns true when the `brandalf` flag is enabled for the org.
 * Used by onboarding flows that gate v2 behavior on brandalf-only.
 */
export async function isBrandalfEnabled(organizationId, env, log) {
  const flags = await fetchEnabledLlmoFlags(organizationId, env, log);
  return flags.has('brandalf');
}

/**
 * Returns true when EITHER `brandalf` OR `brandalf_migration` is enabled for the org.
 * Used to enforce the v1-write ban: any org under either flag must be treated as
 * brandalf for write-side decisions, even before the full migration cutover (LLMO-4587).
 */
export async function isBrandalfOrMigrationEnabled(organizationId, env, log) {
  const flags = await fetchEnabledLlmoFlags(organizationId, env, log);
  return flags.has('brandalf') || flags.has('brandalf_migration');
}
