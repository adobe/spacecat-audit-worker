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

/**
 * Normalize a URL so a supplied fixed URL lines up with how Google reports it:
 * lowercase host, drop the fragment, and strip a trailing slash (except root).
 * Returns the input unchanged if it is not a parseable URL.
 *
 * @param {string} u - a URL string.
 * @returns {string} normalized URL, or the original string if unparseable.
 */
export function normalizeUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${path}${url.search}`;
  } catch {
    return u;
  }
}

/**
 * Build a lookup map of normalized URL -> metrics from GSC page rows.
 *
 * @param {Array<object>} rows - GSC rows (each with keys[0] = page URL).
 * @returns {Map<string, {clicks:number, impressions:number, ctr:number, position:number}>}
 */
export function indexRows(rows) {
  const map = new Map();
  for (const r of rows) {
    map.set(normalizeUrl(r.keys?.[0] ?? ''), {
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    });
  }
  return map;
}

/**
 * Look up one URL's metrics in an indexed map, normalizing first.
 *
 * @param {Map} map - map from indexRows.
 * @param {string} url - the URL to find.
 * @returns {object|null} metrics, or null if the URL is not present.
 */
export function lookup(map, url) {
  return map.get(normalizeUrl(url)) ?? null;
}
