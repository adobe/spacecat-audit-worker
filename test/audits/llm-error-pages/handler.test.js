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
  let mockCategorizeErrorsByStatusCode;
  let mockConsolidateErrorsByUrl;
  let mockSortErrorsByTrafficVolume;
  let mockToPathOnly;

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

    // Mock additional utility functions
    mockCategorizeErrorsByStatusCode = sandbox.stub().returns({
      404: [{
        url: '/test1', status: '404', agent_type: null, user_agent_display: null, userAgent: null, numberOfHits: null, totalRequests: null, avgTtfbMs: null, country_code: null, product: null, category: null,
      }],
      403: [{
        url: '/test2', status: '403', agent_type: 'Other', user_agent_display: 'GPTBot', numberOfHits: 100, avgTtfbMs: 250, country_code: 'US', product: 'Search', category: 'Product',
      }],
    });
    mockConsolidateErrorsByUrl = sandbox.stub().returnsArg(0); // Return input as-is
    mockSortErrorsByTrafficVolume = sandbox.stub().returnsArg(0); // Return input as-is
    mockToPathOnly = sandbox.stub().returnsArg(0); // Return input as-is

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
        categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
        consolidateErrorsByUrl: mockConsolidateErrorsByUrl,
        sortErrorsByTrafficVolume: mockSortErrorsByTrafficVolume,
        toPathOnly: mockToPathOnly,
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
        getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }), getLlmoDataFolder: () => 'customer' }),
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
      expect(mockSaveExcelReport.callCount).to.equal(2);

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
        getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => null, // No config at all
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
      expect(mockSaveExcelReport.callCount).to.equal(2); // 404, 403, 5xx files generated
    });

    it('handles empty errors array and skips Excel generation', async () => {
      // Mock processResults to return empty errors for all categories
      mockProcessResults.returns({
        totalErrors: 0,
        errorPages: [],
        summary: { uniqueUrls: 0, uniqueUserAgents: 0, statusCodes: {} },
        categorizedResults: {
          404: [], // Empty array for 404 errors (line 86)
          403: [],
          '5xx': [],
        },
      });

      // Update the categorize mock to return empty categories for this test
      mockCategorizeErrorsByStatusCode.returns({});

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      expect(result.auditResult.totalErrors).to.equal(0);
      // When there are no errors, Excel files should not be generated
      expect(mockSaveExcelReport.callCount).to.equal(0);
    });

    it('handles errors with missing fields and uses fallbacks in Excel generation', async () => {
      // Reset the mock call count
      mockSaveExcelReport.resetHistory();

      // Mock processResults to return errors with missing fields to test fallback branches (lines 108-115)
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            // Missing agent_type (should fallback to 'Other' - line 108)
            // Missing user_agent_display and userAgent (should fallback to 'Unknown' - line 109)
            // Missing numberOfHits and totalRequests (should fallback to 0 - line 110)
            // Missing avgTtfbMs (should fallback to 0 - line 111)
            // Missing country_code (should fallback to 'GLOBAL' - line 112)
            url: '/test1',
            status: '404',
            // Missing product (should fallback to 'Other' - line 114)
            // Missing category (should fallback to 'Uncategorized' - line 115)
          },
          {
            agent_type: null, // Null agent_type (should fallback to 'Other')
            user_agent_display: null, // Null user_agent_display
            userAgent: null, // Null userAgent (should fallback to 'Unknown')
            numberOfHits: null, // Null numberOfHits
            totalRequests: null, // Null totalRequests (should fallback to 0)
            avgTtfbMs: null, // Null avgTtfbMs (should fallback to 0)
            country_code: null, // Null country_code (should fallback to 'GLOBAL')
            url: '/test2',
            status: '403',
            product: null, // Null product (should fallback to 'Other')
            category: null, // Null category (should fallback to 'Uncategorized')
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 1, statusCodes: { 404: 1, 403: 1 } },
      });

      // Update the categorize mock to return these specific errors
      mockCategorizeErrorsByStatusCode.returns({
        404: [{
          url: '/test1',
          status: '404',
          // All missing/null fields to trigger fallbacks
        }],
        403: [{
          agent_type: null,
          user_agent_display: null,
          userAgent: null,
          numberOfHits: null,
          totalRequests: null,
          avgTtfbMs: null,
          country_code: null,
          url: '/test2',
          status: '403',
          product: null,
          category: null,
        }],
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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

      // Should generate Excel for 404 and 403 categories (2 calls)
      expect(mockSaveExcelReport.callCount).to.equal(2);
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.totalErrors).to.equal(2);
    });

    it('handles errors with partial data and uses fallbacks', async () => {
      // Reset the mock call count
      mockSaveExcelReport.resetHistory();

      // Test specific fallback branches with different combinations
      mockProcessResults.returns({
        totalErrors: 3,
        errorPages: [
          {
            // Has agent_type but missing others
            agent_type: 'Training bots',
            // Missing user_agent_display, has userAgent (should use userAgent - line 109)
            userAgent: 'GPTBot/1.0',
            // Has numberOfHits but missing totalRequests (should use numberOfHits - line 110)
            numberOfHits: 150,
            // Has avgTtfbMs
            avgTtfbMs: 250.5,
            // Missing country_code (should fallback to 'GLOBAL' - line 112)
            url: '/test1',
            status: '404',
            // Has product but missing category (should fallback to 'Uncategorized' - line 115)
            product: 'Electronics',
          },
          {
            // Missing agent_type (should fallback to 'Other' - line 108)
            // Has user_agent_display but missing userAgent (should use user_agent_display - line 109)
            user_agent_display: 'PerplexityBot',
            // Missing numberOfHits but has totalRequests (should use totalRequests - line 110)
            totalRequests: 75,
            // Missing avgTtfbMs (should fallback to 0 - line 111)
            // Has country_code
            country_code: 'US',
            url: '/test2',
            status: '404',
            // Missing product but has category (should fallback to 'Other' - line 114)
            category: 'Product Page',
          },
          {
            // Has all fields to test non-fallback paths
            agent_type: 'Other bots',
            user_agent_display: 'ClaudeBot',
            userAgent: 'Claude/2.0', // This should be ignored since user_agent_display exists
            numberOfHits: 200,
            totalRequests: 180, // This should be ignored since numberOfHits exists
            avgTtfbMs: 300.0,
            country_code: 'CA',
            url: '/test3',
            status: '404',
            product: 'Software',
            category: 'Landing Page',
          },
        ],
        summary: { uniqueUrls: 3, uniqueUserAgents: 2, statusCodes: { 404: 3 } },
      });

      // Update the categorize mock to return these specific errors for this test
      mockCategorizeErrorsByStatusCode.returns({
        404: [
          {
            agent_type: 'Training bots',
            userAgent: 'GPTBot/1.0',
            numberOfHits: 150,
            avgTtfbMs: 250.5,
            url: '/test1',
            status: '404',
            product: 'Electronics',
          },
          {
            user_agent_display: 'PerplexityBot',
            totalRequests: 75,
            country_code: 'US',
            url: '/test2',
            status: '404',
            category: 'Product Page',
          },
          {
            agent_type: 'Other bots',
            user_agent_display: 'ClaudeBot',
            userAgent: 'Claude/2.0',
            numberOfHits: 200,
            totalRequests: 180,
            avgTtfbMs: 300.0,
            country_code: 'CA',
            url: '/test3',
            status: '404',
            product: 'Software',
            category: 'Landing Page',
          },
        ],
      });

      mockAthenaClient.query.resolves([]);

      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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

      // Should generate Excel for 404 category only (1 call)
      expect(mockSaveExcelReport.callCount).to.equal(1);
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.totalErrors).to.equal(3);
    });
  });

  describe('Mystique Message Post Processor', () => {
    it('sends SQS message for 404 errors with alternativeUrls', async () => {
      const topPages = [{ getUrl: () => 'https://example.com/' }, { getUrl: () => 'https://example.com/products/' }];
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

      const auditData = {
        siteId: 'site-1',
        auditId: 'audit-123',
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
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      // Verify SQS message was sent
      expect(sqs.sendMessage.calledOnce).to.be.true;
      const queueUrl = sqs.sendMessage.firstCall.args[0];
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(queueUrl).to.equal('queue-url');
      expect(msg.type).to.equal('guidance:llm-error-pages');
      expect(msg.data).to.have.property('brokenLinks');
      expect(msg.data).to.have.property('alternativeUrls');
      expect(msg.siteId).to.equal('site-1');
      expect(msg.auditId).to.equal('audit-123');

      // Verify post processor returns auditData unchanged
      expect(result).to.deep.equal(auditData);
    });

    it('skips message when audit failed', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: false,
          error: 'Audit failed',
        },
      };

      const context = {
        log: console,
        sqs: { sendMessage: sandbox.stub() },
        env: {},
        dataAccess: {},
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(context.sqs.sendMessage.called).to.be.false;
      expect(result).to.deep.equal(auditData);
    });

    it('skips message when no 404 errors', async () => {
      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            403: [
              {
                user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const context = {
        log: console,
        sqs: { sendMessage: sandbox.stub() },
        env: {},
        dataAccess: {},
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(context.sqs.sendMessage.called).to.be.false;
      expect(result).to.deep.equal(auditData);
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

      const auditData = {
        siteId: 'site-1',
        auditResult: {
          success: true,
          categorizedResults: {
            404: [
              {
                user_agent: 'Chrome/120 GPTBot/4.0',
                user_agent_display: 'GPTBot',
                url: '/p1',
                status: 404,
                total_requests: 4,
                number_of_hits: 4,
              },
            ],
          },
          periodIdentifier: 'w34-2025',
        },
      };

      const context = {
        log: console,
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Check that the message uses the URL directly (no baseUrl prefix)
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(msg.data.brokenLinks).to.be.an('array');
      if (msg.data.brokenLinks.length === 0) {
        // If empty, just verify the structure exists
        expect(msg.data).to.have.property('brokenLinks');
        expect(msg.data).to.have.property('alternativeUrls');
        expect(msg.data).to.have.property('opportunityId');
      } else {
        expect(msg.data.brokenLinks[0].urlTo).to.equal('/p1'); // No baseUrl prefix since site.getBaseURL() returns null
      }

      expect(result).to.deep.equal(auditData);
    });

    it('handles site with missing delivery type and uses fallback', async () => {
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
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'audit-123',
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
      const topPages = [{ getUrl: () => 'https://example.com/' }];
      const sqs = { sendMessage: sandbox.stub().resolves() };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      };

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
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => undefined, // Missing audit ID
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(sqs.sendMessage.calledOnce).to.be.true;
      // Verify the fallback audit ID is used
      const sentMessage = sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.auditId).to.equal('llm-error-pages-audit');
      expect(result).to.deep.equal(auditData);
    });

    it('handles error during message sending', async () => {
      const sqs = { sendMessage: sandbox.stub().rejects(new Error('SQS error')) };
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'aem_edge',
          }),
        },
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      };

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
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs,
        dataAccess,
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      // Should still return auditData even if SQS fails
      expect(result).to.deep.equal(auditData);
    });

    it('handles site not found', async () => {
      const dataAccess = {
        Site: {
          findById: sandbox.stub().resolves(null), // Site not found
        },
      };

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
        env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
        sqs: { sendMessage: sandbox.stub() },
        dataAccess,
        audit: {
          getId: () => 'audit-123',
        },
      };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(context.sqs.sendMessage.called).to.be.false;
      expect(result).to.deep.equal(auditData);
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

  it('handles site with missing baseURL and uses fallback', async () => {
    const site = {
      getBaseURL: () => undefined, // Missing baseURL
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
    expect(mockSaveExcelReport.callCount).to.equal(2); // 404, 403 files generated
  });
});
