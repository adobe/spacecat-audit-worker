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

export async function getObjectKeysUsingPrefix(
  s3Client,
  bucketName,
  prefix,
  log,
  maxKeys = 1000,
) {
  const objectKeys = [];
  let continuationToken = null;
  if (!s3Client || !bucketName || !prefix) {
    log.error(
      `Invalid input parameters: ensure s3Client, bucketName:${bucketName}, and prefix:${prefix} are provided.`,
    );
    throw new Error(
      'Invalid input parameters: ensure s3Client, bucketName, and prefix are provided.',
    );
  }
  try {
    const params = {
      Bucket: bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    };
    do {
      if (continuationToken) {
        params.ContinuationToken = continuationToken;
      }
      // eslint-disable-next-line no-await-in-loop
      const data = await s3Client.send(new ListObjectsV2Command(params));
      data?.Contents?.forEach((obj) => {
        if (obj.Key?.endsWith('scrape.json')) {
          objectKeys.push(obj.Key);
        }
      });
      continuationToken = data?.NextContinuationToken;
    } while (continuationToken);
    log.info(
      `Fetched ${objectKeys.length} keys from S3 for bucket ${bucketName} and prefix ${prefix}`,
    );
  } catch (err) {
    log.error(
      `Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix}`,
      err,
    );
    throw err;
  }
  return objectKeys;
}

/**
 * Retrieves an object from S3 by its key and returns its JSON parsed content.
 * If the object is not JSON, returns the raw body.
 * If the object is not found, returns null.
 * @param {import('@aws-sdk/client-s3').S3Client} s3Client - an S3 client
 * @param {string} bucketName - the name of the S3 bucket
 * @param {string} key - the key of the S3 object
 * @param {import('@azure/logger').Logger} log - a logger instance
 * @returns {Promise<import('@aws-sdk/client-s3').GetObjectOutput['Body'] | null>}
 * - the content of the S3 object
 */
export async function getObjectFromKey(s3Client, bucketName, key, log) {
  if (!s3Client || !bucketName || !key) {
    log.error(
      'Invalid input parameters: ensure s3Client, bucketName, and key are provided.',
    );
    return null;
  }
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  try {
    const response = await s3Client.send(command);
    const contentType = response.ContentType;
    const body = await response.Body.transformToString();

    if (contentType && contentType.includes('application/json')) {
      try {
        return JSON.parse(body);
      } catch (parseError) {
        log.error(`Unable to parse content for key ${key}`, parseError);
        return null;
      }
    }

    // Always return body for non-JSON content types
    return body;
  } catch (err) {
    log.error(
      `Error while fetching S3 object from bucket ${bucketName} using key ${key}`,
      err,
    );
    return null;
  }
}
