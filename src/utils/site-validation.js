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
 * Checks if a site requires suggestion validation before showing in UI
 * @param {Object} site - The site object
 * @returns {boolean} - True if site requires validation, false otherwise
 */
export async function checkSiteRequiresValidation(site, context) {
  if (!site) {
    return false;
  }
  // LA customers override via env
  let laSiteIds = [];

  if (process.env.LA_VALIDATION_SITE_IDS) {
    laSiteIds = process.env.LA_VALIDATION_SITE_IDS.split(',').map((id) => id.trim()).filter((id) => id.length > 0);
  }
  const siteId = site.getId?.();
  const isLABySite = siteId && laSiteIds.includes(siteId);

  if (isLABySite) {
    return true;
  }

  // Entitlement-driven: require validation only for PAID tier of ASO
  try {
    const tierClient = await TierClient.createForSite(context, site, ASO_PRODUCT_CODE);
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement?.getTier?.() ?? null;
    const productCode = entitlement?.getProductCode?.() ?? null;

    if (tier === Entitlement.TIERS.PAID && productCode === ASO_PRODUCT_CODE) {
      return true;
    }
  } catch (e) {
    context?.log?.warn?.(`Entitlement check failed for site ${site.getId?.()}: ${e.message}`);
  }

  // No PAID ASO entitlement: do not require validation
  return false;
}
