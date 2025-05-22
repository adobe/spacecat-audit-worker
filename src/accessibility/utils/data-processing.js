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
} from './reportOppty.js';
import {
  generateInDepthReportMarkdown,
  generateEnhancedReportMarkdown,
  generateFixedNewReportMarkdown,
  generateBaseReportMarkdown,
  getWeekNumber,
} from './generateMdReports.js';

/**
 * Deletes the original JSON files after they've been processed
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string[]} objectKeys - array of keys to delete
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @returns {Promise<number>} - number of deleted files
 */
async function deleteOriginalFiles(s3Client, bucketName, objectKeys, log) {
  if (!objectKeys || objectKeys.length === 0) {
    return 0;
  }

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
      return objectKeys.length;
    } else if (objectKeys.length === 1) { // For a single object, use DeleteObject
      await s3Client.send(new DeleteObjectCommand({
        Bucket: bucketName,
        Key: objectKeys[0],
      }));
      return 1;
    }

    return 0;
  } catch (error) {
    log.error('Error deleting original files', error);
    return 0;
  }
}

async function getSubfoldersUsingPrefixAndDelimiter(
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
    log.info(
      `Fetched ${data.CommonPrefixes.length} keys from S3 for bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
    );
    return data.CommonPrefixes.map((subfolder) => subfolder.Prefix);
  } catch (err) {
    log.error(
      `Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix} with delimiter ${delimiter}`,
      err,
    );
    throw err;
  }
}

/**
 * Aggregates accessibility audit data from multiple JSON files in S3 and creates a summary
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} siteId - the site ID to look for
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {string} outputKey - the key for the aggregated output file
 * @returns {Promise<{success: boolean, aggregatedData: object, message: string}>} - result
 */
export async function aggregateAccessibilityData(
  s3Client,
  bucketName,
  siteId,
  log,
  outputKey,
  version,
) {
  if (!s3Client || !bucketName || !siteId) {
    const message = 'Missing required parameters for aggregateAccessibilityData';
    log.error(message);
    return { success: false, aggregatedData: null, message };
  }

  // Initialize aggregated data structure
  const aggregatedData = {
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
    // Prefix for accessibility data for this site
    const prefix = `accessibility/${siteId}/`;
    const delimiter = '/';
    log.info(`Fetching accessibility data for site ${siteId} from bucket ${bucketName}`);

    // Get all subfolders for this site, best case scenario should be 1
    // eslint-disable-next-line max-len
    const subfolders = await getSubfoldersUsingPrefixAndDelimiter(s3Client, bucketName, prefix, delimiter, log);
    if (subfolders.length === 0) {
      const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
      log.info(message);
      return { success: false, aggregatedData: null, message };
    }
    log.info(`Found ${subfolders.length} subfolders for site ${siteId} in bucket ${bucketName} with delimiter ${delimiter} and value ${subfolders}`);

    // sort subfolders by timestamp descending in case there are > 1 from various reasons
    const getCurrentSubfolders = subfolders.filter((timestamp) => new Date(parseInt(timestamp.split('/').filter((item) => item !== '').pop(), 10)).toISOString().split('T')[0] === version);
    if (getCurrentSubfolders.length === 0) {
      const message = `No accessibility data found for today's date in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
      log.info(message);
      return { success: false, aggregatedData: null, message };
    }

    // get the latest subfolder
    const processSubfolderPromises = getCurrentSubfolders.map(async (subfolder) => {
      const objectKeysResult = await getObjectKeysUsingPrefix(s3Client, bucketName, subfolder, log, 1000, '.json');
      return { data: objectKeysResult };
    });
    const processSubfolderPromisesResult = await Promise.all(processSubfolderPromises);
    const objectKeys = processSubfolderPromisesResult.flatMap((result) => result.data);

    if (!objectKeys || objectKeys.length === 0) {
      const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId}`;
      log.info(message);
      return { success: false, aggregatedData: null, message };
    }

    log.info(`Found ${objectKeys.length} data files for site ${siteId}`);

    // Process files in parallel using Promise.all
    const processFilePromises = objectKeys.map(async (key) => {
      const data = await getObjectFromKey(s3Client, bucketName, key, log);

      if (!data) {
        log.warn(`Failed to get data from ${key}, skipping`);
        return null;
      }

      return { key, data };
    });

    const results = await Promise.all(processFilePromises);

    // Process the results
    results.forEach((result) => {
      if (!result) return;

      const { data } = result;
      const { violations, traffic, url: siteUrl } = data;

      // Store the url specific data
      aggregatedData[siteUrl] = {
        violations,
        traffic,
      };

      // Update overall data
      if (violations.critical && violations.critical.items && violations.critical.count) {
        aggregatedData.overall.violations.critical.count += violations.critical.count;
        Object.entries(violations.critical.items).forEach(([key, value]) => {
          if (!aggregatedData.overall.violations.critical.items[key]) {
            aggregatedData.overall.violations.critical.items[key] = {
              count: value.count,
              description: value.description,
              level: value.level,
              understandingUrl: value.understandingUrl,
              successCriteriaNumber: value.successCriteriaNumber,
            };
          } else {
            aggregatedData.overall.violations.critical.items[key].count += value.count;
          }
        });
      }
      if (violations.serious && violations.serious.items && violations.serious.count) {
        aggregatedData.overall.violations.serious.count += violations.serious.count;
        Object.entries(violations.serious.items).forEach(([key, value]) => {
          if (!aggregatedData.overall.violations.serious.items[key]) {
            aggregatedData.overall.violations.serious.items[key] = {
              count: value.count,
              description: value.description,
              level: value.level,
              understandingUrl: value.understandingUrl,
              successCriteriaNumber: value.successCriteriaNumber,
            };
          } else {
            aggregatedData.overall.violations.serious.items[key].count += value.count;
          }
        });
      }
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

    // Delete original files (optional, can be disabled)
    const deletedCount = await deleteOriginalFiles(s3Client, bucketName, objectKeys, log);
    log.info(`Deleted ${deletedCount} original files after aggregation`);

    // check if there are any other final-result files in the accessibility/siteId folder
    // if there are, we will use the latest one for comparison later on
    // and delete the rest (ideally 2 should be left)
    const lastWeekObjectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, `accessibility/${siteId}/`, log, 10, '-final-result.json');
    log.info(`[A11yAudit] Found ${lastWeekObjectKeys.length} final-result files in the accessibility/siteId folder with keys: ${lastWeekObjectKeys}`);

    // get last week file and start creating the report
    // eslint-disable-next-line max-len
    const lastWeekFile = lastWeekObjectKeys.length < 2 ? null : await getObjectFromKey(s3Client, bucketName, lastWeekObjectKeys[lastWeekObjectKeys.length - 2], log);
    if (lastWeekFile) {
      log.info(`[A11yAudit] Last week file key:${lastWeekObjectKeys[1]} with content: ${JSON.stringify(lastWeekFile, null, 2)}`);
    }

    // delete oldest final result file if there are more than 2
    if (lastWeekObjectKeys.length > 2) {
      lastWeekObjectKeys.sort((a, b) => {
        const timestampA = new Date(a.split('/').pop().replace('-final-result.json', ''));
        const timestampB = new Date(b.split('/').pop().replace('-final-result.json', ''));
        return timestampA.getTime() > timestampB.getTime() ? 1 : -1;
      });
      const objectKeyToDelete = lastWeekObjectKeys[0];
      // eslint-disable-next-line max-len
      const deletedCountOldestFile = await deleteOriginalFiles(s3Client, bucketName, [objectKeyToDelete], log);
      log.info(`Deleted ${deletedCountOldestFile} oldest final result file: ${objectKeyToDelete}`);
    }

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
    return {
      status: true,
      opportunity,
    };
  } catch (e) {
    log.error(`Failed to create new opportunity for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    return {
      success: false,
      message: `Error: ${e.message}`,
    };
  }
}

