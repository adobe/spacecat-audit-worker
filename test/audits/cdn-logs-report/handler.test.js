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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

import * as reportUtilsReal from '../../../src/cdn-logs-report/utils/report-utils.js';
import * as cdnUtilsReal from '../../../src/utils/cdn-utils.js';
import * as reportRunnerReal from '../../../src/cdn-logs-report/utils/report-runner.js';
import * as reportConfigsReal from '../../../src/cdn-logs-report/constants/report-configs.js';
import * as patternsUploaderReal from '../../../src/cdn-logs-report/patterns/patterns-uploader.js';
import * as agenticRulesReal from '../../../src/common/agentic-url-classification-rules.js';
import * as agenticDailyExportReal from '../../../src/cdn-logs-report/agentic-daily-export.js';

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
  // Shared mock holder. The esmock'd handler routes module imports through
  // these properties at call time, so each test can reassign without needing
  // to reload the handler module graph (which is expensive after AWS SDK and
  // @adobe/spacecat-shared-* are pulled in).
  const mocks = {};

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

  const createPostgrestClient = ({
    categoryRules = [{ name: 'adobe-analytics', regex: '/test', sort_order: 0 }],
    pageTypeRules = [{ name: 'Documentation', regex: '/page', sort_order: 0 }],
    rpcResult = { category_rules: 1, page_type_rules: 1 },
  } = {}) => ({
    from: (table) => {
      const data = table === 'agentic_url_category_rules' ? categoryRules : pageTypeRules;
      const query = {
        select: sandbox.stub().returnsThis(),
        eq: sandbox.stub().returnsThis(),
        order: sandbox.stub().returnsThis(),
        then: (resolve) => Promise.resolve({ data, error: null }).then(resolve),
      };
      return query;
    },
    rpc: sandbox.stub().resolves({ data: rpcResult, error: null }),
  });

  before(async () => {
    // Load the handler dep graph once. Every overridable function is routed
    // through the mutable `mocks` object so per-test behavior can be swapped
    // in `beforeEach`/inside individual tests without reloading the module.
    //
    // IMPORTANT: handler.js's direct dependencies go in `childMocks` (esmock's
    // 2nd arg). esmock's `globalMocks` (3rd arg) carries a per-mock overhead
    // that turns a 4s load into 20s+ once there are several entries, so we
    // only put modules there that the handler imports transitively (and that
    // tests need to control).
    const childMocks = {
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: (...a) => mocks.createLLMOSharepointClient(...a),
        bulkPublishToAdminHlx: (...a) => mocks.bulkPublishToAdminHlx(...a),
      },
      '../../../src/cdn-logs-report/referral-daily-export.js': {
        runDailyReferralExport: (...a) => mocks.runDailyReferralExport(...a),
      },
      '../../../src/cdn-logs-report/utils/report-runner.js': {
        runWeeklyReport: (...a) => mocks.runWeeklyReport(...a),
      },
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        loadSql: (...a) => mocks.loadSql(...a),
        generateReportingPeriods: (...a) => mocks.generateReportingPeriods(...a),
        getConfigCategories: (...a) => mocks.getConfigCategories(...a),
      },
      '../../../src/common/agentic-url-classification-rules.js': {
        fetchAgenticUrlClassificationRules: (...a) => mocks.fetchAgenticUrlClassificationRules(...a),
      },
      '../../../src/utils/cdn-utils.js': {
        ...cdnUtilsReal,
        pathHasData: (...a) => mocks.pathHasData(...a),
        getS3Config: (...a) => mocks.getS3Config(...a),
        getCdnAwsRuntime: (...a) => mocks.getCdnAwsRuntime(...a),
      },
      '../../../src/cdn-logs-report/constants/report-configs.js': {
        getConfigs: (...a) => mocks.getConfigs(...a),
      },
      '../../../src/cdn-logs-report/patterns/patterns-uploader.js': {
        generatePatternsWorkbook: (...a) => mocks.generatePatternsWorkbook(...a),
      },
    };
    // `runDailyAgenticExport` lives behind `utils/agentic-db-export.js`, which
    // we want to keep real so its orchestration logic (SQS fanout, etc.) is
    // exercised. The only way to intercept that transitive call is via the
    // global mocks slot.
    const globalMocks = {
      '../../../src/cdn-logs-report/agentic-daily-export.js': {
        runDailyAgenticExport: (...a) => mocks.runDailyAgenticExport(...a),
      },
    };
    handler = await esmock(
      '../../../src/cdn-logs-report/handler.js',
      childMocks,
      globalMocks,
    );
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Defaults delegate to the real implementations so tests that don't
    // explicitly override a mock get identical behavior to the unmocked
    // module. Tests that need custom behavior reassign mocks.X to a fresh
    // stub before invoking the handler.
    mocks.createLLMOSharepointClient = sandbox.stub()
      .callsFake(() => Promise.resolve(createMockSharepointClient(sandbox)));
    mocks.bulkPublishToAdminHlx = sandbox.stub().resolves();
    mocks.runDailyReferralExport = sandbox.stub().resolves({ enabled: true, success: true });
    mocks.runDailyAgenticExport = sandbox.stub().callsFake(agenticDailyExportReal.runDailyAgenticExport);
    mocks.runWeeklyReport = sandbox.stub().callsFake(reportRunnerReal.runWeeklyReport);
    mocks.loadSql = sandbox.stub().callsFake(reportUtilsReal.loadSql);
    mocks.generateReportingPeriods = sandbox.stub()
      .callsFake(reportUtilsReal.generateReportingPeriods);
    mocks.getConfigCategories = sandbox.stub().callsFake(reportUtilsReal.getConfigCategories);
    mocks.fetchAgenticUrlClassificationRules = sandbox.stub()
      .callsFake(agenticRulesReal.fetchAgenticUrlClassificationRules);
    mocks.pathHasData = sandbox.stub().callsFake(cdnUtilsReal.pathHasData);
    mocks.getS3Config = sandbox.stub().callsFake(cdnUtilsReal.getS3Config);
    mocks.getCdnAwsRuntime = sandbox.stub().callsFake(cdnUtilsReal.getCdnAwsRuntime);
    mocks.getConfigs = sandbox.stub().callsFake(reportConfigsReal.getConfigs);
    mocks.generatePatternsWorkbook = sandbox.stub()
      .callsFake(patternsUploaderReal.generatePatternsWorkbook);

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
          services: {
            postgrestClient: createPostgrestClient(),
          },
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'test-ims-org-id',
            }),
          },
        },
      })
      .build();
  });

  after(async () => {
    if (handler) {
      await esmock.purge(handler);
    }
  });

  afterEach(() => {
    sandbox.restore();
  });

  // Helpers used by tests that previously created a localHandler with a
  // fully-stubbed dep graph. Reassigning the relevant mocks gives the same
  // isolation without paying the esmock module-load cost again.
  const installDefaultAgenticGetConfigs = () => {
    mocks.getConfigs = sandbox.stub().returns([{
      name: 'agentic',
      aggregatedLocation: 's3://bucket/aggregated/test-site/',
      tableName: 'aggregated_logs_example_com_consolidated',
      filePrefix: 'agentictraffic',
      folderSuffix: 'agentic-traffic',
      workbookCreator: 'Spacecat Agentic Flat Report',
      queryFunction: sandbox.stub(),
      sheetName: 'shared-all',
    }]);
  };
  const installStubbedReportUtils = ({
    periodIdentifier = 'w12-2026',
    weeks = [],
    categories = ['Category A'],
  } = {}) => {
    mocks.loadSql = sandbox.stub().resolves('SELECT 1');
    mocks.generateReportingPeriods = sandbox.stub().returns({ weeks, periodIdentifier });
    mocks.getConfigCategories = sandbox.stub().resolves(categories);
  };
  const installStubbedCdnUtils = () => {
    mocks.pathHasData = sandbox.stub().resolves(true);
    mocks.getS3Config = sandbox.stub().returns({
      bucket: 'test-bucket',
      siteKey: 'example_com',
      siteName: 'example',
      databaseName: 'cdn_logs_example_com',
      getAthenaTempLocation: () => 's3://temp',
    });
    mocks.getCdnAwsRuntime = sandbox.stub().returns({
      s3Client: {},
      createAthenaClient: sandbox.stub().returns({
        execute: sandbox.stub().resolves(),
      }),
    });
  };

  describe('Cdn logs report audit handler', () => {
    it('skips patterns regeneration when DB already has rules', async () => {
      const fetchRulesStub = sandbox.stub().resolves({
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
      });
      mocks.fetchAgenticUrlClassificationRules = fetchRulesStub;
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      installStubbedReportUtils();
      installStubbedCdnUtils();
      installDefaultAgenticGetConfigs();

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: 0 }),
      );

      expect(fetchRulesStub).to.have.been.calledOnce;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(mocks.runWeeklyReport).to.have.been.calledOnce;
      expect(result.auditResult).to.have.length(1);
    });

    it('skips patterns regeneration when DB rule fetch fails', async () => {
      const fetchRulesStub = sandbox.stub().resolves({ error: true, source: 'postgres' });
      mocks.fetchAgenticUrlClassificationRules = fetchRulesStub;
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      installStubbedReportUtils();
      installStubbedCdnUtils();
      installDefaultAgenticGetConfigs();

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: 0 }),
      );

      expect(fetchRulesStub).to.have.been.calledOnce;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(mocks.runWeeklyReport).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(sinon.match('Skipping fresh patterns generation for test-site; DB rule fetch failed'));
      expect(result.auditResult).to.have.length(1);
    });

    it('generates DB rules when only one table has rules', async () => {
      const refreshedPatterns = {
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
      };
      const fetchRulesStub = sandbox.stub();
      fetchRulesStub.onFirstCall().resolves({
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [],
      });
      fetchRulesStub.onSecondCall().resolves(refreshedPatterns);
      mocks.fetchAgenticUrlClassificationRules = fetchRulesStub;
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      installStubbedReportUtils({ categories: [] });
      installStubbedCdnUtils();
      installDefaultAgenticGetConfigs();

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: 0 }),
      );

      expect(fetchRulesStub).to.have.been.calledTwice;
      expect(mocks.generatePatternsWorkbook).to.have.been.calledOnce;
      expect(mocks.runWeeklyReport.firstCall.args[0].remotePatterns).to.deep.equal(refreshedPatterns);
      expect(result.auditResult).to.have.length(1);
    });

    it('generates DB rules when DB has no existing rules', async () => {
      const refreshedPatterns = {
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
      };
      const fetchRulesStub = sandbox.stub();
      fetchRulesStub.onFirstCall().resolves({ pagePatterns: [], topicPatterns: [] });
      fetchRulesStub.onSecondCall().resolves(refreshedPatterns);
      mocks.fetchAgenticUrlClassificationRules = fetchRulesStub;
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      installStubbedReportUtils();
      installStubbedCdnUtils();
      installDefaultAgenticGetConfigs();

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: -1 }),
      );

      expect(fetchRulesStub).to.have.been.calledTwice;
      expect(mocks.generatePatternsWorkbook).to.have.been.calledOnce;
      expect(mocks.runWeeklyReport).to.have.been.calledOnce;
      expect(mocks.runWeeklyReport.firstCall.args[0].remotePatterns).to.deep.equal(refreshedPatterns);
      expect(result.auditResult).to.have.length(1);
    });

    it('successfully processes CDN logs report', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date'],
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
        toFake: ['Date'],
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
        toFake: ['Date'],
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
        toFake: ['Date'],
      });

      context.athenaClient.query.resetHistory();
      const auditContext = createAuditContext(sandbox, { weekOffset: -3 });
      await handler.runner('https://example.com', context, site, auditContext);

      clock.restore();
      expect(context.athenaClient.query).to.have.been.callCount(2);
    });

    it('handles bulk publish errors gracefully', async () => {
      mocks.bulkPublishToAdminHlx.rejects(new Error('Bulk publish failed'));
      const auditContext = createAuditContext(sandbox);
      const result = await handler.runner('https://example.com', context, site, auditContext);

      expect(result).to.have.property('auditResult').that.is.an('array');
      expect(result.auditResult).to.have.length.greaterThan(0);

      expect(context.log.error).to.have.been.calledWith('Failed to bulk publish reports:', sinon.match.instanceOf(Error));
    });

    it('skips daily export when the agentic report config is missing', async () => {
      const clock = sinon.useFakeTimers({
        now: new Date('2025-01-07'),
        toFake: ['Date'],
      });
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      mocks.runDailyAgenticExport = sandbox.stub().resolves();
      installStubbedReportUtils();
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({
        pagePatterns: [],
        topicPatterns: [],
      });
      installStubbedCdnUtils();
      mocks.getConfigs = sandbox.stub().returns([{
        name: 'referral',
        aggregatedLocation: 's3://bucket/aggregated/test-site/',
        tableName: 'aggregated_logs_example_com_referral',
        filePrefix: 'referraltraffic',
        folderSuffix: 'referral-traffic',
        workbookCreator: 'Referral Report',
        queryFunction: sandbox.stub(),
        sheetName: 'shared-all',
      }]);
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);

      let result;
      try {
        result = await handler.runner(
          'https://example.com',
          context,
          site,
          createAuditContext(sandbox, {}),
        );
      } finally {
        clock.restore();
      }

      expect(mocks.runDailyAgenticExport).to.not.have.been.called;
      expect(result.dailyAgenticExport).to.equal(undefined);
      expect(mocks.runWeeklyReport).to.have.been.calledOnce;
    });

    it('captures daily agentic export failures without failing the whole handler', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().rejects(new Error('daily export boom'));

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox),
      );

      expect(mocks.runDailyAgenticExport).to.have.been.calledOnce;
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
      mocks.runDailyAgenticExport = sandbox.stub().resolves({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
        batchId: 'batch-123',
        rowCount: 12,
        dispatch: {
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/analytics-queue',
        },
      });

      const enabledSite = {
        ...site,
        getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        getSiteId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      };

      const result = await handler.runner(
        'https://example.com',
        context,
        enabledSite,
        createAuditContext(sandbox),
      );

      expect(mocks.runDailyAgenticExport).to.have.been.calledOnce;
      expect(result.dailyAgenticExport).to.deep.equal({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
        batchId: 'batch-123',
        rowCount: 12,
        dispatch: {
          queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/analytics-queue',
        },
      });
      const agenticResult = result.auditResult.find((entry) => entry.name === 'agentic');
      expect(agenticResult).to.not.have.property('batchId');
      expect(result.auditResult).to.deep.include({
        name: 'agentic-db-export',
        batchId: 'batch-123',
      });
    });

    it('skips sharepoint and weekly reports when auditContext.date is provided', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
        batchId: 'date-batch-123',
      });
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });

      const enabledSite = {
        ...site,
        getId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        getSiteId: () => '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
      };

      const result = await handler.runner(
        'https://example.com',
        context,
        enabledSite,
        createAuditContext(sandbox, { date: '2026-04-01T10:00:00Z' }),
      );

      expect(mocks.createLLMOSharepointClient).to.not.have.been.called;
      expect(mocks.runWeeklyReport).to.not.have.been.called;
      expect(mocks.bulkPublishToAdminHlx).to.not.have.been.called;
      expect(mocks.runDailyAgenticExport).to.have.been.calledOnce;
      expect(mocks.runDailyAgenticExport.firstCall.args[0].referenceDate.toISOString())
        .to.equal('2026-04-01T10:00:00.000Z');
      expect(result.dailyAgenticExport).to.deep.equal({
        enabled: true,
        success: true,
        siteId: '9ae8877a-bbf3-407d-9adb-d6a72ce3c5e3',
        trafficDate: '2026-03-31',
        batchId: 'date-batch-123',
      });
      expect(result.auditResult).to.deep.equal([{
        name: 'agentic-db-export',
        batchId: 'date-batch-123',
      }]);
    });

    it('skips daily export when auditContext.weekOffset is provided', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      installStubbedReportUtils({
        weeks: [{
          startDate: new Date('2026-03-30T00:00:00.000Z'),
          endDate: new Date('2026-04-05T23:59:59.999Z'),
        }],
        periodIdentifier: 'w14-2026',
      });
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
      });

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: -2 }),
      );

      expect(mocks.runDailyAgenticExport).to.not.have.been.called;
      expect(result.dailyAgenticExport).to.equal(undefined);
      expect(result.auditResult).to.not.be.empty;
    });

    it('queues date-based agentic DB exports for weekly refreshes without running daily exports inline', async () => {
      // The handler's direct `generateReportingPeriods` is stubbed below via
      // `installStubbedReportUtils`, but `utils/agentic-db-export.js` calls
      // the real implementation transitively when picking the per-day SQS
      // reference dates. Pin `Date.now()` to the same week we stub so both
      // paths agree.
      const clock = sinon.useFakeTimers({
        now: new Date('2026-04-08T00:00:00.000Z'),
        toFake: ['Date'],
      });
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.generatePatternsWorkbook = sandbox.stub().resolves(true);
      mocks.runWeeklyReport = sandbox.stub().resolves({ success: true, uploadResult: null });
      installStubbedReportUtils({
        weeks: [{
          startDate: new Date('2026-03-30T00:00:00.000Z'),
          endDate: new Date('2026-04-05T23:59:59.999Z'),
        }],
        periodIdentifier: 'w14-2026',
      });
      mocks.fetchAgenticUrlClassificationRules = sandbox.stub().resolves({
        pagePatterns: [{ name: 'Documentation', regex: '/docs', sort_order: 0 }],
        topicPatterns: [{ name: 'Products', regex: '/products', sort_order: 0 }],
      });
      installStubbedCdnUtils();
      installDefaultAgenticGetConfigs();

      context.dataAccess.Configuration = {
        findLatest: sandbox.stub().resolves({
          getQueues: () => ({ audits: 'https://sqs.us-east-1.amazonaws.com/123/audits-queue' }),
        }),
      };

      let result;
      try {
        result = await handler.runner(
          'https://example.com',
          context,
          site,
          createAuditContext(sandbox, { weekOffset: -1, refreshAgenticDailyExport: true }),
        );
      } finally {
        clock.restore();
      }

      expect(mocks.runWeeklyReport).to.have.been.calledOnce;
      expect(mocks.generatePatternsWorkbook).to.not.have.been.called;
      expect(mocks.runDailyAgenticExport).to.not.have.been.called;
      expect(mocks.runDailyReferralExport).to.not.have.been.called;
      expect(context.sqs.sendMessage).to.have.callCount(7);
      expect(context.sqs.sendMessage.firstCall.args[1].auditContext).to.deep.equal({
        date: '2026-03-31T00:00:00.000Z',
        refreshAgenticDailyExport: true,
        sourceWeekOffset: -1,
      });
      expect(result.dailyAgenticExport).to.deep.include({
        enabled: true,
        success: true,
        queued: true,
      });
      expect(result.dailyAgenticExports).to.have.length(7);
      expect(result.dailyReferralExport).to.equal(undefined);
    });

    it('skips daily referral export when auditContext.weekOffset is provided', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves({ enabled: true, success: true });

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { weekOffset: -2 }),
      );

      expect(mocks.runDailyReferralExport).to.not.have.been.called;
      expect(result.dailyReferralExport).to.equal(undefined);
    });

    it('skips daily referral export when the referral report config is missing', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves();
      installDefaultAgenticGetConfigs();

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox),
      );

      expect(mocks.runDailyReferralExport).to.not.have.been.called;
      expect(result.dailyReferralExport).to.equal(undefined);
    });

    it('includes successful daily referral export in the audit result', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves({
        enabled: true,
        success: true,
        siteId: 'test-site',
        trafficDate: '2026-03-31',
        rowCount: 7,
        batchId: 'referral-batch-123',
      });

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox),
      );

      expect(mocks.runDailyReferralExport).to.have.been.calledOnce;
      expect(result.dailyReferralExport).to.deep.equal({
        enabled: true,
        success: true,
        siteId: 'test-site',
        trafficDate: '2026-03-31',
        rowCount: 7,
        batchId: 'referral-batch-123',
      });
      expect(result.auditResult).to.deep.include({
        name: 'referral-db-export',
        batchId: 'referral-batch-123',
      });
    });

    it('captures daily referral export failures without failing the whole handler', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().rejects(new Error('referral export boom'));

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox),
      );

      expect(mocks.runDailyReferralExport).to.have.been.calledOnce;
      expect(context.log.error).to.have.been.calledWith(
        'Failed daily referral export for site test-site: referral export boom',
        sinon.match.instanceOf(Error),
      );
      expect(result.dailyReferralExport).to.deep.equal({
        enabled: true,
        success: false,
        siteId: 'test-site',
        error: 'referral export boom',
      });
    });

    it('passes referenceDate to daily referral export when auditContext.date is provided', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves({
        enabled: true,
        success: true,
        trafficDate: '2026-03-31',
      });

      await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, { date: '2026-04-01T10:00:00Z' }),
      );

      expect(mocks.runDailyReferralExport.firstCall.args[0].referenceDate.toISOString())
        .to.equal('2026-04-01T10:00:00.000Z');
    });

    it('runs daily referral export for BYOCDN other agentic DB fanout messages', async () => {
      mocks.runDailyAgenticExport = sandbox.stub().resolves({ enabled: true, success: true });
      mocks.runDailyReferralExport = sandbox.stub().resolves({
        enabled: true,
        success: true,
        trafficDate: '2026-03-31',
      });

      const result = await handler.runner(
        'https://example.com',
        context,
        site,
        createAuditContext(sandbox, {
          date: '2026-04-01T00:00:00.000Z',
          refreshAgenticDailyExport: true,
          sourceWeekOffset: 0,
          triggeredBy: 'byocdn-other',
        }),
      );

      expect(mocks.runDailyReferralExport).to.have.been.calledOnce;
      expect(mocks.runDailyReferralExport.firstCall.args[0].referenceDate.toISOString())
        .to.equal('2026-04-01T00:00:00.000Z');
      expect(result.dailyReferralExport).to.deep.equal({
        enabled: true,
        success: true,
        trafficDate: '2026-03-31',
      });
    });

    describe('LLMO pattern DB rule scenarios', () => {
      it('handles successful DB rule reads', async () => {
        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
        expect(context.athenaClient.query).to.have.been.called;
      });

      it('handles missing page type rules', async () => {
        context.dataAccess.services.postgrestClient = createPostgrestClient({
          pageTypeRules: [],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
      });

      it('handles missing category rules', async () => {
        context.dataAccess.services.postgrestClient = createPostgrestClient({
          categoryRules: [],
        });

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
      });

      it('handles DB rule read errors gracefully', async () => {
        context.dataAccess.services.postgrestClient = createPostgrestClient();
        context.dataAccess.services.postgrestClient.from = () => {
          const query = {
            select: sandbox.stub().returnsThis(),
            eq: sandbox.stub().returnsThis(),
            order: sandbox.stub().returnsThis(),
            then: (resolve) => Promise.resolve({
              data: null,
              error: new Error('DB unavailable'),
            }).then(resolve),
          };
          return query;
        };

        const auditContext = createAuditContext(sandbox);
        const result = await handler.runner('https://example.com', context, site, auditContext);

        expect(result).to.have.property('auditResult').that.is.an('array');
        expect(result.auditResult).to.have.length.greaterThan(0);
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

        await handler.runner('https://example.com', context, site, auditContext);

        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/No data returned from Athena query for .* report \(.*\)\./),
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
          sinon.match(/.* report generation failed: Athena query failed/),
        );
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to generate .* report for site .*: Athena query failed/),
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
