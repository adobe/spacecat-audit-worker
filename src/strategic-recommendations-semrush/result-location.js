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
 * SSRF guard for the DRS-supplied `resultLocation`.
 *
 * The result location is attacker-influenceable (it rides in an inbound SNS→SQS
 * message). Before we make any network call we MUST confirm it points at the
 * expected DRS results bucket/prefix. Without this guard a malformed or hostile
 * message could redirect the worker at an internal metadata endpoint (SSRF) or an
 * unrelated bucket (content injection).
 *
 * Two location forms are accepted:
 *  - an `https://` S3 presigned URL (virtual-hosted or path style), or
 *  - an `s3://<bucket>/<key>` URI.
 *
 * In both cases the bucket must equal `env.DRS_RESULTS_BUCKET` and the object key
 * must start with `env.DRS_RESULTS_PREFIX`. The prefix defaults to
 * `strategic_recommendations_semrush/` — the fixed `{PROVIDER_ID}/` key prefix the
 * DRS producer writes under (runner.py `_save_results`) — so the guard works
 * out of the box without deploy config; override only if the producer changes it.
 * The expected bucket is required — if it is not configured we fail closed.
 */

// Matches both virtual-hosted-style (bucket.s3[.region].amazonaws.com)
// and path-style (s3[.region].amazonaws.com) presigned URL hostnames.
const S3_HOSTNAME_RE = /^(?<bucket>[a-z0-9.-]+\.)?s3(\.[a-z0-9-]+)?\.amazonaws\.com$/;

function normalizePrefix(prefix) {
  const p = (prefix || 'strategic_recommendations_semrush/').replace(/^\/+/, '');
  return p.endsWith('/') ? p : `${p}/`;
}

/**
 * Parses the bucket + key out of a result location, regardless of form.
 *
 * @param {string} resultLocation
 * @returns {{ bucket: string, key: string }}
 * @throws {Error} if the location is unparseable or not an S3 location.
 */
function parseS3Location(resultLocation) {
  if (typeof resultLocation !== 'string' || resultLocation.length === 0) {
    throw new Error('resultLocation is missing');
  }

  if (resultLocation.startsWith('s3://')) {
    const without = resultLocation.slice('s3://'.length);
    const slash = without.indexOf('/');
    if (slash <= 0 || slash === without.length - 1) {
      throw new Error(`resultLocation is not a valid s3 URI: ${resultLocation}`);
    }
    return { bucket: without.slice(0, slash), key: without.slice(slash + 1) };
  }

  let parsed;
  try {
    parsed = new URL(resultLocation);
  } catch {
    throw new Error(`resultLocation is not a valid URL: ${resultLocation}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`resultLocation must use https or s3, got: ${parsed.protocol}`);
  }
  const match = S3_HOSTNAME_RE.exec(parsed.hostname);
  if (!match) {
    throw new Error(`resultLocation hostname is not an allowlisted S3 hostname: ${parsed.hostname}`);
  }

  const path = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  // Virtual-hosted style: bucket is the hostname label before `.s3`. The key is
  // the whole path. Path style: hostname is `s3...`, bucket is the first path
  // segment and the key is the remainder.
  const vhostBucket = match.groups.bucket ? match.groups.bucket.replace(/\.$/, '') : null;
  if (vhostBucket) {
    return { bucket: vhostBucket, key: path };
  }
  const slash = path.indexOf('/');
  if (slash <= 0 || slash === path.length - 1) {
    throw new Error(`resultLocation path does not contain a bucket and key: ${resultLocation}`);
  }
  return { bucket: path.slice(0, slash), key: path.slice(slash + 1) };
}

/**
 * Asserts the result location is under the configured DRS results bucket/prefix.
 *
 * @param {string} resultLocation
 * @param {object} env
 * @param {string} env.DRS_RESULTS_BUCKET - Required expected bucket name.
 * @param {string} [env.DRS_RESULTS_PREFIX='strategic_recommendations_semrush/'] - Key prefix.
 * @throws {Error} if the location is malformed or outside the bucket/prefix.
 */
export function assertResultLocation(resultLocation, env = {}) {
  const expectedBucket = env.DRS_RESULTS_BUCKET;
  if (!expectedBucket) {
    throw new Error('DRS_RESULTS_BUCKET is not configured; refusing to fetch result (fail closed)');
  }
  const expectedPrefix = normalizePrefix(env.DRS_RESULTS_PREFIX);

  const { bucket, key } = parseS3Location(resultLocation);

  if (bucket !== expectedBucket) {
    throw new Error(`resultLocation bucket ${bucket} is not the expected results bucket ${expectedBucket}`);
  }
  if (!key.startsWith(expectedPrefix)) {
    throw new Error(`resultLocation key ${key} is not under the expected prefix ${expectedPrefix}`);
  }
}

export default assertResultLocation;
