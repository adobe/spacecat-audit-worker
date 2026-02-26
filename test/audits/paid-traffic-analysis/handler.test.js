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
import { AWSAthenaClient } from '@adobe/spacecat-shared-athena-client';
import {
  importDataStep,
  importDecisionDataStep,
  analyzeAndReportStep,
  prepareTrafficAnalysisRequest,
  sendRequestToMystique,
  buildMystiqueMessage,
  getWeeksForMonth,
} from '../../../src/paid-traffic-analysis/handler.js';

use(sinonChai);
use(chaiAsPromised);

const auditUrl = 'https://example.com';
const siteId = 'site-123';

function createMockConfig(sandbox, overrides = {}) {
  return {
    getImports: () => [],
    enableImport: sandbox.stub(),
    disableImport: sandbox.stub(),
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

function createSite(sandbox, overrides = {}) {
  const mockConfig = createMockConfig(sandbox);
  return {
    getId: () => siteId,
    getSiteId: () => siteId,
    getDeliveryType: () => 'aem_edge',
    getBaseURL: () => auditUrl,
    getIsLive: () => true,
    getConfig: () => mockConfig,
    setConfig: sandbox.stub(),
    save: sandbox.stub().resolves(),
    getPageTypes: sandbox.stub().resolves(null),
    ...overrides,
  };
}

describe('Paid Traffic Analysis Handler', () => {
  let sandbox;
  let clock;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Fixed date: Tuesday, January 14, 2025
    clock = sinon.useFakeTimers(new Date('2025-01-14T10:00:00Z'));
  });

  afterEach(() => {
    sandbox.restore();
    clock.restore();
  });

  describe('getWeeksForMonth', () => {
    it('should return weeks belonging to the target month using 20-week lookback', () => {
      const weeks = getWeeksForMonth(12, 2024);
      expect(weeks).to.be.an('array');
      expect(weeks.length).to.be.greaterThan(0);
      weeks.forEach(({ year }) => {
        expect(year).to.equal(2024);
      });
    });

    it('should return empty array for a month outside the 20-week lookback', () => {
      // 20 weeks back from Jan 14 2025 goes to about late August 2024
      const weeks = getWeeksForMonth(6, 2024);
      expect(weeks).to.deep.equal([]);
    });
  });

  describe('buildMystiqueMessage', () => {
    it('should include week number for weekly period', () => {
      const site = createSite(sandbox);
      const auditResult = {
        siteId, year: 2025, month: 1, week: 2,
        temporalCondition: '(year=2025 AND month=1 AND week=2)', period: 'weekly',
      };

      const msg = buildMystiqueMessage(site, 'audit-1', auditUrl, auditResult);

      expect(msg.data.week).to.equal(2);
      expect(msg.type).to.equal('guidance:traffic-analysis');
      expect(msg.auditId).to.equal('audit-1');
    });

    it('should set week to 0 for monthly period', () => {
      const site = createSite(sandbox);
      const auditResult = {
        siteId, year: 2024, month: 12,
        temporalCondition: '(year=2024 AND month=12)', period: 'monthly',
      };

      const msg = buildMystiqueMessage(site, 'audit-2', auditUrl, auditResult);

      expect(msg.data.week).to.equal(0);
    });
  });

  describe('prepareTrafficAnalysisRequest', () => {
    it('should prepare weekly analysis request correctly', async () => {
      const site = createSite(sandbox);
      const context = { log: { debug: sandbox.spy() } };

      const result = await prepareTrafficAnalysisRequest(auditUrl, context, site, 'weekly');

      expect(result.auditResult).to.include({
        year: 2025,
        week: 2,
        month: 1,
        siteId,
        period: 'weekly',
      });
      expect(result.fullAuditRef).to.equal(auditUrl);
      expect(result.auditResult.temporalCondition).to.include('week=2');
    });

    it('should prepare monthly analysis request correctly', async () => {
      const site = createSite(sandbox);
      const context = { log: { debug: sandbox.spy() } };

      const result = await prepareTrafficAnalysisRequest(auditUrl, context, site, 'monthly');

      expect(result.auditResult).to.include({
        year: 2024,
        month: 12,
        siteId,
        period: 'monthly',
      });
      expect(result.auditResult).to.not.have.property('week');
      expect(result.fullAuditRef).to.equal(auditUrl);
    });
  });

  describe('sendRequestToMystique', () => {
    it('should warm cache and send weekly message', async function () {
      this.timeout(5000);
      const site = createSite(sandbox);
      const mockSqs = { sendMessage: sandbox.stub().resolves() };
      const mockAthenaClient = { query: sandbox.stub().resolves([]) };
      sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClient);
      const mockS3Client = {
        send: sandbox.stub().resolves({ ContentLength: 1024, LastModified: new Date() }),
      };

      const context = {
        log: { debug: sandbox.spy(), info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() },
        sqs: mockSqs,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          RUM_METRICS_DATABASE: 'rum_db',
          RUM_METRICS_COMPACT_TABLE: 'compact_table',
        },
        siteId,
        s3Client: mockS3Client,
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      };

      const auditData = {
        id: 'audit-456',
        auditResult: {
          year: 2025, week: 2, month: 1, siteId,
          temporalCondition: '(year=2025 AND month=1 AND week=2)', period: 'weekly',
        },
      };

      await sendRequestToMystique(auditUrl, auditData, context, site);

      expect(mockSqs.sendMessage).to.have.been.calledOnceWith(
        'test-queue',
        sinon.match({
          type: 'guidance:traffic-analysis',
          siteId,
          auditId: 'audit-456',
          data: sinon.match({ week: 2 }),
        }),
      );
    });

    it('should send monthly message with week=0', async function () {
      this.timeout(5000);
      const site = createSite(sandbox);
      const mockSqs = { sendMessage: sandbox.stub().resolves() };
      const mockAthenaClient = { query: sandbox.stub().resolves([]) };
      sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClient);
      const mockS3Client = {
        send: sandbox.stub().resolves({ ContentLength: 1024, LastModified: new Date() }),
      };

      const context = {
        log: { debug: sandbox.spy(), info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() },
        sqs: mockSqs,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          RUM_METRICS_DATABASE: 'rum_db',
          RUM_METRICS_COMPACT_TABLE: 'compact_table',
        },
        siteId,
        s3Client: mockS3Client,
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      };

      const auditData = {
        id: 'audit-789',
        auditResult: {
          year: 2024, month: 12, siteId,
          temporalCondition: '(year=2024 AND month=12)', period: 'monthly',
        },
      };

      await sendRequestToMystique(auditUrl, auditData, context, site);

      expect(mockSqs.sendMessage).to.have.been.calledOnceWith(
        'test-queue',
        sinon.match({
          data: sinon.match({ week: 0 }),
        }),
      );
    });

    it('should handle SQS errors gracefully', async () => {
      const site = createSite(sandbox);
      const mockSqs = { sendMessage: sandbox.stub().rejects(new Error('SQS Error')) };
      const mockAthenaClient = { query: sandbox.stub().resolves([]) };
      sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClient);
      const mockS3Client = {
        send: sandbox.stub().resolves({ ContentLength: 1024, LastModified: new Date() }),
      };

      const context = {
        log: { debug: sandbox.spy(), info: sandbox.spy(), warn: sandbox.spy(), error: sandbox.spy() },
        sqs: mockSqs,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          RUM_METRICS_DATABASE: 'rum_db',
          RUM_METRICS_COMPACT_TABLE: 'compact_table',
        },
        siteId,
        s3Client: mockS3Client,
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
      };

      const auditData = {
        id: 'audit-456',
        auditResult: {
          year: 2025, week: 2, month: 1, siteId,
          temporalCondition: '(year=2025 AND month=1)', period: 'weekly',
        },
      };

      await expect(
        sendRequestToMystique(auditUrl, auditData, context, site),
      ).to.be.rejectedWith('SQS Error');
    });
  });

  describe('importDataStep', () => {
    let mockSqs;
    let mockConfiguration;
    let site;

    beforeEach(() => {
      mockSqs = { sendMessage: sandbox.stub().resolves() };
      mockConfiguration = {
        getQueues: sandbox.stub().returns({ imports: 'test-import-queue' }),
      };
      site = createSite(sandbox);
    });

    function createImportContext(overrides = {}) {
      return {
        site,
        finalUrl: auditUrl,
        log: {
          info: sandbox.spy(), debug: sandbox.spy(),
          warn: sandbox.spy(), error: sandbox.spy(),
        },
        sqs: mockSqs,
        dataAccess: {
          Configuration: { findLatest: sandbox.stub().resolves(mockConfiguration) },
        },
        ...overrides,
      };
    }

    it('should enable import when not already enabled', async () => {
      const context = createImportContext();

      await importDataStep(context);

      expect(site.getConfig().enableImport).to.have.been.calledWith('traffic-analysis');
    });

    it('should NOT re-enable import when already enabled', async () => {
      const mockConfig = createMockConfig(sandbox, {
        getImports: () => [{ type: 'traffic-analysis', enabled: true }],
      });
      const siteWithImport = createSite(sandbox, { getConfig: () => mockConfig });
      const context = createImportContext({ site: siteWithImport });

      await importDataStep(context);

      expect(mockConfig.enableImport).to.not.have.been.called;
    });

    it('should throw error when site config is null', async () => {
      const siteWithNullConfig = createSite(sandbox, { getConfig: () => null });
      const context = createImportContext({ site: siteWithNullConfig });

      await expect(importDataStep(context))
        .to.be.rejectedWith(/site config is null/);
    });

    it('should collect and deduplicate weeks for import', async () => {
      const context = createImportContext();

      const result = await importDataStep(context);

      // Should have sent at least some SQS import messages (all-but-last)
      expect(mockSqs.sendMessage.callCount).to.be.greaterThan(0);

      // Each message should have correct structure
      mockSqs.sendMessage.getCalls().forEach((call) => {
        const [queueUrl, message] = call.args;
        expect(queueUrl).to.equal('test-import-queue');
        expect(message).to.include({ type: 'traffic-analysis', siteId, allowCache: true });
        expect(message.auditContext).to.have.all.keys('week', 'year');
      });

      // Return value should be the last week for chaining
      expect(result).to.include({
        fullAuditRef: auditUrl,
        type: 'traffic-analysis',
        siteId,
        allowCache: true,
      });
      expect(result.auditResult).to.have.property('status', 'pending');
      expect(result.auditContext).to.have.all.keys('week', 'year');
    });

    it('should return correct structure for import worker chaining', async () => {
      const context = createImportContext();

      const result = await importDataStep(context);

      expect(result).to.have.all.keys(
        'auditResult', 'fullAuditRef', 'type', 'siteId', 'allowCache', 'auditContext',
      );
      expect(result.auditResult.message).to.match(/Importing decision data for week/);
    });

    it('should chain the most recent decision week', async () => {
      const context = createImportContext();

      const result = await importDataStep(context);

      // The chained week should be the most recent decision week (week 2 of 2025)
      expect(result.auditContext.week).to.equal(2);
      expect(result.auditContext.year).to.equal(2025);
    });
  });

  describe('importDecisionDataStep', () => {
    it('should return correct structure for import worker chaining', async () => {
      const site = createSite(sandbox);
      const context = {
        site,
        finalUrl: auditUrl,
        log: {
          info: sandbox.spy(), debug: sandbox.spy(),
          warn: sandbox.spy(), error: sandbox.spy(),
        },
      };

      const result = await importDecisionDataStep(context);

      expect(result).to.have.all.keys(
        'auditResult', 'fullAuditRef', 'type', 'siteId', 'allowCache', 'auditContext',
      );
      expect(result.type).to.equal('traffic-analysis');
      expect(result.siteId).to.equal(siteId);
      expect(result.allowCache).to.equal(true);
      expect(result.auditResult.status).to.equal('pending');
      expect(result.auditResult.message).to.match(/Importing decision data for week/);
    });

    it('should chain the oldest decision week', async () => {
      const site = createSite(sandbox);
      const context = {
        site,
        finalUrl: auditUrl,
        log: {
          info: sandbox.spy(), debug: sandbox.spy(),
          warn: sandbox.spy(), error: sandbox.spy(),
        },
      };

      const result = await importDecisionDataStep(context);

      // The chained week should be the oldest decision week (week 51 of 2024)
      expect(result.auditContext.week).to.equal(51);
      expect(result.auditContext.year).to.equal(2024);
    });
  });

  describe('analyzeAndReportStep', () => {
    let mockSqs;
    let mockAthenaQueryStub;
    let site;

    beforeEach(() => {
      mockSqs = { sendMessage: sandbox.stub().resolves() };
      mockAthenaQueryStub = sandbox.stub();
      const mockAthenaClient = { query: mockAthenaQueryStub };
      sandbox.stub(AWSAthenaClient, 'fromContext').returns(mockAthenaClient);
      site = createSite(sandbox);
    });

    function createAnalyzeContext(queryResult, overrides = {}) {
      mockAthenaQueryStub.resolves(queryResult);

      const weeklyAudit = {
        getId: sandbox.stub().returns('weekly-audit-id'),
        getAuditResult: sandbox.stub(),
      };
      const monthlyAudit = {
        getId: sandbox.stub().returns('monthly-audit-id'),
        getAuditResult: sandbox.stub(),
      };
      const createStub = sandbox.stub();
      createStub.onFirstCall().resolves(weeklyAudit);
      createStub.onSecondCall().resolves(monthlyAudit);

      return {
        site,
        log: {
          info: sandbox.spy(), debug: sandbox.spy(),
          warn: sandbox.spy(), error: sandbox.spy(),
        },
        sqs: mockSqs,
        env: {
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
          S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          RUM_METRICS_DATABASE: 'rum_metrics',
          RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
        },
        dataAccess: {
          Audit: { create: createStub },
          Opportunity: {
            allBySiteId: sandbox.stub().resolves([]),
          },
        },
        s3Client: {
          send: sandbox.stub().resolves({ ContentLength: 1024, LastModified: new Date() }),
        },
        siteId,
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        ...overrides,
      };
    }

    describe('decision logic', () => {
      it('should return NOT_ENOUGH_DATA when totalPageViewSum < 30K', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '20000' }]);

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.totalPageViewSum).to.equal(20000);
        expect(result.auditResult.reportDecision).to.equal('not enough data');
        expect(result.fullAuditRef).to.equal(auditUrl);
        // No child audits or Mystique messages
        expect(ctx.dataAccess.Audit.create).to.not.have.been.called;
        expect(mockSqs.sendMessage).to.not.have.been.called;
      });

      it('should return NOT_ENOUGH_DATA when totalPageViewSum is 0', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '0' }]);

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.totalPageViewSum).to.equal(0);
        expect(result.auditResult.reportDecision).to.equal('not enough data');
      });

      it('should return NOT_ENOUGH_DATA when query result is empty', async () => {
        const ctx = createAnalyzeContext([]);

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.totalPageViewSum).to.equal(0);
        expect(result.auditResult.reportDecision).to.equal('not enough data');
      });

      it('should return MONTHLY when totalPageViewSum is exactly 30K', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '30000' }]);

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportDecision).to.equal('monthly report');
      });

      it('should return WEEKLY when totalPageViewSum is exactly 120K', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '120000' }]);

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportDecision).to.equal('weekly report');
      });
    });

    describe('MONTHLY decision', () => {
      it('should create 1 child audit (monthly) and send 1 Mystique message', async () => {
        const monthlyAudit = {
          getId: sandbox.stub().returns('monthly-audit-id'),
        };
        const createStub = sandbox.stub().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '50000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportDecision).to.equal('monthly report');
        expect(result.auditResult.reportsGenerated).to.deep.equal(['monthly']);
        // Only 1 child audit record (monthly only, no weekly)
        expect(createStub).to.have.been.calledOnce;
        const createArgs = createStub.firstCall.args[0];
        expect(createArgs.auditResult.period).to.equal('monthly');
        expect(createArgs.auditType).to.equal('paid-traffic-analysis');
        // 1 Mystique message
        expect(mockSqs.sendMessage).to.have.been.calledOnce;
      });
    });

    describe('WEEKLY decision', () => {
      it('should create 2 child audits (weekly + monthly) and send 2 Mystique messages', async () => {
        const weeklyAudit = { getId: sandbox.stub().returns('weekly-audit-id') };
        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub();
        createStub.onFirstCall().resolves(weeklyAudit);
        createStub.onSecondCall().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '500000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportDecision).to.equal('weekly report');
        expect(result.auditResult.reportsGenerated).to.deep.equal(['weekly', 'monthly']);
        // 2 child audit records
        expect(createStub).to.have.been.calledTwice;
        const weeklyArgs = createStub.firstCall.args[0];
        expect(weeklyArgs.auditResult.period).to.equal('weekly');
        expect(weeklyArgs.auditResult.week).to.be.a('number');
        const monthlyArgs = createStub.secondCall.args[0];
        expect(monthlyArgs.auditResult.period).to.equal('monthly');
        expect(monthlyArgs.auditResult).to.not.have.property('week');
        // 2 Mystique messages
        expect(mockSqs.sendMessage).to.have.been.calledTwice;
      });

      it('should use correct auditIds in Mystique messages', async () => {
        const weeklyAudit = { getId: sandbox.stub().returns('weekly-audit-id') };
        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub();
        createStub.onFirstCall().resolves(weeklyAudit);
        createStub.onSecondCall().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '500000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([]) },
          },
        });

        await analyzeAndReportStep(ctx);

        // First Mystique message should use weekly audit ID
        const firstCall = mockSqs.sendMessage.firstCall.args[1];
        expect(firstCall.auditId).to.equal('weekly-audit-id');
        // Second Mystique message should use monthly audit ID
        const secondCall = mockSqs.sendMessage.secondCall.args[1];
        expect(secondCall.auditId).to.equal('monthly-audit-id');
      });
    });

    describe('monthly report skip-if-exists', () => {
      it('should skip monthly report when opportunity already exists for the period', async () => {
        const existingOppty = {
          getType: () => 'paid-traffic',
          getData: () => ({ month: 12, year: 2024, week: undefined }),
        };

        const weeklyAudit = { getId: sandbox.stub().returns('weekly-audit-id') };
        const createStub = sandbox.stub().resolves(weeklyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '500000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([existingOppty]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportDecision).to.equal('weekly report');
        // Only weekly child audit created (monthly skipped)
        expect(createStub).to.have.been.calledOnce;
        expect(createStub.firstCall.args[0].auditResult.period).to.equal('weekly');
        expect(result.auditResult.reportsGenerated).to.deep.equal(['weekly']);
        // Only 1 Mystique message (weekly only)
        expect(mockSqs.sendMessage).to.have.been.calledOnce;
      });

      it('should generate monthly report when no matching opportunity exists', async () => {
        // Existing opportunity is for a different month
        const existingOppty = {
          getType: () => 'paid-traffic',
          getData: () => ({ month: 11, year: 2024, week: undefined }),
        };

        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '50000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([existingOppty]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportsGenerated).to.deep.equal(['monthly']);
        expect(createStub).to.have.been.calledOnce;
      });

      it('should not skip when existing opportunity is weekly (has week property)', async () => {
        // Existing opportunity has a week — it's a weekly report, not monthly
        const existingOppty = {
          getType: () => 'paid-traffic',
          getData: () => ({ month: 12, year: 2024, week: 50 }),
        };

        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '50000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([existingOppty]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        // Monthly report should still be generated (existing is weekly, not monthly)
        expect(result.auditResult.reportsGenerated).to.deep.equal(['monthly']);
        expect(createStub).to.have.been.calledOnce;
      });

      it('should not skip when existing opportunity is a different type', async () => {
        const existingOppty = {
          getType: () => 'other-type',
          getData: () => ({ month: 12, year: 2024 }),
        };

        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '50000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([existingOppty]) },
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.reportsGenerated).to.deep.equal(['monthly']);
      });
    });

    describe('child audit records', () => {
      it('should have correct fields in child audit records', async () => {
        const weeklyAudit = { getId: sandbox.stub().returns('weekly-audit-id') };
        const monthlyAudit = { getId: sandbox.stub().returns('monthly-audit-id') };
        const createStub = sandbox.stub();
        createStub.onFirstCall().resolves(weeklyAudit);
        createStub.onSecondCall().resolves(monthlyAudit);

        const ctx = createAnalyzeContext([{ total_pageview_sum: '500000' }], {
          dataAccess: {
            Audit: { create: createStub },
            Opportunity: { allBySiteId: sandbox.stub().resolves([]) },
          },
        });

        await analyzeAndReportStep(ctx);

        // Weekly child audit
        const weeklyArgs = createStub.firstCall.args[0];
        expect(weeklyArgs.siteId).to.equal(siteId);
        expect(weeklyArgs.isLive).to.equal(true);
        expect(weeklyArgs.auditType).to.equal('paid-traffic-analysis');
        expect(weeklyArgs.fullAuditRef).to.equal(auditUrl);
        expect(weeklyArgs.auditedAt).to.be.a('string');
        expect(weeklyArgs.auditResult.temporalCondition).to.be.a('string');

        // Monthly child audit
        const monthlyArgs = createStub.secondCall.args[0];
        expect(monthlyArgs.siteId).to.equal(siteId);
        expect(monthlyArgs.auditType).to.equal('paid-traffic-analysis');
        expect(monthlyArgs.auditResult.temporalCondition).to.be.a('string');
      });
    });

    describe('error handling', () => {
      it('should throw when S3_IMPORTER_BUCKET_NAME is missing', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '100000' }], {
          env: {
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
            RUM_METRICS_DATABASE: 'rum_metrics',
            RUM_METRICS_COMPACT_TABLE: 'compact_metrics',
          },
        });

        await expect(analyzeAndReportStep(ctx))
          .to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided');
      });

      it('should throw when Athena query fails', async () => {
        mockAthenaQueryStub.rejects(new Error('Athena connection failed'));

        const ctx = createAnalyzeContext([]); // queryResult doesn't matter since we reject
        // Override the stub so it rejects
        mockAthenaQueryStub.rejects(new Error('Athena connection failed'));

        await expect(analyzeAndReportStep(ctx))
          .to.be.rejectedWith('Athena connection failed');
      });

      it('should use default values for missing database and table env vars', async () => {
        const ctx = createAnalyzeContext([{ total_pageview_sum: '20000' }], {
          env: {
            QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
            S3_IMPORTER_BUCKET_NAME: 'test-bucket',
          },
        });

        const result = await analyzeAndReportStep(ctx);

        expect(result.auditResult.totalPageViewSum).to.equal(20000);
        expect(result.auditResult.reportDecision).to.equal('not enough data');
      });
    });
  });
});
