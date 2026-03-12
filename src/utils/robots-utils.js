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

import robotsParser from 'robots-parser';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

/**
 * Fetches and parses the robots.txt for a given site URL.
 *
 * The siteUrl may be a full URL (https://example.com) or a bare hostname (example.com).
 * The parsed object exposes `isAllowed(url, userAgent)` and `getMatchingLineNumber(url, userAgent)`
 * from the `robots-parser` library.
 *
 * @param {string} siteUrl - Base URL or hostname of the site.
 * @param {object} log - Logger instance.
 * @returns {Promise<import('robots-parser').IParseResult|null>} Parsed robots object, or null.
 */
export async function fetchRobotsTxt(siteUrl, log) {
  try {
    const base = siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`;
    const { origin } = new URL(base);
    const robotsUrl = `${origin}/robots.txt`;

    log.debug(`[robots-utils] Fetching ${robotsUrl}`);
    const response = await fetch(robotsUrl);
    const content = await response.text();

    const parsed = robotsParser(robotsUrl, content);
    parsed.robotsUrl = robotsUrl;
    return parsed;
  } catch (error) {
    log.warn(`[robots-utils] Failed to fetch/parse robots.txt for ${siteUrl}: ${error.message}`);
    return null;
  }
}

/**
 * Returns true when `url` is disallowed for the given user-agent by the parsed robots.txt.
 * Always returns false when `robots` is null (treat missing robots.txt as permissive).
 *
 * @param {import('robots-parser').IParseResult|null} robots - Parsed robots object.
 * @param {string} url - Fully-qualified URL to test.
 * @param {string} [userAgent='*'] - User-agent string to test against.
 * @returns {boolean}
 */
export function isDisallowedByRobots(robots, url, userAgent = '*') {
  if (!robots) return false;
  // robots-parser returns undefined when the URL cannot be matched to the robots.txt origin
  // (e.g. relative/malformed URLs). Treat undefined as "allowed" rather than "disallowed".
  return robots.isAllowed(url, userAgent) === false;
}

/**
 * Filters `urls` to remove entries disallowed by robots.txt for `userAgent`.
 *
 * When `robots` is null (e.g. robots.txt could not be fetched) the original
 * array is returned unchanged so the audit continues without robots filtering.
 *
 * @param {import('robots-parser').IParseResult|null} robots - Parsed robots object.
 * @param {string[]} urls - Fully-qualified URLs to filter.
 * @param {object} log - Logger instance.
 * @param {string} [userAgent='*'] - User-agent string to test against.
 * @returns {string[]} Subset of `urls` that are allowed.
 */
export function filterUrlsByRobots(robots, urls, log, userAgent = '*') {
  if (!robots) {
    log.warn('[robots-utils] robots.txt unavailable — skipping robots filtering');
    return urls;
  }

  const robotsUrl = robots.robotsUrl ?? 'unknown';
  const allowed = [];
  const disallowed = [];

  for (const url of urls) {
    if (isDisallowedByRobots(robots, url, userAgent)) {
      disallowed.push(url);
    } else {
      allowed.push(url);
    }
  }

  if (disallowed.length > 0) {
    log.info(
      `[robots-utils] ${robotsUrl}: excluded ${disallowed.length} URL(s) disallowed by robots.txt: ${JSON.stringify(disallowed)}`,
    );
  }

  return allowed;
}
