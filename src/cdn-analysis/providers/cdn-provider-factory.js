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

/* c8 ignore start */
// providers/cdn-provider-factory.js
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import zlib from 'zlib';
import * as akamai from './akamai-config.js';
import * as fastly from './fastly-config.js';

/**
 * Reads a Node.js Readable stream into a Buffer.
 * @param {import('stream').Readable} stream
 * @returns {Promise<Buffer>}
 */
async function bufferFromStream(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Samples a raw log file to detect the proper CDN provider.
 * If the file ends with .gz, fetches the full object to decompress.
 * Otherwise, fetches only a byte range for inspection.
 *
 * @param {S3Client} s3Client
 * @param {string} bucket
 * @param {string} prefix
 * @returns {Promise<typeof akamai|typeof fastly>}
 */
export async function determineCdnProvider(s3Client, bucket, prefix) {
  const listResult = await s3Client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1 }),
  );
  const key = listResult.Contents?.[0]?.Key;
  if (!key) {
    return fastly;
  }

  let content;
  if (key.endsWith('.gz')) {
    // fetch entire gzipped file for correct decompression
    const obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const buf = await bufferFromStream(obj.Body);
    content = zlib.gunzipSync(buf).toString('utf8');
  } else {
    // fetch just the first 64KB for inspection
    const obj = await s3Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-65535' }),
    );
    const buf = await bufferFromStream(obj.Body);
    content = buf.toString('utf8');
  }

  const firstLine = content.split('\n').find((line) => line.trim());
  try {
    const record = JSON.parse(firstLine);
    if (record.reqTimeSec !== undefined) {
      return akamai;
    }
  } catch {
    // not JSON or missing field — fall back
  }

  return fastly;
}

/* c8 ignore stop */
