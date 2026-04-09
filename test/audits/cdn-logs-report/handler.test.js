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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

// Mock data constants
const MOCK_AGENTIC_DATA = [
  {
    agent_type: 'Bot',
    user_agent_display: 'Googlebot/2.1',
    status: 200,
    number_of_hits: 100,
    avg_ttfb_ms: 250.5,
    country_code: 'US',
    url: '/test',
    product: 'adobe-analytics',
    category: 'Product Page',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 'GLOBAL',
    url: '/page',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 'AA',
    url: '/page',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: 'LLM',
    user_agent_display: 'ChatGPT-User/1.0',
    status: 200,
    number_of_hits: 50,
    avg_ttfb_ms: 180.2,
    country_code: 1,
    url: '-',
    product: 'experience-manager',
    category: 'Documentation',
  },
  {
    agent_type: null,
    user_agent_display: null,
    status: null,
    number_of_hits: null,
    avg_ttfb_ms: null,
    country_code: null,
    url: null,
    product: null,
    category: null,
  },
  {
    agent_type: null,
    user_agent_display: null,
    status: null,
    number_of_hits: null,
    avg_ttfb_ms: null,
    country_code: 999, // Invalid country code to trigger catch in validateCountryCode
    url: null,
    product: null,
    category: null,
  },
  {
    agent_type: 'Bot',
    user_agent_display: 'TestBot',
    status: 200,
    number_of_hits: 10,
    avg_ttfb_ms: 150,
    country_code: null, // null country code
    url: '/test',
    product: 'adobe-analytics',
    category: 'Test',
  },
  {
    agent_type: 'Bot',
    user_agent_display: 'TestBot',
    status: 200,
    number_of_hits: 10,
    avg_ttfb_ms: 150,
    country_code: 'INVALID',
    url: '/test',
    product: {},
    category: 'Test',
  },
];

const MOCK_REFERRAL_DATA = [
  {
    path: '/products/analytics',
    referrer: 'https://google.com/search',
    utm_source: 'google',
    utm_medium: 'organic',
    tracking_param: null,
    device: 'desktop',
    date: '2025-01-15',
    region: 'US',
    pageviews: 1250,
  },
  {
    path: 'documentation',
    referrer: 'https://ads.google.com',
    utm_source: 'google',
    utm_medium: 'cpc',
    tracking_param: 'google_ads_456',
    device: 'tablet',
    date: '2025-01-15',
    region: 'GB',
    pageviews: 420,
  },
];

