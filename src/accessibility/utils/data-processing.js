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

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { isoCalendarWeek, mergeTagsWithHardcodedTags } from '@adobe/spacecat-shared-utils';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../../utils/s3-utils.js';
import {
  createReportOpportunitySuggestionInstance,
  createInDepthReportOpportunity,
  createEnhancedReportOpportunity,
  createFixedVsNewReportOpportunity,
  createBaseReportOpportunity,
  createOrUpdateDeviceSpecificSuggestion as createDeviceSpecificSuggestionInstance,
} from './report-oppty.js';
import {
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
  generateBaseReportMarkdown,
} from './generate-md-reports.js';
import { AUDIT_PREFIXES, URL_SOURCE_SEPARATOR } from './constants.js';

/**
 * Deletes the original JSON files after they've been processed
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string[]} objectKeys - array of keys to delete
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @returns {Promise<number>} - number of deleted files
 */
export async function deleteOriginalFiles(s3Client, bucketName, objectKeys, log) {
  if (!objectKeys || objectKeys.length === 0) {
    return 0;
  }

  let deletedCount = 0;

  try {
    // For multiple objects, use DeleteObjects for efficiency
    if (objectKeys.length > 1) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: objectKeys.map((Key) => ({ Key })),
          Quiet: true,
        },
      };

      await s3Client.send(new DeleteObjectsCommand(deleteParams));
      deletedCount = objectKeys.length;
    } else if (objectKeys.length === 1) { // For a single object, use DeleteObject
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKeys[0],
      }));
      deletedCount = 1;
    }

    log.debug(`Deleted ${deletedCount} original files after aggregation`);
  } catch (error) {
    log.error('[A11yProcessingError] Error deleting original files', error);
  }
  return deletedCount;
}

export async function getSubfoldersUsingPrefixAndDelimiter(
  s3Client,
  bucketName,
  prefix,
  delimiter,
  log,
  maxKeys = 1000,
) {
  if (!s3Client || !bucketName || !prefix || !delimiter) {
    log.error(
      `[A11yProcessingError] Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:${delimiter}, bucketName:${bucketName}, and prefix:${prefix} are provided.`,
    );
    throw new Error(
      'Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter, bucketName, and prefix are provided.',
    );
  }
  try {
    const params = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
      Delimiter: delimiter,
    };
    const data = await s3Client.send(new ListObjectsV2Command(params));
    const commonPrefixes = data.CommonPrefixes || [];
    log.debug(
      `Fetched ${commonPrefixes.length} keys from S3 for bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
    );
    return commonPrefixes.map((subfolder) => subfolder.Prefix);
  } catch (err) {
    log.error(
      `[A11yProcessingError] Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
      err,
    );
    throw err;
  }
}

/**
 * Updates aggregated violation data for a specific severity level
 * @param {Object} aggregatedData - The aggregated data object to update
 * @param {Object} violations - The violations data from current file
 * @param {string} level - The severity level ('critical' or 'serious')
 */
export function updateViolationData(aggregatedData, violations, level) {
  const updatedAggregatedData = JSON.parse(JSON.stringify(aggregatedData));
  if (violations[level] && violations[level].items && violations[level].count) {
    updatedAggregatedData.overall.violations[level].count += violations[level].count;
    Object.entries(violations[level].items).forEach(([key, value]) => {
      if (!updatedAggregatedData.overall.violations[level].items[key]) {
        updatedAggregatedData.overall.violations[level].items[key] = {
          count: value.count,
          description: value.description,
          level: value.level,
          understandingUrl: value.understandingUrl,
          successCriteriaNumber: value.successCriteriaNumber,
        };
      } else {
        updatedAggregatedData.overall.violations[level].items[key].count += value.count;
      }
    });
  }
  return updatedAggregatedData;
}

/**
 * Gets object keys from subfolders for a specific site and version
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} storagePrefix - the prefix of the S3 storage
 * @param {string} siteId - the site ID to look for
 * @param {string} version - the version/date to filter by
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @returns {Promise<{success: boolean, objectKeys: string[], message: string}>} - result
 */
