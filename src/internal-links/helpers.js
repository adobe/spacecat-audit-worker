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
import {
  createInternalLinksAuditLogger,
  isInternalLinksContextLogger,
} from './logging.js';
import { isHtmlContentType, isSoft404Body } from '../utils/url-utils.js';
import { normalizeComparableUrl, DEFAULT_ITEM_TYPE } from './link-key.js';

const AUDIT_TYPE = 'broken-internal-links';

// 5s timeout handles slow pages while avoiding false positives
// Batching allows longer timeouts without Lambda timeout risk
const LINK_TIMEOUT = 5000;
export const CPC_DEFAULT_VALUE = 1;
export const TRAFFIC_MULTIPLIER = 0.01; // 1%
export const MAX_LINKS_TO_CONSIDER = 10;
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0';
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
    if (isRedirectChainError(error)) {
      return STATUS_BUCKETS.REDIRECT_CHAIN_EXCESSIVE;
    }
    return null;
  }

  if (status === 404) {
    return STATUS_BUCKETS.NOT_FOUND_404;
  }
  if (status === 410) {
    return STATUS_BUCKETS.GONE_410;
  }
  if (status === 401 || status === 403 || status === 429 || status === 451) {
    return STATUS_BUCKETS.FORBIDDEN_OR_BLOCKED;
  }
  if (status === 408) {
    return STATUS_BUCKETS.TIMEOUT_OR_NETWORK;
  }
  if (status >= 500) {
    return STATUS_BUCKETS.SERVER_ERROR_5XX;
  }

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

/**
 * Checks if a URL has a malformed path segment — e.g. "/.html" where the
 * filename is just an extension with no base name. These are CMS artifacts
 * (empty slug + extension) and are not real pages to audit.
 * @param {string} url - The URL to check
 * @returns {boolean} True if the URL path ends with a bare extension segment
 */
