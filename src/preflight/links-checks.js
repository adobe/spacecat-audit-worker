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

import { stripTrailingSlash, tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { load as cheerioLoad } from 'cheerio';
import { getDomElementSelector, toElementTargets } from './utils/dom-selector.js';
import { DEFAULT_USER_AGENT } from '../internal-links/helpers.js';

/**
 * Removes subtrees rooted at elements whose `class` contains an excluded token.
 * Deepest nodes are removed first so nested excluded wrappers are safe. Mirrors
 * the broken-internal-links crawl filter introduced in PR #2455 so site authors
 * can use one mental model across audits.
 *
 * @param {CheerioAPI} $ - cheerio document (mutated)
 * @param {string[]} excludedElementClasses - normalized class tokens (no leading ".")
 */
export function filterExcludedElements($, excludedElementClasses) {
  if (!excludedElementClasses?.length) {
    return;
  }
  const excludedClassSet = new Set(excludedElementClasses);
  const toRemove = [];

  $('[class]').each((_, el) => {
    const classAttr = $(el).attr('class');
    if (!classAttr) {
      return;
    }
    const hasExcluded = classAttr.split(/\s+/).filter(Boolean).some((c) => excludedClassSet.has(c));
    if (hasExcluded) {
      toRemove.push(el);
    }
  });
  toRemove.sort((a, b) => $(b).parents().length - $(a).parents().length);
  for (const el of toRemove) {
    $(el).remove();
  }
}

/**
 * Normalize a customer-supplied list of href-domain tokens. Lowercases, trims,
 * strips an accidental leading "http(s)://" or trailing slash/path, dedupes,
 * drops non-strings and empties. Intentionally permissive on the input side so
 * customer config can be loosely written without breaking.
 *
 * @param {string[]|string|undefined} raw - Array of host strings, or comma-separated
 * @returns {string[]} Cleaned hostnames
 */
export function normalizeHrefDomains(raw) {
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    list = raw.split(',');
  } else {
    list = [];
  }
  const cleaned = list
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim().toLowerCase())
    .map((v) => v.replace(/^https?:\/\//, ''))
    .map((v) => v.split('/')[0])
    .filter((v) => v.length > 0);
  return [...new Set(cleaned)];
}

/**
 * Normalize a customer-supplied list of regex strings. Just filters non-strings
 * and empties; pattern compilation (and bad-regex defense) happens later in
 * compileHrefPatterns.
 *
 * @param {string[]|string|undefined} raw
 * @returns {string[]}
 */
export function normalizeHrefPatterns(raw) {
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    list = [raw];
  } else {
    list = [];
  }
  return list
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * Suffix-match an href's hostname against a list of excluded domains.
 * `wal-mart.com` matches `timesheet.wal-mart.com` and `wal-mart.com` itself,
 * but NOT `evilwal-mart.com` — the match requires either equality or a leading
 * dot boundary on the hostname.
 *
 * @param {string} href - The absolute href to test
 * @param {string[]} excludedHrefDomains - Lowercased hostnames (no protocol, no path)
 * @returns {boolean}
 */
export function matchesExcludedDomain(href, excludedHrefDomains) {
  if (!excludedHrefDomains?.length) {
    return false;
  }
  let hostname;
  try {
    hostname = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }
  return excludedHrefDomains.some(
    (d) => hostname === d || hostname.endsWith(`.${d}`),
  );
}

/**
 * Test an href against a list of regex strings. Invalid regexes are dropped
 * with a warn — a bad pattern in customer config must not crash the audit.
 *
 * @param {string} href - The absolute href to test
 * @param {RegExp[]} compiledPatterns - Pre-compiled patterns from compileHrefPatterns
 * @returns {boolean}
 */
export function matchesExcludedPattern(href, compiledPatterns) {
  if (!compiledPatterns?.length) {
    return false;
  }
  return compiledPatterns.some((re) => re.test(href));
}

/**
 * Compile customer-supplied regex strings once per audit run. Bad patterns
 * are logged and dropped so subsequent matches don't repeatedly throw.
 *
 * @param {string[]} patterns - Raw regex strings from site config
 * @param {{ warn: Function }} log - Logger
 * @returns {RegExp[]}
 */
export function compileHrefPatterns(patterns, log) {
  if (!patterns?.length) {
    return [];
  }
  const out = [];
  for (const p of patterns) {
    try {
      out.push(new RegExp(p));
    } catch (err) {
      log.warn(`[preflight-audit] invalid excludedHrefPattern (${p}) — skipping: ${err.message}`);
    }
  }
  return out;
}

/**
 * Returns true if the href should be skipped from probing per any of the
 * link-level exclusion knobs.
 */
export function isExcludedHref(href, { excludedHrefDomains, compiledHrefPatterns }) {
  return matchesExcludedDomain(href, excludedHrefDomains)
    || matchesExcludedPattern(href, compiledHrefPatterns);
}

/**
 * Status codes where HEAD is unreliable: bot protection, auth gates, or method restrictions.
 * These trigger a GET retry before deciding the link is broken.
 */
const HEAD_FALLBACK_STATUSES = new Set([400, 401, 403, 405, 429, 451]);

/**
 * Returns true only for status codes that definitively indicate a broken link.
 *
 * 404 (Not Found) and 410 (Gone) mean the content does not exist — unambiguously broken.
 * 5xx means the server is failing to serve the content — also unambiguously broken.
 *
 * Auth/bot codes (400, 401, 403, 429, 451) and 405 are intentionally excluded: they
 * indicate access restrictions or method limitations, not missing content. External pages
 * that require authentication or block crawlers should not be reported as broken links.
 * This differs from the internal-links audit, which surfaces auth-blocked internal pages
 * as opportunities (FORBIDDEN_OR_BLOCKED); preflight covers external links where we have
 * no credentials and access restrictions are expected and valid.
 *
 * @param {number} status
 * @returns {boolean}
 */
function isBrokenStatus(status) {
  return status === 404 || status === 410 || status >= 500;
}

/**
 * Helper function to check if a link is broken
 * @param {string} href - The URL to check
 * @param {string} pageUrl - The source page URL
 * @param {Object} context - Context object containing the logger
 * @param {Object} options - Options for the fetch request
 * @param {string} options.pageAuthToken - Optional authorization token for the page
 * @param {boolean} options.isInternal - Whether this is an internal link
 * @returns {Promise<Object|null>} - Object with link details if broken, null otherwise
 */
async function checkLinkStatus(href, pageUrl, context, options = {
  pageAuthToken: null,
}) {
  const { log } = context;
  const {
    pageAuthToken, isInternal, selectors = [],
  } = options;
  const linkType = isInternal ? 'internal' : 'external';

  // Only probe http/https URLs. Non-web schemes (mailto:, tel:, javascript:,
  // sms:, etc.) are not web links — fetch() cannot probe them and they should
  // never be reported as broken.
  const { protocol } = new URL(href);
  if (protocol !== 'http:' && protocol !== 'https:') {
    return null;
  }

  const headers = { 'User-Agent': DEFAULT_USER_AGENT };

  // Add Authorization header only for internal links
  if (isInternal && pageAuthToken) {
    headers.Authorization = pageAuthToken;
  }

  // Use a fresh options object per request so callers (and tests) can inspect
  // the method that was actually used on each call without seeing it mutated
  // when we fall through to GET.
  const headOptions = { method: 'HEAD', decode: false, headers };

  try {
    const res = await fetch(href, headOptions);

    // HEAD is a fast-path optimization, GET is the source of truth for "broken".
    // If HEAD reports a healthy status, accept it and skip the GET. If HEAD reports
    // anything that would be flagged as broken (404/410/5xx) — or any of the known
    // auth/bot fallback codes — fall through to a GET retry before deciding. Real
    // servers commonly return 404 / 5xx to HEAD on routes that respond 200 to GET
    // (misconfigured Apache origins, SSO endpoints, etc.).
    if (
      !isBrokenStatus(res.status)
      && !HEAD_FALLBACK_STATUSES.has(res.status)
    ) {
      return null;
    }
  } catch (err) {
    log.warn(`[preflight-audit] HEAD request failed (${err.message}), retrying with GET: ${href}`);
  }

  // GET fallback — HEAD was inconclusive (broken status, fallback status, or network error).
  // Send `Range: bytes=0-0` so cooperating servers reply with 206 + 1 byte instead of
  // streaming the full response body, since we only need the status code. Servers that
  // ignore the header fall back to a normal 200 (or whatever error code applies). 206
  // and 416 (Range Not Satisfiable) both fall outside `isBrokenStatus`, so they're
  // correctly treated as healthy. Servers that genuinely 404/410/5xx do so regardless
  // of the Range header — there's no way to skip those bodies without reading the
  // status, but those response bodies are typically small.
  const getOptions = {
    method: 'GET',
    decode: false,
    headers: { ...headers, Range: 'bytes=0-0' },
  };
  try {
    const res = await fetch(href, getOptions);

    if (isBrokenStatus(res.status)) {
      log.debug(`[preflight-audit] ${linkType} url ${href} returned with status code: %s`, res.status, res.statusText);
      return {
        urlTo: href,
        href: pageUrl,
        status: res.status,
        ...toElementTargets(selectors),
      };
    }

    return null;
  } catch (finalErr) {
    // Network-level failure (DNS, timeout, unsupported protocol) — the link is
    // unreachable, which is a broken-link condition. status: 0 is the sentinel
    // for "no HTTP response received".
    log.info(`[preflight-audit] ${linkType} link ${href} unreachable (${finalErr.message}) — reporting as broken`);
    return {
      urlTo: href,
      href: pageUrl,
      status: 0,
      ...toElementTargets(selectors),
    };
  }
}

/**
 * Preflight check for both internal and external links
 * @param {Array<String>} urls - Array of URLs to check
 * @param {Array<Object>} scrapedObjects - Array of objects containing the URL and scraped data
 * @param {Object} context - Context object containing the logger
 * @param {RequestOptions} options - Options for to pass to the fetch request
 * @param {String} options.pageAuthToken - Optional authorization token for the page
 * @param {string[]} [options.excludedElementClasses] - Class tokens that mark subtrees
 *   to ignore. Any anchor whose DOM node or ancestor has one of these classes is
 *   pruned from extraction and therefore never reported as broken.
 * @param {string[]} [options.excludedHrefDomains] - Hostnames to skip (suffix-matched
 *   against each anchor's href hostname). Useful for known auth-gated / corp-network
 *   domains the audit cannot reach from Lambda.
 * @param {string[]} [options.excludedHrefPatterns] - Regex strings to skip (matched
 *   against each anchor's absolute href). Power-user knob.
 * @returns {Promise<Object>} - Object containing both broken internal and external links
 */
export async function runLinksChecks(urls, scrapedObjects, context, options = {
  pageAuthToken: null,
}) {
  const {
    excludedElementClasses = [],
    excludedHrefDomains = [],
    excludedHrefPatterns = [],
  } = options;
  const { log } = context;
  const compiledHrefPatterns = compileHrefPatterns(excludedHrefPatterns, log);
  const hrefFilters = { excludedHrefDomains, compiledHrefPatterns };
  const brokenInternalLinks = [];
  const brokenExternalLinks = [];

  const urlSet = new Set(urls);

  await Promise.all(
    scrapedObjects
      .filter(({ data }) => urlSet.has(stripTrailingSlash(data.finalUrl)))
      .map(async ({ data }) => {
        const html = data.scrapeResult.rawBody;
        const pageUrl = data.finalUrl;
        const $ = cheerioLoad(html);

        filterExcludedElements($, excludedElementClasses);

        const anchors = $('a[href]');
        const pageOrigin = new URL(pageUrl).origin;
        const internalLinks = new Map();
        const externalLinks = new Map();

        log.debug(`[preflight-audit] Total links found (${anchors.length}):`, anchors.map((i, a) => $(a).attr('href')).get());

        anchors.each((i, a) => {
          const $a = $(a);
          try {
            const href = $a.attr('href');
            const abs = new URL(href, pageUrl).toString();
            if (isExcludedHref(abs, hrefFilters)) {
              return;
            }
            const selector = getDomElementSelector(a);
            if (new URL(abs).origin === pageOrigin) {
              if (!internalLinks.has(abs)) {
                internalLinks.set(abs, new Set());
              }
              if (selector) {
                internalLinks.get(abs).add(selector);
              }
            } else {
              if (!externalLinks.has(abs)) {
                externalLinks.set(abs, new Set());
              }
              if (selector) {
                externalLinks.get(abs).add(selector);
              }
            }
          } catch {
            // skip invalid hrefs
          }
        });

        log.debug('[preflight-audit] Found internal links:', internalLinks);
        log.debug('[preflight-audit] Found external links:', externalLinks);

        // Check internal links
        const internalResults = await Promise.all(
          Array.from(internalLinks.entries()).map(async ([href, selectorSet]) => checkLinkStatus(
            href,
            pageUrl,
            context,
            {
              ...options,
              selectors: [...selectorSet],
              isInternal: true,
            },
          )),
        );

        // Check external links
        const externalResults = await Promise.all(
          Array.from(externalLinks.entries()).map(async ([href, selectorSet]) => checkLinkStatus(
            href,
            pageUrl,
            context,
            {
              ...options,
              selectors: [...selectorSet],
              isInternal: false,
            },
          )),
        );

        // Filter out null results and add to respective arrays
        internalResults.forEach((result) => {
          if (result) {
            brokenInternalLinks.push(result);
          }
        });

        externalResults.forEach((result) => {
          if (result) {
            brokenExternalLinks.push(result);
          }
        });
      }),
  );

  log.debug(`[preflight-audit] Broken internal links found: ${JSON.stringify(brokenInternalLinks)}`);
  log.debug(`[preflight-audit] Broken external links found: ${JSON.stringify(brokenExternalLinks)}`);

  return {
    auditResult: {
      brokenInternalLinks,
      brokenExternalLinks,
    },
  };
}
