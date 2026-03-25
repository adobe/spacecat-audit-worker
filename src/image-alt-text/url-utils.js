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

import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { getRUMUrl } from '../support/utils.js';
import { RUM_INTERVAL } from './constants.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

/**
 * Normalizes a URL by ensuring it has an https:// scheme.
 * RUM returns URLs like 'www.example.com/page' without a scheme,
 * while Ahrefs returns full URLs like 'https://example.com/page'.
 * @param {string} url - URL to normalize
 * @returns {string} URL with https:// scheme
 */
function normalizeUrl(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
}

/**
 * Fetches top page URLs using a fallback chain: Ahrefs → RUM → includedURLs.
 * @param {Object} params
 * @param {string} params.siteId - Site ID
 * @param {Object} params.site - Site object
 * @param {Object} params.dataAccess - Data access layer
 * @param {Object} params.context - Lambda context (for RUM client)
 * @param {Object} params.log - Logger
 * @returns {Promise<string[]>} Array of URL strings
 */
export async function getTopPageUrls({
  siteId, site, dataAccess, context, log,
}) {
  const { SiteTopPage } = dataAccess;

  // 1. Try Ahrefs top pages
  const ahrefsPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(siteId, 'ahrefs', 'global');
  if (ahrefsPages.length > 0) {
    log.info(`[${AUDIT_TYPE}]: Found ${ahrefsPages.length} top pages from Ahrefs`);
    return ahrefsPages.map((page) => page.getUrl());
  }

  // 2. Fallback to RUM traffic-acquisition
  log.info(`[${AUDIT_TYPE}]: No Ahrefs top pages, falling back to RUM`);
  try {
    const finalUrl = await getRUMUrl(site.getBaseURL());
    const rumAPIClient = RUMAPIClient.createFrom(context);
    const options = {
      domain: finalUrl,
      interval: RUM_INTERVAL,
    };
    const results = await rumAPIClient.query('traffic-acquisition', options);
    if (results && results.length > 0) {
      const rumUrls = results
        .sort((a, b) => (b.earned || 0) - (a.earned || 0))
        .map((r) => normalizeUrl(r.url));
      log.info(`[${AUDIT_TYPE}]: Found ${rumUrls.length} URLs from RUM`);
      return rumUrls;
    }
  } catch (err) {
    log.warn(`[${AUDIT_TYPE}]: RUM fallback failed: ${err.message}`);
  }

  // 3. Fallback to includedURLs from site config
  log.info(`[${AUDIT_TYPE}]: No URLs from RUM, falling back to includedURLs`);
  const includedURLs = site?.getConfig?.()?.getIncludedURLs('alt-text') || [];
  if (includedURLs.length > 0) {
    log.info(`[${AUDIT_TYPE}]: Found ${includedURLs.length} included URLs from site config`);
    return includedURLs;
  }

  log.warn(`[${AUDIT_TYPE}]: No URLs found from any source (Ahrefs, RUM, includedURLs)`);
  return [];
}
