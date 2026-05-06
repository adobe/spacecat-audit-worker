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
 * LLMO-4716: Resolve the v2 `brand_id` for a given (organization, site) pair via
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
 */

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

const LOG_PREFIX = '[BrandResolver]';
const FETCH_TIMEOUT_MS = 30000;
const USER_AGENT = 'spacecat-audit-worker/brand-resolver';

/**
 * @param {string} orgId - SpaceCat organization UUID
 * @param {string} siteId - Site UUID
 * @param {object} env - Lambda environment (must include SPACECAT_API_BASE_URL,
 *   SPACECAT_API_KEY)
 * @param {object} log - Logger
 * @returns {Promise<string|null>} The brand UUID, or null if the org has no v2
 *   brand for this site.
 */
export async function resolveBrandIdForSite(orgId, siteId, env, log) {
  const apiBase = env?.SPACECAT_API_BASE_URL;
  const apiKey = env?.SPACECAT_API_KEY;
  if (!apiBase || !apiKey) {
    throw new Error(
      `${LOG_PREFIX} SPACECAT_API_BASE_URL or SPACECAT_API_KEY not configured`,
    );
  }
  if (!orgId || !siteId) {
    throw new Error(`${LOG_PREFIX} orgId and siteId are required`);
  }

  const url = `${apiBase}/v2/orgs/${encodeURIComponent(orgId)}/sites/${encodeURIComponent(siteId)}/brand`;
  const headers = {
    'x-api-key': apiKey,
    'User-Agent': USER_AGENT,
  };

  log.info(`${LOG_PREFIX} Resolving brand for org=${orgId} site=${siteId}`);

  let response;
  try {
    response = await fetch(url, { headers, timeout: FETCH_TIMEOUT_MS });
  } catch (error) {
    // Network/timeout/abort — treat as transient. SQS retry will re-attempt.
    throw new Error(
      `${LOG_PREFIX} Brand resolution failed (network/timeout) for org=${orgId} site=${siteId}: ${error.message}`,
      { cause: error },
    );
  }

  if (response.status === 404) {
    log.info(
      `${LOG_PREFIX} No v2 brand for org=${orgId} site=${siteId} — runner will take v1 path`,
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
      `${LOG_PREFIX} Brand resolution failed for org=${orgId} site=${siteId}: `
      + `${response.status} ${response.statusText} — ${body.slice(0, 200)}`,
    );
  }

  let brand;
  try {
    brand = await response.json();
  } catch (error) {
    throw new Error(
      `${LOG_PREFIX} Brand resolution returned non-JSON for org=${orgId} site=${siteId}: ${error.message}`,
      { cause: error },
    );
  }

  if (!brand || typeof brand.id !== 'string' || brand.id.length === 0) {
    log.warn(
      `${LOG_PREFIX} Brand resolution returned no id for org=${orgId} site=${siteId} — treating as no v2 brand`,
    );
    return null;
  }

  log.info(
    `${LOG_PREFIX} Resolved brand=${brand.id} for org=${orgId} site=${siteId}`,
  );
  return brand.id;
}
