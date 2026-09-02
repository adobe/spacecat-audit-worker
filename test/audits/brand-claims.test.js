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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import brandClaimsHandler, { sanitizePathComponent } from '../../src/brand-claims/handler.js';

use(sinonChai);
use(chaiAsPromised);

const SITE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const ORG_ID = '11111111-2222-3333-4444-555555555555';
const BRAND_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('Brand Claims audit handler', function () {
  this.timeout(10000);
  const sandbox = sinon.createSandbox();

  let log;
  let sqs;
  let s3Client;
  let postgrestClient;
  let selectResult;
  let updateResult;
  let pgCalls;

  // Records each PostgREST query so tests can assert the exact table, columns, and
  // filters (a no-op builder would let a dropped tenant filter pass silently).
  const makePostgrest = () => ({
    from: (table) => {
      const rec = {
        table, select: undefined, update: undefined, eqs: [], neqs: [],
      };
      pgCalls.push(rec);
      const builder = {
        select: (cols) => { rec.select = cols; return builder; },
        update: (payload) => { rec.update = payload; return builder; },
        eq: (col, val) => { rec.eqs.push([col, val]); return builder; },
        neq: (col, val) => { rec.neqs.push([col, val]); return builder; },
        order: () => builder,
        limit: (n) => { rec.limit = n; return Promise.resolve(selectResult); },
        maybeSingle: () => Promise.resolve(updateResult),
      };
      return builder;
    },
  });

  const buildContext = (overrides = {}) => ({
    log,
    sqs,
    s3Client,
    env: {
      SQS_BP_SHEET_READY_QUEUE_URL: 'https://sqs.test/bp-sheet-ready',
      DRS_BP_BUCKET: 'drs-bp-bucket',
    },
    dataAccess: {
      Site: { findById: sandbox.stub().resolves(null) },
      Audit: { create: sandbox.stub().resolves({}) },
      services: { postgrestClient },
    },
    site: {
      getId: () => SITE_ID,
      getOrganizationId: () => ORG_ID,
      getIsLive: () => true,
    },
    ...overrides,
  });

  const message = { type: 'brand-claims', siteId: SITE_ID };

  beforeEach(() => {
    log = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    sqs = { sendMessage: sandbox.stub().resolves() };
    s3Client = { send: sandbox.stub().resolves({ Contents: [], IsTruncated: false }) };
    selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: true }], error: null };
    updateResult = { data: { id: BRAND_ID, name: 'Acme Corp' }, error: null };
    pgCalls = [];
    postgrestClient = makePostgrest();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('sanitizePathComponent', () => {
    // Golden vectors — must stay in lockstep with the DRS producer and the api-service
    // run-brand-claims command. A diff here means the S3 prefix will not match the sheet.
    it('matches the known DRS input/output vectors', () => {
      const vectors = [
        ['Acme Corp', 'acmecorp'],
        ['Acme.Co/Foo\\Bar', 'acme-co-foo-bar'],
        ['  Trimmed  ', 'trimmed'],
        ['Über Brand!', 'berbrand'],
        ['a__b--c', 'a__b-c'],
        ['...leading.dots...', 'leading-dots'],
      ];
      vectors.forEach(([input, expected]) => {
        expect(sanitizePathComponent(input), input).to.equal(expected);
      });
    });

    it('normalizes dots, slashes, backslashes and case', () => {
      expect(sanitizePathComponent('Acme.Co/Foo\\Bar')).to.equal('acme-co-foo-bar');
    });

    it('coerces a non-string input', () => {
      expect(sanitizePathComponent(1234)).to.equal('1234');
      expect(sanitizePathComponent(null)).to.equal('');
    });

    it('falls back to a hash when only invalid chars remain', () => {
      // Pin the exact output: sha256('!!!@@@').slice(0,16). Must stay byte-for-byte in
      // lockstep with DRS's sanitize_path_component — a format-only check would miss drift.
      expect(sanitizePathComponent('!!!@@@')).to.equal('4f2705a107835dc0');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(sanitizePathComponent('   ')).to.equal('');
    });
  });

  describe('guard clauses (enabled + skipped, non-fatal)', () => {
    it('returns ok when siteId is missing', async () => {
      const res = await brandClaimsHandler({ type: 'brand-claims' }, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('missing siteId');
    });

    it('throws (SQS retry) when the queue URL is not configured', async () => {
      const ctx = buildContext();
      delete ctx.env.SQS_BP_SHEET_READY_QUEUE_URL;
      await expect(brandClaimsHandler(message, ctx))
        .to.be.rejectedWith('SQS_BP_SHEET_READY_QUEUE_URL');
    });

    it('throws (SQS retry) when the DRS bucket is not configured', async () => {
      const ctx = buildContext();
      delete ctx.env.DRS_BP_BUCKET;
      await expect(brandClaimsHandler(message, ctx))
        .to.be.rejectedWith('DRS_BP_BUCKET');
    });

    it('throws (SQS retry) when the postgrest client is unavailable', async () => {
      const ctx = buildContext();
      ctx.dataAccess.services = {};
      await expect(brandClaimsHandler(message, ctx))
        .to.be.rejectedWith('postgrestClient');
    });

    it('returns ok when the site cannot be found', async () => {
      const ctx = buildContext({ site: null });
      ctx.dataAccess.Site.findById.resolves(null);
      const res = await brandClaimsHandler(message, ctx);
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('site not found');
    });

    it('returns ok when no active brand is found', async () => {
      selectResult = { data: [], error: null };
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('no active brand');
    });

    it('skips run (no SQS) when the brand is not enabled for claims', async () => {
      selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: false }], error: null };
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('not enabled for claims');
      expect(s3Client.send).to.not.have.been.called;
      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('skips run when the brand name sanitizes to empty', async () => {
      selectResult = { data: [{ id: BRAND_ID, name: '   ', brand_claims_enabled: true }], error: null };
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('empty S3 path component');
      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('skips run when no sheet exists (listing has no Contents)', async () => {
      s3Client.send.resolves({ IsTruncated: false });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('no Brand Presence sheet');
      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('on_demand bypasses the enable gate for a disabled brand and stamps on_demand=true', async () => {
      // Disabled brand + onDemand=true → runs anyway and marks the event on-demand
      // (LLMO-7263), so the Brand Claims consumer bypasses its gate for this event.
      selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: false }], error: null };
      const prefix = `${SITE_ID}/acmecorp/analytics/chatgpt_free`;
      s3Client.send.resolves({
        Contents: [{ Key: `${prefix}/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') }],
        IsTruncated: false,
      });

      const res = await brandClaimsHandler({ type: 'brand-claims', siteId: SITE_ID, onDemand: true }, buildContext());

      expect(res.status).to.equal(200);
      expect(log.info).to.not.have.been.calledWithMatch('not enabled for claims');
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.on_demand).to.equal(true);
      expect(event.event_type).to.equal('BRAND_PRESENCE_SHEET_WRITTEN');
    });
  });

  describe('off-site opportunity enrichment mode (LLMO-7312)', () => {
    const enabledSheet = () => {
      const prefix = `${SITE_ID}/acmecorp/analytics/chatgpt_free`;
      s3Client.send.resolves({
        Contents: [{ Key: `${prefix}/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') }],
        IsTruncated: false,
      });
    };

    it('stamps mode=enrich on the event when mode is folded into the audit data (JSON string)', async () => {
      enabledSheet();
      const res = await brandClaimsHandler(
        { type: 'brand-claims', siteId: SITE_ID, data: JSON.stringify({ mode: 'enrich' }) },
        buildContext(),
      );
      expect(res.status).to.equal(200);
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.mode).to.equal('enrich');
    });

    it('honors mode passed as a top-level message field', async () => {
      enabledSheet();
      await brandClaimsHandler({ type: 'brand-claims', siteId: SITE_ID, mode: 'enrich' }, buildContext());
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.mode).to.equal('enrich');
    });

    it('defaults to mode=full when no mode is provided', async () => {
      enabledSheet();
      await brandClaimsHandler({ type: 'brand-claims', siteId: SITE_ID }, buildContext());
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.mode).to.equal('full');
    });

    it('treats an unknown or malformed mode as full', async () => {
      enabledSheet();
      await brandClaimsHandler(
        { type: 'brand-claims', siteId: SITE_ID, data: 'not-json{' },
        buildContext(),
      );
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.mode).to.equal('full');
    });

    it('enrich bypasses the enable gate for a disabled brand (like on_demand)', async () => {
      selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: false }], error: null };
      enabledSheet();
      const res = await brandClaimsHandler(
        { type: 'brand-claims', siteId: SITE_ID, mode: 'enrich' },
        buildContext(),
      );
      expect(res.status).to.equal(200);
      expect(log.info).to.not.have.been.calledWithMatch('not enabled for claims');
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.mode).to.equal('enrich');
    });
  });

  describe('error propagation (SQS retry)', () => {
    it('throws when the brand lookup query errors', async () => {
      selectResult = { data: null, error: { message: 'boom' } };
      await expect(brandClaimsHandler(message, buildContext()))
        .to.be.rejectedWith('Failed to resolve brand for site: boom');
    });

    it('throws (SQS retry) when the S3 listing fails', async () => {
      s3Client.send.rejects(new Error('AccessDenied'));
      await expect(brandClaimsHandler(message, buildContext()))
        .to.be.rejectedWith('AccessDenied');
    });

    it('throws (SQS retry) when the SQS publish fails', async () => {
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      sqs.sendMessage.rejects(new Error('ServiceUnavailable'));
      await expect(brandClaimsHandler(message, buildContext()))
        .to.be.rejectedWith('ServiceUnavailable');
    });
  });

  describe('multi-match handling', () => {
    it('picks the first brand deterministically and warns', async () => {
      selectResult = {
        data: [
          { id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: true },
          { id: 'other', name: 'Acme Two', brand_claims_enabled: true },
        ],
        error: null,
      };
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('LLMO-4592');
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });
  });

  describe('happy path — run', () => {
    it('publishes the ready-signal for the latest sheet', async () => {
      const prefix = `${SITE_ID}/acmecorp/analytics/chatgpt_free`;
      s3Client.send.resolves({
        Contents: [
          // no LastModified -> lastModified 0, sets initial best (weekly)
          { Key: `${prefix}/2026/01/01/bp-w1-2026.xlsx` },
          // newer partition (2026-01-05 is a Monday) -> replaces best
          { Key: `${prefix}/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') },
          // same partition, newer LastModified, daily suffix, Monday -> replaces best (daily)
          { Key: `${prefix}/2026/01/05/bp-w2-2026-030405.xlsx`, LastModified: new Date('2026-01-05T06:00:00Z') },
          // same partition, older LastModified -> no replace
          { Key: `${prefix}/2026/01/05/bp-w2-2026-010101.xlsx`, LastModified: new Date('2026-01-05T01:00:00Z') },
          // filename does not match the sheet pattern -> skipped
          { Key: `${prefix}/2026/01/06/notes.txt`, LastModified: new Date('2026-01-06T00:00:00Z') },
          // filename matches but no date partition in key -> skipped
          { Key: `bp-w9-2026.xlsx`, LastModified: new Date('2026-01-07T00:00:00Z') },
        ],
        IsTruncated: false,
      });

      const ctx = buildContext();
      const res = await brandClaimsHandler(message, ctx);

      expect(res.status).to.equal(200);
      expect(sqs.sendMessage).to.have.been.calledOnce;

      const [queueUrl, event] = sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('https://sqs.test/bp-sheet-ready');
      expect(event).to.deep.equal({
        event_type: 'BRAND_PRESENCE_SHEET_WRITTEN',
        schema_version: 1,
        organization_id: ORG_ID,
        brand_id: BRAND_ID,
        brand: 'acmecorp',
        site_id: SITE_ID,
        week: 2,
        year: 2026,
        cadence: 'daily',
        sheet_date: '2026-01-05',
        platform: 'chatgpt_free',
        s3_bucket: 'drs-bp-bucket',
        s3_key: `${prefix}/2026/01/05/bp-w2-2026-030405.xlsx`,
        on_demand: false,
        mode: 'full',
        parent_job_id: null,
        batch_id: null,
      });
    });

    it('persists a brand-claims audit so the on-demand cooldown has a row to read', async () => {
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') }],
        IsTruncated: false,
      });
      const ctx = buildContext();
      const res = await brandClaimsHandler({ type: 'brand-claims', siteId: SITE_ID, onDemand: true }, ctx);

      expect(res.status).to.equal(200);
      expect(ctx.dataAccess.Audit.create).to.have.been.calledOnce;
      const auditArg = ctx.dataAccess.Audit.create.firstCall.args[0];
      expect(auditArg.auditType).to.equal('brand-claims');
      expect(auditArg.siteId).to.equal(SITE_ID);
      expect(auditArg.auditedAt).to.be.a('string');
      expect(auditArg.auditResult.onDemand).to.equal(true);
    });

    it('still succeeds when the audit persistence fails (best-effort, run already triggered)', async () => {
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') }],
        IsTruncated: false,
      });
      const ctx = buildContext();
      ctx.dataAccess.Audit.create.rejects(new Error('db down'));
      const res = await brandClaimsHandler(message, ctx);

      expect(res.status).to.equal(200);
      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(log.warn).to.have.been.calledWithMatch(/failed to persist brand-claims audit/);
    });

    it('skips a mid-week daily sheet and picks the latest Monday daily sheet', async () => {
      const prefix = `${SITE_ID}/acmecorp/analytics/chatgpt_free`;
      // Daily-cadence site with a Monday (2026-01-05) and a newer Tuesday
      // (2026-01-06) sheet. The consumer only runs daily sheets on a Monday, so
      // the newer Tuesday sheet must be skipped for Monday's. (LLMO-6877)
      s3Client.send.resolves({
        Contents: [
          { Key: `${prefix}/2026/01/05/bp-w2-2026-050126.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') },
          { Key: `${prefix}/2026/01/06/bp-w2-2026-060126.xlsx`, LastModified: new Date('2026-01-06T00:00:00Z') },
        ],
        IsTruncated: false,
      });

      const res = await brandClaimsHandler(message, buildContext());

      expect(res.status).to.equal(200);
      expect(sqs.sendMessage).to.have.been.calledOnce;
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.cadence).to.equal('daily');
      expect(event.sheet_date).to.equal('2026-01-05');
      expect(event.s3_key).to.equal(`${prefix}/2026/01/05/bp-w2-2026-050126.xlsx`);
    });

    it('reads the brands table with the expected filters and never writes it', async () => {
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      await brandClaimsHandler(message, buildContext());

      const read = pgCalls[0];
      expect(read.table).to.equal('brands');
      expect(read.select).to.equal('id, name, brand_claims_enabled');
      expect(read.eqs).to.deep.include.members([
        ['organization_id', ORG_ID],
        ['status', 'active'],
        ['site_id', SITE_ID],
      ]);

      // Enable is handled separately now — the handler must never issue a brands update.
      expect(pgCalls).to.have.lengthOf(1);
      expect(pgCalls.some((c) => c.update !== undefined)).to.equal(false);
    });


    it('resolves the site via Site.findById when not pre-fetched', async () => {
      const ctx = buildContext({ site: null });
      ctx.dataAccess.Site.findById.resolves({
        getId: () => SITE_ID,
        getOrganizationId: () => ORG_ID,
        getIsLive: () => true,
      });
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      const res = await brandClaimsHandler(message, ctx);
      expect(res.status).to.equal(200);
      expect(ctx.dataAccess.Site.findById).to.have.been.calledWith(SITE_ID);
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });

    it('paginates S3 listings via the continuation token', async () => {
      s3Client.send.onCall(0).resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: true,
        NextContinuationToken: 'token-1',
      });
      s3Client.send.onCall(1).resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/05/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-05T00:00:00Z') }],
        IsTruncated: false,
      });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(s3Client.send).to.have.been.calledTwice;
      const [, event] = sqs.sendMessage.firstCall.args;
      expect(event.s3_key).to.equal(`${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/05/bp-w2-2026.xlsx`);
    });

    it('stops listing at the safety page cap', async () => {
      s3Client.send.resolves({ Contents: [], IsTruncated: true, NextContinuationToken: 'always' });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(s3Client.send).to.have.callCount(10);
      expect(sqs.sendMessage).to.not.have.been.called;
    });
  });
});
