/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * General utilities for the Prerender audit.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { Audit, Entitlement } from '@adobe/spacecat-shared-data-access';
import { TierClient } from '@adobe/spacecat-shared-tier-client';
import { DOMAIN_WIDE_SUGGESTION_KEY } from './constants.js';

const LOG_PREFIX = 'Prerender -';
const AUDIT_TYPE = Audit.AUDIT_TYPES.PRERENDER;

/**
 * Common non-HTML file extensions that should be filtered out
 */
const NON_HTML_EXTENSIONS = new Set([
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv',
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.bmp', '.ico',
  // Media
  '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav', '.ogg',
  // Archives
  '.zip', '.rar', '.tar', '.gz', '.7z',
  // Code/Data
  '.json', '.xml', '.css', '.js', '.ts', '.map',
  // Other
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
]);

/**
 * Checks if a URL points to a non-HTML resource based on file extension
 * @param {string} pathname - The pathname from a URL object
 * @returns {boolean} - True if the URL has a non-HTML extension
 */
function hasNonHtmlExtension(pathname) {
  const lowerPath = pathname.toLowerCase();
  return Array.from(NON_HTML_EXTENSIONS).some((ext) => lowerPath.endsWith(ext));
}

/**
 * Extracts the pathname from a URL string, stripping trailing slashes on non-root paths.
 * Falls back to the raw string when the URL is not parseable (e.g. invalid or relative).
 *
 * @param {string} url
 * @returns {string} pathname, or the original string on parse failure
 */
export function toPathname(url) {
  try {
    const { pathname } = new URL(url);
    return pathname === '/' ? pathname : pathname.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Tracking/marketing query parameter patterns that should not cause two otherwise-identical
 * URLs to be treated as distinct pages (e.g. in RCV suggestion/opportunity dedup keys).
 * Mirrors TRACKING_PARAM_PATTERNS in tokowaka-worker's src/utils/request-utils.js so the audit
 * and the edge worker agree on which query params are tracking-only noise.
 */
const TRACKING_PARAM_PATTERNS = [
  // Google Ads
  /^gad_source$/, // Google Ads click source identifier
  /^gad_campaignid$/, // Google Ads campaign ID (auto-tagging)
  /^gbraid$/, // Google Ads app-to-web attribution (iOS)
  /^wbraid$/, // Google Ads web-to-app attribution (iOS)
  /^gclid$/, // Google Ads click identifier
  /^gclsrc$/, // Google Ads click source type (e.g. aw.ds for Search Ads 360)
  /^dclid$/, // Google Display & Video 360 (DoubleClick) click identifier
  /^srsltid$/, // Google Shopping / Merchant Center result identifier

  // Google Analytics
  /^_gl$/, // Google Analytics cross-domain linker parameter

  // Microsoft Advertising (Bing Ads)
  /^msclkid$/, // Microsoft Advertising click identifier

  // Meta (Facebook / Instagram)
  /^fbclid$/, // Meta (Facebook) click identifier

  // Zanox / Awin (affiliate network)
  /^zanpid$/, // Zanox/Awin affiliate partner click identifier

  // Klaviyo (email marketing)
  /^_kx$/, // Klaviyo email tracking identifier

  // Mailchimp (email marketing)
  /^mc_[a-z]+$/, // Mailchimp campaign tracking params (mc_cid, mc_eid, etc.)

  // Bronto / Oracle (email marketing)
  /^_bta_[a-z]+$/, // Bronto/Oracle email tracking params (_bta_tid, _bta_c, etc.)

  // Cross-platform (Urchin / Google Analytics standard)
  /^utm_[a-z]+$/, // UTM campaign tracking params (utm_source, utm_medium, utm_campaign, etc.)

  // Cache busters (jQuery/AJAX timestamps)
  /^_$/, // jQuery cache-buster param (e.g. ?_=1780463035675)

  // Microsoft Bing session
  /^msockid$/, // Bing/Copilot session identifier (companion to msclkid)

  // Criteo (retargeting ads)
  /^cto_pld$/, // Criteo click payload (read by Criteo OneTag client-side; doesn't affect HTML)
];

/**
 * Removes tracking/marketing query parameters from a URL search string.
 * Returns the search string untouched (including param order) when it contains no tracking
 * params, so non-tracking dedup keys (e.g. CSV-provided `?filter=a` vs `?filter=b`) are
 * never altered.
 * @param {string} search - A URL search string, with or without the leading '?' ('' allowed).
 * @returns {string} The cleaned search string (with leading '?' if any params remain), or ''.
 */
function stripTrackingParams(search) {
  if (!search) {
    return '';
  }
  const params = new URLSearchParams(search);
  const trackingKeys = [...params.keys()]
    .filter((key) => TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key)));
  if (trackingKeys.length === 0) {
    return search;
  }
  trackingKeys.forEach((key) => params.delete(key));
  const cleaned = params.toString();
  return cleaned ? `?${cleaned}` : '';
}

