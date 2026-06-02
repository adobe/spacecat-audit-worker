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

import { Audit } from '@adobe/spacecat-shared-data-access';
import { getTopAgenticLiveUrlsFromAthena, getPreferredBaseUrl } from '../utils/agentic-urls.js';
import { TOP_AGENTIC_URLS_LIMIT, TOP_ORGANIC_URLS_LIMIT } from './utils/constants.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

function rebaseUrl(url, preferredBase, log) {
  try {
    const { pathname, search, hash } = new URL(url);
    return new URL(pathname + search + hash, preferredBase).toString();
  } catch (e) {
    log?.warn?.(`rebaseUrl failed url=${url} base=${preferredBase}: ${e.message}`);
    return url;
  }
}

async function getTopOrganicUrlsFromSeo(context, limit = TOP_ORGANIC_URLS_LIMIT) {
  const { dataAccess, log, site } = context;
  const preferredBase = getPreferredBaseUrl(site, context);
  try {
    const { SiteTopPage } = dataAccess || {};
    if (SiteTopPage?.allBySiteIdAndSourceAndGeo) {
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
      return (topPages || []).slice(0, limit).map((p) => rebaseUrl(p.getUrl(), preferredBase, log));
    }
  } catch (error) {
    log.warn(`${LOG_PREFIX} Failed to load top pages for fallback: ${error.message}. baseUrl=${site.getBaseURL()}`);
  }
  return [];
}

async function getIncludedURLs(site, context) {
  const urls = (await site?.getConfig?.()?.getIncludedURLs?.(AUDIT_TYPE)) || [];
  const preferredBase = getPreferredBaseUrl(site, context);
  return urls.map((url) => rebaseUrl(url, preferredBase, context.log));
}

async function getTopAgenticUrls(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  try {
    return await getTopAgenticLiveUrlsFromAthena(site, context, limit);
  } catch (e) {
    context.log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs: ${e.message}. baseUrl=${site.getBaseURL()}`);
    return [];
  }
}

/**
 * Fetches raw URLs for all modes, returning a uniform shape consumed by filterUrls.
 *
 * CSV   → rebases auditContext.urls to preferredBase; skips all external fetches.
 * Slack → fetches organic + includedURLs only; no agentic.
 * Normal → fetches organic + includedURLs + agentic.
 *
 * @param {Object} context - Handler context (site, auditContext, dataAccess, log)
 * @param {{ isCsv: boolean, isSlack: boolean }} mode - Resolved execution mode
 * @returns {Promise<{
 *   csvUrls: string[],
 *   topPagesUrls: string[],
 *   agenticUrls: string[],
 *   includedURLs: string[],
 * }>}
 */
export async function fetchUrls(context, mode) {
  const { site, auditContext, log } = context;
  const { isCsv, isSlack } = mode;

  if (isCsv) {
    const preferredBase = getPreferredBaseUrl(site, context);
    const csvUrls = (auditContext.urls || []).map((url) => rebaseUrl(url, preferredBase, log));
    return {
      csvUrls,
      topPagesUrls: [],
      agenticUrls: [],
      includedURLs: [],
    };
  }

  const topPagesUrls = await getTopOrganicUrlsFromSeo(context);
  const includedURLs = await getIncludedURLs(site, context);
  const agenticUrls = isSlack ? [] : await getTopAgenticUrls(site, context);

  return {
    csvUrls: [],
    topPagesUrls,
    agenticUrls,
    includedURLs,
  };
}
