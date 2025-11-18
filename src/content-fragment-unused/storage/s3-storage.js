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

export function buildStoragePath(env, imsOrgId, date = new Date()) {
  const bucketName = generateStandardBucketName(env);
  const year = date.getUTCFullYear().toString();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const fileName = `${date.toISOString()}-unused-fragments.json`;

  return `s3://${bucketName}/${imsOrgId}/unused-fragments/${year}/${month}/${day}/${fileName}`;
}

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
