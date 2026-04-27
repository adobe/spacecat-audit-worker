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
 * Brand resolution helpers for offsite audits that emit messages to Mystique.
 *
 * Mirrors the v2 brand-resolution logic used in `llmo-customer-analysis/handler.js`:
 * looks up the active brand for the site's organization, preferring the brand whose
 * `site_id` (baseSiteId) column matches the audit site, and falling back to the
 * `brand_sites` join. Returns `null` on any failure or miss so callers can omit
 * brand-scoped fields and preserve backwards compatibility.
 */

const LOG_PREFIX = '[brand-resolver]';

/**
 * Resolve the active brand for a site via PostgREST.
 *
 * @param {object} context - Lambda context (uses `dataAccess.services.postgrestClient`, `log`)
 * @param {object} site - Site model (uses `getId()` and `getOrganizationId()`)
 * @returns {Promise<{brandId: string, brandSiteId: string} | null>}
 *   `null` when the brand cannot be resolved (no org id, no client, no match, query throws).
 */
export async function resolveBrandForSite(context, site) {
  const { log, dataAccess } = context || {};
  const orgId = site?.getOrganizationId?.();
  const siteId = site?.getId?.();

  if (!orgId || !siteId) {
    log?.debug?.(`${LOG_PREFIX} skipped: missing orgId or siteId`);
    return null;
  }

  const postgrestClient = dataAccess?.services?.postgrestClient;
  if (!postgrestClient?.from) {
    log?.debug?.(`${LOG_PREFIX} skipped: postgrestClient unavailable`);
    return null;
  }

  try {
    const { data: brands } = await postgrestClient
      .from('brands')
      .select('id, site_id, brand_sites(site_id)')
      .eq('organization_id', orgId)
      .eq('status', 'active');

    const baseSiteMatch = brands?.find((b) => b.site_id === siteId);
    const brandSiteMatch = !baseSiteMatch && brands?.find(
      (b) => b.brand_sites?.some((bs) => bs.site_id === siteId),
    );
    const match = baseSiteMatch || brandSiteMatch;

    if (!match) {
      log?.debug?.(`${LOG_PREFIX} no active brand found for site ${siteId} in org ${orgId}`);
      return null;
    }

    const brandSiteId = match.site_id || siteId;
    log?.info?.(`${LOG_PREFIX} resolved brand ${match.id} for site ${siteId} (via ${baseSiteMatch ? 'baseSiteId' : 'brand_sites'})`);
    return { brandId: match.id, brandSiteId };
  } catch (e) {
    log?.warn?.(`${LOG_PREFIX} failed to resolve brand for site ${siteId}: ${e.message}`);
    return null;
  }
}

/**
 * Merge brand-scope fields into a Mystique-bound SQS message envelope.
 *
 * When `brand` is non-null, sets:
 *   - `scopeType: 'brand'`
 *   - `scopeId: brand.brandId`
 *   - `siteId: brand.brandSiteId` (overrides any existing siteId so it is the brand's primary site)
 *
 * When `brand` is null, the message is returned unchanged.
 *
 * @param {object} message - The outbound SQS message
 * @param {{brandId: string, brandSiteId: string} | null} brand
 * @returns {object} A new message object with the scope fields applied (or the input unchanged)
 */
export function withBrandScope(message, brand) {
  if (!brand) {
    return message;
  }
  return {
    ...message,
    siteId: brand.brandSiteId,
    scopeType: 'brand',
    scopeId: brand.brandId,
  };
}