describe('CDN Logs Report Handler', function test() {
  let sandbox;
  let context;
  let site;
  let handler;
  let saveExcelReportStub;
  let createLLMOSharepointClientStub;
  let bulkPublishToAdminHlxStub;

  this.timeout(10000);

  const createMockSharepointClient = (stubber) => ({
    getDocument: stubber.stub().returns({
      getDocumentContent: stubber.stub().resolves(Buffer.from('test content')),
      uploadRawDocument: stubber.stub().resolves(),
    }),
    uploadFile: stubber.stub().resolves({ success: true }),
  });

  const createAuditContext = (stubber, overrides = {}) => ({
    sharepointOptions: {
      helixContentSDK: {
        createFrom: stubber.stub().resolves(createMockSharepointClient(stubber)),
      },
    },
    ...overrides,
  });

  const createSiteConfig = (overrides = {}) => {
    const defaultConfig = {
      getLlmoDataFolder: () => 'test-folder',
      getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev' }),
      getLlmoCdnlogsFilter: () => [{
        value: ['www.example.com'],
        key: 'host',
      }],
      getLlmoCountryCodeIgnoreList: () => undefined,
    };
    return { ...defaultConfig, ...overrides };
  };

  const setupAthenaClientWithData = (
    stubber,
    agenticData = MOCK_AGENTIC_DATA,
    referralData = MOCK_REFERRAL_DATA,
  ) => ({
    execute: stubber.stub().resolves(),
    query: stubber.stub().callsFake((query, database, description) => {
      if (description.includes('agentic')) {
        return Promise.resolve(agenticData);
      } else if (description.includes('referral')) {
        return Promise.resolve(referralData);
      }
      return Promise.resolve([]);
    }),
  });

  before(async () => {
    saveExcelReportStub = sinon.stub().resolves();
    createLLMOSharepointClientStub = sinon.stub();
    bulkPublishToAdminHlxStub = sinon.stub().resolves();
    
    handler = await esmock('../../../src/cdn-logs-report/handler.js', {}, {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: createLLMOSharepointClientStub,
        saveExcelReport: saveExcelReportStub,
        bulkPublishToAdminHlx: bulkPublishToAdminHlxStub,
      },
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    nock.cleanAll();
    
    // Reset stubs before each test
    saveExcelReportStub.reset();
    createLLMOSharepointClientStub.reset();
    createLLMOSharepointClientStub.resolves(createMockSharepointClient(sandbox));
    bulkPublishToAdminHlxStub.reset();
    bulkPublishToAdminHlxStub.resolves();

    site = {
      getSiteId: () => 'test-site',
      getId: () => 'test-site',
      getBaseURL: () => 'https://example.com',
      getConfig: () => createSiteConfig(),
      getOrganizationId: sandbox.stub().returns('test-org-id'),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: {
          AWS_ENV: 'test',
          AWS_REGION: 'us-east-1',
          SHAREPOINT_CLIENT_ID: 'test-client-id',
          SHAREPOINT_CLIENT_SECRET: 'test-client-secret',
          SHAREPOINT_AUTHORITY: 'https://login.microsoftonline.com/test-tenant-id',
          SHAREPOINT_DOMAIN_ID: 'test-domain-id',
        },
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: {
          send: sandbox.stub().resolves({
            Contents: [{ Key: 'raw/fastly/2025/01/15/10/file1.log' }],
          }),
        },
        athenaClient: setupAthenaClientWithData(sandbox),
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org-id',
            }),
          },
        },
      })
      .build();

    // Mock the patterns.json endpoint to avoid pattern generation
    nock('https://main--project-elmo-ui-data--adobe.aem.live')
      .get('/test-folder/agentic-traffic/patterns/patterns.json')
      .reply(200, {
        pagetype: { data: [] },
        products: { data: [] },
      });
  });

  after(async () => {
    if (handler) {
      await esmock.purge(handler);
    }
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    sandbox.restore();
  });

  describe('Cdn logs report audit handler', () => {
    it('skips patterns regeneration when query-index already lists patterns.json', async () => {
      const fetchRemotePatternsStub = sandbox.stub().resolves(null);
      const queryIndexHasPatternsFileStub = sandbox.stub().resolves(true);
      const generatePatternsWorkbookStub = sandbox.stub().resolves(true);
      const runWeeklyReportStub = sandbox.stub().resolves({ success: true, uploadResult: null });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          loadSql: sandbox.stub().resolves('SELECT 1'),
          generateReportingPeriods: sandbox.stub().returns({
            weeks: [],
            periodIdentifier: 'w12-2026',
          }),
          fetchRemotePatterns: fetchRemotePatternsStub,
          queryIndexHasPatternsFile: queryIndexHasPatternsFileStub,
          getConfigCategories: sandbox.stub().resolves(['Category A']),
        },
        '../../../src/utils/cdn-utils.js': {
          pathHasData: sandbox.stub().resolves(true),
          getS3Config: sandbox.stub().returns({
            bucket: 'test-bucket',
            customerDomain: 'example_com',
            customerName: 'example',
            databaseName: 'cdn_logs_example_com',
            getAthenaTempLocation: () => 's3://temp',
          }),
          getCdnAwsRuntime: sandbox.stub().returns({
            s3Client: {},
            createAthenaClient: sandbox.stub().returns({
              execute: sandbox.stub().resolves(),
            }),
          }),
        },
        '../../../src/cdn-logs-report/utils/report-runner.js': {
          runWeeklyReport: runWeeklyReportStub,
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
        '../../../src/cdn-logs-report/constants/report-configs.js': {
          getConfigs: sandbox.stub().returns([{
            name: 'agentic',
            aggregatedLocation: 's3://bucket/aggregated/test-site/',
            tableName: 'aggregated_logs_example_com_consolidated',
            filePrefix: 'agentictraffic',
            folderSuffix: 'agentic-traffic',
            workbookCreator: 'Spacecat Agentic Flat Report',
            queryFunction: sandbox.stub(),
            sheetName: 'shared-all',
          }]),
        },
        '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
          generatePatternsWorkbook: generatePatternsWorkbookStub,
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { categoriesUpdated: false }),
      );

      expect(fetchRemotePatternsStub).to.have.been.calledOnce;
      expect(queryIndexHasPatternsFileStub).to.have.been.calledOnce;
      expect(generatePatternsWorkbookStub).to.not.have.been.called;
      expect(runWeeklyReportStub).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Skipping fresh patterns generation for test-folder'));
      expect(result.auditResult).to.have.length(1);
    });

    it('skips patterns regeneration when patterns.json fetch fails with a non-404 error', async () => {
      const fetchRemotePatternsStub = sandbox.stub().resolves({ error: true, status: 500, source: 'patterns' });
      const queryIndexHasPatternsFileStub = sandbox.stub().resolves(false);
      const generatePatternsWorkbookStub = sandbox.stub().resolves(true);
      const runWeeklyReportStub = sandbox.stub().resolves({ success: true, uploadResult: null });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          loadSql: sandbox.stub().resolves('SELECT 1'),
          generateReportingPeriods: sandbox.stub().returns({
            weeks: [],
            periodIdentifier: 'w12-2026',
          }),
          fetchRemotePatterns: fetchRemotePatternsStub,
          queryIndexHasPatternsFile: queryIndexHasPatternsFileStub,
          getConfigCategories: sandbox.stub().resolves(['Category A']),
        },
        '../../../src/utils/cdn-utils.js': {
          pathHasData: sandbox.stub().resolves(true),
          getS3Config: sandbox.stub().returns({
            bucket: 'test-bucket',
            customerDomain: 'example_com',
            customerName: 'example',
            databaseName: 'cdn_logs_example_com',
            getAthenaTempLocation: () => 's3://temp',
          }),
          getCdnAwsRuntime: sandbox.stub().returns({
            s3Client: {},
            createAthenaClient: sandbox.stub().returns({
              execute: sandbox.stub().resolves(),
            }),
          }),
        },
        '../../../src/cdn-logs-report/utils/report-runner.js': {
          runWeeklyReport: runWeeklyReportStub,
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
        '../../../src/cdn-logs-report/constants/report-configs.js': {
          getConfigs: sandbox.stub().returns([{
            name: 'agentic',
            aggregatedLocation: 's3://bucket/aggregated/test-site/',
            tableName: 'aggregated_logs_example_com_consolidated',
            filePrefix: 'agentictraffic',
            folderSuffix: 'agentic-traffic',
            workbookCreator: 'Spacecat Agentic Flat Report',
            queryFunction: sandbox.stub(),
            sheetName: 'shared-all',
          }]),
        },
        '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
          generatePatternsWorkbook: generatePatternsWorkbookStub,
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { categoriesUpdated: false }),
      );

      expect(fetchRemotePatternsStub).to.have.been.calledOnce;
      expect(queryIndexHasPatternsFileStub).to.not.have.been.called;
      expect(generatePatternsWorkbookStub).to.not.have.been.called;
      expect(runWeeklyReportStub).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Skipping fresh patterns generation for test-folder'));
      expect(result.auditResult).to.have.length(1);
    });

    it('skips patterns regeneration when query-index fetch fails with a non-404 error', async () => {
      const fetchRemotePatternsStub = sandbox.stub().resolves(null);
      const queryIndexHasPatternsFileStub = sandbox.stub().resolves({ error: true, status: 500, source: 'query-index' });
      const generatePatternsWorkbookStub = sandbox.stub().resolves(true);
      const runWeeklyReportStub = sandbox.stub().resolves({ success: true, uploadResult: null });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          loadSql: sandbox.stub().resolves('SELECT 1'),
          generateReportingPeriods: sandbox.stub().returns({
            weeks: [],
            periodIdentifier: 'w12-2026',
          }),
          fetchRemotePatterns: fetchRemotePatternsStub,
          queryIndexHasPatternsFile: queryIndexHasPatternsFileStub,
          getConfigCategories: sandbox.stub().resolves(['Category A']),
        },
        '../../../src/utils/cdn-utils.js': {
          pathHasData: sandbox.stub().resolves(true),
          getS3Config: sandbox.stub().returns({
            bucket: 'test-bucket',
            customerDomain: 'example_com',
            customerName: 'example',
            databaseName: 'cdn_logs_example_com',
            getAthenaTempLocation: () => 's3://temp',
          }),
          getCdnAwsRuntime: sandbox.stub().returns({
            s3Client: {},
            createAthenaClient: sandbox.stub().returns({
              execute: sandbox.stub().resolves(),
            }),
          }),
        },
        '../../../src/cdn-logs-report/utils/report-runner.js': {
          runWeeklyReport: runWeeklyReportStub,
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
        '../../../src/cdn-logs-report/constants/report-configs.js': {
          getConfigs: sandbox.stub().returns([{
            name: 'agentic',
            aggregatedLocation: 's3://bucket/aggregated/test-site/',
            tableName: 'aggregated_logs_example_com_consolidated',
            filePrefix: 'agentictraffic',
            folderSuffix: 'agentic-traffic',
            workbookCreator: 'Spacecat Agentic Flat Report',
            queryFunction: sandbox.stub(),
            sheetName: 'shared-all',
          }]),
        },
        '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
          generatePatternsWorkbook: generatePatternsWorkbookStub,
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: -1, categoriesUpdated: false }),
      );

      expect(fetchRemotePatternsStub).to.have.been.calledOnce;
      expect(queryIndexHasPatternsFileStub).to.have.been.calledOnce;
      expect(generatePatternsWorkbookStub).to.not.have.been.called;
      expect(runWeeklyReportStub).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Skipping fresh patterns generation for test-folder'));
      expect(result.auditResult).to.have.length(1);
    });

    it('successfully processes CDN logs report', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date']
      });
      const auditContext = createAuditContext(sandbox);
      const result = await handler.runner('https://example.com', context, site, auditContext);

      // Verify audit result structure
      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

      // Verify each report config result
      result.auditResult.forEach((reportResult) => {
        expect(reportResult).to.have.property('name').that.is.a('string');
        expect(reportResult).to.have.property('table').that.is.a('string');
        expect(reportResult).to.have.property('database').that.includes('cdn_logs_');
        expect(reportResult).to.have.property('customer').that.is.a('string');
      });

      clock.restore();
      // Verify logging calls
      expect(context.log.debug).to.have.been.calledWith('Starting CDN logs report audit for https://example.com');

      // Verify Athena interactions
      expect(context.athenaClient.execute).to.have.been.callCount(1);
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('handles different weekOffset values', async () => {
      const weekOffset = -2;
      const auditContext = createAuditContext(sandbox, { weekOffset });
      const result = await handler.runner('https://example.com', context, site, auditContext);

      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

      expect(context.athenaClient.query).to.have.been.callCount(2);

      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(`week offset: ${weekOffset}`),
      );
    });

    it('uses site cdn config region aggregate location when region is configured', async () => {
      context.env.AWS_REGION = 'eu-west-1';
      site.getConfig = () => createSiteConfig({
        getLlmoCdnBucketConfig: () => ({ bucketName: 'cdn-logs-adobe-dev', region: 'eu-west-1' }),
      });
      const auditContext = createAuditContext(sandbox, { weekOffset: 0 });

      await handler.runner('https://example.com', context, site, auditContext);

      const listObjectsCalls = context.s3Client.send.getCalls()
        .filter((call) => call.args[0]?.constructor?.name === 'ListObjectsV2Command');
      expect(listObjectsCalls.length).to.be.greaterThan(0);
      expect(listObjectsCalls[0].args[0].input.Bucket)
        .to.equal('spacecat-test-cdn-logs-aggregates-eu-west-1');
    });

    it('runs -1 and 0 on Monday when no weekOffset provided', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-06'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox);
      await handler.runner('https://example.com', context, site, auditContext);
      
      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(4);
    });

    it('runs only week 0 on non-Monday when no weekOffset provided', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox);
      await handler.runner('https://example.com', context, site, auditContext);

      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('uses provided weekOffset regardless of day', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-06'),
        toFake: ['Date']
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox, { weekOffset: -3 });
      await handler.runner('https://example.com', context, site, auditContext);

      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('handles bulk publish errors gracefully', async () => {
      bulkPublishToAdminHlxStub.rejects(new Error('Bulk publish failed'));
      const auditContext = createAuditContext(sandbox);
      const result = await handler.runner('https://example.com', context, site, auditContext);

      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);
      
      expect(context.log.error).to.have.been.calledWith('Failed to bulk publish reports:', sinon.match.instanceOf(Error));
    });

    it('skips daily export when the agentic report config is missing', async () => {
      const runWeeklyReportStub = sandbox.stub().resolves({ success: true, uploadResult: null });
      const runDailyAgenticExportStub = sandbox.stub().resolves();
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/agentic-daily-export.js': {
          runDailyAgenticExport: runDailyAgenticExportStub,
        },
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          loadSql: sandbox.stub().resolves('SELECT 1'),
          generateReportingPeriods: sandbox.stub().returns({
            weeks: [],
            periodIdentifier: 'w12-2026',
          }),
          fetchRemotePatterns: sandbox.stub().resolves(null),
          queryIndexHasPatternsFile: sandbox.stub().resolves(false),
          getConfigCategories: sandbox.stub().resolves(['Category A']),
        },
        '../../../src/utils/cdn-utils.js': {
          pathHasData: sandbox.stub().resolves(true),
          getS3Config: sandbox.stub().returns({
            bucket: 'test-bucket',
            customerDomain: 'example_com',
            customerName: 'example',
            databaseName: 'cdn_logs_example_com',
            getAthenaTempLocation: () => 's3://temp',
          }),
          getCdnAwsRuntime: sandbox.stub().returns({
            s3Client: {},
            createAthenaClient: sandbox.stub().returns({
              execute: sandbox.stub().resolves(),
            }),
          }),
        },
        '../../../src/cdn-logs-report/utils/report-runner.js': {
          runWeeklyReport: runWeeklyReportStub,
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
        '../../../src/cdn-logs-report/constants/report-configs.js': {
          getConfigs: sandbox.stub().returns([{
            name: 'referral',
            aggregatedLocation: 's3://bucket/aggregated/test-site/',
            tableName: 'aggregated_logs_example_com_referral',
            filePrefix: 'referraltraffic',
            folderSuffix: 'referral-traffic',
            workbookCreator: 'Referral Report',
            queryFunction: sandbox.stub(),
            sheetName: 'shared-all',
          }]),
        },
        '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
          generatePatternsWorkbook: sandbox.stub().resolves(true),
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { categoriesUpdated: false }),
      );

      expect(runDailyAgenticExportStub).to.not.have.been.called;
      expect(result.dailyAgenticExport).to.equal(undefined);
      expect(runWeeklyReportStub).to.have.been.calledOnce;
    });

    it('captures daily agentic export failures without failing the whole handler', async () => {
      const runDailyAgenticExportStub = sandbox.stub().rejects(new Error('daily export boom'));
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/agentic-daily-export.js': {
          runDailyAgenticExport: runDailyAgenticExportStub,
        },
      }, {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          saveExcelReport: saveExcelReportStub,
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox),
      );

      expect(runDailyAgenticExportStub).to.have.been.calledOnce;
      expect(context.log.error).to.have.been.calledWith(
        'Failed daily agentic export for site test-site: daily export boom',
        sinon.match.instanceOf(Error),
      );
      expect(result.dailyAgenticExport).to.deep.equal({
        enabled: true,
        success: false,
        siteId: 'test-site',
        error: 'daily export boom',
      });
      expect(result.auditResult).to.be.an('array').that.is.not.empty;
    });

    it('includes successful daily agentic export results for enabled sites', async () => {
      const runDailyAgenticExportStub = sandbox.stub().resolves({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        rowCount: 12,
      });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/agentic-daily-export.js': {
          runDailyAgenticExport: runDailyAgenticExportStub,
        },
      }, {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          saveExcelReport: saveExcelReportStub,
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
      });

      const enabledSite = {
        ...site,
        getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        getSiteId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      };

      const result = await localHandler.runner(
        'https://example.com',
        context,
        enabledSite,
        createAuditContext(sandbox),
      );

      expect(runDailyAgenticExportStub).to.have.been.calledOnce;
      expect(result.dailyAgenticExport).to.deep.equal({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        rowCount: 12,
      });
    });

    it('skips sharepoint and weekly reports when auditContext.date is provided', async () => {
      const runDailyAgenticExportStub = sandbox.stub().resolves({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
      });
      const createSharepointStub = sandbox.stub().resolves(createMockSharepointClient(sandbox));
      const bulkPublishStub = sandbox.stub().resolves();
      const runWeeklyReportStub = sandbox.stub().resolves({ success: true, uploadResult: null });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/agentic-daily-export.js': {
          runDailyAgenticExport: runDailyAgenticExportStub,
        },
        '../../../src/cdn-logs-report/utils/report-runner.js': {
          runWeeklyReport: runWeeklyReportStub,
        },
      }, {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: createSharepointStub,
          saveExcelReport: saveExcelReportStub,
          bulkPublishToAdminHlx: bulkPublishStub,
        },
      });

      const enabledSite = {
        ...site,
        getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        getSiteId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      };

      const result = await localHandler.runner(
        'https://example.com',
        context,
        enabledSite,
        createAuditContext(sandbox, { date: '2026-04-01T10:00:00Z' }),
      );

      expect(createSharepointStub).to.not.have.been.called;
      expect(runWeeklyReportStub).to.not.have.been.called;
      expect(bulkPublishStub).to.not.have.been.called;
      expect(runDailyAgenticExportStub).to.have.been.calledOnce;
      expect(runDailyAgenticExportStub.firstCall.args[0].referenceDate.toISOString())
        .to.equal('2026-04-01T10:00:00.000Z');
      expect(result.auditResult).to.deep.equal([]);
      expect(result.dailyAgenticExport).to.deep.equal({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
      });
    });

    it('skips daily export when auditContext.weekOffset is provided', async () => {
      const runDailyAgenticExportStub = sandbox.stub().resolves({
        enabled: true,
        success: true,
      });
      const localHandler = await esmock('../../../src/cdn-logs-report/handler.js', {
        '../../../src/cdn-logs-report/agentic-daily-export.js': {
          runDailyAgenticExport: runDailyAgenticExportStub,
        },
      }, {
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: sandbox.stub().resolves(createMockSharepointClient(sandbox)),
          saveExcelReport: saveExcelReportStub,
          bulkPublishToAdminHlx: sandbox.stub().resolves(),
        },
      });

      const result = await localHandler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: -2 }),
      );

      expect(runDailyAgenticExportStub).to.not.have.been.called;
      expect(result.dailyAgenticExport).to.equal(undefined);
      expect(result.auditResult).to.not.be.empty;
    });

    describe('LLMO pattern fetch scenarios', () => {
      it('handles successful pattern fetch', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(200, {
            pagetype: { data: [{ pattern: 'product-page' }] },
            products: { data: [{ product: 'adobe-analytics' }] },
          });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        // Verify successful execution
        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);

        // Verify pattern fetch was called
        expect(patternNock.isDone()).to.be.true;

        // Verify queries were executed with pattern data
        expect(context.athenaClient.query).to.have.been.called;
      });

      it('handles missing pagetype data', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(200, {
            products: { data: [{ product: 'adobe-analytics' }] },
          });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(patternNock.isDone()).to.be.true;
      });

      it('handles fetch errors gracefully', async () => {
        const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
          .get('/test-folder/agentic-traffic/patterns/patterns.json')
          .reply(500, 'Server Error');

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(patternNock.isDone()).to.be.true;

        expect(context.athenaClient.query).to.have.been.called;
      });
    });

    describe('data processing edge cases', () => {
      it('logs skipping message when no S3 data found', async () => {
        context.s3Client = {
          send: sandbox.stub().resolves({ Contents: [] }),
        };

        context.athenaClient = setupAthenaClientWithData(sandbox, null, null);
        const auditContext = createAuditContext(sandbox);

        await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.info).to.have.been.calledWith('No data found for agentic report - skipping');
        expect(context.log.info).to.have.been.calledWith('No data found for referral report - skipping');
      });

      it('logs warning when Athena query returns empty data', async () => {
        context.athenaClient = setupAthenaClientWithData(sandbox, [], null);
        const auditContext = createAuditContext(sandbox);

        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/No data returned from Athena query for .* report \(.*\)\./)
        );
      });

      it('handles Athena query errors gracefully', async () => {
        const queryError = new Error('Athena query failed: Table not found');
        context.athenaClient = {
          execute: sandbox.stub().resolves(),
          query: sandbox.stub().rejects(queryError),
        };
        const auditContext = createAuditContext(sandbox);

        await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/.* report generation failed: Athena query failed/)
        );
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to generate .* report for site .*: Athena query failed/)
        );
      });
    });

    describe('site filter configurations', () => {
      it('handles exclude filters and no dataFolder scenarios', async () => {
        site.getConfig = () => createSiteConfig({
          getLlmoDataFolder: () => null,
          getLlmoCdnlogsFilter: () => [{
            value: ['bot', 'crawler'],
            key: 'user_agent',
            type: 'exclude',
          }, {
            value: ['www.example.com'],
            key: 'host',
          }],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(result).to.have.property('fullAuditRef').that.equals('null');

        expect(context.athenaClient.query).to.have.been.called;
      });

      it('handles empty filters array', async () => {
        site.getConfig = () => createSiteConfig({
          getLlmoCdnlogsFilter: () => [],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(result).to.have.property('fullAuditRef').that.equals('test-folder');

        expect(context.athenaClient.query).to.have.been.called;
      });
    });
  });
});
