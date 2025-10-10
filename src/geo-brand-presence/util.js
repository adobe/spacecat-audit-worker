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

import { z } from 'zod';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

/**
 * @import {S3Client} from '@aws-sdk/client-s3';
 */

/** @typedef {z.infer<typeof refreshMetadataSchema>} RefreshMetadata */
/** @typedef {z.infer<typeof refreshSheetResultSchema>} RefreshSheetResult */

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
 * @param {string} [params.message]
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
 * @param {string} [params.message]
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
 * @param {string} [params.message]
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

/**
 * @template {z.ZodTypeAny} T
 * @param {S3Client} s3Client
 * @param {string} s3Bucket
 * @param {string} s3Key
 * @param {T} [schema]
 * @returns {Promise<PromiseSettledResult<z.infer<T>>>}
 */
export async function loadJSONFromS3(s3Client, s3Bucket, s3Key, schema) {
  try {
    const result = await s3Client.send(
      new GetObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
      }),
    );

    const text = await result.Body?.transformToString() ?? '';
    const value = JSON.parse(text);
    return { status: 'fulfilled', value: schema ? schema.parse(value) : value };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

export const refreshMetadataSchema = z.object({
  auditId: z.uuid(),
  createdAt: z.iso.datetime(),
  files: z.array(
    z.object({
      name: z.string().endsWith('.xlsx'),
      resultFile: z.string().endsWith('.metadata.json'),
    }),
  ),
});

export const refreshSheetResultSchema = z.object({
  message: z.string().optional(),
  sheetName: z.string().min(1),
  status: z.enum(['failure', 'skipped', 'success']),
  time: z.iso.datetime(),
});
