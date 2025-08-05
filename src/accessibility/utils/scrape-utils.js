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
import { WCAG_CRITERIA_COUNTS } from './constants.js';

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

    log.info(`[A11yAudit] Found ${objectKeys.length} existing URLs from failed audits for site ${siteId}.`);
    return objectKeys;
  } catch (error) {
    log.error(`[A11yAudit] Error getting existing URLs from failed audits for site ${siteId}: ${error.message}`);
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
  return opportunities.filter((oppty) => oppty.getType() === 'generic-opportunity'
    && oppty.getTitle().includes('Accessibility report - Desktop'));
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
export async function updateStatusToIgnored(dataAccess, siteId, log, a11yOpportunityFilter) {
  try {
    const { Opportunity } = dataAccess;
    const opportunities = await Opportunity.allBySiteIdAndStatus(siteId, 'NEW');
    log.info(`[A11yAudit] Found ${opportunities.length} opportunities for site ${siteId}`);

    if (opportunities.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    const accessibilityOppties = a11yOpportunityFilter(opportunities);
    log.info(`[A11yAudit] Found ${accessibilityOppties.length} opportunities to update to IGNORED for site ${siteId}`);

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
      log.error(`[A11yAudit] Failed to update ${failedUpdates.length} opportunities for site ${siteId}: ${JSON.stringify(failedUpdates)}`);
    }

    return {
      success: failedUpdates.length === 0,
      updatedCount: successfulUpdates,
      error: failedUpdates.length > 0 ? 'Some updates failed' : undefined,
    };
  } catch (error) {
    log.error(`[A11yAudit] Error updating opportunities to IGNORED for site ${siteId}: ${error.message}`);
    return {
      success: false,
      updatedCount: 0,
      error: error.message,
    };
  }
}

/**
 * Generic audit metrics calculator that can handle different audit types
 * @param {Object} reportData - The audit report data
 * @param {Object} config - Configuration object containing audit-specific extractors
 * @param {string} config.siteId - The site ID
 * @param {string} config.baseUrl - The base URL of the site
 * @param {string} config.auditType - The type of audit (e.g. 'a11y', 'preflight')
 * @param {string} [config.source='axe-core'] - The source of the audit
 * @param {number} config.totalChecks - Total number of checks performed
 * @param {Function} config.extractComplianceData - Function to extract compliance data
 * @param {Function} config.extractTopOffenders - Function to extract top offenders
 * @returns {Object} Standardized metrics object
 */
export function calculateAuditMetrics(reportData, config) {
  const {
    siteId,
    baseUrl,
    auditType,
    source = 'axe-core',
    totalChecks,
    extractComplianceData,
    extractTopOffenders,
  } = config;

  // Calculate compliance using audit-specific extractor
  const compliance = extractComplianceData(reportData, totalChecks);

  // Calculate top offenders using audit-specific extractor
  const topOffenders = extractTopOffenders(reportData);

  return {
    siteId,
    url: baseUrl,
    source,
    name: `${auditType}-audit`,
    time: new Date().toISOString(),
    compliance,
    topOffenders,
  };
}

/**
 * Calculate accessibility audit metrics from report data
 * @param {Object} reportData - The accessibility audit report data
 * @param {string} siteId - The site ID
 * @param {string} baseUrl - The base URL of the site
 * @returns {Object} Accessibility metrics object
 */
export function calculateA11yMetrics(reportData, siteId, baseUrl) {
  return calculateAuditMetrics(reportData, {
    siteId,
    baseUrl,
    auditType: 'a11y',
    totalChecks: WCAG_CRITERIA_COUNTS.TOTAL,
    extractComplianceData: (data, total) => {
      const { overall } = data;
      const criticalItemsCount = Object.keys(overall?.violations?.critical?.items || {}).length;
      const seriousItemsCount = Object.keys(overall?.violations?.serious?.items || {}).length;
      const failed = criticalItemsCount + seriousItemsCount;
      return {
        total,
        failed,
        passed: total - failed,
      };
    },
    extractTopOffenders: (data) => {
      const offenders = [];
      for (const [url, urlData] of Object.entries(data)) {
        if (url !== 'overall' && urlData.violations) {
          const count = urlData.violations.total || 0;
          if (count > 0) offenders.push({ url, count });
        }
      }
      return offenders.sort((a, b) => b.count - a.count).slice(0, 10);
    },
  });
}

export async function saveA11yMetricsToS3(reportData, context) {
  const {
    log, env, site, s3Client,
  } = context;
  const bucketName = env.S3_IMPORTER_BUCKET_NAME;
  const siteId = site.getId();
  const baseUrl = site.getBaseURL();

  // Calculate metrics from report data
  const newMetricsEntry = calculateA11yMetrics(reportData, siteId, baseUrl);

  // Log the calculated metrics summary
  const { total, failed, passed } = newMetricsEntry.compliance;
  const offendersCount = newMetricsEntry.topOffenders.length;
  log.info(`[A11yAudit] Metrics summary for site ${siteId} (${baseUrl}) - Total: ${total}, Failed: ${failed}, Passed: ${passed}, Top Offenders: ${offendersCount}`);

  // Read existing a11y-audit.json file from s3
  const s3Key = `metrics/${siteId}/axe-core/a11y-audit.json`;
  let existingMetrics = [];

  try {
    const existingData = await getObjectFromKey(s3Client, bucketName, s3Key, log);
    if (existingData && Array.isArray(existingData)) {
      existingMetrics = existingData;
      log.info(`[A11yAudit] Found existing metrics file with ${existingMetrics.length} entries for site ${siteId} (${baseUrl})`);
    }
  } catch (error) {
    log.info(`[A11yAudit] No existing metrics file found for site ${siteId} (${baseUrl}), creating new one: ${error.message}`);
  }

  // Save new metrics to s3 a11y-audit.json file
  existingMetrics.push(newMetricsEntry);

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: JSON.stringify(existingMetrics, null, 2),
      ContentType: 'application/json',
    }));

    log.info(`[A11yAudit] Successfully saved a11y metrics to S3: ${s3Key} for site ${siteId} (${baseUrl})`);

    return {
      success: true,
      message: 'A11y metrics saved to S3',
      metricsData: newMetricsEntry,
      s3Key,
    };
  } catch (error) {
    log.error(`[A11yAudit] Error saving metrics to S3 for site ${siteId} (${baseUrl}): ${error.message}`);
    return {
      success: false,
      message: `Failed to save a11y metrics to S3: ${error.message}`,
      error: error.message,
    };
  }
}