export async function createReportOpportunitySuggestion(
  opportunity,
  inDepthOverviewMarkdown,
  auditData,
  log,
) {
  const suggestions = createReportOpportunitySuggestionInstance(inDepthOverviewMarkdown);

  try {
    const suggestion = await opportunity.addSuggestions(suggestions);
    return {
      status: true,
      suggestion,
    };
  } catch (e) {
    log.error(`Failed to create new suggestion for siteId ${auditData.siteId} and auditId ${auditData.auditId}: ${e.message}`);
    return {
      success: false,
      message: `Error: ${e.message}`,
    };
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
  try {
    finalResultFiles = await getObjectKeysUsingPrefix(s3Client, bucketName, `accessibility/${siteId}/`, log, 10, '-final-result.json');
    if (finalResultFiles.length === 0) {
      const errorMessage = `[A11yAudit] No final result files found for ${siteId}`;
      log.error(errorMessage);
      throw new Error(errorMessage);
    }
  } catch (error) {
    log.error(`[A11yAudit] Error getting final result files for ${siteId}: ${error.message}`);
    throw error;
  }

  const latestFinalResultFileKey = finalResultFiles[finalResultFiles.length - 1];
  let latestFinalResultFile;
  try {
    // eslint-disable-next-line max-len
    latestFinalResultFile = await getObjectFromKey(s3Client, bucketName, latestFinalResultFileKey, log);
    if (!latestFinalResultFile) {
      const errorMessage = `[A11yAudit] No latest final result file found for ${siteId}`;
      log.error(errorMessage);
      throw new Error(errorMessage);
    }
  } catch (error) {
    log.error(`[A11yAudit] Error getting latest final result file for ${siteId}: ${error.message}`);
    throw error;
  }

  delete latestFinalResultFile.overall;
  const urlsToScrape = [];
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
    throw new Error(errorMessage);
  }

  return urlsToScrape;
}

