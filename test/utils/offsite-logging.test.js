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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  OFFSITE_DOMAIN,
  AUDIT,
  OUTCOME,
  PEER,
  appendFields,
  createOffsiteLogger,
  withAuditPersistLog,
  sanitizeForLog,
  errorField,
  resolveTriggerFields,
} from '../../src/utils/offsite-logging.js';

use(sinonChai);

describe('offsite-logging helper', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
  });

  afterEach(() => sandbox.restore());

  describe('enums', () => {
    it('exposes the stable vocabulary', () => {
      expect(OFFSITE_DOMAIN).to.equal('offsite');
      expect(AUDIT).to.deep.equal({
        CITED: 'cited',
        REDDIT: 'reddit',
        YOUTUBE: 'youtube',
        WIKIPEDIA: 'wikipedia',
        BRAND_PRESENCE: 'brand-presence',
        BRAND_CLAIMS: 'brand-claims',
      });
      expect(OUTCOME).to.deep.equal({
        START: 'start', SUCCESS: 'success', FAILURE: 'failure', SKIP: 'skip', DEGRADED: 'degraded',
      });
      expect(OUTCOME.DEGRADED).to.equal('degraded');
      expect(PEER.DRS).to.equal('drs');
      expect(PEER.MYSTIQUE).to.equal('mystique');
      expect(PEER.URL_STORE).to.equal('url_store');
      expect(PEER.GUIDELINE_STORE).to.equal('guideline_store');
      expect(PEER.S3).to.equal('s3');
      expect(PEER.POSTGRES).to.equal('postgres');
      expect(PEER.SHAREPOINT).to.equal('sharepoint');
      expect(PEER.SEMRUSH).to.equal('semrush');
      expect(PEER.SLACK).to.equal('slack');
      expect(PEER.SQS).to.equal('sqs');
      expect(PEER.SPACECAT).to.equal('spacecat');
      expect(PEER.JOBS_DISPATCHER).to.equal('spacecat-jobs-dispatcher');
      expect(PEER.API_SERVICE).to.equal('spacecat-api-service');
      expect(PEER.SPACECAT_AUDIT_WORKER).to.equal('spacecat-audit-worker');
    });
  });

  describe('appendFields', () => {
    it('appends key=value tokens after the message', () => {
      expect(appendFields('msg', { a: 1, b: 2 })).to.equal('msg a=1 b=2');
    });

    it('renders fields in the canonical order regardless of insertion order', () => {
      expect(appendFields('m', { siteId: 's', domain: 'offsite', event: 'e' }))
        .to.equal('m domain=offsite event=e siteId=s');
    });

    it('appends unknown fields after the known ones, in insertion order', () => {
      expect(appendFields('m', { urls: 42, event: 'e', datasetId: 'd' }))
        .to.equal('m event=e urls=42 datasetId=d');
    });

    it('drops null, undefined and empty-string values but keeps 0 and false', () => {
      expect(appendFields('m', {
        a: 'x', b: null, c: undefined, d: '', n: 0, ok: false,
      })).to.equal('m a=x n=0 ok=false');
    });

    it('quotes values that contain whitespace, = or "', () => {
      expect(appendFields('m', { name: 'Acme Corp' })).to.equal('m name="Acme Corp"');
      expect(appendFields('m', { q: 'a=b' })).to.equal('m q="a=b"');
      expect(appendFields('m', { q: 'he said "hi"' })).to.equal("m q=\"he said 'hi'\"");
    });

    it('returns the message unchanged when there are no usable fields', () => {
      expect(appendFields('m', {})).to.equal('m');
      expect(appendFields('m')).to.equal('m');
      expect(appendFields('m', { a: null })).to.equal('m');
    });
  });

  describe('sanitizeForLog', () => {
    it('replaces control characters (newline, carriage return, tab) with spaces', () => {
      expect(sanitizeForLog('a\nb\rc\td')).to.equal('a b c d');
    });

    it('leaves ordinary text untouched', () => {
      expect(sanitizeForLog('http://example.com/path?x=1')).to.equal('http://example.com/path?x=1');
    });

    it('coerces non-strings and tolerates null/undefined', () => {
      expect(sanitizeForLog(42)).to.equal('42');
      expect(sanitizeForLog(null)).to.equal('');
      expect(sanitizeForLog(undefined)).to.equal('');
    });
  });

  describe('log-injection hardening', () => {
    // A crafted value must never be able to forge a second `key=value` token or split the line.
    it('quotes a field value that tries to forge a token, keeping it a single value', () => {
      expect(appendFields('m', { url: 'x" outcome=success' }))
        .to.equal("m url=\"x' outcome=success\"");
    });

    it('neutralizes an embedded newline in a field value (no line split)', () => {
      const out = appendFields('m', { note: 'a\noutcome=success' });
      expect(out).to.equal('m note="a outcome=success"');
      expect(out).to.not.include('\n');
    });

    it('neutralizes an embedded newline in the message itself', () => {
      const out = appendFields('line1\nline2 outcome=success', { a: 1 });
      expect(out).to.equal('line1 line2 outcome=success a=1');
      expect(out).to.not.include('\n');
    });

    it('quotes values containing multiple = characters', () => {
      expect(appendFields('m', { q: 'a=b=c' })).to.equal('m q="a=b=c"');
    });
  });

  describe('errorField', () => {
    it('extracts name and message from an Error', () => {
      expect(errorField(new TypeError('boom'))).to.deep.equal({ errorName: 'TypeError', errorMessage: 'boom' });
    });

    it('returns an empty object for a missing error', () => {
      expect(errorField(undefined)).to.deep.equal({});
      expect(errorField(null)).to.deep.equal({});
    });
  });

  describe('resolveTriggerFields', () => {
    it('resolves scheduled/jobs-dispatcher when origin is absent (legacy/default sender)', () => {
      expect(resolveTriggerFields(undefined)).to.deep.equal({
        trigger: 'scheduled', peer: PEER.JOBS_DISPATCHER,
      });
      expect(resolveTriggerFields({})).to.deep.equal({
        trigger: 'scheduled', peer: PEER.JOBS_DISPATCHER,
      });
    });

    it('resolves scheduled/jobs-dispatcher when origin is explicitly jobs-dispatcher', () => {
      expect(resolveTriggerFields({ origin: 'jobs-dispatcher' })).to.deep.equal({
        trigger: 'scheduled', peer: PEER.JOBS_DISPATCHER,
      });
    });

    it('resolves manual/api-service when origin is api-service', () => {
      expect(resolveTriggerFields({ origin: 'api-service' })).to.deep.equal({
        trigger: 'manual', peer: PEER.API_SERVICE,
      });
    });
  });

  describe('createOffsiteLogger', () => {
    it('emits a single string with prefix, domain/audit/event/outcome, bound ids and extras', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId: 's1', auditId: 'a1' });

      olog.success('mystique_dispatch', 'Queued Cited analysis', {
        peer: PEER.MYSTIQUE, direction: 'outbound', urls: 42,
      });

      expect(log.info).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWithExactly(
        '[offsite:cited] Queued Cited analysis domain=offsite audit=cited event=mystique_dispatch '
        + 'outcome=success peer=mystique direction=outbound siteId=s1 auditId=a1 urls=42',
      );
    });

    it('drops unset bound ids', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.REDDIT, siteId: 's1' });
      olog.start('audit_start', 'Starting');
      expect(log.info).to.have.been.calledWithExactly(
        '[offsite:reddit] Starting domain=offsite audit=reddit event=audit_start outcome=start siteId=s1',
      );
    });

    it('maps start/success/skip to info, failure to error', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.YOUTUBE });
      olog.start('e', 'm');
      olog.success('e', 'm');
      olog.skip('e', 'm');
      olog.failure('e', 'm');
      expect(log.info).to.have.been.calledThrice;
      expect(log.error).to.have.been.calledOnce;
      expect(log.error).to.have.been.calledWithExactly(
        '[offsite:youtube] m domain=offsite audit=youtube event=e outcome=failure',
      );
    });

    it('warn defaults outcome=degraded and debug defaults outcome=success', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.BRAND_PRESENCE });
      olog.warn('e', 'm');
      olog.debug('e', 'm');
      expect(log.warn).to.have.been.calledWithExactly(
        '[offsite:brand-presence] m domain=offsite audit=brand-presence event=e outcome=degraded',
      );
      expect(log.debug).to.have.been.calledWithExactly(
        '[offsite:brand-presence] m domain=offsite audit=brand-presence event=e outcome=success',
      );
    });

    it('warn with an empty extra object also defaults outcome=degraded', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED });
      olog.warn('drs_submit', 'retrying', {});
      expect(log.warn).to.have.been.calledWithExactly(
        '[offsite:cited] retrying domain=offsite audit=cited event=drs_submit outcome=degraded',
      );
    });

    it('lets extra.outcome override the warn default without duplicating the field', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED });
      olog.warn('drs_submit', 'skipping', { outcome: OUTCOME.SKIP, reason: 'no_ims_org' });
      expect(log.warn).to.have.been.calledWithExactly(
        '[offsite:cited] skipping domain=offsite audit=cited event=drs_submit outcome=skip reason=no_ims_org',
      );
    });

    it('.with() re-binds additional ids for subsequent calls', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId: 's1', auditId: 'a1' })
        .with({ opportunityId: 'o1' });
      olog.success('opportunity_persist', 'Opportunity persisted', {
        peer: PEER.POSTGRES, direction: 'outbound', status: 'NEW',
      });
      expect(log.info).to.have.been.calledWithExactly(
        '[offsite:cited] Opportunity persisted domain=offsite audit=cited event=opportunity_persist '
        + 'outcome=success peer=postgres direction=outbound siteId=s1 auditId=a1 opportunityId=o1 status=NEW',
      );
    });

    it('never passes a second argument to the underlying logger', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId: 's1' });
      olog.failure('opportunity_persist', 'boom', { reason: 'db_write', errorName: 'TypeError' });
      const call = log.error.getCall(0);
      expect(call.args).to.have.lengthOf(1);
      expect(call.args[0]).to.be.a('string');
    });

    it('failure passes a raw Error through as a second arg for stack capture when given', () => {
      const olog = createOffsiteLogger(log, { audit: AUDIT.CITED, siteId: 's1' });
      const err = new Error('boom');
      olog.failure('guidance_complete', 'unexpected', { reason: 'unknown' }, err);
      const call = log.error.getCall(0);
      expect(call.args).to.have.lengthOf(2);
      expect(call.args[0]).to.be.a('string').and.to.include('event=guidance_complete outcome=failure');
      expect(call.args[1]).to.equal(err);
    });
  });

  describe('withAuditPersistLog', () => {
    it('is a post-processor that logs audit_analysis_run_write success from the persisted audit data', async () => {
      const pp = withAuditPersistLog(AUDIT.CITED);
      const auditData = { siteId: 's1', id: 'a1', auditType: 'cited-analysis' };

      const result = await pp('https://example.com', auditData, { log }, {}, {});

      // returns the accumulator unchanged so the post-processor chain is transparent
      expect(result).to.equal(auditData);
      expect(log.info).to.have.been.calledOnceWithExactly(
        '[offsite:cited] Audit persisted domain=offsite audit=cited event=audit_analysis_run_write '
        + 'outcome=success peer=postgres direction=outbound siteId=s1 auditId=a1 auditType=cited-analysis',
      );
    });

    it('falls back to context.audit for the id when auditData.id is absent', async () => {
      const pp = withAuditPersistLog(AUDIT.BRAND_PRESENCE);
      const auditData = { siteId: 's2', auditType: 'offsite-brand-presence' };
      const context = { log, audit: { getId: () => 'a2' } };

      await pp('https://example.com', auditData, context, {}, {});

      expect(log.info).to.have.been.calledOnceWithExactly(
        '[offsite:brand-presence] Audit persisted domain=offsite audit=brand-presence event=audit_analysis_run_write '
        + 'outcome=success peer=postgres direction=outbound siteId=s2 auditId=a2 auditType=offsite-brand-presence',
      );
    });
  });
});
