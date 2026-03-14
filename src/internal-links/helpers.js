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
import { createAuditLogger, isContextLogger } from '../common/context-logger.js';

const AUDIT_TYPE = 'broken-internal-links';

// 5s timeout handles slow pages while avoiding false positives
// Batching allows longer timeouts without Lambda timeout risk
const LINK_TIMEOUT = 5000;
export const CPC_DEFAULT_VALUE = 1;
export const TRAFFIC_MULTIPLIER = 0.01; // 1%
export const MAX_LINKS_TO_CONSIDER = 10;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0';
export const STATUS_BUCKETS = {
  NOT_FOUND_404: 'not_found_404',
  GONE_410: 'gone_410',
  FORBIDDEN_OR_BLOCKED: 'forbidden_or_blocked',
  SERVER_ERROR_5XX: 'server_error_5xx',
  TIMEOUT_OR_NETWORK: 'timeout_or_network',
  REDIRECT_CHAIN_EXCESSIVE: 'redirect_chain_excessive',
  SOFT_404: 'soft_404',
  MASKED_BY_LINKCHECKER: 'masked_by_linkchecker',
};

/**
 * Resolve Cost per click (CPC) value
 *
 * @returns {number} - Cost per click (CPC) Value
 */
export const resolveCpcValue = () => CPC_DEFAULT_VALUE;

function getUserAgent() {
  return process.env.BROKEN_LINKS_USER_AGENT || DEFAULT_USER_AGENT;
}

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

function isRedirectChainError(error) {
  const message = error?.message?.toLowerCase() || '';
  const code = error?.code?.toLowerCase() || '';
  return (
    message.includes('redirect')
    && (
      message.includes('too many')
      || message.includes('maximum')
      || message.includes('max')
    )
  ) || code.includes('redirect');
}

export function classifyStatusBucket(status, error = null) {
  if (error) {
    if (isTimeoutError(error)) return STATUS_BUCKETS.TIMEOUT_OR_NETWORK;
    if (isRedirectChainError(error)) return STATUS_BUCKETS.REDIRECT_CHAIN_EXCESSIVE;
    return STATUS_BUCKETS.TIMEOUT_OR_NETWORK;
  }

  if (status === 404) return STATUS_BUCKETS.NOT_FOUND_404;
  if (status === 410) return STATUS_BUCKETS.GONE_410;
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return STATUS_BUCKETS.FORBIDDEN_OR_BLOCKED;
  }
  if (status === 408) return STATUS_BUCKETS.TIMEOUT_OR_NETWORK;
  if (status >= 500) return STATUS_BUCKETS.SERVER_ERROR_5XX;

  return null;
}

/**
 * Checks if a URL points to a static asset
 * @param {string} url - The URL to check
 * @returns {boolean} True if it's a static asset (image, SVG, CSS, JS, etc.)
 */
function isStaticAsset(url) {
  return /\.(svg|png|jpe?g|gif|webp|avif|css|js|ico|woff2?|ttf|otf|eot|pdf|mp4|webm|mp3|ogg)(\?.*)?$/i.test(url);
}

function shouldInspectForSoft404(contentType, isAsset) {
  /* c8 ignore next - Defensive fallback for null/undefined contentType */
  return !isAsset && /^text\/html\b|^application\/xhtml\+xml\b/i.test(contentType || '');
}

function isSoft404Text(bodyText) {
  /* c8 ignore next - Defensive fallback for null/undefined bodyText */
  const text = String(bodyText || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!text) {
    return false;
  }

  const normalizedText = text.slice(0, 12000);

  return [
    /404 not found/,
    /page not found/,
    /not found/,
    /the page you (requested|are looking for).{0,40}(could not be found|does not exist|is unavailable)/,
    /sorry[, ]+we (couldn'?t|can'?t) find/,
    /sorry[, ]+the page.{0,40}(could not be found|does not exist|is unavailable)/,
    /we can'?t seem to find the page/,
    /this page no longer exists/,
    /the requested url was not found/,
    /error 404/,
    /seite nicht gefunden/,
    /page introuvable/,
    /page non trouv[ée]e/,
    /p[áa]gina no encontrada/,
    /pagina non trovata/,
    /p[áa]gina n[ãa]o encontrada/,
    /pagina niet gevonden/,
    /ページが見つかりません/,
  ].some((pattern) => pattern.test(normalizedText));
}

