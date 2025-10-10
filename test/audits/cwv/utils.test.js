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
import { sendSQSMessageForGuidance, needsGuidance } from '../../../src/cwv/utils.js';

describe('sendSQSMessageForGuidance', () => {
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
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    
    expect(message.type).to.equal('guidance:cwv-analysis');
    expect(message.siteId).to.equal('site-123');
    expect(message.auditId).to.equal('audit-456');
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.time).to.be.a('string');
    
    expect(message.data.page).to.equal('https://example.com');
    expect(message.data.opportunityId).to.equal('oppty-789');
  });

  it('should handle opportunity without siteId', async () => {
    const opportunity = {
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.siteId).to.be.undefined;
  });

  it('should handle opportunity without auditId', async () => {
    const opportunity = {
      siteId: 'site-123',
      opportunityId: 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.auditId).to.be.undefined;
  });

  it('should handle opportunity without opportunityId', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.opportunityId).to.equal('');
  });

  it('should handle opportunity without data', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.page).to.equal('https://example.com');
    expect(message.data.opportunityId).to.equal('oppty-789');
  });

  it('should handle opportunity without data object', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
  });

  it('should send message with default deliveryType when site is not available', async () => {
    delete context.site;
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.data.page).to.equal('');
  });

  it('should handle null opportunity gracefully', async () => {
    await sendSQSMessageForGuidance(context, null);

    expect(sqsStub.called).to.be.false;
  });

  it('should handle undefined opportunity gracefully', async () => {
    await sendSQSMessageForGuidance(context, undefined);

    expect(sqsStub.called).to.be.false;
  });

  it('should log info messages correctly', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(context.log.info.calledTwice).to.be.true;
    expect(context.log.info.firstCall.args[0]).to.include('Received CWV opportunity for guidance');
    expect(context.log.info.secondCall.args[0]).to.include('CWV opportunity sent to mystique for guidance');
  });

  it('should handle missing opportunityId', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      // opportunityId is missing/undefined
      getId: () => 'oppty-789',
      data: {
      },
    };

    await sendSQSMessageForGuidance(context, opportunity);

    expect(context.sqs.sendMessage.calledOnce).to.be.true;
    const message = context.sqs.sendMessage.firstCall.args[1];
    expect(message.data.opportunityId).to.equal('');
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
      },
    };

    try {
      await sendSQSMessageForGuidance(context, opportunity);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send message to Mystique');
    }
  });
});

describe('needsGuidance', () => {
  it('returns true when suggestions have empty guidance values', async () => {
    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '' }] }) }, // Empty string
      { getData: () => ({ issues: [{ type: 'cls', value: '   ' }] }) }, // Whitespace only
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.true;
  });

  it('returns true when some suggestions have whitespace-only guidance values', async () => {
    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '# LCP Optimization...' }] }) },
      { getData: () => ({ issues: [{ type: 'cls', value: '   ' }] }) }, // Whitespace only
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.true;
  });

  it('returns true when some suggestions have empty string guidance values', async () => {
    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '# LCP Optimization...' }] }) },
      { getData: () => ({ issues: [{ type: 'cls', value: '' }] }) }, // Empty string
      { getData: () => ({ issues: [{ type: 'inp', value: '# INP Optimization...' }] }) },
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.true;
  });

  it('returns false when no suggestions exist', async () => {
    const opportunity = {
      getSuggestions: () => Promise.resolve([]),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.false;
  });

  it('returns true when suggestions have empty issues array', async () => {
    const suggestions = [
      { getData: () => ({ issues: [] }) },
      { getData: () => ({ issues: [] }) },
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.true;
  });

  it('returns true when suggestions have undefined or missing issues', async () => {
    const suggestions = [
      { getData: () => ({}) }, // No issues field
      { getData: () => ({ issues: undefined }) }, // Issues is undefined
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.true;
  });

  it('returns false when all suggestions have guidance', async () => {
    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '# LCP Optimization...' }] }) },
      { getData: () => ({ issues: [{ type: 'cls', value: '# CLS Optimization...' }] }) },
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsGuidance(opportunity);
    expect(result).to.be.false;
  });
});
