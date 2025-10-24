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

import { TierClient } from '@adobe/spacecat-shared-tier-client';
import {
  isAuditEnabledForSite, loadExistingAudit, sendContinuationMessage, checkProductCodeEntitlements,
} from '../../src/common/audit-utils.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

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
    it('returns true when audit is enabled for site', async () => {
      configuration.getHandlers = () => ({
        'content-audit': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);

      // Mock TierClient to return entitlement
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ entitlement: true }),
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

      // Mock TierClient to return entitlement
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ entitlement: true }),
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

    it('returns false when handler has productCodes but no entitlement', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);

      // Mock TierClient to return no entitlement
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ entitlement: false }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.false;
    });

    it('returns true when handler has productCodes and entitlement', async () => {
      configuration.getHandlers = () => ({
        'test-handler': {
          enabledByDefault: true,
          productCodes: ['ASO', 'LLMO'],
        },
      });
      configuration.isHandlerEnabledForSite.returns(true);

      // Mock TierClient to return entitlement for ASO
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ entitlement: true }) // ASO
          .onSecondCall()
          .resolves({ entitlement: false }), // LLMO
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await isAuditEnabledForSite('test-handler', site, context);
      expect(result).to.be.true;
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

    it('returns true when site has entitlement for any product code (OR logic)', async () => {
      // Mock TierClient: ASO has entitlement, LLMO doesn't
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ entitlement: true }) // ASO
          .onSecondCall()
          .resolves({ entitlement: false }), // LLMO
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('returns true when site has entitlement for all product codes', async () => {
      // Mock TierClient: Both ASO and LLMO have entitlement
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ entitlement: true }) // ASO
          .onSecondCall()
          .resolves({ entitlement: true }), // LLMO
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('returns false when site has no entitlement for any product code', async () => {
      // Mock TierClient: Neither ASO nor LLMO has entitlement
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().resolves({ entitlement: false }) // ASO
          .onSecondCall()
          .resolves({ entitlement: false }), // LLMO
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
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
      // Mock TierClient: ASO fails, LLMO succeeds
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().rejects(new Error('ASO check failed'))
          .onSecondCall()
          .resolves({ entitlement: true }), // LLMO
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO'], site, context);
      expect(result).to.be.true;
    });

    it('handles single product code', async () => {
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub().resolves({ entitlement: true }),
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO'], site, context);
      expect(result).to.be.true;
    });

    it('handles multiple product codes with mixed results', async () => {
      // Mock TierClient: ASO fails, LLMO succeeds, CWV fails
      const mockTierClient = {
        checkValidEntitlement: sandbox.stub()
          .onFirstCall().rejects(new Error('ASO check failed'))
          .onSecondCall()
          .resolves({ entitlement: true }) // LLMO
          .onThirdCall()
          .resolves({ entitlement: false }), // CWV
      };
      sandbox.stub(TierClient, 'createForSite').returns(mockTierClient);

      const result = await checkProductCodeEntitlements(['ASO', 'LLMO', 'CWV'], site, context);
      expect(result).to.be.true; // Should return true because LLMO succeeded
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
});
