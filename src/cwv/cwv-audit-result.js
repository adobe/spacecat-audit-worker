/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import RUMAPIClient from '@adobe/spacecat-shared-rum-api-client';
import { Audit, Entitlement } from '@adobe/spacecat-shared-data-access';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { removeTrailingSlash } from '../utils/url-utils.js';
import { isWithinAuditScope } from '../internal-links/subpath-filter.js';
import { getRUMDomain } from '../support/utils.js';

const DAILY_THRESHOLD = 1000; // pageviews
const INTERVAL = 7; // days
// The number of top pages with issues that will be included in the report, by ASO tier.
// Kept low for now since CWV guidance isn't being actively acted on by customers yet -
// no point spending audit/LLM cycles on more pages than that until adoption picks up.
const TOP_PAGES_COUNT_PAID = 10;
const TOP_PAGES_COUNT_PLG = 3;
const HEAD_REQUEST_TIMEOUT_MS = 10000;

/**
 * Performs a HEAD request and returns true ONLY if the URL is genuinely gone
 * (HTTP 404 or 410).
 *
 * CWV candidates come from RUM field data — i.e. real users successfully loaded
 * these pages — so a request that we cannot complete from our infrastructure does
 * NOT mean the page is gone. In particular a 403/401/429 (bot-block / rate-limit),
 * a 5xx, or a timeout/bot-block failure must NOT drop the URL, otherwise a site that
 * bot-blocks our crawler loses ALL of its valid CWV opportunities (see SITES-47218).
 *
 * Two signals are treated as definitively "gone":
 *   1. an HTTP 404/410 status, and
 *   2. a hard network failure where the host cannot be reached at all —
 *      DNS non-resolution (ENOTFOUND) or connection refused (ECONNREFUSED).
 * A hard network failure is distinguished from an ambiguous one (timeout /
 * AbortError / other transient errors), which is kept: this stops a stale RUM
 * entry whose host no longer resolves from re-appearing as a CWV opportunity
 * (the SITES-40803 symptom leaking back through the exception path) while still
 * honouring the SITES-47218 fix for blocked-but-live sites.
 *
 * @param {string} url - The URL to check
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} True only if the URL responds 404 or 410 (gone)
 */
export async function isUrlGone(url, log) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEAD_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Spacecat-Audit/1.0)',
      },
    });
    clearTimeout(timeoutId);
    const { status } = response;
    if (status === 404 || status === 410) {
      log.debug(`[audit-worker-cwv] Skipping URL (gone): ${url} status=${status}`);
      return true;
    }
    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    // A hard network failure — the host does not resolve (ENOTFOUND) or refuses
    // connections (ECONNREFUSED) — is a strong "gone" signal, so skip the URL.
    // (undici wraps the underlying error under `err.cause`, so check both.)
    const code = err.code || err.cause?.code;
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED') {
      log.debug(`[audit-worker-cwv] Skipping URL (unreachable ${code}): ${url}`);
      return true;
    }
    // Ambiguous failure (timeout / AbortError / bot-block). NOT "gone" — keep the
    // URL, because RUM already proves real users load it.
    log.debug(`[audit-worker-cwv] HEAD check inconclusive, keeping URL: ${url} error=${err.message}`);
    return false;
  }
}

/**
 * Checks if a CWV data entry URL matches a site baseURL.
 * Only applies to entries with type 'url' (not 'group').
 * @param {object} data - CWV data entry with type and url properties
 * @param {string} baseURL - Normalized baseURL (without trailing slash) to compare against
 * @returns {boolean} - True if the entry's URL matches the given URL
 */
function isHomepage(data, baseURL) {
  if (data.type !== 'url') {
    return false;
  }
  return removeTrailingSlash(data.url) === baseURL;
}

/**
 * Determines how many top-pages-by-traffic are included in the CWV report, based on the
 * site's ASO entitlement tier. Defaults to the paid limit if the tier can't be determined.
 * @param {Object} context - Context object (needs site, dataAccess and log)
 * @returns {Promise<number>} Top pages count for this site's tier
 */
