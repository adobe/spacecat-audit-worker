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
const LINK_TIMEOUT = 3000;

/**
 * Checks if a URL is valid by attempting to fetch it. A URL is considered valid if:
 * - The fetch request succeeds (no network errors or timeouts)
 * - The response status code is < 400 (2xx or 3xx)
 * The check will timeout after LINK_TIMEOUT milliseconds.
 * Non-404 client errors (400-499) will log a warning.
 * All errors (network, timeout etc) will log an error and return false.
 * @param {string} url - The URL to validate
 * @returns {Promise<boolean>} True if the URL is valid and accessible,
 * false if invalid, times out, or errors
 */
export async function isLinkInvalid(url, log) {
  // Setup AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LINK_TIMEOUT);

  try {
    const response = await fetch(url, {
    //   method: 'HEAD',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const { status } = response;

    log.info(`link: ${url} ==> status: ${status}`);

    // Log non-404, non-200 status codes
    if (status >= 400 && status < 500 && status !== 404) {
      log.info(`Warning: ${url} returned client error: ${status}`);
    }

    // URL is valid if status code is less than 400
    return status >= 400;
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error.name === 'AbortError';

    log.info(`Error checking ${url}: ${isTimeout ? `Request timed out after ${LINK_TIMEOUT}ms` : error.message}`);

    // Any error means the URL is invalid
    return true;
  }
}
