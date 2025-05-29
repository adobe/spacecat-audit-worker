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

/**
 * Preflight check for internal links
 * @param {Array<Object>} scrapedObjects - Array of objects containing the URL and scraped data
 * @param {Object} context - Context object containing the logger
 * @param {RequestOptions} options - Options for to pass to the fetch request
 * @returns {Promise<Array>} - Array of objects containing the page URL and internal link status
 */
export async function runInternalLinkChecks(scrapedObjects, context, options = {}) {
  const { log } = context;
  const brokenInternalLinks = [];

  await Promise.all(
    scrapedObjects.map(async ({ data }) => {
      const html = data.scrapeResult.rawBody;
      const pageUrl = data.finalUrl;
      const dom = new JSDOM(html);

      const doc = dom.window.document;
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      const pageOrigin = new URL(pageUrl).origin;
      const internalSet = new Set();

      anchors.forEach((a) => {
        const abs = new URL(a.href, pageUrl).toString();
        if (new URL(abs).origin === pageOrigin) {
          internalSet.add(abs);
        }
      });

      log.info('[preflight-audit] Found internal links:', internalSet);

      await Promise.all(
        Array.from(internalSet).map(async (href) => {
          try {
            const res = await fetch(href, {
              method: 'HEAD',
              ...options,
            });
            if (res.status === 404) {
              brokenInternalLinks.push({ pageUrl, href, status: 404 });
            }
          } catch (err) {
            brokenInternalLinks.push({
              pageUrl,
              href,
              status: null,
              error: err.message,
            });
          }
        }),
      );
    }),
  );

  return {
    auditResult: {
      brokenInternalLinks,
    },
  };
}
