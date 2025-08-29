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

describe('LLM Error Pages Handler (Excel + SQS)', () => {
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

  it('writes 3 Excel files and sends SQS for 404s with alternativeUrls', async () => {
    mockAthenaClient.query.resolves([]);

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }), getLlmoDataFolder: () => 'customer' }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const topPages = [{ getUrl: () => 'https://example.com/' }, { getUrl: () => 'https://example.com/products/' }];
    const sqs = { sendMessage: sandbox.stub().resolves() };
    const dataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
      },
    };

    const ctx = {
      log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess,
    };

    const result = await handler.runner('https://example.com', ctx, site);

    // Excel reports saved 3 times
    expect(mockSaveExcelReport.callCount).to.equal(3);

    // SQS message sent once for 404 group
    expect(sqs.sendMessage.calledOnce).to.be.true;
    const queueUrl = sqs.sendMessage.firstCall.args[0];
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(queueUrl).to.equal('queue-url');
    expect(msg.type).to.equal('guidance:llm-error-pages');
    expect(msg.data).to.have.property('brokenLinks');
    expect(msg.data).to.have.property('alternativeUrls');

    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
  });

  it('handles audit failure and returns error result', async () => {
    mockAthenaClient.query.rejects(new Error('Database connection failed'));

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const ctx = {
      log: console, env: {}, sqs: null, dataAccess: {},
    };

    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.false;
    expect(result.auditResult.error).to.equal('Database connection failed');
    expect(result.auditResult.database).to.equal('test_db');
    expect(result.auditResult.table).to.equal('test_table');
    expect(result.auditResult.customer).to.equal('test-customer');
  });

  it('handles invalid URLs in toPathOnly function', async () => {
    // This test exercises the catch block in toPathOnly by providing invalid URLs
    mockProcessResults.returns({
      totalErrors: 1,
      errorPages: [
        {
          user_agent: 'Chrome/120 GPTBot/4.0', url: '://invalid-url-with-no-protocol', status: 404, total_requests: 1,
        },
      ],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 404: 1 } },
    });

    mockAthenaClient.query.resolves([]);

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const ctx = {
      log: console, env: {}, sqs: null, dataAccess: {},
    };

    try {
      const result = await handler.runner('https://example.com', ctx, site);
      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport.callCount).to.equal(1); // Only 404 file generated
    } finally {
      // Restore the original URL constructor
      global.URL = originalURL;
    }
  });

  it('skips SQS when no 404 errors', async () => {
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const sqs = { sendMessage: sandbox.stub().resolves() };
    const ctx = {
      log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess: {},
    };

    const result = await handler.runner('https://example.com', ctx, site);

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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const sqs = { sendMessage: sandbox.stub().resolves() };
    const ctx = {
      log: console, env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' }, sqs, dataAccess: {},
    };

    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.called).to.be.false; // No SQS message sent (no 404s)
    expect(mockSaveExcelReport.callCount).to.equal(2); // 403 and 5xx files generated
  });

  it('covers audit object without getId method branch', async () => {
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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

    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses fallback auditId
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(msg.auditId).to.equal('llm-error-pages-audit'); // Fallback auditId
  });

  it('covers the final remaining branches with direct function call', async () => {
    // Test the remaining branches by calling the runner function directly with specific parameters
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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

    // Call runner with audit as fourth parameter
    const result = await handler.runner('https://example.com', ctx, site, auditWithoutGetId);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.calledOnce).to.be.true;

    // Check that the message uses fallback auditId when audit?.getId() is undefined
    const msg = sqs.sendMessage.firstCall.args[1];
    expect(msg.auditId).to.equal('llm-error-pages-audit'); // Fallback auditId
  });

  it('covers audit being null branch', async () => {
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const ctx = {
      log: console,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
      sqs,
      dataAccess,
    };

    // Pass null as audit parameter to test audit?.getId() branch
    const result = await handler.runner('https://example.com', ctx, site, null);

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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
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
    expect(sqs.sendMessage.called).to.be.false; // No SQS message sent (empty 404 array)
    expect(mockSaveExcelReport.callCount).to.equal(2); // Only 403 and 5xx files generated
  });

  it('triggers 404 undefined fallback with modified categorizeErrorsByStatusCode', async () => {
    // Now that categorizeErrorsByStatusCode only creates keys when there are errors,
    // this test will ensure the 404 key doesn't exist, triggering the || [] fallback

    mockProcessResults.returns({
      totalErrors: 1,
      errorPages: [
        {
          user_agent: 'Chrome/120 Perplexity/5.0', url: '/robots.txt', status: 403, total_requests: 3,
        },
      ],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1, statusCodes: { 403: 3 } },
    });

    mockAthenaClient.query.resolves([]);

    const sqs = { sendMessage: sandbox.stub().resolves() };
    const dataAccess = {};

    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({ getCdnLogsConfig: () => ({ filters: [] }) }),
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
    };

    const ctx = {
      log: console,
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'queue-url' },
      sqs,
      dataAccess,
    };

    // With only 403 errors, categorizeErrorsByStatusCode returns: { 403: [...] }
    // NO 404 key exists, so categorizedResults[404] is undefined
    // This finally triggers: const errors404 = categorizedResults[404] || [];
    const result = await handler.runner('https://example.com', ctx, site);

    expect(result.auditResult.success).to.be.true;
    expect(sqs.sendMessage.called).to.be.false; // No SQS message sent (404 array is empty from fallback)
    expect(mockSaveExcelReport.callCount).to.equal(1); // Only 403 file generated
  });
});
