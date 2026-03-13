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
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { describe } from 'mocha';

import {
  paidKeywordOptimizerRunner,
  sendToMystique,
  triggerPaidPagesImportStep,
  runPaidKeywordAnalysisStep,
  importTrafficAnalysisWeekStep0,
  importTrafficAnalysisWeekStep1,
  importTrafficAnalysisWeekStep2,
  importTrafficAnalysisWeekStep3,
  isExcludedPageType,
  fetchPaidPagesFromS3,
  computePriorityScore,
  buildMystiqueMessage,
  getConfig,
} from '../../../src/paid-keyword-optimizer/handler.js';

use(sinonChai);
use(chaiAsPromised);
const auditUrl = 'www.spacecat.com';

function createMockConfig(sandbox, overrides = {}) {
  return {
    getImports: () => [],
    enableImport: sandbox.stub(),
    disableImport: sandbox.stub(),
    // Methods required by Config.toDynamoItem
    getSlackConfig: sandbox.stub(),
    getHandlers: sandbox.stub(),
    getContentAiConfig: sandbox.stub(),
    getFetchConfig: sandbox.stub(),
    getBrandConfig: sandbox.stub(),
    getCdnLogsConfig: sandbox.stub(),
    getLlmoConfig: sandbox.stub(),
    getTokowakaConfig: sandbox.stub(),
    getEdgeOptimizeConfig: sandbox.stub(),
    getBrandProfile: sandbox.stub().returns(null),
    ...overrides,
  };
}

function getSite(sandbox, overrides = {}) {
  const mockConfig = createMockConfig(sandbox);

  return {
    getId: () => 'test-site-id',
    getSiteId: () => 'test-site-id',
    getDeliveryType: () => 'aem-edge',
    getBaseURL: () => 'https://example.com',
    getIsLive: () => false,
    getConfig: () => mockConfig,
    setConfig: sandbox.stub(),
    save: sandbox.stub().resolves(),
    ...overrides,
  };
}

/**
 * Creates a mock S3 client that returns the given data as JSON
 */
function createMockS3Client(sandbox, data) {
  return {
    send: sandbox.stub().resolves({
      Body: {
        transformToString: () => JSON.stringify(data),
      },
    }),
  };
}

