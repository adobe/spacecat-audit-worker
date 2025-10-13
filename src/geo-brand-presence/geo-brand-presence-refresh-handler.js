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

/* eslint-disable no-use-before-define */

import { ok } from '@adobe/spacecat-shared-http-utils';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl as getPresignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { createLLMOSharepointClient, readFromSharePoint } from '../utils/report-uploader.js';
import { createMystiqueMessage } from './handler.js';
import {
  refreshDirectoryS3Key,
  refreshMetadataFileS3Key,
  refreshSheetResultFileName,
  writeSheetRefreshResultFailed,
  writeSheetRefreshResultSkipped,
} from './util.js';

/**
 * @import { SharepointClient } from '@adobe/spacecat-helix-content-sdk/src/sharepoint/client.js';
 * @import { RefreshMetadata } from './util.js';
 */

const AUDIT_NAME = 'GEO_BRAND_PRESENCE_REFRESH';
/* c8 ignore start */

/**
 * Fetches the list of paths from the query-index SharePoint file
 * @param {Object} site - The site object to get LLMO data folder from
 * @param {Object} context - The context object containing env and log
 * @param {SharepointClient} sharepointClient - The SharePoint client instance
 * @returns {Promise<{ sourceFolder: string, paths: Array<string> }>}
 */
async function fetchQueryIndexPaths(site, context, sharepointClient) {
  const { log } = context;
  // Get the site's LLMO data folder
  const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    throw new Error(`${AUDIT_NAME}:No LLMO data folder configured for site can't proceed with audit`);
  }

  log.info(`%s:Reading query-index from SharePoint: ${dataFolder}/query-index.xlsx`, AUDIT_NAME);

  // Read the query-index.xlsx file from SharePoint
  const queryIndexBuffer = await readFromSharePoint('query-index.xlsx', dataFolder, sharepointClient, log);

  // Parse the Excel file to extract paths
  const workbook = new ExcelJS.Workbook();
  // @ts-ignore - Buffer type compatibility issue with ExcelJS
  await workbook.xlsx.load(queryIndexBuffer);

  const latestPaths = [];
  const regularPaths = [];

  // Iterate through all worksheets to find path data
  workbook.worksheets.forEach((worksheet) => {
    worksheet.eachRow((row, rowNumber) => {
      // Skip header row
      if (rowNumber === 1) return;

      // Look for path-like data in the first column or any column that contains path information
      row.eachCell((cell) => {
        const cellValue = cell.value;
        if (cellValue && typeof cellValue === 'string') {
          // Check for brand-presence/latest/ first (priority)
          if (cellValue.includes('/brand-presence/latest/')) {
            const filename = cellValue.split('/').pop();
            if (filename) {
              // Remove .json extension
              const filenameWithoutExt = filename.replace(/\.json$/i, '');
              if (!latestPaths.includes(filenameWithoutExt)) {
                latestPaths.push(filenameWithoutExt);
              }
            }
          } else if (cellValue.includes('/brand-presence/') && !cellValue.includes('/brand-presence/latest/')) {
            // Then check for regular brand-presence/ (fallback)
            const filename = cellValue.split('/').pop();
            if (filename) {
              // Remove .json extension
              const filenameWithoutExt = filename.replace(/\.json$/i, '');
              if (!regularPaths.includes(filenameWithoutExt)) {
                regularPaths.push(filenameWithoutExt);
              }
            }
          }
        }
      });
    });
  });

  // Use latest paths if available, otherwise fall back to regular paths
  const paths = latestPaths.length > 0 ? latestPaths : regularPaths;
  const brandPresenceFolder = latestPaths.length > 0 ? 'brand-presence/latest' : 'brand-presence';
  const sourceFolder = `${dataFolder}/${brandPresenceFolder}`;
  // @todo need to make  sure that we load data starting week
  if (paths.length > 0) {
    log.info(`%s:Extracted ${paths.length} paths from query-index SharePoint file (source: ${sourceFolder})`, AUDIT_NAME);
    return { paths, sourceFolder };
  }

  throw new Error('REFRESH GEO BRAND PRESENCE: No paths found in query-index file');
}