// eslint-disable-next-line max-len
async function generateIndepthReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year) {
  // 1.1 generate the markdown report for in-depth overview
  const inDepthOverviewMarkdown = generateInDepthReportMarkdown(current);

  if (!inDepthOverviewMarkdown) {
    throw new Error('Failed to generate in-depth overview markdown');
  }

  // 1.2 create the opportunity for the in-depth overview report
  const opportunityInstance = createInDepthReportOpportunity(week, year);
  let opportunityRes;

  try {
    opportunityRes = await createReportOpportunity(opportunityInstance, auditData, context);
    if (!opportunityRes.status) {
      log.error('Failed to create report opportunity', opportunityRes.message);
      throw new Error(opportunityRes.message);
    }
  } catch (error) {
    log.error('Failed to create report opportunity', error.message);
    throw new Error(error.message);
  }

  const { opportunity: inDepthOverviewOpportunity } = opportunityRes;

  try {
    // 1.3 create the suggestions for the in-depth overview report oppty
    const suggestionRes = await createReportOpportunitySuggestion(
      inDepthOverviewOpportunity,
      inDepthOverviewMarkdown,
      auditData,
      log,
    );

    if (!suggestionRes.status) {
      log.error('Failed to create report opportunity suggestion', suggestionRes.message);
      throw new Error(suggestionRes.message);
    }
  } catch (error) {
    log.error('Failed to create report opportunity suggestion', error.message);
    throw new Error(error.message);
  }

  // 1.4 update status to ignored
  await inDepthOverviewOpportunity.setStatus('IGNORED');
  await inDepthOverviewOpportunity.save();

  // 1.5 construct url for the report
  const inDepthOverviewOpportunityId = inDepthOverviewOpportunity.getId();
  return `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${inDepthOverviewOpportunityId}`;
}

