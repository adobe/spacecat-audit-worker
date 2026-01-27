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

const AUDIT_TYPE = 'broken-internal-links';

/**
 * Creates a context-aware logger that automatically includes siteId in all log messages.
 * This makes CloudWatch queries much easier by allowing filtering by siteId.
 *
 * @param {Object} log - The base logger object from context
 * @param {string} siteId - The site ID to include in all log messages
 * @returns {Object} Wrapped logger with automatic siteId prefix
 *
 * @example
 * const log = createContextLogger(context.log, site.getId());
 * log.info('Found 200 Ahrefs pages');
 * // Logs: "[broken-internal-links] [siteId=xxx] Found 200 Ahrefs pages"
 */
export function createContextLogger(log, siteId) {
  const prefix = `[${AUDIT_TYPE}] [siteId-abhigarg=${siteId}]`;

  return {
    info: (message, ...args) => log.info(`${prefix} ${message}`, ...args),
    warn: (message, ...args) => log.warn(`${prefix} ${message}`, ...args),
    error: (message, ...args) => log.error(`${prefix} ${message}`, ...args),
    debug: (message, ...args) => log.debug(`${prefix} ${message}`, ...args),
  };
}

/**
 * Creates a context-aware logger with additional audit context (auditId, traceId, etc.)
 *
 * @param {Object} log - The base logger object from context
 * @param {string} siteId - The site ID
 * @param {string} auditId - The audit ID (optional)
 * @returns {Object} Wrapped logger with full context
 *
 * @example
 * const log = createAuditLogger(context.log, site.getId(), audit.getId());
 * log.info('Processing batch 1');
 * // Logs: "[broken-internal-links] [siteId=xxx] [auditId=yyy] Processing batch 1"
 */
export function createAuditLogger(log, siteId, auditId = null) {
  let prefix = `[${AUDIT_TYPE}] [siteId-abhigarg=${siteId}]`;
  if (auditId) {
    prefix += ` [auditId=${auditId}]`;
  }

  return {
    info: (message, ...args) => log.info(`${prefix} ${message}`, ...args),
    warn: (message, ...args) => log.warn(`${prefix} ${message}`, ...args),
    error: (message, ...args) => log.error(`${prefix} ${message}`, ...args),
    debug: (message, ...args) => log.debug(`${prefix} ${message}`, ...args),
  };
}
