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

/**
 * Creates a wrapped logger that automatically includes context information in all log messages.
 * This makes CloudWatch queries much easier by allowing filtering by context fields.
 *
 * @param {Object} log - The base logger object (must have info, warn, error, debug methods)
 * @param {Object} context - Context object with key-value pairs to include in logs
 * @returns {Object} Wrapped logger with automatic context prefix
 * @throws {Error} If log or context is invalid
 *
 * @example
 * const log = createContextLogger(baseLog, { auditType: 'internal-links', siteId: 'abc123' });
 * log.info('Found 200 pages');
 * // Logs: "[auditType=broken-internal-links] [siteId=abc123] Found 200 pages"
 *
 * @example
 * const log = createContextLogger(baseLog, { auditType: 'lhs', siteId: 'xyz789', auditId: '123' });
 * log.error('Processing failed');
 * // Logs: "[auditType=lhs] [siteId=xyz789] [auditId=123] Processing failed"
 */
export function createContextLogger(log, context = {}) {
  // Input validation
  if (!log || typeof log !== 'object') {
    throw new Error('Invalid log object: log must be an object with logging methods');
  }

  const requiredMethods = ['info', 'warn', 'error', 'debug'];
  for (const method of requiredMethods) {
    if (typeof log[method] !== 'function') {
      throw new Error(`Invalid log object: missing required method '${method}'`);
    }
  }

  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    throw new Error('Invalid context: context must be a non-null object');
  }

  // Build prefix from context object
  const contextEntries = Object.entries(context).filter(([_, value]) => value != null);
  if (contextEntries.length === 0) {
    throw new Error('Invalid context: context must contain at least one non-null value');
  }

  const prefix = contextEntries
    .map(([key, value]) => `[${key}=${value}]`)
    .join(' ');

  // Create wrapped logger methods using shared implementation
  const createLogMethod = (level) => (message, ...args) => log[level](`${prefix} ${message}`, ...args);

  return {
    info: createLogMethod('info'),
    warn: createLogMethod('warn'),
    error: createLogMethod('error'),
    debug: createLogMethod('debug'),
  };
}

/**
 * Creates a context-aware logger for audit operations with standard audit context.
 * Convenience wrapper around createContextLogger for common audit use cases.
 *
 * @param {Object} log - The base logger object
 * @param {string} auditType - The audit type identifier
 * @param {string} siteId - The site ID
 * @param {string} [auditId] - The audit ID (optional)
 * @returns {Object} Wrapped logger with audit context
 * @throws {Error} If required parameters are missing or invalid
 *
 * @example
 * const log = createAuditLogger(context.log, 'broken-internal-links', site.getId(), audit.getId());
 * log.info('Processing batch 1');
 * // Logs: "[auditType=broken-internal-links] [siteId=xxx] [auditId=yyy] Processing batch 1"
 */
export function createAuditLogger(log, auditType, siteId, auditId = null) {
  // Input validation for required parameters
  if (!auditType || typeof auditType !== 'string') {
    throw new Error('Invalid auditType: must be a non-empty string');
  }

  if (!siteId || typeof siteId !== 'string') {
    throw new Error('Invalid siteId: must be a non-empty string');
  }

  // Build context object
  const context = { auditType, siteId };
  if (auditId) {
    context.auditId = auditId;
  }

  return createContextLogger(log, context);
}

/**
 * Creates a simple site-scoped logger (for backward compatibility).
 * Wraps the audit type and site ID in a context logger.
 *
 * @param {Object} log - The base logger object
 * @param {string} auditType - The audit type identifier
 * @param {string} siteId - The site ID
 * @returns {Object} Wrapped logger with site context
 *
 * @example
 * const log = createSiteLogger(context.log, 'broken-internal-links', site.getId());
 * log.info('Found 200 Ahrefs pages');
 * // Logs: "[auditType=broken-internal-links] [siteId=xxx] Found 200 Ahrefs pages"
 */
export function createSiteLogger(log, auditType, siteId) {
  return createAuditLogger(log, auditType, siteId);
}