describe('Paid Keyword Optimizer Audit', () => {
  let sandbox;
  let logStub;
  let site;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logStub = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
    };
    site = getSite(sandbox, {
      getBaseURL: () => 'https://example.com',
    });

    // Mock AWSAthenaClient
    const mockAthenaClient = {
      query: sandbox.stub().resolves([
        {
          path: '/page1',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.5',
          traffic_loss: '500',
          click_rate: '0.1',
          engagement_rate: '0.5',
          engaged_scroll_rate: '0.15',
          pct_pageviews: '0.4',
        },
        {
          path: '/page1',
          trf_type: 'earned',
          trf_channel: 'search',
          pageviews: '100',
          bounce_rate: '0.3',
          traffic_loss: '30',
          click_rate: '0.2',
          engagement_rate: '0.7',
          engaged_scroll_rate: '0.25',
          pct_pageviews: '0.04',
        },
        {
          path: '/page2',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '800',
          bounce_rate: '0.6',
          traffic_loss: '480',
          click_rate: '0.15',
          engagement_rate: '0.4',
          engaged_scroll_rate: '0.2',
          pct_pageviews: '0.32',
        },
        {
          path: '/page2',
          trf_type: 'earned',
          trf_channel: 'search',
          pageviews: '50',
          bounce_rate: '0.2',
          traffic_loss: '10',
          click_rate: '0.25',
          engagement_rate: '0.8',
          engaged_scroll_rate: '0.3',
          pct_pageviews: '0.02',
        },
      ]),
    };

    // Default Ahrefs S3 data
    const ahrefsData = [
      {
        url: 'https://example.com/page1',
        topKeyword: 'keyword1',
        cpc: 2.5,
        sum_traffic: 5000,
        topKeywordBestPositionTitle: 'SERP Title 1',
      },
      {
        url: 'https://example.com/page2',
        topKeyword: 'keyword2',
        cpc: 1.8,
        sum_traffic: 3000,
        topKeywordBestPositionTitle: 'SERP Title 2',
      },
    ];

    context = {
      runtime: { name: 'aws-lambda', region: 'us-east-1' },
      func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      athenaClient: mockAthenaClient,
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        ATHENA_S3_BUCKET: 'test-athena-bucket',
        RUM_METRICS_DATABASE: 'rum_metrics',
        RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
      },
      site,
      log: logStub,
      s3Client: createMockS3Client(sandbox, ahrefsData),
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getId: () => 'test-audit-id',
            getAuditType: () => 'ad-intent-mismatch',
            getFullAuditRef: () => 'www.test.com',
          }),
          create: sandbox.stub().resolves({ getId: () => 'new-audit-id' }),
        },
      },
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sandbox.restore();
  });

  describe('getConfig', () => {
    it('should return config with PAGE_VIEW_THRESHOLD of 5000', () => {
      const config = getConfig({ S3_IMPORTER_BUCKET_NAME: 'bucket' });
      expect(config.pageViewThreshold).to.equal(5000);
    });

    it('should throw when S3_IMPORTER_BUCKET_NAME is missing', () => {
      expect(() => getConfig({})).to.throw('S3_IMPORTER_BUCKET_NAME must be provided');
    });

    it('should use default database and table names when not provided', () => {
      const config = getConfig({ S3_IMPORTER_BUCKET_NAME: 'bucket' });
      expect(config.rumMetricsDatabase).to.equal('rum_metrics');
      expect(config.rumMetricsCompactTable).to.equal('compact_metrics');
    });

    it('should use provided database and table names', () => {
      const config = getConfig({
        S3_IMPORTER_BUCKET_NAME: 'bucket',
        RUM_METRICS_DATABASE: 'custom_db',
        RUM_METRICS_COMPACT_TABLE: 'custom_table',
      });
      expect(config.rumMetricsDatabase).to.equal('custom_db');
      expect(config.rumMetricsCompactTable).to.equal('custom_table');
    });
  });

  describe('isExcludedPageType', () => {
    it('should exclude help/support/faq/docs URLs', () => {
      expect(isExcludedPageType('https://example.com/help/topic')).to.be.true;
      expect(isExcludedPageType('https://example.com/support/article')).to.be.true;
      expect(isExcludedPageType('https://example.com/faq/question')).to.be.true;
      expect(isExcludedPageType('https://example.com/docs/guide')).to.be.true;
      expect(isExcludedPageType('https://example.com/documentation/api')).to.be.true;
    });

    it('should exclude cart/checkout/order/payment URLs', () => {
      expect(isExcludedPageType('https://example.com/cart/items')).to.be.true;
      expect(isExcludedPageType('https://example.com/checkout/step1')).to.be.true;
      expect(isExcludedPageType('https://example.com/order/confirm')).to.be.true;
      expect(isExcludedPageType('https://example.com/payment/process')).to.be.true;
    });

    it('should exclude legal/privacy/terms/cookie-policy URLs', () => {
      expect(isExcludedPageType('https://example.com/legal/notice')).to.be.true;
      expect(isExcludedPageType('https://example.com/privacy/policy')).to.be.true;
      expect(isExcludedPageType('https://example.com/terms/of-service')).to.be.true;
      expect(isExcludedPageType('https://example.com/cookie-policy/details')).to.be.true;
    });

    it('should exclude login/signin/register/signup/account URLs', () => {
      expect(isExcludedPageType('https://example.com/login/page')).to.be.true;
      expect(isExcludedPageType('https://example.com/signin/sso')).to.be.true;
      expect(isExcludedPageType('https://example.com/register/new')).to.be.true;
      expect(isExcludedPageType('https://example.com/signup/step1')).to.be.true;
      expect(isExcludedPageType('https://example.com/account/settings')).to.be.true;
    });

    it('should exclude search/search-results/results URLs', () => {
      expect(isExcludedPageType('https://example.com/search/query')).to.be.true;
      expect(isExcludedPageType('https://example.com/search-results/page')).to.be.true;
      expect(isExcludedPageType('https://example.com/results/filtered')).to.be.true;
    });

    it('should exclude thank-you/confirmation URLs', () => {
      expect(isExcludedPageType('https://example.com/thank-you/order')).to.be.true;
      expect(isExcludedPageType('https://example.com/confirmation/code')).to.be.true;
    });

    it('should exclude 404/error/not-found URLs', () => {
      expect(isExcludedPageType('https://example.com/404/page')).to.be.true;
      expect(isExcludedPageType('https://example.com/error/500')).to.be.true;
      expect(isExcludedPageType('https://example.com/not-found/resource')).to.be.true;
    });

    it('should exclude unsubscribe/preferences/manage-subscription URLs', () => {
      expect(isExcludedPageType('https://example.com/unsubscribe/email')).to.be.true;
      expect(isExcludedPageType('https://example.com/preferences/update')).to.be.true;
      expect(isExcludedPageType('https://example.com/manage-subscription/cancel')).to.be.true;
    });

    it('should exclude api/webhook URLs', () => {
      expect(isExcludedPageType('https://example.com/api/v1')).to.be.true;
      expect(isExcludedPageType('https://example.com/webhook/handler')).to.be.true;
    });

    it('should exclude status/system-status URLs', () => {
      expect(isExcludedPageType('https://example.com/status/check')).to.be.true;
      expect(isExcludedPageType('https://example.com/system-status/live')).to.be.true;
    });

    it('should be case insensitive', () => {
      expect(isExcludedPageType('https://example.com/HELP/topic')).to.be.true;
      expect(isExcludedPageType('https://example.com/Login/page')).to.be.true;
      expect(isExcludedPageType('https://example.com/FAQ/question')).to.be.true;
    });

    it('should NOT exclude URLs that contain excluded words as substrings (not path segments)', () => {
      // /account-management-software/ should NOT match /account/ because account
      // is not a standalone path segment in this URL
      expect(isExcludedPageType('https://example.com/account-management-software/')).to.be.false;
      expect(isExcludedPageType('https://example.com/helpful-resources/')).to.be.false;
      expect(isExcludedPageType('https://example.com/search-engine-optimization/')).to.be.false;
    });

    it('should NOT exclude normal landing pages', () => {
      expect(isExcludedPageType('https://example.com/products/widget')).to.be.false;
      expect(isExcludedPageType('https://example.com/pricing')).to.be.false;
      expect(isExcludedPageType('https://example.com/about-us')).to.be.false;
      expect(isExcludedPageType('https://example.com/blog/post')).to.be.false;
    });

    it('should require path segments with leading slash', () => {
      // The pattern requires /segment/ (leading and trailing slashes)
      expect(isExcludedPageType('https://example.com/my-help')).to.be.false;
      expect(isExcludedPageType('https://example.com/helpdesk')).to.be.false;
    });
  });

  describe('fetchPaidPagesFromS3', () => {
    it('should fetch and parse Ahrefs data from S3', async () => {
      const ahrefsPages = [
        {
          url: 'https://example.com/page1',
          topKeyword: 'kw1',
          cpc: 1.5,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title 1',
        },
        {
          url: 'https://example.com/page2',
          topKeyword: 'kw2',
          cpc: 2.0,
          sum_traffic: 2000,
          topKeywordBestPositionTitle: 'Title 2',
        },
      ];
      const mockS3 = createMockS3Client(sandbox, ahrefsPages);
      const ctx = {
        s3Client: mockS3,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        log: logStub,
      };

      const result = await fetchPaidPagesFromS3(ctx, 'site-123');

      expect(result).to.be.instanceOf(Map);
      expect(result.size).to.equal(2);
      expect(result.get('https://example.com/page1')).to.deep.equal({
        topKeyword: 'kw1',
        cpc: 1.5,
        sumTraffic: 1000,
        serpTitle: 'Title 1',
      });
      expect(result.get('https://example.com/page2')).to.deep.equal({
        topKeyword: 'kw2',
        cpc: 2.0,
        sumTraffic: 2000,
        serpTitle: 'Title 2',
      });
    });

    it('should default cpc to 0 and sumTraffic to 0 when missing', async () => {
      const ahrefsPages = [
        {
          url: 'https://example.com/page1',
          topKeyword: 'kw1',
          topKeywordBestPositionTitle: 'Title',
        },
      ];
      const mockS3 = createMockS3Client(sandbox, ahrefsPages);
      const ctx = {
        s3Client: mockS3,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        log: logStub,
      };

      const result = await fetchPaidPagesFromS3(ctx, 'site-123');

      expect(result.get('https://example.com/page1').cpc).to.equal(0);
      expect(result.get('https://example.com/page1').sumTraffic).to.equal(0);
    });

    it('should throw when S3 request fails', async () => {
      const mockS3 = {
        send: sandbox.stub().rejects(new Error('S3 access denied')),
      };
      const ctx = {
        s3Client: mockS3,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        log: logStub,
      };

      await expect(fetchPaidPagesFromS3(ctx, 'site-123'))
        .to.be.rejectedWith('S3 access denied');
    });

    it('should throw when JSON parsing fails', async () => {
      const mockS3 = {
        send: sandbox.stub().resolves({
          Body: {
            transformToString: () => 'invalid-json{',
          },
        }),
      };
      const ctx = {
        s3Client: mockS3,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        log: logStub,
      };

      await expect(fetchPaidPagesFromS3(ctx, 'site-123'))
        .to.be.rejected;
    });

    it('should throw when data is empty array', async () => {
      const mockS3 = createMockS3Client(sandbox, []);
      const ctx = {
        s3Client: mockS3,
        env: { S3_IMPORTER_BUCKET_NAME: 'test-bucket' },
        log: logStub,
      };

      await expect(fetchPaidPagesFromS3(ctx, 'site-123'))
        .to.be.rejectedWith(/Ahrefs paid-pages data is empty/);
    });
  });

  describe('computePriorityScore', () => {
    it('should compute WSIS score correctly', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: 0.2 };
      const ahrefsData = { cpc: 2.0 };
      // wastedSpend = 2.0 * 1000 * 0.6 = 1200
      // alignmentSignal = max(0.1, 1 - 0.2) = 0.8
      // score = (1200 / 1000) * 0.8 = 0.96
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.be.closeTo(0.96, 0.001);
    });

    it('should handle zero CPC (score is 0)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: 0.2 };
      const ahrefsData = { cpc: 0 };
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.equal(0);
    });

    it('should handle null ahrefsData (cpc defaults to 0)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: 0.2 };
      const score = computePriorityScore(page, null);
      expect(score).to.equal(0);
    });

    it('should handle null engagedScrollRate (defaults to 0.5 neutral)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: null };
      const ahrefsData = { cpc: 2.0 };
      // wastedSpend = 2.0 * 1000 * 0.6 = 1200
      // alignmentSignal = max(0.1, 1 - 0.5) = 0.5
      // score = (1200 / 1000) * 0.5 = 0.6
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.be.closeTo(0.6, 0.001);
    });

    it('should handle undefined engagedScrollRate (defaults to 0.5 neutral)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6 };
      const ahrefsData = { cpc: 2.0 };
      const score = computePriorityScore(page, ahrefsData);
      // alignmentSignal = max(0.1, 1 - 0.5) = 0.5
      expect(score).to.be.closeTo(0.6, 0.001);
    });

    it('should handle engagedScrollRate=0 (alignmentSignal is 1.0)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: 0 };
      const ahrefsData = { cpc: 2.0 };
      // wastedSpend = 1200
      // alignmentSignal = max(0.1, 1 - 0) = 1.0
      // score = 1.2 * 1.0 = 1.2
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.be.closeTo(1.2, 0.001);
    });

    it('should clamp engagedScrollRate=1.0 (alignmentSignal is 0.1)', () => {
      const page = { pageViews: 1000, bounceRate: 0.6, engagedScrollRate: 1.0 };
      const ahrefsData = { cpc: 2.0 };
      // wastedSpend = 1200
      // alignmentSignal = max(0.1, 1 - 1.0) = max(0.1, 0) = 0.1
      // score = 1.2 * 0.1 = 0.12
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.be.closeTo(0.12, 0.001);
    });

    it('should handle high engagement scenario', () => {
      const page = { pageViews: 500, bounceRate: 0.8, engagedScrollRate: 0.9 };
      const ahrefsData = { cpc: 5.0 };
      // wastedSpend = 5.0 * 500 * 0.8 = 2000
      // alignmentSignal = max(0.1, 1 - 0.9) = max(0.1, 0.1) = 0.1
      // score = (2000 / 1000) * 0.1 = 0.2
      const score = computePriorityScore(page, ahrefsData);
      expect(score).to.be.closeTo(0.2, 0.001);
    });
  });

  describe('buildMystiqueMessage', () => {
    it('should include all enriched fields', () => {
      const mockSite = {
        getId: () => 'site-1',
        getDeliveryType: () => 'aem-edge',
      };
      const page = {
        url: 'https://example.com/page1',
        bounceRate: 0.6,
        pageViews: 1000,
        trafficLoss: 500,
        priorityScore: 0.96,
        cpc: 2.5,
        sumTraffic: 5000,
        topKeyword: 'keyword1',
        serpTitle: 'SERP Title',
        engagedScrollRate: 0.15,
      };

      const msg = buildMystiqueMessage(mockSite, 'audit-123', page);

      expect(msg.type).to.equal('guidance:paid-ad-intent-gap');
      expect(msg.observation).to.equal('Low-performing paid search pages detected with high bounce rates');
      expect(msg.siteId).to.equal('site-1');
      expect(msg.url).to.equal('https://example.com/page1');
      expect(msg.auditId).to.equal('audit-123');
      expect(msg.deliveryType).to.equal('aem-edge');
      expect(msg.time).to.be.a('string');
      expect(msg.data).to.deep.equal({
        bounceRate: 0.6,
        pageViews: 1000,
        trafficLoss: 500,
        priorityScore: 0.96,
        cpc: 2.5,
        sumTraffic: 5000,
        topKeyword: 'keyword1',
        serpTitle: 'SERP Title',
        engagedScrollRate: 0.15,
      });
    });
  });

  describe('triggerPaidPagesImportStep', () => {
    it('should return correct structure for import worker', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await triggerPaidPagesImportStep(stepContext);

      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef', auditUrl);
      expect(result).to.have.property('type', 'ahref-paid-pages');
      expect(result).to.have.property('siteId', 'test-site-id');
    });

    it('should return placeholder audit result with pending status', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await triggerPaidPagesImportStep(stepContext);

      expect(result.auditResult).to.deep.equal({
        status: 'pending',
        message: 'Waiting for ahref-paid-pages import to complete',
      });
    });

    it('should enable import when not already enabled', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await triggerPaidPagesImportStep(stepContext);

      expect(site.getConfig().enableImport).to.have.been.calledWith('ahref-paid-pages');
      expect(result.auditContext.importWasEnabled).to.be.true;
    });

    it('should not enable import when already enabled', async () => {
      const mockConfigWithImport = createMockConfig(sandbox, {
        getImports: () => [{ type: 'ahref-paid-pages', enabled: true }],
      });
      const siteWithImportEnabled = getSite(sandbox, {
        getConfig: () => mockConfigWithImport,
      });

      const stepContext = {
        site: siteWithImportEnabled,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await triggerPaidPagesImportStep(stepContext);

      expect(mockConfigWithImport.enableImport).to.not.have.been.called;
      expect(result.auditContext.importWasEnabled).to.be.false;
    });

    it('should throw error when site config is null', async () => {
      const siteWithNullConfig = getSite(sandbox, {
        getConfig: () => null,
      });

      const stepContext = {
        site: siteWithNullConfig,
        log: logStub,
        finalUrl: auditUrl,
      };

      await expect(triggerPaidPagesImportStep(stepContext))
        .to.be.rejectedWith(/site config is null/);

      expect(logStub.error).to.have.been.calledWithMatch(/site config is null/);
    });

    it('should throw error when site.save() fails during import toggle', async () => {
      const mockConfig = createMockConfig(sandbox);
      const siteWithSaveError = getSite(sandbox, {
        getConfig: () => mockConfig,
        save: sandbox.stub().rejects(new Error('Database connection failed')),
      });

      const stepContext = {
        site: siteWithSaveError,
        log: logStub,
        finalUrl: auditUrl,
      };

      await expect(triggerPaidPagesImportStep(stepContext))
        .to.be.rejectedWith('Database connection failed');
    });
  });

  describe('importTrafficAnalysisWeekStep0', () => {
    it('should return correct structure with type traffic-analysis', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      const result = await importTrafficAnalysisWeekStep0(stepContext);

      expect(result).to.have.property('type', 'traffic-analysis');
      expect(result).to.have.property('siteId', 'test-site-id');
      expect(result).to.have.property('allowCache', true);
      expect(result).to.have.property('fullAuditRef', auditUrl);
      expect(result.auditResult).to.have.property('status', 'processing');
      expect(result.auditContext).to.have.property('week');
      expect(result.auditContext).to.have.property('year');
    });

    it('should enable traffic-analysis import when not enabled', async () => {
      const stepContext = {
        site,
        log: logStub,
        finalUrl: auditUrl,
      };

      await importTrafficAnalysisWeekStep0(stepContext);

      expect(site.getConfig().enableImport).to.have.been.calledWith('traffic-analysis');
    });

    it('should skip enableImport when already enabled', async () => {
      const mockConfigWithImport = createMockConfig(sandbox, {
        getImports: () => [{ type: 'traffic-analysis', enabled: true }],
      });
      const siteWithImportEnabled = getSite(sandbox, {
        getConfig: () => mockConfigWithImport,
      });

      const stepContext = {
        site: siteWithImportEnabled,
        log: logStub,
        finalUrl: auditUrl,
      };

      await importTrafficAnalysisWeekStep0(stepContext);

      expect(mockConfigWithImport.enableImport).to.not.have.been.called;
    });

    it('should throw when site config is null', async () => {
      const siteWithNullConfig = getSite(sandbox, {
        getConfig: () => null,
      });

      const stepContext = {
        site: siteWithNullConfig,
        log: logStub,
        finalUrl: auditUrl,
      };

      await expect(importTrafficAnalysisWeekStep0(stepContext))
        .to.be.rejectedWith(/site config is null/);

      expect(logStub.error).to.have.been.calledWithMatch(/site config is null/);
    });
  });

  describe('importTrafficAnalysisWeekSteps 1-3', () => {
    it('steps 1-3 should NOT call enableImport', async () => {
      const steps = [
        importTrafficAnalysisWeekStep1,
        importTrafficAnalysisWeekStep2,
        importTrafficAnalysisWeekStep3,
      ];

      for (const step of steps) {
        const mockConfig = createMockConfig(sandbox);
        const stepSite = getSite(sandbox, { getConfig: () => mockConfig });

        const stepContext = {
          site: stepSite,
          log: logStub,
          finalUrl: auditUrl,
        };

        // eslint-disable-next-line no-await-in-loop
        await step(stepContext);

        expect(mockConfig.enableImport).to.not.have.been.called;
      }
    });

    it('steps 1-3 should return correct structure with week/year', async () => {
      const steps = [
        importTrafficAnalysisWeekStep1,
        importTrafficAnalysisWeekStep2,
        importTrafficAnalysisWeekStep3,
      ];

      for (const step of steps) {
        const stepContext = {
          site,
          log: logStub,
          finalUrl: auditUrl,
        };

        // eslint-disable-next-line no-await-in-loop
        const result = await step(stepContext);

        expect(result).to.have.property('type', 'traffic-analysis');
        expect(result).to.have.property('siteId', 'test-site-id');
        expect(result).to.have.property('allowCache', true);
        expect(result.auditContext).to.have.property('week');
        expect(result.auditContext).to.have.property('year');
      }
    });

    it('all 4 steps should return different weeks (uniqueness check)', async () => {
      const steps = [
        importTrafficAnalysisWeekStep0,
        importTrafficAnalysisWeekStep1,
        importTrafficAnalysisWeekStep2,
        importTrafficAnalysisWeekStep3,
      ];

      const weekKeys = [];
      for (const step of steps) {
        const stepContext = {
          site,
          log: logStub,
          finalUrl: auditUrl,
        };

        // eslint-disable-next-line no-await-in-loop
        const result = await step(stepContext);
        weekKeys.push(`${result.auditContext.week}-${result.auditContext.year}`);
      }

      const uniqueKeys = new Set(weekKeys);
      expect(uniqueKeys.size).to.equal(4);
    });
  });

  describe('runPaidKeywordAnalysisStep', () => {
    let mockAudit;
    let stepContext;

    beforeEach(() => {
      mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };
    });

    it('should run analysis and persist audit', async () => {
      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.dataAccess.Audit.create).to.have.been.called;
    });

    it('should disable import if it was enabled in step 1', async () => {
      stepContext.auditContext = { importWasEnabled: true };

      await runPaidKeywordAnalysisStep(stepContext);

      expect(site.getConfig().disableImport).to.have.been.calledWith('ahref-paid-pages');
    });

    it('should continue audit even if disabling import fails (cleanup)', async () => {
      const mockConfig = createMockConfig(sandbox);
      const siteWithSaveError = getSite(sandbox, {
        getConfig: () => mockConfig,
        getBaseURL: () => 'https://example.com',
        save: sandbox.stub().rejects(new Error('Database connection failed')),
      });

      stepContext.site = siteWithSaveError;
      stepContext.auditContext = { importWasEnabled: true };

      // Should not throw - audit should complete even if disable fails
      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.dataAccess.Audit.create).to.have.been.called;
      expect(logStub.error).to.have.been.calledWithMatch(/Failed to disable import \(cleanup\)/);
    });

    it('should not disable import if it was not enabled in step 1', async () => {
      stepContext.auditContext = { importWasEnabled: false };

      await runPaidKeywordAnalysisStep(stepContext);

      expect(site.getConfig().disableImport).to.not.have.been.called;
    });

    it('should persist audit with analysis results', async () => {
      await runPaidKeywordAnalysisStep(stepContext);

      const createCall = context.dataAccess.Audit.create.getCall(0).args[0];
      expect(createCall.auditResult).to.have.property('totalPageViews');
      expect(createCall.auditResult).to.have.property('averageBounceRate');
      expect(createCall.auditResult).to.have.property('predominantlyPaidPages');
      expect(createCall.auditResult).to.have.property('predominantlyPaidCount');
    });

    it('should send enriched messages with WSIS scoring to mystique', async () => {
      await runPaidKeywordAnalysisStep(stepContext);

      // Both pages have bounce rate >= 0.5 threshold, so 2 messages should be sent
      expect(context.sqs.sendMessage.callCount).to.equal(2);

      const message1 = context.sqs.sendMessage.getCall(0).args[1];
      const message2 = context.sqs.sendMessage.getCall(1).args[1];

      expect(message1.type).to.equal('guidance:paid-ad-intent-gap');
      expect(message2.type).to.equal('guidance:paid-ad-intent-gap');

      // Each message should have enriched fields
      expect(message1.data).to.have.property('bounceRate');
      expect(message1.data).to.have.property('pageViews');
      expect(message1.data).to.have.property('priorityScore');
      expect(message1.data).to.have.property('cpc');
      expect(message1.data).to.have.property('sumTraffic');
      expect(message1.data).to.have.property('topKeyword');
      expect(message1.data).to.have.property('serpTitle');
      expect(message1.data).to.have.property('engagedScrollRate');

      // Messages must use the NEW audit ID
      expect(message1.auditId).to.equal('new-audit-id');
      expect(message2.auditId).to.equal('new-audit-id');
    });

    it('should use the new audit ID (not step-1 audit ID) in mystique messages', async () => {
      const step1AuditId = 'step-1-stale-audit-id';
      const newAuditId = 'new-audit-with-results-id';

      context.dataAccess.Audit.create.resolves({ getId: () => newAuditId });

      stepContext.audit = {
        getId: () => step1AuditId,
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      await runPaidKeywordAnalysisStep(stepContext);

      // Verify every SQS message uses the new audit ID, not the step-1 ID
      for (let i = 0; i < context.sqs.sendMessage.callCount; i += 1) {
        const message = context.sqs.sendMessage.getCall(i).args[1];
        expect(message.auditId).to.equal(newAuditId);
        expect(message.auditId).to.not.equal(step1AuditId);
      }
    });

    it('should return empty when Ahrefs data fetch fails (audit terminates)', async () => {
      context.s3Client.send.rejects(new Error('S3 not found'));

      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(logStub.error).to.have.been.calledWithMatch(/Audit terminated: Ahrefs data unavailable/);
    });

    it('should not send to mystique when no predominantly paid pages found', async () => {
      // Override to return no paid pages
      context.athenaClient.query.resolves([]);

      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/No predominantly paid pages found/);
    });

    it('should filter out excluded URL patterns', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/help/article',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.1',
        },
        {
          path: '/products/widget',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.1',
        },
      ]);

      const ahrefsPages = [
        {
          url: 'https://example.com/help/article',
          topKeyword: 'kw1',
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title',
        },
        {
          url: 'https://example.com/products/widget',
          topKeyword: 'kw2',
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title',
        },
      ];
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      // Only the products page should be sent (help is excluded)
      expect(context.sqs.sendMessage.callCount).to.equal(1);
      const sentMsg = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMsg.url).to.equal('https://example.com/products/widget');
    });

    it('should filter pages below bounce rate threshold (0.5)', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/page-high-bounce',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7', // above 0.5
          traffic_loss: '700',
          engaged_scroll_rate: '0.15',
        },
        {
          path: '/page-low-bounce',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.3', // below 0.5
          traffic_loss: '300',
          engaged_scroll_rate: '0.15',
        },
      ]);

      const ahrefsPages = [
        {
          url: 'https://example.com/page-high-bounce',
          topKeyword: 'kw1',
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title',
        },
        {
          url: 'https://example.com/page-low-bounce',
          topKeyword: 'kw2',
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title',
        },
      ];
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      // Only the high-bounce page should be sent
      expect(context.sqs.sendMessage.callCount).to.equal(1);
      const sentMsg = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMsg.url).to.equal('https://example.com/page-high-bounce');
    });

    it('should cap pages to AD_INTENT_MAX_PAGES when set', async () => {
      // Create 10 paid pages
      const athenaRows = [];
      const ahrefsPages = [];
      for (let i = 0; i < 10; i += 1) {
        athenaRows.push({
          path: `/page${i}`,
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.1',
        });
        ahrefsPages.push({
          url: `https://example.com/page${i}`,
          topKeyword: `kw${i}`,
          cpc: 2.0 + i * 0.1,
          sum_traffic: 1000 + i * 100,
          topKeywordBestPositionTitle: `Title ${i}`,
        });
      }
      context.athenaClient.query.resolves(athenaRows);
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);
      context.env.AD_INTENT_MAX_PAGES = '5';

      await runPaidKeywordAnalysisStep(stepContext);

      expect(context.sqs.sendMessage.callCount).to.equal(5);
    });

    it('should send all pages when AD_INTENT_MAX_PAGES is 0 (unlimited)', async () => {
      // Create 10 paid pages
      const athenaRows = [];
      const ahrefsPages = [];
      for (let i = 0; i < 10; i += 1) {
        athenaRows.push({
          path: `/page${i}`,
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.1',
        });
        ahrefsPages.push({
          url: `https://example.com/page${i}`,
          topKeyword: `kw${i}`,
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: `Title ${i}`,
        });
      }
      context.athenaClient.query.resolves(athenaRows);
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);
      context.env.AD_INTENT_MAX_PAGES = '0';

      await runPaidKeywordAnalysisStep(stepContext);

      expect(context.sqs.sendMessage.callCount).to.equal(10);
    });

    it('should emit pipeline summary log', async () => {
      await runPaidKeywordAnalysisStep(stepContext);

      expect(logStub.info).to.have.been.calledWithMatch(/Filter pipeline for site/);
      expect(logStub.info).to.have.been.calledWithMatch(/paid pages.*URL-pass.*bounce-pass.*after scoring\+cap/);
    });

    it('should filter out pages with very low priority score (<=0.01)', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/low-score-page',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.5',
          traffic_loss: '500',
          engaged_scroll_rate: '0.99',
        },
      ]);

      // Very low CPC to get a very low score
      const ahrefsPages = [
        {
          url: 'https://example.com/low-score-page',
          topKeyword: 'kw',
          cpc: 0.001,
          sum_traffic: 10,
          topKeywordBestPositionTitle: 'Title',
        },
      ];
      context.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      // Score is very small, should be filtered by > 0.01 check
      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/No pages passed pipeline/);
    });

    it('should sort pages by priority score descending', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/low-cpc',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.2',
        },
        {
          path: '/high-cpc',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.2',
        },
      ]);

      const ahrefsPages = [
        {
          url: 'https://example.com/low-cpc',
          topKeyword: 'kw1',
          cpc: 1.0,
          sum_traffic: 500,
          topKeywordBestPositionTitle: 'Low CPC',
        },
        {
          url: 'https://example.com/high-cpc',
          topKeyword: 'kw2',
          cpc: 10.0,
          sum_traffic: 5000,
          topKeywordBestPositionTitle: 'High CPC',
        },
      ];
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      expect(context.sqs.sendMessage.callCount).to.equal(2);
      const msg1 = context.sqs.sendMessage.getCall(0).args[1];
      const msg2 = context.sqs.sendMessage.getCall(1).args[1];
      // Higher CPC page should be first (higher priority score)
      expect(msg1.url).to.equal('https://example.com/high-cpc');
      expect(msg2.url).to.equal('https://example.com/low-cpc');
    });

    it('should enrich pages with Ahrefs data defaults when URL not in Ahrefs map', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/unknown-page',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.7',
          traffic_loss: '700',
          engaged_scroll_rate: '0.1',
        },
      ]);

      // Ahrefs has data for a different URL
      const ahrefsPages = [
        {
          url: 'https://example.com/other-page',
          topKeyword: 'kw',
          cpc: 2.0,
          sum_traffic: 1000,
          topKeywordBestPositionTitle: 'Title',
        },
      ];
      context.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      // Page with no ahrefs data has cpc=0, so priorityScore=0 and gets filtered out
      expect(context.sqs.sendMessage).to.not.have.been.called;
    });

    it('should handle full pipeline integration: Ahrefs fetch -> URL filter -> bounce -> score -> cap', async () => {
      // 5 pages: 1 excluded URL, 1 low bounce, 1 no ahrefs match, 2 good
      context.athenaClient.query.resolves([
        {
          path: '/help/article', trf_type: 'paid', trf_channel: 'search', pageviews: '1000', bounce_rate: '0.8', traffic_loss: '800', engaged_scroll_rate: '0.1',
        },
        {
          path: '/low-bounce', trf_type: 'paid', trf_channel: 'search', pageviews: '1000', bounce_rate: '0.2', traffic_loss: '200', engaged_scroll_rate: '0.1',
        },
        {
          path: '/no-ahrefs', trf_type: 'paid', trf_channel: 'search', pageviews: '1000', bounce_rate: '0.8', traffic_loss: '800', engaged_scroll_rate: '0.1',
        },
        {
          path: '/good-page1', trf_type: 'paid', trf_channel: 'search', pageviews: '2000', bounce_rate: '0.7', traffic_loss: '1400', engaged_scroll_rate: '0.2',
        },
        {
          path: '/good-page2', trf_type: 'paid', trf_channel: 'search', pageviews: '1500', bounce_rate: '0.6', traffic_loss: '900', engaged_scroll_rate: '0.3',
        },
      ]);

      const ahrefsPages = [
        { url: 'https://example.com/help/article', topKeyword: 'kw', cpc: 3.0, sum_traffic: 2000, topKeywordBestPositionTitle: 'T' },
        { url: 'https://example.com/low-bounce', topKeyword: 'kw', cpc: 2.0, sum_traffic: 1000, topKeywordBestPositionTitle: 'T' },
        // /no-ahrefs is not in this list
        { url: 'https://example.com/good-page1', topKeyword: 'kw1', cpc: 5.0, sum_traffic: 5000, topKeywordBestPositionTitle: 'Good 1' },
        { url: 'https://example.com/good-page2', topKeyword: 'kw2', cpc: 3.0, sum_traffic: 3000, topKeywordBestPositionTitle: 'Good 2' },
      ];
      stepContext.s3Client = createMockS3Client(sandbox, ahrefsPages);

      await runPaidKeywordAnalysisStep(stepContext);

      // Only 2 good pages should pass the pipeline
      expect(context.sqs.sendMessage.callCount).to.equal(2);
      // good-page1 has higher score so it's first
      const msg1 = context.sqs.sendMessage.getCall(0).args[1];
      expect(msg1.url).to.equal('https://example.com/good-page1');
    });
  });

  describe('paidKeywordOptimizerRunner', () => {
    it('should return audit result with expected structure', async () => {
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult).to.be.an('object');
      expect(result.auditResult).to.have.property('totalPageViews');
      expect(result.auditResult).to.have.property('averageBounceRate');
      expect(result.auditResult).to.have.property('predominantlyPaidPages');
      expect(result.auditResult).to.have.property('predominantlyPaidCount');
      expect(result.auditResult).to.have.property('temporalCondition');
      expect(result.auditResult.predominantlyPaidPages).to.be.an('array');
    });

    it('should correctly identify predominantly paid pages', async () => {
      // page1: paid=1000, earned=100, total=1100, paid%=90.9% -> predominantly paid
      // page2: paid=800, earned=50, total=850, paid%=94.1% -> predominantly paid
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult.predominantlyPaidCount).to.equal(2);
      expect(result.auditResult.predominantlyPaidPages.map((p) => p.path)).to.include('/page1');
      expect(result.auditResult.predominantlyPaidPages.map((p) => p.path)).to.include('/page2');
    });

    it('should filter out pages that are not predominantly paid', async () => {
      // Override mock to return a page with mixed traffic
      context.athenaClient.query.resolves([
        {
          path: '/mixed-page',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '400',
          bounce_rate: '0.5',
          traffic_loss: '200',
        },
        {
          path: '/mixed-page',
          trf_type: 'earned',
          trf_channel: 'search',
          pageviews: '600',
          bounce_rate: '0.3',
          traffic_loss: '180',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // paid=400, earned=600, total=1000, paid%=40% -> NOT predominantly paid
      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
      expect(result.auditResult.predominantlyPaidPages).to.be.empty;
    });

    it('should calculate average bounce rate correctly', async () => {
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // page1 bounce_rate: 0.5, page2 bounce_rate: 0.6
      // average: (0.5 + 0.6) / 2 = 0.55
      expect(result.auditResult.averageBounceRate).to.be.closeTo(0.55, 0.01);
    });

    it('should calculate total page views correctly', async () => {
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // page1 paid: 1000, page2 paid: 800
      // total: 1800
      expect(result.auditResult.totalPageViews).to.equal(1800);
    });

    it('should throw error when S3_IMPORTER_BUCKET_NAME is missing', async () => {
      const contextWithoutBucket = {
        ...context,
        env: {
          RUM_METRICS_DATABASE: 'rum_metrics',
          RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
        },
      };

      await expect(paidKeywordOptimizerRunner(auditUrl, contextWithoutBucket, site))
        .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for paid keyword optimizer audit');
    });

    it('should use default values for missing database and table env vars', async () => {
      const contextWithDefaults = {
        ...context,
        env: {
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
        },
      };

      const result = await paidKeywordOptimizerRunner(auditUrl, contextWithDefaults, site);

      expect(result.auditResult).to.be.an('object');
      expect(context.athenaClient.query).to.have.been.called;
    });

    it('should handle query results with missing fields', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/test-page',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '100',
          // Missing most fields
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult).to.be.an('object');
      expect(result.auditResult.predominantlyPaidPages).to.be.an('array');
    });

    it('should handle athena query failures and log error', async () => {
      context.athenaClient.query.rejects(new Error('Athena connection failed'));

      await expect(paidKeywordOptimizerRunner(auditUrl, context, site))
        .to.be.rejectedWith('Athena connection failed');

      expect(logStub.error).to.have.been.calledWith(sinon.match(/Athena query failed: Athena connection failed/));
    });

    it('should handle empty query results', async () => {
      context.athenaClient.query.resolves([]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
      expect(result.auditResult.predominantlyPaidPages).to.be.empty;
      expect(result.auditResult.totalPageViews).to.equal(0);
      expect(result.auditResult.averageBounceRate).to.equal(0);
    });

    it('should handle pages with null or undefined path', async () => {
      context.athenaClient.query.resolves([
        {
          path: null,
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.8',
        },
        {
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '500',
          bounce_rate: '0.7',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult).to.be.an('object');
    });

    it('should only include paid traffic type rows in predominantly paid pages', async () => {
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      result.auditResult.predominantlyPaidPages.forEach((page) => {
        expect(page.trfType).to.equal('paid');
      });
    });

    it('should handle owned traffic type', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/page1',
          trf_type: 'owned',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.5',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // owned=1000, total=1000, owned%=100% -> NOT predominantly PAID
      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
    });

    it('should handle paths with zero total pageviews', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/zero-traffic',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '0',
          bounce_rate: '0.5',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // total=0 -> should not be predominantly paid
      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
    });

    it('should handle path with only earned traffic (no paid row)', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/only-earned',
          trf_type: 'earned',
          trf_channel: 'search',
          pageviews: '100',
          bounce_rate: '0.3',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // No paid traffic -> not predominantly paid
      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
    });

    it('should handle missing traffic_loss field with default value', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/page1',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.5',
          // traffic_loss is intentionally missing
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      expect(result.auditResult.predominantlyPaidPages).to.be.an('array');
      expect(result.auditResult.predominantlyPaidPages[0].trafficLoss).to.equal(0);
    });

    it('should handle missing pageviews field with default value', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/page1',
          trf_type: 'paid',
          trf_channel: 'search',
          bounce_rate: '0.5',
          // pageviews is intentionally missing
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // With 0 pageviews, it shouldn't be predominantly paid (total === 0)
      expect(result.auditResult.predominantlyPaidCount).to.equal(0);
    });

    it('should handle path not in traffic map when getting paid row', async () => {
      context.athenaClient.query.resolves([
        {
          path: '/page1',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '900',
          bounce_rate: '0.5',
        },
        {
          path: '/page1',
          trf_type: 'earned',
          trf_channel: 'search',
          pageviews: '100',
          bounce_rate: '0.3',
        },
      ]);

      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // Should still work - paid = 90%
      expect(result.auditResult.predominantlyPaidCount).to.equal(1);
    });

    it('should use 4-week temporal condition (numSeries: 4)', async () => {
      const result = await paidKeywordOptimizerRunner(auditUrl, context, site);

      // The temporalCondition should contain at least 4 week clauses
      const weekClauses = result.auditResult.temporalCondition.split(' OR ');
      expect(weekClauses.length).to.be.at.least(4);
    });
  });

  describe('sendToMystique (legacy)', () => {
    it('should send one message per qualifying page above bounce rate threshold', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.6, // Above 0.5 threshold
              pageViews: 1000,
              trafficLoss: 500,
            },
            {
              path: '/page2',
              url: 'https://example.com/page2',
              bounceRate: 0.5, // At 0.5 threshold
              pageViews: 800,
              trafficLoss: 320,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      // Should send 2 separate messages (one per page)
      expect(context.sqs.sendMessage.callCount).to.equal(2);

      const message1 = context.sqs.sendMessage.getCall(0).args[1];
      const message2 = context.sqs.sendMessage.getCall(1).args[1];

      expect(message1.type).to.equal('guidance:paid-ad-intent-gap');
      expect(message1.url).to.equal('https://example.com/page1');
      expect(message1.data.bounceRate).to.equal(0.6);
      expect(message1.data.pageViews).to.equal(1000);

      expect(message2.type).to.equal('guidance:paid-ad-intent-gap');
      expect(message2.url).to.equal('https://example.com/page2');
      expect(message2.data.bounceRate).to.equal(0.5);
      expect(message2.data.pageViews).to.equal(800);
    });

    it('should filter pages by bounce rate threshold (0.5)', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/high-bounce',
              url: 'https://example.com/high-bounce',
              bounceRate: 0.6, // Above 0.5 threshold
              pageViews: 1000,
              trafficLoss: 500,
            },
            {
              path: '/low-bounce',
              url: 'https://example.com/low-bounce',
              bounceRate: 0.3, // Below 0.5 threshold
              pageViews: 800,
              trafficLoss: 160,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      // Only 1 message should be sent (for high-bounce page)
      expect(context.sqs.sendMessage.callCount).to.equal(1);

      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.url).to.equal('https://example.com/high-bounce');
      expect(sentMessage.data.bounceRate).to.equal(0.6);
    });

    it('should not send message when no pages exceed bounce rate threshold', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/low-bounce',
              url: 'https://example.com/low-bounce',
              bounceRate: 0.3, // Below 0.5 threshold
              pageViews: 800,
              trafficLoss: 160,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(context.sqs.sendMessage.called).to.be.false;
      expect(logStub.info).to.have.been.calledWithMatch(/No pages with bounce rate/);
    });

    it('should not send message when predominantlyPaidPages is empty', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(context.sqs.sendMessage.called).to.be.false;
    });

    it('should not send message when predominantlyPaidPages is undefined', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {},
      };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(context.sqs.sendMessage.called).to.be.false;
    });

    it('should include time field in mystique message', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.6,
              pageViews: 1000,
              trafficLoss: 500,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage).to.have.property('time');
      expect(sentMessage.time).to.be.a('string');
    });

    it('should include correct message structure', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.6,
              pageViews: 1000,
              trafficLoss: 500,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.type).to.equal('guidance:paid-ad-intent-gap');
      expect(sentMessage.observation).to.equal('Low-performing paid search pages detected with high bounce rates');
      expect(sentMessage.siteId).to.equal('test-site-id');
      expect(sentMessage.url).to.equal('https://example.com/page1');
      expect(sentMessage.auditId).to.equal('test-audit-id');
      expect(sentMessage.deliveryType).to.equal('aem-edge');
      expect(sentMessage.data).to.have.property('bounceRate', 0.6);
      expect(sentMessage.data).to.have.property('pageViews', 1000);
      expect(sentMessage.data).to.have.property('trafficLoss', 500);
    });

    it('should log info message when sending to mystique', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.6,
              pageViews: 1000,
              trafficLoss: 500,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(logStub.info).to.have.been.calledWithMatch(/Sending message for/);
      expect(logStub.info).to.have.been.calledWithMatch(/Completed mystique evaluation step/);
    });

    it('should handle pages with bounce rate exactly at threshold (0.5)', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.5, // Exactly at threshold
              pageViews: 1000,
              trafficLoss: 300,
            },
          ],
        },
      };

      await sendToMystique(auditUrl, auditData, context, site);

      expect(context.sqs.sendMessage.callCount).to.equal(1);
      const sentMessage = context.sqs.sendMessage.getCall(0).args[1];
      expect(sentMessage.url).to.equal('https://example.com/page1');
      expect(sentMessage.data.bounceRate).to.equal(0.5);
    });
  });
});
