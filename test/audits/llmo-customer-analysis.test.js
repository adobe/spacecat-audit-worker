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
    };

    configuration = {
      getQueues: sandbox.stub().returns({
        imports: 'https://sqs.us-east-1.amazonaws.com/123456789/imports-queue',
        audits: 'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
      }),
    };

    dataAccess = {
      Configuration: {
        findLatest: sandbox.stub().resolves(configuration),
      },
    };

    site = {
      getSiteId: sandbox.stub().returns('site-123'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
    };

    context = {
      sqs,
      log,
      dataAccess,
      s3Client: {},
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
        '@adobe/spacecat-shared-rum-api-client': {
          default: mockRUMAPIClientClass,
        },
        '../../src/support/utils.js': {
          getRUMUrl: mockGetRUMUrl,
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

    it('should trigger geo-brand-presence when entities change', async () => {
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

      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
    });

    it('should trigger geo-brand-presence when brands change', async () => {
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
        sinon.match({ type: 'geo-brand-presence' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
    });

    it('should return early when no config version provided', async () => {
      const auditContext = {};

      const result = await mockHandler.runLlmoCustomerAnalysis(
        'https://example.com',
        context,
        site,
        auditContext,
      );

      expect(mockLlmoConfig.readConfig).to.not.have.been.called;
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.message).to.equal('No config version provided');
    });

    it('should handle multiple changes and trigger multiple steps', async () => {
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

      expect(sqs.sendMessage).to.have.callCount(2);
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
    });

    it('should trigger geo-brand-presence when topics change', async () => {
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

      expect(sqs.sendMessage).to.have.been.calledOnce;
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
    });

    it('should trigger geo-brand-presence when competitors change', async () => {
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
        sinon.match({ type: 'geo-brand-presence' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
    });

    it('should trigger both cdn-logs-report and geo-brand-presence when only categories change', async () => {
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

      expect(sqs.sendMessage).to.have.callCount(2);
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );
      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence' }),
      );
      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
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
      // - 4 referral traffic imports (one for each of the 4 weeks)
      // - 1 cdn-logs-report (categories changed)
      // - 1 geo-brand-presence (brands and categories changed)
      // Total: 6 SQS messages
      expect(sqs.sendMessage).to.have.callCount(6);

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/imports-queue',
        sinon.match({ type: 'traffic-analysis' }),
      );

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'cdn-logs-report' }),
      );

      expect(sqs.sendMessage).to.have.been.calledWith(
        'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue',
        sinon.match({ type: 'geo-brand-presence' }),
      );

      expect(result.auditResult.status).to.equal('completed');
      expect(result.auditResult.configChangesDetected).to.equal(true);
      expect(result.auditResult.triggeredSteps).to.include('traffic-analysis');
      expect(result.auditResult.triggeredSteps).to.include('cdn-logs-report');
      expect(result.auditResult.triggeredSteps).to.include('geo-brand-presence');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });
  });
});

