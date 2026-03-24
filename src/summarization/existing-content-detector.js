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

import { load as cheerioLoad } from 'cheerio';
import { getObjectFromKey } from '../utils/s3-utils.js';

/** Heading titles that indicate existing summary content (aligned with Mystique). */
const SUMMARY_HEADINGS = new Set([
  'summary', 'overview', 'tl;dr', 'tldr', 'executive summary', 'abstract',
]);

/** Heading titles that indicate existing key points content (aligned with Mystique). */
const KEY_POINTS_HEADINGS = new Set([
  'key points', 'key takeaways', 'main highlights',
  "what you'll learn", 'what you will learn',
  'highlights', 'main points', 'takeaways',
]);

/**
 * Extracts heading text from HTML and detects if summary/key-points sections exist.
 * @param {string} rawBody - HTML content
 * @returns {{ hasSummary: boolean, hasKeyPoints: boolean }}
 */
function detectFromHtml(rawBody) {
  const result = { hasSummary: false, hasKeyPoints: false };
  if (!rawBody || typeof rawBody !== 'string') {
    return result;
  }
  try {
    const $ = cheerioLoad(rawBody);
    const headings = $('h1, h2, h3, h4, h5, h6');
    headings.each((_, el) => {
      const title = $(el).text().toLowerCase().trim();
      if (SUMMARY_HEADINGS.has(title)) {
        result.hasSummary = true;
      }
      if (KEY_POINTS_HEADINGS.has(title)) {
        result.hasKeyPoints = true;
      }
    });
  } catch (err) {
    // On parse error, return false for both
  }
  return result;
}

/**
 * Detects existing summary and key points content for each scraped page.
 * Fetches HTML from S3, parses with cheerio, and checks heading patterns.
 *
 * @param {object} s3Client - S3 client
 * @param {string} bucketName - S3 bucket name
 * @param {Map<string, string>} scrapeResultPaths - Map of URL to S3 key
 * @param {object} log - Logger (info, warn, error)
 * @returns {Promise<Map<string, { hasSummary: boolean, hasKeyPoints: boolean }>>}
 */
export async function detectExistingContent(s3Client, bucketName, scrapeResultPaths, log) {
  const result = new Map();
  if (!scrapeResultPaths || scrapeResultPaths.size === 0) {
    return result;
  }

  log.info(`[Summarization] Detecting existing content for ${scrapeResultPaths.size} pages`);

  const promises = Array.from(scrapeResultPaths.entries()).map(async ([url, s3Path]) => {
    try {
      const scrapedData = await getObjectFromKey(s3Client, bucketName, s3Path, log);
      const rawBody = scrapedData?.scrapeResult?.rawBody;
      if (!rawBody) {
        log.warn(`[Summarization] No rawBody for ${url}`);
        return [url, { hasSummary: false, hasKeyPoints: false }];
      }
      const detected = detectFromHtml(rawBody);
      return [url, detected];
    } catch (error) {
      log.error(`[Summarization] Error detecting content for ${url}: ${error.message}`);
      return [url, { hasSummary: false, hasKeyPoints: false }];
    }
  });

  const resolved = await Promise.all(promises);
  resolved.forEach(([url, detected]) => result.set(url, detected));

  const excludedCount = Array.from(result.values()).filter(
    (d) => d.hasSummary && d.hasKeyPoints,
  ).length;
  if (excludedCount > 0) {
    log.info(`[Summarization] Pre-check: ${excludedCount} page(s) already have summary and key points, excluded from Mystique`);
  }

  return result;
}

export { detectFromHtml };
