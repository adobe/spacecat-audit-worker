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
/* eslint-disable no-use-before-define,no-await-in-loop */
/* c8 ignore start */

import {
  badRequest, internalServerError, notFound, ok,
} from '@adobe/spacecat-shared-http-utils';
import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';
import { GetObjectCommand, NoSuchKey, PutObjectCommand } from '@aws-sdk/client-s3';
import { ZodError } from 'zod';
import { OPPTY_TYPES } from './handler.js';
import { createLLMOSharepointClient, uploadAndPublishFile } from '../utils/report-uploader.js';
import {
  loadJSONFromS3,
  refreshDirectoryS3Key,
  refreshMetadataFileS3Key,
  refreshMetadataSchema,
  refreshSheetResultFileName,
  refreshSheetResultSchema,
  writeSheetRefreshResultFailed,
  writeSheetRefreshResultSuccess,
  batchDirectoryS3Key,
  batchMetadataFileS3Key,
  batchMetadataSchema,
  batchResultFileName,
  batchResultSchema,
  writeBatchResultFailed,
  writeBatchResultSuccess,
} from './util.js';

/**
 * @import { S3Client } from '@aws-sdk/client-s3'
 * @import { type RefreshMetadata } from './util.js'
 */

const AUDIT_NAME = 'GEO_BRAND_PRESENCE';

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site } = dataAccess;
  const {
    auditId, siteId, type: subType, data,
  } = message;

  // capture basic trigger metadata if present on message
  const triggerSource = message.auditContext?.triggerSource || message.source || 'unknown';
  const initiator = message.auditContext?.initiator || message.initiator || null;
  const webSearchProvider = message.data?.web_search_provider || message.webSearchProvider || null;
  const dateCtx = {
    week: message.week || null,
    year: message.year || null,
    date: message.data?.date || null,
  };

  log.info(
    `%s: Message received for auditId: ${auditId}, siteId: ${siteId}, subType: ${subType}, trigger: ${triggerSource}`,
    AUDIT_NAME,
  );
  log.debug('%s: Full message (redacted fields may be omitted):', AUDIT_NAME, {
    auditId,
    siteId,
    subType,
    triggerSource,
    initiator,
    webSearchProvider,
    dateCtx,
  });

  if (!subType || ![...OPPTY_TYPES, 'refresh:geo-brand-presence', 'refresh:geo-brand-presence-daily'].includes(subType)) {
    log.error(`%s: Unsupported subtype: ${subType} for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    return notFound();
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`%s: Site not found for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    return notFound();
  }

  const presignedURL = URL.parse(data.presigned_url);
  if (!presignedURL || !presignedURL.href) {
    log.error(`%s: Invalid presigned URL for auditId: ${auditId}, siteId: ${siteId}, url: ${data.presigned_url}`, AUDIT_NAME);
    return badRequest('Invalid presigned URL');
  }

  log.debug(`%s: Presigned URL validated for auditId: ${auditId}, url: ${presignedURL.href}`, AUDIT_NAME);

  // TODO: does data.config_version exist?
  const configVersion = data.config_version;
  const mainOutputLocation = context.getOutputLocation
    ? context.getOutputLocation(site)
    : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;
  const outputLocations = [mainOutputLocation, `${mainOutputLocation}/config_${configVersion || 'absent'}`];

  log.info(
    `%s: Output locations configured for auditId: ${auditId}, siteId: ${siteId}, locations: ${outputLocations.length}, configVersion: ${configVersion || 'absent'}, provider: ${webSearchProvider || 'n/a'}, week: ${dateCtx.week || 'n/a'}, year: ${dateCtx.year || 'n/a'}, date: ${dateCtx.date || 'n/a'}`,
    AUDIT_NAME,
  );
  log.debug(`%s: Output locations: ${JSON.stringify(outputLocations)}`, AUDIT_NAME);

  if (subType === 'refresh:geo-brand-presence' || subType === 'refresh:geo-brand-presence-daily') {
    log.info(`%s: Handling refresh for auditId: ${auditId}, siteId: ${siteId}, subType: ${subType}`, AUDIT_NAME);
    return handleRefresh({
      auditId, siteId, outputLocations, presignedURL,
    }, context);
  }

  // Check if this is a batch processing message
  const batchIndex = data.batch_index;

  if (batchIndex !== undefined) {
    log.info(
      `%s: Handling batch processing for auditId: ${auditId}, siteId: ${siteId}, batch: ${batchIndex}, provider: ${webSearchProvider}`,
      AUDIT_NAME,
    );
    return handleBatchProcessing({
      auditId,
      siteId,
      outputLocations,
      presignedURL,
      batchIndex,
      webSearchProvider,
      configVersion,
    }, context);
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.error(`%s: Audit not found for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    return notFound();
  }

  log.info(`%s: Fetching sheet from presigned URL for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  const fetchStartTime = Date.now();

  /** @type {Response} */
  const res = await fetch(presignedURL);
  const sheet = await res.arrayBuffer();

  const fetchDuration = Date.now() - fetchStartTime;
  const sheetSize = sheet.byteLength;
  log.info(`%s: Sheet fetched successfully for auditId: ${auditId}, siteId: ${siteId} (${sheetSize} bytes in ${fetchDuration}ms)`, AUDIT_NAME);

  // upload to sharepoint & publish via hlx admin api
  log.info(`%s: Creating SharePoint client for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  const sharepointClient = await createLLMOSharepointClient(context);

  const xlsxName = extractXlsxName(presignedURL);
  log.info(`%s: Starting SharePoint upload for auditId: ${auditId}, siteId: ${siteId}, file: ${xlsxName}, locations: ${outputLocations.length}`, AUDIT_NAME);

  const uploadStartTime = Date.now();
  await Promise.all(outputLocations.map(async (outputLocation, index) => {
    log.info(
      `%s: Uploading to location ${index + 1}/${outputLocations.length} for auditId: ${auditId}, siteId: ${siteId}, location: ${outputLocation}, provider: ${webSearchProvider || 'n/a'}`,
      AUDIT_NAME,
    );
    const locationStartTime = Date.now();

    await uploadAndPublishFile(sheet, xlsxName, outputLocation, sharepointClient, log);

    const locationDuration = Date.now() - locationStartTime;
    log.info(`%s: Upload completed for location ${index + 1}/${outputLocations.length} in ${locationDuration}ms, auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  }));

  const totalUploadDuration = Date.now() - uploadStartTime;
  log.info(`%s: All SharePoint uploads completed for auditId: ${auditId}, siteId: ${siteId} (${outputLocations.length} locations in ${totalUploadDuration}ms)`, AUDIT_NAME);

  return ok();
}

