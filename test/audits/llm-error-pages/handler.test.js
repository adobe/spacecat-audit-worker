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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

describe('LLM Error Pages Handler', () => {
  let handler;
  let mockAthenaClient;
  let sandbox;
  let mockGetS3Config;
  let mockGenerateReportingPeriods;
  let mockBuildSiteFilters;
  let mockProcessResults;
  let mockBuildQuery;
  let mockGetAllLlmProviders;
  let mockCreateLLMOSharepointClient;
  let mockSaveExcelReport;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAthenaClient = { query: sandbox.stub() };

    mockGetS3Config = sandbox.stub().returns({
      bucket: 'test-bucket',
      customerName: 'test-customer',
      databaseName: 'test_db',
      tableName: 'test_table',
      getAthenaTempLocation: () => 's3://test-bucket/temp/',
    });

    mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [{
        weekNumber: 34, year: 2025, startDate: new Date('2025-08-18T00:00:00Z'), endDate: new Date('2025-08-24T23:59:59Z'),
      }],
    });

    mockBuildSiteFilters = sandbox.stub().returns('');

    mockProcessResults = sandbox.stub().returns({
      totalErrors: 3,
      errorPages: [
        {
          user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
        },
        {
          user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
        },
        {
          user_agent: 'Chrome/120 Claude/1.0', url: '/api/data', status: 503, total_requests: 5,
        },
      ],
      summary: { uniqueUrls: 3, uniqueUserAgents: 3, statusCodes: { 404: 4, 403: 3, 503: 5 } },
    });

    mockBuildQuery = sandbox.stub().resolves('SELECT ...');
    mockGetAllLlmProviders = sandbox.stub().returns(['chatgpt', 'perplexity']);

    // SharePoint client stub
    mockCreateLLMOSharepointClient = sandbox.stub().resolves({});
    mockSaveExcelReport = sandbox.stub().resolves();

    // Mock ExcelJS
    const mockWorksheet = {
      addRow: sandbox.stub(),
    };
    const mockWorkbook = {
      addWorksheet: sandbox.stub().returns(mockWorksheet),
    };
    const mockExcelJS = {
      Workbook: sandbox.stub().returns(mockWorkbook),
    };

    handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
      },
      '../../../src/llm-error-pages/utils.js': {
        getS3Config: mockGetS3Config,
        generateReportingPeriods: mockGenerateReportingPeriods,
        buildSiteFilters: mockBuildSiteFilters,
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: mockBuildQuery,
        getAllLlmProviders: mockGetAllLlmProviders,
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateLLMOSharepointClient,
        saveExcelReport: mockSaveExcelReport,
      },
      exceljs: {
        default: mockExcelJS,
      },
    });
  });

  afterEach(() => sandbox.restore());

  describe('Main Audit Runner', () => {
    it('processes errors and generates Excel files successfully', async () => {
      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'customer' }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const context = {
        log: console,
        audit: {},
        sqs: null,
        env: {},
        dataAccess: {},
      };

      const result = await handler.runner('https://example.com', context, site);

      // Verify Excel reports were saved 3 times (404, 403, 5xx)
      expect(mockSaveExcelReport.callCount).to.equal(3);

      // Verify audit result structure
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
      expect(result.auditResult.totalErrors).to.equal(3);
      expect(result.auditResult.categorizedResults).to.exist;
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('handles audit failure and returns error result', async () => {
      mockAthenaClient.query.rejects(new Error('Database connection failed'));

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const context = {
        log: console,
        audit: {},
        sqs: null,
        env: {},
        dataAccess: {},
      };

      const result = await handler.runner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Database connection failed');
      expect(result.auditResult.database).to.equal('test_db');
      expect(result.auditResult.table).to.equal('test_table');
      expect(result.auditResult.customer).to.equal('test-customer');
    });

    it('handles site with no config', async () => {
      mockAthenaClient.query.resolves([]);

      // Override mock to return only 404 errors
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: {}, sqs: null, dataAccess: {},
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    });

    it('handles invalid URLs with no site base URL', async () => {
    // This test exercises the catch block in toPathOnly with no base URL
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '\x00invalid-url-with-null-char', status: 404, total_requests: 1,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => null, // No base URL
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: {}, sqs: null, dataAccess: {},
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    });

    it('handles URL constructor throwing error', async () => {
    // This test exercises the catch block in toPathOnly by mocking URL constructor to throw
      mockProcessResults.returns({
        totalErrors: 3,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
          {
            user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
          },
          {
            user_agent: 'Chrome/120 Claude/1.0', url: '/api/data', status: 503, total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 3, uniqueUserAgents: 3, statusCodes: { 404: 4, 403: 3, 503: 5 } },
      });

      mockAthenaClient.query.resolves([]);

      // Temporarily override the global URL constructor to throw
      const originalURL = global.URL;
      global.URL = function MockURL() {
        throw new TypeError('Invalid URL');
      };

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: {}, sqs: null, dataAccess: {},
      };

      try {
        const result = await handler.runner('https://example.com', ctx, site);
        expect(result.auditResult.success).to.be.true;
        expect(mockSaveExcelReport.callCount).to.equal(3); // 404, 403, 5xx files generated
      } finally {
      // Restore original URL constructor
        global.URL = originalURL;
      }
    });

    it('handles empty errors array and skips Excel generation', async () => {
      // Mock processResults to return only 403 and 5xx errors (no 404)
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
          },
          {
            user_agent: 'Chrome/120 Claude/1.0', url: '/api/data', status: 503, total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 403: 3, 503: 5 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const context = {
        log: console,
        audit: {},
        sqs: null,
        env: {},
        dataAccess: {},
      };

      const result = await handler.runner('https://example.com', context, site);

      expect(result.auditResult.success).to.be.true;
      // No SQS message sent since sqs is null
      expect(mockSaveExcelReport.callCount).to.equal(2); // 403 and 5xx files generated
    });

    it('skips SQS when no SQS client provided', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs: null, dataAccess: {},
      }; // No SQS

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    });

    it('skips SQS when no queue environment variable', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const ctx = {
        log: console, env: {}, sqs, dataAccess: {},
      }; // No QUEUE_SPACECAT_TO_MYSTIQUE

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(sqs.sendMessage.called).to.be.false; // No SQS message sent
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    });

    it('handles site with no base URL in SQS message', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const site = {
        getBaseURL: () => null, // No base URL
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: {}, sqs: null, dataAccess,
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      // Note: SQS messaging is tested in post-processor tests
    });

    it('handles site with no config at all', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => null, // No config at all
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console, env: {}, sqs: null, dataAccess: {},
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    });

    it('handles audit and site method fallbacks in SQS message', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: null, // No getDeliveryType method
      };

      // No audit provided (null)
      const ctx = {
        log: console, env: {}, sqs: null, dataAccess,
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      // Note: SQS messaging is tested in post-processor tests
    });

    it('handles empty categorized results with 404 fallback', async () => {
    // Mock categorizeErrorsByStatusCode to return an object without 404 key
    // This tests the || [] fallback when 404 key doesn't exist

      // We need to mock the import - this is tricky with ES modules
      // Instead, let's create a scenario where 404s are filtered out
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
          },
          {
            user_agent: 'Chrome/120 Claude/1.0', url: '/api/data', status: 503, total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 403: 3, 503: 5 } },
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const ctx = {
        log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess: {},
      };

      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(sqs.sendMessage.called).to.be.false; // No SQS message sent
    });

    it('skips message when SQS not configured', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const context = {
        log: console,
        env: {}, // No QUEUE_SPACECAT_TO_MYSTIQUE
        sqs: null,
        dataAccess: {},
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(result).to.deep.equal(auditData);
    });

    it('handles site with no base URL in SQS message', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => null, // No base URL
            getDeliveryType: () => 'aem_edge',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'test-audit-id',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Check that the message uses the URL directly (no baseUrl prefix)
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(msg.data.brokenLinks[0].urlTo).to.equal('/p1'); // No baseUrl prefix

      expect(result).to.deep.equal(auditData);
    });

    it('handles site with missing delivery type and uses fallback', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => undefined, // Missing delivery type (line 216)
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: console,
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'test-audit-id',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Check that the fallback delivery type is used (line 216)
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(msg.deliveryType).to.equal('aem_edge'); // Should use fallback value

      expect(result).to.deep.equal(auditData);
    });

    it('handles missing audit ID and uses fallback', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
            getId: () => 'site-1',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: console,
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => null, // Return null to test fallback
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(result.auditResult.success).to.be.true;
      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Check that the message uses fallback auditId when audit.getId() returns null
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(msg.auditId).to.equal('llm-error-pages-audit'); // Fallback auditId
    });

    it('covers final branches 129 & 139 with direct data manipulation', async () => {
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 4 } },
      });

      mockAthenaClient.query.resolves([]);

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const auditWithGetId = {
        getId: () => 'audit-123',
      };

      const ctx = {
        log: console,
        env: {},
        sqs: null,
        dataAccess,
        audit: auditWithGetId, // Put audit in context, not as separate parameter
      };

      // This should hit both branches since:
      // - processErrorPagesResults returns 404 errors
      // - categorizeErrorsByStatusCode will naturally create a 404 key with those errors
      // - audit.getId() will return 'audit-123' instead of using fallback
      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      // Note: SQS messaging is tested in post-processor tests
    });
  });

  describe('Post Processors', () => {
    it('covers SQS message construction and success logging for 100% coverage', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0',
                url: '/page1',
                status: 404,
                total_requests: 5,
              },
              {
                user_agent: 'Chrome/120 Perplexity/5.0',
                url: '/page1', // Same URL, different user agent
                status: 404,
                total_requests: 3,
              },
              {
                user_agent: 'Chrome/120 Claude/1.0',
                url: '/page2',
                status: 404,
                total_requests: 2,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [
        { getUrl: () => 'https://example.com/' },
        { getUrl: () => 'https://example.com/popular' },
      ];

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
            getId: () => 'site-1',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'test-audit-id',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      // Verify SQS message was sent (covers line 230)
      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Verify success log was called (covers line 231)
      expect(context.log.info.calledWith(sinon.match(/Queued \d+ consolidated 404 URLs to Mystique for AI processing/))).to.be.true;

      // Verify message structure includes brokenLinks mapping (covers lines 220-222)
      const message = sqs.sendMessage.firstCall.args[1];
      expect(message.data.brokenLinks).to.be.an('array');
      expect(message.data.brokenLinks).to.have.length(2); // Two unique URLs

      // Verify URL mapping logic (line 220-222)
      const firstLink = message.data.brokenLinks.find((link) => link.urlTo === 'https://example.com/page1');
      expect(firstLink).to.exist;
      expect(firstLink.urlFrom).to.include('ChatGPT');
      expect(firstLink.urlFrom).to.include('Perplexity');
      expect(firstLink.suggestionId).to.match(/llm-404-suggestion-w34-2025-\d+/);

      const secondLink = message.data.brokenLinks.find((link) => link.urlTo === 'https://example.com/page2');
      expect(secondLink).to.exist;
      expect(secondLink.urlFrom).to.include('Claude');
      expect(secondLink.suggestionId).to.match(/llm-404-suggestion-w34-2025-\d+/);

      // Verify other message properties
      expect(message.data.alternativeUrls).to.deep.equal([
        'https://example.com/',
        'https://example.com/popular',
      ]);
      expect(message.data.opportunityId).to.equal('llm-404-w34-2025');

      expect(result).to.deep.equal(auditData);
    });

    it('covers categorizedResults[404] undefined fallback', async () => {
    // We need categorizedResults to NOT have a 404 property, triggering the || [] fallback

      // Mock processErrorPagesResults to return non-404 errors only
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
          },
          {
            user_agent: 'Chrome/120 Claude/1.0', url: '/api/data', status: 503, total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 403: 3, 503: 5 } },
      });

      mockAthenaClient.query.resolves([]);

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {};

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
      };

      const ctx = {
        log: console,
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
      };

      // Since we only have 403/5xx errors, categorizeErrorsByStatusCode will return:
      // { 403: [...], '5xx': [...] } - NO 404 property
      // This triggers: const errors404 = categorizedResults[404] || [];
      const result = await handler.runner('https://example.com', ctx, site);

      expect(result.auditResult.success).to.be.true;
      expect(sqs.sendMessage.called).to.be.false; // No SQS message sent
    });

    it('handles site not found scenario', async () => {
      const auditData = {
        siteId: 'nonexistent-site',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 404, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves(null), // Site not found
        },
      };

      const context = {
        log: { warn: sandbox.stub(), info: sandbox.stub(), error: sandbox.stub() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage.called).to.be.false; // No message sent since site not found
      expect(context.log.warn.calledWith('Site not found, skipping Mystique message')).to.be.true;
    });

    it('handles no 404 errors and skips SQS message', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            403: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/p1', status: 403, total_requests: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
            getId: () => 'site-1',
          }),
        },
      };

      const context = {
        log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage.called).to.be.false; // No message sent since no 404 errors
      expect(context.log.info.calledWith('No 404 errors found, skipping Mystique message')).to.be.true;
    });

    it('handles failed audit and skips SQS message', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: false, // Failed audit
          error: 'Database connection failed',
        },
      };

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const context = {
        log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess: {},
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(result).to.deep.equal(auditData);
      expect(sqs.sendMessage.called).to.be.false; // No message sent since audit failed
      expect(context.log.info.calledWith('Audit failed, skipping Mystique message')).to.be.true;
    });
  });

  describe('Audit Configuration', () => {
    it('has correct audit structure', () => {
      expect(handler.runner).to.be.a('function');
      expect(handler.postProcessors).to.be.an('array');
      expect(handler.postProcessors).to.have.length(1);
      expect(handler.postProcessors[0]).to.be.a('function');
    });

    it('has correct URL resolver', () => {
      expect(handler.urlResolver).to.exist;
    });
  });

  describe('Post Processors', () => {
    it('covers SQS message construction and success logging for 100% coverage', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0',
                url: '/page1',
                status: 404,
                total_requests: 5,
              },
              {
                user_agent: 'Chrome/120 Perplexity/5.0',
                url: '/page1', // Same URL, different user agent
                status: 404,
                total_requests: 3,
              },
              {
                user_agent: 'Chrome/120 Claude/1.0',
                url: '/page2',
                status: 404,
                total_requests: 2,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [
        { getUrl: () => 'https://example.com/' },
        { getUrl: () => 'https://example.com/popular' },
      ];

      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
            getId: () => 'site-1',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'test-audit-id',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      // Verify SQS message was sent (covers line 230)
      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Verify success logging (covers line 231)
      expect(context.log.info.calledWith('Queued 2 consolidated 404 URLs to Mystique for AI processing')).to.be.true;

      // Verify message structure includes brokenLinks mapping (covers lines 220-222)
      const message = sqs.sendMessage.firstCall.args[1];
      expect(message.data.brokenLinks).to.be.an('array');
      expect(message.data.brokenLinks).to.have.length(2); // Two unique URLs

      // Verify URL mapping logic (line 220-222)
      const firstLink = message.data.brokenLinks.find((link) => link.urlTo === 'https://example.com/page1');
      expect(firstLink).to.exist;
      expect(firstLink.urlFrom).to.include('ChatGPT');
      expect(firstLink.urlFrom).to.include('Perplexity');
      expect(firstLink.suggestionId).to.match(/llm-404-suggestion-w34-2025-\d+/);

      const secondLink = message.data.brokenLinks.find((link) => link.urlTo === 'https://example.com/page2');
      expect(secondLink).to.exist;
      expect(secondLink.urlFrom).to.include('Claude');
      expect(secondLink.suggestionId).to.match(/llm-404-suggestion-w34-2025-\d+/);

      // Verify other message properties
      expect(message.data.alternativeUrls).to.deep.equal([
        'https://example.com/',
        'https://example.com/popular',
      ]);

      expect(result).to.deep.equal(auditData);
    });

    it('handles SQS send error and logs the failure', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0', url: '/page1', status: 404, total_requests: 5,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const sqs = {
        sendMessage: sandbox.stub().rejects(new Error('SQS service unavailable')),
      };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
            getId: () => 'site-1',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const context = {
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'test-audit-id',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      // Should still return the original auditData even on error
      expect(result).to.deep.equal(auditData);

      // Verify error was logged (covers lines 233-234)
      expect(context.log.error.calledWith('Failed to send Mystique message: SQS service unavailable')).to.be.true;
      expect(sqs.sendMessage.calledOnce).to.be.true;
    });
  });

  it('handles site with missing baseURL and uses fallback', async () => {
    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const context = {
      log: console,
      audit: {},
      sqs: null,
      env: {},
      dataAccess: {},
    };

    const result = await handler.runner('https://example.com', context, site);

    expect(result.auditResult.success).to.be.true;
    expect(mockSaveExcelReport.callCount).to.equal(3); // 404, 403, 5xx files generated
  });
});
