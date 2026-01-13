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

import { hasText } from '@adobe/spacecat-shared-utils';

/**
 * Issue rankings for SEO metatags audit.
 * Lower number = higher priority/impact.
 */
const issueRankings = {
  title: {
    missing: 1,
    empty: 2,
    duplicate: 5,
    long: 8,
    short: 8,
  },
  description: {
    missing: 3,
    empty: 3,
    duplicate: 6,
    long: 9,
    short: 9,
  },
  h1: {
    missing: 4,
    empty: 4,
    duplicate: 7,
    long: 10,
    multiple: 11,
  },
};

/**
 * Trims whitespace from string or array of strings.
 * Used for cleaning scraped meta tag content (title, description, h1).
 * @param {string|string[]|null|undefined} value - Value to trim
 * @returns {string|string[]|null|undefined|*} - Trimmed value(s), or original value
 * if not a string/array
 */
export function trimTagValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : item));
  }
  return typeof value === 'string' ? value.trim() : value;
}

/**
 * Normalizes a tag value to a single string for comparison/matching.
 * Handles both string and array values, converts to lowercase by default.
 * Used for error detection and keyword matching in scraped content.
 * @param {string|string[]|null|undefined} value - Tag value from scraper
 * @param {boolean} toLowerCase - Whether to convert to lowercase (default: true)
 * @returns {string} Normalized string value (empty string if null/undefined)
 * @example
 * normalizeTagValue('Error Page') // 'error page'
 * normalizeTagValue(['404 Error', 'Not Found']) // '404 error'
 * normalizeTagValue(null) // ''
 */
export function normalizeTagValue(value, toLowerCase = true) {
  if (value === null || value === undefined) {
    return '';
  }

  let normalized = '';
  if (Array.isArray(value)) {
    // Take first non-empty value from array
    const firstValue = value.find((v) => typeof v === 'string' && v.trim());
    normalized = firstValue || '';
  } else if (typeof value === 'string') {
    normalized = value;
  }

  return toLowerCase ? normalized.toLowerCase() : normalized;
}

/**
 * Returns the tag issue rank based on SEO impact.
 * The rank helps in sorting issues by priority.
 * Ranking (low number means high rank):
 * 1. Missing Title
 * 2. Empty Title
 * 3. Missing Description / Empty Description
 * 4. Missing H1 / Empty H1
 * 5. Duplicate Title
 * 6. Duplicate Description
 * 7. Duplicate H1
 * 8. Title Too Long/Short
 * 9. Description Too Long/Short
 * 10. H1 Too Long
 * 11. Multiple H1 on a Page
 * @param {string} tagName - The tag name (title, description, h1)
 * @param {string} issue - The issue description
 * @returns {number} Ranking number (-1 if not found)
 */
export function getIssueRanking(tagName, issue) {
  // Add null checks
  if (!hasText(tagName)) {
    return -1;
  }

  if (!hasText(issue)) {
    return -1;
  }

  const tagIssues = issueRankings[tagName.toLowerCase()];

  if (!tagIssues) {
    return -1;
  }

  const issueWords = issue.toLowerCase().split(' ');
  for (const word of issueWords) {
    if (tagIssues[word]) {
      return tagIssues[word];
    }
  }
  return -1;
}

/**
 * Extracts hreflang links from HTML content.
 * Shared utility that can be used by hreflang audit, sitemap audit, or any other audit.
 *
 * @param {CheerioAPI} $ - Cheerio instance with loaded HTML
 * @param {string} sourceUrl - URL of the page being analyzed (for context/logging)
 * @returns {Array<{hreflang: string, href: string, isInHead: boolean}>} Array of hreflang links
 */
export function extractHreflangLinks($, sourceUrl) {
  const hreflangLinks = [];
  const $links = $('link[rel="alternate"][hreflang]');

  $links.each((i, link) => {
    const $link = $(link);
    const hreflang = $link.attr('hreflang');
    const href = $link.attr('href');
    const isInHead = $link.closest('head').length > 0;

    if (hreflang && href) {
      // Resolve relative URLs to absolute
      let absoluteHref = href;
      try {
        absoluteHref = new URL(href, sourceUrl).href;
      } catch {
        // If URL construction fails, keep original href
      }

      hreflangLinks.push({
        hreflang,
        href: absoluteHref,
        isInHead,
      });
    }
  });

  return hreflangLinks;
}

/**
 * Checks if a set of hreflang links contains a reference back to a specific URL.
 * Used to validate reciprocal hreflang relationships.
 *
 * @param {string} targetUrl - The URL we expect to find in the hreflang links
 * @param {string} expectedHreflang - The expected hreflang value (e.g., 'en', 'fr-CA')
 * @param {Array<{hreflang: string, href: string}>} hreflangLinks - Links found on the page
 * @returns {boolean} True if reciprocal link exists
 */
export function hasReciprocalLink(targetUrl, expectedHreflang, hreflangLinks) {
  if (!targetUrl || !expectedHreflang || !Array.isArray(hreflangLinks)) {
    return false;
  }

  // Normalize URLs for comparison (remove trailing slashes, fragments, etc.)
  const normalizeUrl = (url) => {
    try {
      const parsed = new URL(url);
      // Remove trailing slash and fragment
      return `${parsed.origin}${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
    } catch {
      return url;
    }
  };

  const normalizedTarget = normalizeUrl(targetUrl);

  return hreflangLinks.some((link) => {
    const normalizedHref = normalizeUrl(link.href);
    return normalizedHref === normalizedTarget && link.hreflang === expectedHreflang;
  });
}

/**
 * Builds the complete expected set of hreflang links for reciprocal validation.
 * Each alternate page should reference all other alternates (including itself).
 *
 * @param {string} sourceUrl - The original page URL
 * @param {Array<{hreflang: string, href: string}>} sourceLinks - Links from source page
 * @returns {Map<string, Set<string>>} Map of URL -> Set of expected hreflang values
 */
export function buildExpectedHreflangSet(sourceUrl, sourceLinks) {
  const expectedSet = new Map();

  // Each alternate page should have ALL hreflang links from the source
  sourceLinks.forEach((link) => {
    if (!expectedSet.has(link.href)) {
      expectedSet.set(link.href, new Set());
    }

    // Add all hreflang values (all alternates should reference each other)
    sourceLinks.forEach((otherLink) => {
      expectedSet.get(link.href).add(otherLink.hreflang);
    });
  });

  return expectedSet;
}