async function handleRefresh(
  {
    auditId,
    siteId,
    outputLocations,
    presignedURL,
  },
  context,
) {
  /** @type {{env: Record<string, string>, log: Console, s3Client: S3Client}} */
  const { env, log, s3Client } = context;
  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;

  log.info(`%s REFRESH: Starting refresh workflow for auditId: ${auditId}, siteId: ${siteId}, bucket: ${s3Bucket}`, AUDIT_NAME);

  // 1. Load refresh metadata
  log.info(`%s REFRESH: Loading refresh metadata for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  const metadataStartTime = Date.now();

  const refreshMeta = await loadJSONFromS3(
    s3Client,
    s3Bucket,
    refreshMetadataFileS3Key(auditId),
    refreshMetadataSchema,
  );

  const metadataDuration = Date.now() - metadataStartTime;
  log.info(`%s REFRESH: Loaded refresh metadata for auditId: ${auditId}, siteId: ${siteId} in ${metadataDuration}ms`, AUDIT_NAME);
  log.debug(`%s REFRESH: Metadata content for auditId: ${auditId}:`, AUDIT_NAME, refreshMeta);

  if (refreshMeta.status === 'rejected') {
    const { reason } = refreshMeta;
    let msg;
    if (reason instanceof NoSuchKey) {
      msg = 'No refresh metadata found';
    } else if (reason instanceof SyntaxError || reason instanceof ZodError) {
      msg = `Invalid refresh metadata: ${reason.message}`;
    } else {
      throw reason;
    }

    log.error(`%s REFRESH: ${msg} for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME, {
      auditId,
      siteId,
      error: msg,
      reason: reason.message || String(reason),
    });
    return notFound();
  }

  const refreshDir = refreshDirectoryS3Key(auditId);
  const sheetXlsxName = extractXlsxName(presignedURL);
  const sheetName = sheetXlsxName.replace(/\.xlsx$/, '');

  log.info(`%s REFRESH: Processing sheet ${sheetName} for auditId: ${auditId}, siteId: ${siteId}, S3 directory: ${refreshDir}`, AUDIT_NAME);

  // 2. Write the sheet to S3
  try {
    log.info(`%s REFRESH: Fetching sheet from presigned URL for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}`, AUDIT_NAME);
    const fetchStartTime = Date.now();

    /** @type {Response} */
    const res = await fetch(presignedURL);
    const sheet = await res.arrayBuffer();

    const fetchDuration = Date.now() - fetchStartTime;
    const sheetSize = sheet.byteLength;
    log.info(`%s REFRESH: Sheet fetched successfully for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName} (${sheetSize} bytes in ${fetchDuration}ms)`, AUDIT_NAME);

    log.info(`%s REFRESH: Uploading sheet to S3 for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}, bucket: ${s3Bucket}, key: ${refreshDir}/${sheetXlsxName}`, AUDIT_NAME);
    const s3UploadStartTime = Date.now();

    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `${refreshDir}/${sheetXlsxName}`,
      Body: new Uint8Array(sheet),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));

    const s3UploadDuration = Date.now() - s3UploadStartTime;
    log.info(`%s REFRESH: Sheet uploaded to S3 successfully for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName} (${sheetSize} bytes in ${s3UploadDuration}ms)`, AUDIT_NAME);
  } catch (e) {
    const message = `Failed to write sheet to S3: ${e.message}`;
    log.error(`%s REFRESH: ${message} for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}`, AUDIT_NAME, {
      auditId,
      siteId,
      sheetName,
      bucket: s3Bucket,
      directory: refreshDir,
      error: e.message,
      stack: e.stack,
    });

    await writeSheetRefreshResultFailed({
      message,
      outputDir: refreshDir,
      s3Client,
      s3Bucket,
      sheetName,
    });
    return internalServerError(message);
  }

  log.info(`%s REFRESH: Successfully wrote sheet ${sheetName} for auditId: ${auditId}, siteId: ${siteId} to S3`, AUDIT_NAME);

  // 3. Write the successful marker json to S3
  log.debug(`%s REFRESH: Writing success marker for auditId: ${auditId}, siteId: ${siteId}, sheet: ${sheetName}`, AUDIT_NAME);
  await writeSheetRefreshResultSuccess({
    sheetName,
    outputDir: refreshDir,
    s3Client,
    s3Bucket,
  });

  // 4. Check whether all sheets exist and upload when ready
  const { files } = refreshMeta.value;
  log.info(
    `%s REFRESH: Checking if all sheets are uploaded for auditId: ${auditId}, siteId: ${siteId}, expected sheets: ${files.length}`,
    AUDIT_NAME,
  );

  const resultFiles = await allSheetsUploaded(
    s3Client,
    s3Bucket,
    refreshDir,
    files,
    log,
    auditId,
    siteId,
  );
  if (!resultFiles) {
    log.info(`%s REFRESH: Not all sheets uploaded yet for auditId: ${auditId}, siteId: ${siteId}, expected: ${files.length}`, AUDIT_NAME);
    return ok();
  }

  log.info(`%s REFRESH: All ${files.length} sheets uploaded for auditId: ${auditId}, siteId: ${siteId}, proceeding to upload to SharePoint`, AUDIT_NAME);

  try {
    log.info(`%s REFRESH: Creating SharePoint client for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    const sharepointClient = await createLLMOSharepointClient(context);

    const sharepointStartTime = Date.now();
    for (let i = 0; i < resultFiles.length; i += 1) {
      const s = resultFiles[i];
      const { name } = files[i];
      log.info(`%s REFRESH: Processing sheet ${i + 1}/${files.length} for SharePoint upload, auditId: ${auditId}, siteId: ${siteId}, sheet: ${name}`, AUDIT_NAME);

      const resultFile = await s.Body.transformToString();
      const result = refreshSheetResultSchema.parse(JSON.parse(resultFile));
      if (result.status !== 'success') {
        const errorMsg = `Sheet ${name} did not complete successfully: ${result.message || 'unknown reason'}`;
        log.error(`%s REFRESH: ${errorMsg} for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
        throw new Error(errorMsg);
      }

      const xlsxKey = `${refreshDir}/${result.sheetName}.xlsx`;
      log.debug(`%s REFRESH: Fetching XLSX from S3 for auditId: ${auditId}, siteId: ${siteId}, key: ${xlsxKey}`, AUDIT_NAME);

      const xlsxObj = await s3Client.send(new GetObjectCommand({
        Bucket: s3Bucket,
        Key: xlsxKey,
      }));

      if (!xlsxObj.Body) {
        const errorMsg = `Missing XLSX file for sheet ${name}`;
        log.error(`%s REFRESH: ${errorMsg} for auditId: ${auditId}, siteId: ${siteId}, key: ${xlsxKey}`, AUDIT_NAME);
        throw new Error(errorMsg);
      }

      const xlsxBuffer = await xlsxObj.Body.transformToByteArray();
      const bufferSize = xlsxBuffer.byteLength;
      log.info(`%s REFRESH: Uploading sheet ${name} for auditId: ${auditId}, siteId: ${siteId} to ${outputLocations.length} SharePoint locations (${bufferSize} bytes)`, AUDIT_NAME);

      for (let locIndex = 0; locIndex < outputLocations.length; locIndex += 1) {
        const outDir = outputLocations[locIndex];
        log.debug(`%s REFRESH: Uploading sheet ${name} to location ${locIndex + 1}/${outputLocations.length}, auditId: ${auditId}, siteId: ${siteId}, location: ${outDir}`, AUDIT_NAME);
        await uploadAndPublishFile(xlsxBuffer.buffer, name, outDir, sharepointClient, log);
      }
    }

    const sharepointDuration = Date.now() - sharepointStartTime;
    log.info(`%s REFRESH: Successfully uploaded all ${files.length} sheets for auditId: ${auditId}, siteId: ${siteId} to SharePoint in ${sharepointDuration}ms`, AUDIT_NAME);
  } catch (e) {
    log.error(`%s REFRESH: Failed to upload to SharePoint for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME, {
      auditId,
      siteId,
      sheetCount: files.length,
      error: e.message,
      stack: e.stack,
    });
    return internalServerError(`Failed to upload to SharePoint: ${e.message}`);
  }

  log.info(`%s REFRESH: Refresh workflow completed successfully for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  return ok();
}

/**
 * @param {URL} sheetUrl
 * @returns {string}
 */
function extractXlsxName(sheetUrl) {
  const fromQuery = /;\s*content=(brandpresence-.*$)/.exec(
    sheetUrl.searchParams.get('response-content-disposition') ?? '',
  )?.[1];
  return fromQuery ?? sheetUrl.pathname.replace(/.*[/]/, '');
}

/**
 * @param {S3Client} s3Client
 * @param {string} s3Bucket
 * @param {string} outputDir
 * @param {RefreshMetadata['files']} files
 * @param {Console} log
 * @param {string} auditId
 * @param {string} siteId
 */
async function allSheetsUploaded(s3Client, s3Bucket, outputDir, files, log, auditId, siteId) {
  log.info(`%s REFRESH: Checking ${files.length} sheet result files for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);

  const checks = await Promise.allSettled(
    files.map((file, index) => {
      const fileName = file.name.replace(/\.xlsx$/, '');
      const key = `${outputDir}/${refreshSheetResultFileName(fileName)}`;
      log.debug(`%s REFRESH: Checking sheet ${index + 1}/${files.length} for auditId: ${auditId}, siteId: ${siteId}, key: ${key}`, AUDIT_NAME);
      return s3Client.send(
        new GetObjectCommand({
          Bucket: s3Bucket,
          Key: key,
        }),
      );
    }),
  );

  const fulfilledCount = checks.filter((c) => c.status === 'fulfilled').length;
  const rejectedCount = checks.filter((c) => c.status === 'rejected').length;

  log.info(`%s REFRESH: Sheet check results for auditId: ${auditId}, siteId: ${siteId} - fulfilled: ${fulfilledCount}/${files.length}, rejected: ${rejectedCount}/${files.length}`, AUDIT_NAME);

  checks.forEach((c, index) => {
    if (c.status === 'rejected') {
      log.debug(`%s REFRESH: Sheet ${index + 1}/${files.length} not ready for auditId: ${auditId}, siteId: ${siteId}, file: ${files[index].name}, reason: ${c.reason?.message || 'unknown'}`, AUDIT_NAME);
    } else {
      log.debug(`%s REFRESH: Sheet ${index + 1}/${files.length} ready for auditId: ${auditId}, siteId: ${siteId}, file: ${files[index].name}`, AUDIT_NAME);
    }
  });

  if (!checks.every((c) => c.status === 'fulfilled')) {
    log.info(`%s REFRESH: Not all sheets ready yet for auditId: ${auditId}, siteId: ${siteId} (${fulfilledCount}/${files.length} ready)`, AUDIT_NAME);
    return null;
  }

  log.info(`%s REFRESH: All ${files.length} sheet checks fulfilled for auditId: ${auditId}, siteId: ${siteId}, verifying bodies...`, AUDIT_NAME);

  const allHaveBodies = checks.every((c) => c.value.Body);
  if (!allHaveBodies) {
    log.warn(`%s REFRESH: Some sheets missing body content for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    return null;
  }

  log.info(`%s REFRESH: All ${files.length} sheets verified and ready for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
  return checks.map((c) => c.value);
}

/**
 * Handles batch processing for brand presence detection.
 * Receives a batch result from Mystique, stores it, and checks if all batches
 * for the provider are complete. If all batches are complete, combines them
 * and publishes to SharePoint.
 *
 * @param {Object} params - The parameters object.
 * @param {string} params.auditId - The audit identifier.
 * @param {string} params.siteId - The site identifier.
 * @param {Array<string>} params.outputLocations - The SharePoint output locations.
 * @param {URL} params.presignedURL - The presigned URL for the batch sheet.
 * @param {number} params.batchIndex - The batch index.
 * @param {string} params.webSearchProvider - The web search provider.
 * @param {string} params.configVersion - The config version.
 * @param {Object} context - The execution context.
 * @returns {Promise<Object>} - HTTP response object.
 */
async function handleBatchProcessing(
  {
    auditId,
    siteId,
    outputLocations,
    presignedURL,
    batchIndex,
    webSearchProvider,
  },
  context,
) {
  /** @type {{env: Record<string, string>, log: Console, s3Client: S3Client}} */
  const { env, log, s3Client } = context;
  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;
  const batchDir = batchDirectoryS3Key(auditId);

  log.info(
    `%s BATCH: Starting batch processing for auditId: ${auditId}, siteId: ${siteId}, batch: ${batchIndex}, provider: ${webSearchProvider}`,
    AUDIT_NAME,
  );

  // 1. Load batch metadata
  log.info(`%s BATCH: Loading batch metadata for auditId: ${auditId}`, AUDIT_NAME);
  const metadataStartTime = Date.now();

  const batchMeta = await loadJSONFromS3(
    s3Client,
    s3Bucket,
    batchMetadataFileS3Key(auditId),
    batchMetadataSchema,
  );

  const metadataDuration = Date.now() - metadataStartTime;
  log.info(`%s BATCH: Loaded batch metadata for auditId: ${auditId} in ${metadataDuration}ms`, AUDIT_NAME);

  if (batchMeta.status === 'rejected') {
    const { reason } = batchMeta;
    let msg;
    if (reason instanceof NoSuchKey) {
      msg = 'No batch metadata found';
    } else if (reason instanceof SyntaxError || reason instanceof ZodError) {
      msg = `Invalid batch metadata: ${reason.message}`;
    } else {
      throw reason;
    }

    log.error(`%s BATCH: ${msg} for auditId: ${auditId}, siteId: ${siteId}`, AUDIT_NAME);
    return notFound();
  }

  // Extract totalBatches from metadata
  const { totalBatches } = batchMeta.value;
  log.info(`%s BATCH: Batch metadata loaded: ${totalBatches} total batches for auditId: ${auditId}`, AUDIT_NAME);

  const sheetXlsxName = extractXlsxName(presignedURL);

  log.info(`%s BATCH: Processing batch sheet ${sheetXlsxName} for auditId: ${auditId}, S3 directory: ${batchDir}`, AUDIT_NAME);

  // 2. Write the sheet to S3
  try {
    log.info(`%s BATCH: Fetching sheet from presigned URL for auditId: ${auditId}, batch: ${batchIndex}`, AUDIT_NAME);
    const fetchStartTime = Date.now();

    /** @type {Response} */
    const res = await fetch(presignedURL);
    const sheet = await res.arrayBuffer();

    const fetchDuration = Date.now() - fetchStartTime;
    const sheetSize = sheet.byteLength;
    log.info(`%s BATCH: Sheet fetched successfully for auditId: ${auditId}, batch: ${batchIndex} (${sheetSize} bytes in ${fetchDuration}ms)`, AUDIT_NAME);

    log.info(`%s BATCH: Uploading sheet to S3 for auditId: ${auditId}, batch: ${batchIndex}, key: ${batchDir}/${sheetXlsxName}`, AUDIT_NAME);
    const s3UploadStartTime = Date.now();

    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `${batchDir}/${sheetXlsxName}`,
      Body: new Uint8Array(sheet),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));

    const s3UploadDuration = Date.now() - s3UploadStartTime;
    log.info(`%s BATCH: Sheet uploaded to S3 successfully for auditId: ${auditId}, batch: ${batchIndex} (${sheetSize} bytes in ${s3UploadDuration}ms)`, AUDIT_NAME);
  } catch (e) {
    const message = `Failed to write batch sheet to S3: ${e.message}`;
    log.error(`%s BATCH: ${message} for auditId: ${auditId}, batch: ${batchIndex}`, AUDIT_NAME, {
      auditId,
      siteId,
      batchIndex,
      bucket: s3Bucket,
      directory: batchDir,
      error: e.message,
      stack: e.stack,
    });

    await writeBatchResultFailed({
      message,
      outputDir: batchDir,
      s3Client,
      s3Bucket,
      webSearchProvider,
      batchIndex,
    });
    return internalServerError(message);
  }

  log.info(`%s BATCH: Successfully wrote batch sheet for auditId: ${auditId}, batch: ${batchIndex} to S3`, AUDIT_NAME);

  // 3. Write the successful marker json to S3
  log.debug(`%s BATCH: Writing success marker for auditId: ${auditId}, batch: ${batchIndex}, provider: ${webSearchProvider}`, AUDIT_NAME);
  await writeBatchResultSuccess({
    sheetXlsxName,
    outputDir: batchDir,
    s3Client,
    s3Bucket,
    webSearchProvider,
    batchIndex,
  });

  // 4. Check whether all batches for this provider are complete
  log.info(
    `%s BATCH: Checking if all batches for provider ${webSearchProvider} are complete for auditId: ${auditId}, expected: ${totalBatches}`,
    AUDIT_NAME,
  );

  const providerBatches = await allProviderBatchesComplete(
    s3Client,
    s3Bucket,
    batchDir,
    webSearchProvider,
    totalBatches,
    log,
    auditId,
    siteId,
  );

  if (!providerBatches) {
    log.info(`%s BATCH: Not all batches complete yet for provider ${webSearchProvider}, auditId: ${auditId}`, AUDIT_NAME);
    return ok();
  }

  log.info(`%s BATCH: All ${totalBatches} batches complete for provider ${webSearchProvider}, auditId: ${auditId}, proceeding to combine and upload`, AUDIT_NAME);

  // 5. Combine all batch sheets and upload to SharePoint
  try {
    log.info(`%s BATCH: Creating SharePoint client for auditId: ${auditId}, provider: ${webSearchProvider}`, AUDIT_NAME);
    const sharepointClient = await createLLMOSharepointClient(context);

    log.info(`%s BATCH: Fetching and combining ${totalBatches} batch sheets for provider ${webSearchProvider}`, AUDIT_NAME);
    const combinedSheets = [];

    for (let i = 0; i < totalBatches; i += 1) {
      const result = providerBatches[i];
      const resultFile = await result.Body.transformToString();
      const batchResult = batchResultSchema.parse(JSON.parse(resultFile));

      if (batchResult.status !== 'success') {
        const errorMsg = `Batch ${i} for provider ${webSearchProvider} did not complete successfully: ${batchResult.message || 'unknown reason'}`;
        log.error(`%s BATCH: ${errorMsg} for auditId: ${auditId}`, AUDIT_NAME);
        throw new Error(errorMsg);
      }

      const xlsxKey = `${batchDir}/${batchResult.sheetXlsxName}`;
      log.debug(`%s BATCH: Fetching batch sheet ${i + 1}/${totalBatches} from S3, key: ${xlsxKey}`, AUDIT_NAME);

      const xlsxObj = await s3Client.send(new GetObjectCommand({
        Bucket: s3Bucket,
        Key: xlsxKey,
      }));

      if (!xlsxObj.Body) {
        const errorMsg = `Missing XLSX file for batch ${i}, provider ${webSearchProvider}`;
        log.error(`%s BATCH: ${errorMsg} for auditId: ${auditId}`, AUDIT_NAME);
        throw new Error(errorMsg);
      }

      const xlsxBuffer = await xlsxObj.Body.transformToByteArray();
      combinedSheets.push(xlsxBuffer);
      log.debug(`%s BATCH: Fetched batch sheet ${i + 1}/${totalBatches} (${xlsxBuffer.byteLength} bytes)`, AUDIT_NAME);
    }

    // For now, upload each batch sheet separately to SharePoint
    // TODO: Consider combining sheets into a single file if needed
    log.info(`%s BATCH: Uploading ${combinedSheets.length} batch sheets to SharePoint for provider ${webSearchProvider}`, AUDIT_NAME);

    for (let i = 0; i < combinedSheets.length; i += 1) {
      const xlsxBuffer = combinedSheets[i];
      const bufferSize = xlsxBuffer.byteLength;
      const batchSheetName = `brandpresence-${webSearchProvider}-batch-${i}`;

      log.info(`%s BATCH: Uploading batch ${i + 1}/${combinedSheets.length} to ${outputLocations.length} SharePoint locations (${bufferSize} bytes)`, AUDIT_NAME);

      for (let locIndex = 0; locIndex < outputLocations.length; locIndex += 1) {
        const outDir = outputLocations[locIndex];
        const logMsg = `%s BATCH: Uploading batch ${i + 1} to location ${locIndex + 1}/${outputLocations.length}, path: ${outDir}`;
        log.debug(logMsg, AUDIT_NAME);
        await uploadAndPublishFile(
          xlsxBuffer.buffer,
          batchSheetName,
          outDir,
          sharepointClient,
          log,
        );
      }
    }

    log.info(`%s BATCH: Successfully uploaded all ${combinedSheets.length} batch sheets for provider ${webSearchProvider}, auditId: ${auditId}`, AUDIT_NAME);
  } catch (e) {
    log.error(`%s BATCH: Failed to combine and upload batches for provider ${webSearchProvider}, auditId: ${auditId}`, AUDIT_NAME, {
      auditId,
      siteId,
      webSearchProvider,
      error: e.message,
      stack: e.stack,
    });
    return internalServerError(`Failed to combine and upload batches: ${e.message}`);
  }

  log.info(`%s BATCH: Batch processing completed successfully for provider ${webSearchProvider}, auditId: ${auditId}`, AUDIT_NAME);
  return ok();
}

/**
 * Checks if all batches for a specific provider have been uploaded.
 *
 * @param {S3Client} s3Client
 * @param {string} s3Bucket
 * @param {string} outputDir
 * @param {string} webSearchProvider
 * @param {number} totalBatches
 * @param {Console} log
 * @param {string} auditId
 * @param {string} siteId
 * @returns {Promise<Array<any>|null>} Array of batch result objects if all complete, null otherwise
 */
async function allProviderBatchesComplete(
  s3Client,
  s3Bucket,
  outputDir,
  webSearchProvider,
  totalBatches,
  log,
  auditId,
) {
  log.info(`%s BATCH: Checking ${totalBatches} batch result files for provider ${webSearchProvider}, auditId: ${auditId}`, AUDIT_NAME);

  const checks = await Promise.allSettled(
    Array.from({ length: totalBatches }, (_, batchIndex) => {
      const key = `${outputDir}/${batchResultFileName(webSearchProvider, batchIndex)}`;
      log.debug(`%s BATCH: Checking batch ${batchIndex + 1}/${totalBatches} for provider ${webSearchProvider}, key: ${key}`, AUDIT_NAME);
      return s3Client.send(
        new GetObjectCommand({
          Bucket: s3Bucket,
          Key: key,
        }),
      );
    }),
  );

  const fulfilledCount = checks.filter((c) => c.status === 'fulfilled').length;
  const rejectedCount = checks.filter((c) => c.status === 'rejected').length;

  log.info(
    `%s BATCH: Batch check results for provider ${webSearchProvider}, auditId: ${auditId} - fulfilled: ${fulfilledCount}/${totalBatches}, rejected: ${rejectedCount}/${totalBatches}`,
    AUDIT_NAME,
  );

  checks.forEach((c, index) => {
    if (c.status === 'rejected') {
      log.debug(`%s BATCH: Batch ${index + 1}/${totalBatches} not ready for provider ${webSearchProvider}, reason: ${c.reason?.message || 'unknown'}`, AUDIT_NAME);
    } else {
      log.debug(`%s BATCH: Batch ${index + 1}/${totalBatches} ready for provider ${webSearchProvider}`, AUDIT_NAME);
    }
  });

  if (!checks.every((c) => c.status === 'fulfilled')) {
    log.info(`%s BATCH: Not all batches ready yet for provider ${webSearchProvider} (${fulfilledCount}/${totalBatches} ready)`, AUDIT_NAME);
    return null;
  }

  log.info(`%s BATCH: All ${totalBatches} batch checks fulfilled for provider ${webSearchProvider}, verifying bodies...`, AUDIT_NAME);

  const allHaveBodies = checks.every((c) => c.value.Body);
  if (!allHaveBodies) {
    log.warn(`%s BATCH: Some batches missing body content for provider ${webSearchProvider}`, AUDIT_NAME);
    return null;
  }

  log.info(`%s BATCH: All ${totalBatches} batches verified and ready for provider ${webSearchProvider}`, AUDIT_NAME);
  return checks.map((c) => c.value);
}