export async function getObjectKeysFromSubfolders(
  s3Client,
  bucketName,
  storagePrefix,
  siteId,
  version,
  log,
) {
  const prefix = `${storagePrefix}/${siteId}/`;
  const delimiter = '/';

  // Get all subfolders for this site that have reports per url
  // up to 3 depending on the total no of urls (content-scraper has a batch size of 40 urls)
  const subfolders = await getSubfoldersUsingPrefixAndDelimiter(
    s3Client,
    bucketName,
    prefix,
    delimiter,
    log,
  );
  if (subfolders.length === 0) {
    const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
    log.debug(message);
    return { success: false, objectKeys: [], message };
  }

  // filter subfolders to match the current date because the name of the subfolder is a timestamp
  // we do this in case there are leftover subfolders from previous runs that fail to be deleted
  // TODO: Also include form-accessibility folders until both audits run together
  const getCurrentSubfolders = subfolders.filter((timestamp) => {
    const timestampValue = timestamp.split('/').filter((item) => item !== '').pop();
    return new Date(parseInt(timestampValue, 10)).toISOString().split('T')[0] === version;
  });
  if (getCurrentSubfolders.length === 0) {
    const message = `No accessibility data found for today's date in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
    log.debug(message);
    return { success: false, objectKeys: [], message };
  }

  // get all JSON files that have the reports per url from the current subfolders
  const processSubfolderPromises = getCurrentSubfolders.map(async (subfolder) => {
    const objectKeysResult = await getObjectKeysUsingPrefix(s3Client, bucketName, subfolder, log, 1000, '.json');
    return { data: objectKeysResult };
  });
  const processSubfolderPromisesResult = await Promise.all(processSubfolderPromises);
  const objectKeys = processSubfolderPromisesResult.flatMap((result) => result.data);

  if (!objectKeys || objectKeys.length === 0) {
    const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId}`;
    log.debug(message);
    return { success: false, objectKeys: [], message };
  }

  // return the object keys for the JSON files that have the reports per url
  log.info(`[A11yAudit] Found ${objectKeys.length} data files for site ${siteId} for date ${version}`);
  return { success: true, objectKeys, message: `Found ${objectKeys.length} data files` };
}

export async function cleanupS3Files(s3Client, bucketName, objectKeys, lastWeekObjectKeys, log) {
  // Delete all JSON files with reports per url since we aggregated the data into a single file
  await deleteOriginalFiles(s3Client, bucketName, objectKeys, log);

  // delete oldest final result file if there are more than 2
  if (lastWeekObjectKeys.length > 2) {
    lastWeekObjectKeys.sort((a, b) => {
      const timestampA = new Date(a.split('/').pop().replace('-final-result.json', ''));
      const timestampB = new Date(b.split('/').pop().replace('-final-result.json', ''));
      return timestampA.getTime() > timestampB.getTime() ? 1 : -1;
    });
    const objectKeyToDelete = lastWeekObjectKeys[0];
    await deleteOriginalFiles(
      s3Client,
      bucketName,
      [objectKeyToDelete],
      log,
    );
    log.debug(`Deleted oldest final result file: ${objectKeyToDelete}`);
  }
}

/**
 * Processes files with retry logic for failed promises
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string[]} objectKeys - array of object keys to process
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {number} maxRetries - maximum number of retries for failed promises (default: 1)
 * @returns {Promise<{results: Array, failedCount: number}>} - processing results
 */
export async function processFilesWithRetry(s3Client, bucketName, objectKeys, log, maxRetries = 1) {
  const processFile = async (key) => {
    try {
      const data = await getObjectFromKey(s3Client, bucketName, key, log);

      if (!data) {
        log.warn(`Failed to get data from ${key}, skipping`);
        return null;
      }

      return { key, data };
    } catch (error) {
      log.error(`[A11yProcessingError] Error processing file ${key}: ${error.message}`);
      throw error; // Re-throw to be caught by retry logic
    }
  };

  const processFileWithRetry = async (key, retryCount = 0) => {
    try {
      return await processFile(key);
    } catch (error) {
      if (retryCount < maxRetries) {
        log.warn(`Retrying file ${key} (attempt ${retryCount + 1}/${maxRetries}): ${error.message}`);
        return processFileWithRetry(key, retryCount + 1);
      }
      log.error(`[A11yProcessingError] Failed to process file ${key} after ${maxRetries} retries: ${error.message}`);
      return null;
    }
  };

  // Process files in parallel using Promise.allSettled to handle failures gracefully
  const processFilePromises = objectKeys.map((key) => processFileWithRetry(key));

  // Use Promise.allSettled to handle potential failures without stopping the entire process
  const settledResults = await Promise.allSettled(processFilePromises);

  // Extract successful results and log failures
  const results = [];
  let failedCount = 0;

  settledResults.forEach((settledResult) => {
    if (settledResult.status === 'fulfilled') {
      if (settledResult.value !== null) {
        results.push(settledResult.value);
      } else {
        failedCount += 1;
      }
    }
  });

  if (failedCount > 0) {
    log.warn(`${failedCount} out of ${objectKeys.length} files failed to process, continuing with ${results.length} successful files`);
  }

  log.debug(`File processing completed: ${results.length} successful, ${failedCount} failed out of ${objectKeys.length} total files`);

  return { results };
}

/**
 * Gets the storage prefix and logIdentifier for the audit type
 * @param {string} auditType - the audit type
 * @returns {object} the storage prefix and logIdentifier
 */
export function getAuditPrefixes(auditType) {
  const prefixes = AUDIT_PREFIXES[auditType];
  if (!prefixes) {
    throw new Error(`Unsupported audit type: ${auditType}`);
  }
  return prefixes;
}

/**
 * Merges two accessibility data objects, preserving data from both
 * @param {object} existingData - the existing aggregated data
 * @param {object} newData - the new aggregated data to merge
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {string} logIdentifier - identifier for log messages
 * @returns {object} merged data
 */
