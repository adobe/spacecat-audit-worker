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
import { Audit } from '@adobe/spacecat-shared-data-access';
import { removeTrailingSlash } from '../utils/url-utils.js';

const DAILY_THRESHOLD = 1000; // pageviews
const INTERVAL = 7; // days
// The number of top pages with issues that will be included in the report
const TOP_PAGES_COUNT = 15;
const HEAD_REQUEST_TIMEOUT_MS = 10000;

/**
 * Performs a HEAD request and returns true ONLY if the URL is genuinely gone
 * (HTTP 404 or 410).
 *
 * CWV candidates come from RUM field data — i.e. real users successfully loaded
 * these pages — so a request that we cannot complete from our infrastructure does
 * NOT mean the page is gone. In particular a 403/401/429 (bot-block / rate-limit),
 * a 5xx, or a network/timeout failure must NOT drop the URL, otherwise a site that
 * bot-blocks our crawler loses ALL of its valid CWV opportunities (see SITES-47218).
 * Only a definitive "gone" status (404/410) is treated as a reason to skip — which
 * preserves the original intent of filtering out 404/clientlib/sling URLs
 * (SITES-40803) without the over-suppression.
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
    // Transient or blocked (timeout / network / bot-block). NOT "gone" — keep the
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
 * Builds CWV audit result by collecting and filtering RUM data
 * @param {Object} context - Context object (needs site, finalUrl, env.RUM_ADMIN_KEY and log)
 * @returns {Promise<Object>} Audit result with filtered CWV data
 */
export async function buildCWVAuditResult(context) {
  const { site, finalUrl: auditUrl, log } = context;
  const siteId = site.getId();
  const baseURL = removeTrailingSlash(site.getBaseURL());

  const rumApiClient = RUMAPIClient.createFrom(context);
  const groupedURLs = site.getConfig().getGroupedURLs(Audit.AUDIT_TYPES.CWV);
  const options = {
    domain: auditUrl,
    interval: INTERVAL,
    granularity: 'hourly',
    groupedURLs,
  };
  const cwvData = await rumApiClient.query(Audit.AUDIT_TYPES.CWV, options);

  const stats = { homepage: false, topNCount: 0, thresholdCount: 0 };

  // Always include: homepage + top N pages + pages meeting threshold
  const filteredCwvData = [...cwvData]
    .sort((a, b) => b.pageviews - a.pageviews)
    .reduce((list, item) => {
      // 1) Homepage
      if (isHomepage(item, baseURL)) {
        list.push(item);
        stats.homepage = true;
        return list;
      }

      // 2) Top N by pageviews (excluding homepage)
      if (stats.topNCount < TOP_PAGES_COUNT) {
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
    `[audit-worker-cwv] siteId: ${siteId} | baseURL: ${baseURL} | Total=${cwvData.length}, Reported=${filteredCwvData.length} | `
    + `Homepage: ${stats.homepage ? 'included' : 'not included'} | `
    + `Top${TOP_PAGES_COUNT} pages: ${stats.topNCount} | `
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
