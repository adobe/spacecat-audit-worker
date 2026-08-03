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
 * Structured logging for the offsite audits.
 *
 * The taxonomy is emitted as plain `key=value` tokens appended to the message string, because
 * that is what Splunk auto-extracts from the raw log text (a second-arg object is rendered via
 * `util.inspect` and is NOT extractable). A short human prefix `[offsite:<audit>]` is kept for
 * eyeball scanning. Field names match the Mystique side so Splunk `stats ... by domain, audit,
 * event, outcome` works across both sourcetypes.
 *
 * Log-injection safety: values are control-char-sanitized and quoted (see renderField), and the
 * free-text message is control-char-sanitized (see appendFields), so externally-sourced content
 * (scraped URLs, upstream error text) cannot split a log line or forge a second `key=value`
 * token. Externally-sourced strings should still be routed through `fields` (quoted), not the
 * message, and errors through {@link errorField}.
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
// `drsJobId` (not `jobId`) is used for DRS scrape jobs so it never collides with the async-queue
// `jobId` that the platform logWrapper injects into the same log stream.
const FIELD_ORDER = [
  'domain', 'audit', 'event', 'outcome', 'peer', 'direction',
  'siteId', 'auditId', 'opportunityId', 'drsJobId',
];

/**
 * Strip control characters (C0 range and DEL, which includes carriage-return and newline) so a
 * crafted value — or externally-sourced text interpolated into a message — cannot split one log
 * call into multiple lines when a shipper (CloudWatch, Fluent Bit) sees a newline. Not
 * general-purpose escaping; log-token safety only.
 *
 * @param {*} value any value; coerced to string (null/undefined -> '')
 * @returns {string}
 */
export function sanitizeForLog(value) {
  if (value == null) {
    return '';
  }
  let out = '';
  for (const ch of String(value)) {
    const code = ch.codePointAt(0);
    out += (code < 0x20 || code === 0x7f) ? ' ' : ch;
  }
  return out;
}

// Renders one `key=value` token. Values are control-char-sanitized, and when they contain
// whitespace/`=`/`"` they are wrapped in quotes with inner `"`->`'` so they stay a SINGLE Splunk
// token (a crafted value cannot forge a second `key=value`). NOTE: this is log-token safety, not
// general-purpose escaping — do not reuse renderField for HTML/shell/SQL contexts. The `"`->`'`
// substitution is intentionally lossy.
function renderField(key, value) {
  const str = sanitizeForLog(value);
  return /[\s"=]/.test(str) ? `${key}="${str.replace(/"/g, "'")}"` : `${key}=${str}`;
}

/**
 * Append `key=value` tokens to a message. Fields render in {@link FIELD_ORDER} first, then any
 * remaining fields in insertion order. `null`, `undefined` and `''` values are dropped. The
 * message itself is control-char-sanitized so interpolated free text cannot split the line.
 *
 * @param {string} message human-readable message (prose only; route external strings via fields)
 * @param {object} [fields] controlled tokens and ids
 * @returns {string} the message with the rendered fields appended
 */
export function appendFields(message, fields = {}) {
  const safeMessage = sanitizeForLog(message);
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

  return parts.length > 0 ? `${safeMessage} ${parts.join(' ')}` : safeMessage;
}

/**
 * Normalize an Error into taxonomy fields (`errorName`, `errorMessage`). Routing the message
 * through a field means it is quoted/sanitized by {@link renderField} rather than interpolated
 * raw into the log message, which closes the injection surface for upstream error text.
 *
 * @param {Error} [err]
 * @returns {{errorName?: string, errorMessage?: string}} empty object when no error
 */
export function errorField(err) {
  if (!err) {
    return {};
  }
  return { errorName: err.name, errorMessage: err.message };
}

/**
 * Create an offsite-scoped logger bound to an audit and (optionally) the run's identifiers.
 * Each method emits exactly one string argument to the underlying logger — except `failure`,
 * which may pass a raw Error as a genuine second arg purely for stack capture.
 *
 * @param {object} log the helix logger (`context.log`)
 * @param {object} bound `{ audit, siteId, auditId, opportunityId }`
 * @returns {object} logger with `start/success/skip/failure/warn/debug(event, message, extra)`
 *   and `.with(moreIds)`
 */
export function createOffsiteLogger(log, bound = {}) {
  const {
    audit, siteId, auditId, opportunityId,
  } = bound;
  const human = `[offsite:${audit}]`;

  const emit = (level, event, outcome, message, extra, error) => {
    const fields = {
      domain: OFFSITE_DOMAIN,
      audit,
      event,
      outcome,
      siteId,
      auditId,
      opportunityId,
      ...(extra || {}),
    };
    const line = appendFields(`${human} ${message}`, fields);
    // Pass a raw Error through as a genuine second arg ONLY for stack capture (CloudWatch /
    // util.inspect renders it); the Splunk taxonomy always lives in the single sanitized `line`.
    if (error !== undefined) {
      log[level](line, error);
    } else {
      log[level](line);
    }
  };

  return {
    start: (event, message, extra) => emit('info', event, OUTCOME.START, message, extra),
    success: (event, message, extra) => emit('info', event, OUTCOME.SUCCESS, message, extra),
    skip: (event, message, extra) => emit('info', event, OUTCOME.SKIP, message, extra),
    failure: (event, message, extra, error) => emit('error', event, OUTCOME.FAILURE, message, extra, error),
    warn: (event, message, extra = {}) => emit('warn', event, extra.outcome ?? OUTCOME.FAILURE, message, extra),
    debug: (event, message, extra = {}) => emit('debug', event, extra.outcome ?? OUTCOME.SUCCESS, message, extra),
    with: (moreIds) => createOffsiteLogger(log, {
      audit, siteId, auditId, opportunityId, ...moreIds,
    }),
  };
}

/**
 * Build an offsite `audit_persist` post-processor for an AuditBuilder.
 *
 * The framework persists the Audit record silently (`defaultPersister` -> `Audit.create`) and
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
