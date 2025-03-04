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
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { AbortController, AbortError } from '@adobe/fetch';

const LINK_TIMEOUT = 3000;
export const CPC_DEFAULT_VALUE = 1;
export const TRAFFIC_MULTIPLIER = 0.01; // 1%
export const MAX_LINKS_TO_CONSIDER = 10;

/**
 * Resolve Cost per click (CPC) value
 *
 * @returns {number} - Cost per click (CPC) Value
 */
export const resolveCpcValue = () => CPC_DEFAULT_VALUE;

/**
 * Calculates KPI deltas based on broken internal links audit data
 * @param {Object} auditData - The audit data containing results
 * @returns {Object} KPI delta calculations
 */
export const calculateKpiDeltasForAudit = (auditData) => {
  const cpcValue = resolveCpcValue();

  const brokenInternalLinks = auditData?.auditResult?.brokenInternalLinks;
  const linksMap = {};

  for (const link of brokenInternalLinks) {
    (linksMap[link.urlTo] = linksMap[link.urlTo] || []).push(link);
  }

  let projectedTrafficLost = 0;

  Object.keys(linksMap).forEach((url) => {
    const links = linksMap[url];
    let linksToBeIncremented;
    // Sort links by traffic domain if there are more than MAX_LINKS_TO_CONSIDER
    // and only consider top MAX_LINKS_TO_CONSIDER for calculating deltas
    if (links.length > MAX_LINKS_TO_CONSIDER) {
      links.sort((a, b) => b.trafficDomain - a.trafficDomain);
      linksToBeIncremented = links.slice(0, MAX_LINKS_TO_CONSIDER);
    } else {
      linksToBeIncremented = links;
    }

    projectedTrafficLost += linksToBeIncremented.reduce(
      (acc, link) => acc + link.trafficDomain * TRAFFIC_MULTIPLIER,
      0,
    );
  });

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LINK_TIMEOUT);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    const { status } = response;

    // Log non-404, non-200 status codes
    if (status >= 400 && status < 500 && status !== 404) {
      log.info(`broken-internal-links audit: Warning: ${url} returned client error: ${status}`);
    }

    // URL is valid if status code is less than 400, otherwise it is invalid
    return status >= 400;
  } catch (error) {
    clearTimeout(timeoutId);
    log.info(`broken-internal-links audit: Error checking ${url}: ${error instanceof AbortError ? `Request timed out after ${LINK_TIMEOUT}ms` : error.message}`);
    // Any error means the URL is inaccessible
    return true;
  }
}
