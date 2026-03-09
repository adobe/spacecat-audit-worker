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
import { getDomElementSelector, toElementTargets } from '../utils/dom-selector.js';

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

  const fetchOptions = {
    method: 'HEAD',
    decode: false,
  };

  // Add Authorization header only for internal links
  if (isInternal && pageAuthToken) {
    fetchOptions.headers = {
      Authorization: pageAuthToken,
    };
  }

  try {
    const res = await fetch(href, fetchOptions);

    if (res.status >= 400) {
      const linkType = isInternal ? 'internal' : 'external';
      log.debug(`[preflight-audit] ${linkType} url ${href} returned with status code: %s`, res.status, res.statusText);
      return {
        urlTo: href,
        href: pageUrl,
        status: res.status,
        ...toElementTargets(selectors),
      };
    }

    return null;
  } catch (err) {
    // Fallback to GET on any error
    log.warn(`[preflight-audit] HEAD request failed (${err.message}), retrying with GET: ${href}`);

    fetchOptions.method = 'GET';
    let res;
    try {
      res = await fetch(href, fetchOptions);

      if (res.status >= 400) {
        const linkType = isInternal ? 'internal' : 'external';
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
      const linkType = isInternal ? 'internal' : 'external';
      log.error(`[preflight-audit] Error checking ${linkType} link ${href} from ${pageUrl} with GET fallback:`, finalErr.message);
      return null;
    }
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
          // Skip links that are inside header or footer elements
          if ($a.closest('header').length || $a.closest('footer').length) {
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
          if (result) brokenInternalLinks.push(result);
        });

        externalResults.forEach((result) => {
          if (result) brokenExternalLinks.push(result);
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