/**
 * Normalizes a URL to its pathname + search string.
 * Trailing slashes on the pathname are removed (except for the root path).
 * Tracking/marketing query parameters (see TRACKING_PARAM_PATTERNS) are stripped so that URLs
 * differing only by tracking params resolve to the same identity/dedup key.
 * Falls back to the raw string when the URL is not parseable.
 * @param {string} url
 * @returns {string} pathname+search, or the original string on parse failure
 */
export function normalizePathnameWithQuery(url) {
  try {
    const { pathname, search } = new URL(url);
    const normalized = (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname).toLowerCase();
    const cleanedSearch = stripTrackingParams(search);
    return cleanedSearch ? `${normalized}${cleanedSearch}` : normalized;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * Builds a dedup key for a prerender suggestion.
 * Domain-wide suggestions (incoming items with `.key` or stored records with
 * `isDomainWide:true`) always return the same constant so that syncSuggestions
 * matches existing domain-wide records instead of creating duplicates.
 * Individual suggestions are keyed by pathname+search.
 * @param {Object} data - Suggestion data or incoming new-data item
 * @returns {string} dedup key
 */
export function buildSuggestionKey(data) {
  if (data.key === DOMAIN_WIDE_SUGGESTION_KEY || data.isDomainWide) {
    return DOMAIN_WIDE_SUGGESTION_KEY;
  }
  return normalizePathnameWithQuery(data.url);
}

/**
 * Merges multiple URL arrays, ensures uniqueness, and filters out non-HTML URLs.
 * By default, deduplicates by pathname only (handles www vs non-www differences).
 * When includeQueryParams is true, query parameters are included in the uniqueness
 * key so that URLs like /page?a=1 and /page?b=2 are treated as distinct — except for
 * tracking/marketing params (see TRACKING_PARAM_PATTERNS), which are stripped from the key
 * so URLs differing only by those (e.g. ?utm_source=a vs ?utm_source=b) still collapse.
 * @param {Array<string>} urlArrays - URL arrays to merge (spread or single array)
 * @param {Object} [options] - Options object (must be last argument)
 * @param {boolean} [options.includeQueryParams=false] - Include query params in dedup key
 * @returns {Object} - Object with unique HTML URLs and filtered count
 *   - urls: Array of unique HTML URLs, preserving original URLs
 *   - filteredCount: Number of non-HTML URLs that were filtered out
 */
export function mergeAndGetUniqueHtmlUrls(...args) {
  const lastArg = args[args.length - 1];
  const hasOptions = lastArg && !Array.isArray(lastArg) && typeof lastArg === 'object';
  const { includeQueryParams = false } = hasOptions ? lastArg : {};
  const urlArrays = hasOptions ? args.slice(0, -1) : args;

  const seenKeys = new Set();
  const uniqueUrls = [];
  let filteredCount = 0;

  // Flatten all arrays and process each URL
  urlArrays.flat().forEach((url) => {
    try {
      const urlObj = new URL(url);
      const { pathname } = urlObj;

      // Skip non-HTML URLs
      if (hasNonHtmlExtension(pathname)) {
        filteredCount += 1;
        return;
      }

      // Normalize path by removing all trailing slashes (except for root path)
      let dedupKey = pathname;
      if (dedupKey.length > 1) {
        dedupKey = dedupKey.replace(/\/+$/, ''); // Remove all trailing slashes
      }

      // Include the query string in the dedup key when requested, so the user gets exactly
      // what they passed in the CSV. Tracking/marketing params are stripped first so that
      // e.g. ?utm_source=a vs ?utm_source=b still collapse to the same page.
      if (includeQueryParams && urlObj.search) {
        dedupKey += stripTrackingParams(urlObj.search);
      }

      // Only add URL if we haven't seen this key before
      if (!seenKeys.has(dedupKey)) {
        seenKeys.add(dedupKey);
        uniqueUrls.push(url); // Keep original URL unchanged
      }
    } catch (error) {
      // If URL parsing fails, add it anyway (edge case handling)
      uniqueUrls.push(url);
    }
  });

  return {
    urls: uniqueUrls,
    filteredCount,
  };
}

// Statuses considered active/preservable for path suggestions
const PRESERVABLE_STATUSES = ['NEW', 'FIXED', 'PENDING_VALIDATION', 'SKIPPED'];
// Statuses of per-URL suggestions eligible for path scoring.
// FIXED is intentionally included: a FIXED URL was edge-deployed individually.
// Scoring over both NEW and FIXED lets us suggest a path rule (e.g. /products/*)
// that consolidates those individual deployments into a single pattern, reducing
// operational overhead and ensuring new URLs under the same path are covered
// automatically — even when many of the contributing URLs are already resolved.
const ELIGIBLE_STATUSES = new Set(['NEW', 'FIXED']);

/**
 * Detects a path-level suggestion by the presence of allowedRegexPatterns
 * without isDomainWide.
 *
 * @param {Object} data - Suggestion data object
 * @returns {boolean}
 */
export function isPathSuggestionData(data) {
  return Array.isArray(data?.allowedRegexPatterns) && !data?.isDomainWide;
}

/**
 * Checks if a suggestion's data represents a domain-wide suggestion.
 *
 * @param {Object} data - Suggestion data object
 * @returns {boolean}
 */
export function isDomainWideSuggestionData(data) {
  return !!data?.isDomainWide;
}

/**
 * Extracts the first-segment path pattern from a URL, relative to the site's base URL.
 *
 * When a baseUrl with a path prefix is provided, the prefix is stripped before
 * determining the first meaningful segment. The returned pattern is always absolute
 * (relative to the origin), so it can be used directly as a CDN path rule.
 *
 * Examples (baseUrl = 'https://nba.com/kings'):
 *   https://nba.com/kings/products/shoes  →  /kings/products/*
 *   https://nba.com/kings/                →  null  (root of base, no further segment)
 *
 * Examples (no baseUrl):
 *   https://example.com/products/shoes    →  /products/*
 *   https://example.com/                  →  null
 *
 * @param {string} url
 * @param {string} [baseUrl=''] - Site base URL; its pathname prefix is stripped before
 *   extracting the first segment.
 * @returns {string|null}
 */
export function extractPathType(url, baseUrl = '') {
  try {
    const { pathname } = new URL(url);
    let basePath = '';
    if (baseUrl) {
      const basePathname = new URL(baseUrl).pathname;
      basePath = basePathname === '/' ? '' : basePathname.replace(/\/$/, '');
    }
    const relative = basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
      ? pathname.slice(basePath.length) || '/'
      : pathname;
    const parts = relative.split('/').filter(Boolean);
    if (parts.length === 0) {
      return null;
    }
    return `${basePath}/${parts[0]}/*`;
  } catch {
    return null;
  }
}

/**
 * Determines if an existing path suggestion should be preserved across re-audits.
 *
 * @param {Object} suggestion - Suggestion entity
 * @returns {boolean}
 */
export function shouldPreservePathSuggestion(suggestion) {
  const status = suggestion.getStatus();
  const data = suggestion.getData();
  return PRESERVABLE_STATUSES.includes(status) || !!data?.edgeDeployed;
}

/**
 * Checks if a suggestion has an eligible status for path scoring.
 *
 * @param {string} status
 * @returns {boolean}
 */
export function isEligibleStatus(status) {
  return ELIGIBLE_STATUSES.has(status);
}

/**
 * Checks if the site belongs to a paid LLMO customer
 * @param {Object} context - Context with site, dataAccess and log
 * @returns {Promise<boolean>} - True if paid LLMO customer, false otherwise
 */
export async function isPaidLLMOCustomer(context) {
  const { site, log } = context;
  try {
    // Check for LLMO product code entitlement
    const tierClient = await TierClient.createForSite(
      context,
      site,
      Entitlement.PRODUCT_CODES.LLMO,
    );
    const { entitlement } = await tierClient.checkValidEntitlement();
    const tier = entitlement.getTier() ?? null;
    const isPaid = tier === Entitlement.TIERS.PAID;

    log.debug(`Prerender - isPaidLLMOCustomer check: siteId=${site.getId()}, tier=${tier}, isPaid=${isPaid}`);
    return isPaid;
  } catch (e) {
    log.warn(`Prerender - Failed to check paid LLMO customer status for siteId=${site.getId()}: ${e.message}`);
    return false;
  }
}

/**
 * Sanitizes the import path by replacing special characters with hyphens
 * @param {string} importPath - The path to sanitize
 * @returns {string} The sanitized path
 */
function sanitizeImportPath(importPath) {
  return importPath
    .replace(/^\/+|\/+$/g, '')
    .replace(/[/._?=&]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
* Transforms a URL into an S3 path for a given identifier and file type.
* The identifier can be either a scrape job id or a site id.
* @param {string} url - The URL to transform
* @param {string} id - The identifier - scrapeJobId
* @param {string} fileName - The file name (e.g., 'scrape.json', 'server-side.html',
* 'client-side.html')
* @returns {string} The S3 path to the file
*/
export function getS3Path(url, id, fileName) {
  const { pathname, search } = new URL(url);
  const sanitizedImportPath = sanitizeImportPath(pathname + search);
  const pathSegment = sanitizedImportPath ? `/${sanitizedImportPath}` : '';
  return `${AUDIT_TYPE}/scrapes/${id}${pathSegment}/${fileName}`;
}

/**
 * Reads and parses the site's status.json from S3.
 * Returns {} when S3 is not configured, the file does not exist, or any read error occurs.
 * Logs a warning for unexpected errors (non-NoSuchKey).
 * @param {string} siteId
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function readSiteStatusJson(siteId, context) {
  const { s3Client, env, log } = context;
  if (!env?.S3_SCRAPER_BUCKET_NAME || !s3Client) {
    return {};
  }
  const statusKey = `${AUDIT_TYPE}/scrapes/${siteId}/status.json`;
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: env.S3_SCRAPER_BUCKET_NAME, Key: statusKey }),
    );
    return JSON.parse(await response.Body.transformToString());
  } catch (e) {
    if (e.name !== 'NoSuchKey') {
      log?.warn?.(`${LOG_PREFIX} Could not read status.json: ${e.message}. siteId=${siteId}`);
    }
    return {};
  }
}

/**
 * Fetches the latest scrapeJobId from the status.json file in S3
 * @param {string} siteId - The site ID
 * @param {Object} context - Audit context with s3Client and env
 * @returns {Promise<string|null>} - The scrapeJobId or null if not found
 */
export async function fetchLatestScrapeJobId(siteId, context) {
  const { log } = context;
  log.info(`${LOG_PREFIX} ai-only: Fetching status.json for siteId=${siteId}`);
  const statusData = await readSiteStatusJson(siteId, context);
  if (statusData.scrapeJobId) {
    log.info(`${LOG_PREFIX} ai-only: Found scrapeJobId: ${statusData.scrapeJobId}`);
    return statusData.scrapeJobId;
  }
  log.warn(`${LOG_PREFIX} ai-only: No scrapeJobId found in status.json`);
  return null;
}

/**
 * Finds the site's existing PRERENDER opportunity (NEW status), if one exists.
 * @param {Object} dataAccess - Data access layer
 * @param {string} siteId - Site ID to look up the opportunity
 * @returns {Promise<Object|null>}
 */
export async function findPrerenderOpportunity(dataAccess, siteId) {
  const opportunities = await dataAccess?.Opportunity?.allBySiteIdAndStatus?.(siteId, 'NEW') ?? [];
  return opportunities.find((o) => o.getType() === AUDIT_TYPE) ?? null;
}
