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
 * Path segments that indicate dynamic or transient content by nature.
 * Such pages should not be summarized (LLMO-3181).
 */
const DYNAMIC_PATH_SEGMENTS = new Set([
  'search',
  'filter',
  'results',
  'feed',
  'feeds',
  'dashboard',
  'cart',
  'checkout',
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'account',
  'accounts',
  'admin',
  'api',
  'compare',
  'wishlist',
  'payment',
  'payments',
]);

/**
 * Returns true if the URL path suggests dynamic content (search, filter, feed, cart, etc.).
 * @param {string} url - Full URL or pathname
 * @returns {boolean}
 */
export function isDynamicPageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  let pathname;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      pathname = new URL(url).pathname;
    } else {
      pathname = url.startsWith('/') ? url : `/${url}`;
    }
  } catch {
    return false;
  }
  const segments = pathname.split('/').filter(Boolean).map((s) => s.toLowerCase());
  return segments.some((seg) => DYNAMIC_PATH_SEGMENTS.has(seg));
}

/**
 * Filters out URLs that look like dynamic pages. Keeps order.
 * @param {string[]} urls
 * @returns {string[]}
 */
export function filterOutDynamicUrls(urls) {
  if (!Array.isArray(urls)) return [];
  return urls.filter((url) => !isDynamicPageUrl(url));
}
