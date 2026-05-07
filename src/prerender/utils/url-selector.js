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

import { subDays } from 'date-fns';
import { Suggestion } from '@adobe/spacecat-shared-data-access';
import { getTopAgenticLiveUrlsFromAthena } from '../../utils/agentic-urls.js';
import {
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  PRERENDER_RECENT_PROCESSING_TIME_DAYS,
} from './constants.js';
import { findPrerenderOpportunity, findDeployedDomainWideSuggestion } from './opportunity-utils.js';

const LOG_PREFIX = 'Prerender -';

/**
 * Rebases a URL to a new base URL, preserving pathname, search, and hash.
 * @param {string} url - The URL to rebase
 * @param {string} preferredBase - The preferred base URL
 * @param {Object} log - Logger instance
 * @returns {string} The rebased URL
 */
export function rebaseUrl(url, preferredBase, log) {
  try {
    const { pathname, search, hash } = new URL(url);
    return new URL(pathname + search + hash, preferredBase).toString();
  } catch (e) {
    log?.warn?.(`rebaseUrl failed url=${url} base=${preferredBase}: ${e.message}`);
    return url;
  }
}

/**
 * Fetches top organic URLs from the SEO data source.
 * @param {Object} context - Audit context with dataAccess, log, site
 * @param {number} [limit] - Maximum number of URLs to return
 * @returns {Promise<string[]>}
 */
export async function getTopOrganicUrlsFromSeo(context, limit = TOP_ORGANIC_URLS_LIMIT) {
  const { dataAccess, log, site } = context;
  let topPagesUrls = [];
  try {
    const { SiteTopPage } = dataAccess || {};
    if (SiteTopPage?.allBySiteIdAndSourceAndGeo) {
      const topPages = await SiteTopPage.allBySiteIdAndSourceAndGeo(site.getId(), 'seo', 'global');
      topPagesUrls = (topPages || []).map((p) => p.getUrl()).slice(0, limit);
    }
  } catch (error) {
    log.warn(`${LOG_PREFIX} Failed to load top pages for fallback: ${error.message}. baseUrl=${site.getBaseURL()}`);
  }
  return topPagesUrls;
}

/**
 * Fetches top agentic URLs from Athena, returning an empty array on failure.
 * @param {Object} site - Site entity
 * @param {Object} context - Audit context
 * @param {number} [limit] - Maximum number of URLs to return
 * @returns {Promise<string[]>}
 */
export async function getTopAgenticUrls(site, context, limit = TOP_AGENTIC_URLS_LIMIT) {
  try {
    return await getTopAgenticLiveUrlsFromAthena(site, context, limit);
  } catch (e) {
    context.log.warn(`${LOG_PREFIX} Failed to fetch agentic URLs: ${e.message}. baseUrl=${site.getBaseURL()}`);
    return [];
  }
}

/**
 * Returns a Set of URL pathnames whose suggestions are already deployed at the CDN edge
 * (individual `edgeDeployed` timestamp) or covered by an active domain-wide deployment
 * (`coveredByDomainWide` pointing to a domain-wide suggestion that still has `edgeDeployed`).
 * These URLs should be skipped in the scrape batch — re-scraping adds no value and wastes budget.
 * @param {Object} context - Audit context with dataAccess and log
 * @param {string} siteId - Site identifier
 * @returns {Promise<Set<string>>}
 */
export async function getDeployedOrCoveredPathnames(context, siteId) {
  const { dataAccess, log } = context;
  try {
    const opportunity = await findPrerenderOpportunity(dataAccess, siteId);
    if (!opportunity) {
      return new Set();
    }

    const suggestions = await opportunity.getSuggestions();
    const domainWideDeployed = !!findDeployedDomainWideSuggestion(suggestions);

    const pathnames = new Set();
    for (const s of suggestions) {
      const data = s.getData();
      if (s.getStatus() === Suggestion.STATUSES.NEW && data?.url
        && (data.edgeDeployed || (data.coveredByDomainWide && domainWideDeployed))) {
        try {
          const { pathname } = new URL(data.url);
          pathnames.add(pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname);
        } catch { /* skip malformed URLs */ }
      }
    }
    return pathnames;
  } catch (e) {
    log?.warn?.(`${LOG_PREFIX} Failed to load deployed/covered pathnames: ${e.message}. siteId=${siteId}`);
    return new Set();
  }
}

/**
 * Returns pathnames from PageCitability records updated within the configured recent window.
 * @param {Object} context
 * @param {string} siteId
 * @returns {Promise<Set<string>>}
 */
export async function getRecentlyProcessedPathnames(context, siteId) {
  const { dataAccess, log } = context;
  try {
    const { PageCitability } = dataAccess;
    if (!PageCitability?.allByIndexKeys) {
      return new Set();
    }
    const recentWindowStart = subDays(new Date(), PRERENDER_RECENT_PROCESSING_TIME_DAYS);
    const records = await PageCitability.allByIndexKeys(
      { siteId },
      { where: (attrs, op) => op.gte(attrs.updatedAt, recentWindowStart.toISOString()) },
    );
    return new Set(
      records
        .map((r) => {
          try {
            return new URL(r.getUrl()).pathname;
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    );
  } catch (e) {
    log.warn(`${LOG_PREFIX} Failed to load recently-processed pathnames: ${e.message}`);
    return new Set();
  }
}

/**
 * Returns true when the URL's pathname is NOT in the set of recently processed pathnames.
 * URLs that cannot be parsed are treated as not recent (included by default).
 * @param {string} url
 * @param {Set<string>} recentPathnames
 * @returns {boolean}
 */
export function isNotRecentUrl(url, recentPathnames) {
  try {
    return !recentPathnames.has(new URL(url).pathname);
  } catch {
    return true;
  }
}
