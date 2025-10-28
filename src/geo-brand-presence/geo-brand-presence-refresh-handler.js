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
  transformWebSearchProviderForMystique,
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
  const siteId = site.getId();

  log.info(`%s: Starting query-index fetch for siteId: ${siteId}`, AUDIT_NAME);

  // Get the site's LLMO data folder
  const dataFolder = site.getConfig()?.getLlmoDataFolder?.();
  if (!dataFolder) {
    throw new Error(`${AUDIT_NAME}:No LLMO data folder configured for site can't proceed with audit`);
  }

  log.info(`%s: Reading query-index from SharePoint for siteId: ${siteId}, path: ${dataFolder}/query-index.xlsx`, AUDIT_NAME);

  // Read the query-index.xlsx file from SharePoint
  const readStartTime = Date.now();
  const queryIndexBuffer = await readFromSharePoint('query-index.xlsx', dataFolder, sharepointClient, log);
  const readDuration = Date.now() - readStartTime;

  log.info(`%s: Query-index file downloaded for siteId: ${siteId} (${queryIndexBuffer.length} bytes in ${readDuration}ms)`, AUDIT_NAME);

  // Parse the Excel file to extract paths
  log.debug(`%s: Parsing Excel workbook for siteId: ${siteId}`, AUDIT_NAME);
  const parseStartTime = Date.now();
  const workbook = new ExcelJS.Workbook();
  // @ts-ignore - Buffer type compatibility issue with ExcelJS
  await workbook.xlsx.load(queryIndexBuffer);
  const parseDuration = Date.now() - parseStartTime;

  log.info(`%s: Excel workbook parsed for siteId: ${siteId} (${workbook.worksheets.length} worksheets in ${parseDuration}ms)`, AUDIT_NAME);

  const latestPaths = [];
  const regularPaths = [];

  log.debug(`%s: Extracting paths from worksheets for siteId: ${siteId}`, AUDIT_NAME);

  // Iterate through all worksheets to find path data
  workbook.worksheets.forEach((worksheet, worksheetIndex) => {
    log.debug(`%s: Processing worksheet ${worksheetIndex + 1}/${workbook.worksheets.length} for siteId: ${siteId}, name: ${worksheet.name}`, AUDIT_NAME);

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
                log.debug(`%s: Found latest path for siteId: ${siteId}, path: ${filenameWithoutExt}`, AUDIT_NAME);
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
                log.debug(`%s: Found regular path for siteId: ${siteId}, path: ${filenameWithoutExt}`, AUDIT_NAME);
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

  log.info(`%s: Path extraction complete for siteId: ${siteId}, latest: ${latestPaths.length}, regular: ${regularPaths.length}, using: ${paths.length} from ${brandPresenceFolder}`, AUDIT_NAME);

  // @todo need to make  sure that we load data starting week
  if (paths.length > 0) {
    log.info(`%s: Extracted ${paths.length} paths from query-index SharePoint file for siteId: ${siteId}, source: ${sourceFolder}`, AUDIT_NAME);
    log.debug(`%s: Paths for siteId: ${siteId}: ${paths.join(', ')}`, AUDIT_NAME);
    return { paths, sourceFolder };
  }
  throw new Error(`${AUDIT_NAME} No paths found in query-index file`);
}

export async function refreshGeoBrandPresenceSheetsHandler(message, context) {
  const { log, dataAccess } = context;
  const { Site } = dataAccess;
  const { siteId, auditContext } = message;
  let errMsg;

  log.info(`%s: Handler invoked for siteId: ${siteId}`, AUDIT_NAME);
  log.debug(`%s: Message details for siteId: ${siteId}:`, AUDIT_NAME, message);

  const site = await Site.findById(siteId);
  if (!site) {
    throw new Error(`${AUDIT_NAME}: Site not found for siteId: ${siteId}`);
  }

  // Priority: context (for wrapper) > site config > default
  const brandPresenceCadence = context.brandPresenceCadence
    || site.getConfig()?.getBrandPresenceCadence?.()
    || 'weekly';
  const isDaily = brandPresenceCadence === 'daily';

  log.info(`%s: Processing refresh with cadence: ${brandPresenceCadence} for siteId: ${siteId}, isDaily: ${isDaily}`, AUDIT_NAME);

  // fetch sheets that need to be refreshed from SharePoint
  // Get the SharePoint client
  log.info(`%s: Creating SharePoint client for siteId: ${siteId}`, AUDIT_NAME);
  const sharepointClient = await createLLMOSharepointClient(context);

  let sourceFolder;
  let sheets;
  try {
    log.info(`%s: Fetching query-index paths for siteId: ${siteId}`, AUDIT_NAME);
    const fetchStartTime = Date.now();

    ({
      sourceFolder,
      paths: sheets,
    } = await fetchQueryIndexPaths(site, context, sharepointClient));

    const fetchDuration = Date.now() - fetchStartTime;
    log.info(`%s: Query-index paths fetched for siteId: ${siteId} in ${fetchDuration}ms`, AUDIT_NAME);
  } catch (cause) {
    const msg = `Failed to read query-index from SharePoint: ${errorMsg(cause)}`;
    log.error(`%s: ${msg} for siteId: ${siteId}`, AUDIT_NAME, {
      siteId,
      error: errorMsg(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    });
    throw new Error(msg, { cause });
  }

  log.info(`%s: Source folder: ${sourceFolder}, Sheets to refresh: ${sheets.length} for siteId: ${siteId}`, AUDIT_NAME);
  log.debug(`%s: Sheet names for siteId: ${siteId}: ${sheets.join(', ')}`, AUDIT_NAME);

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

  log.info(`%s: Created audit ID ${auditId} for siteId: ${siteId}, S3 folder: ${folderKey}`, AUDIT_NAME);

  try {
    // Create a metadata file to establish the folder structure
    log.debug(`%s: Creating metadata for ${sheets.length} sheets, auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);

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

    log.info(`%s: Writing metadata to S3 for auditId: ${auditId}, siteId: ${siteId}, bucket: ${bucketName}, key: ${refreshMetadataFileS3Key(auditId)}`, AUDIT_NAME);
    const metadataStartTime = Date.now();

    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: refreshMetadataFileS3Key(auditId),
      Body: JSON.stringify(metadata, null, 2),
      ContentType: 'application/json',
    }));

    const metadataDuration = Date.now() - metadataStartTime;
    log.info(`%s: Metadata written to S3 for auditId: ${auditId}, siteId: ${siteId} in ${metadataDuration}ms`, AUDIT_NAME);

    const baseURL = site.getBaseURL();
    const deliveryType = site.getDeliveryType();
    const { configVersion } = auditContext;

    log.info(`%s: Site details for auditId: ${auditId}, siteId: ${siteId}, baseURL: ${baseURL}, deliveryType: ${deliveryType}, configVersion: ${configVersion || 'none'}`, AUDIT_NAME);

    log.info(`%s: Processing ${sheets.length} sheets for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    const processingStartTime = Date.now();

    // eslint-disable-next-line no-unused-vars
    const results = await Promise.allSettled(sheets.map(async (sheetName, index) => {
      log.info(`%s: Processing sheet ${index + 1}/${sheets.length} for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}`, AUDIT_NAME);

      const match = RE_SHEET_NAME.exec(sheetName);
      if (!match) {
        log.warn(`%s: Skipping invalid sheet name ${sheetName} for auditId: ${auditId}, siteId: ${siteId}. Expected format: brandpresence-<webSearchProvider>-w<WW>-<YYYY>`, AUDIT_NAME);
        return false;
      }
      const { webSearchProvider, week, year } = match.groups;

      log.debug(`%s: Sheet ${sheetName} parsed for auditId: ${auditId}, siteId: ${siteId}, provider: ${webSearchProvider}, week: ${week}, year: ${year}`, AUDIT_NAME);

      log.info(`%s: Reading sheet from SharePoint for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, source: ${sourceFolder}`, AUDIT_NAME);
      const readStartTime = Date.now();
      const sheet = await readFromSharePoint(`${sheetName}.xlsx`, sourceFolder, sharepointClient, log);
      const readDuration = Date.now() - readStartTime;

      log.info(`%s: Sheet read from SharePoint for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName} (${sheet.length} bytes in ${readDuration}ms)`, AUDIT_NAME);

      log.info(`%s: Uploading sheet to S3 for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, key: ${folderKey}/${sheetName}.xlsx`, AUDIT_NAME);
      const s3UploadStartTime = Date.now();

      await s3Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: `${folderKey}/${sheetName}.xlsx`,
        Body: sheet,
        ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));

      const s3UploadDuration = Date.now() - s3UploadStartTime;
      log.info(`%s: Sheet uploaded to S3 for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName} (${sheet.length} bytes in ${s3UploadDuration}ms)`, AUDIT_NAME);

      log.debug(`%s: Generating presigned URL for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}`, AUDIT_NAME);
      const url = await getPresignedUrl(
        s3Client,
        new GetObjectCommand({ Bucket: bucketName, Key: `${folderKey}/${sheetName}.xlsx` }),
        { expiresIn: 86_400 /* seconds, 24h */ },
      );

      log.debug(`%s: Presigned URL generated for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, url: ${url}`, AUDIT_NAME);

      // Determine message type based on cadence
      const messageType = isDaily
        ? 'refresh:geo-brand-presence-daily'
        : 'refresh:geo-brand-presence';

      log.debug(`%s: Creating Mystique message for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, type: ${messageType}`, AUDIT_NAME);
      const msg = createMystiqueMessage({
        type: messageType,
        auditId,
        baseURL,
        siteId,
        deliveryType,
        calendarWeek: { week: +week, year: +year },
        url,
        webSearchProvider: transformWebSearchProviderForMystique(webSearchProvider),
        configVersion,
        date: null, // TODO support daily refreshes
      });

      log.info(`%s: Sending message to Mystique queue for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, queue: ${env.QUEUE_SPACECAT_TO_MYSTIQUE}`, AUDIT_NAME);
      await sqs.sendMessage(env.QUEUE_SPACECAT_TO_MYSTIQUE, msg);

      const cadenceLabel = isDaily ? ' DAILY' : '';
      log.info(`%s%s: Sent sheet ${sheetName} to Mystique for processing, auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME, cadenceLabel);
      return true;
    }));

    const processingDuration = Date.now() - processingStartTime;
    log.info(`%s: All ${sheets.length} sheets processed for auditId: ${auditId}, siteId: ${siteId} in ${processingDuration}ms`, AUDIT_NAME);

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

const RE_SHEET_NAME = /^brandpresence-(?<webSearchProvider>.+?)-w(?<week>\d{2})-(?<year>\d{4})(?:-\d+)?$/;
