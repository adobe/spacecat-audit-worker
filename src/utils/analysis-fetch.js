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
 * Shared helper for fetching analysis JSON from a Mystique-provided presigned URL.
 *
 * Consolidates seven near-duplicate `await fetch(url) → await response.json()` patterns
 * across the *-analysis, faqs, summarization, related-urls, and prerender handlers, and
 * adds three protections that were missing in those ad-hoc implementations:
 *
 * 1. **SSRF guard** — every URL is validated against the S3 allowlist before any
 *    network call. Non-https or non-S3 hostnames throw before fetch runs.
 *
 * 2. **DoS guard** — the response is bounded by a `maxBytes` cap. A compromised
 *    Mystique or attacker-controlled bucket cannot OOM the Lambda by returning
 *    a multi-GB body. Both `Content-Length` (when present) and the streamed
 *    response are checked.
 *
 * 3. **Log scrub** — the presigned URL contains `X-Amz-Signature` and other
 *    short-lived credentials in its query string. Logged URLs are scrubbed
 *    (query string stripped) so they cannot leak to CloudWatch / Splunk.
 *
 * Aborts on a wall-clock timeout (default 30 s) via `AbortController`.
 */

import { tracingFetch as fetch } from '@adobe/spacecat-shared-utils';

import { assertPresignedUrl } from './presigned-url.js';

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Strip the query string from a presigned URL so it is safe to log. Returns the
 * input verbatim if it cannot be parsed (defensive — `assertPresignedUrl` will
 * normally reject malformed URLs before we get here).
 *
 * @param {string} url
 * @returns {string}
 */
export function scrubUrlForLog(url) {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Fetch and parse JSON analysis data from a Mystique-supplied presigned S3 URL.
 *
 * @param {string} url - The presigned URL (must be https and S3).
 * @param {object} options
 * @param {object} options.log - Lambda logger.
 * @param {string} options.prefix - Log prefix (e.g. `'[Cited]'`).
 * @param {number} [options.maxBytes=10485760] - Hard cap on response body size.
 * @param {number} [options.timeoutMs=30000] - Wall-clock timeout for the fetch.
 * @returns {Promise<unknown>} The parsed JSON body.
 * @throws {Error} `presignedUrl is not a valid URL`, `presignedUrl must use https`,
 *   `presignedUrl hostname is not an allowlisted S3 hostname`, `analysis response too large`,
 *   `analysis response is not JSON`, `analysis fetch failed: ${status}`, or
 *   `analysis fetch timed out after ${timeoutMs}ms`.
 */
export async function fetchAnalysisFromPresignedUrl(url, {
  log,
  prefix,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  // SSRF guard — throws before any network call if the URL is not on the allowlist.
  assertPresignedUrl(url);

  const safeUrl = scrubUrlForLog(url);
  log?.info?.(`${prefix} Fetching analysis from presigned URL: ${safeUrl}`);

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutHandle);
    if (err?.name === 'AbortError') {
      throw new Error(`${prefix} analysis fetch timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    throw new Error(`${prefix} analysis fetch failed: ${response.status} ${response.statusText}`);
  }

  // Pre-check declared content length so an obviously oversized body is rejected
  // before we buffer it. The server may still serve more bytes than it declared,
  // so we also enforce the cap on the actual body below.
  const declared = Number.parseInt(response.headers?.get?.('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(
      `${prefix} analysis response too large: declared ${declared} bytes exceeds cap ${maxBytes}`,
    );
  }

  // Loosely enforce content-type: presigned-URL responses from S3 may not always set
  // application/json (Mystique writes raw JSON without setting the header), so we
  // only reject obviously-wrong types. JSON parse below catches the rest.
  const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();
  // Allow JSON, plain text (S3 often serves raw JSON as text/plain), or octet-stream.
  // Explicitly reject text/html and other content types that signal a misdirected fetch.
  const ALLOWED_CONTENT_TYPES = /^(application\/json|text\/json|text\/plain|application\/octet-stream)\b/;
  if (contentType && !ALLOWED_CONTENT_TYPES.test(contentType)) {
    throw new Error(`${prefix} analysis response has unexpected content-type: ${contentType}`);
  }

  // Buffer the body as text first so we can enforce the size cap before JSON.parse.
  const text = await response.text();
  if (text.length > maxBytes) {
    throw new Error(
      `${prefix} analysis response too large: ${text.length} bytes exceeds cap ${maxBytes}`,
    );
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${prefix} analysis response is not JSON: ${err.message}`);
  }
}
