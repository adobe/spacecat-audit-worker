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
 * Extracts a path pattern from a URL for grouping purposes.
 * Groups URLs by their first 2 path segments to ensure content diversity.
 *
 * Examples:
 *   /products/shoes/nike-air-max → /products/shoes/*
 *   /blog/2024/seo-tips → /blog/2024/*
 *   /de/products/shoes → /de/products/*
 *   /about → /about/*
 *
 * @param {string} url - The URL to extract pattern from
 * @returns {string} The path pattern
 */
export function extractPathPattern(url) {
  try {
    const urlObj = new URL(url);
    const segments = urlObj.pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return '/*';
    }

    if (segments.length === 1) {
      return `/${segments[0]}/*`;
    }

    // Use first 2 segments as the pattern
    return `/${segments[0]}/${segments[1]}/*`;
  } catch {
    return '/unknown/*';
  }
}

/**
 * Groups URLs by their path pattern.
 *
 * @param {string[]} urls - Array of URLs to group
 * @returns {Object<string, string[]>} Map of pattern to URLs
 */
export function groupUrlsByPattern(urls) {
  const groups = {};

  for (const url of urls) {
    const pattern = extractPathPattern(url);
    if (!groups[pattern]) {
      groups[pattern] = [];
    }
    groups[pattern].push(url);
  }

  return groups;
}

/**
 * Smart samples URLs to ensure content diversity across different path patterns.
 * Instead of just taking the first N URLs (which might all be from /products/),
 * this function samples proportionally from each content group.
 *
 * @param {string[]} urls - Array of URLs to sample from
 * @param {number} maxUrls - Maximum number of URLs to return (default: 200)
 * @param {Function} log - Optional logger function
 * @returns {string[]} Sampled URLs with content diversity
 */
export function smartSampleUrls(urls, maxUrls = 200, log = null) {
  if (!urls || urls.length === 0) {
    return [];
  }

  if (urls.length <= maxUrls) {
    return urls;
  }

  // Group URLs by path pattern
  const groups = groupUrlsByPattern(urls);
  const patternCount = Object.keys(groups).length;

  if (log) {
    log.info(`Smart sampling: ${urls.length} URLs grouped into ${patternCount} patterns`);
  }

  // Calculate how many URLs to take from each group
  const perGroup = Math.ceil(maxUrls / patternCount);

  // Sample from each group, preserving original order within groups
  const sampled = [];
  for (const [pattern, groupUrls] of Object.entries(groups)) {
    const take = Math.min(perGroup, groupUrls.length);
    sampled.push(...groupUrls.slice(0, take));

    if (log) {
      log.debug(`  Pattern "${pattern}": ${groupUrls.length} URLs, sampled ${take}`);
    }
  }

  // If we have more than maxUrls after proportional sampling, trim to maxUrls
  const result = sampled.slice(0, maxUrls);

  if (log) {
    log.info(`Smart sampling result: ${result.length} URLs (from ${urls.length} total)`);
  }

  return result;
}

export default {
  extractPathPattern,
  groupUrlsByPattern,
  smartSampleUrls,
};
