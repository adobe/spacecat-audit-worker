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

const LINK_TIMEOUT = 3000; // 3 seconds
const MAX_LINKS_TO_CONSIDER = 10;
const TRAFFIC_MULTIPLIER = 0.1;

/**
 * Resolves the CPC (Cost Per Click) value for KPI calculations
 * @returns {number} The CPC value
 */
export const resolveCpcValue = () => 1.0; // Default value, can be configured

/**
 * Calculates KPI deltas based on broken external links audit data
 * @param {Object} auditData - The audit data containing results
 * @returns {Object} KPI delta calculations
 */
export const calculateKpiDeltasForAudit = (brokenExternalLinks) => {
  const cpcValue = resolveCpcValue();

  // Sort all links by traffic domain in descending order
  const sortedLinks = [...brokenExternalLinks].sort((a, b) => b.trafficDomain - a.trafficDomain);

  // Take only the top MAX_LINKS_TO_CONSIDER links
  const topLinks = sortedLinks.slice(0, MAX_LINKS_TO_CONSIDER);

  // Calculate projected traffic lost
  const projectedTrafficLost = topLinks.reduce(
    (acc, link) => acc + link.trafficDomain * TRAFFIC_MULTIPLIER,
    0,
  );

  return {
    projectedTrafficLost: Math.round(projectedTrafficLost),
    projectedTrafficValue: Math.round(projectedTrafficLost * cpcValue),
  };
};

/**
 * Checks if a URL is inaccessible/not reachable by attempting to fetch it.
 * A URL is considered inaccessible if:
 * - The fetch request fails (network errors or timeouts)
 * - The response status code is >= 400 (400-499)
 * The check will timeout after LINK_TIMEOUT milliseconds.
 * Non-404 client errors (400-499) will log a warning.
 * All errors (network, timeout etc) will log an error and return true.
 * @param {string} url - The URL to validate
 * @returns {Promise<boolean>} True if the URL is inaccessible, times out, or errors
 * false if reachable/accessible
 */
export async function isLinkInaccessible(url, log) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      timeout: LINK_TIMEOUT,
    });
    const { status } = response;

    if (status === 404) {
      log.warn(`Client error (404) for URL: ${url}`);
    } else if (status >= 400 && status < 500) {
      log.warn(`Client error (${status}) for URL: ${url}`);
    } else if (status >= 500) {
      log.error(`Server error (${status}) for URL: ${url}`);
    }

    return status >= 400;
  } catch {
    log.error(`Error checking URL: ${url}`);
    return true;
  }
}

/**
 * Classifies links into priority categories based on views
 * High: top 25%, Medium: next 25%, Low: bottom 50%
 * @param {Array} links - Array of objects with views property
 * @returns {Array} - Links with priority classifications included
 */
export function calculatePriority(links) {
  // Sort links by views in descending order
  const sortedLinks = [...links].sort((a, b) => b.views - a.views);

  // Calculate indices for the 25% and 50% marks
  const quarterIndex = Math.ceil(sortedLinks.length * 0.25);
  const halfIndex = Math.ceil(sortedLinks.length * 0.5);

  // Map through sorted links and assign priority
  return sortedLinks.map((link, index) => {
    let priority;

    if (index < quarterIndex) {
      priority = 'high';
    } else if (index < halfIndex) {
      priority = 'medium';
    } else {
      priority = 'low';
    }

    return {
      ...link,
      priority,
    };
  });
}
