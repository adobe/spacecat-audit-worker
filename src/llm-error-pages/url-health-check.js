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

/**
 * Lightweight HEAD-based reachability filter for Mystique-supplied suggested URLs.
 *
 * Mystique's BrokenLinksFlow URL validator can let through alternative_urls that
 * resolve to 404 on the live site (the locale_filtered_urls candidate pool isn't
 * verified end-to-end). This filter is a defence-in-depth boundary check at the
 * audit-worker side: any suggested URL that definitively returns 4xx/5xx is
 * dropped before write. Inconclusive results (timeouts, network errors, 405
 * Method Not Allowed) are kept — we only drop URLs we are confident are broken.
 */

const HEAD_TIMEOUT_MS = 5000;
const HEAD_CONCURRENCY = 10;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0';

/**
 * Probes a single URL with HEAD. Returns true unless the response is a confident 4xx/5xx.
 * Inconclusive results (network error, timeout, 405 Method Not Allowed) return true so
 * the caller doesn't drop URLs that may still be valid.
 *
 * @param {string} url
 * @param {Object} log
 * @returns {Promise<boolean>} true if the URL appears reachable or its status is inconclusive
 */
async function isUrlReachable(url, log) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  let result;
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (res.status === 405) {
      // Server doesn't support HEAD — can't conclude. Keep the URL.
      log.debug?.(`[LLM-ERROR-PAGES] HEAD 405 (method not allowed) for ${url} — keeping`);
      result = true;
    } else {
      result = res.status < 400;
    }
  } catch (e) {
    log.debug?.(`[LLM-ERROR-PAGES] HEAD check inconclusive for ${url}: ${e.message} — keeping`);
    result = true;
  }
  clearTimeout(timer);
  return result;
}

/**
 * Returns the subset of `urls` that are not confidently broken.
 *
 * Probes are issued with bounded concurrency to avoid flooding a single host
 * with N parallel HEAD requests (typical batch is 50 broken links × 3
 * suggestions = 150 URLs, almost all hitting the same domain).
 *
 * @param {string[]} urls
 * @param {Object} log
 * @returns {Promise<string[]>} filtered URL list, preserving input order
 */
export async function filterReachableUrls(urls, log) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  const results = new Array(urls.length);
  for (let i = 0; i < urls.length; i += HEAD_CONCURRENCY) {
    const batch = urls.slice(i, i + HEAD_CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const batchResults = await Promise.all(batch.map((u) => isUrlReachable(u, log)));
    batchResults.forEach((ok, j) => {
      results[i + j] = ok;
    });
  }
  return urls.filter((_, idx) => results[idx]);
}