async function releaseResponseBody(response, log, requestLabel) {
  if (!response) return;

  /* c8 ignore start - Runtime-specific response body cleanup */
  try {
    if (typeof response.body?.cancel === 'function') {
      await response.body.cancel();
      return;
    }

    if (typeof response.arrayBuffer === 'function') {
      await response.arrayBuffer();
    }
  } catch (error) {
    log.debug(`Failed to release ${requestLabel} response body: ${error.message}`);
  }
  /* c8 ignore stop */
}

/**
 * Checks a link using HEAD request (faster than GET)
 * @param {string} url - The URL to check
 * @param {Object} log - Logger instance
 * @returns {Promise<Object|null>} Result object with metadata, or null if inconclusive
 */
async function checkLinkWithHead(url, log) {
  let headResponse;
  try {
    headResponse = await fetch(url, {
      method: 'HEAD',
      timeout: LINK_TIMEOUT,
      headers: {
        'User-Agent': getUserAgent(),
      },
    });
    const { status } = headResponse;
    const contentType = headResponse.headers.get('content-type') || null;
    const statusBucket = classifyStatusBucket(status);

    if (status === 405) {
      return null;
    }

    if (statusBucket === null) {
      return {
        isBroken: false, httpStatus: status, statusBucket: null, contentType,
      };
    }

    if (statusBucket !== STATUS_BUCKETS.FORBIDDEN_OR_BLOCKED) {
      log.info(`✗ BROKEN LINK FOUND: ${url} (HEAD ${status}, bucket=${statusBucket})`);
      return {
        isBroken: true, httpStatus: status, statusBucket, contentType,
      };
    }

    // For auth errors, return null to trigger GET verification before classifying.
    return null;
  } catch (headError) {
    return null;
  /* c8 ignore next 2 - Finally branch always runs; c8 tracks try/catch path split */
  } finally {
    await releaseResponseBody(headResponse, log, 'HEAD');
  }
}

/**
 * Checks a link using GET request
 * @param {string} url - The URL to check
 * @param {boolean} isAsset - Whether the URL is a static asset
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Result object with metadata
 */
async function checkLinkWithGet(url, isAsset, log) {
  let getResponse;
  try {
    const getHeaders = {
      'User-Agent': getUserAgent(),
    };

    // For assets, request only 1 byte to avoid full download
    if (isAsset) {
      getHeaders.Range = 'bytes=0-0';
    }

    getResponse = await fetch(url, {
      method: 'GET',
      timeout: LINK_TIMEOUT,
      headers: getHeaders,
    });
    const { status } = getResponse;
    const contentType = getResponse.headers.get('content-type') || null;
    const statusBucket = classifyStatusBucket(status);

    if (statusBucket === null && status === 200 && shouldInspectForSoft404(contentType, isAsset)) {
      const responseText = await getResponse.text();
      if (isSoft404Text(responseText)) {
        log.info(`✗ BROKEN LINK FOUND: ${url} (GET ${status}, bucket=${STATUS_BUCKETS.SOFT_404})`);
        return {
          isBroken: true, httpStatus: status, statusBucket: STATUS_BUCKETS.SOFT_404, contentType,
        };
      }
    }

    if (statusBucket === null) {
      return {
        isBroken: false, httpStatus: status, statusBucket: null, contentType,
      };
    }

    return {
      isBroken: true, httpStatus: status, statusBucket, contentType,
    };
  } catch (getError) {
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

    const statusBucket = classifyStatusBucket(null, getError);
    log.error(`✗ BROKEN LINK FOUND: ${url} (ERROR: ${errorMessage}, bucket=${statusBucket})`);
    return {
      isBroken: true, httpStatus: null, statusBucket, contentType: null,
    };
  /* c8 ignore next 2 - Finally branch always runs; c8 tracks try/catch path split */
  } finally {
    await releaseResponseBody(getResponse, log, 'GET');
  }
}

/**
 * Checks if a URL is inaccessible by attempting to fetch it.
 * Returns validation metadata for SEO-relevant broken conditions including:
 * 404, 410, blocked/forbidden, 5xx, timeouts/network failures, and excessive redirects.
 *
 * Strategy: HEAD first (faster), fallback to GET if inconclusive.
 * Static assets skip HEAD (often fail) and use GET with Range header.
 *
 * @param {string} url - The URL to validate
 * @param {Object} baseLog - Base logger object
 * @param {string} siteId - Site ID for logging context
 * @returns {Promise<Object>} Validation result with
 *   { isBroken, httpStatus, statusBucket, contentType }
 */
export async function isLinkInaccessible(url, baseLog, siteId, auditId = null) {
  const log = isContextLogger(baseLog)
    ? baseLog
    : createAuditLogger(baseLog, AUDIT_TYPE, siteId, auditId);

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