export function mergeAccessibilityData(existingData, newData, log, logIdentifier = 'A11yMerge') {
  const merged = JSON.parse(JSON.stringify(existingData));

  let addedCount = 0;
  let skippedCount = 0;

  Object.entries(newData).forEach(([key, value]) => {
    if (key === 'overall') {
      return; // Skip overall, we'll recalculate it
    }

    if (!merged[key]) {
      // New URL not in existing data, add it
      merged[key] = value;
      addedCount += 1;
      log.info(`[${logIdentifier}] Added new URL data for: ${key}`);
    } else {
      skippedCount += 1;
      log.debug(`[${logIdentifier}] URL already exists, skipping: ${key}`);
    }
  });

  log.info(`[${logIdentifier}] Added ${addedCount} new URLs, skipped ${skippedCount} existing URLs`);

  // Recalculate overall statistics from all merged data
  const recalculatedOverall = {
    violations: {
      total: 0,
      critical: { count: 0, items: {} },
      serious: { count: 0, items: {} },
    },
  };

  // Process each URL's violations
  Object.entries(merged).forEach(([key, urlData]) => {
    if (key === 'overall' || !urlData || !urlData.violations) return;

    // Process critical and serious violations
    ['critical', 'serious'].forEach((severity) => {
      const severityData = urlData.violations[severity];
      if (!severityData?.items) return;

      // Merge each rule's data
      Object.entries(severityData.items).forEach(([ruleId, ruleData]) => {
        if (!ruleId || !ruleData || typeof ruleData !== 'object') return;

        const overallItems = recalculatedOverall.violations[severity].items;

        if (!overallItems[ruleId]) {
          // If first time seeing this rule, copy it with only the core fields
          // (matching the structure created by updateViolationData)
          overallItems[ruleId] = {
            count: ruleData.count || 0,
            description: ruleData.description || '',
            level: ruleData.level || '',
            understandingUrl: ruleData.understandingUrl || '',
            successCriteriaNumber: ruleData.successCriteriaNumber || '',
          };
        } else {
          // If rule already exists, accumulate the count
          overallItems[ruleId].count = (overallItems[ruleId].count || 0) + (ruleData.count || 0);
        }
      });
    });
  });

  // Calculate final severity counts (after all URLs processed)
  ['critical', 'serious'].forEach((severity) => {
    recalculatedOverall.violations[severity].count = Object.values(
      recalculatedOverall.violations[severity].items,
    ).reduce((sum, rule) => sum + (rule.count || 0), 0);
  });

  // Calculate total from severity counts (no double counting)
  recalculatedOverall.violations.total = recalculatedOverall.violations.critical.count
    + recalculatedOverall.violations.serious.count;

  merged.overall = recalculatedOverall;
  return merged;
}

/**
 * Aggregates accessibility audit data from multiple JSON files in S3 and creates a summary
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} siteId - the site ID to look for
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {string} outputKey - the key for the aggregated output file
 * @param {string} auditType - the type of audit (accessibility or forms-accessibility)
 * @param {string} version - the version/date to filter by
 * @param {number} maxRetries - maximum number of retries for failed promises (default: 1)
 * @returns {Promise<{success: boolean, aggregatedData: object, message: string}>} - result
 */
