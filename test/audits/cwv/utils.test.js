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
import { sendSQSMessageForAutoSuggest, needsAutoSuggest } from '../../../src/cwv/utils.js';

describe('sendSQSMessageForAutoSuggest', () => {
  let context;
  let sqsStub;
  const sandbox = sinon.createSandbox();

  let site;

  beforeEach(() => {
    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getDeliveryType: sandbox.stub().returns('aem_cs'),
    };

    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
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

  it('should send CWV auto-suggest message with correct structure', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    
    expect(message.type).to.equal('guidance:cwv-analysis');
    expect(message.siteId).to.equal('site-123');
    expect(message.auditId).to.equal('audit-456');
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.time).to.be.a('string');
    
    expect(message.data.page).to.equal('https://example.com/page1');
    expect(message.data.opportunity_id).to.equal('oppty-789');
  });

  it('should handle opportunity without siteId', async () => {
    const opportunity = {
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

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
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

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
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.opportunity_id).to.equal('');
  });

  it('should handle opportunity without data', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.data.page).to.equal('https://example.com/page1');
    expect(message.data.opportunity_id).to.equal('oppty-789');
  });

  it('should handle opportunity without data object', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(sqsStub.calledOnce).to.be.true;
  });

  it('should send message with default deliveryType when site is not available', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, null, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(sqsStub.calledOnce).to.be.true;
    const message = sqsStub.firstCall.args[1];
    expect(message.deliveryType).to.equal('aem_cs');
    expect(message.data.page).to.equal('https://example.com/page1');
  });

  it('should handle null opportunity gracefully', async () => {
    await sendSQSMessageForAutoSuggest(context, null);

    expect(sqsStub.called).to.be.false;
  });

  it('should handle undefined opportunity gracefully', async () => {
    await sendSQSMessageForAutoSuggest(context, undefined);

    expect(sqsStub.called).to.be.false;
  });

  it('should log info messages correctly', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(context.log.info.callCount).to.equal(4); // Received, Sending, Sent, Final
    expect(context.log.info.firstCall.args[0]).to.include('Received CWV opportunity for auto-suggest');
    expect(context.log.info.firstCall.args[0]).to.include('siteId: site-123');
    expect(context.log.info.firstCall.args[0]).to.include('opportunityId: ');
    expect(context.log.info.secondCall.args[0]).to.include('Sending 1 URL(s) to Mystique for CWV analysis');
    expect(context.log.info.thirdCall.args[0]).to.include('Sent URL to Mystique: https://example.com/page1');
    expect(context.log.info.getCall(3).args[0]).to.include('CWV opportunity sent to Mystique for auto-suggest');
  });

  it('should handle missing opportunityId', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      // opportunityId is missing/undefined
      getId: () => 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);

    expect(context.log.info.called).to.be.true;
    expect(context.log.info.firstCall.args[0]).to.include('Received CWV opportunity for auto-suggest');
    expect(context.log.info.firstCall.args[0]).to.include('siteId: site-123');
    expect(context.log.info.firstCall.args[0]).to.include('opportunityId: ');
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
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    try {
      await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send auto-suggest message to Mystique');
      expect(context.log.error.firstCall.args[0]).to.include('siteId: site-123');
      expect(context.log.error.firstCall.args[0]).to.include('opportunityId: oppty-789');
    }
  });

  it('should handle SQS sendMessage error with missing opportunityId but with getId method', async () => {
    const error = new Error('SQS send failed');
    context.sqs.sendMessage.rejects(error);

    const opportunity = {
      siteId: 'site-456',
      auditId: 'audit-789',
      // opportunityId is missing, but getId is available
      getId: () => 'oppty-from-getId',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    try {
      await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send auto-suggest message to Mystique');
      expect(context.log.error.firstCall.args[0]).to.include('siteId: site-456');
      expect(context.log.error.firstCall.args[0]).to.include('opportunityId: oppty-from-getId');
    }
  });

  it('should handle SQS sendMessage error with missing opportunityId and no getId method', async () => {
    const error = new Error('SQS send failed');
    context.sqs.sendMessage.rejects(error);

    const opportunity = {
      siteId: 'site-999',
      auditId: 'audit-888',
      // opportunityId is missing and no getId method
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    try {
      await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send auto-suggest message to Mystique');
      expect(context.log.error.firstCall.args[0]).to.include('siteId: site-999');
      expect(context.log.error.firstCall.args[0]).to.include('opportunityId: ');
    }
  });

  it('should handle SQS sendMessage error with missing siteId', async () => {
    const error = new Error('SQS send failed');
    context.sqs.sendMessage.rejects(error);

    const opportunity = {
      // siteId is missing
      auditId: 'audit-111',
      opportunityId: 'oppty-222',
      data: {
      },
      getSuggestions: () => Promise.resolve([{
        getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }),
        getStatus: () => 'NEW',
      }]),
    };

    try {
      await sendSQSMessageForAutoSuggest(context, opportunity, site, [{ type: 'url', url: 'https://example.com/page1' }]);
      expect.fail('Should have thrown an error');
    } catch (thrownError) {
      expect(thrownError.message).to.equal('SQS send failed');
      expect(context.log.error.calledOnce).to.be.true;
      expect(context.log.error.firstCall.args[0]).to.include('[CWV] Failed to send auto-suggest message to Mystique');
      expect(context.log.error.firstCall.args[0]).to.include('siteId: unknown');
      expect(context.log.error.firstCall.args[0]).to.include('opportunityId: oppty-222');
    }
  });

  it('should send multiple SQS messages for multiple URL entries', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([
        { getData: () => ({ type: 'url', url: 'https://example.com/page1', issues: [] }), getStatus: () => 'NEW' },
        { getData: () => ({ type: 'url', url: 'https://example.com/page2', issues: [] }), getStatus: () => 'NEW' },
      ]),
    };
    const cwvEntries = [
      { type: 'url', url: 'https://example.com/page1' },
      { type: 'url', url: 'https://example.com/page2' },
    ];

    await sendSQSMessageForAutoSuggest(context, opportunity, site, cwvEntries);

    expect(sqsStub.callCount).to.equal(2);
    expect(sqsStub.firstCall.args[1].data.page).to.equal('https://example.com/page1');
    expect(sqsStub.secondCall.args[1].data.page).to.equal('https://example.com/page2');
  });

  it('should not send SQS message when there are no url entries', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {
      },
      getSuggestions: () => Promise.resolve([]),
    };
    const cwvEntries = [
      { type: 'desktop', url: 'https://example.com/page1' },
    ];

    await sendSQSMessageForAutoSuggest(context, opportunity, site, cwvEntries);

    expect(sqsStub.callCount).to.equal(0);
    expect(context.log.info).to.have.been.calledWith('No new URL entries to send for CWV auto-suggest');
  });

  it('should correctly determine hasGuidance with various issue values', async () => {
    const opportunity = {
      siteId: 'site-123',
      auditId: 'audit-456',
      opportunityId: 'oppty-789',
      data: {},
      getSuggestions: () => Promise.resolve([{
        getData: () => ({
          url: 'https://example.com/page1',
          issues: [
            { type: 'lcp', value: null }, // null value
            { type: 'cls' }, // missing value
            { type: 'inp', value: '   ' }, // whitespace value
          ],
        }),
        getStatus: () => 'NEW',
      }]),
    };
    const cwvEntries = [{ type: 'url', url: 'https://example.com/page1' }];

    await sendSQSMessageForAutoSuggest(context, opportunity, site, cwvEntries);

    // hasGuidance should be false because all issue values are invalid, so the message should be sent
    expect(sqsStub.callCount).to.equal(1);
  });
});

