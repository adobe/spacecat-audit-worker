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

const DEFAULT_ITEM_TYPE = 'link';

export function normalizeComparableUrl(url) {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();

    /* c8 ignore next 4 - URL constructor auto-normalizes default ports; defensive guard */
    if ((parsed.protocol === 'https:' && parsed.port === '443')
      || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }

    if (parsed.pathname !== '/') {
      const stripped = parsed.pathname.replace(/\/+$/, '');
      /* c8 ignore next */
      parsed.pathname = stripped || '/';
    }

    return parsed.toString();
  } catch (error) {
    return url;
  }
}

export function getUrlCacheKey(url) {
  return normalizeComparableUrl(url);
}

export function buildBrokenLinkKey(link) {
  return [
    normalizeComparableUrl(link.urlFrom),
    normalizeComparableUrl(link.urlTo),
    link.itemType || DEFAULT_ITEM_TYPE,
  ].join('|');
}
