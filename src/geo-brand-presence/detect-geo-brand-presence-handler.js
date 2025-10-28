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

  log.info(`%s: Message received for auditId: ${auditId}, siteId: ${siteId}, subType: ${subType}`, AUDIT_NAME);
  log.debug('%s: Full message:', AUDIT_NAME, message);

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

  log.info(`%s: Output locations configured for auditId: ${auditId}, siteId: ${siteId}, locations: ${outputLocations.length}, configVersion: ${configVersion || 'absent'}`, AUDIT_NAME);
  log.debug(`%s: Output locations: ${JSON.stringify(outputLocations)}`, AUDIT_NAME);

  if (subType === 'refresh:geo-brand-presence' || subType === 'refresh:geo-brand-presence-daily') {
    log.info(`%s: Handling refresh for auditId: ${auditId}, siteId: ${siteId}, subType: ${subType}`, AUDIT_NAME);
    return handleRefresh({
      auditId, siteId, outputLocations, presignedURL,
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
    log.info(`%s: Uploading to location ${index + 1}/${outputLocations.length} for auditId: ${auditId}, siteId: ${siteId}, location: ${outputLocation}`, AUDIT_NAME);
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
    await Promise.all(
      resultFiles.flatMap(async (s, i) => {
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

        return outputLocations.map((outDir, locIndex) => {
          log.debug(`%s REFRESH: Uploading sheet ${name} to location ${locIndex + 1}/${outputLocations.length}, auditId: ${auditId}, siteId: ${siteId}, location: ${outDir}`, AUDIT_NAME);
          return uploadAndPublishFile(xlsxBuffer.buffer, name, outDir, sharepointClient, log);
        });
      }),
    );

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
