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
import { getObjectFromKey } from '../../utils/s3-utils.js';

/**
 * Fetches existing URLs from previously failed audits stored in S3.
 *
 * @param {S3Client} s3Client - The S3 client instance.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {string} siteId - The ID of the site being audited.
 * @param {object} log - The logger instance.
 * @returns {Promise<string[]>} A promise that resolves to an array of existing URLs.
 */
export async function getExistingObjectKeysFromFailedAudits(s3Client, bucketName, siteId, log) {
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
    return objectKeys;
  } catch (error) {
    log.error(`[A11yAudit] Error getting existing URLs from failed audits: ${error.message}`);
    return []; // Return empty array on error to prevent downstream issues
  }
}

/**
 * Extracts URLs from the settled results of promise executions.
 * This function is pure and easily testable.
 * Exported for testing purposes.
 * @param {SettledAuditResult[]} settledResults - An array of settled promise results.
 * @returns {string[]} An array of successfully extracted URLs.
 */
export function extractUrlsFromSettledResults(settledResults) {
  return settledResults
    .filter((result) => result.status === 'fulfilled' && result.value?.data?.url)
    .map((result) => result.value.data.url);
}

/**
 * Reconstructs URLs from S3 object keys.
 *
 * @param {S3Client} s3Client - The S3 client instance.
 * @param {string} bucketName - The name of the S3 bucket.
 * @param {object} log - The logger instance.
 * @param {string[]} existingObjectKeys - An array of S3 object keys.
 * @returns {Promise<string[]>} A promise that resolves to an array of existing URLs.
 */
export async function getExistingUrlsFromFailedAudits(
  s3Client,
  bucketName,
  log,
  existingObjectKeys,
) {
  const processFilePromises = existingObjectKeys.map(async (key) => {
    const object = await getObjectFromKey(s3Client, bucketName, key, log);
    return { data: object };
  });

  // Use Promise.allSettled to handle potential failures without stopping the entire process
  const settledResults = await Promise.allSettled(processFilePromises);

  return extractUrlsFromSettledResults(settledResults);
}

/**
 * Filters a list of URLs to scrape, removing those that already have a failed audit.
 *
 * @param {Array<{url: string}>} urlsToScrape - An array of objects, each with a URL to scrape.
 * @param {string[]} existingUrls - An array of URLs that have existing failed audits.
 * @returns {Array<{url: string}>} The filtered array of URLs to scrape.
 */
export function getRemainingUrls(urlsToScrape, existingUrls) {
  const existingUrlSet = new Set(existingUrls);
  return urlsToScrape.filter((item) => !existingUrlSet.has(item.url));
}

/**
 * Filters opportunities to find accessibility-related ones that need to be ignored.
 * This is a pure function that can be easily tested.
 *
 * @param {Array} opportunities - Array of opportunity objects
 * @returns {Array} Filtered array of accessibility opportunities
 */
export function filterAccessibilityOpportunities(opportunities) {
  return opportunities.filter((oppty) => oppty.getStatus() === 'NEW'
    && oppty.getType() === 'generic-opportunity'
    && oppty.getTags().includes('a11y')
    && oppty.getTitle().includes('Accessibility report - Desktop'));
}

/**
 * Updates the status of an opportunity and saves it.
 *
 * @param {Object} oppty - The opportunity object
 * @param {string} status - The new status to set
 * @returns {Promise<Object>} The updated opportunity object
 */
export async function updateStatusAndSave(oppty, status) {
  oppty.setStatus(status);
  await oppty.save();
  return oppty;
}

/**
 * Updates the status of accessibility opportunities to IGNORED.
 *
 * @param {Object} dataAccess - Data access object containing Opportunity model
 * @param {string} siteId - The ID of the site
 * @param {Object} log - Logger instance
 * Result of the operation
 * @returns {Promise<{success: boolean, updatedCount: number, error?: string}>}
 */
export async function updateStatusToIgnored(dataAccess, siteId, log) {
  try {
    const { Opportunity } = dataAccess;
    const opportunities = await Opportunity.allBySiteId(siteId);
    log.info(`[A11yAudit] Found ${opportunities.length} opportunities for site ${siteId}`);

    if (opportunities.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const accessibilityOppties = filterAccessibilityOpportunities(opportunities);
    log.info(`[A11yAudit] Found ${accessibilityOppties.length} opportunities to update to IGNORED for site ${siteId}`);

    if (accessibilityOppties.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const updateResults = await Promise.allSettled(
      accessibilityOppties.map((oppty) => updateStatusAndSave(oppty, 'IGNORED')),
    );

    const successfulUpdates = updateResults.filter((result) => result.status === 'fulfilled').length;
    const failedUpdates = updateResults.filter((result) => result.status === 'rejected');

    if (failedUpdates.length > 0) {
      log.error(`[A11yAudit] Failed to update ${failedUpdates.length} opportunities: ${JSON.stringify(failedUpdates)}`);
    }

    return {
      success: failedUpdates.length === 0,
      updatedCount: successfulUpdates,
      error: failedUpdates.length > 0 ? 'Some updates failed' : undefined,
    };
  } catch (error) {
    log.error(`[A11yAudit] Error updating opportunities to IGNORED: ${error.message}`);
    return {
      success: false,
      updatedCount: 0,
      error: error.message,
    };
  }
}
