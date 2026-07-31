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

/**
 * Structured logging for the offsite audits.
 *
 * The taxonomy is emitted as plain `key=value` tokens appended to the message string, because
 * that is what Splunk auto-extracts from the raw log text (a second-arg object is rendered via
 * `util.inspect` and is NOT extractable). A short human prefix `[offsite:<audit>]` is kept for
 * eyeball scanning. Field names match the Mystique side so Splunk `stats ... by domain, audit,
 * event, outcome` works across both sourcetypes.
 */

export const OFFSITE_DOMAIN = 'offsite';

export const AUDIT = {
  CITED: 'cited',
  REDDIT: 'reddit',
  YOUTUBE: 'youtube',
  BRAND_PRESENCE: 'brand-presence',
};

export const OUTCOME = {
  START: 'start',
  SUCCESS: 'success',
  FAILURE: 'failure',
  SKIP: 'skip',
};

export const PEER = {
  DRS: 'drs',
  MYSTIQUE: 'mystique',
  URL_STORE: 'url_store',
  S3: 's3',
  POSTGRES: 'postgres',
  SHAREPOINT: 'sharepoint',
  SLACK: 'slack',
  SQS: 'sqs',
  SPACECAT: 'spacecat',
};

// Canonical order so a human scanning logs always sees the dimensions in the same place.
const FIELD_ORDER = [
  'domain', 'audit', 'event', 'outcome', 'peer', 'direction',
  'siteId', 'auditId', 'opportunityId', 'jobId',
];

function renderField(key, value) {
  const str = String(value);
  // Quote values that would break Splunk's `key=value` extraction; keep IDs/tokens bare.
  return /[\s"=]/.test(str) ? `${key}="${str.replace(/"/g, "'")}"` : `${key}=${str}`;
}

/**
 * Append `key=value` tokens to a message. Fields render in {@link FIELD_ORDER} first, then any
 * remaining fields in insertion order. `null`, `undefined` and `''` values are dropped.
 *
 * @param {string} message human-readable message (kept as-is; put free text / prose here)
 * @param {object} [fields] controlled tokens and ids
 * @returns {string} the message with the rendered fields appended
 */
export function appendFields(message, fields = {}) {
  const emitted = new Set();
  const parts = [];

  const push = (key) => {
    const value = fields[key];
    if (value != null && value !== '') {
      parts.push(renderField(key, value));
    }
  };

  for (const key of FIELD_ORDER) {
    push(key);
    emitted.add(key);
  }
  for (const key of Object.keys(fields)) {
    if (!emitted.has(key)) {
      push(key);
    }
  }

  return parts.length > 0 ? `${message} ${parts.join(' ')}` : message;
}

/**
 * Create an offsite-scoped logger bound to an audit and (optionally) the run's identifiers.
 * Each method emits exactly one string argument to the underlying logger.
 *
 * @param {object} log the helix logger (`context.log`)
 * @param {object} bound `{ audit, siteId, auditId, opportunityId, jobId }`
 * @returns {object} logger with `start/success/skip/failure/warn/debug(event, message, extra)`
 *   and `.with(moreIds)`
 */
export function createOffsiteLogger(log, bound = {}) {
  const {
    audit, siteId, auditId, opportunityId, jobId,
  } = bound;
  const human = `[offsite:${audit}]`;

  const emit = (level, event, outcome, message, extra = {}) => {
    const fields = {
      domain: OFFSITE_DOMAIN,
      audit,
      event,
      outcome,
      siteId,
      auditId,
      opportunityId,
      jobId,
      ...extra,
    };
    log[level](appendFields(`${human} ${message}`, fields));
  };

  return {
    start: (event, message, extra) => emit('info', event, OUTCOME.START, message, extra),
    success: (event, message, extra) => emit('info', event, OUTCOME.SUCCESS, message, extra),
    skip: (event, message, extra) => emit('info', event, OUTCOME.SKIP, message, extra),
    failure: (event, message, extra) => emit('error', event, OUTCOME.FAILURE, message, extra),
    warn: (event, message, extra = {}) => emit('warn', event, extra.outcome ?? OUTCOME.FAILURE, message, extra),
    debug: (event, message, extra = {}) => emit('debug', event, extra.outcome ?? OUTCOME.SUCCESS, message, extra),
    with: (moreIds) => createOffsiteLogger(log, {
      audit, siteId, auditId, opportunityId, jobId, ...moreIds,
    }),
  };
}

/**
 * Build an offsite `audit_persist` post-processor for an AuditBuilder.
 *
 * The framework persists the Audit record silently (`defaultPersister` → `Audit.create`) and
 * sets `context.audit` before post-processors run, so this post-processor makes the persist
 * observable without touching the generic `common/base-audit.js`. Prepend it to
 * `.withPostProcessors([...])` on an offsite builder. It logs and returns the accumulator
 * unchanged so it is transparent to the rest of the chain.
 *
 * @param {string} audit one of {@link AUDIT}
 * @returns {Function} a post-processor `(finalUrl, auditData, context) => auditData`
 */
export function withAuditPersistLog(audit) {
  return async function logAuditPersisted(finalUrl, auditData, context) {
    createOffsiteLogger(context.log, {
      audit,
      siteId: auditData?.siteId,
      auditId: auditData?.id ?? context.audit?.getId?.(),
    }).success('audit_persist', 'Audit persisted', {
      peer: PEER.POSTGRES,
      direction: 'outbound',
      auditType: auditData?.auditType,
    });
    return auditData;
  };
}
