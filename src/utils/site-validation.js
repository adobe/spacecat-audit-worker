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
  const log = context?.log;
  const siteId = site?.getId?.();

  if (!site) {
    return false;
  }
  if (auditType && IS_LLMO_OPPTY.includes(auditType)) {
    log?.info?.(`[site-validation] siteId=${siteId} auditType=${auditType} is LLMO — skipping validation`);
    return false;
  }

  // Internal/demo orgs bypass suggestion validation regardless of PAID tier
  const rawExcludedOrgs = process.env.ASO_PLG_EXCLUDED_ORGS;
  log?.info?.(`[site-validation] siteId=${siteId} ASO_PLG_EXCLUDED_ORGS=${rawExcludedOrgs ?? '(not set)'}`);

  if (rawExcludedOrgs) {
    const excludedOrgIds = rawExcludedOrgs.split(',')
      .map((id) => id.trim()).filter((id) => id.length > 0);
    const orgId = site.getOrganizationId?.();
    log?.info?.(`[site-validation] siteId=${siteId} orgId=${orgId} excludedOrgIds=${excludedOrgIds.join(',')}`);
    if (orgId && excludedOrgIds.includes(orgId)) {
      log?.info?.(`[site-validation] siteId=${siteId} orgId=${orgId} is in ASO_PLG_EXCLUDED_ORGS — skipping validation`);
      return false;
    }
  }

  // LA customers override via env
  let laSiteIds = [];

  if (process.env.LA_VALIDATION_SITE_IDS) {
    laSiteIds = process.env.LA_VALIDATION_SITE_IDS.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
  }
  const isLABySite = siteId && laSiteIds.includes(siteId);

  if (isLABySite) {
    log?.info?.(`[site-validation] siteId=${siteId} is in LA_VALIDATION_SITE_IDS — requires validation`);
    return true;
  }

  // Entitlement-driven: require validation only for PAID tier of ASO
  try {
    const tierClient = await TierClient.createForSite(context, site, ASO_PRODUCT_CODE);
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement?.getTier?.() ?? null;
    const productCode = entitlement?.getProductCode?.() ?? null;

    log?.info?.(`[site-validation] siteId=${siteId} entitlement tier=${tier} productCode=${productCode}`);

    if (tier === Entitlement.TIERS.PAID && productCode === ASO_PRODUCT_CODE) {
      log?.info?.(`[site-validation] siteId=${siteId} is PAID ASO — requires validation`);
      return true;
    }
  } catch (e) {
    context?.log?.warn?.(`Entitlement check failed for site ${siteId}: ${e.message}`);
  }

  log?.info?.(`[site-validation] siteId=${siteId} — no validation required`);
  return false;
}
