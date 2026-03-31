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

import { ok } from '@adobe/spacecat-shared-http-utils';

/**
 * Bot Detection Abort Handling
 *
 * This module handles abort signals in audit workflows, particularly for bot protection
 * scenarios where scraping was blocked by bot detection mechanisms.
 *
 * Key responsibilities:
 * - Process abort signals from scrape jobs
 * - Log detailed bot protection information
 * - Format and validate abort details
 * - Return appropriate HTTP responses for skipped audits
 */

/**
 * Handles abort signals in audit workflows.
 * Logs detailed information for bot protection aborts and returns an appropriate response.
 *
 * @param {Object} abort - Abort signal with reason and details
 * @param {string} abort.reason - Reason for abort (e.g., 'bot-protection')
 * @param {Object} abort.details - Additional details about the abort
 * @param {string} jobId - Job identifier
 * @param {string} type - Audit type (e.g., 'cwv', 'lhs')
 * @param {Object} site - Site object with getBaseURL() method
 * @param {string} siteId - Site identifier
 * @param {Object} log - Logger instance
 * @returns {Object} HTTP response indicating audit was skipped
 *
 * @example
 * const abort = {
 *   reason: 'bot-protection',
 *   details: {
 *     blockedUrlsCount: 5,
 *     totalUrlsCount: 10,
 *     byBlockerType: { cloudflare: 5 },
 *     byHttpStatus: { 403: 5 },
 *   }
 * };
 * const result = handleAbort(abort, 'job-123', 'cwv', site, 'site-456', log);
 * // => { status: 200, body: { skipped: true, reason: 'bot-protection', ... } }
 */
export function handleAbort(abort, jobId, type, site, siteId, log) {
  const { reason, details } = abort;

  if (reason === 'bot-protection') {
    const {
      blockedUrlsCount, totalUrlsCount, byBlockerType, byHttpStatus, blockedUrls,
    } = details || {};

    const statusDetails = Object.entries(byHttpStatus || {})
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    const blockerDetails = Object.entries(byBlockerType || {})
      .map(([blockerType, count]) => `${blockerType}: ${count}`)
      .join(', ');

    log.warn(
      `[BOT-BLOCKED] Audit aborted for jobId=${jobId}, type=${type}, site=${site.getBaseURL()} (${siteId}): `
      + `HTTP Status: [${statusDetails}], Blocker Types: [${blockerDetails}], `
      + `${blockedUrlsCount}/${totalUrlsCount} URLs blocked, `
      + `Bot Protected URLs: [${blockedUrls?.map((u) => u.url).join(', ') || 'none'}]`,
    );
  }

  // Return generic abort response
  return ok({
    skipped: true,
    reason,
    ...details,
  });
}
