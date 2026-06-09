/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { Entitlement } from '@adobe/spacecat-shared-data-access';

const ASO_PRODUCT_CODE = Entitlement.PRODUCT_CODES.ASO;

/**
 * Audit types (SQS message `type`) for LLMO flows that skip PAID-tier suggestion validation
 * gating — suggestions sync as if requiresValidation were false for these audits.
 */
export const IS_LLMO_OPPTY = [
  'prerender',
];

/**
 * Checks if a site requires suggestion validation before showing in UI
 * @param {Object} site - The site object
 * @param {Object} context - Lambda context
 * @param {string} [auditType] - Audit `type` from the job message (e.g. prerender)
 * @returns {Promise<boolean>} - True if site requires validation, false otherwise
 */
export async function checkSiteRequiresValidation(site, context, auditType) {
  const siteId = site?.getId?.();
  const log = context?.log;

  // TEMP DIAGNOSTIC — remove after SITES-42095 follow-up identifies the silent branch.
  // Logs one line per call covering every path that returns `false`, with enough
  // context (`tier`, `productCode`, env var presence, entitlement-found flag) to
  // tell apart "no entitlement" vs "tier value mismatch" vs env-var bypass.
  const orgId = site?.getOrganizationId?.();

  if (!site) {
    log?.info?.('[rv-debug] siteId=null → false (no site)');
    return false;
  }
  if (auditType && IS_LLMO_OPPTY.includes(auditType)) {
    log?.info?.(`[rv-debug] siteId=${siteId} auditType=${auditType} → false (in IS_LLMO_OPPTY)`);
    return false;
  }

  // Internal/demo orgs bypass suggestion validation regardless of PAID tier
  const rawExcludedOrgs = process.env.ASO_PLG_EXCLUDED_ORGS;
  // TEMP: dump the actual value + a count of how many orgs are loaded into process.env
  // (look for which env var name surfaces the Sunstar dev org 44568c3e-…)
  log?.info?.(
    `[rv-debug] siteId=${siteId} orgId=${orgId} ASO_PLG_EXCLUDED_ORGS_set=${!!rawExcludedOrgs} `
    + `ASO_PLG_EXCLUDED_ORGS_len=${(rawExcludedOrgs || '').length} `
    + `ASO_PLG_EXCLUDED_ORGS_value=${JSON.stringify((rawExcludedOrgs || '').slice(0, 500))}`,
  );
  // Also list every process.env key that contains 'ORG' or 'PLG' or 'VALIDATION' or 'EXCLUDE'
  const interestingKeys = Object.keys(process.env)
    .filter((k) => /ORG|PLG|VALIDATION|EXCLUDE/i.test(k));
  log?.info?.(`[rv-debug] env keys matching ORG/PLG/VALIDATION/EXCLUDE: ${JSON.stringify(interestingKeys)}`);
  if (rawExcludedOrgs) {
    const excludedOrgIds = rawExcludedOrgs.split(',')
      .map((id) => id.trim()).filter((id) => id.length > 0);
    if (orgId && excludedOrgIds.includes(orgId)) {
      log?.info?.(`[rv-debug] siteId=${siteId} orgId=${orgId} → false (org in ASO_PLG_EXCLUDED_ORGS)`);
      return false;
    }
  }

  // LA customers override via env
  let laSiteIds = [];
  if (process.env.LA_VALIDATION_SITE_IDS) {
    laSiteIds = process.env.LA_VALIDATION_SITE_IDS.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
  }
  if (siteId && laSiteIds.includes(siteId)) {
    log?.info?.(`[rv-debug] siteId=${siteId} → true (in LA_VALIDATION_SITE_IDS)`);
    return true;
  }

  // Entitlement-driven: require validation only for PAID tier of ASO
  try {
    const tierClient = await TierClient.createForSite(context, site, ASO_PRODUCT_CODE);
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement?.getTier?.() ?? null;
    const productCode = entitlement?.getProductCode?.() ?? null;

    log?.info?.(
      `[rv-debug] siteId=${siteId} orgId=${orgId} `
      + `entitlementFound=${!!entitlement} entitlementId=${entitlement?.getId?.() ?? 'null'} `
      + `tier=${JSON.stringify(tier)} productCode=${JSON.stringify(productCode)} `
      + `Entitlement.TIERS.PAID=${JSON.stringify(Entitlement.TIERS.PAID)} `
      + `ASO_PRODUCT_CODE=${JSON.stringify(ASO_PRODUCT_CODE)}`,
    );

    if (tier === Entitlement.TIERS.PAID && productCode === ASO_PRODUCT_CODE) {
      log?.info?.(`[rv-debug] siteId=${siteId} → true (PAID ASO entitlement matched)`);
      return true;
    }
  } catch (e) {
    context?.log?.warn?.(`Entitlement check failed for site ${siteId}: ${e.message}`);
  }

  log?.info?.(`[rv-debug] siteId=${siteId} orgId=${orgId} → false (fell through to default)`);
  return false;
}
