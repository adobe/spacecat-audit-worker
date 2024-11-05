/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export async function getObjectKeysUsingPrefix(s3Client, bucketName, prefix, log) {
  const objectKeys = [];
  let continuationToken = null;
  if (!s3Client || !bucketName || !prefix) {
    log.error('Invalid input parameters: ensure s3Client, bucketName, and prefix are provided.');
    throw new Error('Invalid input parameters: ensure s3Client, bucketName, and prefix are provided.');
  }
  try {
    const params = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: 1000,
    };
    do {
      if (continuationToken) {
        params.ContinuationToken = continuationToken;
      }
      // eslint-disable-next-line no-await-in-loop
      const data = await s3Client.send(new ListObjectsV2Command(params));
      data?.Contents?.forEach((obj) => {
        objectKeys.push(obj.Key);
      });
      continuationToken = data?.NextContinuationToken;
    } while (continuationToken);
    log.info(`Fetched ${objectKeys.length} keys from S3 for bucket ${bucketName} and prefix ${prefix}`);
  } catch (err) {
    log.error(`Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix}`, err);
    throw err;
  }
  return objectKeys;
}

export async function getObjectFromKey(s3Client, bucketName, key, log) {
  if (!s3Client || !bucketName || !key) {
    log.error('Invalid input parameters: ensure s3Client, bucketName, and key are provided.');
    return null;
  }
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  try {
    const response = await s3Client.send(command);
    const body = await response.Body.transformToString();
    return JSON.parse(body);
  } catch (err) {
    log.error(`Error while fetching S3 object from bucket ${bucketName} using key ${key}`, err);
    return null;
  }
}
