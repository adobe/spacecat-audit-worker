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

import { prependSchema, stripWWW } from '@adobe/spacecat-shared-utils';

const CROSS_SCOPE_SHARED_ITEM_TYPES = new Set([
  'form',
  'image',
  'svg',
  'css',
  'js',
  'iframe',
  'video',
  'audio',
  'media',
]);

function isLocaleLikePathSegment(segment) {
  return /^[a-z]{2}(?:[-_][a-z0-9]{2,8}){0,2}$/i.test(segment);
}

function parseAgainstBase(url, parsedBaseURL) {
  /* c8 ignore next 3 - Defensive fallback; current callers guard empty urls upfront */
  if (!url) {
    return null;
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    return new URL(prependSchema(url));
  }

  return new URL(url, parsedBaseURL);
}

export function isSharedInternalResource(url, baseURL, itemType) {
  if (!url || !baseURL || !CROSS_SCOPE_SHARED_ITEM_TYPES.has(itemType)) {
    return false;
  }

  try {
    const parsedBaseURL = new URL(prependSchema(baseURL));
    const basePath = parsedBaseURL.pathname;
    const hasBasePath = basePath && basePath !== '/';

    if (!hasBasePath) {
      return false;
    }

    const parsedUrl = parseAgainstBase(url, parsedBaseURL);
    const normalizedUrlHost = stripWWW(parsedUrl.hostname);
    const normalizedBaseHost = stripWWW(parsedBaseURL.hostname);
    if (normalizedUrlHost !== normalizedBaseHost || parsedUrl.port !== parsedBaseURL.port) {
      return false;
    }

    const basePathWithSlash = `${basePath}/`;
    return !(parsedUrl.pathname.startsWith(basePathWithSlash) || parsedUrl.pathname === basePath);
  } catch (error) {
    return false;
  }
}

export function extractLocalePathPrefix(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(prependSchema(url));
    const { pathname } = parsed;

    if (!pathname || pathname === '/') {
      return '';
    }

    const segments = pathname.split('/').filter((seg) => seg.length > 0);
    if (segments.length === 0) {
      return '';
    }

    return isLocaleLikePathSegment(segments[0]) ? `/${segments[0]}` : '';
  } catch (error) {
    return '';
  }
}
