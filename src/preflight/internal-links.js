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
import http from 'http';
import https from 'https';

const httpAgent = new http.Agent({ keepAlive: true, timeout: 3000 });
const httpsAgent = new https.Agent({ keepAlive: true, timeout: 3000 });

/**
 * Preflight check for internal links
 * @param {Array<String>} urls - Array of URLs to check
 * @param {Array<Object>} scrapedObjects - Array of objects containing the URL and scraped data
 * @param {Object} context - Context object containing the logger
 * @param {RequestOptions} options - Options for to pass to the fetch request
 * @param {String} options.pageAuthToken - Optional authorization token for the page
 * @returns {Promise<Array<Object>>} - Array of objects containing the page URL and link status
 */
export async function runInternalLinkChecks(urls, scrapedObjects, context, options = {
  pageAuthToken: null,
}) {
  const { log } = context;
  const brokenInternalLinks = [];

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

        anchors.forEach((a) => {
          try {
            const abs = new URL(a.href, pageUrl).toString();
            if (new URL(abs).origin === pageOrigin) {
              internalSet.add(abs);
            }
          } catch {
            // skip invalid hrefs
          }
        });

        log.info('[preflight-audit] Found internal links:', internalSet);

        await Promise.all(
          Array.from(internalSet).map(async (href) => {
            const startTime = Date.now();
            try {
              const res = await fetch(href, {
                method: 'HEAD',
                headers: {
                  Authorization: options.pageAuthToken,
                },
                agent: href.startsWith('https') ? httpsAgent : httpAgent,
                redirect: 'follow',
              });
              const endTime = Date.now();
              log.debug(`[preflight-audit] Internal link check completed in ${endTime - startTime}ms: ${href} (status: ${res.status})`);

              if (res.status >= 400) {
                log.debug(`[preflight-audit] url ${href} returned with status code: %s`, res.status, res.statusText);
                brokenInternalLinks.push({ urlTo: href, href: pageUrl, status: res.status });
              }
            } catch (err) {
              const endTime = Date.now();
              log.debug(`[preflight-audit] Internal link check failed in ${endTime - startTime}ms: ${href} (error: ${err.message})`);
              log.error(`[preflight-audit] Error checking internal link ${href} from ${pageUrl}:`, err.message);
            }
          }),
        );
      }),
  );

  log.debug(`[preflight-audit] Broken internal links found: ${JSON.stringify(brokenInternalLinks)}`);
  return {
    auditResult: {
      brokenInternalLinks,
    },
  };
}
