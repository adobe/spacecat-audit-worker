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
 * caps on URLs sent to Mystique (SQS payload size) and optional `urlLimit` from the audit queue.
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
