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
 * Validates that a presigned URL is a legitimate S3 URL before fetching.
 *
 * Presigned URLs arrive in inbound SQS messages from Mystique and must be
 * validated before use. Without this guard, a compromised or malformed message
 * could redirect the worker to an internal metadata endpoint (SSRF) or cause
 * content injection.
 *
 * Allowlist: hostnames matching `*.s3[.<region>].amazonaws.com`.
 *
 * @param {string} url - The presigned URL to validate.
 * @throws {Error} If the URL is not a valid https S3 URL.
 */

// Matches both virtual-hosted-style (bucket.s3[.region].amazonaws.com)
// and path-style (s3[.region].amazonaws.com) presigned URL hostnames.
const S3_HOSTNAME_RE = /^([a-z0-9.-]+\.)?s3(\.[a-z0-9-]+)?\.amazonaws\.com$/;

export function assertPresignedUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`presignedUrl is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`presignedUrl must use https, got: ${parsed.protocol}`);
  }
  if (!S3_HOSTNAME_RE.test(parsed.hostname)) {
    throw new Error(`presignedUrl hostname is not an allowlisted S3 hostname: ${parsed.hostname}`);
  }
}
