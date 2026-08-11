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
        order: () => Promise.resolve(selectResult),
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
      Organization: {
        findById: sandbox.stub().resolves({ getImsOrgId: () => 'ims-org@AdobeOrg' }),
      },
      services: { postgrestClient },
    },
    site: {
      getId: () => SITE_ID,
      getOrganizationId: () => ORG_ID,
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
    selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: false }], error: null };
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
      const result = sanitizePathComponent('!!!@@@');
      expect(result).to.match(/^[a-f0-9]{16}$/);
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

    it('returns ok when the IMS org cannot be resolved', async () => {
      const ctx = buildContext();
      ctx.dataAccess.Organization.findById.resolves({ getImsOrgId: () => null });
      const res = await brandClaimsHandler(message, ctx);
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('IMS org');
    });

    it('returns ok when no active brand is found', async () => {
      selectResult = { data: [], error: null };
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('no active brand');
    });

    it('enables but skips run when the brand name sanitizes to empty', async () => {
      selectResult = { data: [{ id: BRAND_ID, name: '   ', brand_claims_enabled: false }], error: null };
      updateResult = { data: { id: BRAND_ID, name: '   ' }, error: null };
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('enabled for brand');
      expect(log.warn).to.have.been.calledWithMatch('empty S3 path component');
      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('enables but skips run when no sheet exists (listing has no Contents)', async () => {
      s3Client.send.resolves({ IsTruncated: false });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('no Brand Presence sheet');
      expect(sqs.sendMessage).to.not.have.been.called;
    });

    it('skips the run when the enable write matches no row (brand deleted mid-flight)', async () => {
      updateResult = { data: null, error: null };
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('enable did not take');
      expect(sqs.sendMessage).to.not.have.been.called;
    });
  });

  describe('error propagation (SQS retry)', () => {
    it('throws when the brand lookup query errors', async () => {
      selectResult = { data: null, error: { message: 'boom' } };
      await expect(brandClaimsHandler(message, buildContext()))
        .to.be.rejectedWith('Failed to resolve brand for site: boom');
    });

    it('throws when the enable update errors', async () => {
      updateResult = { data: null, error: { message: 'nope' } };
      await expect(brandClaimsHandler(message, buildContext()))
        .to.be.rejectedWith('Failed to update brand claims flag: nope');
    });
  });

  describe('multi-match handling', () => {
    it('picks the first brand deterministically and warns', async () => {
      selectResult = {
        data: [
          { id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: false },
          { id: 'other', name: 'Acme Two', brand_claims_enabled: false },
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

  describe('happy path — enable + run', () => {
    it('enables the gate and publishes the ready-signal for the latest sheet', async () => {
      const prefix = `${SITE_ID}/acmecorp/analytics/chatgpt_free`;
      s3Client.send.resolves({
        Contents: [
          // no LastModified -> lastModified 0, sets initial best (weekly)
          { Key: `${prefix}/2026/01/01/bp-w1-2026.xlsx` },
          // newer partition -> replaces best
          { Key: `${prefix}/2026/01/02/bp-w2-2026.xlsx`, LastModified: new Date('2026-01-02T00:00:00Z') },
          // same partition, newer LastModified, daily suffix -> replaces best (daily)
          { Key: `${prefix}/2026/01/02/bp-w2-2026-030405.xlsx`, LastModified: new Date('2026-01-02T06:00:00Z') },
          // same partition, older LastModified -> no replace
          { Key: `${prefix}/2026/01/02/bp-w2-2026-010101.xlsx`, LastModified: new Date('2026-01-02T01:00:00Z') },
          // filename does not match the sheet pattern -> skipped
          { Key: `${prefix}/2026/01/03/notes.txt`, LastModified: new Date('2026-01-03T00:00:00Z') },
          // filename matches but no date partition in key -> skipped
          { Key: `bp-w9-2026.xlsx`, LastModified: new Date('2026-01-04T00:00:00Z') },
        ],
        IsTruncated: false,
      });

      const ctx = buildContext();
      const res = await brandClaimsHandler(message, ctx);

      expect(res.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('enabled for brand');
      expect(sqs.sendMessage).to.have.been.calledOnce;

      const [queueUrl, event] = sqs.sendMessage.firstCall.args;
      expect(queueUrl).to.equal('https://sqs.test/bp-sheet-ready');
      expect(event).to.deep.equal({
        event_type: 'BRAND_PRESENCE_SHEET_WRITTEN',
        schema_version: 1,
        organization_id: 'ims-org@AdobeOrg',
        brand_id: BRAND_ID,
        brand: 'acmecorp',
        site_id: SITE_ID,
        week: 2,
        year: 2026,
        cadence: 'daily',
        sheet_date: '2026-01-02',
        platform: 'chatgpt_free',
        s3_bucket: 'drs-bp-bucket',
        s3_key: `${prefix}/2026/01/02/bp-w2-2026-030405.xlsx`,
        parent_job_id: null,
        batch_id: null,
      });
    });

    it('queries and writes the brands table with the expected filters and payload', async () => {
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

      const write = pgCalls[1];
      expect(write.table).to.equal('brands');
      expect(write.update).to.deep.equal({
        brand_claims_enabled: true,
        updated_by: 'audit-worker:brand-claims',
      });
      expect(write.eqs).to.deep.include(['id', BRAND_ID]);
      expect(write.neqs).to.deep.include(['status', 'deleted']);
    });

    it('skips the enable write when the gate is already on but still runs', async () => {
      selectResult = { data: [{ id: BRAND_ID, name: 'Acme Corp', brand_claims_enabled: true }], error: null };
      // maybeSingle would only be hit by an update; make it throw so a stray write fails loudly
      updateResult = { data: null, error: { message: 'should-not-update' } };
      s3Client.send.resolves({
        Contents: [{ Key: `${SITE_ID}/acmecorp/analytics/chatgpt_free/2026/01/01/bp-w1-2026.xlsx`, LastModified: new Date('2026-01-01T00:00:00Z') }],
        IsTruncated: false,
      });
      const res = await brandClaimsHandler(message, buildContext());
      expect(res.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('already enabled');
      expect(sqs.sendMessage).to.have.been.calledOnce;
    });

    it('resolves the site via Site.findById when not pre-fetched', async () => {
      const ctx = buildContext({ site: null });
      ctx.dataAccess.Site.findById.resolves({
        getId: () => SITE_ID,
        getOrganizationId: () => ORG_ID,
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
