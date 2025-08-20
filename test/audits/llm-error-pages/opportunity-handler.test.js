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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';
import {
  generateOpportunities, consolidateErrorsByUrl, sortErrorsByTrafficVolume, categorizeErrorsByStatusCode,
} from '../../../src/llm-error-pages/opportunity-handler.js';

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
              getId: () => 'test-site-id',
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
      const result = await generateOpportunities(processedResults, message, context);

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

      const result = await generateOpportunities(processedResults, null, context);

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

      const result = await generateOpportunities(processedResults, message, contextWithoutSqs);

      expect(result).to.be.an('object');
      expect(result.status).to.equal('skipped');
      expect(result.reason).to.equal('Missing SQS configuration');
      expect(contextWithoutSqs.log.info).to.have.been.calledWith('Missing required SQS queue configuration');
    });

    it('should process opportunities successfully with valid data', async () => {
      // Mock the full pipeline using esmock pattern from internal-links
      const mockedOpportunityHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/utils.js': {
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

      const result = categorizeErrorsByStatusCode(errorPages);

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

      const result = consolidateErrorsByUrl(errors);

      expect(result).to.have.lengthOf(2);
      expect(result[0].totalRequests).to.equal(3); // 1 + 2
      expect(result[0].rawUserAgents).to.include('ChatGPT-User-Agent');
      expect(result[1].totalRequests).to.equal(3);
    });

    it('consolidateErrorsByUrl handles missing total_requests and aggregates correctly', () => {
      const errors = [
        {
          url: '/same', status: 404, user_agent: 'ChatGPT', total_requests: undefined,
        },
        {
          url: '/same', status: 404, user_agent: 'ChatGPT', total_requests: '2',
        },
        {
          url: '/other', status: 404, user_agent: 'Claude', total_requests: '1',
        },
      ];
      const result = consolidateErrorsByUrl(errors);
      const same = result.find((e) => e.url === '/same');
      const other = result.find((e) => e.url === '/other');
      expect(same.totalRequests).to.equal(2);
      expect(other.totalRequests).to.equal(1);
    });

    it('should sort errors by traffic volume', () => {
      const errors = [
        { url: 'https://example.com/page1', totalRequests: 10 },
        { url: 'https://example.com/page2', totalRequests: 30 },
        { url: 'https://example.com/page3', totalRequests: 20 },
      ];

      const result = sortErrorsByTrafficVolume(errors);

      expect(result[0].totalRequests).to.equal(30);
      expect(result[1].totalRequests).to.equal(20);
      expect(result[2].totalRequests).to.equal(10);
    });

    it('consolidateErrorsByUrl aggregated path handles zero increment when total_requests is missing', () => {
      const errors = [
        {
          url: '/same', status: 404, user_agent: 'ChatGPT', total_requests: undefined,
        },
        {
          url: '/same', status: 404, user_agent: 'ChatGPT', total_requests: undefined,
        }, // force aggregate with 0
      ];
      const result = consolidateErrorsByUrl(errors);
      const same = result.find((e) => e.url === '/same');
      expect(same.totalRequests).to.equal(0);
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
    try {
      await generateOpportunities(processedResults, message, contextWithMissingSite);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.include('Site not found for siteId: test-site-id');
    }
  });
  it('should skip opportunity creation if no validated URLs', async () => {
    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/utils.js': {
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
      '../../../src/llm-error-pages/utils.js': {
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

  describe('createOpportunityForErrorCategory - informational suggestions', () => {
    it('creates informational suggestions for 403 using the forbidden template', async () => {
      let capturedSuggestions;
      let capturedKeys = [];
      const syncSuggestions = sandbox.stub().callsFake(async ({ newData, mapNewSuggestion, buildKey }) => {
        capturedSuggestions = newData.map((e, i) => mapNewSuggestion(e, i));
        capturedKeys = [buildKey(newData[0])];
      });

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-1' }),
          },
          '../../../src/llm-error-pages/opportunity-data-mapper.js': await import('../../../src/llm-error-pages/opportunity-data-mapper.js'),
          '../../../src/utils/data-access.js': { syncSuggestions },
        },
      );

      const enhancedErrors = [{
        url: '/private', status: '403', userAgent: 'ChatGPT', totalRequests: 5, rawUserAgents: ['ua'], validatedAt: 't',
      }];

      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };
      await createOpportunityForErrorCategory('403', enhancedErrors, 'site-1', 'audit-1', { log });

      expect(syncSuggestions).to.have.been.calledOnce;
      expect(capturedSuggestions).to.have.lengthOf(1);
      expect(capturedSuggestions[0].data.suggestion).to.match(/Review access permissions for \/private - ChatGPT crawler is blocked/);
      expect(capturedSuggestions[0].data.suggestionType).to.equal('INFORMATIONAL');
      expect(capturedSuggestions[0].data.statusCode).to.equal('403');
      expect(capturedSuggestions[0].rank).to.equal(1);
      expect(capturedKeys[0]).to.equal('/private|403|ChatGPT');
    });

    it('creates informational suggestions for 5xx using the server error template', async () => {
      let capturedSuggestions;
      let capturedKeys = [];
      const syncSuggestions = sandbox.stub().callsFake(async ({ newData, mapNewSuggestion, buildKey }) => {
        capturedSuggestions = newData.map((e, i) => mapNewSuggestion(e, i));
        capturedKeys = [buildKey(newData[0])];
      });

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-2' }),
          },
          '../../../src/llm-error-pages/opportunity-data-mapper.js': await import('../../../src/llm-error-pages/opportunity-data-mapper.js'),
          '../../../src/utils/data-access.js': { syncSuggestions },
        },
      );

      const enhancedErrors = [{
        url: '/server-error', status: '500', userAgent: 'Claude', totalRequests: 2, rawUserAgents: ['ua'], validatedAt: 't',
      }];

      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };
      await createOpportunityForErrorCategory('5xx', enhancedErrors, 'site-2', 'audit-2', { log });

      expect(syncSuggestions).to.have.been.calledOnce;
      expect(capturedSuggestions).to.have.lengthOf(1);
      expect(capturedSuggestions[0].data.suggestion).to.match(/Fix server error for \/server-error - returning 500 to Claude crawler/);
      expect(capturedSuggestions[0].data.suggestionType).to.equal('INFORMATIONAL');
      expect(capturedSuggestions[0].data.statusCode).to.equal('500');
      expect(capturedSuggestions[0].rank).to.equal(1);
      expect(capturedKeys[0]).to.equal('/server-error|500|Claude');
    });

    it('uses default informational template for non-403, non-5xx statuses', async () => {
      let capturedSuggestions;
      const syncSuggestions = sandbox.stub().callsFake(async ({ newData, mapNewSuggestion }) => {
        capturedSuggestions = newData.map((e, i) => mapNewSuggestion(e, i));
      });

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-4' }),
          },
          '../../../src/utils/data-access.js': { syncSuggestions },
        },
      );

      const enhancedErrors = [{
        url: '/bad', status: '400', userAgent: 'Gemini', totalRequests: 1, rawUserAgents: [], validatedAt: 't',
      }];
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };

      await createOpportunityForErrorCategory('5xx', enhancedErrors, 'site-3', 'audit-3', { log });

      expect(capturedSuggestions[0].data.suggestion).to.match(/Fix error for \/bad - Gemini crawler affected/);
    });
  });

  describe('createOpportunityForErrorCategory - 404 SQS queuing', () => {
    it('queues validated 404 URLs to Mystique with correct message shape', async () => {
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const env = { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' };
      const site = { getBaseURL: () => 'https://example.com', getDeliveryType: () => 'aem_edge', getId: () => 'site-1' };
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-3', auditId: 'audit-1' }),
          },
        },
      );

      const enhancedErrors = [
        {
          url: '/a', status: '404', userAgent: 'ChatGPT', totalRequests: 5, rawUserAgents: ['ua'], validatedAt: 't',
        },
        {
          url: '/b', status: '404', userAgent: 'ChatGPT', totalRequests: 3, rawUserAgents: ['ua'], validatedAt: 't',
        },
      ];

      await createOpportunityForErrorCategory('404', enhancedErrors, 'site-1', 'audit-1', {
        log, sqs, env, site,
      });

      expect(sqs.sendMessage.callCount).to.equal(2);
      const [queue, firstMsg] = sqs.sendMessage.firstCall.args;
      expect(queue).to.equal('queue-url');
      expect(firstMsg.type).to.equal('guidance:llm-error-pages');
      expect(firstMsg.auditId).to.equal('audit-1');
      expect(firstMsg.data.opportunityId).to.equal('oppty-3');
      expect(firstMsg.data.brokenUrl).to.equal('https://example.com/a');

      const infoLogs = log.info.getCalls().map((c) => c.args[0]).join('\n');
      expect(infoLogs).to.match(/Queued 2 validated 404 URLs to Mystique for AI processing/);
    });

    it('defaults deliveryType to aem_edge and auditId to unknown when missing', async () => {
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const env = { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' };
      const site = { getBaseURL: () => 'https://example.com' }; // no getDeliveryType
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-x' }), // no auditId
          },
        },
      );

      const enhancedErrors = [{
        url: '/def', status: '404', userAgent: 'Claude', totalRequests: 1, rawUserAgents: [], validatedAt: 't',
      }];

      await createOpportunityForErrorCategory('404', enhancedErrors, 'site-1', undefined, {
        log, sqs, env, site,
      });

      const [, msg] = sqs.sendMessage.firstCall.args;
      expect(msg.auditId).to.equal('unknown');
      expect(msg.deliveryType).to.equal('aem_edge');
    });

    it('skips SQS send when sqs or queue env missing', async () => {
      const site = { getBaseURL: () => 'https://example.com', getDeliveryType: () => 'aem_edge' };
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-5' }),
          },
        },
      );

      const enhancedErrors = [{
        url: '/a', status: '404', userAgent: 'ChatGPT', totalRequests: 5, rawUserAgents: [], validatedAt: 't',
      }];

      await createOpportunityForErrorCategory('404', enhancedErrors, 'site-1', 'audit-1', { log, site });
      // Should log created opportunity and not the queued message
      const infoLogs = log.info.getCalls().map((c) => c.args[0]).join('\n');
      expect(infoLogs).to.match(/Created opportunity oppty-5/);
      expect(infoLogs).to.not.match(/Queued \d+ validated 404 URLs/);
    });

    it('falls back to raw URL when site.getBaseURL is missing', async () => {
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const env = { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' };
      const site = {}; // no getBaseURL
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };

      const { createOpportunityForErrorCategory } = await esmock(
        '../../../src/llm-error-pages/opportunity-handler.js',
        {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-6' }),
          },
        },
      );

      const enhancedErrors = [{
        url: '/raw', status: '404', userAgent: 'Perplexity', totalRequests: 1, rawUserAgents: [], validatedAt: 't',
      }];

      await createOpportunityForErrorCategory('404', enhancedErrors, 'site-1', 'audit-1', {
        log, sqs, env, site,
      });

      const [, msg] = sqs.sendMessage.firstCall.args;
      expect(msg.data.brokenUrl).to.equal('/raw');
    });
  });

  describe('createOpportunityForErrorCategory - early return', () => {
    it('returns early with no enhanced errors', async () => {
      const { createOpportunityForErrorCategory } = await import('../../../src/llm-error-pages/opportunity-handler.js');
      const log = {
        info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: () => {},
      };
      await createOpportunityForErrorCategory('404', [], 'site-1', 'audit-1', { log });
      expect(log.info).to.have.been.calledWithMatch(/No validated errors for 404 category - skipping/);
    });
  });

  describe('generateOpportunities - edge conditions', () => {
    it('completes with no categories when only non-target statuses exist', async () => {
      const processedResults = {
        totalErrors: 1,
        errorPages: [{
          url: '/ok', status: 200, user_agent: 'ChatGPT', total_requests: 1,
        }],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 200: 1 } },
      };
      const message = { siteId: 'test-site-id', auditId: 'aid' };
      const result = await generateOpportunities(processedResults, message, context);
      expect(result.status).to.equal('completed');
      expect(result.processedUrls).to.equal(0);
    });
  });

  describe('generateOpportunities - branch coverage', () => {
    it('uses errorPages.length when totalErrors is missing (OR branch)', async () => {
      const processedResults = {
        // totalErrors intentionally omitted
        errorPages: [{
          url: '/x', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        }],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };
      const message = { siteId: 'test-site-id', auditId: 'aid' };
      const result = await generateOpportunities(processedResults, message, context);
      expect(result.status).to.equal('completed');
      // Ensure the log path using errorPages.length is executed
      const infoLogs = context.log.info.getCalls().map((c) => c.args[0]).join('\n');
      expect(infoLogs).to.match(/Processing 1 LLM error pages for opportunity generation/);
    });

    it('logs error for a category failure and continues (catch branch)', async () => {
      const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/utils.js': {
          validateUrlsBatch: sandbox.stub().throws(new Error('validation failed')),
        },
      });

      const processedResults = {
        errorPages: [
          {
            url: '/x', status: 404, user_agent: 'ChatGPT', total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      };
      const message = { siteId: 'test-site-id', auditId: 'aid' };
      const result = await mockedHandler.generateOpportunities(processedResults, message, context);
      expect(result.status).to.equal('completed');
      const errorLogs = context.log.error.getCalls().map((c) => c.args[0]).join('\n');
      expect(errorLogs).to.match(/Failed to process 404 category: validation failed/);
    });
  });

  it('mixes success and failure categories in same run (try and catch edges)', async () => {
    const validateStub = sandbox.stub().callsFake(async (errors) => {
      if (`${errors[0]?.status}` === '404') {
        throw new Error('simulated validation fail');
      }
      return errors;
    });

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/utils.js': {
        validateUrlsBatch: validateStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-mix' }),
      },
    });

    const processedResults = {
      errorPages: [
        {
          url: '/x', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        },
        {
          url: '/y', status: 500, user_agent: 'Claude', total_requests: 2,
        },
      ],
      summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 1, 500: 2 } },
    };
    const message = { siteId: 'test-site-id', auditId: 'aid' };

    const result = await mockedHandler.generateOpportunities(processedResults, message, context);
    expect(result.status).to.equal('completed');

    const errorLogs = context.log.error.getCalls().map((c) => c.args[0]).join('\n');
    expect(errorLogs).to.match(/Failed to process 404 category: simulated validation fail/);

    const infoLogs = context.log.info.getCalls().map((c) => c.args[0]).join('\n');
    expect(infoLogs).to.match(/Processing 404 category/);
    expect(infoLogs).to.match(/Processing 5xx category/);
  });

  it('three-category run (404 throws, 5xx succeeds, 403 succeeds) exercises try/catch edges', async () => {
    const validateStub = sandbox.stub().callsFake(async (errors) => {
      const status = `${errors[0]?.status}`;
      if (status === '404') {
        throw new Error('three-way validation fail');
      }
      // echo back as validated for non-404
      return errors.map((e) => ({
        url: e.url,
        status: `${e.status}`,
        userAgent: 'ChatGPT',
        totalRequests: e.total_requests || 1,
        rawUserAgents: ['ua'],
        validatedAt: 't',
      }));
    });

    const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
      '../../../src/llm-error-pages/utils.js': {
        validateUrlsBatch: validateStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-three' }),
      },
    });

    const processedResults = {
      errorPages: [
        {
          url: '/a404', status: 404, user_agent: 'ChatGPT', total_requests: 1,
        },
        {
          url: '/b500', status: 500, user_agent: 'Claude', total_requests: 2,
        },
        {
          url: '/c403', status: 403, user_agent: 'Gemini', total_requests: 3,
        },
      ],
      summary: { uniqueUrls: 3, uniqueUserAgents: 3, statusCodes: { 404: 1, 500: 2, 403: 3 } },
    };
    const message = { siteId: 'test-site-id', auditId: 'aid' };

    const result = await mockedHandler.generateOpportunities(processedResults, message, context);
    expect(result.status).to.equal('completed');

    const errorLogs = context.log.error.getCalls().map((c) => c.args[0]).join('\n');
    expect(errorLogs).to.match(/Failed to process 404 category: three-way validation fail/);

    const infoLogs = context.log.info.getCalls().map((c) => c.args[0]).join('\n');
    expect(infoLogs).to.match(/Processing 404 category/);
    expect(infoLogs).to.match(/Processing 5xx category/);
    expect(infoLogs).to.match(/Processing 403 category/);
  });

  describe('processCategory - branch coverage for prepared logs', () => {
    it('logs Prepared message for 404 branch in processCategory', async () => {
      const validateStub = sandbox.stub().callsFake(async (sortedErrors) => sortedErrors.map((e) => ({
        url: e.url,
        status: `${e.status}`,
        userAgent: e.userAgent || 'ChatGPT',
        totalRequests: e.totalRequests || 1,
        rawUserAgents: ['ua'],
        validatedAt: 't',
      })));

      const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/utils.js': {
          validateUrlsBatch: validateStub,
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-pc-404' }),
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      const site = { getBaseURL: () => 'https://example.com', getDeliveryType: () => 'aem_edge' };
      const contextLocal = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
          sqs: { sendMessage: sandbox.stub().resolves() },
        })
        .build();

      const rawErrors = [
        {
          url: '/a404',
          status: 404,
          user_agent: 'ChatGPT',
          total_requests: 1,
        },
      ];

      await mockedHandler.processCategory('404', rawErrors, 'site-1', 'aid', contextLocal, site);

      const infoLogs = contextLocal.log.info.getCalls().map((c) => c.args[0]).join('\n');
      expect(infoLogs).to.match(/Prepared 1 validated 404 URLs for Mystique AI processing/);
    });

    it('logs Prepared message for non-404 branch in processCategory', async () => {
      const validateStub = sandbox.stub().callsFake(async (sortedErrors) => sortedErrors.map((e) => ({
        url: e.url,
        status: `${e.status}`,
        userAgent: e.userAgent || 'Claude',
        totalRequests: e.totalRequests || 1,
        rawUserAgents: ['ua'],
        validatedAt: 't',
      })));

      const mockedHandler = await esmock('../../../src/llm-error-pages/opportunity-handler.js', {
        '../../../src/llm-error-pages/utils.js': {
          validateUrlsBatch: validateStub,
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: sandbox.stub().resolves({ getId: () => 'oppty-pc-5xx' }),
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: sandbox.stub().resolves(),
        },
      });

      const site = { getBaseURL: () => 'https://example.com', getDeliveryType: () => 'aem_edge' };
      const contextLocal = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
          sqs: { sendMessage: sandbox.stub().resolves() },
        })
        .build();

      const rawErrors = [
        {
          url: '/b500',
          status: 500,
          user_agent: 'Claude',
          total_requests: 2,
        },
      ];

      await mockedHandler.processCategory('5xx', rawErrors, 'site-1', 'aid', contextLocal, site);

      const infoLogs = contextLocal.log.info.getCalls().map((c) => c.args[0]).join('\n');
      expect(infoLogs).to.match(/Prepared 1 validated 5xx URLs for template suggestions/);
    });
  });
});
