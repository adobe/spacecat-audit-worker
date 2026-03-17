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

import { SPACECAT_USER_AGENT } from '@adobe/spacecat-shared-utils';

/**
 * Detects CDN from HTTP response headers (lowercase keys).
 * Matches the same patterns as my-workspace-tools/detect-cdn.sh.
 *
 * @param {Record<string, string>} headers - Map of lowercase header name -> value.
 * @returns {string} CDN name or 'unknown'.
 */
export function detectCdnFromHeaders(headers) {
  if (!headers || typeof headers !== 'object') {
    return 'unknown';
  }

  const get = (name) => {
    const v = headers[name];
    return typeof v === 'string' ? v : '';
  };

  const has = (name) => get(name).length > 0;
  const match = (name, re) => re.test(get(name));
  const hasKey = (prefix) => Object.keys(headers).some((k) => k.toLowerCase().startsWith(prefix));

  if (has('cf-ray') || match('cf-cache-status', /./) || match('server', /cloudflare/i)) {
    return 'Cloudflare';
  }
  if (hasKey('x-akamai-') || has('akamai-origin-hop') || match('server', /akamaighost/i) || has('x-akamai-transformed')) {
    return 'Akamai';
  }
  if (has('x-served-by') || has('x-fastly-request-id') || has('fastly-ff') || match('via', /fastly/i)) {
    return 'Fastly';
  }
  if (has('x-amz-cf-id') || has('x-amz-cf-pop') || match('via', /cloudfront/i)) {
    return 'CloudFront';
  }
  if (has('x-azure-ref')) {
    return 'Azure Front Door / Azure CDN';
  }
  if (has('x-ec-debug')) {
    return 'Azure CDN';
  }
  if (has('x-fd-healthprobe')) {
    return 'Azure Front Door';
  }
  if (match('via', /google/i) || hasKey('x-goog-')) {
    return 'Google Cloud CDN';
  }
  if (has('x-iinfo') || match('x-cdn', /incapsula|imperva/i)) {
    return 'Imperva';
  }
  if (has('x-vercel-id') || match('server', /vercel/i)) {
    return 'Vercel';
  }
  if (has('x-nf-request-id') || match('server', /netlify/i)) {
    return 'Netlify';
  }
  if (has('x-edge-location') || match('server', /keycdn/i)) {
    return 'KeyCDN';
  }
  if (has('x-llid') || has('x-llrid')) {
    return 'Limelight';
  }
  if (has('x-cdn-request-id')) {
    return 'CDNetworks';
  }
  if (hasKey('x-bunny-')) {
    return 'Bunny CDN';
  }
  if (match('server', /netdna/i)) {
    return 'StackPath';
  }
  if (has('x-sucuri-id')) {
    return 'Sucuri';
  }

  return 'unknown';
}

/**
 * Builds a lowercase header map from a fetch Response and runs CDN detection.
 * For GET responses, cancels the body stream so the full response is not downloaded.
 *
 * @param {Response} response - Fetch Response (HEAD or GET).
 * @returns {{ cdn: string }}
 */
function headersFromResponse(response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  const cdn = detectCdnFromHeaders(headers);
  if (response.body && typeof response.body.cancel === 'function') {
    response.body.cancel();
  }
  return { cdn };
}

/**
 * Fetches URL (HEAD first, GET fallback) and detects CDN from response headers.
 * Some hosts (e.g. t-mobile.com) close the connection or send a truncated response for HEAD,
 * causing "unexpected end of file"; GET is retried in that case and only headers are used.
 *
 * @param {string} url - URL to request (will follow redirects).
 * @param {Function} fetchFn - Fetch implementation (e.g. context's fetch).
 * @param {object} [options] - Optional timeout, userAgent, log.
 * @returns {Promise<{ cdn: string, error?: string }>} Detected CDN or error.
 */
export async function detectCdnFromUrl(url, fetchFn, options = {}) {
  const { timeout = 10000, userAgent = SPACECAT_USER_AGENT, log } = options;

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  const fetchOptions = {
    redirect: 'follow',
    headers: { 'User-Agent': userAgent },
    signal: controller.signal,
  };

  try {
    const response = await fetchFn(url, { ...fetchOptions, method: 'HEAD' });
    clearTimeout(id);
    return headersFromResponse(response);
  } catch (headError) {
    clearTimeout(id);
    const headMessage = headError?.message || String(headError);
    log?.warn?.('[detect-cdn] HEAD request failed (%s), retrying with GET: %s', headMessage, url);

    const getController = new AbortController();
    const getTimeoutId = setTimeout(() => getController.abort(), timeout);
    try {
      const response = await fetchFn(url, { ...fetchOptions, method: 'GET', signal: getController.signal });
      clearTimeout(getTimeoutId);
      return headersFromResponse(response);
    } catch (getError) {
      clearTimeout(getTimeoutId);
      const message = getError?.message || String(getError);
      return { cdn: 'unknown', error: message };
    }
  }
}