async function getTopPagesCount(context) {
  const { site, log } = context;
  try {
    const tierClient = await TierClient.createForSite(
      context,
      site,
      Entitlement.PRODUCT_CODES.ASO,
    );
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement?.getTier() ?? null;
    return tier === Entitlement.TIERS.PLG ? TOP_PAGES_COUNT_PLG : TOP_PAGES_COUNT_PAID;
  } catch (err) {
    log.warn(`[audit-worker-cwv] siteId: ${site.getId()} | Failed to determine ASO tier, defaulting to paid top-pages limit: ${err.message}`);
    return TOP_PAGES_COUNT_PAID;
  }
}

/**
 * Builds CWV audit result by collecting and filtering RUM data
 * @param {Object} context - Context object (needs site, finalUrl, env.RUM_ADMIN_KEY and log)
 * @returns {Promise<Object>} Audit result with filtered CWV data
 */
export async function buildCWVAuditResult(context) {
  const { site, finalUrl: auditUrl, log } = context;
  const siteId = site.getId();
  const baseURL = removeTrailingSlash(site.getBaseURL());

  const topPagesCount = await getTopPagesCount(context);
  const rumApiClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);
  const options = {
    // RUM is keyed per hostname; a sub-path auditUrl (e.g. example.com/foo) has no
    // domainkey. Query by hostname; per-URL results are scoped to the base path below.
    domain: getRUMDomain(auditUrl),
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumApiClient.query(Audit.AUDIT_TYPES.CWV, options);

  // SITES-49656: sub-path sites (e.g. example.com/foo) share the domain-keyed RUM
  // query, so scope per-URL entries to the base path before top-N/threshold selection.
  // Root-domain sites and operator-configured `group` entries are unaffected.
  const scopedCwvData = cwvData.filter(
    (item) => item.type !== 'url' || isWithinAuditScope(item.url, baseURL),
  );

  const stats = { homepage: false, topNCount: 0, thresholdCount: 0 };

  // Always include: homepage + top N pages + pages meeting threshold
  const filteredCwvData = [...scopedCwvData]
    .sort((a, b) => b.pageviews - a.pageviews)
    .reduce((list, item) => {
      // 1) Homepage
      if (isHomepage(item, baseURL)) {
        list.push(item);
        stats.homepage = true;
        return list;
      }

      // 2) Top N by pageviews (excluding homepage)
      if (stats.topNCount < topPagesCount) {
        list.push(item);
        stats.topNCount += 1;
        return list;
      }

      // 3) Threshold group (pages meeting threshold, excluding homepage and topN)
      if (item.pageviews >= DAILY_THRESHOLD * INTERVAL) {
        list.push(item);
        stats.thresholdCount += 1;
      }

      return list;
    }, []);

  log.info(
    `[audit-worker-cwv] siteId: ${siteId} | baseURL: ${baseURL} | Total=${cwvData.length}, Scoped=${scopedCwvData.length}, Reported=${filteredCwvData.length} | `
    + `Homepage: ${stats.homepage ? 'included' : 'not included'} | `
    + `Top${topPagesCount} pages: ${stats.topNCount} | `
    + `Pages above threshold: ${stats.thresholdCount}`,
  );

  // Exclude only URL entries that are genuinely gone (404/410). A bot-block (403)
  // or transient failure must NOT drop a URL — CWV is RUM field data, so the page
  // is live for real users (SITES-47218). Group entries are never HEAD-checked.
  const urlEntries = filteredCwvData.filter((entry) => entry.type === 'url');
  const goneFlags = await Promise.all(
    urlEntries.map((entry) => isUrlGone(entry.url, log)),
  );
  const urlsToSkip = new Set(
    urlEntries.filter((_, i) => goneFlags[i]).map((e) => e.url),
  );

  const afterGoneFilter = filteredCwvData.filter(
    (entry) => entry.type !== 'url' || !urlsToSkip.has(entry.url),
  );
  if (urlsToSkip.size > 0) {
    log.info(
      `[audit-worker-cwv] siteId: ${siteId} | Excluded ${urlsToSkip.size} URL(s) (404/410 gone): ${[...urlsToSkip].join(', ')}`,
    );
  }

  return {
    auditResult: {
      cwv: afterGoneFilter,
      auditContext: {
        interval: INTERVAL,
      },
    },
    fullAuditRef: auditUrl,
  };
}
