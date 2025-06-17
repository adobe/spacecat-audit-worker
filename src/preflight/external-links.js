/*
 * Copyright 2024 Adobe. All rights reserved.
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
 * Preflight check for external links
 * @param {Array<Object>} scrapedObjects - Array of objects containing the URL and scraped data
 * @param {Object} context - Context object containing the logger
 * @returns {Promise<Object>} - Object containing the audit result with broken external links
 */
export async function runExternalLinkChecks(scrapedObjects, context) {
  const { log } = context;
  const brokenExternalLinks = [];

  await Promise.all(
    scrapedObjects.map(async ({ data }) => {
      const html = data.scrapeResult.rawBody;
      const pageUrl = data.finalUrl;
      const dom = new JSDOM(html);

      const doc = dom.window.document;
      const anchors = Array.from(doc.querySelectorAll('a[href]'));
      const pageOrigin = new URL(pageUrl).origin;
      const externalSet = new Set();

      anchors.forEach((a) => {
        const abs = new URL(a.href, pageUrl).toString();
        if (new URL(abs).origin !== pageOrigin) {
          externalSet.add(abs);
        }
      });

      log.info('[preflight-audit] Found external links:', externalSet);

      // Check external links
      await Promise.all(
        Array.from(externalSet).map(async (href) => {
          try {
            const res = await fetch(href, {
              method: 'HEAD',
              timeout: 3000, // 3 second timeout for external links
            });
            if (res.status >= 400) {
              brokenExternalLinks.push({
                check: 'broken-external-links',
                issue: [{
                  url: href,
                  issue: `Link returning ${res.status} status code`,
                  seoImpact: 'High',
                  seoRecommendation: 'Fix or remove broken links to improve user experience',
                }],
              });
            }
          } catch {
            brokenExternalLinks.push({
              check: 'broken-external-links',
              issue: [{
                url: href,
                issue: 'Link is unreachable',
                seoImpact: 'High',
                seoRecommendation: 'Fix or remove broken links to improve user experience',
              }],
            });
          }
        }),
      );
    }),
  );

  return {
    auditResult: {
      brokenExternalLinks,
    },
  };
}
