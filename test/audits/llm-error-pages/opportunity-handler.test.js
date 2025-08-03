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
});