export async function aggregateAccessibilityData(
  s3Client,
  bucketName,
  siteId,
  log,
  outputKey,
  auditType,
  version,
  maxRetries = 2,
) {
  if (!s3Client || !bucketName || !siteId || !auditType) {
    const message = 'Missing required parameters for aggregateAccessibilityData';
    log.error(`[A11yProcessingError] ${message}`);
    return { success: false, aggregatedData: null, message };
  }

  // Initialize aggregated data structure
  let aggregatedData = {
    overall: {
      violations: {
        total: 0,
        critical: {
          count: 0,
          items: {},
        },
        serious: {
          count: 0,
          items: {},
        },
      },
    },
  };

  const { storagePrefix, logIdentifier } = getAuditPrefixes(auditType);

  try {
    // Get object keys from subfolders
    const objectKeysResult = await getObjectKeysFromSubfolders(
      s3Client,
      bucketName,
      storagePrefix,
      siteId,
      version,
      log,
    );

    // Check if the call succeeded
    if (!objectKeysResult.success) {
      return { success: false, aggregatedData: null, message: objectKeysResult.message };
    }

    // Combine object keys from both sources
    const { objectKeys } = objectKeysResult;

    // Process files with retry logic
    const { results } = await processFilesWithRetry(
      s3Client,
      bucketName,
      objectKeys,
      log,
      maxRetries,
    );

    // Check if we have any successful results to process
    if (results.length === 0) {
      const message = `[${logIdentifier}] No files could be processed successfully for site ${siteId}`;
      log.error(`[A11yProcessingError] ${message}`);
      return { success: false, aggregatedData: null, message };
    }

    // Process the results
    results.forEach((result) => {
      const { data } = result;
      const {
        violations, traffic, url: siteUrl, source,
      } = data;

      // Store the url specific data only for page-level data (no form level data yet)
      const key = source ? `${siteUrl}${URL_SOURCE_SEPARATOR}${source}` : siteUrl;
      aggregatedData[key] = { violations, traffic };

      // Update overall data
      aggregatedData = updateViolationData(aggregatedData, violations, 'critical');
      aggregatedData = updateViolationData(aggregatedData, violations, 'serious');
      if (violations.total) {
        aggregatedData.overall.violations.total += violations.total;
      }
    });

    // Check if file already exists and merge if it does
    let finalData = aggregatedData;

    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: outputKey }));

      const existingData = await getObjectFromKey(s3Client, bucketName, outputKey, log);
      if (existingData) {
        log.info(`[${logIdentifier}] Existing data loaded successfully`);

        finalData = mergeAccessibilityData(existingData, aggregatedData, log, logIdentifier);

        log.info(`[${logIdentifier}] Merge completed! Final data has ${Object.keys(finalData).length} keys`);
        log.info(`[${logIdentifier}] Final data URLs (excluding overall): ${Object.keys(finalData).filter((k) => k !== 'overall').length}`);
      } else {
        log.warn(`[${logIdentifier}] File exists but getObjectFromKey returned null/undefined`);
      }
    } catch (error) {
      log.info(`[${logIdentifier}] File doesn't exist (HeadObjectCommand failed): ${error.message}`);
      log.info(`[${logIdentifier}] Will create new file with current aggregatedData`);
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: outputKey,
      Body: JSON.stringify(finalData, null, 2),
      ContentType: 'application/json',
    }));

    log.debug(`[${logIdentifier}] Saved aggregated accessibility data to ${outputKey}`);
    // check if there are any other final-result files in the {storagePrefix}/siteId folder
    // if there are, we will use the latest one for comparison later on
    const lastWeekObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, `${storagePrefix}/${siteId}/`, log, 10, '-final-result.json');
    log.debug(`[${logIdentifier}] Found ${lastWeekObjectKeys.length} final-result files in the ${storagePrefix}/siteId folder with keys: ${lastWeekObjectKeys}`);

    // get last week file and start creating the report
    const lastWeekFile = lastWeekObjectKeys.length < 2
      ? null
      : await getObjectFromKey(
        s3Client,
        bucketName,
        lastWeekObjectKeys[lastWeekObjectKeys.length - 2],
        log,
      );
    if (lastWeekFile) {
      log.debug(`[${logIdentifier}] Last week file key:${lastWeekObjectKeys[1]} with content: ${JSON.stringify(lastWeekFile, null, 2)}`);
    }

    await cleanupS3Files(s3Client, bucketName, objectKeys, lastWeekObjectKeys, log);

    return {
      success: true,
      finalResultFiles: {
        current: finalData,
        lastWeek: lastWeekFile,
      },
      message: `Successfully aggregated ${objectKeys.length} files into ${outputKey}`,
    };
  } catch (error) {
    log.error(`[${logIdentifier}][A11yProcessingError] Error aggregating accessibility data for site ${siteId}`, error);
    return {
      success: false,
      aggregatedData: null,
      message: `Error: ${error.message}`,
    };
  }
}

