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
import esmock from 'esmock';

describe('CWV Utils', () => {
  let sendSQSMessageForAutoSuggest;
  let shouldSendAutoSuggestForSuggestion;
  let isAuditEnabledForSite;
  let context;
  let sqsStub;
  let site;
  const sandbox = sinon.createSandbox();

  beforeEach(async () => {
    isAuditEnabledForSite = sandbox.stub().resolves(true);

    ({ sendSQSMessageForAutoSuggest, shouldSendAutoSuggestForSuggestion } = await esmock('../../../src/cwv/utils.js', {
      '../../../src/common/index.js': {
        isAuditEnabledForSite,
      },
    }));

    site = {
      getId: () => 'test-site-id',
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getDeliveryType: sandbox.stub().returns('aem_cs'),
    };

    sqsStub = sandbox.stub().resolves();

    context = {
      log: {
        info: sandbox.stub(),
        error: sandbox.stub(),
      },
      sqs: {
        sendMessage: sqsStub,
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('sendSQSMessageForAutoSuggest', () => {
    it('should send CWV auto-suggest message with correct structure', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'NEW',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{
              deviceType: 'mobile',
              lcp: 2500,
              cls: 0.1,
              inp: 200,
            }],
            issues: [],
          }),
        }]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      expect(sqsStub.calledOnce).to.be.true;
      const message = sqsStub.firstCall.args[1];

      expect(message.type).to.equal('guidance:cwv-analysis');
      expect(message.siteId).to.equal('site-123');
      expect(message.auditId).to.equal('audit-456');
      expect(message.deliveryType).to.equal('aem_cs');
      expect(message.time).to.be.a('string');

      expect(message.data.page).to.equal('https://example.com/page1');
      expect(message.data.opportunityId).to.equal('oppty-789');
      expect(message.data.suggestionId).to.equal('sugg-001');
      expect(message.data.device_type).to.equal('mobile');
    });

    it('should skip group-type suggestions and only send URL-type suggestions', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([
          {
            getId: () => 'sugg-group',
            getStatus: () => 'NEW',
            getData: () => ({
              type: 'group',
              pattern: 'https://example.com/products/*',
              metrics: [{ deviceType: 'mobile' }],
              issues: [],
            }),
          },
          {
            getId: () => 'sugg-url',
            getStatus: () => 'NEW',
            getData: () => ({
              type: 'url',
              url: 'https://example.com/page1',
              metrics: [{ deviceType: 'desktop' }],
              issues: [],
            }),
          },
        ]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      // Should only send one message (for URL, not group)
      expect(sqsStub.calledOnce).to.be.true;
      const message = sqsStub.firstCall.args[1];
      expect(message.data.page).to.equal('https://example.com/page1');
      expect(message.data.suggestionId).to.equal('sugg-url');
    });

    it('should not send messages when feature toggle is disabled', async () => {
      isAuditEnabledForSite.resolves(false);

      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'NEW',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{ deviceType: 'mobile' }],
            issues: [],
          }),
        }]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      expect(sqsStub.called).to.be.false;
      expect(context.log.info).to.have.been.calledWith('CWV auto-suggest is disabled for site test-site-id, skipping');
    });

    it('should not send messages for suggestions with existing guidance', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'NEW',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{ deviceType: 'mobile' }],
            issues: [{ type: 'lcp', value: '# LCP Optimization...' }],
          }),
        }]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      expect(sqsStub.called).to.be.false;
    });

    it('should not send messages for non-NEW suggestions', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'APPROVED',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{ deviceType: 'mobile' }],
            issues: [],
          }),
        }]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      expect(sqsStub.called).to.be.false;
    });

    it('should send multiple messages for multiple URL suggestions', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([
          {
            getId: () => 'sugg-001',
            getStatus: () => 'NEW',
            getData: () => ({
              type: 'url',
              url: 'https://example.com/page1',
              metrics: [{ deviceType: 'mobile' }],
              issues: [],
            }),
          },
          {
            getId: () => 'sugg-002',
            getStatus: () => 'NEW',
            getData: () => ({
              type: 'url',
              url: 'https://example.com/page2',
              metrics: [{ deviceType: 'desktop' }],
              issues: [],
            }),
          },
        ]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, site);

      expect(sqsStub.callCount).to.equal(2);
      expect(sqsStub.firstCall.args[1].data.page).to.equal('https://example.com/page1');
      expect(sqsStub.secondCall.args[1].data.page).to.equal('https://example.com/page2');
    });

    it('should handle SQS sendMessage error', async () => {
      sqsStub.rejects(new Error('SQS send failed'));

      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'NEW',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{ deviceType: 'mobile' }],
            issues: [],
          }),
        }]),
      };

      try {
        await sendSQSMessageForAutoSuggest(context, opportunity, site);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('SQS send failed');
        expect(context.log.error.calledOnce).to.be.true;
      }
    });

    it('should use default deliveryType when site is null', async () => {
      const opportunity = {
        getSiteId: () => 'site-123',
        getAuditId: () => 'audit-456',
        getId: () => 'oppty-789',
        getSuggestions: () => Promise.resolve([{
          getId: () => 'sugg-001',
          getStatus: () => 'NEW',
          getData: () => ({
            type: 'url',
            url: 'https://example.com/page1',
            metrics: [{ deviceType: 'mobile' }],
            issues: [],
          }),
        }]),
      };

      await sendSQSMessageForAutoSuggest(context, opportunity, null);

      expect(sqsStub.calledOnce).to.be.true;
      const message = sqsStub.firstCall.args[1];
      expect(message.deliveryType).to.equal('aem_cs');
    });

    it('should handle error when opportunity is undefined', async () => {
      try {
        await sendSQSMessageForAutoSuggest(context, undefined, site);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(context.log.error.calledOnce).to.be.true;
        expect(context.log.error.firstCall.args[0]).to.include('siteId: unknown');
        expect(context.log.error.firstCall.args[0]).to.include('opportunityId: unknown');
      }
    });
  });

  describe('shouldSendAutoSuggestForSuggestion', () => {
    it('should return true for NEW suggestion without guidance', () => {
      const suggestion = {
        getStatus: () => 'NEW',
        getData: () => ({ issues: [] }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.true;
    });

    it('should return false for non-NEW suggestion', () => {
      const suggestion = {
        getStatus: () => 'APPROVED',
        getData: () => ({ issues: [] }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.false;
    });

    it('should return false for NEW suggestion with guidance', () => {
      const suggestion = {
        getStatus: () => 'NEW',
        getData: () => ({
          issues: [{ type: 'lcp', value: '# LCP Optimization...' }],
        }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.false;
    });

    it('should return true for NEW suggestion with empty guidance value', () => {
      const suggestion = {
        getStatus: () => 'NEW',
        getData: () => ({
          issues: [{ type: 'lcp', value: '' }],
        }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.true;
    });

    it('should return true for NEW suggestion with whitespace-only guidance value', () => {
      const suggestion = {
        getStatus: () => 'NEW',
        getData: () => ({
          issues: [{ type: 'lcp', value: '   ' }],
        }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.true;
    });

    it('should return true when some issues have empty guidance', () => {
      const suggestion = {
        getStatus: () => 'NEW',
        getData: () => ({
          issues: [
            { type: 'lcp', value: '# LCP Optimization...' },
            { type: 'cls', value: '' },
          ],
        }),
      };

      const result = shouldSendAutoSuggestForSuggestion(suggestion);
      expect(result).to.be.true;
    });
  });
});
