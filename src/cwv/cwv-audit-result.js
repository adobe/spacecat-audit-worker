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
 * Performs a HEAD request to the URL and returns true if the response is 4xx
 * or if the request fails (timeout/network). Used to skip such URLs from CWV opportunities.
 * @param {string} url - The URL to check
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} True if URL should be skipped (4xx or request failed)
 */
export async function isUrl4xxOrFailed(url, log) {
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
    if (status >= 400 && status < 500) {
      log.debug(`[audit-worker-cwv] Skipping URL (4xx): ${url} status=${status}`);
      return true;
    }
    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    log.debug(`[audit-worker-cwv] Skipping URL (HEAD failed): ${url} error=${err.message}`);
    return true;
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
  if (data.type !== 'url') return false;
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

  // Exclude URL entries that return 4xx or HEAD failed from becoming opportunities
  const urlEntries = filteredCwvData.filter((entry) => entry.type === 'url');
  const skipFlags = await Promise.all(
    urlEntries.map((entry) => isUrl4xxOrFailed(entry.url, log)),
  );
  const urlsToSkip = new Set(
    urlEntries.filter((_, i) => skipFlags[i]).map((e) => e.url),
  );
  const after4xxFilter = filteredCwvData.filter(
    (entry) => entry.type !== 'url' || !urlsToSkip.has(entry.url),
  );
  if (urlsToSkip.size > 0) {
    log.info(
      `[audit-worker-cwv] siteId: ${siteId} | Excluded ${urlsToSkip.size} URL(s) (4xx or HEAD failed): ${[...urlsToSkip].join(', ')}`,
    );
  }

  return {
    auditResult: {
      cwv: after4xxFilter,
      auditContext: {
        interval: INTERVAL,
      },
    },
    fullAuditRef: auditUrl,
  };
}