export async function createReportOpportunity(opportunityInstance, auditData, context) {
  const { log, dataAccess } = context;
  const { Opportunity } = dataAccess;
  try {
    // Apply hardcoded tags based on opportunity type (except for Generic Opportunity)
    const mergedTags = mergeTagsWithHardcodedTags(
      opportunityInstance.type,
      opportunityInstance.tags,
    );
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.auditId,
      runbook: opportunityInstance.runbook,
      type: opportunityInstance.type,
      origin: opportunityInstance.origin,
      title: opportunityInstance.title,
      description: opportunityInstance.description,
      tags: mergedTags,
    };
    const opportunity = await Opportunity.create(opportunityData);
    return { opportunity };
  } catch (e) {
    log.error(`[A11yProcessingError] Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
}

export async function createReportOpportunitySuggestion(
  opportunity,
  reportMarkdown,
  auditData,
  log,
) {
  const suggestions = createReportOpportunitySuggestionInstance(reportMarkdown);

  try {
    const suggestion = await opportunity.addSuggestions(suggestions);
    return { suggestion };
  } catch (e) {
    log.error(`[A11yProcessingError] Failed to create new suggestion for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * Creates or updates device-specific report opportunity suggestion
 * @param {Object} opportunity - The opportunity instance
 * @param {string} reportMarkdown - The markdown content for this device
 * @param {string} deviceType - 'desktop' or 'mobile'
 * @param {Object} auditData - Audit data
 * @param {Object} log - Logger instance
 * @returns {Object} Created or updated suggestion
 */
export async function createOrUpdateDeviceSpecificSuggestion(
  opportunity,
  reportMarkdown,
  deviceType,
  auditData,
  log,
  context = {},
) {
  const createSuggestionInstance = createDeviceSpecificSuggestionInstance;

  try {
    // Get existing suggestions to check if we need to update
    const existingSuggestions = await opportunity.getSuggestions();
    const existingSuggestion = existingSuggestions.find((s) => s.getType() === 'CODE_CHANGE');

    let suggestions;
    if (existingSuggestion) {
      // Update existing suggestion with new device content
      const currentData = existingSuggestion.getData() ?? {};
      const currentSuggestionValue = currentData.suggestionValue ?? {};

      suggestions = createSuggestionInstance(
        currentSuggestionValue,
        deviceType,
        reportMarkdown,
        context,
      );

      // Update only the suggestionValue field to avoid ElectroDB timestamp conflicts
      const newData = { ...currentData, suggestionValue: suggestions[0].data.suggestionValue };

      existingSuggestion.setData(newData);
      await existingSuggestion.save();

      return { suggestion: existingSuggestion };
    } else {
      // Create new suggestion
      suggestions = createSuggestionInstance(null, deviceType, reportMarkdown, context);

      const suggestion = await opportunity.addSuggestions(suggestions);

      return { suggestion };
    }
  } catch (e) {
    log.error(`[A11yProcessingError] Failed to create/update device-specific suggestion for ${deviceType} on siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
}

/**
 * Builds the expected opportunity title pattern based on device type and report type
 * @param {string} deviceType - 'Desktop' or 'Mobile'
 * @param {number} week - The week number
 * @param {number} year - The year
 * @param {string} reportType - The report type ('in-depth', 'enhanced', 'fixed', '' for base)
 * @returns {string} The expected opportunity title pattern
 */
function buildOpportunityTitlePattern(deviceType, week, year, reportType) {
  const capitalizedDevice = deviceType.charAt(0).toUpperCase() + deviceType.slice(1).toLowerCase();
  const basePattern = `Accessibility report - ${capitalizedDevice} - Week ${week} - ${year}`;

  if (reportType === 'in-depth') {
    return `${basePattern} - in-depth`;
  }
  if (reportType === 'fixed') {
    return `Accessibility report Fixed vs New Issues - ${capitalizedDevice} - Week ${week} - ${year}`;
  }
  if (reportType === 'enhanced') {
    return `Enhancing accessibility for the top 10 most-visited pages - ${capitalizedDevice} - Week ${week} - ${year}`;
  }
  // Base report (no suffix)
  return basePattern;
}

/**
 * Finds existing accessibility opportunity for a specific device, week, year, and report type
 * @param {string} deviceType - 'Desktop' or 'Mobile'
 * @param {string} siteId - The site ID
 * @param {number} week - The week number
 * @param {number} year - The year
 * @param {Object} dataAccess - Data access object
 * @param {Object} log - Logger instance
 * @param {string} reportType - The report type ('in-depth', 'enhanced', 'fixed', '' for base)
 * @returns {Object|null} Existing opportunity or null
 */
async function findExistingAccessibilityOpportunity(
  deviceType,
  siteId,
  week,
  year,
  dataAccess,
  log,
  reportType = '',
) {
  try {
    const { Opportunity } = dataAccess;
    const opportunities = await Opportunity.allBySiteId(siteId);

    const titlePattern = buildOpportunityTitlePattern(deviceType, week, year, reportType);
    const deviceLabel = deviceType.toLowerCase();

    const opportunity = opportunities.find((oppty) => {
      const title = oppty.getTitle();
      const isMatchingOpportunity = title === titlePattern;
      const isActiveStatus = oppty.getStatus() === 'NEW' || oppty.getStatus() === 'IGNORED';
      return isMatchingOpportunity && isActiveStatus;
    });

    if (opportunity) {
      log.info(`[A11yAudit] Found existing ${deviceLabel} ${reportType || 'base'} opportunity for week ${week}, year ${year}: ${opportunity.getId()}`);
      return opportunity;
    }

    log.info(`[A11yAudit] No existing ${deviceLabel} ${reportType || 'base'} opportunity found for week ${week}, year ${year}`);
    return null;
  } catch (error) {
    log.error(`[A11yAudit] Error searching for existing ${deviceType.toLowerCase()} opportunity: ${error.message}`);
    return null;
  }
}

/**
 * Finds existing desktop accessibility opportunity for the same week and report type
 * @param {string} siteId - The site ID
 * @param {number} week - The week number
 * @param {number} year - The year
 * @param {Object} dataAccess - Data access object
 * @param {Object} log - Logger instance
 * @param {string} reportType - The report type suffix (e.g., 'in-depth', 'base', empty for base)
 * @returns {Object|null} Existing desktop opportunity or null
 */
export async function findExistingDesktopOpportunity(
  siteId,
  week,
  year,
  dataAccess,
  log,
  reportType = '',
) {
  return findExistingAccessibilityOpportunity('Desktop', siteId, week, year, dataAccess, log, reportType);
}

/**
 * Finds existing mobile accessibility opportunity for the same week and report type
 * @param {string} siteId - The site ID
 * @param {number} week - The week number
 * @param {number} year - The year
 * @param {Object} dataAccess - Data access object
 * @param {Object} log - Logger instance
 * @param {string} reportType - The report type suffix (e.g., 'in-depth', 'base', empty for base)
 * @returns {Object|null} Existing mobile opportunity or null
 */
export async function findExistingMobileOpportunity(
  siteId,
  week,
  year,
  dataAccess,
  log,
  reportType = '',
) {
  return findExistingAccessibilityOpportunity('Mobile', siteId, week, year, dataAccess, log, reportType);
}

/**
 * Gets the URLs for the audit
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} siteId - the site ID to look for
 * @param {import('@azure/logger').Logger} log - a logger instance
 */
export async function getUrlsForAudit(s3Client, bucketName, siteId, log) {
  let finalResultFiles;
  const urlsToScrape = [];
  try {
    finalResultFiles = await getObjectKeysUsingPrefix(s3Client, bucketName, `accessibility/${siteId}/`, log, 10, '-final-result.json');
    if (finalResultFiles.length === 0) {
      const warningMessage = `[A11yAudit] No final result files found for ${siteId}`;
      log.warn(`[A11yProcessingWarning] ${warningMessage}`);
      return urlsToScrape;
    }
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error getting final result files for ${siteId}: ${error.message}`);
    return urlsToScrape;
  }

  const latestFinalResultFileKey = finalResultFiles[finalResultFiles.length - 1];
  let latestFinalResultFile;
  try {
    // eslint-disable-next-line max-len
    latestFinalResultFile = await getObjectFromKey(s3Client, bucketName, latestFinalResultFileKey, log);
    if (!latestFinalResultFile) {
      const errorMessage = `[A11yAudit] No latest final result file found for ${siteId}`;
      log.error(`[A11yProcessingError] ${errorMessage}`);
      return urlsToScrape;
    }
  } catch (error) {
    log.error(`[A11yAudit][A11yProcessingError] Error getting latest final result file for ${siteId}: ${error.message}`);
    return urlsToScrape;
  }

  delete latestFinalResultFile.overall;
  for (const [key, value] of Object.entries(latestFinalResultFile)) {
    if (key.includes('https://')) {
      urlsToScrape.push({
        url: key,
        urlId: key.replace('https://', ''),
        traffic: value.traffic,
      });
    }
  }

  if (urlsToScrape.length === 0) {
    const errorMessage = `[A11yAudit] No URLs found for ${siteId}`;
    log.error(`[A11yProcessingError] ${errorMessage}`);
    return urlsToScrape;
  }

  return urlsToScrape;
}

export function linkBuilder(linkData, opptyId) {
  const { envAsoDomain, siteId } = linkData;
  return `https://${envAsoDomain}.adobe.com/#/sites-optimizer/sites/${siteId}/opportunities/${opptyId}`;
}

/**
 * Generates a report opportunity for a given report
 * @param {object} reportData - the report data
 * @param {function} genMdFn - the function to generate the markdown report
 * @param {function} createOpportunityFn - the function to create the opportunity
 * @param {string} reportName - the name of the report
 * @param {boolean} shouldIgnore - whether to ignore the opportunity
 * @param {string} deviceType - the device type (Desktop/Mobile)
 * @param {string} reportType - the report type ('in-depth', 'enhanced', 'fixed', '' for base)
 * @returns {Promise<string>} - the URL of the opportunity
 */
export async function generateReportOpportunity(
  reportData,
  genMdFn,
  createOpportunityFn,
  reportName,
  shouldIgnore = true,
  deviceType = 'Desktop',
  reportType = '',
) {
  const {
    mdData,
    linkData,
    opptyData,
    auditData,
    context,
  } = reportData;
  const { week, year } = opptyData;
  const { log, dataAccess } = context;
  const { siteId } = auditData;

  // 1.1 generate the markdown report
  const reportMarkdown = genMdFn(mdData);

  if (!reportMarkdown) {
    // If the markdown is empty, we don't want to create an opportunity
    // and we don't want to throw an error
    return '';
  }

  let opportunity;
  let isExistingOpportunity = false;

  // 1.2 Handle device-specific logic
  if (deviceType.toLowerCase() === 'mobile') {
    // Mobile audit: look for existing desktop opportunity to merge with
    const existingDesktopOpportunity = await findExistingDesktopOpportunity(
      siteId,
      week,
      year,
      dataAccess,
      log,
      reportType,
    );

    if (existingDesktopOpportunity) {
      // Use existing desktop opportunity and add mobile content to it
      opportunity = existingDesktopOpportunity;
      isExistingOpportunity = true;
      log.info(`[A11yAudit] Mobile audit will update existing desktop ${reportType || 'base'} opportunity: ${opportunity.getId()}`);
    } else {
      // No existing desktop opportunity, create new mobile-only opportunity
      const opportunityInstance = createOpportunityFn(week, year, deviceType);
      const opportunityRes = await createReportOpportunity(opportunityInstance, auditData, context);
      opportunity = opportunityRes.opportunity;
      log.info(`[A11yAudit] Created new mobile-only ${reportType || 'base'} opportunity: ${opportunity.getId()}`);
    }
  } else {
    // Desktop audit: look for existing mobile opportunity to merge with
    const existingMobileOpportunity = await findExistingMobileOpportunity(
      siteId,
      week,
      year,
      dataAccess,
      log,
      reportType,
    );

    if (existingMobileOpportunity) {
      // Use existing mobile opportunity and add desktop content to it
      opportunity = existingMobileOpportunity;
      isExistingOpportunity = true;
      log.info(`[A11yAudit] Desktop audit will update existing mobile ${reportType || 'base'} opportunity: ${opportunity.getId()}`);
    } else {
      // No existing mobile opportunity, create new desktop-only opportunity
      const opportunityInstance = createOpportunityFn(week, year, deviceType);
      const opportunityRes = await createReportOpportunity(opportunityInstance, auditData, context);
      opportunity = opportunityRes.opportunity;
      log.info(`[A11yAudit] Created new desktop ${reportType || 'base'} opportunity: ${opportunity.getId()}`);
    }
  }

  // 1.3 create or update the suggestions for the report oppty with device-specific content
  try {
    await createOrUpdateDeviceSpecificSuggestion(
      opportunity,
      reportMarkdown,
      deviceType.toLowerCase(),
      auditData,
      log,
      context,
    );
  } catch (error) {
    log.error(`[A11yProcessingError] Failed to create/update device-specific suggestion for ${reportName}`, error.message);
    throw new Error(error.message);
  }

  // 1.4 update status to ignored (only for new opportunities or if explicitly requested)
  if (shouldIgnore && !isExistingOpportunity) {
    await opportunity.setStatus('IGNORED');
    await opportunity.save();
  }

  const opptyId = opportunity.getId();
  const opptyUrl = linkBuilder(linkData, opptyId);
  return opptyUrl;
}

export async function getAuditData(site, auditType) {
  const latestAudit = await site.getLatestAuditByAuditType(auditType);
  return JSON.parse(JSON.stringify(latestAudit));
}

export function getEnvAsoDomain(env) {
  const isProd = env.AWS_ENV === 'prod';
  return isProd ? 'experience' : 'experience-stage';
}

export function getWeekNumberAndYear() {
  const date = new Date();
  // Use ISO calendar week and year from shared utility
  const { week, year } = isoCalendarWeek(date);
  return { week, year };
}

/**
 * Generates report opportunities for a given site
 * @param {string} site - the site to generate report opportunities for
 * @param {object} aggregationResult - the aggregation result
 * @param {import('@azure/logger').Logger} context - the context
 * @param {string} auditType - the audit type
 */
export async function generateReportOpportunities(
  site,
  aggregationResult,
  context,
  auditType,
  deviceType = 'Desktop',
) {
  const siteId = site.getId();
  const { log, env } = context;
  const { finalResultFiles } = aggregationResult;
  const { current, lastWeek } = finalResultFiles;

  // data needed for all reports oppties
  const { week, year } = getWeekNumberAndYear();
  const auditData = await getAuditData(site, auditType);
  const envAsoDomain = getEnvAsoDomain(env);

  const relatedReportsUrls = {
    inDepthReportUrl: '',
    enhancedReportUrl: '',
    fixedVsNewReportUrl: '',
  };
  const reportData = {
    mdData: {
      current,
      lastWeek,
    },
    linkData: {
      envAsoDomain,
      siteId,
    },
    opptyData: {
      week,
      year,
    },
    auditData,
    context,
  };

  try {
    relatedReportsUrls.inDepthReportUrl = await generateReportOpportunity(reportData, generateInDepthReportMarkdown, createInDepthReportOpportunity, 'in-depth report', true, deviceType, 'in-depth');
  } catch (error) {
    log.error('[A11yProcessingError] Failed to generate in-depth report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    relatedReportsUrls.enhancedReportUrl = await generateReportOpportunity(reportData, generateEnhancedReportMarkdown, createEnhancedReportOpportunity, 'enhanced report', true, deviceType, 'enhanced');
  } catch (error) {
    log.error('[A11yProcessingError] Failed to generate enhanced report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    relatedReportsUrls.fixedVsNewReportUrl = await generateReportOpportunity(reportData, generateFixedNewReportMarkdown, createFixedVsNewReportOpportunity, 'fixed vs new report', true, deviceType, 'fixed');
  } catch (error) {
    log.error('[A11yProcessingError] Failed to generate fixed vs new report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    reportData.mdData.relatedReportsUrls = relatedReportsUrls;
    await generateReportOpportunity(reportData, generateBaseReportMarkdown, createBaseReportOpportunity, 'base report', false, deviceType, '');
  } catch (error) {
    log.error('[A11yProcessingError] Failed to generate base report opportunity', error.message);
    throw new Error(error.message);
  }

  return {
    status: true,
    message: 'All report opportunities created successfully',
  };
}

/**
 * Sends a message to run an import job to the provided SQS queue.
 *
 * @param {Object} sqs
 * @param {string} queueUrl
 * @param {string} importType
 * @param {string} siteId
 * @param {Object} [data] - Optional data object for import-specific data
 * @param {Object} context
 */
export async function sendRunImportMessage(
  sqs,
  queueUrl,
  importType,
  siteId,
  data = undefined,
) {
  return sqs.sendMessage(queueUrl, {
    type: importType,
    siteId,
    ...(data && { data }),
  });
}

/**
 * Retrieves code path information saved in S3 bucket
 * @param {Object} site - The site object
 * @param {string} opportunityType - Opportunity type for logging
 * @param {Object} context - The context object containing log, s3Client, env
 * @returns {Promise<Object|null>} Object containing codeBucket and codePath, or null if should skip
 */
export async function getCodeInfo(site, opportunityType, context) {
  const { log, s3Client, env } = context;
  const siteId = site.getId();
  const deliveryType = site.getDeliveryType();
  const codeConfig = site.getCode();

  // For aem_edge delivery type, proceed without codeConfig
  if (!codeConfig) {
    if (deliveryType === 'aem_edge') {
      return {
        codeBucket: env.S3_IMPORTER_BUCKET_NAME,
        codePath: '',
      };
    }
    log.warn(`[${opportunityType}] [Site Id: ${siteId}] No code configuration found for site`);
    return null;
  }

  const {
    type: source, owner, repo, ref,
  } = codeConfig;

  const codeBucket = env.S3_IMPORTER_BUCKET_NAME;
  const codePath = `code/${siteId}/${source}/${owner}/${repo}/${ref}/repository.zip`;

  // Verify if the file exists in S3 bucket
  let fileExists = false;
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: codeBucket,
      Key: codePath,
    }));
    fileExists = true;
    log.info(`[${opportunityType}] [Site Id: ${siteId}] Code file verified in S3 bucket`);
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      log.warn(`[${opportunityType}] [Site Id: ${siteId}] Code file not found in S3: ${codePath}`);
    } else {
      log.error(`[${opportunityType}] [Site Id: ${siteId}] Error checking S3 file: ${error.message}`);
    }
  }

  // Handle based on file existence and delivery type
  if (!fileExists && deliveryType !== 'aem_edge') {
    return null;
  }

  return {
    codeBucket,
    codePath: (!fileExists && deliveryType === 'aem_edge') ? '' : codePath,
  };
}

