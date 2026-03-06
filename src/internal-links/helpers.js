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
import { createAuditLogger } from '../common/context-logger.js';

const AUDIT_TYPE = 'broken-internal-links';

// 5s timeout handles slow pages while avoiding false positives
// Batching allows longer timeouts without Lambda timeout risk
const LINK_TIMEOUT = 5000;
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
 * @param {Array} brokenInternalLinks - Array of broken link objects
 * @returns {Object} KPI delta calculations
 */
export const calculateKpiDeltasForAudit = (brokenInternalLinks) => {
  const cpcValue = resolveCpcValue();

  const linksMap = {};

  for (const link of brokenInternalLinks) {
    (linksMap[link.urlTo] = linksMap[link.urlTo] || []).push(link);
  }

  let projectedTrafficLost = 0;

  Object.keys(linksMap).forEach((url) => {
    const links = linksMap[url];
    let linksToBeIncremented;
    // For many links to same URL, only consider top MAX_LINKS_TO_CONSIDER by traffic
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
 * Checks if an error is a timeout error
 * @param {Error} error - The error to check
 * @returns {boolean} True if it's a timeout error
 */
function isTimeoutError(error) {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code?.toLowerCase() || '';
  return message.includes('timeout')
    || message.includes('etimedout')
    || code.includes('timeout')
    || code === 'etimedout'
    || code === 'esockettimedout';
}

/**
 * Checks if a URL points to a static asset
 * @param {string} url - The URL to check
 * @returns {boolean} True if it's a static asset (image, SVG, CSS, JS, etc.)
 */
function isStaticAsset(url) {
  return /\.(svg|png|jpe?g|gif|webp|css|js|ico|woff2?)(\?.*)?$/i.test(url);
}

/**
 * Checks a link using HEAD request (faster than GET)
 * @param {string} url - The URL to check
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean|null>} True if broken, false if accessible, null if inconclusive
 */
async function checkLinkWithHead(url, log) {
  try {
    const headResponse = await fetch(url, {
      method: 'HEAD',
      timeout: LINK_TIMEOUT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0',
      },
    });
    const { status } = headResponse;

    if (status < 400) {
      return false;
    }

    if (status === 404) {
      log.info(`✗ BROKEN LINK FOUND: ${url} (HEAD ${status})`);
      return true;
    }

    // For auth errors (401, 403), return null to trigger GET verification
    return null;
  } catch (headError) {
    // Timeout could be rate limiting, treat as accessible
    if (isTimeoutError(headError)) {
      log.info(`⏱ TIMEOUT: ${url} (HEAD request timed out after ${LINK_TIMEOUT}ms, assuming accessible)`);
      return false;
    }

    return null;
  }
}

/**
 * Checks a link using GET request
 * @param {string} url - The URL to check
 * @param {boolean} isAsset - Whether the URL is a static asset
 * @param {Object} log - Logger instance
 * @returns {Promise<boolean>} True if broken, false if accessible
 */
async function checkLinkWithGet(url, isAsset, log) {
  try {
    const getHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0',
    };

    // For assets, request only 1 byte to avoid full download
    if (isAsset) {
      getHeaders.Range = 'bytes=0-0';
    }

    const getResponse = await fetch(url, {
      method: 'GET',
      timeout: LINK_TIMEOUT,
      headers: getHeaders,
    });
    const { status } = getResponse;

    if (status < 400) {
      return false;
    }

    if (status >= 400 && status < 500 && status !== 404) {
      log.warn(`⚠ WARNING: ${url} returned client error ${status}`);
    }

    const isBroken = status === 404;
    if (isBroken) {
      log.info(`✗ BROKEN LINK FOUND: ${url} (GET ${status})`);
    }
    return isBroken;
  } catch (getError) {
    if (isTimeoutError(getError)) {
      log.info(`⏱ TIMEOUT: ${url} (GET request timed out after ${LINK_TIMEOUT}ms, assuming accessible)`);
      return false;
    }

    let errorMessage = getError.message || 'Unknown error';

    if (getError.code) {
      errorMessage = `${getError.code}: ${errorMessage}`;
    }
    if (getError.type) {
      errorMessage = `${getError.type} - ${errorMessage}`;
    }
    if (getError.errno) {
      errorMessage = `${errorMessage} (errno: ${getError.errno})`;
    }

    log.error(`✗ BROKEN LINK FOUND: ${url} (ERROR: ${errorMessage})`);
    return true;
  }
}

/**
 * Checks if a URL is inaccessible by attempting to fetch it.
 * Returns true only when statusCode is 404 or GET request throws (network/other error).
 * Other 4xx (401, 403, 410) and 5xx are not reported as broken; timeouts are treated as accessible.
 *
 * Strategy: HEAD first (faster), fallback to GET if inconclusive.
 * Static assets skip HEAD (often fail) and use GET with Range header.
 *
 * @param {string} url - The URL to validate
 * @param {Object} baseLog - Base logger object
 * @param {string} siteId - Site ID for logging context
 * @returns {Promise<boolean>} True if inaccessible, false if accessible
 */
export async function isLinkInaccessible(url, baseLog, siteId) {
  const log = createAuditLogger(baseLog, AUDIT_TYPE, siteId);

  // Validate URL as it appears on the page (no path encoding rewrite).
  // Rewriting %20→hyphen would hide broken canonicals that point to the wrong URL.
  const isAsset = isStaticAsset(url);

  // Static assets often fail HEAD, so skip to GET with Range header
  if (!isAsset) {
    const headResult = await checkLinkWithHead(url, log);
    if (headResult !== null) {
      return headResult;
    }
  }

  return checkLinkWithGet(url, isAsset, log);
}

/**
 * Classifies links into priority categories based on traffic.
 * High: top 25%, Medium: next 25%, Low: bottom 50%
 * @param {Array} links - Array of objects with trafficDomain property
 * @returns {Array} - Links sorted by trafficDomain (descending) with priority classifications
 */
export function calculatePriority(links) {
  // Sort links by trafficDomain in descending order (handle undefined/null)
  const sortedLinks = [...links].sort((a, b) => (b.trafficDomain || 0) - (a.trafficDomain || 0));

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
