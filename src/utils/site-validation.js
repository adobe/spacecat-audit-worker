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

/**
 * Checks if a site requires suggestion validation before showing in UI
 * @param {Object} site - The site object
 * @returns {boolean} - True if site requires validation, false otherwise
 */
export async function checkSiteRequiresValidation(site, context) {
  if (!site) {
    return false;
  }
  // Check if the site has the requiresValidation flag set directly
  if (typeof site.requiresValidation === 'boolean') {
    return site.requiresValidation;
  }

  // LA customers override via env (comma-separated IDs)
  let laSiteIds = [];
  let laOrgIds = [];

  if (process.env.LA_VALIDATION_SITE_IDS) {
    laSiteIds = process.env.LA_VALIDATION_SITE_IDS.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  if (process.env.LA_VALIDATION_ORG_IDS) {
    laOrgIds = process.env.LA_VALIDATION_ORG_IDS.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }
  const siteId = site.getId?.();
  const orgId = site.getOrganizationId?.();
  const isLABySite = siteId && laSiteIds.includes(siteId);
  const isLAByOrg = orgId && laOrgIds.includes(orgId);

  context?.log?.debug?.(`LA validation check: siteId=${siteId}, orgId=${orgId}, laSiteIds=${JSON.stringify(laSiteIds)}, laOrgIds=${JSON.stringify(laOrgIds)}, isLABySite=${isLABySite}, isLAByOrg=${isLAByOrg}`);

  if (isLABySite || isLAByOrg) {
    context?.log?.debug?.(`LA customer detected! Site ${siteId} requires validation.`);
    return true;
  }

  // Entitlement-driven: require validation only for PAID tier of ASO
  try {
    const tierClient = TierClient.createForSite(context, site, 'ASO');
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement?.tier ?? entitlement?.record?.tier ?? null;
    const productCode = entitlement?.record?.productCode ?? null;

    if (tier === 'PAID' && (productCode === 'ASO' || entitlement?.record?.productCode === 'ASO')) {
      return true;
    }
  } catch (e) {
    context?.log?.warn?.(`Entitlement check failed for site ${site.getId?.()}: ${e.message}`);
  }

  // No PAID ASO entitlement: do not require validation
  return false;
}
