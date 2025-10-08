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
import { expect } from 'chai';
import sinon from 'sinon';
import { sendMessageToMystiqueForGuidance } from '../../../src/cwv/utils.js';

describe('sendMessageToMystiqueForGuidance', () => {
  let context;
  let sqsStub;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      site: {
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getDeliveryType: sandbox.stub().returns('aem_cs'),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
    sqsStub = context.sqs.sendMessage;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send CWV guidance message with correct structure', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [
          {
            deviceType: 'desktop',
            lcp: 2500,
            cls: 0.1,
            inp: 200,
          },
          {
            deviceType: 'mobile',
            lcp: 3000,
            cls: 0.15,
            inp: 250,
          },
        ],
        total_suggestions: 5,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    
    expect(message.type).to.equal('guidance:cwv-analysis');
    expect(message.siteId).to.equal('site-123');
    expect(message.auditId).to.equal('audit-456');
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.time).to.be.a('string');
    
    expect(message.data.url).to.equal('https://example.com');
    expect(message.data.opportunityId).to.equal('oppty-789');
    expect(message.data.opportunity_type).to.equal(Audit.AUDIT_TYPES.CWV);
    expect(message.data.cwv_metrics).to.deep.equal(opportunity.data.cwv_metrics);
    expect(message.data.total_suggestions).to.equal(5);
  });

  it('should handle opportunity without siteId', async () => {
    const opportunity = {
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.siteId).to.be.undefined;
  });

  it('should handle opportunity without auditId', async () => {
    const opportunity = {
      siteId: 'site-123',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.auditId).to.be.undefined;
  });

  it('should handle opportunity without opportunityId', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.opportunityId).to.equal('');
  });

  it('should handle opportunity without cwv_metrics', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        total_suggestions: 3,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.cwv_metrics).to.deep.equal([]);
  });

  it('should handle opportunity without total_suggestions', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [
          {
            deviceType: 'desktop',
            lcp: 2500,
            cls: 0.1,
            inp: 200,
          },
        ],
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.total_suggestions).to.equal(0);
  });

  it('should handle opportunity without data object', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.cwv_metrics).to.deep.equal([]);
    expect(message.data.total_suggestions).to.equal(0);
  });

  it('should send message with default deliveryType when site is not available', async () => {
    delete context.site;
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.data.url).to.equal('');
  });

  it('should handle null opportunity gracefully', async () => {
    await sendMessageToMystiqueForGuidance(context, null);

    expect(sqsStub.called).to.be.false;
  });

  it('should handle undefined opportunity gracefully', async () => {
    await sendMessageToMystiqueForGuidance(context, undefined);

    expect(sqsStub.called).to.be.false;
  });

  it('should log info messages correctly', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    await sendMessageToMystiqueForGuidance(context, opportunity);

    expect(context.log.info.calledTwice).to.be.true;
    expect(context.log.info.firstCall.args[0]).to.include('Received CWV opportunity for guidance');
    expect(context.log.info.secondCall.args[0]).to.include('CWV opportunity sent to mystique for guidance');
  });

  it('should handle SQS sendMessage error and throw', async () => {
    const error = new Error('SQS send failed');
    context.sqs.sendMessage.rejects(error);

    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      getId: () => 'oppty-789',
      data: {
        cwv_metrics: [],
        total_suggestions: 0,
      },
    };

    try {
      await sendMessageToMystiqueForGuidance(context, opportunity);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send message to Mystique');
    }
  });
});