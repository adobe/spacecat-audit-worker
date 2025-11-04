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
    context?.log?.debug?.('sugandhg - checkSiteRequiresValidation: no site provided, return false');
    return false;
  }
  // Check if the site has the requiresValidation flag set directly
  if (typeof site.requiresValidation === 'boolean') {
    context?.log?.debug?.('sugandhg - checkSiteRequiresValidation: explicit flag present on site', {
      siteId: site.getId?.(),
      requiresValidation: site.requiresValidation,
    });
    return site.requiresValidation;
  }

  // Entitlement-driven: require validation only for PAID tier of ASO
  try {
    context?.log?.debug?.('sugandhg - checkSiteRequiresValidation: calling TierClient.createForSite', {
      siteId: site.getId?.(),
      productCode: 'ASO',
    });
    const tierClient = await TierClient.createForSite(context, site, 'ASO');
    const { entitlement } = await tierClient.checkValidEntitlement();
    context?.log?.debug?.('sugandhg - Entitlement check result', {
      hasEntitlement: Boolean(entitlement),
      tier: entitlement?.tier ?? null,
    });
    if (entitlement?.tier === 'PAID') {
      context?.log?.info?.('sugandhg - checkSiteRequiresValidation: PAID entitlement for ASO, returning true (requires validation)', {
        siteId: site.getId?.(),
        tier: entitlement?.tier ?? null,
      });
      return true;
    }
  } catch (e) {
    context?.log?.warn?.(`sugandhg - Entitlement check failed for site ${site.getId?.()}: ${e.message}`);
  }

  // No PAID ASO entitlement: do not require validation
  context?.log?.info?.('sugandhg - checkSiteRequiresValidation: no PAID ASO entitlement, returning false (no validation required)', {
    siteId: site.getId?.(),
  });
  return false;
}
