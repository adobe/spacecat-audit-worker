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
import { PutObjectCommand } from '@aws-sdk/client-s3';
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
      log.info(`[A11yAudit] No existing URLs from failed audits found for site ${siteId}.`);
      return [];
    }

    return objectKeys;
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error getting existing URLs from failed audits for site ${siteId}: ${error.message}`);
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
export function filterAccessibilityOpportunities(opportunities, deviceType = null) {
  return opportunities.filter((oppty) => {
    if (oppty.getType() !== 'generic-opportunity') {
      return false;
    }

    const title = oppty.getTitle();
    const isAccessibilityReport = title.includes('Accessibility report -');

    if (!deviceType) {
      // If no device type specified, match any accessibility report
      return isAccessibilityReport;
    }

    // Match specific device type
    const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
    return isAccessibilityReport && title.includes(`- ${capitalizedDevice} -`);
  });
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
export async function updateStatusToIgnored(
  dataAccess,
  siteId,
  log,
  deviceType = null,
) {
  try {
    const { Opportunity } = dataAccess;
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');

    if (opportunities.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const accessibilityOppties = filterAccessibilityOpportunities(opportunities, deviceType);
    const deviceStr = deviceType ? ` for ${deviceType}` : '';
    log.debug(`[A11yAudit] Found ${accessibilityOppties.length} opportunities to update to IGNORED${deviceStr} for site ${siteId}`);

    if (accessibilityOppties.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const updateResults = await Promise.allSettled(
      accessibilityOppties.map(async (oppty) => {
        oppty.setStatus('IGNORED');
        await oppty.save();
        return oppty;
      }),
    );

    const successfulUpdates = updateResults.filter((result) => result.status === 'fulfilled').length;
    const failedUpdates = updateResults.filter((result) => result.status === 'rejected');

    if (failedUpdates.length > 0) {
      log.error(`[A11yAudit][A11yProcessingError] Failed to update ${failedUpdates.length} opportunities for site ${siteId}: ${JSON.stringify(failedUpdates)}`);
    }

    return {
      success: failedUpdates.length === 0,
      updatedCount: successfulUpdates,
      error: failedUpdates.length > 0 ? 'Some updates failed' : undefined,
    };
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error updating opportunities to IGNORED for site ${siteId}: ${error.message}`);
    return {
      success: false,
      updatedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Save received suggestion IDs metrics to S3 in JSON format
 * @param {Object} receivedData - The received metrics data
 * @param {string} receivedData.pageUrl - The page URL
 * @param {string[]} receivedData.receivedSuggestionIds - Array of received suggestion IDs
 * @param {number} receivedData.receivedCount - Count of received suggestions
 * @param {Object} context - The context object containing s3Client, log, env, site, audit
 * @param {string} opportunityId - The opportunity ID
 * @param {string} opportunityType - The opportunity type
 * @param siteId
 * @param auditId
 * @returns {Object} Result object with success status
 */
export async function saveMystiqueValidationMetricsToS3(
  validationData,
  context,
  opportunityId,
  opportunityType,
  siteId,
  auditId,
) {
  const {
    log, env, s3Client,
  } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;

  const newValidationEntry = {
    siteId,
    auditId,
    opportunityId,
    opportunityType,
    pageUrl: validationData.pageUrl,
    validatedAt: new Date().toISOString(),
    sentCount: validationData.sentCount || 0,
    receivedCount: validationData.receivedCount || 0,
  };

  log.debug(`[A11yValidation] Mystique validation metrics for site ${siteId}, opportunity ${opportunityId}, page ${validationData.pageUrl} - Sent: ${newValidationEntry.sentCount}, Received: ${newValidationEntry.receivedCount}`);

  // Read existing a11y-suggestions-validation.json file from S3
  const s3Key = `metrics/${siteId}/mystique/a11y-suggestions-validation.json`;
  let existingMetrics = [];

  try {
    const existingData = await getObjectFromKey(s3Client, bucketName, s3Key, log);
    if (existingData && Array.isArray(existingData)) {
      existingMetrics = existingData;
      log.debug(`[A11yValidation] Found existing mystique validation file with ${existingMetrics.length} entries for site ${siteId}`);
    }
  } catch (error) {
    log.error(`[A11yValidation] No existing mystique validation file found for site ${siteId}, creating new one: ${error.message}`);
  }

  // Check if entry already exists for this audit + opportunity + page combination
  const existingIndex = existingMetrics.findIndex((entry) => entry.auditId === auditId
    && entry.opportunityId === opportunityId
    && entry.pageUrl === validationData.pageUrl);

  if (existingIndex >= 0) {
    // Update existing entry
    existingMetrics[existingIndex] = newValidationEntry;
    log.debug(`[A11yValidation] Updated existing mystique validation entry for page ${validationData.pageUrl}`);
  } else {
    // Add new entry
    existingMetrics.push(newValidationEntry);
    log.debug(`[A11yValidation] Added new mystique validation entry for page ${validationData.pageUrl}`);
  }

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: JSON.stringify(existingMetrics, null, 2),
      ContentType: 'application/json',
    }));

    log.debug(`[A11yValidation] Successfully saved mystique validation metrics to S3: ${s3Key} for site ${siteId}, opportunity ${opportunityId}`);

    return {
      success: true,
      message: 'Mystique validation metrics saved to S3',
      metricsData: newValidationEntry,
      s3Key,
    };
  } catch (error) {
    log.error(`[A11yValidation][A11yProcessingError] Error saving mystique validation metrics to S3 for site ${siteId}, opportunity ${opportunityId}: ${error.message}`);
    return {
      success: false,
      message: `Failed to save mystique validation metrics to S3: ${error.message}`,
      error: error.message,
    };
  }
}

export async function saveOpptyWithRetry(opportunity, auditId, Opportunity, log, maxRetries = 3) {
  async function attemptSave(currentOpportunity, attemptNumber) {
    try {
      await currentOpportunity.save();
      log.debug(`[A11yRemediationGuidance] Successfully saved opportunity on attempt ${attemptNumber}`);
      return currentOpportunity;
    } catch (error) {
      // Check if we have retries left
      if (attemptNumber < maxRetries) {
        // Calculate delay: 200ms, 400ms, 800ms, etc.
        const delay = 2 ** attemptNumber * 100;

        log.error(`[A11yRemediationGuidance][A11yProcessingError] Conditional check failed on attempt ${attemptNumber}, retrying in ${delay}ms`);

        // Wait before retrying
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });

        // Get fresh data from database and reapply our changes
        const refreshed = await Opportunity.findById(currentOpportunity.getId());
        refreshed.setAuditId(auditId);
        refreshed.setUpdatedBy('system');

        // Recursively try again with the refreshed opportunity
        return attemptSave(refreshed, attemptNumber + 1);
      }

      // If it's a different error or we're out of retries, give up
      throw error;
    }
  }

  return attemptSave(opportunity, 1);
}
