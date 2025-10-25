/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { context as fetchContext } from '@adobe/fetch';
import * as cheerio from 'cheerio';
import { hasText } from '@adobe/spacecat-shared-utils';

const { fetch } = fetchContext();

/**
 * Validates missing meta tags using SSR content fetched via HTTP.
 * This is useful as a fallback when Puppeteer fails to capture tags that load with delays.
 *
 * @param {string} url - The URL to validate
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Object containing title, description, and h1 tags found via SSR
 */
export async function validateMetaTagsViaSSR(url, log) {
  try {
    log.debug(`Validating meta tags via SSR for: ${url}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Spacecat/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      log.warn(`SSR validation failed with status ${response.status} for ${url}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('title').first().text()?.trim() || null;
    const description = $('meta[name="description"]').attr('content')?.trim() || null;

    const h1Tags = [];
    $('h1').each((_, element) => {
      const text = $(element).text()?.trim();
      if (hasText(text)) {
        h1Tags.push(text);
      }
    });

    const result = {
      title: hasText(title) ? title : null,
      description: hasText(description) ? description : null,
      h1: h1Tags.length > 0 ? h1Tags : null,
    };
    log.debug(`SSR validation result for ${url}: title=${!!result.title}, description=${!!result.description}, h1Count=${h1Tags.length}`);
    return result;
  } catch (error) {
    log.warn(`Error during SSR validation for ${url}: ${error.message}`);
    return null;
  }
}

/**
 * Validates if detected issues are false positives by checking SSR content.
 * Updates the detectedTags object to remove false positives.
 *
 * @param {Object} detectedTags - Object containing detected tag issues by endpoint
 * @param {string} baseUrl - Base URL of the site
 * @param {Object} log - Logger instance
 * @returns {Promise<Object>} Updated detectedTags with false positives removed
 */
export async function validateDetectedIssues(detectedTags, baseUrl, log) {
  const endpoints = Object.keys(detectedTags);

  if (endpoints.length === 0) {
    return detectedTags;
  }
  log.debug(`Validating ${endpoints.length} endpoints with detected issues via SSR`);
  const updatedDetectedTags = { ...detectedTags };
  let falsePositivesRemoved = 0;

  // Process endpoints sequentially to avoid overwhelming the server
  for (const endpoint of endpoints) {
    const tags = updatedDetectedTags[endpoint];
    const fullUrl = `${baseUrl}${endpoint}`;

    // Check if any of the issues are related to missing tags
    const hasMissingIssues = ['title', 'description', 'h1'].some(
      (tagName) => tags[tagName]?.issue?.includes('Missing'),
    );

    if (hasMissingIssues) {
      // Validate via SSR
      // eslint-disable-next-line no-await-in-loop
      const ssrResult = await validateMetaTagsViaSSR(fullUrl, log);

      if (ssrResult) {
        // Check each tag type and remove false positives
        const tagNames = ['title', 'description', 'h1'];
        for (const tagName of tagNames) {
          if (tags[tagName]?.issue?.includes('Missing') && ssrResult[tagName]) {
            log.info(`False positive detected for ${tagName} on ${endpoint} - tag exists in SSR`);
            delete updatedDetectedTags[endpoint][tagName];
            falsePositivesRemoved += 1;
          }
        }

        // If all issues were false positives, remove the endpoint entirely
        if (Object.keys(updatedDetectedTags[endpoint]).length === 0) {
          delete updatedDetectedTags[endpoint];
        }

        // Add a small delay to avoid rate limiting
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => {
          setTimeout(resolve, 100);
        });
      }
    }
  }
  log.info(`SSR validation complete. Removed ${falsePositivesRemoved} false positives from ${endpoints.length} endpoints`);
  return updatedDetectedTags;
}
