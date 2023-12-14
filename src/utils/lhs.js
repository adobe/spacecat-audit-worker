/*
 * Copyright 2023 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { fetch } from '../support/utils.js';

/**
 * Extracts audit scores from an audit.
 *
 * @param {Object} categories - The categories object from the audit.
 * @return {Object} - The extracted audit scores.
 */
export function extractAuditScores(categories) {
  const {
    performance, seo, accessibility, 'best-practices': bestPractices,
  } = categories;
  return {
    performance: performance.score,
    seo: seo.score,
    accessibility: accessibility.score,
    'best-practices': bestPractices.score,
  };
}

/**
 * Extracts total blocking time from an audit.
 *
 * @param {Object} psiAudit - The audit to extract tbt from.
 * @return {Object} - The extracted tbt.
 */
export function extractTotalBlockingTime(psiAudit) {
  return psiAudit?.['total-blocking-time']?.numericValue || null;
}

/**
 * Extracts third party summary from an audit.
 *
 * @param {Object} psiAudit - The audit to extract third party summary from.
 * @return {Object} - The extracted third party summary.
 */
export function extractThirdPartySummary(psiAudit) {
  const items = psiAudit?.['third-party-summary']?.details?.items || [];

  return Object.values(items)
    .map((item) => ({
      entity: item.entity,
      blockingTime: item.blockingTime,
      mainThreadTime: item.mainThreadTime,
      transferSize: item.transferSize,
    }));
}

/**
 * Retrieves the last modified date of the content from a given URL. If the URL is not accessible,
 * the function returns the current date in ISO format.
 * @param {string} baseUrl - The base URL from which to fetch the content's last modified date.
 * @param {Object} log - Logger object for error logging.
 * @returns {Promise<string>} - A promise that resolves to the content's
 * last modified date in ISO format.
 */
export async function getContentLastModified(baseUrl, log) {
  let lastModified = new Date();
  try {
    const response = await fetch(baseUrl, { method: 'HEAD' });
    if (response.ok) {
      const headerValue = response.headers.get('last-modified');
      if (headerValue && !Number.isNaN(new Date(headerValue).getTime())) {
        lastModified = new Date(headerValue);
      }
    } else {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    log.error(`Error fetching content last modified for ${baseUrl}: ${error.message}`);
  }

  return lastModified.toISOString();
}
