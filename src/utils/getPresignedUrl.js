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

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Default expiry time for presigned URLs (7 days)
 */
export const DEFAULT_EXPIRY_SECONDS = 3600 * 24 * 7;

/**
 * Generates a presigned URL for an S3 object.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.s3Client - The S3 client instance
 * @param {string} options.bucket - The S3 bucket name
 * @param {string} options.key - The S3 object key/path
 * @param {number} [options.expiresIn=DEFAULT_EXPIRY_SECONDS] - Expiry time in seconds
 * @param {Object} [options.log] - Optional logger instance
 * @returns {Promise<string>} The presigned URL or empty string on error
 */
export async function getPresignedUrl({
  s3Client,
  bucket,
  key,
  expiresIn = DEFAULT_EXPIRY_SECONDS,
  log,
}) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    return await getSignedUrl(s3Client, command, { expiresIn });
  } catch (error) {
    if (log) {
      log.error(`Error generating presigned URL for ${key}:`, error);
    }
    return '';
  }
}

/**
 * Export the AWS SDK's getSignedUrl for cases where direct access is needed
 */
export { getSignedUrl };
