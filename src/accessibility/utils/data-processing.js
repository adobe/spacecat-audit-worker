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
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../../utils/s3-utils.js';
import {
  createReportOpportunitySuggestionInstance,
  createInDepthReportOpportunity,
  createEnhancedReportOpportunity,
  createFixedVsNewReportOpportunity,
  createBaseReportOpportunity,
} from './report-oppty.js';
import {
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
  generateBaseReportMarkdown,
} from './generate-md-reports.js';

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

    log.info(`Deleted ${deletedCount} original files after aggregation`);
  } catch (error) {
    log.error('Error deleting original files', error);
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
      `Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, delimiter:${delimiter}, bucketName:${bucketName}, and prefix:${prefix} are provided.`,
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
    log.info(
      `Fetched ${commonPrefixes.length} keys from S3 for bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
    );
    return commonPrefixes.map((subfolder) => subfolder.Prefix);
  } catch (err) {
    log.error(
      `Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
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
  log.info(`Fetching accessibility data for site ${siteId} from bucket ${bucketName}`);

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
    log.info(message);
    return { success: false, objectKeys: [], message };
  }
  log.info(`Found ${subfolders.length} subfolders for site ${siteId} in bucket ${bucketName} with delimiter ${delimiter} and value ${subfolders}`);

  // filter subfolders to match the current date because the name of the subfolder is a timestamp
  // we do this in case there are leftover subfolders from previous runs that fail to be deleted
  const getCurrentSubfolders = subfolders.filter((timestamp) => {
    const timestampValue = timestamp.split('/').filter((item) => item !== '').pop();
    return new Date(parseInt(timestampValue, 10)).toISOString().split('T')[0] === version;
  });
  if (getCurrentSubfolders.length === 0) {
    const message = `No accessibility data found for today's date in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
    log.info(message);
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
    log.info(message);
    return { success: false, objectKeys: [], message };
  }

  // return the object keys for the JSON files that have the reports per url
  log.info(`Found ${objectKeys.length} data files for site ${siteId}`);
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
    const deletedCountOldestFile = await deleteOriginalFiles(
      s3Client,
      bucketName,
      [objectKeyToDelete],
      log,
    );
    log.info(`Deleted ${deletedCountOldestFile} oldest final result file: ${objectKeyToDelete}`);
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
      log.error(`Error processing file ${key}: ${error.message}`);
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
      log.error(`Failed to process file ${key} after ${maxRetries} retries: ${error.message}`);
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

  log.info(`File processing completed: ${results.length} successful, ${failedCount} failed out of ${objectKeys.length} total files`);

  return { results };
}

/**
 * Aggregates accessibility audit data from multiple JSON files in S3 and creates a summary
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} siteId - the site ID to look for
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {string} outputKey - the key for the aggregated output file
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
  version,
  maxRetries = 2,
) {
  if (!s3Client || !bucketName || !siteId) {
    const message = 'Missing required parameters for aggregateAccessibilityData';
    log.error(message);
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

  try {
    // Get object keys from subfolders
    const objectKeysResult = await getObjectKeysFromSubfolders(
      s3Client,
      bucketName,
      'accessibility',
      siteId,
      version,
      log,
    );
    if (!objectKeysResult.success) {
      return { success: false, aggregatedData: null, message: objectKeysResult.message };
    }
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
      const message = `No files could be processed successfully for site ${siteId}`;
      log.error(message);
      return { success: false, aggregatedData: null, message };
    }

    // Process the results
    results.forEach((result) => {
      const { data } = result;
      const { violations, traffic, url: siteUrl } = data;

      // Store the url specific data
      aggregatedData[siteUrl] = {
        violations,
        traffic,
      };

      // Update overall data
      aggregatedData = updateViolationData(aggregatedData, violations, 'critical');
      aggregatedData = updateViolationData(aggregatedData, violations, 'serious');
      if (violations.total) {
        aggregatedData.overall.violations.total += violations.total;
      }
    });

    // Save aggregated data to S3
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: outputKey,
      Body: JSON.stringify(aggregatedData, null, 2),
      ContentType: 'application/json',
    }));

    log.info(`Saved aggregated accessibility data to ${outputKey}`);

    // check if there are any other final-result files in the accessibility/siteId folder
    // if there are, we will use the latest one for comparison later on
    const lastWeekObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, `accessibility/${siteId}/`, log, 10, '-final-result.json');
    log.info(`[A11yAudit] Found ${lastWeekObjectKeys.length} final-result files in the accessibility/siteId folder with keys: ${lastWeekObjectKeys}`);

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
      log.info(`[A11yAudit] Last week file key:${lastWeekObjectKeys[1]} with content: ${JSON.stringify(lastWeekFile, null, 2)}`);
    }

    await cleanupS3Files(s3Client, bucketName, objectKeys, lastWeekObjectKeys, log);

    return {
      success: true,
      finalResultFiles: {
        current: aggregatedData,
        lastWeek: lastWeekFile,
      },
      message: `Successfully aggregated ${objectKeys.length} files into ${outputKey}`,
    };
  } catch (error) {
    log.error(`Error aggregating accessibility data for site ${siteId}`, error);
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
    const opportunityData = {
      siteId: auditData.siteId,
      auditId: auditData.auditId,
      runbook: opportunityInstance.runbook,
      type: opportunityInstance.type,
      origin: opportunityInstance.origin,
      title: opportunityInstance.title,
      description: opportunityInstance.description,
      tags: opportunityInstance.tags,
    };
    const opportunity = await Opportunity.create(opportunityData);
    return { opportunity };
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
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
    log.error(`Failed to create new suggestion for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    throw new Error(e.message);
  }
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
      const errorMessage = `[A11yAudit] No final result files found for ${siteId}`;
      log.error(errorMessage);
      return urlsToScrape;
    }
  } catch (error) {
    log.error(`[A11yAudit] Error getting final result files for ${siteId}: ${error.message}`);
    return urlsToScrape;
  }

  const latestFinalResultFileKey = finalResultFiles[finalResultFiles.length - 1];
  let latestFinalResultFile;
  try {
    // eslint-disable-next-line max-len
    latestFinalResultFile = await getObjectFromKey(s3Client, bucketName, latestFinalResultFileKey, log);
    if (!latestFinalResultFile) {
      const errorMessage = `[A11yAudit] No latest final result file found for ${siteId}`;
      log.error(errorMessage);
      return urlsToScrape;
    }
  } catch (error) {
    log.error(`[A11yAudit] Error getting latest final result file for ${siteId}: ${error.message}`);
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
    log.error(errorMessage);
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
 * @returns {Promise<string>} - the URL of the opportunity
 */
export async function generateReportOpportunity(
  reportData,
  genMdFn,
  createOpportunityFn,
  reportName,
  shouldIgnore = true,
) {
  const {
    mdData,
    linkData,
    opptyData,
    auditData,
    context,
  } = reportData;
  const { week, year } = opptyData;
  const { log } = context;

  // 1.1 generate the markdown report
  const reportMarkdown = genMdFn(mdData);

  if (!reportMarkdown) {
    // If the markdown is empty, we don't want to create an opportunity
    // and we don't want to throw an error
    return '';
  }

  // 1.2 create the opportunity for the report
  const opportunityInstance = createOpportunityFn(week, year);
  let opportunityRes;

  try {
    opportunityRes = await createReportOpportunity(opportunityInstance, auditData, context);
  } catch (error) {
    log.error(`Failed to create report opportunity for ${reportName}`, error.message);
    throw new Error(error.message);
  }

  const { opportunity } = opportunityRes;

  // 1.3 create the suggestions for the report oppty
  try {
    await createReportOpportunitySuggestion(
      opportunity,
      reportMarkdown,
      auditData,
      log,
    );
  } catch (error) {
    log.error(`Failed to create report opportunity suggestion for ${reportName}`, error.message);
    throw new Error(error.message);
  }

  // 1.4 update status to ignored
  if (shouldIgnore) {
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

export function getWeekNumber(date) {
  // Calculate ISO 8601 week number
  const target = new Date(date.valueOf());
  const dayNumber = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNumber + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + (((4 - target.getDay()) + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target) / 604800000);
  return week;
}

export function getWeekNumberAndYear() {
  const date = new Date();
  const week = getWeekNumber(date);
  const year = date.getFullYear();
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
    relatedReportsUrls.inDepthReportUrl = await generateReportOpportunity(reportData, generateInDepthReportMarkdown, createInDepthReportOpportunity, 'in-depth report');
  } catch (error) {
    log.error('Failed to generate in-depth report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    relatedReportsUrls.enhancedReportUrl = await generateReportOpportunity(reportData, generateEnhancedReportMarkdown, createEnhancedReportOpportunity, 'enhanced report');
  } catch (error) {
    log.error('Failed to generate enhanced report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    relatedReportsUrls.fixedVsNewReportUrl = await generateReportOpportunity(reportData, generateFixedNewReportMarkdown, createFixedVsNewReportOpportunity, 'fixed vs new report');
  } catch (error) {
    log.error('Failed to generate fixed vs new report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    reportData.mdData.relatedReportsUrls = relatedReportsUrls;
    await generateReportOpportunity(reportData, generateBaseReportMarkdown, createBaseReportOpportunity, 'base report', false);
  } catch (error) {
    log.error('Failed to generate base report opportunity', error.message);
    throw new Error(error.message);
  }

  return {
    status: true,
    message: 'All report opportunities created successfully',
  };
}
