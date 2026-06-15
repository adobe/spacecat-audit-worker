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
import { scoreSuggestion } from './suggestion-score.js';

const DEFAULT_MAX_SUGGESTED_URLS = 5;

/**
 * Pick and rank candidate URLs from Bright Data organic SERP results.
 * Each URL is scored against the broken link (path overlap, section, slug, etc.).
 * URLs with score 0 (wrong domain, homepage, unrelated) are discarded.
 * Remaining URLs are sorted: locale-matching first, then by descending score.
 *
 * @param {Array<{ link?: string }>} results - Organic results from Bright Data
 * @param {string} brokenLinkUrl - Broken target URL (for scoring and locale preference)
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
  const scored = [];

  for (const link of links) {
    const key = link.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);

      const { score } = scoreSuggestion(brokenLinkUrl, link);
      if (score > 0) {
        const localeMatch = localesMatch(brokenLinkLocale, extractLocaleFromUrl(link));
        scored.push({ link, score, localeMatch });
      }
    }
  }

  scored.sort((a, b) => {
    if (a.localeMatch !== b.localeMatch) {
      return a.localeMatch ? -1 : 1;
    }
    return b.score - a.score;
  });

  return scored.map((s) => s.link).slice(0, maxUrls);
}