export async function refreshGeoBrandPresenceSheetsHandler(message, context) {
  const { log, dataAccess } = context;
  const { Site } = dataAccess;
  const { siteId, auditContext } = message;
  let errMsg;
  const site = await Site.findById(siteId);

  // fetch sheets that need to be refreshed from SharePoint
  // Get the SharePoint client
  const sharepointClient = await createLLMOSharepointClient(context);
  let sourceFolder;
  let sheets;
  try {
    ({
      sourceFolder,
      paths: sheets,
    } = await fetchQueryIndexPaths(site, context, sharepointClient));
  } catch (cause) {
    const msg = `Failed to read query-index from SharePoint: ${errorMsg(cause)}`;
    log.error(msg);
    throw new Error(msg, { cause });
  }
  log.info(`Source folder: ${sourceFolder}, Sheets to refresh: ${sheets.join(', ')}`);
  // save metadata for S3 to track progress

  // const audit = await createAudit({
  //   // audit data goes here
  // }, context);

  // Create S3 folder for audit tracking
  const { s3Client, env, sqs } = context;
  const bucketName = env?.S3_IMPORTER_BUCKET_NAME;

  if (!bucketName || !s3Client) {
    log.warn('%s: S3 bucket name or client not available, skipping folder creation', AUDIT_NAME);
    errMsg = `${AUDIT_NAME}:S3 bucket name or client not available, skipping folder creation`;
    throw new Error(errMsg);
  }
  const auditId = randomUUID();
  const folderKey = refreshDirectoryS3Key(auditId);

  try {
    // Create a metadata file to establish the folder structure
    const files = sheets.map((sheetName) => ({
      name: `${sheetName}.xlsx`,
      resultFile: refreshSheetResultFileName(sheetName),
    }));

    /** @type {RefreshMetadata} */
    const metadata = {
      auditId,
      createdAt: new Date().toISOString(),
      files,
    };

    // In our metadata directory, we write the following files:
    // - metadata.json: contains a list of sheets to be processed, and their expected result files.
    // - <sheetName>.metadata.json: for each sheet, a metadata file indicating
    //                              success or failure of processing.

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: refreshMetadataFileS3Key(auditId),
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));

    const baseURL = site.getBaseURL();
    const deliveryType = site.getDeliveryType();
    const { configVersion } = auditContext;

    // eslint-disable-next-line no-unused-vars
    const results = await Promise.allSettled(sheets.map(async (sheetName) => {
      const match = RE_SHEET_NAME.exec(sheetName);
      if (!match) {
        log.warn('%s:Skipping invalid sheet name %s. Expected format: brandpresence-<webSearchProvider>-w<WW>-<YYYY>', AUDIT_NAME, sheetName);
        return false;
      }
      const { webSearchProvider, week, year } = match.groups;

      const sheet = await readFromSharePoint(`${sheetName}.xlsx`, sourceFolder, sharepointClient, log);

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: `${folderKey}/${sheetName}.xlsx`,
        Body: sheet,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));

      const url = await getPresignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucketName, Key: `${folderKey}/${sheetName}.xlsx` }),
        { expiresIn: 86_400 /* seconds, 24h */ },
      );

      const msg = createMystiqueMessage({
        type: 'refresh:geo-brand-presence',
        auditId,
        baseURL,
        siteId,
        deliveryType,
        calendarWeek: { week: +week, year: +year },
        url,
        webSearchProvider,
        configVersion,
        date: null, // TODO support daily refreshes
      });

      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, msg);
      log.info('%s: Sent sheet %s to Mystique for processing', AUDIT_NAME, sheetName, msg);
      return true;
    }));

    const errors = [];
    let successful = 0;
    await Promise.allSettled(
      results.map(async (result, i) => {
        const sheetName = sheets[i];
        if (result.status === 'fulfilled') {
          if (result.value) {
            successful += 1;
          } else {
            await writeSheetRefreshResultSkipped({
              message: `Invalid sheet name format: ${sheets[i]}`,
              outputDir: folderKey,
              s3Client,
              s3Bucket: bucketName,
              sheetName,
            });
          }
        } else if (result.status === 'rejected') {
          log.error('%s:Failed to process sheet %s: %s', AUDIT_NAME, sheetName, errorMsg(result.reason));
          await writeSheetRefreshResultFailed({
            message: errorMsg(result.reason),
            outputDir: folderKey,
            s3Client,
            s3Bucket: bucketName,
            sheetName,
          });
          errors.push(result.reason);
        }
      }),
    );

    let logMsg = '%s:Created S3 folder for audit %s at s3://%s/%s';
    const logArgs = [AUDIT_NAME, auditId, bucketName, folderKey];
    let logLevel = 'info';

    if (successful < results.length) {
      logLevel = 'warn';
      logMsg += ' with %d/%d sheets successfully queued';
      logArgs.push(successful, results.length);
    }
    if (errors.length > 0) {
      logLevel = 'error';
      logMsg += '. Errors: %s';
      logArgs.push(errors.map((e) => errorMsg(e)).join('; '));
    }

    log[logLevel](logMsg, ...logArgs);
  } catch (error) {
    log.error('%s:Failed to create S3 folder for audit %s: %s', AUDIT_NAME, auditId, errorMsg(error));
    errMsg = `${AUDIT_NAME}:Failed to create S3 folder for audit ${auditId}`;
    throw new Error(errMsg);
  }

  log.info('Site: %s, Audit: %s, Context:', site, {}, auditContext);

  return ok();
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMsg(error) {
  return error instanceof Error ? error.message : String(error);
}

const RE_SHEET_NAME = /^brandpresence-(?<webSearchProvider>.+?)-w(?<week>\d{2})-(?<year>\d{4})$/;
