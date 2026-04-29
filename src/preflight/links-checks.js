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
 * Status codes where HEAD is unreliable: bot protection, auth gates, or method restrictions.
 * These trigger a GET retry before deciding the link is broken.
 */
const HEAD_FALLBACK_STATUSES = new Set([400, 401, 403, 405, 429, 451]);

/**
 * Ancestor selectors identifying page chrome (site header / footer). Anchors inside these
 * are skipped because they are typically repeated across every page — checking them per
 * page multiplies traffic to the same URLs and produces noisy, non-actionable findings.
 *
 * Covers three shapes seen in practice:
 *   - Semantic HTML5 tags: `<header>`, `<footer>`
 *   - ARIA landmarks: `role="banner"` (site header), `role="contentinfo"` (site footer)
 *   - AEM Experience Fragment wrappers: `cmp-experiencefragment--header` /
 *     `cmp-experiencefragment--footer`, emitted by AEM XFs on many enterprise sites
 *     (including OneWalmart) that don't render semantic header/footer tags at all.
 *
 * Intentionally excluded: `<nav>` and `role="navigation"`. Navigation links point at real
 * in-site destinations that we want to verify, so treating them as chrome would hide
 * genuine broken links. Keep this list conservative — ambiguous wrappers like `.nav`,
 * `.menu`, `.sidebar`, or generic `class*="header"` risk false-skipping content links.
 */
const CHROME_ANCESTOR_SELECTOR = [
  'header',
  'footer',
  '[role="banner"]',
  '[role="contentinfo"]',
  '.cmp-experiencefragment--header',
  '.cmp-experiencefragment--footer',
  // Do not add broader class-matchers here without evidence — see docblock above.
].join(', ');

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

  const headers = { 'User-Agent': DEFAULT_USER_AGENT };

  // Add Authorization header only for internal links
  if (isInternal && pageAuthToken) {
    headers.Authorization = pageAuthToken;
  }

  const fetchOptions = { method: 'HEAD', decode: false, headers };

  try {
    const res = await fetch(href, fetchOptions);

    if (HEAD_FALLBACK_STATUSES.has(res.status)) {
      // Server may be blocking HEAD (405) or applying bot/auth restrictions to our crawler.
      // Retry with GET before deciding the link is broken.
    } else if (isBrokenStatus(res.status)) {
      log.debug(`[preflight-audit] ${linkType} url ${href} returned with status code: %s`, res.status, res.statusText);
      return {
        urlTo: href,
        href: pageUrl,
        status: res.status,
        ...toElementTargets(selectors),
      };
    } else {
      return null;
    }
  } catch (err) {
    log.warn(`[preflight-audit] HEAD request failed (${err.message}), retrying with GET: ${href}`);
  }

  // GET fallback — reached when HEAD was inconclusive (fallback status or network error)
  fetchOptions.method = 'GET';
  try {
    const res = await fetch(href, fetchOptions);

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
    log.error(`[preflight-audit] Error checking ${linkType} link ${href} from ${pageUrl} with GET fallback:`, finalErr.message);
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
 * @returns {Promise<Object>} - Object containing both broken internal and external links
 */
export async function runLinksChecks(urls, scrapedObjects, context, options = {
  pageAuthToken: null,
}) {
  const { log } = context;
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

        const anchors = $('a[href]');
        const pageOrigin = new URL(pageUrl).origin;
        const internalLinks = new Map();
        const externalLinks = new Map();

        log.debug(`[preflight-audit] Total links found (${anchors.length}):`, anchors.map((i, a) => $(a).attr('href')).get());

        anchors.each((i, a) => {
          const $a = $(a);
          // Skip links inside page chrome (site header / footer). See CHROME_ANCESTOR_SELECTOR.
          if ($a.closest(CHROME_ANCESTOR_SELECTOR).length) {
            return;
          }

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
