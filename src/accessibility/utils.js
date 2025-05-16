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
import { getObjectFromKey, getObjectKeysUsingPrefix } from '../utils/s3-utils.js';

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
) {
  if (!s3Client || !bucketName || !siteId) {
    const message = 'Missing required parameters for aggregateAccessibilityData';
    log.error(message);
    return { success: false, aggregatedData: null, message };
  }

  // check if there are any other final-result files in the accessibility/siteId folder
  const listObjectsCommand = new ListObjectsV2Command({
    Bucket: bucketName,
    Prefix: `accessibility/${siteId}/`,
  });
  const listObjectsResult = await s3Client.send(listObjectsCommand);
  const otherFinalResultFiles = listObjectsResult.Contents.filter((obj) => obj.Key.startsWith(`accessibility/${siteId}/final-result-`));
  if (otherFinalResultFiles.length > 0) {
    log.info(`[A11yAudit] Found ${otherFinalResultFiles.length} final-result files in the accessibility/siteId folder.`);
    const objectKeyForLastWeekFile = otherFinalResultFiles[0].Key;
    // eslint-disable-next-line max-len
    const lastWeekFile = await getObjectFromKey(s3Client, bucketName, objectKeyForLastWeekFile, log);
    if (lastWeekFile) {
      log.info(`[A11yAudit] Last week file: ${JSON.stringify(lastWeekFile.data, null, 2)}`);
    }
  }

  try {
    // Prefix for accessibility data for this site
    const prefix = `accessibility/${siteId}/`;
    const delimiter = '/';
    log.info(`Fetching accessibility data for site ${siteId} from bucket ${bucketName}`);

    // Get all subfolders for this site
    // eslint-disable-next-line max-len
    const subfolders = await getSubfoldersUsingPrefixAndDelimiter(s3Client, bucketName, prefix, delimiter, log);
    if (subfolders.length === 0) {
      const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId} with delimiter ${delimiter}`;
      log.info(message);
      return { success: false, aggregatedData: null, message };
    }
    log.info(`Found ${subfolders.length} subfolders for site ${siteId} in bucket ${bucketName} with delimiter ${delimiter} and value ${subfolders}`);

    // sort subfolders by timestamp
    subfolders.sort((a, b) => {
      const timestampA = new Date(a.split('/').pop());
      const timestampB = new Date(b.split('/').pop());
      return timestampB.getTime() - timestampA.getTime();
    });

    // get the latest subfolder
    const latestSubfolder = subfolders[0];
    const objectKeys = await getObjectKeysUsingPrefix(s3Client, bucketName, latestSubfolder, log, 1000, '.json');

    if (!objectKeys || objectKeys.length === 0) {
      const message = `No accessibility data found in bucket ${bucketName} at prefix ${prefix} for site ${siteId}`;
      log.info(message);
      return { success: false, aggregatedData: null, message };
    }

    log.info(`Found ${objectKeys.length} data files for site ${siteId}`);

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

    return {
      success: true,
      aggregatedData,
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
