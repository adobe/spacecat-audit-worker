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

import { PutObjectCommand } from '@aws-sdk/client-s3';
import { generateStandardBucketName } from '../../utils/cdn-utils.js';
import { getObjectFromKey } from '../../utils/s3-utils.js';

/**
 * Builds an S3 storage path for unused content fragment data.
 *
 * The path follows the pattern:
 * `s3://{bucket}/{imsOrgId}/unused-fragments/{year}/{month}/{day}/{timestamp}-unused-fragments.json`
 *
 * @param {string} env - The AWS environment identifier (e.g., 'dev', 'prod').
 * @param {string} imsOrgId - The IMS organization ID for path namespacing.
 * @param {Date} [date=new Date()] - The date used for path generation and filename.
 * @returns {string} The full S3 URI path for storing fragment data.
 */
export function buildStoragePath(env, imsOrgId, date = new Date()) {
  const bucketName = generateStandardBucketName(env);
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const fileName = `${date.toISOString()}-unused-fragments.json`;

  return `s3://${bucketName}/${imsOrgId}/unused-fragments/${year}/${month}/${day}/${fileName}`;
}

/**
 * Parses an S3 URI into bucket name and key components.
 *
 * @param {string} s3Path - The S3 URI (e.g., 's3://bucket-name/path/to/object').
 * @returns {ParsedS3Path} The parsed bucket name and key.
 * @throws {Error} If the S3 path format is invalid.
 * @private
 */
function parseStoragePath(s3Path) {
  const pathWithoutProtocol = s3Path.replace('s3://', '');
  const firstSlashIndex = pathWithoutProtocol.indexOf('/');

  if (firstSlashIndex === -1) {
    throw new Error(`[Content Fragment Unused] Invalid S3 path: ${s3Path}`);
  }

  const bucketName = pathWithoutProtocol.substring(0, firstSlashIndex);
  const key = pathWithoutProtocol.substring(firstSlashIndex + 1);

  return { bucketName, key };
}

/**
 * Uploads unused content fragment data to S3.
 *
 * The fragments are serialized as formatted JSON and stored at the specified path.
 *
 * @param {Object[]} fragments - Array of unused fragment objects to upload.
 * @param {string} s3Path - The S3 URI where fragments should be stored.
 * @param {Object} s3Client - AWS S3 client instance.
 * @param {Object} log - Logger instance for operation logging.
 * @returns {Promise<void>} Resolves when upload is complete.
 * @throws {Error} If fragments are null/undefined.
 * @throws {Error} If S3 path is invalid or doesn't start with 's3://'.
 * @throws {Error} If S3 client is not provided.
 * @throws {Error} If the S3 upload operation fails.
 */
export async function uploadFragmentsToS3(fragments, s3Path, s3Client, log) {
  if (!fragments) {
    throw new Error('[Content Fragment Unused] No fragments to upload');
  }

  if (!s3Path || !s3Path.startsWith('s3://')) {
    throw new Error(`[Content Fragment Unused] Invalid S3 path: ${s3Path}`);
  }

  if (!s3Client) {
    throw new Error('[Content Fragment Unused] S3 client is required');
  }

  const { bucketName, key } = parseStoragePath(s3Path);

  log.info(`[Content Fragment Unused] Uploading ${fragments.length} fragments to ${s3Path}`);

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: JSON.stringify(fragments, null, 2),
      ContentType: 'application/json',
    }));

    log.info(`[Content Fragment Unused] Successfully uploaded fragments data to S3: ${s3Path}`);
  } catch (error) {
    log.error(`[Content Fragment Unused] Failed to upload fragments to S3: ${error.message}`);
    throw new Error(`[Content Fragment Unused] Failed to upload fragments to S3: ${error.message}`);
  }
}

/**
 * Downloads unused content fragment data from S3.
 *
 * Retrieves and parses the JSON data stored at the specified S3 path.
 *
 * @param {string} s3Path - The S3 URI where fragments are stored.
 * @param {Object} s3Client - AWS S3 client instance.
 * @param {Object} log - Logger instance for operation logging.
 * @returns {Promise<Object[]>} Array of unused fragment objects.
 * @throws {Error} If S3 path is invalid or doesn't start with 's3://'.
 * @throws {Error} If S3 client is not provided.
 * @throws {Error} If no data is found at the specified path.
 * @throws {Error} If the S3 download operation fails.
 */
export async function downloadFragmentsFromS3(s3Path, s3Client, log) {
  if (!s3Path || !s3Path.startsWith('s3://')) {
    throw new Error(`[Content Fragment Unused] Invalid S3 path: ${s3Path}`);
  }

  if (!s3Client) {
    throw new Error('[Content Fragment Unused] S3 client is required');
  }

  const { bucketName, key } = parseStoragePath(s3Path);

  log.info(`[Content Fragment Unused] Downloading fragments data from S3: ${s3Path}`);
  try {
    const data = await getObjectFromKey(s3Client, bucketName, key, log);
    if (!data) {
      throw new Error(`[Content Fragment Unused] No unused fragments found at ${s3Path}`);
    }

    log.info(`[Content Fragment Unused] Successfully downloaded ${data.length} fragments from S3`);

    return data;
  } catch (error) {
    log.error(`[Content Fragment Unused] Failed to download fragments from S3: ${error.message}`);
    throw new Error(`[Content Fragment Unused] Failed to download fragments from S3: ${error.message}`);
  }
}
