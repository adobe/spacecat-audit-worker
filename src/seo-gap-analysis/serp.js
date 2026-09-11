/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { hasText } from '@adobe/spacecat-shared-utils';
import { BUCKET } from './constants.js';

/**
 * Extracts a normalized, lower-cased registrable-ish host from a URL.
 * Strips a leading "www." so target/competitor matching is not defeated by the www alias.
 *
 * @param {string} url - The URL to parse.
 * @returns {string|null} The normalized hostname, or null if the URL is unparseable.
 */
export function hostOf(url) {
  if (!hasText(url)) {
    return null;
  }
  try {
    const withProto = url.startsWith('http') ? url : `https://${url}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * True when `host` equals `domain` or is a subdomain of it. Comparison is done on
 * www-stripped, lower-cased hosts so "shop.brand.com" matches a filterDomain of "brand.com".
 *
 * @param {string} host - The candidate host.
 * @param {string} domain - The domain to match against.
 * @returns {boolean}
 */
export function hostMatchesDomain(host, domain) {
  const normalizedDomain = (domain || '').toLowerCase().replace(/^www\./, '');
  if (!host || !normalizedDomain) {
    return false;
  }
  return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
}

/**
 * Heuristic: two hosts share a brand when they share the same second-level label
 * (e.g. "blog.nike.com" and "nike.com" both reduce to "nike"). Deliberately simple —
 * it only needs to catch a target's own alternate hosts appearing in the SERP.
 *
 * @param {string} host - Candidate host.
 * @param {string} targetHost - The target's host.
 * @returns {boolean}
 */
export function sharesBrand(host, targetHost) {
  const label = (h) => {
    const parts = h.split('.');
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  };
  return label(host) === label(targetHost);
}

/**
 * Buckets raw Bright Data organic SERP results relative to the target page.
 *
 * Rules (first match wins):
 * - the target URL's own host                    -> target   (excluded from scraping)
 * - any host matching one of `filterDomains`     -> filtered (excluded from scraping)
 * - a host equal to the target host's brand      -> branded  (same registrable brand, other host)
 * - everything else                              -> competitor
 *
 * Third-party classification is intentionally left as a follow-on refinement; today every
 * non-target, non-filtered, non-branded result is treated as a competitor. The bucket enum
 * still carries THIRD_PARTY so a future heuristic (e.g. marketplaces, directories) can split
 * it out without changing the contract.
 *
 * @param {Array<object>} results - Bright Data organic results (each with a `.link`/`.url`).
 * @param {object} opts
 * @param {string} opts.targetUrl - The URL being optimized.
 * @param {string[]} [opts.filterDomains] - Domains to exclude (owned/partner/noise).
 * @param {number} [opts.maxCompetitors] - Cap on competitor URLs returned.
 * @returns {{ target: object|null, competitors: object[], branded: object[], filtered: object[] }}
 */
export function bucketSerpResults(results, opts) {
  const { targetUrl, filterDomains = [], maxCompetitors = Infinity } = opts;
  const targetHost = hostOf(targetUrl);

  const buckets = {
    target: null,
    competitors: [],
    branded: [],
    filtered: [],
  };

  const seen = new Set();

  (Array.isArray(results) ? results : []).forEach((raw) => {
    const url = raw?.link || raw?.url;
    const host = hostOf(url);
    // Skip unparseable entries, and de-duplicate on the exact URL so the same result
    // listed twice is scraped once.
    if (!host || seen.has(url)) {
      return;
    }
    seen.add(url);

    const entry = {
      url,
      host,
      position: raw?.rank ?? raw?.position ?? null,
      title: raw?.title ?? null,
      snippet: raw?.description ?? raw?.snippet ?? null,
    };

    if (targetHost && host === targetHost) {
      entry.bucket = BUCKET.TARGET;
      // Keep only the first (highest-ranked) target occurrence.
      buckets.target = buckets.target || entry;
    } else if (filterDomains.some((d) => hostMatchesDomain(host, d))) {
      entry.bucket = BUCKET.FILTERED;
      buckets.filtered.push(entry);
    } else if (targetHost && sharesBrand(host, targetHost)) {
      entry.bucket = BUCKET.BRANDED;
      buckets.branded.push(entry);
    } else {
      entry.bucket = BUCKET.COMPETITOR;
      buckets.competitors.push(entry);
    }
  });

  // Preserve SERP order (Bright Data returns ranked) and cap the fan-out.
  buckets.competitors = buckets.competitors.slice(0, maxCompetitors);

  return buckets;
}
