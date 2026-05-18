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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { sleep } from '../support/utils.js';

export const DOMAIN_RATE_LIMIT_MS = 1000;
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_PAGES = 100;
export const MAX_EXTERNAL_LINKS_PER_PAGE = 50;

/**
 * Extracts unique external href values from a Cheerio-loaded document.
 * Skips internal links, relative links, mailto:, tel:, and fragment-only links.
 *
 * @param {import('cheerio').CheerioAPI} $ - Cheerio instance loaded with page HTML.
 * @param {string} siteHostname - The site's hostname to exclude (e.g. "example.com").
 * @returns {string[]} Array of unique external absolute URLs.
 */
export function extractExternalLinks($, siteHostname) {
  const seen = new Set();
  const result = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (!href.startsWith('http://') && !href.startsWith('https://')) return;
    let parsed;
    try {
      parsed = new URL(href);
    } catch {
      return;
    }
    if (parsed.hostname === siteHostname) return;
    const normalized = parsed.href;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  });

  return result.slice(0, MAX_EXTERNAL_LINKS_PER_PAGE);
}

/**
 * Checks each external link's HTTP status, applying a per-domain rate limit.
 * Returns only links that returned status >= 400.
 *
 * @param {string[]} links - Array of absolute URLs to check.
 * @param {Object} log - Logger instance.
 * @returns {Promise<Array<{url: string, status: number}>>} Broken links (status >= 400).
 */
export async function checkExternalLinks(links, log) {
  const lastRequestMs = new Map();
  const broken = [];

  for (const url of links) {
    let domain;
    try {
      domain = new URL(url).hostname;
    } catch {
      // skip unparseable URLs
      // eslint-disable-next-line no-continue
      continue;
    }

    const last = lastRequestMs.get(domain);
    if (last !== undefined) {
      const elapsed = Date.now() - last;
      if (elapsed < DOMAIN_RATE_LIMIT_MS) {
        // eslint-disable-next-line no-await-in-loop
        await sleep(DOMAIN_RATE_LIMIT_MS - elapsed);
      }
    }

    lastRequestMs.set(domain, Date.now());

    let status;
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, { timeout: FETCH_TIMEOUT_MS });
      status = response.status;
    } catch (err) {
      log.warn(`Failed to check external link ${url}: ${err.message}`);
      // eslint-disable-next-line no-continue
      continue;
    }

    if (status >= 400) {
      broken.push({ url, status });
    }
  }

  return broken;
}
