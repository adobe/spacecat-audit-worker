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

  return {
    auditResult: {
      cwv: filteredCwvData,
      auditContext: {
        interval: INTERVAL,
      },
    },
    fullAuditRef: auditUrl,
  };
}
