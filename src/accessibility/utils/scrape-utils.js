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
import { getObjectKeysFromSubfolders } from './data-processing.js';

/**
 * Normalizes a URL by ensuring it ends with a trailing slash.
 * This function is pure and easily testable.
 * Exported for testing purposes.
 * @param {string} url The URL to normalize.
 * @returns {string} The normalized URL.
 */
export function normalizeUrl(url) {
  if (!url) {
    return '/';
  }
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * Reconstructs a URL from an S3 object key.
 * The key is expected to encode a URL in its filename, like '.../www_example_com_path_page.json'.
 * This function is pure and can be tested in isolation.
 * Exported for testing purposes.
 *
 * NOTE: This reconstruction logic is based on the original implementation and assumes
 * a specific format for the file name. It might be fragile if the domain structure varies
 * unexpectedly (e.g. example.com vs www.example.com vs sub.example.co.uk).
 *
 * @param {string} key The S3 object key.
 * @returns {string} The reconstructed URL.
 */
export function reconstructUrlFromS3Key(key) {
  const fileName = key.split('/').pop();
  if (!fileName) {
    return '';
  }

  const urlPath = fileName.replace('.json', '');
  const pieces = urlPath.split('_');
  const dotIndex = pieces.includes('www') ? 2 : 1;

  const almostFullUrl = pieces.reduce((acc, piece, index) => {
    if (index < dotIndex) {
      return `${acc}${piece}.`;
    }
    if (pieces[index + 1] === 'html') {
      return `${acc}${piece}.`;
    }
    return `${acc}${piece}/`;
  }, '');

  return `https://${almostFullUrl}`;
}

/**
 * Fetches existing URLs from previously failed audits stored in S3.
 *
 * @param {S3Client} s3Client - The S3 client instance.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {string} siteId - The ID of the site being audited.
 * @param {object} log - The logger instance.
 * @returns {Promise<string[]>} A promise that resolves to an array of existing URLs.
 */
export async function getExistingUrlsFromFailedAudits(s3Client, bucketName, siteId, log) {
  const version = new Date().toISOString().split('T')[0];
  try {
    const { objectKeys } = await getObjectKeysFromSubfolders(
      s3Client,
      bucketName,
      'accessibility',
      siteId,
      version,
      log,
    );

    if (!objectKeys || objectKeys.length === 0) {
      log.info('[A11yAudit] No existing URLs from failed audits found.');
      return [];
    }

    log.info(`[A11yAudit] Found ${objectKeys.length} existing URLs from failed audits.`);
    // Reconstruct URLs and filter out any empty results from malformed keys
    return objectKeys.map(reconstructUrlFromS3Key).filter(Boolean);
  } catch (error) {
    log.error(`[A11yAudit] Error getting existing URLs from failed audits: ${error.message}`);
    return []; // Return empty array on error to prevent downstream issues
  }
}

/**
 * Filters a list of URLs to scrape, removing those that already have a failed audit.
 *
 * @param {Array<{url: string}>} urlsToScrape - An array of objects, each with a URL to scrape.
 * @param {string[]} existingUrls - An array of URLs that have existing failed audits.
 * @returns {Array<{url: string}>} The filtered array of URLs to scrape.
 */
export function getRemainingUrls(urlsToScrape, existingUrls) {
  // Using a Set for efficient lookups (O(1) average time complexity)
  const existingUrlSet = new Set(existingUrls.map(normalizeUrl));

  return urlsToScrape.filter((item) => {
    const normalizedUrl = normalizeUrl(item.url);
    return !existingUrlSet.has(normalizedUrl);
  });
}