/**
 * Groups suggestions by URL, source, and issue type, then sends messages
 * directly to Mystique for code-fix generation.
 * Verifies the code file exists in S3 bucket before sending messages.
 * For aem_edge delivery type, sends message with empty codePath if file doesn't exist.
 * For other delivery types, skips sending if file doesn't exist.
 *
 * @param {Object} opportunity - The opportunity object containing suggestions
 * @param {string} auditId - The audit ID
 * @param {Object} site - The site object
 * @param {Object} context - The context object containing log, sqs, env, s3Client, and site
 * @returns {Promise<void>}
 */
export async function sendCodeFixMessagesToMystique(opportunity, auditId, site, context) {
  const {
    log, sqs, env,
  } = context;

  const siteId = opportunity.getSiteId();
  const baseUrl = site.getBaseURL();
  const opportunityType = opportunity.getType();

  try {
    // Verify and get code path information
    const codeInfo = await getCodeInfo(site, opportunityType, context);

    if (!codeInfo) {
      return;
    }

    const { codeBucket, codePath } = codeInfo;

    // Get all suggestions from the opportunity
    const suggestions = await opportunity.getSuggestions();
    if (!suggestions || suggestions.length === 0) {
      log.info(`[${opportunityType}] [Site Id: ${siteId}] No suggestions found for code-fix generation`);
      return;
    }

    // Group suggestions by URL, source, and issueType
    const groupedSuggestions = new Map();

    suggestions.forEach((suggestion) => {
      const suggestionData = suggestion.getData();
      const {
        url, source: formSource = 'default', issues, aiGenerated,
      } = suggestionData;

      // By design, data.issues will always have length 1
      if (issues && issues.length > 0 && !aiGenerated) {
        const issueType = issues[0].type;
        const groupKey = `${url}|${formSource}|${issueType}`;
        if (!groupedSuggestions.has(groupKey)) {
          groupedSuggestions.set(groupKey, {
            url,
            source: formSource,
            issueType,
            suggestionIds: [],
          });
        }

        // Add the suggestion ID to the group
        groupedSuggestions.get(groupKey).suggestionIds.push(suggestion.getId());
      }
    });

    log.info(`[${opportunityType}] [Site Id: ${siteId}] Grouped suggestions into ${groupedSuggestions.size} groups for code-fix generation`);

    const messagePromises = Array.from(groupedSuggestions.values()).map(async (group) => {
      const message = {
        type: `codefix:${opportunityType}`,
        siteId,
        auditId,
        url: baseUrl,
        deliveryType: site.getDeliveryType(),
        source: 'spacecat',
        observation: 'Auto optimize form accessibility',
        time: new Date().toISOString(),
        data: {
          opportunityId: opportunity.getId(),
          suggestionIds: group.suggestionIds,
          codeBucket,
          codePath,
        },
      };

      try {
        await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, message);
        log.info(`[${opportunityType}] [Site Id: ${siteId}] Sent code-fix message to Mystique for URL: ${group.url}, source: ${group.source}, issueType: ${group.issueType}, suggestions: ${group.suggestionIds.length}`);
      } catch (error) {
        log.error(`[${opportunityType}] [Site Id: ${siteId}] Failed to send code-fix message for URL: ${group.url}, error: ${error.message}`);
      }
    });

    await Promise.all(messagePromises);
    log.info(`[${opportunityType}] [Site Id: ${siteId}] Completed sending ${messagePromises.length} code-fix messages to Mystique`);
  } catch (error) {
    log.error(`[${opportunityType}] [Site Id: ${siteId}] Error in sendCodeFixMessagesToMystique: ${error.message}`);
  }
}
