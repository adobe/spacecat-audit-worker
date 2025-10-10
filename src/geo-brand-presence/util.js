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

import { PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * @import {S3Client} from '@aws-sdk/client-s3';
 */

/**
 * @param {string} auditId
 * @returns {string}
 */
export function refreshDirectoryS3Key(auditId) {
  return `temp/refresh-geo-brand-presence/${auditId}`;
}

/**
 * @param {string} auditId
 * @returns {string}
 */
export function refreshMetadataFileS3Key(auditId) {
  return `${refreshDirectoryS3Key(auditId)}/metadata.json`;
}

/**
 * @param {string} sheetName
 * @returns {string}
 */
export function refreshSheetResultFileName(sheetName) {
  return `${sheetName}.metadata.json`;
}

/**
 * @param {string} auditId
 * @param {string} sheetName
 * @returns {string}
 */
export function refreshSheetResultFileS3Key(auditId, sheetName) {
  return `${refreshDirectoryS3Key(auditId)}/${refreshSheetResultFileName(sheetName)}`;
}

/**
 * @param {object} params
 * @param {params.message} [string]
 * @param {S3Client} params.s3Client
 * @param {string} params.s3Bucket
 * @param {string} params.outputDir
 * @param {string} params.sheetName
 */
export function writeSheetRefreshResultFailed({ message, ...opts }) {
  return writeSheetRefreshResult('failure', message, opts);
}

/**
 * @param {object} params
 * @param {params.message} [string]
 * @param {S3Client} params.s3Client
 * @param {string} params.s3Bucket
 * @param {string} params.outputDir
 * @param {string} params.sheetName
 */
export function writeSheetRefreshResultSkipped({ message, ...opts }) {
  return writeSheetRefreshResult('skipped', message, opts);
}

/**
 * @param {object} params
 * @param {params.message} [string]
 * @param {S3Client} params.s3Client
 * @param {string} params.s3Bucket
 * @param {string} params.outputDir
 * @param {string} params.sheetName
 */
export function writeSheetRefreshResultSuccess({ message, ...opts }) {
  return writeSheetRefreshResult('success', message, opts);
}

/**
 * @param {"failure" | "skipped" | "success"} status
 * @param {undefined | string} message
 * @param {object} params
 * @param {S3Client} params.s3Client
 * @param {string} params.s3Bucket
 * @param {string} params.outputDir
 * @param {string} params.sheetName
 */
async function writeSheetRefreshResult(status, message, {
  s3Client,
  s3Bucket,
  outputDir,
  sheetName,
}) {
  return s3Client.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: `${outputDir}/${refreshSheetResultFileName(sheetName)}`,
    Body: JSON.stringify({
      sheetName,
      message,
      status,
      time: (new Date()).toISOString(),
    }, null, 2),
    ContentType: 'application/json',
  }));
}
