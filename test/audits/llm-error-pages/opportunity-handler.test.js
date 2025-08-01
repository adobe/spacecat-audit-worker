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
/* eslint-disable max-len */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';
import * as opportunityHandler from '../../../src/llm-error-pages/opportunity-handler.js';

use(sinonChai);

describe('LLM Error Pages - Opportunity Handler', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: { sendMessage: sandbox.stub().resolves({ MessageId: 'test-message-id' }) },
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves({
              id: 'test-site-id',
              baseURL: 'https://example.com',
              getDeliveryType: () => 'aem_edge',
            }),
          },
          Opportunity: {
            create: sandbox.stub().resolves({ getId: () => 'test-opportunity-id' }),
          },
          Audit: {
            findById: sandbox.stub().resolves({ getId: () => 'test-audit-id' }),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('generateOpportunities - Core Functionality', () => {
    it('should handle empty processed results', async () => {
      const processedResults = {
        totalErrors: 0,
        errorPages: [],
        summary: { uniqueUrls: 0, uniqueUserAgents: 0, statusCodes: {} },
      };

      const message = { siteId: 'test-site-id' };
      const result = await opportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('skipped');
      expect(result.reason).to.equal('No error pages to process');
      expect(context.log.info).to.have.been.calledWith('No LLM error pages found, skipping opportunity generation');
    });

    it('should handle missing message data', async () => {
      const processedResults = {
        totalErrors: 1,
        errorPages: [{
          url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        }],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };

      const result = await opportunityHandler.generateOpportunities(processedResults, null, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('error');
      expect(result.reason).to.equal('Missing required message data');
      expect(context.log.error).to.have.been.calledWith('Missing required message data');
    });

    it('should handle missing SQS configuration', async () => {
      const processedResults = {
        totalErrors: 1,
        errorPages: [{
          url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        }],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };

      const message = { siteId: 'test-site-id' };
      const contextWithoutSqs = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {}, // Missing QUEUE_SPACECAT_TO_MYSTIQUE
          dataAccess: context.dataAccess,
        })
        .build();

      const result = await opportunityHandler.generateOpportunities(processedResults, message, contextWithoutSqs);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('skipped');
      expect(result.reason).to.equal('Missing SQS configuration');
      expect(contextWithoutSqs.log.info).to.have.been.calledWith('Missing required SQS queue configuration');
    });

    it('should process opportunities successfully with valid data', async () => {
      // Mock the full pipeline using esmock pattern from internal-links
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([
            {
              url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 3,
            },
          ]),
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          buildOpportunityDataForErrorType: sandbox.stub().returns({
            runbook: 'https://wiki.example.com',
            origin: 'AUTOMATION',
            title: 'Test 404 Opportunity',
            description: 'Test Description',
            guidance: { steps: ['Step 1'] },
            tags: ['test'],
            data: { errorType: '404', totalErrors: 1 },
          }),
        },
        '../../../src/common/audit-utils.js': {
          convertToOpportunity: sandbox.stub().resolves({ getId: () => 'test-404-opportunity-id' }),
        },
        '@adobe/spacecat-shared-utils': {
          SQSClient: {
            fromContext: sandbox.stub().returns(context.sqs),
          },
        },
      });

      const processedResults = {
        totalErrors: 3,
        errorPages: [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 3,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 3 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');
      expect(context.log.info).to.have.been.calledWith('Processing 3 LLM error pages for opportunity generation');
    });
  });

  describe('Utility Functions', () => {
    it('should categorize errors by status code correctly', () => {
      const errorPages = [
        {
          url: 'https://example.com/404-1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        },
        {
          url: 'https://example.com/404-2', status: 404, user_agent: 'Claude', total_requests: 2,
        },
        {
          url: 'https://example.com/403-1', status: 403, user_agent: 'Bard', total_requests: 1,
        },
        {
          url: 'https://example.com/500-1', status: 500, user_agent: 'ChatGPT', total_requests: 1,
        },
      ];

      const result = opportunityHandler.categorizeErrorsByStatusCode(errorPages);

      expect(result[404]).to.have.lengthOf(2);
      expect(result[403]).to.have.lengthOf(1);
      expect(result['5xx']).to.have.lengthOf(1);
    });

    it('should consolidate errors by URL and user agent', () => {
      const errors = [
        {
          url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT-User-Agent', total_requests: '1',
        },
        {
          url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT-User-Agent', total_requests: '2',
        },
        {
          url: 'https://example.com/page2', status: 404, user_agent: 'Claude-User-Agent', total_requests: '3',
        },
      ];

      const result = opportunityHandler.consolidateErrorsByUrl(errors);

      expect(result).to.have.lengthOf(2);
      expect(result[0].totalRequests).to.equal(3); // 1 + 2
      expect(result[0].rawUserAgents).to.include('ChatGPT-User-Agent');
      expect(result[1].totalRequests).to.equal(3);
    });

    it('should sort errors by traffic volume', () => {
      const errors = [
        { url: 'https://example.com/page1', totalRequests: 10 },
        { url: 'https://example.com/page2', totalRequests: 30 },
        { url: 'https://example.com/page3', totalRequests: 20 },
      ];

      const result = opportunityHandler.sortErrorsByTrafficVolume(errors);

      expect(result[0].totalRequests).to.equal(30);
      expect(result[1].totalRequests).to.equal(20);
      expect(result[2].totalRequests).to.equal(10);
    });
  });
  it('should handle missing site record gracefully', async () => {
    const processedResults = {
      totalErrors: 1,
      errorPages: [{
        url: '/broken-link', status: 404, user_agent: 'ChatGPT', total_requests: 2,
      }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    };

    const contextWithMissingSite = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        ...context,
        dataAccess: {
          ...context.dataAccess,
          Site: {
            findById: sandbox.stub().resolves(null), // Simulate no site found
          },
        },
      })
      .build();

    const message = { siteId: 'test-site-id', auditId: 'audit-id' };
    const result = await opportunityHandler.generateOpportunities(processedResults, message, contextWithMissingSite);

    expect(result).to.be.an('object');
    expect(result.status).to.equal('completed'); // Should still complete with site null
  });
  it('should skip opportunity creation if no validated URLs', async () => {
    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([]),
      },
    });

    const processedResults = {
      totalErrors: 1,
      errorPages: [{
        url: '/not-found', status: 404, user_agent: 'ChatGPT', total_requests: 2,
      }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    };

    const message = { siteId: 'test-site-id', auditId: 'audit-id' };
    const result = await mockedHandler.generateOpportunities(processedResults, message, context);

    expect(result.status).to.equal('completed');
  });
  it('should continue processing other categories even if one throws', async () => {
    const failingMapper = sandbox.stub().throws(new Error('Boom'));

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: failingMapper,
      },
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/error-url', status: 404, user_agent: 'ChatGPT', total_requests: 1,
          },
        ]),
      },
    });

    const processedResults = {
      totalErrors: 2,
      errorPages: [
        {
          url: '/error-url', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        },
        {
          url: '/forbidden', status: 403, user_agent: 'Claude', total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 1, 403: 1 } },
    };

    const message = { siteId: 'test-site-id', auditId: 'audit-id' };
    const result = await mockedHandler.generateOpportunities(processedResults, message, context);

    expect(result).to.have.property('status', 'completed');
  });
  it('should retry SQS send and log failed URLs after 3 retries', async () => {
    const sendStub = sandbox.stub().rejects(new Error('SQS Down'));
    const contextWithBrokenSQS = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: { sendMessage: sendStub },
        dataAccess: context.dataAccess,
      })
      .build();

    const processedResults = {
      totalErrors: 1,
      errorPages: [{
        url: '/page', status: 404, user_agent: 'ChatGPT', total_requests: 1,
      }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    };

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/page', status: 404, user_agent: 'ChatGPT', total_requests: 1, validatedAt: new Date().toISOString(),
          },
        ]),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: sandbox.stub().returns({
          runbook: 'https://wiki',
          origin: 'AUTOMATION',
          title: 'Test',
          description: 'Test desc',
          guidance: { steps: ['Fix'] },
          tags: [],
          data: {},
        }),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'opportunity-id',
        }),
      },
      '@adobe/spacecat-shared-utils': {
        SQSClient: {
          fromContext: sandbox.stub().returns(contextWithBrokenSQS.sqs),
        },
      },
    });

    const result = await mockedHandler.generateOpportunities(processedResults, { siteId: 'test-site-id', auditId: 'audit-id' }, contextWithBrokenSQS);

    expect(result.status).to.equal('completed');
    expect(sendStub.callCount).to.be.above(1); // Multiple retries
  });
  it('should log failed URLs and reasons if SQS sending fails after retries', async () => {
    const sendStub = sandbox.stub().rejects(new Error('Mystique unreachable'));
    const contextWithFailingSQS = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: { sendMessage: sendStub },
        dataAccess: context.dataAccess,
      })
      .build();

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/404-url', status: 404, user_agent: 'ChatGPT', total_requests: 1, validatedAt: new Date().toISOString(),
          },
        ]),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: sandbox.stub().returns({
          runbook: 'https://wiki.example.com',
          origin: 'AUTOMATION',
          title: 'Test Opportunity',
          description: 'Description',
          guidance: { steps: ['Fix broken links'] },
          tags: ['404'],
          data: { errorType: '404', totalErrors: 1 },
        }),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'op-id-404' }),
      },
      '@adobe/spacecat-shared-utils': {
        SQSClient: {
          fromContext: sandbox.stub().returns(contextWithFailingSQS.sqs),
        },
      },
    });

    const processedResults = {
      totalErrors: 1,
      errorPages: [
        {
          url: '/404-url', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    };

    const message = { siteId: 'test-site-id', auditId: 'audit-id-404' };
    const result = await mockedHandler.generateOpportunities(processedResults, message, contextWithFailingSQS);

    expect(result.status).to.equal('completed');
    expect(contextWithFailingSQS.log.warn).to.have.been.calledWithMatch(/Failed URLs/); // line 234
    expect(contextWithFailingSQS.log.error).to.have.been.calledWithMatch(/Mystique unreachable/); // line 250–251
  });

  it('should log both success and failed SQS messages', async () => {
    const sendStub = sandbox.stub();
    sendStub.onCall(0).resolves(); // success
    sendStub.onCall(1).rejects(new Error('SQS blocked'));

    const contextWithMixedSQS = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: { sendMessage: sendStub },
        dataAccess: context.dataAccess,
      })
      .build();

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/page1', status: 404, user_agent: 'ChatGPT', total_requests: 2, validatedAt: new Date().toISOString(),
          },
          {
            url: '/page2', status: 404, user_agent: 'Claude', total_requests: 1, validatedAt: new Date().toISOString(),
          },
        ]),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: sandbox.stub().returns({
          runbook: 'https://wiki.example.com',
          origin: 'AUTOMATION',
          title: '404 Opportunity',
          description: 'Desc',
          guidance: { steps: ['Step'] },
          tags: ['404'],
          data: { errorType: '404', totalErrors: 2 },
        }),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'op-404' }),
      },
      '@adobe/spacecat-shared-utils': {
        SQSClient: {
          fromContext: sandbox.stub().returns(contextWithMixedSQS.sqs),
        },
      },
    });

    const processedResults = {
      totalErrors: 2,
      errorPages: [
        {
          url: '/page1', status: 404, user_agent: 'ChatGPT', total_requests: 2,
        },
        {
          url: '/page2', status: 404, user_agent: 'Claude', total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 2 } },
    };

    const result = await mockedHandler.generateOpportunities(processedResults, { siteId: 'test-site-id', auditId: 'audit-id' }, contextWithMixedSQS);

    expect(result.status).to.equal('completed');
    expect(contextWithMixedSQS.log.info).to.have.been.calledWithMatch(/1\/2 successful, 1 failed/);
    expect(contextWithMixedSQS.log.warn).to.have.been.calledWithMatch(/Failed URLs/);
  });
  it('should fallback gracefully if getBaseURL is missing on site object', async () => {
    const contextWithSiteNoBaseURL = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: sandbox.stub().resolves({}),
        dataAccess: {
          ...context.dataAccess,
          Site: {
            findById: sandbox.stub().resolves({
              getDeliveryType: () => 'aem_edge', // but no getBaseURL
            }),
          },
        },
      })
      .build();

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/no-base-url', status: 404, user_agent: 'ChatGPT', total_requests: 2, validatedAt: new Date().toISOString(),
          },
        ]),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: sandbox.stub().returns({
          runbook: 'https://wiki.example.com',
          origin: 'AUTOMATION',
          title: '404 Opportunity',
          description: 'Desc',
          guidance: { steps: ['Step'] },
          tags: ['404'],
          data: { errorType: '404', totalErrors: 1 },
        }),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'op-404' }),
      },
      '@adobe/spacecat-shared-utils': {
        SQSClient: {
          fromContext: sandbox.stub().returns(contextWithSiteNoBaseURL.sqs),
        },
      },
    });

    const processedResults = {
      totalErrors: 1,
      errorPages: [{
        url: '/no-base-url', status: 404, user_agent: 'ChatGPT', total_requests: 2,
      }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    };

    const message = { siteId: 'test-site-id', auditId: 'audit-id' };
    const result = await mockedHandler.generateOpportunities(processedResults, message, contextWithSiteNoBaseURL);

    expect(result.status).to.equal('completed');
  });
  it('should log both success and failed SQS messages with correct error details', async () => {
    const sendStub = sandbox.stub();
    sendStub.onCall(0).resolves(); // simulate successful SQS send
    sendStub.onCall(1).rejects(new Error('SQS blocked')); // simulate failure

    const contextWithMixedSQS = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
        sqs: { sendMessage: sendStub },
        dataAccess: context.dataAccess,
      })
      .build();

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/url-validator.js': {
        validateUrlsBatch: sandbox.stub().resolves([
          {
            url: '/page1', status: 404, user_agent: 'ChatGPT', total_requests: 2, validatedAt: new Date().toISOString(),
          },
          {
            url: '/page2', status: 404, user_agent: 'Claude', total_requests: 1, validatedAt: new Date().toISOString(),
          },
        ]),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        buildOpportunityDataForErrorType: sandbox.stub().returns({
          runbook: 'https://wiki.example.com',
          origin: 'AUTOMATION',
          title: '404 Opportunity',
          description: 'Desc',
          guidance: { steps: ['Step'] },
          tags: ['404'],
          data: { errorType: '404', totalErrors: 2 },
        }),
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'op-404' }),
      },
      '@adobe/spacecat-shared-utils': {
        SQSClient: {
          fromContext: sandbox.stub().returns(contextWithMixedSQS.sqs),
        },
      },
    });

    const processedResults = {
      totalErrors: 2,
      errorPages: [
        {
          url: '/page1', status: 404, user_agent: 'ChatGPT', total_requests: 2,
        },
        {
          url: '/page2', status: 404, user_agent: 'Claude', total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 2 } },
    };

    const message = { siteId: 'test-site-id', auditId: 'audit-id' };
    const result = await mockedHandler.generateOpportunities(processedResults, message, contextWithMixedSQS);

    expect(result.status).to.equal('completed');

    // ✅ Coverage for line 233
    expect(contextWithMixedSQS.log.info).to.have.been.calledWithMatch(/2 successful, 1 failed/);

    // ✅ Coverage for line 234
    expect(contextWithMixedSQS.log.warn).to.have.been.calledWithMatch(/Failed URLs: \/page2/);

    // ✅ Coverage for lines 250–251
    expect(contextWithMixedSQS.log.error).to.have.been.calledWithMatch(/SQS blocked/);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle validation failures gracefully', async () => {
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([]), // No URLs pass validation
        },
      });

      const processedResults = {
        totalErrors: 2,
        errorPages: [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');
    });

    it('should handle SQS sending errors gracefully', async () => {
      const contextWithFailingSqs = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
          sqs: { sendMessage: sandbox.stub().rejects(new Error('SQS error')) },
          dataAccess: context.dataAccess,
        })
        .build();

      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([
            {
              url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
            },
          ]),
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          buildOpportunityDataForErrorType: sandbox.stub().returns({
            runbook: 'https://wiki.example.com',
            origin: 'AUTOMATION',
            title: 'Test Opportunity',
            description: 'Test Description',
            guidance: { steps: ['Step 1'] },
            tags: ['test'],
            data: { errorType: '404', totalErrors: 1 },
          }),
        },
        '../../../src/common/audit-utils.js': {
          convertToOpportunity: sandbox.stub().resolves({ getId: () => 'test-opportunity-id' }),
        },
        '@adobe/spacecat-shared-utils': {
          SQSClient: {
            fromContext: sandbox.stub().returns(contextWithFailingSqs.sqs),
          },
        },
      });

      const processedResults = {
        totalErrors: 1,
        errorPages: [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };

      // Should complete despite SQS errors
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, contextWithFailingSqs);
      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');
    });

    it('should handle mixed error types correctly', async () => {
      const processedResults = {
        totalErrors: 6,
        errorPages: [
          {
            url: 'https://example.com/404-page', status: 404, user_agent: 'ChatGPT', total_requests: 3,
          },
          {
            url: 'https://example.com/403-page', status: 403, user_agent: 'Claude', total_requests: 2,
          },
          {
            url: 'https://example.com/500-page', status: 500, user_agent: 'Bard', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 3, uniqueUserAgents: 3, statusCodes: { 404: 3, 403: 2, 500: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await opportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');
      expect(context.log.info).to.have.been.calledWith('Processing 6 LLM error pages for opportunity generation');
    });

    it('should execute full 404 opportunity pipeline with SQS messaging (lines 123-175, 177-251)', async () => {
      // Mock the full pipeline to ensure URL validation passes and SQS messaging is triggered
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([
            {
              url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 5,
            },
            {
              url: 'https://example.com/page2', status: 404, user_agent: 'Claude', total_requests: 3,
            },
          ]),
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          buildOpportunityDataForErrorType: sandbox.stub().returns({
            runbook: 'https://wiki.example.com/404-errors',
            origin: 'AUTOMATION',
            title: '404 Error Opportunity',
            description: 'URLs returning 404 to LLM crawlers',
            guidance: { steps: ['Fix broken links', 'Verify redirects'] },
            tags: ['seo', '404', 'llm'],
            data: { errorType: '404', totalErrors: 2 },
          }),
        },
        '../../../src/common/audit-utils.js': {
          convertToOpportunity: sandbox.stub().resolves({
            getId: () => 'opportunity-404-123',
          }),
          syncSuggestions: sandbox.stub().resolves(),
        },
        '@adobe/spacecat-shared-utils': {
          SQSClient: {
            fromContext: sandbox.stub().returns(context.sqs),
          },
        },
      });

      // Test with only 404 errors to trigger the SQS messaging path
      const processedResults = {
        totalErrors: 8,
        errorPages: [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 5,
          },
          {
            url: 'https://example.com/page2', status: 404, user_agent: 'Claude', total_requests: 3,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 8 } },
      };

      const contextWithSqs = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
          sqs: context.sqs,
          site: {
            getId: () => 'test-site-id',
            getDeliveryType: () => 'aem_edge',
          },
          dataAccess: context.dataAccess,
        })
        .build();

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, contextWithSqs);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');

      // Verify the full pipeline executed and hit our target lines
      expect(contextWithSqs.log.info).to.have.been.calledWith('Processing 8 LLM error pages for opportunity generation');
      expect(contextWithSqs.log.info).to.have.been.calledWith(sinon.match(/Creating opportunity for 404 errors/));
      expect(contextWithSqs.log.info).to.have.been.calledWith(
        sinon.match(/Sending.*404 URLs to Mystique for AI processing/),
      );
      expect(context.sqs.sendMessage).to.have.been.called;
    });
    // New test case to hit edge paths in sendWithRetry
    it('should handle SQS send failure with unfulfilled promise and log error reason', async () => {
      const sendStub = sandbox.stub();
      sendStub.onCall(0).rejects('SQS crash'); // simulate rejected promise (not fulfilled object)

      const contextWithBrokenSQS = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue-url' },
          sqs: { sendMessage: sendStub },
          dataAccess: context.dataAccess,
        })
        .build();

      const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([
            {
              url: '/broken',
              status: 404,
              user_agent: 'ChatGPT',
              total_requests: 1,
              validatedAt: new Date().toISOString(),
            },
          ]),
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          buildOpportunityDataForErrorType: sandbox.stub().returns({
            runbook: 'https://wiki.example.com',
            origin: 'AUTOMATION',
            title: '404 Opportunity',
            description: 'Broken',
            guidance: { steps: ['Fix broken'] },
            tags: ['404'],
            data: { errorType: '404', totalErrors: 1 },
          }),
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: sandbox.stub().resolves({ getId: () => 'op-404' }),
        },
        '@adobe/spacecat-shared-utils': {
          SQSClient: {
            fromContext: sandbox.stub().returns(contextWithBrokenSQS.sqs),
          },
        },
      });

      const result = await mockedHandler.generateOpportunities({
        errorPages: [
          {
            url: '/broken',
            status: 404,
            user_agent: 'ChatGPT',
            total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
      }, {
        siteId: 'site-1',
        auditId: 'audit-1',
      }, contextWithBrokenSQS);

      expect(result.status).to.equal('completed');
      expect(contextWithBrokenSQS.log.error).to.have.been.calledWithMatch(
        /Failed to send 404 URL to Mystique.*SQS crash/,
      );
    });

    it('should execute full 403/5xx opportunity pipeline with template suggestions (lines 128-175)', async () => {
      // Mock for non-404 errors that use template suggestions instead of SQS
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([
            {
              url: 'https://example.com/forbidden', status: 403, user_agent: 'Bard', total_requests: 2,
            },
            {
              url: 'https://example.com/server-error', status: 500, user_agent: 'Claude', total_requests: 1,
            },
          ]),
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          buildOpportunityDataForErrorType: sandbox.stub().returns({
            runbook: 'https://wiki.example.com/403-errors',
            origin: 'AUTOMATION',
            title: '403/5xx Error Opportunity',
            description: 'URLs returning 403/5xx to LLM crawlers',
            guidance: { steps: ['Check access permissions', 'Review server errors'] },
            tags: ['seo', '403', '5xx', 'llm'],
            data: { errorType: '403', totalErrors: 3 },
          }),
        },
        '../../../src/common/audit-utils.js': {
          convertToOpportunity: sandbox.stub().resolves({
            getId: () => 'opportunity-403-456',
          }),
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      // Test with 403 and 5xx errors to trigger template suggestion path
      const processedResults = {
        totalErrors: 3,
        errorPages: [
          {
            url: 'https://example.com/forbidden', status: 403, user_agent: 'Bard', total_requests: 2,
          },
          {
            url: 'https://example.com/server-error', status: 500, user_agent: 'Claude', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 403: 2, 500: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');

      // Verify template suggestion path was taken (not SQS messaging)
      expect(context.log.info).to.have.been.calledWith('Processing 3 LLM error pages for opportunity generation');
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Creating opportunity for 403 errors/));
      expect(context.log.info).to.have.been.calledWith(sinon.match(/Creating opportunity for 5xx errors/));

      // 403/5xx errors should NOT trigger SQS messaging to Mystique
      expect(context.log.info).to.not.have.been.calledWith(sinon.match(/Sending.*URLs to Mystique/));
    });

    it('should handle no validated URLs scenario (lines 309-311)', async () => {
      // Mock URL validation to return empty array (no URLs pass validation)
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/url-validator.js': {
          validateUrlsBatch: sandbox.stub().resolves([]), // No URLs pass validation
        },
      });

      const processedResults = {
        totalErrors: 2,
        errorPages: [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await mockedOpportunityHandler.generateOpportunities(processedResults, message, context);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');
      // Should log that no URLs passed validation
      expect(context.log.info).to.have.been.calledWith(sinon.match(/No URLs passed validation.*skipping/));
    });
  });

  // New tests using reference patterns from broken-backlinks.test.js and internal-links
  describe('Deep Pipeline Tests Using Reference Patterns', () => {
    it('should execute comprehensive 404 opportunity creation using broken-backlinks patterns (lines 123-175, 177-251)', async () => {
      // Apply broken-backlinks.test.js pattern: MockContextBuilder + nock + realistic scenarios
      const mockContext = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.amazonaws.com/queue/mystique' },
          sqs: { sendMessage: sandbox.stub().resolves({ MessageId: 'message-id-123' }) },
          dataAccess: {
            Site: { findById: sandbox.stub().resolves({ getId: () => 'site-abc', getDeliveryType: () => 'aem_edge' }) },
            Opportunity: { create: sandbox.stub().resolves({ getId: () => 'opportunity-404-abc' }) },
            Audit: { findById: sandbox.stub().resolves({ getId: () => 'audit-xyz' }) },
          },
        })
        .build();

      // Use nock like broken-backlinks.test.js for realistic HTTP validation
      nock('https://example.com')
        .head('/missing-page-1')
        .reply(404);

      nock('https://example.com')
        .head('/missing-page-2')
        .reply(404);

      const processedResults = {
        totalErrors: 8,
        errorPages: [
          {
            url: 'https://example.com/missing-page-1', status: 404, user_agent: 'ChatGPT-User', total_requests: '5',
          },
          {
            url: 'https://example.com/missing-page-2', status: 404, user_agent: 'Claude-Bot', total_requests: '3',
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 8 } },
      };

      const message = { siteId: 'site-abc', auditId: 'audit-xyz' };
      const result = await opportunityHandler.generateOpportunities(processedResults, message, mockContext);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');

      // Verify deep pipeline execution hitting target lines
      expect(mockContext.log.info).to.have.been.calledWith('Processing 8 LLM error pages for opportunity generation');
      expect(mockContext.log.info).to.have.been.calledWith(sinon.match(/Processing 404 category/));
      expect(mockContext.log.info).to.have.been.calledWith(sinon.match(/Creating opportunity for 404 errors/));
      expect(mockContext.sqs.sendMessage).to.have.been.called;
    });

    it('should process 403/5xx errors using internal-links patterns (lines 128-175)', async () => {
      // Apply internal-links pattern for non-SQS error processing
      const mockContext = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
          dataAccess: context.dataAccess,
        })
        .build();

      nock('https://test-site.com')
        .head('/blocked-page')
        .reply(403);

      nock('https://test-site.com')
        .head('/server-error-page')
        .reply(500);

      const processedResults = {
        totalErrors: 4,
        errorPages: [
          {
            url: 'https://test-site.com/blocked-page', status: 403, user_agent: 'Bard', total_requests: '3',
          },
          {
            url: 'https://test-site.com/server-error-page', status: 500, user_agent: 'Claude', total_requests: '1',
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 403: 3, 500: 1 } },
      };

      const message = { siteId: 'test-site-id', auditId: 'test-audit-id' };
      const result = await opportunityHandler.generateOpportunities(processedResults, message, mockContext);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('completed');

      // Should hit template suggestion path (not SQS) - lines 128-175
      expect(mockContext.log.info).to.have.been.calledWith('Processing 4 LLM error pages for opportunity generation');
      expect(mockContext.log.info).to.have.been.calledWith(sinon.match(/Processing 403 category/));
      expect(mockContext.log.info).to.have.been.calledWith(sinon.match(/Processing 5xx category/));

      // Should NOT trigger SQS messaging for 403/5xx errors
      expect(mockContext.log.info).to.not.have.been.calledWith(sinon.match(/Sending.*URLs to Mystique/));
    });
  });
});