function isMalformedPageUrl(url) {
  return /\/\.[a-z0-9]+(\?.*)?(?:#.*)?$/i.test(url);
}

async function releaseResponseBody(response, log, requestLabel) {
  if (!response) {
    return;
  }

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
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Result object with metadata
 */
async function checkLinkWithGet(url, log) {
  let getResponse;
  try {
    getResponse = await fetch(url, {
      method: 'GET',
      timeout: LINK_TIMEOUT,
      headers: {
        'User-Agent': getUserAgent(),
      },
    });
    const { status } = getResponse;
    const contentType = getResponse.headers.get('content-type') || null;
    const statusBucket = classifyStatusBucket(status);

    if (statusBucket === null && status === 200 && isHtmlContentType(contentType)) {
      const responseText = await getResponse.text();
      if (isSoft404Body(responseText)) {
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
    if (statusBucket === null) {
      log.warn(`Skipping inconclusive link validation for ${url} (ERROR: ${errorMessage})`);
      return {
        isBroken: false,
        inconclusive: true,
        httpStatus: null,
        statusBucket: null,
        contentType: null,
      };
    }

    log.error(`✗ BROKEN LINK FOUND: ${url} (ERROR: ${errorMessage}, bucket=${statusBucket})`);
    return {
      isBroken: true, inconclusive: false, httpStatus: null, statusBucket, contentType: null,
    };
  /* c8 ignore next 2 - Finally branch always runs; c8 tracks try/catch path split */
  } finally {
    await releaseResponseBody(getResponse, log, 'GET');
  }
}

/**
 * Checks if a URL is inaccessible by attempting to fetch it.
 * Returns validation metadata for SEO-relevant broken conditions including:
 * 404, 410, blocked/forbidden, 5xx, and excessive redirects.
 * Transport failures are treated as inconclusive so they do not get reported as broken.
 *
 * Strategy: HEAD first (faster), fallback to GET if inconclusive.
 * Static assets are excluded from broken-link detection (not SEO page targets).
 *
 * @param {string} url - The URL to validate
 * @param {Object} baseLog - Base logger object
 * @param {string} siteId - Site ID for logging context
 * @returns {Promise<Object>} Validation result with
 *   { isBroken, inconclusive, httpStatus, statusBucket, contentType }
 */
export async function isLinkInaccessible(url, baseLog, siteId, auditId = null) {
  const log = isInternalLinksContextLogger(baseLog)
    ? baseLog
    : createInternalLinksAuditLogger(baseLog, AUDIT_TYPE, siteId, auditId);

  // Validate URL as it appears on the page (no path encoding rewrite).
  // Rewriting %20→hyphen would hide broken canonicals that point to the wrong URL.
  const isAsset = isStaticAsset(url);

  // Static assets (images, fonts, CSS, JS, etc.) are excluded from broken link detection.
  if (isAsset) {
    return {
      isBroken: false, inconclusive: false, httpStatus: null, statusBucket: null, contentType: null,
    };
  }

  // Malformed URLs (e.g. "/.html" — bare extension, no page name) are CMS artifacts and not
  // real pages. Skip them to avoid false positives.
  if (isMalformedPageUrl(url)) {
    return {
      isBroken: false, inconclusive: false, httpStatus: null, statusBucket: null, contentType: null,
    };
  }

  const headResult = await checkLinkWithHead(url, log);
  if (headResult !== null) {
    return headResult;
  }

  return checkLinkWithGet(url, log);
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

/**
 * Identifies uncorroborated site-wide boilerplate broken *internal links*.
 *
 * Background: the crawl detector reads a link's `href` from the (JS-hydrated) DOM and
 * validates it with a direct HTTP fetch. It cannot execute click handlers, so a
 * template widget (nav/footer) whose anchor carries a same-domain fallback `href` but
 * whose click is intercepted by client-side JS (e.g. it actually navigates cross-domain)
 * is flagged as broken on every page the widget renders on. See SITES-50131: one shared
 * footer "Privacy Notice" button produced 60 of a domain's 184 broken-internal-link
 * suggestions, all pointing at the same fabricated same-domain 404.
 *
 * Heuristic: if the identical `urlTo` is flagged **only** by the crawl detector
 * (`detectionSource === 'crawl'`, i.e. never corroborated by RUM or LinkChecker) across
 * at least `minSourcePages` distinct source pages, it is site-wide boilerplate. When RUM
 * detection produced broken-link signal for this site yet never observed a real
 * navigation to that target, the target is almost certainly never navigated to by users
 * (JS-intercepted or decorative), so the crawl finding is very likely a false positive.
 *
 * This function only CLASSIFIES — it never mutates. The caller decides whether to drop
 * the `suppressed` links or merely record them (shadow mode). Conservative by design
 * (avoids over-flagging genuinely broken template links):
 *  - only runs when `rumProducedBrokenLinks` is true (RUM produced a validated broken
 *    link for this site, so absence of RUM corroboration for this target is meaningful);
 *  - only ever flags `detectionSource === 'crawl'` links — anything RUM/LinkChecker also
 *    saw (`crawl+rum`, `crawl+linkchecker`, ...) is always kept;
 *  - requires the target to repeat across `minSourcePages` distinct pages (true
 *    boilerplate), so a one-off broken link is never affected.
 *
 * NOTE: RUM's broken-link signal is traffic-gated, so a genuinely dead but rarely-clicked
 * footer link (Privacy/Terms/Sitemap) can share this exact signature. Callers should treat
 * suppression as advisory (shadow/observability first) rather than a guaranteed-safe drop.
 *
 * @param {Array} links - merged broken links (each with urlFrom, urlTo, itemType,
 *   detectionSource)
 * @param {object} opts
 * @param {boolean} opts.rumProducedBrokenLinks - whether RUM detection produced at least
 *   one validated broken link for this site
 * @param {number} opts.minSourcePages - min distinct source pages for a target to count as
 *   boilerplate
 * @returns {{kept: Array, suppressed: Array, suppressedTargets: string[]}} partition of the
 *   input links plus the distinct normalized target URLs that were flagged
 */
export function identifyUncorroboratedBoilerplateLinks(
  links,
  { rumProducedBrokenLinks, minSourcePages } = {},
) {
  if (!Array.isArray(links) || links.length === 0 || !rumProducedBrokenLinks) {
    return { kept: links, suppressed: [], suppressedTargets: [] };
  }

  const targetKey = (link) => `${normalizeComparableUrl(link.urlTo)}|${link.itemType || DEFAULT_ITEM_TYPE}`;

  // Count distinct source pages per target among crawl-only links. Links without a real
  // urlTo are skipped so malformed rows can never collapse into a single "undefined" key.
  const sourcePagesByTarget = new Map();
  for (const link of links) {
    if (link.detectionSource !== 'crawl' || !link.urlTo) {
      continue; // eslint-disable-line no-continue
    }
    const key = targetKey(link);
    let pages = sourcePagesByTarget.get(key);
    if (!pages) {
      pages = new Set();
      sourcePagesByTarget.set(key, pages);
    }
    pages.add(normalizeComparableUrl(link.urlFrom));
  }

  const boilerplateTargets = new Set(
    [...sourcePagesByTarget.entries()]
      .filter(([, pages]) => pages.size >= minSourcePages)
      .map(([key]) => key),
  );

  if (boilerplateTargets.size === 0) {
    return { kept: links, suppressed: [], suppressedTargets: [] };
  }

  const kept = [];
  const suppressed = [];
  const suppressedTargets = new Set();
  for (const link of links) {
    if (link.detectionSource === 'crawl' && link.urlTo && boilerplateTargets.has(targetKey(link))) {
      suppressed.push(link);
      suppressedTargets.add(normalizeComparableUrl(link.urlTo));
    } else {
      kept.push(link);
    }
  }

  return { kept, suppressed, suppressedTargets: [...suppressedTargets] };
}
