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
 * General utilities for the Prerender audit.
 */

import { Entitlement } from '@adobe/spacecat-shared-data-access';
import { TierClient } from '@adobe/spacecat-shared-tier-client';

/**
 * Checks if the site belongs to a paid LLMO customer
 * @param {Object} context - Context with site, dataAccess and log
 * @returns {Promise<boolean>} - True if paid LLMO customer, false otherwise
 */
export async function isPaidLLMOCustomer(context) {
  const { site, log } = context;
  try {
    // Check for LLMO product code entitlement
    const tierClient = await TierClient.createForSite(
      context,
      site,
      Entitlement.PRODUCT_CODES.LLMO,
    );
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement.getTier() ?? null;
    const isPaid = tier === Entitlement.TIERS.PAID;

    log.debug(`Prerender - isPaidLLMOCustomer check: siteId=${site.getId()}, tier=${tier}, isPaid=${isPaid}`);
    return isPaid;
  } catch (e) {
    log.warn(`Prerender - Failed to check paid LLMO customer status for siteId=${site.getId()}: ${e.message}`);
    return false;
  }
}