describe('needsAutoSuggest', () => {
  let context;
  let site;
  const sandbox = sinon.createSandbox();

  beforeEach(() => {
    site = {
      getId: sandbox.stub().returns('test-site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getDeliveryType: sandbox.stub().returns('aem_cs'),
    };

    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves({ isHandlerEnabledForSite: () => true }),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns true when suggestions have empty guidance values', async () => {
    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '' }] }) }, // Empty string
      { getData: () => ({ issues: [{ type: 'cls', value: '   ' }] }) }, // Whitespace only
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsAutoSuggest(context, opportunity, site);
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

    const result = await needsAutoSuggest(context, opportunity, site);
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

    const result = await needsAutoSuggest(context, opportunity, site);
    expect(result).to.be.true;
  });

  it('returns false when no suggestions exist', async () => {
    const opportunity = {
      getSuggestions: () => Promise.resolve([]),
    };

    const result = await needsAutoSuggest(context, opportunity, site);
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

    const result = await needsAutoSuggest(context, opportunity, site);
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

    const result = await needsAutoSuggest(context, opportunity, site);
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

    const result = await needsAutoSuggest(context, opportunity, site);
    expect(result).to.be.false;
  });

  it('returns false when CWV auto-suggest feature toggle is disabled', async () => {
    // Mock feature toggle as disabled
    context.dataAccess.Configuration.findLatest.resolves({
      isHandlerEnabledForSite: () => false,
    });

    const suggestions = [
      { getData: () => ({ issues: [{ type: 'lcp', value: '' }] }) },
    ];

    const opportunity = {
      getSuggestions: () => Promise.resolve(suggestions),
    };

    const result = await needsAutoSuggest(context, opportunity, site);
    expect(result).to.be.false;
    expect(context.log.info).to.have.been.calledWith('CWV auto-suggest is disabled for site test-site-id, skipping');
  });
});
