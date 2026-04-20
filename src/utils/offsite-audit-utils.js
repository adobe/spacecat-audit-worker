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
 * Shared helpers for off-site guidance audits (reddit, youtube, cited, etc.):
 * caps on URLs sent to Mystique (SQS payload size), optional `urlLimit` from the audit queue,
 * and DRS availability filtering to ensure only already-scraped URLs are sent for analysis.
 */

export const MYSTIQUE_URLS_LIMIT = 50;

/**
 * Effective max URLs to send to Mystique for store-backed guidance audits
 * (reddit / youtube / cited). Optional limit from `auditContext.messageData.urlLimit`
 * (RunnerAudit). Runners merge the resolved value into `auditResult.config.urlLimit` for
 * post-processors and persistence (same field name as Slack).
 * Capped at MYSTIQUE_URLS_LIMIT.
 *
 * @param {object} [auditContext]
 * @param {number|string} [auditContext.messageData.urlLimit]
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {number}
 */
/**
 * Error thrown when DRS successfully responded but reported no available scraped content.
 * Signals that scraping has not completed yet for any of the requested URLs.
 */
export class DrsNoContentAvailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DrsNoContentAvailableError';
  }
}

/**
 * Filters an array of URL objects to only those whose content is already available in DRS.
 *
 * Runs one `lookupScrapeResults` call per dataset ID. A URL passes the filter when it has
 * `status === 'available'` in **at least one** of the provided datasets, meaning Mystique
 * will be able to retrieve its scraped content.
 *
 * Falls back gracefully (returns the original list unchanged) when DRS is not configured or
 * every dataset lookup fails / returns null — i.e. when DRS availability cannot be determined.
 *
 * Throws a `DrsNoContentAvailableError` when DRS is reachable and successfully responded but
 * reported zero available URLs, meaning scraping has not completed yet.
 *
 * @param {Array<{url: string}>} urls - URL objects from the URL Store
 * @param {string[]} datasetIds - DRS dataset IDs to check
 *   (e.g. ['reddit_posts', 'reddit_comments'])
 * @param {string} siteId - Site ID required by the DRS lookup API
 * @param {object|null} drsClient - Configured DrsClient instance (or null / unconfigured)
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {Promise<Array<{url: string}>>} Filtered URL objects
 * @throws {DrsNoContentAvailableError} When DRS responded but no URLs are available yet
 */
export async function filterUrlsByDrsStatus(urls, datasetIds, siteId, drsClient, log, logPrefix) {
  const prefix = logPrefix ?? '';

  if (!drsClient || !drsClient.isConfigured()) {
    log?.info(`${prefix} DRS client not configured, skipping availability filter`);
    return urls;
  }

  const rawUrls = urls.map((item) => item.url);
  const availableUrls = new Set();
  let atLeastOneLookupSucceeded = false;

  for (const datasetId of datasetIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await drsClient.lookupScrapeResults({ datasetId, siteId, urls: rawUrls });
      if (!response) {
        log?.warn(`${prefix} DRS lookup returned null for datasetId=${datasetId}, skipping`);
        // eslint-disable-next-line no-continue
        continue;
      }
      atLeastOneLookupSucceeded = true;
      for (const result of response.results) {
        if (result.status === 'available') {
          availableUrls.add(result.url);
        }
      }
      log?.info(
        `${prefix} DRS lookup datasetId=${datasetId}: `
        + `${response.summary?.available ?? 0}/${response.summary?.total ?? rawUrls.length} available`,
      );
    } catch (error) {
      log?.warn(`${prefix} DRS lookup failed for datasetId=${datasetId}: ${error.message}, skipping`);
    }
  }

  if (!atLeastOneLookupSucceeded) {
    log?.warn(`${prefix} All DRS lookups failed or returned null for datasets [${datasetIds.join(', ')}], skipping availability filter`);
    return urls;
  }

  if (availableUrls.size === 0) {
    throw new DrsNoContentAvailableError(
      `No scraped content available in DRS for datasets [${datasetIds.join(', ')}] and siteId: ${siteId}`,
    );
  }

  const filtered = urls.filter((item) => availableUrls.has(item.url));
  const removed = urls.length - filtered.length;
  if (removed > 0) {
    log?.info(`${prefix} DRS availability filter: removed ${removed} URL(s) not yet scraped, ${filtered.length} remaining`);
  }
  return filtered;
}

export function resolveMystiqueUrlLimit(auditContext, log, logPrefix) {
  const prefix = logPrefix ?? '';
  const ctx = auditContext ?? {};
  const raw = ctx.messageData?.urlLimit;
  if (raw === undefined || raw === null || raw === '') {
    return MYSTIQUE_URLS_LIMIT;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    log?.warn(
      `${prefix} Invalid urlLimit in auditContext (${JSON.stringify(raw)}), using default ${MYSTIQUE_URLS_LIMIT}`,
    );
    return MYSTIQUE_URLS_LIMIT;
  }
  if (n > MYSTIQUE_URLS_LIMIT) {
    log?.info(`${prefix} urlLimit ${n} exceeds cap ${MYSTIQUE_URLS_LIMIT}, using ${MYSTIQUE_URLS_LIMIT}`);
    return MYSTIQUE_URLS_LIMIT;
  }
  return n;
}
