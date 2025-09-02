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
      totalErrors: 1,
      errorPages: [
        {
          user_agent: 'Chrome/120 GPTBot/4.0', url: 'any-url', status: 404, total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
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
    expect(sqs.sendMessage.called).to.be.false; // No SQS message sent (no 404s)
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
    const sqs = { sendMessage: sandbox.stub().resolves() };
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
      log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess,
    };

    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses the URL directly (no baseUrl prefix)
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(msg.data.brokenLinks[0].urlTo).to.equal('/p1'); // No baseUrl prefix
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
    const sqs = { sendMessage: sandbox.stub().resolves() };
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
      log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess,
    };

    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses fallback values
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(msg.auditId).to.equal('llm-error-pages-audit'); // Fallback auditId
    expect(msg.deliveryType).to.equal('aem_edge'); // Fallback deliveryType
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

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    // Test case for when audit is not provided in context
    const ctx = {
      log: console,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
      sqs,
      dataAccess,
      // Don't include audit in context
    };

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

      expect(sqs.sendMessage.calledOnce).to.be.true;

      // Check that the message uses the URL directly (no baseUrl prefix)
      const msg = sqs.sendMessage.firstCall.args[1];
      expect(msg.data.brokenLinks[0].urlTo).to.equal('/p1'); // No baseUrl prefix

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

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [] }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    // Pass audit as a parameter to the runner function
    const auditWithoutGetId = {}; // Empty object, no getId method
    const ctx = {
      log: console,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
      sqs,
      dataAccess,
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

      const result = await handler.postProcessors[0]('https://example.com', auditData, context);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses fallback auditId when audit is null
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
    const sqs = { sendMessage: sandbox.stub().resolves() };
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
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
      sqs,
      dataAccess,
      audit: auditWithGetId, // Put audit in context, not as separate parameter
    };

    // This should hit both branches since:
    // - processErrorPagesResults returns 404 errors
    // - categorizeErrorsByStatusCode will naturally create a 404 key with those errors
    // - audit.getId() will return 'audit-123' instead of using fallback
    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses the actual audit ID (not fallback)
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(msg.auditId).to.equal('audit-123'); // Real audit ID from getId()
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
