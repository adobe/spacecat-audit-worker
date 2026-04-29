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
import chaiAsPromised from 'chai-as-promised';

import { TierClient } from '@adobe/spacecat-shared-tier-client';
import {
  isAuditEnabledForSite,
  isAuditDisabledForSite,
  loadExistingAudit,
  sendContinuationMessage,
  checkProductCodeEntitlements,
  parseMessageDataForRunnerAudit,
  preserveOnDemand,
  preserveSlackContext,
} from '../../src/common/audit-utils.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const mockSiteEnrollment = { getId: () => 'site-enrollment-1' };

describe('Audit Utils Tests', () => {
  const sandbox = sinon.createSandbox();
  let context;
  let site;
  let configuration;

  beforeEach(() => {
    site = {
      getId: () => 'site-123',
      getBaseURL: () => 'https://space.cat',
      getIsLive: () => true,
    };

    configuration = {
      isHandlerEnabledForSite: sandbox.stub(),
      getHandlers: sandbox.stub().returns({}),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Configuration.findLatest.resolves(configuration);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isAuditEnabledForSite', () => {
    it('returns true when handler has productCodes, entitlement, and config enabled', async () => {
      configuration.getHandlers = () => ({
        'content-audit': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);

      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('content-audit', site, context);
      expect(result).to.be.true;
      expect(configuration.isHandlerEnabledForSite).to.have.been.calledWith('content-audit', site);
    });

    it('returns false when audit is disabled for site', async () => {
      configuration.getHandlers = () => ({
        'content-audit': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);

      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('content-audit', site, context);
      expect(result).to.be.false;
      expect(configuration.isHandlerEnabledForSite).to.have.been.calledWith('content-audit', site);
    });

    it('throws error when configuration lookup fails', async () => {
      context.dataAccess.Configuration.findLatest.rejects(new Error('DB error'));

      await expect(isAuditEnabledForSite('content-audit', site, context))
        .to.be.rejectedWith('DB error');
    });

    it('returns false when handler has no productCodes', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          // No productCodes
        },
      });

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.false;
      expect(context.log.error).to.have.been.calledWith('Handler test-handler has no product codes');
    });

    it('returns false when handler has productCodes but no site enrollment', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });

      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({}),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.false;
    });

    it('returns true when handler has productCodes and site enrollment', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);

      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ siteEnrollment: mockSiteEnrollment })
          .onSecondCall()
          .resolves({}),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.true;
    });

    it('returns false when entitlement passes but handler disabled in config', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(false);

      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.false;
    });
  });

  describe('isAuditDisabledForSite', () => {
    it('returns true when isAuditEnabledForSite returns false', async () => {
      configuration.getHandlers = () => ({
        'test-handler': { productCodes: ['ASO'] },
      });
      configuration.isHandlerEnabledForSite.returns(false);
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditDisabledForSite('test-handler', site, context);
      expect(result).to.be.true;
    });

    it('returns false when isAuditEnabledForSite returns true', async () => {
      configuration.getHandlers = () => ({
        'test-handler': { productCodes: ['ASO'] },
      });
      configuration.isHandlerEnabledForSite.returns(true);
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditDisabledForSite('test-handler', site, context);
      expect(result).to.be.false;
    });
  });

  describe('checkProductCodeEntitlements', () => {
    it('returns false when no product codes provided', async () => {
      const result = await checkProductCodeEntitlements([], site, context);
      expect(result).to.be.false;
    });

    it('returns false when productCodes is null', async () => {
      const result = await checkProductCodeEntitlements(null, site, context);
      expect(result).to.be.false;
    });

    it('returns true when site has enrollment for any product code (OR logic)', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ siteEnrollment: mockSiteEnrollment })
          .onSecondCall()
          .resolves({}),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('returns true when site has enrollment for all product codes', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ siteEnrollment: mockSiteEnrollment })
          .onSecondCall()
          .resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('returns false when site has no enrollment for any product code', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({})
          .onSecondCall()
          .resolves({}),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.false;
    });

    it('returns false when org has entitlement but site has no site enrollment', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({
          entitlement: { getId: () => 'ent-1' },
        }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO'], site, context);
      expect(result).to.be.false;
    });

    it('returns false when siteEnrollment is null', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: null }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO'], site, context);
      expect(result).to.be.false;
    });

    it('returns false when entitlement check fails for all product codes', async () => {
      // Mock TierClient: All entitlement checks throw errors
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().rejects(new Error('ASO check failed'))
          .onSecondCall()
          .rejects(new Error('LLMO check failed')),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.false;
    });

    it('returns true when one product code fails but another succeeds', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().rejects(new Error('ASO check failed'))
          .onSecondCall()
          .resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('handles single product code', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ siteEnrollment: mockSiteEnrollment }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO'], site, context);
      expect(result).to.be.true;
    });

    it('handles multiple product codes with mixed results', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().rejects(new Error('ASO check failed'))
          .onSecondCall()
          .resolves({ siteEnrollment: mockSiteEnrollment })
          .onThirdCall()
          .resolves({}),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO', 'CWV'], site, context);
      expect(result).to.be.true;
    });

    it('handles critical error in checkProductCodeEntitlements and returns false', async () => {
      // Mock Promise.all to throw an error to trigger the outer try-catch block
      sandbox.stub(Promise, 'all').throws(new Error('Critical Promise.all error'));

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.false;
      expect(context.log.error).to.have.been.calledWith('Error checking product code entitlements:', sinon.match.instanceOf(Error));
    });
  });

  describe('loadExistingAudit', () => {
    const validAuditId = '109b71f7-2005-454e-8191-8e92e05daac2';

    it('loads existing audit successfully', async () => {
      const mockAudit = {
        getId: () => validAuditId,
        getAuditType: () => 'content-audit',
      };
      context.dataAccess.Audit.findById.resolves(mockAudit);

      const result = await loadExistingAudit(validAuditId, context);
      expect(result).to.deep.equal(mockAudit);
      expect(context.dataAccess.Audit.findById).to.have.been.calledWith(validAuditId);
    });

    it('throws error for invalid audit ID format', async () => {
      await expect(loadExistingAudit('invalid-uuid', context))
        .to.be.rejectedWith('Valid auditId is required for step execution');

      expect(context.dataAccess.Audit.findById).not.to.have.been.called;
    });

    it('throws error when audit not found', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      await expect(loadExistingAudit(validAuditId, context))
        .to.be.rejectedWith(`Audit record ${validAuditId} not found`);
    });

    it('throws error when audit lookup fails', async () => {
      context.dataAccess.Audit.findById.rejects(new Error('DB error'));

      await expect(loadExistingAudit(validAuditId, context))
        .to.be.rejectedWith('DB error');
    });
  });

  describe('preserveOnDemand', () => {
    it('extracts onDemand when boolean true', () => {
      const result = preserveOnDemand({ onDemand: true, extra: 'ignored' });
      expect(result).to.deep.equal({ onDemand: true });
    });

    it('normalizes string "true" to boolean true', () => {
      expect(preserveOnDemand({ onDemand: 'true' })).to.deep.equal({ onDemand: true });
    });

    it('returns empty object when auditContext is undefined', () => {
      expect(preserveOnDemand(undefined)).to.deep.equal({});
    });

    it('returns empty object when auditContext is null', () => {
      expect(preserveOnDemand(null)).to.deep.equal({});
    });

    it('returns empty object when onDemand is not set', () => {
      expect(preserveOnDemand({ extra: 'ignored' })).to.deep.equal({});
    });

    it('returns empty object when onDemand is false', () => {
      expect(preserveOnDemand({ onDemand: false })).to.deep.equal({});
    });

    it('returns empty object when onDemand is string "false"', () => {
      expect(preserveOnDemand({ onDemand: 'false' })).to.deep.equal({});
    });
  });

  describe('preserveSlackContext', () => {
    it('preserves slackContext when present', () => {
      const slackContext = { channelId: 'C123', threadTs: '123.456' };
      expect(preserveSlackContext({ slackContext })).to.deep.equal({ slackContext });
    });

    it('returns empty object when auditContext is undefined', () => {
      expect(preserveSlackContext(undefined)).to.deep.equal({});
    });

    it('returns empty object when auditContext is null', () => {
      expect(preserveSlackContext(null)).to.deep.equal({});
    });

    it('returns empty object when slackContext is not set', () => {
      expect(preserveSlackContext({ onDemand: true })).to.deep.equal({});
    });

    it('returns empty object when slackContext is null', () => {
      expect(preserveSlackContext({ slackContext: null })).to.deep.equal({});
    });
  });

  describe('sendContinuationMessage', () => {
    it('sends message successfully', async () => {
      const message = {
        queueUrl: 'https://sqs.test/queue',
        payload: { test: 'data' },
      };

      await sendContinuationMessage(message, context);

      expect(context.sqs.sendMessage).to.have.been.calledWith(message.queueUrl, message.payload);
    });

    it('throws error when message sending fails', async () => {
      const message = {
        queueUrl: 'https://sqs.test/queue',
        payload: { test: 'data' },
      };

      context.sqs.sendMessage.rejects(new Error('SQS error'));

      await expect(sendContinuationMessage(message, context))
        .to.be.rejectedWith('SQS error');

      expect(context.log.error).to.have.been.calledWith(
        `Failed to send message to queue ${message.queueUrl}`,
        sinon.match.instanceOf(Error),
      );
    });
  });

  describe('parseMessageDataForRunnerAudit', () => {
    it('returns undefined when data is missing or null', () => {
      expect(parseMessageDataForRunnerAudit(undefined)).to.equal(undefined);
      expect(parseMessageDataForRunnerAudit(null)).to.equal(undefined);
    });

    it('returns object when data is a plain object', () => {
      expect(parseMessageDataForRunnerAudit({ urlLimit: '10' })).to.deep.equal({ urlLimit: '10' });
    });

    it('parses JSON string data', () => {
      expect(parseMessageDataForRunnerAudit('{"urlLimit":"5"}')).to.deep.equal({ urlLimit: '5' });
    });

    it('returns undefined when data string is invalid JSON', () => {
      expect(parseMessageDataForRunnerAudit('{not-json')).to.equal(undefined);
    });

    it('returns undefined when data string is whitespace only', () => {
      expect(parseMessageDataForRunnerAudit('   \n\t  ')).to.equal(undefined);
    });

    it('returns undefined when data is not a plain object', () => {
      expect(parseMessageDataForRunnerAudit([1, 2])).to.equal(undefined);
    });
  });
});
