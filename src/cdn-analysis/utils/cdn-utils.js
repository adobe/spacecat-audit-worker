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
import { ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import zlib from 'zlib';
import { hasText } from '@adobe/spacecat-shared-utils';

export const CDN_TYPES = {
  AKAMAI: 'akamai',
  FASTLY: 'fastly',
};

async function bufferFromStream(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function determineCdnProvider(s3, bucket, prefix) {
  const list = await s3.send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, MaxKeys: 1,
  }));
  const key = list.Contents?.[0]?.Key;
  if (!key) return CDN_TYPES.FASTLY;

  let text;
  if (key.endsWith('.gz')) {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    text = zlib.gunzipSync(await bufferFromStream(obj.Body)).toString();
  } else {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-65535' }),
    );
    text = (await bufferFromStream(obj.Body)).toString();
  }
  const first = text.split('\n').find((l) => l.trim());
  try {
    const rec = JSON.parse(first);
    if (hasText(rec.reqPath)) return CDN_TYPES.AKAMAI;
    if (hasText(rec.url)) return CDN_TYPES.FASTLY;
  } catch {
    // fall-through intended
  }
  throw new Error(`Unrecognized CDN Type. Bucket: ${bucket}`);
}

export function buildSiteFilters(filters) {
  if (!filters || filters.length === 0) return '';
  const clauses = filters.map(({ key, value }) => `(${key} = '${value}')`);
  return clauses.length > 1 ? clauses.join(' AND ') : clauses[0];
}
/* c8 ignore stop */
