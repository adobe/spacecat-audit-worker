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

import { isUnscrapeable } from '../utils/url-utils.js';
import { extractLocaleFromUrl, localesMatch } from './bright-data-client.js';

const DEFAULT_MAX_SUGGESTED_URLS = 5;

/**
 * Pick multiple candidate URLs from Bright Data organic SERP results.
 * Skips unscrapeable file URLs (PDF, Office, etc.), dedupes, prefers URLs whose
 * locale matches the broken link (same order as Google within each tier).
 *
 * @param {Array<{ link?: string }>} results - Organic results from Bright Data
 * @param {string} brokenLinkUrl - Broken target URL (for locale preference)
 * @param {{ maxUrls?: number }} [options]
 * @returns {string[]}
 */
export function pickUrlsFromSerpResults(results, brokenLinkUrl, options = {}) {
  const maxUrls = Number.isInteger(options.maxUrls) && options.maxUrls > 0
    ? options.maxUrls
    : DEFAULT_MAX_SUGGESTED_URLS;

  if (!Array.isArray(results)) {
    return [];
  }

  const rawLinks = results.map((r) => r?.link).filter(Boolean);
  const links = rawLinks.filter((link) => !isUnscrapeable(link));
  if (links.length === 0) {
    return [];
  }

  const brokenLinkLocale = extractLocaleFromUrl(brokenLinkUrl);
  const seen = new Set();
  const pushUnique = (bucket, link) => {
    const key = link.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(link);
  };

  const localeFirst = [];
  const rest = [];
  for (const link of links) {
    const suggestedLocale = extractLocaleFromUrl(link);
    if (localesMatch(brokenLinkLocale, suggestedLocale)) {
      pushUnique(localeFirst, link);
    } else {
      pushUnique(rest, link);
    }
  }

  return [...localeFirst, ...rest].slice(0, maxUrls);
}
