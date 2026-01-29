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

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

/**
 * Get object from S3 by key
 * @param {S3Client} s3Client - S3 client instance
 * @param {string} bucketName - S3 bucket name
 * @param {string} key - Object key
 * @param {object} log - Logger instance
 * @returns {Promise<object|string|null>} Parsed JSON object, string, or null if not found
 */
async function getObjectFromKey(s3Client, bucketName, key, log) {
  if (!s3Client || !bucketName || !key) {
    log.error(
      'Invalid input parameters in getObjectFromKey: ensure s3Client, bucketName, and key are provided.',
    );
    return null;
  }

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  try {
    const response = await s3Client.send(command);
    const contentType = response.ContentType;
    const body = await response.Body.transformToString();

    if (contentType && contentType.includes('application/json')) {
      try {
        return JSON.parse(body);
      } catch (parseError) {
        log.error(`Unable to parse content for key ${key}`, parseError);
        return null;
      }
    }
    // Always return body for non-JSON content types
    return body;
  } catch (err) {
    log.debug(
      `Error while fetching S3 object from bucket ${bucketName} using key ${key}: ${err.message}`,
    );
    return null;
  }
}

/**
 * Initialize S3 client
 * @returns {S3Client} S3 client instance
 */
function initializeS3Client() {
  const region = process.env.AWS_REGION || 'us-east-1';
  return new S3Client({ region });
}

/**
 * Extract path from URL
 * @param {string} url - Full URL
 * @returns {string} Path portion of URL (e.g., '/en/products/item.html')
 */
function extractPathFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname;
  } catch (error) {
    // If URL is invalid, return as-is
    return url;
  }
}

/**
 * Fetch scraped page content from S3
 * Based on src/support/utils.js getScrapeForPath
 *
 * @param {string} url - Full URL to fetch scrape for
 * @param {string} siteId - Site UUID
 * @param {object} log - Logger instance
 * @returns {Promise<object|null>} Scraped content or null if not found
 */
export async function fetchScrapedPage(url, siteId, log) {
  const s3Client = initializeS3Client();
  const bucketName = process.env.S3_SCRAPER_BUCKET_NAME || 'spacecat-scraper-results';

  // Extract path from URL
  const path = extractPathFromUrl(url);

  // Normalize path: remove trailing slashes to avoid double slashes in key
  const normalizedPath = path.replace(/\/+$/, '');

  // Construct S3 key: scrapes/{siteId}{path}/scrape.json
  const key = `scrapes/${siteId}${normalizedPath}/scrape.json`;

  /* eslint-disable-next-line no-console */
  console.log(`Fetching scrape from S3: ${key}`);

  const result = await getObjectFromKey(s3Client, bucketName, key, log);

  if (!result) {
    log.debug(`No scrape found for URL ${url} at key ${key}`);
    return null;
  }

  return result;
}

export default fetchScrapedPage;
