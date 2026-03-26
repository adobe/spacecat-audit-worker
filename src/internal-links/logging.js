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

import { createContextLogger } from '../common/context-logger.js';

const INTERNAL_LINKS_CONTEXT_LOGGER_MARKER = Symbol.for('spacecat.internalLinksContextLogger');

function markInternalLinksContextLogger(log) {
  if (!log?.[INTERNAL_LINKS_CONTEXT_LOGGER_MARKER]) {
    Object.defineProperty(log, INTERNAL_LINKS_CONTEXT_LOGGER_MARKER, {
      value: true,
      enumerable: false,
    });
  }

  return log;
}

export function isInternalLinksContextLogger(log) {
  return Boolean(log?.[INTERNAL_LINKS_CONTEXT_LOGGER_MARKER]);
}

export function createInternalLinksContextLogger(
  log,
  context = {},
  contextLoggerFactory = createContextLogger,
) {
  return markInternalLinksContextLogger(contextLoggerFactory(log, context));
}

export function createInternalLinksAuditLogger(
  log,
  auditType,
  siteId,
  auditId = null,
  contextLoggerFactory = createContextLogger,
) {
  const context = { auditType, siteId };
  if (auditId) {
    context.auditId = auditId;
  }

  return createInternalLinksContextLogger(log, context, contextLoggerFactory);
}

export function createInternalLinksStepLogger({
  createContextLogger: contextLoggerFactory = createContextLogger,
  log,
  auditType,
  siteId,
  auditId,
  step,
  extraContext = {},
}) {
  return createInternalLinksContextLogger(log, {
    auditType,
    siteId,
    auditId,
    step,
    ...extraContext,
  }, contextLoggerFactory);
}

export function ensureInternalLinksStepLogger({
  createContextLogger: contextLoggerFactory = createContextLogger,
  log,
  auditType,
  siteId,
  auditId,
  step,
  extraContext = {},
}) {
  if (isInternalLinksContextLogger(log)) {
    return log;
  }

  return createInternalLinksStepLogger({
    createContextLogger: contextLoggerFactory,
    log,
    auditType,
    siteId,
    auditId,
    step,
    extraContext,
  });
}