// eslint-disable-next-line max-len
async function generateEnhancedReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year) {
  // 2.1 generate the markdown report for in-depth top 10
  const inDepthTop10Markdown = generateEnhancedReportMarkdown(current);

  if (!inDepthTop10Markdown) {
    throw new Error('Failed to generate in-depth top 10 markdown');
  }

  // 2.2 create the opportunity for the in-depth top 10 report
  const enhancedOpportunityInstance = createEnhancedReportOpportunity(week, year);
  let enhancedOpportunityRes;
  try {
    // eslint-disable-next-line max-len
    enhancedOpportunityRes = await createReportOpportunity(enhancedOpportunityInstance, auditData, context);
    if (!enhancedOpportunityRes.status) {
      log.error('Failed to create enhancedreport opportunity', enhancedOpportunityRes.message);
      throw new Error(enhancedOpportunityRes.message);
    }
  } catch (error) {
    log.error('Failed to create enhancedreport opportunity', error.message);
    throw new Error(error.message);
  }

  const { opportunity: inDepthTop10Opportunity } = enhancedOpportunityRes;

  try {
    // 2.3 create the suggestions for the in-depth top 10 report oppty
    const enhancedSuggestionRes = await createReportOpportunitySuggestion(
      inDepthTop10Opportunity,
      inDepthTop10Markdown,
      auditData,
      log,
    );
    if (!enhancedSuggestionRes.status) {
      log.error('Failed to create enhanced report opportunity suggestion', enhancedSuggestionRes.message);
      throw new Error(enhancedSuggestionRes.message);
    }
  } catch (error) {
    log.error('Failed to create enhanced report opportunity suggestion', error.message);
    throw new Error(error.message);
  }

  // 2.4 update status to ignored
  await inDepthTop10Opportunity.setStatus('IGNORED');
  await inDepthTop10Opportunity.save();

  // 2.5 construct url for the report
  return `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${inDepthTop10Opportunity.getId()}`;
}

// eslint-disable-next-line max-len
async function generateFixedNewReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year, lastWeek) {
  // 3.1 generate the markdown report for fixed vs new issues if any
  const fixedVsNewMarkdown = generateFixedNewReportMarkdown(current, lastWeek);

  if (!fixedVsNewMarkdown) {
    throw new Error('Failed to generate fixed vs new markdown');
  }

  // 3.2 create the opportunity for the fixed vs new report
  const fixedVsNewOpportunityInstance = createFixedVsNewReportOpportunity(week, year);
  let fixedVsNewOpportunityRes;
  try {
    // eslint-disable-next-line max-len
    fixedVsNewOpportunityRes = await createReportOpportunity(fixedVsNewOpportunityInstance, auditData, context);
    if (!fixedVsNewOpportunityRes.status) {
      log.error('Failed to create fixed vs new report opportunity', fixedVsNewOpportunityRes.message);
      throw new Error(fixedVsNewOpportunityRes.message);
    }
  } catch (error) {
    log.error('Failed to create fixed vs new report opportunity', error.message);
    throw new Error(error.message);
  }
  const { opportunity: fixedVsNewOpportunity } = fixedVsNewOpportunityRes;

  try {
    // 3.3 create the suggestions for the fixed vs new report oppty
    const fixedVsNewSuggestionRes = await createReportOpportunitySuggestion(
      fixedVsNewOpportunity,
      fixedVsNewMarkdown,
      auditData,
      log,
    );
    if (!fixedVsNewSuggestionRes.status) {
      log.error('Failed to create fixed vs new report opportunity suggestion', fixedVsNewSuggestionRes.message);
      throw new Error(fixedVsNewSuggestionRes.message);
    }
  } catch (error) {
    log.error('Failed to create fixed vs new report opportunity suggestion', error.message);
    throw new Error(error.message);
  }

  // 3.4 update status to ignored
  await fixedVsNewOpportunity.setStatus('IGNORED');
  await fixedVsNewOpportunity.save();

  // 3.5 construct url for the report
  return `https://${envAsoDomain}.adobe.com/?organizationId=${orgId}#/@aem-sites-engineering/sites-optimizer/sites/${siteId}/opportunities/${fixedVsNewOpportunity.getId()}`;
}

