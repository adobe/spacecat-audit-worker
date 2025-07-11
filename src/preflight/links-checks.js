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

import { JSDOM } from 'jsdom';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

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
  const { pageAuthToken, isInternal } = options;

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
      return { urlTo: href, href: pageUrl, status: res.status };
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
        return { urlTo: href, href: pageUrl, status: res.status };
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
      .filter(({ data }) => urlSet.has(data.finalUrl))
      .map(async ({ data }) => {
        const html = data.scrapeResult.rawBody;
        const pageUrl = data.finalUrl;
        const dom = new JSDOM(html);

        const doc = dom.window.document;
        const anchors = Array.from(doc.querySelectorAll('a[href]'));
        const pageOrigin = new URL(pageUrl).origin;
        const internalSet = new Set();
        const externalSet = new Set();

        log.info(`[preflight-audit] Total links found (${anchors.length}):`, anchors.map((a) => a.href));

        anchors.forEach((a) => {
          // Skip links that are inside header or footer elements
          if (a.closest('header') || a.closest('footer')) {
            return;
          }

          try {
            const abs = new URL(a.href, pageUrl).toString();
            if (new URL(abs).origin === pageOrigin) {
              internalSet.add(abs);
            } else {
              externalSet.add(abs);
            }
          } catch {
            // skip invalid hrefs
          }
        });

        log.info('[preflight-audit] Found internal links:', internalSet);
        log.info('[preflight-audit] Found external links:', externalSet);

        // Check internal links
        const internalResults = await Promise.all(
          Array.from(internalSet).map(async (href) => checkLinkStatus(
            href,
            pageUrl,
            context,
            {
              ...options,
              isInternal: true,
            },
          )),
        );

        // Check external links
        const externalResults = await Promise.all(
          Array.from(externalSet).map(async (href) => checkLinkStatus(
            href,
            pageUrl,
            context,
            {
              ...options,
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
