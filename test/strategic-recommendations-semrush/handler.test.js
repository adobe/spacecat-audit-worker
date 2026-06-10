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
import esmock from 'esmock';
import ExcelJS from 'exceljs';
import { MockContextBuilder } from '../shared.js';
import { SEMRUSH_COLUMNS } from '../../src/strategic-recommendations-semrush/constants.js';

use(sinonChai);

const RESULTS_BUCKET = 'drs-results-bucket';
const RESULT_LOCATION = `https://${RESULTS_BUCKET}.s3.us-east-1.amazonaws.com/results/job-1/result.json?X-Amz-Signature=abc`;
const DATA_FOLDER = 'customer-data';
const OUTPUT_LOCATION = `${DATA_FOLDER}/strategic-recommendations-template`;
const LIVE_JSON_URL = `https://main--project-elmo-ui-data--adobe.hlx.live/${OUTPUT_LOCATION}/strategic-recommendations.json`;

function validRow(overrides = {}) {
  return {
    tag: 'Hidden Win',
    strategy: 'Defend the lead',
    strategy_reasoning: 'evidence and action',
    topic_id: 't-1',
    topic: 'Online Image Editing',
    volume: 1000,
    adobe_mentions: 50,
    competitor_1: 'Canva',
    competitor_1_mentions: 40,
    category: 'Creative Cloud',
    prompt: 'best free online photo editor?',
    deleted: '',
    ...overrides,
  };
}

/**
 * Builds an ExcelJS workbook buffer with the 3 shared sheets + Notes, the Semrush
 * sheet seeded with the given rows.
 */
async function buildExistingWorkbookBuffer(semrushRows = []) {
  const wb = new ExcelJS.Workbook();
  const semrush = wb.addWorksheet('shared-Semrush');
  semrush.addRow(SEMRUSH_COLUMNS);
  semrushRows.forEach((r) => semrush.addRow(SEMRUSH_COLUMNS.map((c) => r[c] ?? null)));
  wb.addWorksheet('shared-Citation Attempt').addRow(['tag', 'strategy']);
  wb.addWorksheet('shared-Synthetic Personas').addRow(['tag', 'strategy']);
  wb.addWorksheet('Notes').addRow(['Signal Source Sheets']);
  return wb.xlsx.writeBuffer();
}