// eslint-disable-next-line max-len
async function generateBaseReportOpportunity(log, current, auditData, context, week, year, relatedReportsUrls, lastWeek) {
  // 4.1 generate the markdown report for base report and
  //    add the urls from the above reports into the markdown report
  const baseReportMarkdown = generateBaseReportMarkdown(current, lastWeek, relatedReportsUrls);

  if (!baseReportMarkdown) {
    throw new Error('Failed to generate base report markdown');
  }

  // 4.2 generate oppty and suggestions for the report
  const baseOpportunityInstance = createBaseReportOpportunity(week, year);
  let baseOpportunityRes;
  try {
    // eslint-disable-next-line max-len
    baseOpportunityRes = await createReportOpportunity(baseOpportunityInstance, auditData, context);
    if (!baseOpportunityRes.status) {
      log.error('Failed to create base report opportunity', baseOpportunityRes.message);
      throw new Error(baseOpportunityRes.message);
    }
  } catch (error) {
    log.error('Failed to create base report opportunity', error.message);
    throw new Error(error.message);
  }
  const { opportunity: baseOpportunity } = baseOpportunityRes;

  try {
    // 4.3 create the suggestions for the base report oppty
    const baseSuggestionRes = await createReportOpportunitySuggestion(
      baseOpportunity,
      baseReportMarkdown,
      auditData,
      log,
    );

    if (!baseSuggestionRes.status) {
      log.error('Failed to create base report opportunity suggestion', baseSuggestionRes.message);
      throw new Error(baseSuggestionRes.message);
    }
  } catch (error) {
    log.error('Failed to create base report opportunity suggestion', error.message);
    throw new Error(error.message);
  }
}

/**
 * Generates report opportunities for a given site
 * @param {string} siteId - the site ID to generate report opportunities for
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @param {object} aggregationResult - the aggregation result
 * @param {boolean} isProd - whether the environment is production
 */
export async function generateReportOpportunities(site, log, aggregationResult, isProd, context) {
  const siteId = site.getId();
  const { finalResultFiles } = aggregationResult;
  const { current, lastWeek } = finalResultFiles;

  // data needed for all reports oppties
  const week = getWeekNumber(new Date());
  const year = new Date().getFullYear();
  // eslint-disable-next-line max-len
  const latestAudit = await site.getLatestAuditByAuditType('accessibility');
  const auditData = JSON.parse(JSON.stringify(latestAudit));
  const envAsoDomain = isProd ? 'experience' : 'experience-stage';
  const orgId = site.getOrganizationId();
  const relatedReportsUrls = {
    inDepthReportUrl: '',
    enhancedReportUrl: '',
    fixedVsNewReportUrl: '',
  };

  try {
    // eslint-disable-next-line max-len
    relatedReportsUrls.inDepthReportUrl = await generateIndepthReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year);
  } catch (error) {
    log.error('Failed to generate in-depth report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    // eslint-disable-next-line max-len
    relatedReportsUrls.enhancedReportUrl = await generateEnhancedReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year);
  } catch (error) {
    log.error('Failed to generate enhanced report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    // eslint-disable-next-line max-len
    relatedReportsUrls.fixedVsNewReportUrl = await generateFixedNewReportOpportunity(siteId, log, current, orgId, envAsoDomain, auditData, context, week, year, lastWeek);
  } catch (error) {
    log.error('Failed to generate fixed vs new report opportunity', error.message);
    throw new Error(error.message);
  }

  try {
    // eslint-disable-next-line max-len
    await generateBaseReportOpportunity(log, current, auditData, context, week, year, relatedReportsUrls, lastWeek);
  } catch (error) {
    log.error('Failed to generate base report opportunity', error.message);
    throw new Error(error.message);
  }

  return {
    status: true,
    message: 'All report opportunities created successfully',
  };
}
