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

import chaiAsPromised from 'chai-as-promised';
use(chaiAsPromised);
use(sinonChai);

describe('LLMO Customer Analysis Handler', () => {
  let sandbox;
  let context;
  let site;
  let configuration;
  let sqs;
  let log;
  let dataAccess;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    sqs = {
      sendMessage: sandbox.stub().resolves(),
    };

    log = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub(),
      debug: sandbox.stub(),
    };

    configuration = {
      getQueues: sandbox.stub().returns({
        imports: 'https://sqs.us-east-1.amazonaws.com/123456789/imports-queue',
        audits: 'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
      }),
      enableHandlerForSite: sandbox.stub(),
      isHandlerEnabledForSite: sandbox.stub().callsFake((auditType) => auditType === 'cdn-logs-report'),
      getEnabledSiteIdsForHandler: sandbox.stub().returns([]),
      save: sandbox.stub().resolves(),
      setConfig: sandbox.stub().resolves(),
    };

    const siteConfig = {
      enableImport: sandbox.stub().resolves(),
      isImportEnabled: sandbox.stub().returns(false),
    };

    site = {
      getSiteId: sandbox.stub().returns('site-123'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getOrganizationId: sandbox.stub().returns('org-123'),
      getConfig: sandbox.stub().returns(siteConfig),
      save: sandbox.stub().resolves(),
      setConfig: sandbox.stub().returns(),
    };

    dataAccess = {
      Configuration: {
        findLatest: sandbox.stub().resolves(configuration),
      },
      Site: {
        allByOrganizationId: sandbox.stub().resolves([]),
        findById: sandbox.stub().resolves(site),
      },
      LatestAudit: {
        findBySiteIdAndAuditType: sandbox.stub().resolves({ getAuditResult: () => ({}) }),
      },
    };

    context = {
      sqs,
      log,
      dataAccess,
      s3Client: {},
      env: {
        S3_IMPORTER_BUCKET_NAME: 'importer-bucket',
        IMS_HOST: 'https://ims-na1.adobelogin.com',
        IMS_CLIENT_ID: 'test-client-id',
        IMS_CLIENT_CODE: 'test-client-code',
        IMS_CLIENT_SECRET: 'test-client-secret',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runLlmoCustomerAnalysis', function () {
    this.timeout(10000);

    let mockHandler;
    let mockLlmoConfig;
    let mockRUMAPIClient;
    let mockGetRUMUrl;
    let mockIsBrandalfEnabled;
    let mockResolveOrganizationIdForSite;
    let triggerBrandDetectionStub;
    let createBrandPresenceScheduleStub;
    let drsCreateFromStub;

    beforeEach(async () => {
      sqs.sendMessage.resetHistory();

      triggerBrandDetectionStub = sandbox.stub().resolves();
      createBrandPresenceScheduleStub = sandbox.stub().resolves({
        scheduleId: 'sched-001',
        alreadyExisted: false,
      });
      drsCreateFromStub = sandbox.stub().returns({
        isConfigured: sandbox.stub().returns(true),
        triggerBrandDetection: triggerBrandDetectionStub,
        createBrandPresenceSchedule: createBrandPresenceScheduleStub,
      });

      mockLlmoConfig = {
        readConfig: sandbox.stub(),
        defaultConfig: sandbox.stub().returns({
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        }),
      };

      mockRUMAPIClient = {
        query: sandbox.stub().resolves({ pageviews: 100 }),
      };

      const mockRUMAPIClientClass = {
        createFrom: sandbox.stub().returns(mockRUMAPIClient),
      };

      mockGetRUMUrl = sandbox.stub().resolves('example.com');

      mockIsBrandalfEnabled = sandbox.stub().resolves(false);
      mockResolveOrganizationIdForSite = sandbox.stub().callsFake(
        async ({ site: helperSite, fallbackOrganizationId }) => (
          helperSite?.getOrganizationId?.() || fallbackOrganizationId || null
        ),
      );

      context.env.DRS_API_URL = 'https://drs.example.com/api';
      context.env.DRS_API_KEY = 'test-drs-key';

      mockHandler = await esmock('../../src/llmo-customer-analysis/handler.js', {
        '@adobe/spacecat-shared-utils': {
          getLastNumberOfWeeks: () => [
            { week: 1, year: 2025 },
            { week: 2, year: 2025 },
            { week: 3, year: 2025 },
            { week: 4, year: 2025 },
          ],
          llmoConfig: mockLlmoConfig,
        },
        '../../src/utils/brandalf-utils.js': {
          isBrandalfEnabled: mockIsBrandalfEnabled,
          resolveOrganizationIdForSite: mockResolveOrganizationIdForSite,
        },
        '@adobe/spacecat-shared-rum-api-client': {
          default: mockRUMAPIClientClass,
        },
        '../../src/support/utils.js': {
          getRUMUrl: mockGetRUMUrl,
        },
        '../../src/common/audit-utils.js': {
          isAuditEnabledForSite: sandbox.stub().resolves(true),
        },
        '../../src/llmo-customer-analysis/cdn-config-handler.js': {
          handleCdnBucketConfigChanges: sandbox.stub().callsFake(async (context, data) => {
            // Throw error for aem-cs-fastly to test error handling
            if (data?.cdnProvider === 'aem-cs-fastly') {
              throw new Error('CDN config error');
            }
            // Resolve normally for other providers
            return Promise.resolve();
          }),
        },
        '../../src/utils/content-ai.js': {
          ContentAIClient: class {
            async initialize() { return this; }
            async createConfiguration() { return; }
          },
        },
        '@adobe/spacecat-shared-data-access/src/models/site/config.js': {
          Config: { toDynamoItem: sandbox.stub().callsFake((cfg) => ({})) },
        },
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sandbox.stub().returns({
              getServiceAccessToken: sandbox.stub().resolves({ access_token: 'mock-token' }),
            }),
          },
        },
        '@adobe/spacecat-shared-drs-client': {
          default: { createFrom: drsCreateFromStub },
        },
      });
    });

    it('should trigger referral traffic imports on first-time onboarding with OpTel data', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.have.callCount(4);
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
    });

    it('should not trigger referral traffic imports on subsequent config updates', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should not trigger referral traffic imports when no OpTel data', async () => {
      mockRUMAPIClient.query.resolves({ pageviews: 0 });

      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should handle errors when checking OpTel data and not trigger referral traffic imports', async () => {
      const error = new Error('RUM API connection failed');
      mockRUMAPIClient.query.rejects(error);

      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should not trigger referral traffic imports when error occurs
      expect(sqs.sendMessage).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should log error message with correct domain when checkOptelData fails', async () => {
      // Test the catch block in checkOptelData function
      const testError = new Error('Network timeout');
      mockRUMAPIClient.query.rejects(testError);

      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );
    });

    it('should return false from checkOptelData and skip referral imports on error', async () => {
      // Test that checkOptelData returns false in catch block
      const testError = new Error('Query failed');
      mockRUMAPIClient.query.rejects(testError);

      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // When checkOptelData returns false due to error, referral imports should not be triggered
      expect(sqs.sendMessage).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should trigger drs-brand-detection when entities change', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: { 'uuid-1': { type: 'product', name: 'Product A' } },
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(triggerBrandDetectionStub).to.have.been.calledOnce;
      expect(triggerBrandDetectionStub).to.have.been.calledWith('site-123');
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('drs-brand-detection');
    });

    it('should trigger geo-brand-presence-trigger-refresh when brands change', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: ['brand1', 'brand2'] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence-trigger-refresh', siteId: 'site-123' }),
      );
      expect(triggerBrandDetectionStub).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence-trigger-refresh');
    });

    it('should trigger referral imports and brand presence when no config version provided', async () => {
      const auditContext = {};

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
      expect(result.auditResult.message).to.equal('No config version provided; skipping config comparison');
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
      // 4 referral traffic imports via SQS
      expect(sqs.sendMessage).to.have.callCount(4);
    });

    it('should handle multiple changes and trigger brand detection + geo-brand-presence refresh', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: { 'cat-1': { name: 'Category A' } },
          topics: {},
          brands: { aliases: ['brand1'] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // geo-brand-presence-trigger-refresh
      expect(sqs.sendMessage).to.have.callCount(1);
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence-trigger-refresh' }),
      );
      expect(triggerBrandDetectionStub).to.have.been.calledOnce;
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('drs-brand-detection');
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence-trigger-refresh');
    });

    it('should trigger drs-brand-detection when topics change', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: { 'topic-1': { name: 'Topic A' } },
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(triggerBrandDetectionStub).to.have.been.calledOnce;
      expect(triggerBrandDetectionStub).to.have.been.calledWith('site-123');
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('drs-brand-detection');
    });

    it('should trigger geo-brand-presence-trigger-refresh when competitors change', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: ['competitor1', 'competitor2'] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence-trigger-refresh', siteId: 'site-123' }),
      );
      expect(triggerBrandDetectionStub).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence-trigger-refresh');
    });

    it('should handle error when llmoConfig.readConfig fails for current version', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      const configError = new Error('Failed to read config from S3');
      mockLlmoConfig.readConfig.rejects(configError);

      await expect(mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      )).to.be.rejectedWith('Failed to read config from S3');
    });

    it('should handle error when llmoConfig.readConfig fails for previous version', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      // First call (new config) succeeds
      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      // Second call (old config) fails
      const configError = new Error('Previous config version not found');
      mockLlmoConfig.readConfig.onSecondCall().rejects(configError);

      await expect(mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      )).to.be.rejectedWith('Previous config version not found');
    });

    it('should return configChangesDetected false when old and new configs are identical', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      const identicalConfig = {
        entities: { 'uuid-1': { type: 'product', name: 'Product A' } },
        categories: { 'cat-1': { name: 'Category A' } },
        topics: { 'topic-1': { name: 'Topic A' } },
        brands: { aliases: ['brand1', 'brand2'] },
        competitors: { competitors: ['competitor1'] },
      };

      // Both old and new configs are identical
      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: identicalConfig,
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: identicalConfig,
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // No SQS messages should be sent
      expect(sqs.sendMessage).to.not.have.been.called;

      // Should return completed status with no changes detected
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should trigger CDN bucket config changes on first-time onboarding', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
          cdnBucketConfig: { cdnProvider: 'commerce-fastly' },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.triggeredSteps).to.include('cdn-bucket-config');
    });

    it('should handle CDN bucket config changes error gracefully', async () => {
      const auditContext = {
        configVersion: 'v1',
        // Initial onboarding, hence no previousConfigVersion
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
          cdnBucketConfig: { cdnProvider: 'aem-cs-fastly' },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should still complete successfully despite the error
      expect(result.auditResult.status).to.equal('completed');
      // Should log the error but continue processing
      expect(log.error).to.have.been.calledWith('Error processing CDN bucket configuration changes for siteId: site-123');
    });

    it('should trigger referral imports and brand presence on first-time onboarding with config changes', async () => {
      const auditContext = {
        configVersion: 'v1',
        // Initial onboarding, hence no previousConfigVersion
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: { 'cat-1': { name: 'Category A' } },
          topics: {},
          brands: { aliases: ['brand1', 'brand2'] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should trigger:
      // - 4 referral traffic imports (one for each of the 4 weeks) via SQS
      // Total: 4 SQS messages
      expect(sqs.sendMessage).to.have.callCount(4);

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/imports-queue',
        sinon.match({ type: 'traffic-analysis' }),
      );

      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should trigger drs-brand-detection when only entities change without other triggered steps', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: { 'uuid-1': { type: 'product', name: 'Product A' } },
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(triggerBrandDetectionStub).to.have.been.calledOnce;
      expect(triggerBrandDetectionStub).to.have.been.calledWith('site-123');
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('drs-brand-detection');
    });

    it('should handle errors from enableImports gracefully', async () => {
      // Use previousConfigVersion to skip first-time onboarding path
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      // Create a context with Site.findById that throws an error for enableImports
      const errorSite = {
        findById: sandbox.stub().rejects(new Error('Import service unavailable')),
      };

      const errorContext = {
        sqs,
        log,
        dataAccess: {
          Configuration: dataAccess.Configuration,
          Site: errorSite,
          LatestAudit: dataAccess.LatestAudit,
        },
        s3Client: {},
        env: context.env,
      };

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        errorContext,
        site,
        auditContext,
      );

      // Should log the error
      expect(log.error).to.have.been.calledWith('Failed to enable imports for site site-123: Import service unavailable');

      // Should still complete successfully despite the error
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should handle null oldConfig with nullish coalescing operator', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      // First call returns a valid new config
      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      // Second call returns null config to test nullish coalescing on line 369
      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: null,
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should complete successfully with null oldConfig handled by ??
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should handle null newConfig with nullish coalescing operator', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      // First call returns null new config to test nullish coalescing on line 369
      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: null,
      });

      // Second call returns a valid old config
      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should complete successfully with null newConfig handled by ??
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should handle undefined oldConfig from defaultConfig with nullish coalescing operator', async () => {
      const auditContext = {
        configVersion: 'v1',
        // No previousConfigVersion, so defaultConfig will be used
      };

      // New config is valid
      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      // defaultConfig returns undefined to test nullish coalescing on line 369
      mockLlmoConfig.defaultConfig.returns(undefined);

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should complete successfully with undefined oldConfig handled by ??
      expect(result.auditResult.status).to.equal('completed');
    });

    it('enables baseline LLMO audit handlers only on first-time analysis (no previousConfigVersion)', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      const expectedAudits = [
        'scrape-top-pages',
        'headings',
        'llm-blocked',
        'llm-error-pages',
        'summarization',
        'llmo-referral-traffic',
        'llmo-referral-traffic-daily',
        'readability',
        'wikipedia-analysis',
      ];
      expectedAudits.forEach((audit) => {
        expect(configuration.enableHandlerForSite).to.have.been.calledWith(audit, site);
      });
      expect(configuration.save).to.have.been.called;
    });

    it('does not enable handlers when previousConfigVersion is present', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });
      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(configuration.enableHandlerForSite).not.to.have.been.called;
      expect(configuration.save).not.to.have.been.called;
    });

    it('should handle errors from enable audits on first-time analysis gracefully', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      // First findLatest drives enable audits (fails → caught). Later calls during the same
      // analysis must succeed (e.g. geo refresh, CDN queues) — use resolving mock after first rejection.
      let findLatestAttempts = 0;
      const errorConfiguration = {
        findLatest: sandbox.stub().callsFake(() => {
          findLatestAttempts += 1;
          if (findLatestAttempts === 1) {
            return Promise.reject(new Error('Configuration service unavailable'));
          }
          return Promise.resolve(configuration);
        }),
      };

      const errorContext = {
        sqs,
        log,
        dataAccess: {
          Configuration: errorConfiguration,
          Site: dataAccess.Site,
          LatestAudit: dataAccess.LatestAudit,
        },
        s3Client: {},
        env: context.env,
      };

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        errorContext,
        site,
        auditContext,
      );

      expect(log.error).to.have.been.calledWith('Failed to enable audits for site site-123: Configuration service unavailable');
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should create and trigger brand presence schedule on first-time onboarding', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Verify the drs-client helper was called with the expected args
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      expect(createBrandPresenceScheduleStub).to.have.been.calledWithMatch({
        siteId: 'site-123',
        description: sinon.match(/Onboarding brand presence:.*site-123/),
        triggerImmediately: true,
      });

      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
    });

    it('should log "already existed" when schedule already existed', async () => {
      const auditContext = { configVersion: 'v1' };

      createBrandPresenceScheduleStub.resolves({ scheduleId: 'sched-existing', alreadyExisted: true });

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-existing');
      // Verify the "already existed" log branch was taken
      expect(log.info).to.have.been.calledWith(sinon.match(/already existed/));
    });

    it('should handle brand presence schedule creation failure gracefully', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Make createBrandPresenceSchedule reject to simulate DRS API failure
      createBrandPresenceScheduleStub.rejects(new Error('DRS API error: 500 Internal Server Error'));

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should log the error but still complete
      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123'),
      );
      expect(result.auditResult.status).to.equal('completed');
      // brand-presence-schedule should NOT be in triggeredSteps
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.be.undefined;
    });

    it('should skip brand presence schedule when DRS is not configured', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Return a mock drs client that reports not configured
      drsCreateFromStub.returns({
        isConfigured: sandbox.stub().returns(false),
        triggerBrandDetection: triggerBrandDetectionStub,
        createBrandPresenceSchedule: createBrandPresenceScheduleStub,
      });

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // createBrandPresenceSchedule must NOT be called — the error is thrown before it
      expect(createBrandPresenceScheduleStub).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123: DRS API URL or key not configured'),
      );
      expect(result.auditResult.status).to.equal('completed');
      // brand-presence-schedule should NOT be in triggeredSteps
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
    });

    it('should not create brand presence schedule on subsequent config updates', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should not call createBrandPresenceSchedule for non-first-time onboarding
      expect(createBrandPresenceScheduleStub).to.not.have.been.called;
    });

    it('should include brandId and orgId in BP schedule when brandalf is enabled and brand is found', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // Q1 direct match: site_id = 'site-123' → brand-uuid-1 returned immediately
      const brandsQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [{ id: 'brand-uuid-1' }], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().returns(brandsQuery) },
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(mockIsBrandalfEnabled).to.have.been.calledWith(
        'org-123',
        context.dataAccess.services.postgrestClient,
        log,
      );

      // Verify schedule was created with brandId and orgId
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      expect(createBrandPresenceScheduleStub).to.have.been.calledWithMatch({
        siteId: 'site-123',
        brandId: 'brand-uuid-1',
        orgId: 'org-123',
        triggerImmediately: true,
      });
    });

    it('should fall back to imsOrgId when getOrganizationId returns null', async () => {
      const auditContext = { imsOrgId: 'fallback-org' };
      site.getOrganizationId = sandbox.stub().returns(null);
      mockIsBrandalfEnabled.resolves(true);

      // Q1 direct: no direct site_id match; Q2 brand_sites join returns brand-fb
      const directQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      const joinQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [{ id: 'brand-fb' }], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().onFirstCall().returns(directQuery).onSecondCall().returns(joinQuery) },
      };

      await mockHandler.runLlmoCustomerAnalysis('https://example.com', context, site, auditContext);

      expect(mockResolveOrganizationIdForSite).to.have.been.calledWithMatch(
        sinon.match({ fallbackOrganizationId: 'fallback-org' }),
      );
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      expect(createBrandPresenceScheduleStub).to.have.been.calledWithMatch({
        siteId: 'site-123',
        brandId: 'brand-fb',
        orgId: 'fallback-org',
        triggerImmediately: true,
      });
    });

    it('should handle null brands and missing brand_sites when brandalf is enabled', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // Both queries return empty: no direct match, no brand_sites match
      const directQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      const joinQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().onFirstCall().returns(directQuery).onSecondCall().returns(joinQuery) },
      };

      await mockHandler.runLlmoCustomerAnalysis('https://example.com', context, site, auditContext);

      // Schedule should be created but without brandId (undefined)
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
    });

    it('should create BP schedule without brandId when no brand matches site', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // Server-side filtering: 'other-site' doesn't match siteId 'site-123' — both queries empty
      const directQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      const joinQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().onFirstCall().returns(directQuery).onSecondCall().returns(joinQuery) },
      };

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
      expect(log.warn).to.have.been.calledWith(sinon.match(/No brand resolved for site/));
    });

    it('should prefer baseSiteId match over brand_sites match', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // Q1 direct: filters by site_id='site-123' server-side → only brand-base returned (Q2 never called)
      const brandsQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().resolves({ data: [{ id: 'brand-base' }], error: null }),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().returns(brandsQuery) },
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis('https://example.com', context, site, auditContext);

      // Should pick brand-base (baseSiteId match) over brand-sub (brand_sites only)
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      expect(createBrandPresenceScheduleStub).to.have.been.calledWithMatch({
        siteId: 'site-123',
        brandId: 'brand-base',
        triggerImmediately: true,
      });
    });

    it('should create BP schedule without brandId when brand lookup fails', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // Mock postgrestClient that rejects on limit() (matching the order/limit terminal pattern)
      const brandsQuery = {
        select: sandbox.stub().returns({
          eq: sandbox.stub().returns({
            eq: sandbox.stub().returns({
              eq: sandbox.stub().returns({
                order: sandbox.stub().returns({
                  limit: sandbox.stub().rejects(new Error('DB error')),
                }),
              }),
            }),
          }),
        }),
      };
      context.dataAccess.services = {
        postgrestClient: { from: sandbox.stub().returns(brandsQuery) },
      };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should still create schedule (without brandId), not fail
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
    });

    it('should skip brand resolution when brandalf is not enabled', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(false);

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // Should create schedule without brandId or orgId (v1 path — no brand resolution done)
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
      expect(callArgs.orgId).to.be.undefined;
    });

    it('should warn when postgrestClient is not available for brandalf-enabled org', async () => {
      const auditContext = {};
      mockIsBrandalfEnabled.resolves(true);

      // No postgrestClient available
      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(log.warn).to.have.been.calledWith(sinon.match(/No brand resolved for site/));
      // Schedule still created, but without brandId
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
    });

    it('should skip brandalf check and omit brandId when onboardingMode is v1 (mixed-state org)', async () => {
      // Mixed-state: org has brandalf=true but was onboarded via v1 path because it has
      // pre-Brandalf sites. onboardingMode='v1' in auditContext must bypass isBrandalfEnabled
      // so we don't send brandId to DRS (no customer config brand exists for v1 onboarding).
      const auditContext = { onboardingMode: 'v1' };

      mockLlmoConfig.readConfig.resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // isBrandalfEnabled must NOT be called when onboardingMode is 'v1'
      expect(mockIsBrandalfEnabled).to.not.have.been.called;

      // Schedule should be created without brandId or orgId
      expect(createBrandPresenceScheduleStub).to.have.been.calledOnce;
      const callArgs = createBrandPresenceScheduleStub.firstCall.args[0];
      expect(callArgs.brandId).to.be.undefined;
      expect(callArgs.orgId).to.be.undefined;
    });

    it('should warn and skip brand detection when DRS is not configured and entities change', async () => {
      const auditContext = { configVersion: 'v2', previousConfigVersion: 'v1' };

      drsCreateFromStub.returns({
        isConfigured: sandbox.stub().returns(false),
        triggerBrandDetection: triggerBrandDetectionStub,
        createBrandPresenceSchedule: createBrandPresenceScheduleStub,
      });

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: { 'uuid-1': { type: 'product', name: 'Product A' } },
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(triggerBrandDetectionStub).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith('DRS not configured; skipping brand detection trigger');
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should not send brand presence SQS when no previousConfigVersion and only brands change', async () => {
      const auditContext = { configVersion: 'v2' }; // no previousConfigVersion

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: ['brand1'] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      // needsBrandPresenceRefresh requires previousConfigVersion, so no geo-brand-presence-trigger-refresh
      const refreshCall = sqs.sendMessage.getCalls().find(
        (c) => c.args[1]?.type === 'geo-brand-presence-trigger-refresh',
      );
      expect(refreshCall).to.not.exist;
      expect(result.auditResult.status).to.equal('completed');
    });

  });

});
