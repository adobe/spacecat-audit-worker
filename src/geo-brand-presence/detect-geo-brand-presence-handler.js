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
  writeSheetRefreshResultFailed,
  writeSheetRefreshResultSuccess,
} from './util.js';

/**
 * @import { S3Client } from '@aws-sdk/client-s3'
 * @import { type RefreshMetadata } from './util.js'
 */

export default async function handler(message, context) {
  const { log, dataAccess } = context;
  const { Audit, Site } = dataAccess;
  const {
    auditId, siteId, type: subType, data,
  } = message;

  log.info('GEO BRAND PRESENCE: Message received:', message);

  if (!subType || ![...OPPTY_TYPES, 'refresh:geo-brand-presence'].includes(subType)) {
    log.error(`GEO BRAND PRESENCE: Unsupported subtype: ${subType}`);
    return notFound();
  }

  const site = await Site.findById(siteId);
  if (!site) {
    log.error(`GEO BRAND PRESENCE: Site not found for auditId ${auditId}, siteId: ${siteId}`);
    return notFound();
  }

  const presignedURL = URL.parse(data.presigned_url);
  if (!presignedURL || !presignedURL.href) {
    log.error(`GEO BRAND PRESENCE: Invalid presigned URL: ${data.presigned_url}`);
    return badRequest('Invalid presigned URL');
  }

  // TODO: does data.config_version exist?
  const configVersion = data.config_version;
  const mainOutputLocation = context.getOutputLocation
    ? context.getOutputLocation(site)
    : `${site.getConfig().getLlmoDataFolder()}/brand-presence`;
  const outputLocations = [mainOutputLocation, `${mainOutputLocation}/config_${configVersion || 'absent'}`];

  if (subType === 'refresh:geo-brand-presence') {
    return handleRefresh({ auditId, outputLocations, presignedURL }, context);
  }

  const audit = await Audit.findById(auditId);
  if (!audit) {
    log.error(`GEO BRAND PRESENCE: Audit not found for auditId: ${auditId}`);
    return notFound();
  }

  /** @type {Response} */
  const res = await fetch(presignedURL);
  const sheet = await res.arrayBuffer();

  // upload to sharepoint & publish via hlx admin api
  const sharepointClient = await createLLMOSharepointClient(context);
  const xlsxName = extractXlsxName(presignedURL);
  await Promise.all(outputLocations.map(async (outputLocation) => {
    await uploadAndPublishFile(sheet, xlsxName, outputLocation, sharepointClient, log);
  }));

  return ok();
}

async function handleRefresh(
  {
    auditId,
    outputLocations,
    presignedURL,
  },
  context,
) {
  /** @type {{env: Record<string, string>, log: Console, s3Client: S3Client}} */
  const { env, log, s3Client } = context;
  const s3Bucket = env.S3_IMPORTER_BUCKET_NAME;

  // 1. Load refresh metadata
  const refreshMeta = await loadJSONFromS3(
    s3Client,
    s3Bucket,
    refreshMetadataFileS3Key(auditId),
    refreshMetadataSchema,
  );
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

    log.error(`GEO BRAND PRESENCE: ${msg} for auditId: ${auditId}`);
    return notFound();
  }

  const refreshDir = refreshDirectoryS3Key(auditId);
  const sheetXlsxName = extractXlsxName(presignedURL);
  const sheetName = sheetXlsxName.replace(/\.xlsx$/, '');

  // 2. Write the sheet to S3
  try {
    /** @type {Response} */
    const res = await fetch(presignedURL);
    const sheet = await res.arrayBuffer();

    await s3Client.send(new PutObjectCommand({
      Bucket: s3Bucket,
      Key: `${refreshDir}/${sheetXlsxName}`,
      Body: new Uint8Array(sheet),
      ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }));
  } catch (e) {
    const message = `Failed to write sheet to S3: ${e.message}`;
    log.error(`GEO BRAND PRESENCE: ${message} for auditId: ${auditId}`);
    await writeSheetRefreshResultFailed({
      message,
      outputDir: refreshDir,
      s3Client,
      s3Bucket,
      sheetName,
    });
    return internalServerError(message);
  }

  // 3. Write the successful marker json to S3
  await writeSheetRefreshResultSuccess({
    sheetName,
    outputDir: refreshDir,
    s3Client,
    s3Bucket,
  });

  // 4. Check whether all sheets exist and upload when ready
  const { files } = refreshMeta.value;
  const sheets = await allSheetsUploaded(s3Client, s3Bucket, refreshDir, files);
  if (!sheets) {
    return ok();
  }

  try {
    const sharepointClient = await createLLMOSharepointClient(context);
    await Promise.all(
      sheets.flatMap(async (s, i) => {
        throw new Error("HAVE TO UPLOAD THE XLSX, BUT IT'S THE METADATA FILE");
        const { name } = files[i];
        const sheet = await s.Body.transformToByteArray();
        return outputLocations.map(
          (outDir) => uploadAndPublishFile(sheet.buffer, name, outDir, sharepointClient, log),
        );
      }),
    );
  } catch (e) {
    return internalServerError(`Failed to upload to SharePoint: ${e.message}`);
  }

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
 */
async function allSheetsUploaded(s3Client, s3Bucket, outputDir, files) {
  const checks = await Promise.allSettled(
    files.map((f) => s3Client.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: `${outputDir}/${refreshSheetResultFileName(f.name)}`,
      }),
    )),
  );

  if (!checks.every((c) => c.status === 'fulfilled')) {
    return null;
  }
  return checks.every((c) => c.value.Body)
    ? checks.map((c) => c.value)
    : null;
}
