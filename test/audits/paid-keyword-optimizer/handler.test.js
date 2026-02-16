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
      s3Client: {},
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

  describe('runPaidKeywordAnalysisStep', () => {
    it('should run analysis and persist audit', async () => {
      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };

      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.dataAccess.Audit.create).to.have.been.called;
    });

    it('should disable import if it was enabled in step 1', async () => {
      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {
          importWasEnabled: true,
        },
      };

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

      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site: siteWithSaveError,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {
          importWasEnabled: true,
        },
      };

      // Should not throw - audit should complete even if disable fails
      const result = await runPaidKeywordAnalysisStep(stepContext);

      expect(result).to.deep.equal({});
      expect(context.dataAccess.Audit.create).to.have.been.called;
      expect(logStub.error).to.have.been.calledWithMatch(/Failed to disable import \(cleanup\)/);
    });

    it('should not disable import if it was not enabled in step 1', async () => {
      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {
          importWasEnabled: false,
        },
      };

      await runPaidKeywordAnalysisStep(stepContext);

      expect(site.getConfig().disableImport).to.not.have.been.called;
    });

    it('should persist audit with analysis results', async () => {
      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };

      await runPaidKeywordAnalysisStep(stepContext);

      const createCall = context.dataAccess.Audit.create.getCall(0).args[0];
      expect(createCall.auditResult).to.have.property('totalPageViews');
      expect(createCall.auditResult).to.have.property('averageBounceRate');
      expect(createCall.auditResult).to.have.property('predominantlyPaidPages');
      expect(createCall.auditResult).to.have.property('predominantlyPaidCount');
    });

    it('should send one message per qualifying page to mystique', async () => {
      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };

      await runPaidKeywordAnalysisStep(stepContext);

      // Both pages have bounce rate > 0.3 threshold, so 2 messages should be sent
      expect(context.sqs.sendMessage.callCount).to.equal(2);

      const message1 = context.sqs.sendMessage.getCall(0).args[1];
      const message2 = context.sqs.sendMessage.getCall(1).args[1];

      expect(message1.type).to.equal('guidance:paid-ad-intent-gap');
      expect(message2.type).to.equal('guidance:paid-ad-intent-gap');

      // Each message should have a single url and page-specific data
      expect(message1.url).to.equal('https://example.com/page1');
      expect(message1.data).to.have.property('bounceRate');
      expect(message1.data).to.have.property('pageViews');

      expect(message2.url).to.equal('https://example.com/page2');
      expect(message2.data).to.have.property('bounceRate');
      expect(message2.data).to.have.property('pageViews');

      // Messages must use the NEW audit ID (from AuditModel.create), not the step-1 audit ID
      expect(message1.auditId).to.equal('new-audit-id');
      expect(message2.auditId).to.equal('new-audit-id');
    });

    it('should use the new audit ID (not step-1 audit ID) in mystique messages', async () => {
      const step1AuditId = 'step-1-stale-audit-id';
      const newAuditId = 'new-audit-with-results-id';

      context.dataAccess.Audit.create.resolves({ getId: () => newAuditId });

      const mockAudit = {
        getId: () => step1AuditId,
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };

      await runPaidKeywordAnalysisStep(stepContext);

      // Verify every SQS message uses the new audit ID, not the step-1 ID
      for (let i = 0; i < context.sqs.sendMessage.callCount; i += 1) {
        const message = context.sqs.sendMessage.getCall(i).args[1];
        expect(message.auditId).to.equal(newAuditId);
        expect(message.auditId).to.not.equal(step1AuditId);
      }
    });

    it('should not send to mystique when no qualifying pages', async () => {
      // Override to return pages with low bounce rate
      context.athenaClient.query.resolves([
        {
          path: '/page1',
          trf_type: 'paid',
          trf_channel: 'search',
          pageviews: '1000',
          bounce_rate: '0.1', // Below 0.3 threshold
        },
      ]);

      const mockAudit = {
        getId: () => 'test-audit-id',
        getAuditType: () => 'ad-intent-mismatch',
        getFullAuditRef: () => 'www.test.com',
      };

      const stepContext = {
        ...context,
        site,
        finalUrl: auditUrl,
        audit: mockAudit,
        auditContext: {},
      };

      await runPaidKeywordAnalysisStep(stepContext);

      expect(context.sqs.sendMessage).to.not.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch(/No pages with bounce rate/);
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
      // Create a predominantly paid page but the traffic map doesn't have the path when trying to get paid row
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
              bounceRate: 0.5, // Above 0.3 threshold
              pageViews: 1000,
              trafficLoss: 500,
            },
            {
              path: '/page2',
              url: 'https://example.com/page2',
              bounceRate: 0.4, // Above 0.3 threshold
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
      expect(message1.data.bounceRate).to.equal(0.5);
      expect(message1.data.pageViews).to.equal(1000);

      expect(message2.type).to.equal('guidance:paid-ad-intent-gap');
      expect(message2.url).to.equal('https://example.com/page2');
      expect(message2.data.bounceRate).to.equal(0.4);
      expect(message2.data.pageViews).to.equal(800);
    });

    it('should filter pages by bounce rate threshold', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/high-bounce',
              url: 'https://example.com/high-bounce',
              bounceRate: 0.5, // Above 0.3 threshold
              pageViews: 1000,
              trafficLoss: 500,
            },
            {
              path: '/low-bounce',
              url: 'https://example.com/low-bounce',
              bounceRate: 0.2, // Below 0.3 threshold
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
      expect(sentMessage.data.bounceRate).to.equal(0.5);
    });

    it('should not send message when no pages exceed bounce rate threshold', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/low-bounce',
              url: 'https://example.com/low-bounce',
              bounceRate: 0.2, // Below 0.3 threshold
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
              bounceRate: 0.5,
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
              bounceRate: 0.5,
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
      expect(sentMessage.data).to.have.property('bounceRate', 0.5);
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
              bounceRate: 0.5,
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

    it('should handle pages with bounce rate exactly at threshold', async () => {
      const auditData = {
        id: 'test-audit-id',
        auditResult: {
          predominantlyPaidPages: [
            {
              path: '/page1',
              url: 'https://example.com/page1',
              bounceRate: 0.3, // Exactly at threshold
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
      expect(sentMessage.data.bounceRate).to.equal(0.3);
    });
  });
});
