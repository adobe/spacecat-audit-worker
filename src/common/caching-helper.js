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

import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { gzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);

export async function fileExists(s3, cacheKey, log) {
  const bucketName = cacheKey.replace('s3://', '').split('/')[0];
  const key = cacheKey.replace(`s3://${bucketName}/`, '');
  try {
    const command = new HeadObjectCommand({ Bucket: bucketName, Key: key });
    await s3.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound') {
      return false;
    }
    log.warn(`Unexpected result when checking cache file existence: ${cacheKey}`, error);
    return false;
  }
}

export async function addResultJsonToCache(s3, cacheKey, data, log) {
  const bucketName = cacheKey.replace('s3://', '').split('/')[0];
  const key = cacheKey.replace(`s3://${bucketName}/`, '');
  const compressedBody = await gzipAsync(JSON.stringify(data));
  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: compressedBody,
      ContentType: 'application/json',
      ContentEncoding: 'gzip',
    });

    await s3.send(command);
    log.debug(`Successfully cached result to: ${cacheKey}`);
  } catch (error) {
    log.error(`Failed to cache result to: ${cacheKey}.  Ignoring error and proceeding with next steps`, error);
  }
}
