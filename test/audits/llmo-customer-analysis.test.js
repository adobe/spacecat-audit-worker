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
      isHandlerEnabledForSite: sandbox.stub().returns(false),
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

  describe('runLlmoCustomerAnalysis', () => {
    let mockHandler;
    let mockLlmoConfig;
    let mockRUMAPIClient;
    let mockGetRUMUrl;
    let mockFetch;

    beforeEach(async () => {
      sqs.sendMessage.resetHistory();

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

      // Default mock fetch for DRS schedule API calls
      mockFetch = sandbox.stub();
      // POST /schedules - create schedule
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: async () => ({ schedule_id: 'sched-001' }),
      });
      // POST /schedules/{site_id}/{schedule_id}/trigger - trigger schedule
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: async () => ({}),
      });

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
          tracingFetch: mockFetch,
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
      });
    });

    it('should detect AI categorization changes and trigger cdn-logs-report', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {
            'cat-1': { name: 'AI Generated Category', region: 'us', origin: 'ai' },
          },
          topics: {},
          ai_topics: {
            'topic-1': {
              name: 'AI Generated Topic',
              category: 'cat-1',
              prompts: [
                {
                  prompt: 'AI Generated Prompt',
                  regions: ['us'],
                  origin: 'ai',
                  source: 'api',
                },
              ],
            },
          },
          brands: { aliases: [] },
          competitors: { competitors: [] },
        },
      });

      mockLlmoConfig.readConfig.onSecondCall().resolves({
        config: {
          entities: {},
          categories: {},
          topics: {},
          ai_topics: {},
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

      expect(sqs.sendMessage).to.have.callCount(1);
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
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

    it('should detect brand presence changes when entities change', async () => {
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
      expect(log.info).to.have.been.calledWith(
        'LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run',
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should detect brand presence changes when brands change', async () => {
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

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith(
        'LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run',
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should enable audits and trigger referral imports when no config version provided', async () => {
      const auditContext = {};

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
      expect(result.auditResult.message).to.equal('Audits enabled (no config version provided, skipping config comparison)');
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
      // 4 referral traffic imports via SQS
      expect(sqs.sendMessage).to.have.callCount(4);
    });

    it('should handle multiple changes and trigger cdn-logs-report', async () => {
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

      expect(sqs.sendMessage).to.have.callCount(1);
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
    });

    it('should detect brand presence changes when topics change', async () => {
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
      expect(log.info).to.have.been.calledWith(
        'LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run',
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should detect brand presence changes when competitors change', async () => {
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

      expect(sqs.sendMessage).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith(
        'LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run',
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should trigger cdn-logs-report when only categories change', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: { 'cat-1': { name: 'Category A' }, 'cat-2': { name: 'Category B' } },
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

      expect(sqs.sendMessage).to.have.callCount(1);
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
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

    it('should trigger both referral imports and config-based audits on first-time onboarding with config changes', async () => {
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
      // - 1 cdn-logs-report (categories changed) via SQS
      // Total: 5 SQS messages
      expect(sqs.sendMessage).to.have.callCount(5);

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/imports-queue',
        sinon.match({ type: 'traffic-analysis' }),
      );

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );

      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should log brand presence changes when only entities change without other triggered steps', async () => {
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

      expect(log.info).to.have.been.calledWith(
        'LLMO config changes detected affecting brand presence; geo-brand-presence audits will pick up changes on next scheduled run',
      );
      expect(result.auditResult.status).to.equal('completed');
      // Only brand presence changes, no CDN or other triggered steps
      expect(result.auditResult.configChangesDetected).to.equal(false);
    });

    it('should trigger cdn-logs-report alongside brand presence log when categories change with names', async () => {
      const auditContext = {
        configVersion: 'v2',
        previousConfigVersion: 'v1',
      };

      mockLlmoConfig.readConfig.onFirstCall().resolves({
        config: {
          entities: {},
          categories: {
            '96922bc8-8da7-4fb7-961a-0bf1574560a1': {
              name: 'Category A',
              region: 'ch',
            },
          },
          topics: {},
          brands: {},
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

      // cdn-logs-report should still be triggered
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
      expect(result.auditResult.status).to.equal('completed');
    });

    it('should handle errors from enableAudits gracefully', async () => {
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

      // Create a context with Configuration.findLatest that throws an error
      const errorConfiguration = {
        findLatest: sandbox.stub().rejects(new Error('Configuration service unavailable')),
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

      // Should log the error
      expect(log.error).to.have.been.calledWith('Failed to enable audits for site site-123: Configuration service unavailable');

      // Should still complete successfully despite the error
      expect(result.auditResult.status).to.equal('completed');
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

    it('should enable audits and save configuration when enableAudits is called', async () => {
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

      // Verify enableHandlerForSite was called for each expected audit type
      const expectedAudits = [
        'scrape-top-pages',
        'headings',
        'llm-blocked',
        'llm-error-pages',
        'summarization',
        'llmo-referral-traffic',
        'cdn-logs-report',
        'readability',
        'wikipedia-analysis',
        'geo-brand-presence',
        'geo-brand-presence-free-1',
      ];

      for (const audit of expectedAudits) {
        expect(configuration.enableHandlerForSite).to.have.been.calledWith(audit, site);
      }

      // Verify configuration.save was called
      expect(configuration.save).to.have.been.called;
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

      // Verify the DRS schedule API was called with LOW priority
      expect(mockFetch).to.have.been.calledWith(
        'https://drs.example.com/api/schedules',
        sinon.match({
          method: 'POST',
          headers: sinon.match({
            'Content-Type': 'application/json',
            'x-api-key': 'test-drs-key',
          }),
        }),
      );

      // Verify LOW priority in the schedule payload
      const createCall = mockFetch.getCalls().find((c) => c.args[0] === 'https://drs.example.com/api/schedules');
      const body = JSON.parse(createCall.args[1].body);
      expect(body.job_config.priority).to.equal('LOW');

      // Verify the schedule trigger was called
      expect(mockFetch).to.have.been.calledWith(
        'https://drs.example.com/api/schedules/site-123/sched-001/trigger',
        sinon.match({ method: 'POST' }),
      );

      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
    });

    it('should handle brand presence schedule creation failure gracefully', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Override mockFetch to fail on schedule creation
      mockFetch.onFirstCall().resolves({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
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

      // Should log the error but still complete
      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123'),
      );
      expect(result.auditResult.status).to.equal('completed');
      // brand-presence-schedule should NOT be in triggeredSteps
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.be.undefined;
    });

    it('should handle brand presence schedule trigger failure gracefully', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Schedule creation succeeds
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: async () => ({ schedule_id: 'sched-002' }),
      });
      // Schedule trigger fails
      mockFetch.onSecondCall().resolves({
        ok: false,
        status: 502,
        text: async () => 'Bad Gateway',
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

      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123'),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
    });

    it('should skip brand presence schedule when DRS API URL is not configured', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Remove DRS env vars
      delete context.env.DRS_API_URL;
      delete context.env.DRS_API_KEY;

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

      // Should not call fetch for schedule creation
      expect(mockFetch).to.not.have.been.called;
      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123: DRS API URL or key not configured'),
      );
      expect(result.auditResult.status).to.equal('completed');
      // brand-presence-schedule should NOT be in triggeredSteps
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
    });

    it('should handle missing schedule_id in DRS response', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Schedule creation returns no schedule_id
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: async () => ({}),
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

      expect(log.error).to.have.been.calledWith(
        sinon.match('Failed to create/trigger brand presence schedule for site site-123'),
      );
      expect(result.auditResult.triggeredSteps).to.not.include('brand-presence-schedule');
    });

    it('should strip trailing slashes from DRS API URL', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Set URL with trailing slashes
      context.env.DRS_API_URL = 'https://drs.example.com/api///';

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

      // Verify trailing slashes are stripped from the DRS API URL
      expect(mockFetch).to.have.been.calledWith(
        'https://drs.example.com/api/schedules',
        sinon.match({ method: 'POST' }),
      );

      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-001');
    });

    it('should fall back to schedule.id when schedule_id is not present', async () => {
      const auditContext = {
        configVersion: 'v1',
      };

      // Return response with `id` instead of `schedule_id`
      mockFetch.onFirstCall().resolves({
        ok: true,
        json: async () => ({ id: 'sched-fallback' }),
      });
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: async () => ({}),
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

      // Verify the trigger call uses the fallback id
      expect(mockFetch).to.have.been.calledWith(
        'https://drs.example.com/api/schedules/site-123/sched-fallback/trigger',
        sinon.match({ method: 'POST' }),
      );

      expect(result.auditResult.triggeredSteps).to.include('brand-presence-schedule');
      expect(result.auditResult.brandPresenceScheduleId).to.equal('sched-fallback');
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

      // Should not call fetch for schedule creation on non-first-time onboarding
      expect(mockFetch).to.not.have.been.called;
    });

  });

});

