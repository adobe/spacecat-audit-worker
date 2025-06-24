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

        anchors.forEach((a) => {
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
        await Promise.all(
          Array.from(internalSet).map(async (href) => {
            try {
              const response = await fetch(href, {
                method: 'HEAD',
                headers: {
                  Authorization: options.pageAuthToken,
                },
                timeout: 3000,
              });
              const { status } = response;

              if (status >= 400) {
                log.debug(`[preflight-audit] internal url ${href} returned with status code: %s`, status);
                brokenInternalLinks.push({ urlTo: href, href: pageUrl, status });
              }
            } catch (err) {
              log.error(`[preflight-audit] Error checking internal link ${href} from ${pageUrl}:`, err.message);
            }
          }),
        );

        // Check external links
        await Promise.all(
          Array.from(externalSet).map(async (href) => {
            try {
              const response = await fetch(href, {
                method: 'HEAD',
                headers: {
                  Authorization: options.pageAuthToken,
                },
                timeout: 3000,
              });
              const { status } = response;

              if (status >= 400) {
                log.debug(`[preflight-audit] external url ${href} returned with status code: %s`, status);
                brokenExternalLinks.push({ urlTo: href, href: pageUrl, status });
              }
            } catch (err) {
              log.error(`[preflight-audit] Error checking external link ${href} from ${pageUrl}:`, err.message);
              brokenExternalLinks.push({
                urlTo: href,
                href: pageUrl,
                status: 'error',
                error: err.message,
              });
            }
          }),
        );
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
