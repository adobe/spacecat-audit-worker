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

import { expect } from 'chai';

import { formatStructuredAuditLog, PREFLIGHT_METRIC_MARKER } from '../../src/preflight/utils.js';

describe('preflight/utils formatStructuredAuditLog', () => {
  it('leads with the rare pfauditmetric marker (the Splunk query anchor)', () => {
    expect(PREFLIGHT_METRIC_MARKER).to.equal('pfauditmetric');
    const out = formatStructuredAuditLog({ audit: 'canonical', status: 'ok', durationMs: 1 });
    // Single leading space, then the marker as the first token, so the dashboard can anchor on it.
    expect(out.startsWith(` ${PREFLIGHT_METRIC_MARKER} `)).to.be.true;
  });

  it('emits marker + audit/status/duration on the happy path with a single leading space and no error token', () => {
    const out = formatStructuredAuditLog({ audit: 'canonical', status: 'ok', durationMs: 120 });

    expect(out).to.equal(' pfauditmetric audit=canonical status=ok duration_ms=120');
    // Leading space so it appends cleanly onto the existing message.
    expect(out.startsWith(' ')).to.be.true;
    expect(out).to.not.include('error=');
  });

  it('omits the error token when status is ok even if an error string is passed', () => {
    const out = formatStructuredAuditLog({
      audit: 'links', status: 'ok', durationMs: 5, error: 'ignored',
    });

    expect(out).to.equal(' pfauditmetric audit=links status=ok duration_ms=5');
  });

  it('includes a quoted error token on the failure path', () => {
    const out = formatStructuredAuditLog({
      audit: 'links', status: 'fail', durationMs: 340, error: 'Timeout fetching canonical tag',
    });

    expect(out).to.equal(' pfauditmetric audit=links status=fail duration_ms=340 error="Timeout fetching canonical tag"');
  });

  it('collapses newlines and carriage returns so a multi-line error stays on one line', () => {
    const out = formatStructuredAuditLog({
      audit: 'headings',
      status: 'fail',
      durationMs: 12,
      // Consecutive \r\n collapse to a single space; only newlines are touched (literal spaces
      // elsewhere are preserved verbatim), which is the behavior we depend on for Splunk.
      error: 'boom\nat Object.<anonymous>\r\nat next',
    });

    // A raw newline would split the Splunk event; assert none survive.
    expect(out).to.not.match(/[\r\n]/);
    expect(out).to.equal(' pfauditmetric audit=headings status=fail duration_ms=12 error="boom at Object.<anonymous> at next"');
  });

  it('escapes backslashes and double quotes inside the error value', () => {
    const out = formatStructuredAuditLog({
      audit: 'metatags',
      status: 'fail',
      durationMs: 7,
      error: 'bad path C:\\temp and "quoted"',
    });

    expect(out).to.equal(' pfauditmetric audit=metatags status=fail duration_ms=7 error="bad path C:\\\\temp and \\"quoted\\""');
  });

  it('truncates the error value to 500 characters (after escaping)', () => {
    const longError = 'x'.repeat(1000);
    const out = formatStructuredAuditLog({
      audit: 'canonical', status: 'fail', durationMs: 1, error: longError,
    });

    const match = out.match(/error="(.*)"$/);
    expect(match).to.not.be.null;
    expect(match[1]).to.have.lengthOf(500);
  });

  it('omits the error token when status is fail but no error is provided', () => {
    const out = formatStructuredAuditLog({ audit: 'canonical', status: 'fail', durationMs: 3 });

    expect(out).to.equal(' pfauditmetric audit=canonical status=fail duration_ms=3');
    expect(out).to.not.include('error=');
  });

  it('coerces a non-string error (e.g. an Error object) via String()', () => {
    const out = formatStructuredAuditLog({
      audit: 'links', status: 'fail', durationMs: 2, error: new Error('kaboom'),
    });

    expect(out).to.include('error="Error: kaboom"');
  });
});
