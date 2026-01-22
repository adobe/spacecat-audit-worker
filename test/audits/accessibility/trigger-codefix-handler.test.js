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
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('TriggerA11yCodefixHandler', () => {
  let sandbox;
  let handler;
  let mockLog;
  let mockDataAccess;
  let mockSite;
  let mockOpportunity;
  let sendOpportunitySuggestionsToMystiqueStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockLog = {
      info: sandbox.spy(),
      debug: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
    };

    mockSite = {
      getId: () => 'site-123',
      getBaseURL: () => 'https://example.com',
    };

    mockOpportunity = {
      getId: () => 'opportunity-123',
      getSiteId: () => 'site-123',
      getStatus: () => 'NEW',
    };

    mockDataAccess = {
      Site: {
        findById: sandbox.stub(),
      },
      Opportunity: {
        findById: sandbox.stub(),
      },
    };

    sendOpportunitySuggestionsToMystiqueStub = sandbox.stub().resolves({
      success: true,
      messagesProcessed: 5,
    });

    handler = await esmock('../../../src/accessibility/trigger-codefix-handler.js', {
      '../../../src/accessibility/utils/generate-individual-opportunities.js': {
        sendOpportunitySuggestionsToMystique: sendOpportunitySuggestionsToMystiqueStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Message Validation', () => {
    it('should return badRequest when siteId is missing', async () => {
      const message = {
        type: 'trigger:a11y-codefix',
        data: { opportunityId: 'opp-123' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Missing siteId in message');
    });

    it('should return badRequest when opportunityId is missing', async () => {
      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: {},
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Missing opportunityId in message data');
    });
  });

  describe('Site Validation', () => {
    it('should return notFound when site is not found', async () => {
      mockDataAccess.Site.findById.resolves(null);

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Site not found: site-123');
    });
  });

  describe('Opportunity Validation', () => {
    it('should return notFound when opportunity is not found', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves(null);

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Opportunity not found: opp-123');
    });

    it('should return badRequest when opportunity does not belong to site', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves({
        getId: () => 'opp-123',
        getSiteId: () => 'different-site-456',
        getStatus: () => 'NEW',
      });

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Opportunity opp-123 does not belong to site site-123');
    });

    it('should return badRequest when opportunity has invalid status IGNORED', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves({
        getId: () => 'opp-123',
        getSiteId: () => 'site-123',
        getStatus: () => 'IGNORED',
      });

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(mockLog.warn).to.have.been.calledWith(
        '[A11yCodefix] Opportunity opp-123 has invalid status: IGNORED. Expected: NEW, IN_PROGRESS',
      );
    });

    it('should return badRequest when opportunity has invalid status RESOLVED', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves({
        getId: () => 'opp-123',
        getSiteId: () => 'site-123',
        getStatus: () => 'RESOLVED',
      });

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
    });
  });

  describe('Successful Processing', () => {
    it('should successfully trigger codefix flow for NEW opportunity', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opportunity-123', opportunityType: 'a11y-assistive' },
        auditContext: { slackContext: { channelId: 'C123', threadTs: '123.456' } },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'mystique-queue' },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(sendOpportunitySuggestionsToMystiqueStub).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith('[A11yCodefix] Successfully triggered codefix flow for opportunity opportunity-123');
    });

    it('should successfully trigger codefix flow for IN_PROGRESS opportunity', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves({
        getId: () => 'opp-123',
        getSiteId: () => 'site-123',
        getStatus: () => 'IN_PROGRESS',
      });

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'mystique-queue' },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(sendOpportunitySuggestionsToMystiqueStub).to.have.been.calledOnce;
    });

    it('should default messagesProcessed to 0 when not returned', async () => {
      // Override the stub to return success without messagesProcessed
      sendOpportunitySuggestionsToMystiqueStub.resolves({ success: true });

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opportunity-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: { sendMessage: sandbox.stub().resolves() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'mystique-queue' },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
    });
  });

  describe('Error Handling', () => {
    it('should return ok with error when sendOpportunitySuggestionsToMystique fails', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

      sendOpportunitySuggestionsToMystiqueStub.resolves({
        success: false,
        error: 'SQS connection failed',
      });

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opportunity-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(mockLog.error).to.have.been.calledWith('[A11yCodefix] Failed to send suggestions to Mystique: SQS connection failed');
    });

    it('should handle unexpected errors gracefully', async () => {
      mockDataAccess.Site.findById.rejects(new Error('Database connection lost'));

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opp-123', opportunityType: 'a11y-assistive' },
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: {},
        env: {},
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(mockLog.error).to.have.been.calledWith(
        '[A11yCodefix] Error processing trigger: Database connection lost',
        sinon.match.instanceOf(Error),
      );
    });
  });

  describe('Context Enhancement', () => {
    it('should pass enhanced context to sendOpportunitySuggestionsToMystique', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.Opportunity.findById.resolves(mockOpportunity);

      const mockSqs = { sendMessage: sandbox.stub().resolves() };
      const mockEnv = { QUEUE_SPACECAT_TO_MYSTIQUE: 'mystique-queue' };
      const mockAuditContext = { slackContext: { channelId: 'C123', threadTs: '123.456' } };

      const message = {
        type: 'trigger:a11y-codefix',
        siteId: 'site-123',
        data: { opportunityId: 'opportunity-123', opportunityType: 'a11y-assistive' },
        auditContext: mockAuditContext,
      };

      const context = {
        log: mockLog,
        dataAccess: mockDataAccess,
        sqs: mockSqs,
        env: mockEnv,
      };

      await handler.default(message, context);

      expect(sendOpportunitySuggestionsToMystiqueStub).to.have.been.calledOnce;
      const [opportunityId, enhancedContext] = sendOpportunitySuggestionsToMystiqueStub.firstCall.args;

      expect(opportunityId).to.equal('opportunity-123');
      expect(enhancedContext.site).to.equal(mockSite);
      expect(enhancedContext.sqs).to.equal(mockSqs);
      expect(enhancedContext.env).to.equal(mockEnv);
      expect(enhancedContext.auditContext).to.equal(mockAuditContext);
    });
  });
});

