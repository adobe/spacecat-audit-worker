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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { createHash } from 'crypto';
import esmock from 'esmock';

use(chaiAsPromised);
use(sinonChai);

describe('referral daily export', function referralDailyExportTests() {
  this.timeout(10000);
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  function createConfiguration(queueUrl = 'https://sqs.us-east-1.amazonaws.com/123/analytics-queue') {
    return {
      getQueues: () => ({ analytics: queueUrl }),
    };
  }

  function makeSite(overrides = {}) {
    return {
      getId: () => 'site-abc',
      getOrganizationId: () => 'org-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      ...overrides,
    };
  }

  function makeContext(overrides = {}) {
    return {
      env: { S3_IMPORTER_BUCKET_NAME: 'spacecat-importer-bucket' },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves(createConfiguration()),
        },
      },
      log: {
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      },
      sqs: { sendMessage: sandbox.stub().resolves() },
      ...overrides,
    };
  }

  async function loadModule(classifyStub, reportUtilsOverrides = {}, queryBuilderOverrides = {}) {
    return esmock('../../../src/cdn-logs-report/referral-daily-export.js', {
      '@adobe/spacecat-shared-rum-api-client/src/common/traffic.js': {
        classifyTrafficSource: classifyStub,
      },
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: sandbox.stub().resolves('CREATE DATABASE IF NOT EXISTS db'),
        ...reportUtilsOverrides,
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createReferralDailyReportQuery: sandbox.stub().resolves('SELECT * FROM daily_referral'),
          ...queryBuilderOverrides,
        },
      },
    });
  }

  it('uploads CSV and dispatches the analytics event', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);

    const athenaClient = {
      execute: sandbox.stub().resolves(),
      query: sandbox.stub().resolves([{
        path: '/products/ai',
        host: 'www.example.com',
        referrer: 'chatgpt.com',
        utm_source: null,
        utm_medium: null,
        tracking_param: null,
        device: 'desktop',
        date: '2026-03-31',
        region: 'US',
        pageviews: 5,
      }]),
    };
    const s3Client = { send: sandbox.stub().resolves({}) };
    const context = makeContext();
    const site = makeSite();

    const result = await module.runDailyReferralExport({
      athenaClient,
      s3Client,
      s3Config: { bucket: 'spacecat-dev-cdn-logs-aggregates-us-east-1', databaseName: 'cdn_db' },
      site,
      context,
      reportConfig: { tableName: 'aggregated_referral_logs_example_consolidated' },
      referenceDate: new Date('2026-04-01T10:00:00Z'),
    });

    const expectedDedupId = createHash('sha256')
      .update('site-abc:2026-03-31:referral_traffic_cdn')
      .digest('hex');

    expect(athenaClient.execute).to.have.been.calledOnce;
    expect(athenaClient.query).to.have.been.calledOnceWith(
      'SELECT * FROM daily_referral',
      'cdn_db',
      '[Athena Query] referral_daily_flat_data',
    );
    expect(s3Client.send).to.have.been.calledOnce;
    expect(s3Client.send.firstCall.args[0].input.Bucket).to.equal('spacecat-importer-bucket');
    expect(s3Client.send.firstCall.args[0].input.Key).to.equal(
      'referral-traffic-cdn-daily-export/csvs/site-abc/2026/03/31/data.csv',
    );
    expect(s3Client.send.firstCall.args[0].input.Body).to.include('traffic_date,host,url_path');
    expect(s3Client.send.firstCall.args[0].input.Body).to.include('2026-03-31,www.example.com,/products/ai');
    expect(context.sqs.sendMessage).to.have.been.calledOnceWith(
      'https://sqs.us-east-1.amazonaws.com/123/analytics-queue',
      sinon.match({
        type: 'batch.completed',
        correlationId: expectedDedupId,
        pipeline_id: 'referral_traffic_cdn',
        s3_uri: 's3://spacecat-importer-bucket/referral-traffic-cdn-daily-export/csvs/site-abc/2026/03/31/data.csv',
        site_id: 'site-abc',
        org_id: 'org-1',
        start_date: '2026-03-31',
        end_date: '2026-03-31',
        row_count: 1,
      }),
      'referral_traffic_cdn:site-abc',
      0,
      expectedDedupId,
    );
    expect(result).to.deep.include({
      enabled: true,
      success: true,
      skipped: false,
      siteId: 'site-abc',
      trafficDate: '2026-03-31',
      rowCount: 1,
      csvUri: 's3://spacecat-importer-bucket/referral-traffic-cdn-daily-export/csvs/site-abc/2026/03/31/data.csv',
    });
    expect(context.log.info).to.have.been.calledWith(
      '[cdn-logs-report] Daily referral export dispatched for site-abc (https://www.example.com) on 2026-03-31. Rows: 1',
    );
  });

  it('omits org_id when site has no organization', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'perplexity' });
    const module = await loadModule(classifyStub);
    const site = makeSite({ getOrganizationId: () => null });
    const context = makeContext();

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: null,
          referrer: 'perplexity.ai',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'mobile',
          date: '2026-03-31',
          region: 'GLOBAL',
          pageviews: 2,
        }]),
      },
      s3Client: { send: sandbox.stub().resolves({}) },
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site,
      context,
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const sentMessage = context.sqs.sendMessage.firstCall.args[1];
    expect(sentMessage).to.not.have.property('org_id');
  });

  it('skips upload and dispatch when there are no LLM rows', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'paid', category: 'search', vendor: 'google' });
    const module = await loadModule(classifyStub);

    const s3Client = { send: sandbox.stub().resolves({}) };
    const context = makeContext();

    const result = await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'google.com',
          utm_source: 'google',
          utm_medium: 'cpc',
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 10,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context,
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    expect(s3Client.send).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(result).to.deep.include({
      enabled: true,
      success: true,
      skipped: true,
      siteId: 'site-abc',
      trafficDate: '2026-03-31',
      rowCount: 0,
    });
    expect(context.log.info).to.have.been.calledWith(
      sinon.match('No LLM referral rows'),
    );
  });

  it('aggregates rows with the same grouping key', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);

    const sharedRow = {
      host: 'www.example.com',
      referrer: 'chatgpt.com',
      utm_source: null,
      utm_medium: null,
      tracking_param: null,
      device: 'desktop',
      date: '2026-03-31',
      region: 'US',
    };
    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([
          { ...sharedRow, path: '/page', pageviews: 3 },
          { ...sharedRow, path: '/page', pageviews: 7 },
        ]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    // Only one data row (merged), pageviews = 10
    const dataLines = csvBody.split('\r\n').slice(1);
    expect(dataLines).to.have.length(1);
    expect(dataLines[0]).to.include(',10,');
  });

  it('uses site hostname when Athena row has no host', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'claude' });
    const module = await loadModule(classifyStub);

    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: null,
          referrer: 'claude.ai',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    expect(csvBody).to.include('www.example.com');
  });

  it('strips query string from url_path before grouping', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);

    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page?utm_campaign=spring',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 4,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    expect(csvBody).to.include('/page,');
    expect(csvBody).to.not.include('?utm_campaign');
  });

  it('falls back to trafficDate when row has no date field', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);

    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    // traffic_date falls back to trafficDate '2026-03-31'
    expect(csvBody).to.include('2026-03-31');
  });

  it('throws when S3_IMPORTER_BUCKET_NAME is not set', async () => {
    const module = await loadModule(sandbox.stub());

    await expect(module.runDailyReferralExport({
      athenaClient: { execute: sandbox.stub().resolves(), query: sandbox.stub().resolves([]) },
      s3Client: { send: sandbox.stub().resolves({}) },
      s3Config: { databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext({ env: {} }),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    })).to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for referral daily export');
  });

  it('throws when analytics queue is not configured', async () => {
    const module = await loadModule(sandbox.stub());

    await expect(module.runDailyReferralExport({
      athenaClient: { execute: sandbox.stub().resolves(), query: sandbox.stub().resolves([]) },
      s3Client: { send: sandbox.stub().resolves({}) },
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext({
        dataAccess: {
          Configuration: { findLatest: sandbox.stub().resolves({ getQueues: () => ({}) }) },
        },
      }),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    })).to.be.rejectedWith('analytics queue is not configured');
  });

  it('propagates Athena failures without touching S3', async () => {
    const module = await loadModule(sandbox.stub());
    const s3Client = { send: sandbox.stub().resolves({}) };

    await expect(module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().rejects(new Error('Athena unavailable')),
        query: sandbox.stub().resolves([]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    })).to.be.rejectedWith('Athena unavailable');

    expect(s3Client.send).to.not.have.been.called;
  });

  it('cleans up uploaded CSV when SQS dispatch fails', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    await expect(module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext({ sqs: { sendMessage: sandbox.stub().rejects(new Error('SQS down')) } }),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    })).to.be.rejectedWith('SQS down');

    // S3 upload (call 1) + cleanup delete (call 2)
    expect(s3Client.send).to.have.callCount(2);
    expect(s3Client.send.lastCall.args[0].constructor.name).to.equal('DeleteObjectCommand');
  });

  it('cleans up uploaded CSV when S3 upload itself fails', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub() };
    s3Client.send.onCall(0).rejects(new Error('S3 upload failed'));
    s3Client.send.onCall(1).resolves({});

    await expect(module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    })).to.be.rejectedWith('S3 upload failed');

    expect(s3Client.send).to.have.callCount(2);
    expect(s3Client.send.lastCall.args[0].constructor.name).to.equal('DeleteObjectCommand');
  });

  it('logs a warning when cleanup after failure also fails', async () => {
    const module = await esmock('../../../src/cdn-logs-report/referral-daily-export.js');
    const log = { warn: sandbox.spy() };
    const s3Client = { send: sandbox.stub().rejects(new Error('delete failed')) };

    await module.testHelpers.cleanupCsvFromS3({
      s3Client,
      bucket: 'cdn-bucket',
      csvKey: 'referral-traffic-cdn-daily-export/csvs/site-abc/2026/03/31/data.csv',
      log,
    });

    expect(log.warn).to.have.been.calledOnceWith(
      sinon.match('Failed to clean up referral export CSV'),
    );
  });

  it('serializes null and undefined CSV field values as empty strings', async () => {
    const module = await esmock('../../../src/cdn-logs-report/referral-daily-export.js');

    expect(module.testHelpers.escapeCsvValue(null)).to.equal('');
    expect(module.testHelpers.escapeCsvValue(undefined)).to.equal('');
  });

  it('wraps CSV values containing commas or quotes in double-quotes', async () => {
    const module = await esmock('../../../src/cdn-logs-report/referral-daily-export.js');

    expect(module.testHelpers.escapeCsvValue('hello, world')).to.equal('"hello, world"');
    expect(module.testHelpers.escapeCsvValue('say "hi"')).to.equal('"say ""hi"""');
    expect(module.testHelpers.escapeCsvValue('line\r\nbreak')).to.equal('"line\r\nbreak"');
  });

  it('handles null/missing optional row fields gracefully', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: null });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: null,       // triggers row.path || ''
          host: 'www.example.com',
          referrer: null,   // triggers referrer || ''
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: null,     // triggers row.device || ''
          date: '2026-03-31',
          region: null,     // triggers row.region || 'GLOBAL'
          pageviews: null,  // triggers Number(null) || 0
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    // trf_platform falls back to '' when vendor is null
    expect(csvBody).to.include('spacecat:cdn');
  });

  it('includes actual referrer and UTM values in CSV output', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: 'chatgpt',
          utm_medium: 'referral',
          tracking_param: 'llm_ref',
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    expect(csvBody).to.include('chatgpt.com');
    expect(csvBody).to.include('chatgpt');
    expect(csvBody).to.include('referral');
    expect(csvBody).to.include('llm_ref');
    expect(csvBody).to.not.include('cdn_provider');
  });

  it('normalizes mixed-date rows to the same group key', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    const sharedFields = {
      host: 'www.example.com',
      referrer: 'chatgpt.com',
      utm_source: null,
      utm_medium: null,
      tracking_param: null,
      device: 'desktop',
      region: 'US',
    };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([
          { ...sharedFields, path: '/page', date: '2026-03-31', pageviews: 4 },
          { ...sharedFields, path: '/page', date: '', pageviews: 6 },
        ]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    const dataLines = csvBody.split('\r\n').slice(1);
    expect(dataLines).to.have.length(1);
    expect(dataLines[0]).to.include(',10,');
    expect(dataLines[0]).to.include('2026-03-31');
  });

  it('normalizes undefined and empty-string vendor to the same group key', async () => {
    const classifyStub = sandbox.stub();
    classifyStub.onCall(0).returns({ type: 'earned', category: 'llm', vendor: undefined });
    classifyStub.onCall(1).returns({ type: 'earned', category: 'llm', vendor: '' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    const sharedFields = {
      host: 'www.example.com',
      referrer: 'chatgpt.com',
      utm_source: null,
      utm_medium: null,
      tracking_param: null,
      device: 'desktop',
      date: '2026-03-31',
      region: 'US',
    };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([
          { ...sharedFields, path: '/page', pageviews: 3 },
          { ...sharedFields, path: '/page', pageviews: 5 },
        ]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    const csvBody = s3Client.send.firstCall.args[0].input.Body;
    const dataLines = csvBody.split('\r\n').slice(1);
    expect(dataLines).to.have.length(1);
    expect(dataLines[0]).to.include(',8,');
  });

  it('handles trailing slash in baseURL without producing a double-slash URL', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);
    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: '/page',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite({ getBaseURL: () => 'https://www.example.com/' }),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    expect(classifyStub).to.have.been.calledWith(
      sinon.match(/^https:\/\/www\.example\.com\/page$/),
      sinon.match.any,
      sinon.match.any,
      sinon.match.any,
      sinon.match.any,
    );
  });

  it('includes raw Athena row count in the zero-rows skip log', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'paid', category: 'search', vendor: 'google' });
    const module = await loadModule(classifyStub);
    const context = makeContext();

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([
          {
            path: '/page', host: 'www.example.com', referrer: 'google.com',
            utm_source: 'google', utm_medium: 'cpc', tracking_param: null,
            device: 'desktop', date: '2026-03-31', region: 'US', pageviews: 5,
          },
        ]),
      },
      s3Client: { send: sandbox.stub().resolves({}) },
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context,
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    expect(context.log.info).to.have.been.calledWith(
      sinon.match('Athena returned 1 rows, 0 matched classification'),
    );
  });

  it('handles path without leading slash in url construction', async () => {
    const classifyStub = sandbox.stub().returns({ type: 'earned', category: 'llm', vendor: 'chatgpt' });
    const module = await loadModule(classifyStub);

    const s3Client = { send: sandbox.stub().resolves({}) };

    await module.runDailyReferralExport({
      athenaClient: {
        execute: sandbox.stub().resolves(),
        query: sandbox.stub().resolves([{
          path: 'no-leading-slash',
          host: 'www.example.com',
          referrer: 'chatgpt.com',
          utm_source: null,
          utm_medium: null,
          tracking_param: null,
          device: 'desktop',
          date: '2026-03-31',
          region: 'US',
          pageviews: 1,
        }]),
      },
      s3Client,
      s3Config: { bucket: 'cdn-bucket', databaseName: 'cdn_db' },
      site: makeSite(),
      context: makeContext(),
      reportConfig: { tableName: 'referral_table' },
      referenceDate: new Date('2026-04-01T00:00:00Z'),
    });

    // classifyTrafficSource should have been called with a full URL
    expect(classifyStub).to.have.been.calledWith(
      sinon.match('https://www.example.com/no-leading-slash'),
      sinon.match.any,
      sinon.match.any,
      sinon.match.any,
      sinon.match.any,
    );
  });
});
