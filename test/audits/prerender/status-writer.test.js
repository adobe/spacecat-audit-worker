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

/* eslint-env mocha */
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

import {
  readSiteStatusJson,
  uploadStatusSummaryToS3,
} from '../../../src/prerender/status-writer.js';

use(sinonChai);

describe('status-writer', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => sandbox.restore());

  // s3Client.send stub that dispatches GetObjectCommand (no Body in input) vs PutObjectCommand
  function makeS3Send({ existingStatus = null, putFails = false } = {}) {
    return sandbox.stub().callsFake(async (cmd) => {
      if ('Body' in cmd.input) {
        // PutObjectCommand
        if (putFails) throw new Error('S3 write failed');
        return {};
      }
      // GetObjectCommand
      if (!existingStatus) {
        const e = new Error('NoSuchKey');
        e.name = 'NoSuchKey';
        throw e;
      }
      return {
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingStatus)),
        },
      };
    });
  }

  function makeContext(opts = {}) {
    return {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      s3Client: { send: makeS3Send(opts) },
      env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
    };
  }

  function capturedPut(ctx) {
    const call = ctx.s3Client.send.getCalls().find((c) => 'Body' in c.args[0].input);
    return call ? JSON.parse(call.args[0].input.Body) : null;
  }

  // ─── readSiteStatusJson ────────────────────────────────────────────────────

  describe('readSiteStatusJson', () => {
    it('returns {} when S3_SCRAPER_BUCKET_NAME is not set', async () => {
      const ctx = makeContext();
      ctx.env = {};
      const result = await readSiteStatusJson('site-1', ctx);
      expect(result).to.deep.equal({});
      expect(ctx.s3Client.send).to.not.have.been.called;
    });

    it('returns {} when s3Client is null', async () => {
      const ctx = makeContext();
      ctx.s3Client = null;
      const result = await readSiteStatusJson('site-1', ctx);
      expect(result).to.deep.equal({});
    });

    it('returns parsed JSON on success', async () => {
      const data = { pages: [], scrapeJobId: 'job-1' };
      const ctx = makeContext({ existingStatus: data });
      const result = await readSiteStatusJson('site-1', ctx);
      expect(result).to.deep.equal(data);
    });

    it('returns {} on NoSuchKey without warning', async () => {
      const ctx = makeContext(); // no existingStatus → throws NoSuchKey
      const result = await readSiteStatusJson('site-1', ctx);
      expect(result).to.deep.equal({});
      expect(ctx.log.warn).to.not.have.been.called;
    });

    it('returns {} and warns on non-NoSuchKey S3 errors', async () => {
      const ctx = makeContext();
      ctx.s3Client.send = sandbox.stub().rejects(new Error('AccessDenied'));
      const result = await readSiteStatusJson('site-1', ctx);
      expect(result).to.deep.equal({});
      expect(ctx.log.warn).to.have.been.calledWithMatch(/Could not read status\.json/);
    });
  });

  // ─── uploadStatusSummaryToS3 ───────────────────────────────────────────────

  describe('uploadStatusSummaryToS3', () => {
    const AUDIT_URL = 'https://example.com';
    const SITE_ID = 'site-42';
    const SCRAPE_JOB_ID = 'job-abc';
    const AUDITED_AT = '2025-06-01T12:00:00.000Z';

    function makeAuditData(overrides = {}) {
      return {
        siteId: SITE_ID,
        auditedAt: AUDITED_AT,
        scrapeJobId: SCRAPE_JOB_ID,
        submittedUrlSet: null,
        auditResult: {
          results: [],
          scrapeForbidden: false,
        },
        ...overrides,
      };
    }

    it('logs warning and skips S3 write when auditResult is missing', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({ auditResult: null }), ctx);
      expect(ctx.log.warn).to.have.been.calledWithMatch(/Missing auditResult/);
      expect(ctx.s3Client.send).to.not.have.been.called;
    });

    it('writes to the correct S3 key, bucket, and content type', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData(), ctx);
      const put = ctx.s3Client.send.getCalls().find((c) => 'Body' in c.args[0].input);
      expect(put.args[0].input.Key).to.equal(`prerender/scrapes/${SITE_ID}/status.json`);
      expect(put.args[0].input.Bucket).to.equal('test-bucket');
      expect(put.args[0].input.ContentType).to.equal('application/json');
    });

    it('writes baseUrl, siteId, auditType, and lastUpdated at top level', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData(), ctx);
      const written = capturedPut(ctx);
      expect(written.baseUrl).to.equal(AUDIT_URL);
      expect(written.siteId).to.equal(SITE_ID);
      expect(written.auditType).to.equal('prerender');
      expect(written.lastUpdated).to.equal(AUDITED_AT);
    });

    it('uses current timestamp for lastUpdated when auditedAt is not provided', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({ auditedAt: undefined }), ctx);
      const written = capturedPut(ctx);
      expect(written.lastUpdated).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('computes aggregate metrics from current pages', async () => {
      const ctx = makeContext();
      const auditData = makeAuditData({
        auditResult: {
          results: [
            { url: 'https://example.com/a', needsPrerender: true },
            { url: 'https://example.com/b', needsPrerender: false },
            { url: 'https://example.com/c', error: true },
          ],
          scrapeForbidden: false,
        },
      });
      await uploadStatusSummaryToS3(AUDIT_URL, auditData, ctx);
      const written = capturedPut(ctx);
      expect(written.urlsNeedingPrerender).to.equal(1);
      expect(written.urlsScrapedSuccessfully).to.equal(2);
      expect(written.urlsSubmittedForScraping).to.equal(3);
      expect(written.scrapingErrorRate).to.be.closeTo(33.33, 0.1);
    });

    it('sets scrapingErrorRate to null when there are no pages', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData(), ctx);
      const written = capturedPut(ctx);
      expect(written.scrapingErrorRate).to.be.null;
      expect(written.urlsSubmittedForScraping).to.equal(0);
    });

    it('preserves pages from existing status absent in the current run', async () => {
      const existingStatus = {
        pages: [{ url: 'https://example.com/old', scrapingStatus: 'success', needsPrerender: false }],
      };
      const ctx = makeContext({ existingStatus });
      const auditData = makeAuditData({
        auditResult: {
          results: [{ url: 'https://example.com/new', needsPrerender: false }],
          scrapeForbidden: false,
        },
      });
      await uploadStatusSummaryToS3(AUDIT_URL, auditData, ctx);
      const urls = capturedPut(ctx).pages.map((p) => p.url);
      expect(urls).to.include('https://example.com/old');
      expect(urls).to.include('https://example.com/new');
    });

    it('overwrites existing page when the same URL appears in the current run', async () => {
      const existingStatus = {
        pages: [{ url: 'https://example.com/a', scrapingStatus: 'error', needsPrerender: false }],
      };
      const ctx = makeContext({ existingStatus });
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [{ url: 'https://example.com/a', needsPrerender: true }],
          scrapeForbidden: false,
        },
      }), ctx);
      const written = capturedPut(ctx);
      expect(written.pages).to.have.lengthOf(1);
      expect(written.pages[0].needsPrerender).to.be.true;
      expect(written.pages[0].scrapingStatus).to.equal('success');
    });

    it('includes missingPages and stamps scrapedAt and scrapeJobId defaults', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [],
          missingPages: [{ url: 'https://example.com/missing', scrapingStatus: 'failed' }],
          scrapeForbidden: false,
        },
      }), ctx);
      const written = capturedPut(ctx);
      expect(written.pages).to.have.lengthOf(1);
      expect(written.pages[0].url).to.equal('https://example.com/missing');
      expect(written.pages[0].scrapedAt).to.equal(AUDITED_AT);
      expect(written.pages[0].scrapeJobId).to.equal(SCRAPE_JOB_ID);
    });

    it('preserves explicit scrapedAt and scrapeJobId on missingPages', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [],
          missingPages: [{
            url: 'https://example.com/missing',
            scrapedAt: '2025-01-15T00:00:00.000Z',
            scrapeJobId: 'original-job',
          }],
          scrapeForbidden: false,
        },
      }), ctx);
      const written = capturedPut(ctx);
      expect(written.pages[0].scrapedAt).to.equal('2025-01-15T00:00:00.000Z');
      expect(written.pages[0].scrapeJobId).to.equal('original-job');
    });

    it('stamps current scrapeJobId on submitted pages and preserves existing for non-submitted', async () => {
      const existingStatus = {
        pages: [{ url: 'https://example.com/a', scrapeJobId: 'old-job', scrapingStatus: 'success' }],
      };
      const ctx = makeContext({ existingStatus });
      const submittedUrlSet = new Set(['https://example.com/b']);
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [
            { url: 'https://example.com/a' },
            { url: 'https://example.com/b' },
          ],
          scrapeForbidden: false,
        },
        submittedUrlSet,
      }), ctx);
      const written = capturedPut(ctx);
      const pageA = written.pages.find((p) => p.url === 'https://example.com/a');
      const pageB = written.pages.find((p) => p.url === 'https://example.com/b');
      expect(pageB.scrapeJobId).to.equal(SCRAPE_JOB_ID);
      expect(pageA.scrapeJobId).to.equal('old-job');
    });

    it('sets null scrapeJobId for non-submitted pages with no existing record', async () => {
      const ctx = makeContext(); // no existingStatus
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [{ url: 'https://example.com/a' }],
          scrapeForbidden: false,
        },
        submittedUrlSet: new Set([]),
      }), ctx);
      const written = capturedPut(ctx);
      expect(written.pages[0].scrapeJobId).to.be.null;
    });

    it('counts scrapeForbiddenCount only from pages with scrapeError.statusCode 403', async () => {
      const ctx = makeContext();
      const auditData = makeAuditData({
        auditResult: {
          results: [
            { url: 'https://example.com/a', scrapeError: { statusCode: 403 } },
            { url: 'https://example.com/b', scrapeError: { statusCode: 500 } },
            { url: 'https://example.com/c' },
          ],
          scrapeForbidden: false,
        },
      });
      await uploadStatusSummaryToS3(AUDIT_URL, auditData, ctx);
      expect(capturedPut(ctx).scrapeForbiddenCount).to.equal(1);
    });

    it('carries scrapeForbidden and scrapeForbiddenSince from auditResult', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: {
          results: [],
          scrapeForbidden: true,
          scrapeForbiddenSince: '2025-01-01T00:00:00.000Z',
        },
      }), ctx);
      const written = capturedPut(ctx);
      expect(written.scrapeForbidden).to.be.true;
      expect(written.scrapeForbiddenSince).to.equal('2025-01-01T00:00:00.000Z');
    });

    it('defaults scrapeForbidden to false when auditResult.scrapeForbidden is undefined', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: { results: [] },
      }), ctx);
      expect(capturedPut(ctx).scrapeForbidden).to.be.false;
    });

    it('falls back to existingStatus.scrapeForbiddenSince when auditResult omits it', async () => {
      const existingStatus = { pages: [], scrapeForbiddenSince: '2024-12-01T00:00:00.000Z' };
      const ctx = makeContext({ existingStatus });
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: { results: [], scrapeForbidden: false },
      }), ctx);
      expect(capturedPut(ctx).scrapeForbiddenSince).to.equal('2024-12-01T00:00:00.000Z');
    });

    it('sets lastAuditSuccess=false when auditResult.lastAuditSuccess is explicitly false', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: { results: [], scrapeForbidden: false, lastAuditSuccess: false },
      }), ctx);
      expect(capturedPut(ctx).lastAuditSuccess).to.be.false;
    });

    it('uses existing scrapeJobId at top level when auditData.scrapeJobId is null', async () => {
      const existingStatus = { pages: [], scrapeJobId: 'existing-job' };
      const ctx = makeContext({ existingStatus });
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({ scrapeJobId: null }), ctx);
      expect(capturedPut(ctx).scrapeJobId).to.equal('existing-job');
    });

    it('handles auditResult.results being null/undefined via ?? fallback', async () => {
      const ctx = makeContext();
      // results is absent — the ?? [] fallback must fire
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        auditResult: { scrapeForbidden: false },
      }), ctx);
      expect(capturedPut(ctx).pages).to.deep.equal([]);
    });

    it('sets null scrapeJobId for submitted pages when auditData.scrapeJobId is null', async () => {
      const ctx = makeContext();
      // wasSubmitted=true (submittedUrlSet is null) AND scrapeJobId is null
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        scrapeJobId: null,
        auditResult: {
          results: [{ url: 'https://example.com/a' }],
          scrapeForbidden: false,
        },
      }), ctx);
      expect(capturedPut(ctx).pages[0].scrapeJobId).to.be.null;
    });

    it('sets null scrapeJobId on missingPages when both page.scrapeJobId and auditData.scrapeJobId are null', async () => {
      const ctx = makeContext();
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({
        scrapeJobId: null,
        auditResult: {
          results: [],
          missingPages: [{ url: 'https://example.com/missing' }],
          scrapeForbidden: false,
        },
      }), ctx);
      expect(capturedPut(ctx).pages[0].scrapeJobId).to.be.null;
    });

    it('sets null top-level scrapeJobId when both auditData and existingStatus have none', async () => {
      const ctx = makeContext({ existingStatus: { pages: [] } }); // no scrapeJobId in existingStatus
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData({ scrapeJobId: null }), ctx);
      expect(capturedPut(ctx).scrapeJobId).to.be.null;
    });

    it('catches S3 write failures and logs error without throwing', async () => {
      const ctx = makeContext({ putFails: true });
      await uploadStatusSummaryToS3(AUDIT_URL, makeAuditData(), ctx);
      expect(ctx.log.error).to.have.been.calledWithMatch(/Failed to upload status summary/);
    });
  });
});
