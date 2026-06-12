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

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { isUrlSafeToFetch } from '../support/url-safety.js';

const HEAD_TIMEOUT_MS = 5000;
const HEAD_CONCURRENCY = 10;
const HEAD_PER_HOST_CONCURRENCY = 3;
const USER_AGENT = 'AdobeSpacecat-LLMErrorPages/1.0 (+https://www.adobe.com/)';

/**
 * Probes a single URL with HEAD. Returns true unless the response is a confident 4xx/5xx.
 * Inconclusive results (network error, timeout, 405 Method Not Allowed) return true so
 * the caller doesn't drop URLs that may still be valid.
 *
 * Uses `redirect: 'manual'` to avoid following 3xx targets the SSRF guard hasn't
 * vetted. A 3xx status is still < 400, so the existing branch treats it as
 * reachable — that matches the prior follow-redirects semantics for this filter.
 *
 * @param {string} url
 * @param {Object} log
 * @returns {Promise<boolean>} true if the URL appears reachable or its status is inconclusive
 */
async function isUrlReachable(url, log) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  let res;
  let fetchError;
  try {
    res = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: controller.signal,
    });
  } catch (e) {
    fetchError = e;
  }
  // Always clear the abort timer once the fetch has settled, regardless of
  // outcome — leaving it pending would keep an open handle alive until the
  // 5-second timeout fires.
  clearTimeout(timer);

  if (fetchError) {
    log.debug?.(`[LLM-ERROR-PAGES] HEAD check inconclusive for ${url}: ${fetchError.message} — keeping`);
    return true;
  }
  if (res.status === 405) {
    // Server doesn't support HEAD — can't conclude. Keep the URL.
    log.debug?.(`[LLM-ERROR-PAGES] HEAD 405 (method not allowed) for ${url} — keeping`);
    return true;
  }
  // 3xx (redirect) lands below 400 and is treated as reachable; the redirect
  // target itself is not followed (manual mode) so the SSRF guard above is
  // not bypassed.
  return res.status < 400;
}

/**
 * Returns the URL's origin, or null if it cannot be parsed. Used by the
 * per-host scheduler to group probes so we don't pound a single domain with
 * the full global parallelism budget.
 */
function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Inline scheduler — no p-limit dep. Enforces:
 *   - up to HEAD_CONCURRENCY tasks in flight overall
 *   - up to HEAD_PER_HOST_CONCURRENCY tasks in flight per origin
 *
 * Tasks are dispatched in input order; the returned array of resolved values
 * is index-aligned with the input so callers can `filter` against the original
 * URL list without losing order.
 */
async function runWithHostCap(urls, taskFn) {
  const results = new Array(urls.length);
  const indicesByHost = new Map(); // host -> queue of pending indices
  const orderedHosts = []; // FIFO of hosts with pending work
  urls.forEach((u, i) => {
    const host = safeOrigin(u) ?? `__no-origin__:${i}`;
    if (!indicesByHost.has(host)) {
      indicesByHost.set(host, []);
      orderedHosts.push(host);
    }
    indicesByHost.get(host).push(i);
  });

  const inflightPerHost = new Map();

  return new Promise((resolve) => {
    const state = {
      inflightGlobal: 0,
      remaining: urls.length,
      cursor: 0,
    };

    const maybeFinish = () => {
      if (state.remaining === 0) {
        resolve(results);
      }
    };

    const pickNext = () => {
      // Find a host that still has work AND is under its per-host cap.
      for (let attempts = 0; attempts < orderedHosts.length; attempts += 1) {
        const host = orderedHosts[state.cursor % orderedHosts.length];
        state.cursor += 1;
        const queue = indicesByHost.get(host);
        const inflight = inflightPerHost.get(host) ?? 0;
        if (queue.length > 0 && inflight < HEAD_PER_HOST_CONCURRENCY) {
          return { host, idx: queue.shift() };
        }
      }
      return null;
    };

    const onTaskDone = (host) => {
      state.inflightGlobal -= 1;
      // Host counter was incremented before dispatch, so .get() is always defined here.
      inflightPerHost.set(host, inflightPerHost.get(host) - 1);
      state.remaining -= 1;
      maybeFinish();
      // eslint-disable-next-line no-use-before-define
      pump();
    };

    const pump = () => {
      while (state.inflightGlobal < HEAD_CONCURRENCY) {
        const next = pickNext();
        if (!next) {
          return;
        }
        const { host, idx } = next;
        state.inflightGlobal += 1;
        inflightPerHost.set(host, (inflightPerHost.get(host) ?? 0) + 1);
        Promise.resolve()
          .then(() => taskFn(urls[idx], idx))
          .then((value) => {
            results[idx] = value;
          })
          // Belt-and-suspenders fail-open: if taskFn rejects unexpectedly
          // (i.e. an error that didn't get caught inside isUrlReachable's
          // try/catch), keep the URL rather than letting `results[idx]`
          // stay undefined and silently drop it in the post-filter.
          .catch(() => { results[idx] = true; })
          .finally(() => onTaskDone(host));
      }
    };

    // Callers (filterOutConfirmedBrokenUrls) already guard against empty input,
    // so `urls.length` is always > 0 here. The scheduler safely no-ops if it
    // ever isn't (pump() finds no work and remaining stays at 0).
    pump();
  });
}

/**
 * Returns the subset of `urls` that are not confidently broken.
 *
 * Each URL is first run through the SSRF guard (`isUrlSafeToFetch`): non-http(s)
 * schemes and any host that resolves to a private/loopback/link-local address
 * are dropped before the network probe. Survivors are HEAD-probed with a
 * bounded global concurrency (HEAD_CONCURRENCY) and a per-host cap
 * (HEAD_PER_HOST_CONCURRENCY) so that a batch full of one customer's domain
 * doesn't fan out 150 sockets at once.
 *
 * @param {string[]} urls
 * @param {Object} log
 * @returns {Promise<string[]>} filtered URL list, preserving input order
 */
export async function filterOutConfirmedBrokenUrls(urls, log) {
  if (!Array.isArray(urls) || urls.length === 0) {
    return [];
  }

  const reachable = await runWithHostCap(urls, async (url) => {
    if (!await isUrlSafeToFetch(url, log)) {
      // SSRF-guard rejection is a *confident* drop — we won't HEAD-probe it
      // and we don't want it to land in the customer's suggestion list.
      return false;
    }
    return isUrlReachable(url, log);
  });

  return urls.filter((_, idx) => reachable[idx]);
}
