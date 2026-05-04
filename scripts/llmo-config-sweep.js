/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * One-off operational sweep over all LLMO configs in S3, classifying each
 * against the published Zod schema. READ-ONLY — never writes to S3.
 *
 * Step 3a of SITES-43238. Sizes the population of corrupted configs to
 * inform the targeted repair that follows.
 *
 * Usage:
 *   klam login                                      # AWS creds
 *   node scripts/llmo-config-sweep.js \
 *     --bucket <bucket-name> \
 *     [--region us-east-1] \
 *     [--out report.json] \
 *     [--limit 50] \
 *     [--concurrency 20]
 *
 *   # or via env:
 *   S3_BUCKET_NAME=<bucket-name> node scripts/llmo-config-sweep.js
 *
 * Output:
 *   - stdout: progress, summary, top issue codes by frequency
 *   - --out <file>: machine-readable JSON ({ summary, failures: [{ siteId, status, issues|error }] })
 *
 * Exit codes:
 *   0  sweep completed (regardless of how many failures were found — that is the result, not an error)
 *   2  fatal error in the script itself (bad args, list failure, etc.)
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { schemas } from '@adobe/spacecat-shared-utils';
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';

const PREFIX = 'config/llmo/';
// config/llmo/<siteId>/lmmo-config.json
const KEY_RE = /^config\/llmo\/([^/]+)\/lmmo-config\.json$/;

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      bucket: { type: 'string' },
      region: { type: 'string', default: 'us-east-1' },
      out: { type: 'string' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: '20' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(
      'Usage: node scripts/llmo-config-sweep.js [--bucket <name>] [--region <region>]\n'
      + '                                          [--out <file>] [--limit <n>] [--concurrency <n>]',
    );
    process.exit(0);
  }
  const bucket = values.bucket || process.env.S3_BUCKET_NAME;
  if (!bucket) {
    console.error('error: --bucket or S3_BUCKET_NAME env var is required');
    process.exit(2);
  }
  return {
    bucket,
    region: values.region,
    outPath: values.out,
    limit: values.limit ? Number(values.limit) : Infinity,
    concurrency: Math.max(1, Number(values.concurrency)),
  };
}

async function* listLlmoConfigKeys(s3, bucket) {
  let token;
  do {
    // eslint-disable-next-line no-await-in-loop
    const resp = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: PREFIX,
      ContinuationToken: token,
    }));
    for (const obj of resp.Contents || []) {
      if (KEY_RE.test(obj.Key)) {
        yield obj.Key;
      }
    }
    token = resp.NextContinuationToken;
  } while (token);
}

async function classifyKey(s3, bucket, key) {
  const m = KEY_RE.exec(key);
  const siteId = m[1];

  let resp;
  try {
    resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (e) {
    return { siteId, status: 'fetch-error', error: e.message };
  }

  let text;
  try {
    text = await resp.Body.transformToString();
  } catch (e) {
    return { siteId, status: 'fetch-error', error: e.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { siteId, status: 'json-error', error: e.message };
  }

  const result = schemas.llmoConfig.safeParse(parsed);
  if (!result.success) {
    return { siteId, status: 'schema-invalid', issues: result.error.issues };
  }
  return { siteId, status: 'valid' };
}

async function runWorkers(queue, concurrency, onResult, onProgress) {
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      // eslint-disable-next-line no-await-in-loop
      const r = await item();
      onResult(r);
      onProgress();
    }
  });
  await Promise.all(workers);
}

function summarize(results, bucket, elapsedMs) {
  return {
    bucket,
    total: results.length,
    valid: results.filter((r) => r.status === 'valid').length,
    schemaInvalid: results.filter((r) => r.status === 'schema-invalid').length,
    jsonError: results.filter((r) => r.status === 'json-error').length,
    fetchError: results.filter((r) => r.status === 'fetch-error').length,
    elapsedSeconds: (elapsedMs / 1000).toFixed(1),
  };
}

function topIssueCodes(results, max = 20) {
  const counts = new Map();
  for (const r of results) {
    if (r.status === 'schema-invalid') {
      for (const i of r.issues) {
        const key = `${i.path.join('.') || '<root>'}: ${i.code}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { top: sorted.slice(0, max), totalDistinct: counts.size };
}

async function main() {
  const {
    bucket, region, outPath, limit, concurrency,
  } = parseCliArgs();

  console.log(`[sweep] bucket=${bucket} region=${region} concurrency=${concurrency} `
    + `limit=${limit === Infinity ? 'none' : limit}`);
  console.log(`[sweep] listing keys with prefix ${PREFIX}...`);

  const s3 = new S3Client({ region });

  const keys = [];
  try {
    for await (const key of listLlmoConfigKeys(s3, bucket)) {
      keys.push(key);
      if (keys.length >= limit) break;
    }
  } catch (e) {
    console.error(`[sweep] fatal: failed to list keys: ${e.message}`);
    process.exit(2);
  }
  console.log(`[sweep] found ${keys.length} llmo config keys`);

  const results = [];
  const start = Date.now();
  let completed = 0;
  const queue = keys.map((k) => () => classifyKey(s3, bucket, k));

  await runWorkers(
    queue,
    concurrency,
    (r) => results.push(r),
    () => {
      completed += 1;
      if (completed % 100 === 0 || completed === keys.length) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[sweep] ${completed}/${keys.length} processed (${elapsed}s elapsed)`);
      }
    },
  );

  const summary = summarize(results, bucket, Date.now() - start);
  console.log('\n=== Summary ===');
  console.log(JSON.stringify(summary, null, 2));

  const { top, totalDistinct } = topIssueCodes(results);
  if (top.length > 0) {
    console.log('\n=== Schema issues (path: code => count) ===');
    for (const [key, count] of top) {
      console.log(`  ${String(count).padStart(6)}  ${key}`);
    }
    if (totalDistinct > top.length) {
      console.log(`  (and ${totalDistinct - top.length} more distinct issue patterns)`);
    }
  }

  if (outPath) {
    const failures = results.filter((r) => r.status !== 'valid');
    await writeFile(outPath, JSON.stringify({ summary, failures }, null, 2));
    console.log(`\n[sweep] wrote ${failures.length} failure entries to ${outPath}`);
  }
}

main().catch((e) => {
  console.error('[sweep] fatal error:', e);
  process.exit(2);
});
