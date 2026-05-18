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
 * Classifies TierClient errors as transient (should retry) or permanent (site not entitled).
 *
 * Transient errors indicate temporary infrastructure issues that may resolve on retry:
 * - Database connection pool timeouts (PGRST003)
 * - Network errors (ECONNREFUSED, ETIMEDOUT, ENOTFOUND, ECONNRESET)
 * - HTTP server errors (408, 429, 500, 502, 503, 504)
 *
 * Permanent errors indicate the site is legitimately not entitled:
 * - HTTP client errors (401, 403, 404)
 * - Business logic errors (no entitlement, not enrolled, invalid product code)
 *
 * Walks the error.cause chain since DataAccessError wraps PostgREST errors in .cause property.
 *
 * @param {Error} error - Error from TierClient.checkValidEntitlement()
 * @returns {boolean} - True if transient/retryable, false if permanent
 */
export function isTransientTierClientError(error) {
  if (!error) {
    return false;
  }

  // Walk the error.cause chain to find transient indicators.
  // Real DataAccessError from data-access layer wraps PostgREST errors:
  // { name: 'DataAccessError', message: 'Failed to query',
  //   cause: { code: 'PGRST003', message: '...' } }
  let current = error;
  while (current) {
    const message = current?.message?.toLowerCase() || '';
    const code = current?.code?.toUpperCase() || '';
    const statusCode = current?.statusCode || current?.status;

    // Database errors - PostgREST connection and timeout issues
    // PGRST000: Could not connect with database (503)
    // PGRST001: Could not connect due to internal error (503)
    // PGRST002: Could not connect when building schema cache (503)
    // PGRST003: Timed out acquiring connection from pool (504)
    const transientPostgrestCodes = ['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'];
    if (transientPostgrestCodes.includes(code)) {
      return true;
    }

    // Database timeout patterns
    if (message.includes('connection pool') || message.includes('timed out')) {
      return true;
    }

    // Network errors
    const transientNetworkCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'];
    if (transientNetworkCodes.includes(code)) {
      return true;
    }

    // Network error patterns in message
    if (message.includes('network error')
      || message.includes('socket hang up')
      || message.includes('eai_again')) {
      return true;
    }

    // Transient HTTP status codes
    const transientStatusCodes = [408, 429, 500, 502, 503, 504];
    if (statusCode && transientStatusCodes.includes(statusCode)) {
      return true;
    }

    // Generic transient patterns
    if (message.includes('temporary failure') || message.includes('service unavailable')) {
      return true;
    }

    // Walk to the next error in the cause chain
    current = current.cause;
  }

  // Default to permanent (conservative approach)
  // Permanent errors include: 401, 403, 404, business logic errors, etc.
  return false;
}