describe('Strategic Recommendations Semrush Handler', function describeHandler() {
  this.timeout(15000);
  let sandbox;
  let context;
  let handler;
  let mockPostMessageSafe;
  let createClientStub;
  let readFromSharePointStub;
  let uploadToSharePointStub;
  let sharepointClient;
  let fetchStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockPostMessageSafe = sandbox.stub().resolves({ success: true });
    sharepointClient = { id: 'sp-client' };
    createClientStub = sandbox.stub().resolves(sharepointClient);
    readFromSharePointStub = sandbox.stub();
    uploadToSharePointStub = sandbox.stub().resolves();

    // Default: existing workbook with one ignored row (so we exercise merge).
    readFromSharePointStub.callsFake(async () => buildExistingWorkbookBuffer([
      validRow({ deleted: 'ignored' }),
    ]));

    // Single injectable fetch used for: result download, publish POSTs, read-back GET.
    fetchStub = sandbox.stub();
    fetchStub.callsFake(async (url, opts = {}) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            siteId: 'site-123',
            generated_at: '2026-06-09T00:00:00Z',
            rows: [validRow()],
          }),
        };
      }
      if (url.startsWith('https://admin.hlx.page/')) {
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (url === LIVE_JSON_URL && opts.method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            generated_at: '2026-06-09T00:00:00Z',
            Semrush: { data: [validRow()] },
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    handler = await esmock('../../src/strategic-recommendations-semrush/handler.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: fetchStub },
      '../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createClientStub,
        readFromSharePoint: readFromSharePointStub,
        uploadToSharePoint: uploadToSharePointStub,
      },
      '../../src/utils/slack-utils.js': { postMessageSafe: mockPostMessageSafe },
    }, {
      // global mock: the transitively-imported publish.js uses the real sleep,
      // which would add multi-second delays — stub it out everywhere.
      '../../src/support/utils.js': { sleep: async () => {} },
    });

    context = new MockContextBuilder().withSandbox(sandbox).build();
    context.env.DRS_RESULTS_BUCKET = RESULTS_BUCKET;
    context.env.DRS_RESULTS_PREFIX = 'results/';
    context.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID = 'C-TEST';
    process.env.ADMIN_HLX_API_KEY = 'test-token';

    context.dataAccess.Site.findById.resolves({
      getConfig: () => ({ getLlmoDataFolder: () => DATA_FOLDER }),
    });
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.ADMIN_HLX_API_KEY;
  });

  const completedMessage = (overrides = {}) => ({
    siteId: 'site-123',
    auditContext: {
      drsEventType: 'JOB_COMPLETED',
      drsJobId: 'job-1',
      resultLocation: RESULT_LOCATION,
      ...overrides,
    },
  });

  it('publishes the merged workbook and returns ok on the happy path', async () => {
    const result = await handler.default(completedMessage(), context);

    expect(result.status).to.equal(200);
    expect(uploadToSharePointStub).to.have.been.calledOnce;
    // upload args: (buffer, filename, outputLocation, client, log)
    expect(uploadToSharePointStub.firstCall.args[1]).to.equal('strategic-recommendations.xlsx');
    expect(uploadToSharePointStub.firstCall.args[2]).to.equal(OUTPUT_LOCATION);
    // preview + live POST + read-back GET all went through fetch
    expect(fetchStub.getCalls().some((c) => c.args[0].includes('/preview/'))).to.equal(true);
    expect(fetchStub.getCalls().some((c) => c.args[0].includes('/live/'))).to.equal(true);
  });

  it('preserves the existing "ignored" marker via merge on the written sheet', async () => {
    await handler.default(completedMessage(), context);

    const buffer = uploadToSharePointStub.firstCall.args[0];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('shared-Semrush');
    const headers = sheet.getRow(1).values.slice(1);
    const deletedCol = headers.indexOf('deleted') + 1;
    expect(sheet.getRow(2).getCell(deletedCol).value).to.equal('ignored');
    // other shared sheets preserved
    expect(wb.getWorksheet('shared-Citation Attempt')).to.not.equal(undefined);
    expect(wb.getWorksheet('shared-Synthetic Personas')).to.not.equal(undefined);
    expect(wb.getWorksheet('Notes')).to.not.equal(undefined);
  });

  it('returns ok and alerts on JOB_FAILED without touching the sheet', async () => {
    const result = await handler.default(completedMessage({ drsEventType: 'JOB_FAILED' }), context);

    expect(result.status).to.equal(200);
    expect(uploadToSharePointStub).to.not.have.been.called;
    expect(mockPostMessageSafe).to.have.been.calledOnce;
  });

  it('returns ok and logs on unexpected event type', async () => {
    const result = await handler.default(completedMessage({ drsEventType: 'JOB_PENDING' }), context);
    expect(result.status).to.equal(200);
    expect(uploadToSharePointStub).to.not.have.been.called;
  });

  it('returns ok when siteId is missing', async () => {
    const result = await handler.default({ auditContext: { drsEventType: 'JOB_COMPLETED' } }, context);
    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.called;
  });

  it('SSRF guard rejects an out-of-prefix result location (does not ok, no fetch)', async () => {
    const msg = completedMessage({
      resultLocation: `https://${RESULTS_BUCKET}.s3.us-east-1.amazonaws.com/other/job-1/result.json`,
    });

    const result = await handler.default(msg, context);

    expect(result.status).to.equal(500);
    expect(fetchStub).to.not.have.been.called;
    expect(mockPostMessageSafe).to.have.been.calledOnce;
  });

  it('SSRF guard rejects a non-S3 hostname', async () => {
    const result = await handler.default(
      completedMessage({ resultLocation: 'https://evil.example.com/results/x.json' }),
      context,
    );
    expect(result.status).to.equal(500);
    expect(fetchStub).to.not.have.been.called;
  });

  it('SSRF guard rejects a foreign bucket', async () => {
    const result = await handler.default(
      completedMessage({ resultLocation: 'https://other-bucket.s3.amazonaws.com/results/x.json' }),
      context,
    );
    expect(result.status).to.equal(500);
    expect(fetchStub).to.not.have.been.called;
  });

  it('does NOT ok() when the publish POST returns non-200 (failure surfaced)', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'site-123', generated_at: 'g', rows: [validRow()] }),
        };
      }
      if (url.startsWith('https://admin.hlx.page/')) {
        return { ok: false, status: 503, statusText: 'Service Unavailable' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);

    expect(result.status).to.equal(500);
    expect(mockPostMessageSafe).to.have.been.calledOnce;
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('publish');
  });

  it('does NOT ok() when post-publish read-back row count mismatches (stale CDN)', async () => {
    fetchStub.callsFake(async (url, opts = {}) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'site-123', generated_at: 'g', rows: [validRow()] }),
        };
      }
      if (url.startsWith('https://admin.hlx.page/')) {
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (url === LIVE_JSON_URL && opts.method === 'GET') {
        // stale: zero rows instead of the 1 we wrote
        return { ok: true, json: async () => ({ Semrush: { data: [] } }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);

    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('read-back');
  });

  it('does NOT ok() when read-back generated_at mismatches', async () => {
    fetchStub.callsFake(async (url, opts = {}) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({
            siteId: 'site-123', generated_at: '2026-06-09T00:00:00Z', rows: [validRow()],
          }),
        };
      }
      if (url.startsWith('https://admin.hlx.page/')) {
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (url === LIVE_JSON_URL && opts.method === 'GET') {
        return {
          ok: true,
          json: async () => ({ generated_at: '1999-01-01T00:00:00Z', Semrush: { data: [validRow()] } }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
  });

  it('surfaces a cross-tenant mismatch (result.siteId != message.siteId)', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'OTHER-SITE', rows: [validRow()] }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);

    expect(result.status).to.equal(500);
    expect(uploadToSharePointStub).to.not.have.been.called;
  });

  it('surfaces schema-invalid rows and does not write', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          // missing required fields / bad tag
          text: async () => JSON.stringify({ siteId: 'site-123', rows: [{ tag: 'Nope', prompt: '' }] }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);

    expect(result.status).to.equal(500);
    expect(uploadToSharePointStub).to.not.have.been.called;
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('schema validation failed');
  });

  it('surfaces zero rows from the result', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'site-123', rows: [] }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(uploadToSharePointStub).to.not.have.been.called;
  });

  it('surfaces a result fetch failure (non-OK)', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: false, status: 403, statusText: 'Forbidden', headers: { get: () => null },
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
  });

  it('surfaces when the site has no LLMO data folder configured', async () => {
    context.dataAccess.Site.findById.resolves({
      getConfig: () => ({ getLlmoDataFolder: () => null }),
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(uploadToSharePointStub).to.not.have.been.called;
  });

  it('surfaces when the site is not found', async () => {
    context.dataAccess.Site.findById.resolves(null);

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
  });

  it('surfaces when no existing workbook is found (cannot preserve template)', async () => {
    readFromSharePointStub.rejects(new Error('itemNotFound: resource could not be found'));

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(uploadToSharePointStub).to.not.have.been.called;
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('no published workbook');
  });

  it('surfaces when reading the existing workbook fails for other reasons', async () => {
    readFromSharePointStub.rejects(new Error('boom network'));

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
  });

  it('surfaces a SharePoint upload failure', async () => {
    uploadToSharePointStub.rejects(new Error('upload boom'));

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('upload');
  });

  it('rejects when DRS_RESULTS_BUCKET is not configured (fail closed)', async () => {
    delete context.env.DRS_RESULTS_BUCKET;

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(fetchStub).to.not.have.been.called;
  });

  it('surfaces a result fetch timeout (AbortError)', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('timed out');
  });

  it('surfaces a generic result fetch error', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        throw new Error('connection reset');
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
  });

  it('surfaces a declared content-length exceeding the cap', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: (h) => (h === 'content-length' ? String(100 * 1024 * 1024) : null) },
          text: async () => '{}',
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('too large');
  });

  it('surfaces an actual body exceeding the cap', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => 'x'.repeat(26 * 1024 * 1024),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('too large');
  });

  it('surfaces a non-JSON result body', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return { ok: true, headers: { get: () => null }, text: async () => 'not-json' };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('not JSON');
  });

  it('creates the Semrush sheet when the existing workbook lacks one', async () => {
    readFromSharePointStub.callsFake(async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('shared-Citation Attempt').addRow(['tag']);
      wb.addWorksheet('Notes').addRow(['x']);
      return wb.xlsx.writeBuffer();
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(uploadToSharePointStub.firstCall.args[0]);
    expect(wb.getWorksheet('shared-Semrush')).to.not.equal(undefined);
  });

  it('does not alert when the Slack channel env var is unset', async () => {
    delete context.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID;
    const result = await handler.default(completedMessage({ drsEventType: 'JOB_FAILED' }), context);
    expect(result.status).to.equal(200);
    expect(mockPostMessageSafe).to.not.have.been.called;
  });

  it('alerts with N/A job id when drsJobId is absent on JOB_FAILED', async () => {
    const result = await handler.default(
      { siteId: 'site-123', auditContext: { drsEventType: 'JOB_FAILED' } },
      context,
    );
    expect(result.status).to.equal(200);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('N/A');
  });

  it('treats a result with no rows array as zero rows (surfaced)', async () => {
    fetchStub.callsFake(async (url) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'site-123' }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(500);
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('zero rows');
  });

  it('handles a result with no generated_at (read-back skips stamp check)', async () => {
    fetchStub.callsFake(async (url, opts = {}) => {
      if (url === RESULT_LOCATION) {
        return {
          ok: true,
          headers: { get: () => null },
          text: async () => JSON.stringify({ siteId: 'site-123', rows: [validRow()] }),
        };
      }
      if (url.startsWith('https://admin.hlx.page/')) {
        return { ok: true, status: 200, statusText: 'OK' };
      }
      if (url === LIVE_JSON_URL && opts.method === 'GET') {
        return { ok: true, json: async () => ({ Semrush: { data: [validRow()] } }) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await handler.default(completedMessage(), context);
    expect(result.status).to.equal(200);
  });
});
