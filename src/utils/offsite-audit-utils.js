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
 * URL regex filters, caps on URLs sent to Mystique (SQS payload size),
 * and optional `urlLimit` from the audit queue.
 */

export const MYSTIQUE_URLS_LIMIT = 50;

/**
 * Matches valid YouTube URLs (any youtube.com / youtu.be / youtube-nocookie.com / m.youtube.com).
 * Used to filter out non-content YouTube URLs (e.g. homepage, channel root) before
 * sending to Mystique.
 */
export const YOUTUBE_URL_REGEX = /^(?:https?:\/\/)?(?:www\.)?(?:m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)(?:[/?#]|$)/;

/**
 * Matches valid Reddit post/comment/community URLs.
 * Requires a subreddit (/r/), topic (/t/), or user (/user/) path segment followed by a
 * content path. Bare reddit.com links, search, etc. are excluded.
 */
export const REDDIT_URL_REGEX = /^https:\/\/(www)?\.?reddit\.com\/([rt]|user)\/[a-zA-Z0-9_/%-]+\/(comments\/[a-zA-Z0-9_-]+\/.+\/?|.*)$/;

/**
 * Filters an array of URL objects (each with a `.url` string property) to only those
 * whose URL matches the given regex. Logs how many were removed.
 *
 * @param {Array<{url: string}>} urls
 * @param {RegExp} regex
 * @param {object} [log]
 * @param {string} [logPrefix]
 * @returns {Array<{url: string}>}
 */
export function filterUrlsByRegex(urls, regex, log, logPrefix) {
  const filtered = urls.filter((item) => regex.test(item.url));
  const removed = urls.length - filtered.length;
  if (removed > 0) {
    log?.info(`${logPrefix ?? ''} Filtered out ${removed} URL(s) that did not match the expected pattern`);
  }
  return filtered;
}

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
