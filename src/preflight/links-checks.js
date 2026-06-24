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
 * Default number of link probes performed concurrently. Kept low so the audit
 * does not overwhelm a slow author environment: firing every link at once makes
 * authenticated author renders queue past the per-request timeout, which the
 * audit then records as Status 0 / broken (false positives — see SITES-46696).
 * Override per run via options.linkCheckConcurrency or env
 * PREFLIGHT_LINK_CHECK_CONCURRENCY.
 */
export const DEFAULT_LINK_CHECK_CONCURRENCY = 5;

/**
 * Minimal promise concurrency limiter. Returns a scheduler that runs at most
 * `max` tasks at a time and resolves with each task's result. Falls back to
 * serial (1) for invalid input.
 *
 * @param {number} max - maximum number of concurrently running tasks
 * @returns {(task: () => Promise<*>) => Promise<*>} scheduler function
 */
export function createConcurrencyLimiter(max) {
  const limit = Number.isFinite(max) && max >= 1 ? Math.floor(max) : 1;
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= limit || queue.length === 0) {
      return;
    }
    active += 1;
    const { task, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (task) => new Promise((resolve, reject) => {
    queue.push({ task, resolve, reject });
    next();
  });
}

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
  // Deepest nodes first so removing an ancestor doesn't leave already-queued
  // descendants as detached nodes that Cheerio would try to remove again.
  toRemove.sort((a, b) => $(b).parents().length - $(a).parents().length);
  for (const el of toRemove) {
    $(el).remove();
  }
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
 * Returns true only for a DNS-resolution failure — the one network-level error that
 * definitively indicates a broken link.
 *
 * A DNS-resolution failure (`ENOTFOUND` — getaddrinfo cannot resolve the hostname) means the
 * domain does not exist, so the link is unambiguously broken (SITES-40919: nonexistent domains
 * and intranet hosts that fail DNS must surface as status 0).
 *
 * Every other thrown error — connection reset, HTTP/2 stream errors, TLS failures, connection
 * refused, request timeouts — means the host resolves and is reachable but did not return a
 * usable HTTP response. That is indistinguishable from a valid page that blocks crawlers at the
 * connection level (e.g. ups.com resets the HTTP/2 stream with NGHTTP2_INTERNAL_ERROR), so these
 * must NOT be reported as broken (SITES-47125).
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isDnsResolutionFailure(err) {
  return err.code === 'ENOTFOUND' || /ENOTFOUND/.test(err.message);
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
    // Only a DNS-resolution failure (ENOTFOUND) is a definitive broken-link condition: the
    // domain does not exist. status: 0 is the sentinel for "no HTTP response received".
    if (isDnsResolutionFailure(finalErr)) {
      log.info(`[preflight-audit] ${linkType} link ${href} unreachable — DNS does not resolve (${finalErr.message}) — reporting as broken`);
      return {
        urlTo: href,
        href: pageUrl,
        status: 0,
        ...toElementTargets(selectors),
      };
    }

    // Any other network-level failure (connection reset, HTTP/2 stream error, TLS, timeout)
    // means the host is reachable but did not return a usable response — indistinguishable
    // from a valid page that blocks bots at the connection level. Do NOT report as broken
    // (SITES-47125: ups.com and similar bot-protected sites were false-flagged as Status 0).
    log.info(`[preflight-audit] ${linkType} link ${href} probe inconclusive (${finalErr.message}) — not reporting as broken`);
    return null;
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
 * @returns {Promise<Object>} - Object containing both broken internal and external links
 */
export async function runLinksChecks(urls, scrapedObjects, context, options = {
  pageAuthToken: null,
}) {
  const {
    excludedElementClasses = [],
  } = options;
  const { log } = context;
  const brokenInternalLinks = [];
  const brokenExternalLinks = [];

  const urlSet = new Set(urls);

  // Bound how many link probes run at once. Unbounded probing overwhelms slow
  // author environments, making renders queue past the per-request timeout,
  // which the audit then reports as broken (false positives — SITES-46696).
  const concurrency = Number(options.linkCheckConcurrency)
    || Number(context.env?.PREFLIGHT_LINK_CHECK_CONCURRENCY)
    || DEFAULT_LINK_CHECK_CONCURRENCY;
  const limit = createConcurrencyLimiter(concurrency);

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

        // AEM's server-side cq-LinkChecker rewrites broken <a> tags to <img> elements
        // before the HTML is served, removing the anchor entirely. The broken URL is
        // preserved in the alt attribute as "invalid link: <url>". Extract these directly
        // without HTTP probing — AEM has already validated them as broken (404).
        const seenCqUrls = new Set();
        $('img.cq-LinkChecker--prefix.cq-LinkChecker--invalid').each((i, img) => {
          const alt = $(img).attr('alt') || '';
          const match = alt.match(/^invalid link:\s*(.+)$/);
          if (!match) {
            return;
          }
          try {
            const parsed = new URL(match[1].trim(), pageUrl);
            // Mirror the protocol guard in checkLinkStatus — non-web schemes
            // (mailto:, tel:, javascript:, etc.) are not navigable links.
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return;
            }
            const abs = parsed.toString();
            // Deduplicate: same URL may appear in multiple cq-LinkChecker images.
            if (seenCqUrls.has(abs)) {
              return;
            }
            seenCqUrls.add(abs);
            const selector = getDomElementSelector(img);
            const result = {
              urlTo: abs,
              href: pageUrl,
              status: 404,
              ...toElementTargets([selector].filter(Boolean)),
            };
            if (parsed.origin === pageOrigin) {
              brokenInternalLinks.push(result);
            } else {
              brokenExternalLinks.push(result);
            }
          } catch {
            // skip unparseable URLs
          }
        });

        // Check internal links
        const internalResults = await Promise.all(
          Array.from(internalLinks.entries()).map(
            ([href, selectorSet]) => limit(() => checkLinkStatus(
              href,
              pageUrl,
              context,
              {
                ...options,
                selectors: [...selectorSet],
                isInternal: true,
              },
            )),
          ),
        );

        // Check external links
        const externalResults = await Promise.all(
          Array.from(externalLinks.entries()).map(
            ([href, selectorSet]) => limit(() => checkLinkStatus(
              href,
              pageUrl,
              context,
              {
                ...options,
                selectors: [...selectorSet],
                isInternal: false,
              },
            )),
          ),
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
