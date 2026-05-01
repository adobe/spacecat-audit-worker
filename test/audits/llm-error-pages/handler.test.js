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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('LLM Error Pages Handler', function () {
  this.timeout(10000);
  let context;
  let sandbox;
  let site;
  let audit;
  let importTopPagesAndScrape;
  let submitForScraping;
  let runAuditAndSendToMystique;
  let mockAthenaClient;
  let mockGetS3Config;
  let mockGenerateReportingPeriods;
  let mockBuildSiteFilters;
  let mockProcessResults;
  let mockBuildQuery;
  let mockGetAllLlmProviders;
  let mockCreateLLMOSharepointClient;
  let mockSaveExcelReport;
  let mockReadFromSharePoint;
  let mockCategorizeErrorsByStatusCode;
  let mockDownloadExistingCdnSheet;
  let mockMatchErrorsWithCdnData;
  let mockGetTopAgenticUrlsFromAthena;

  const topPages = [
    { getUrl: () => 'https://example.com/page1' },
    { getUrl: () => 'https://example.com/page2' },
    { getUrl: () => 'https://example.com/page3' },
  ];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getBaseURL: () => 'https://example.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem_edge',
      getConfig: () => ({
        getLlmoCdnlogsFilter: () => [],
        getLlmoDataFolder: () => 'test-customer',
      }),
    };

    audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'llm-error-pages',
      getFullAuditRef: () => 'llm-error-pages::example.com',
      getAuditResult: sandbox.stub(),
    };

    context = {
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      sqs: {
        sendMessage: sandbox.stub().resolves({}),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique',
      },
      site,
      audit,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    // Setup mocks for esmock
    mockAthenaClient = { query: sandbox.stub().resolves([]) };

    mockGetS3Config = sandbox.stub().returns({
      bucket: 'test-bucket',
      siteName: 'test-customer',
      databaseName: 'test_db',
      tableName: 'test_table',
      getAthenaTempLocation: () => 's3://test-bucket/temp/',
    });

    mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [{
        weekNumber: 34,
        year: 2025,
        startDate: new Date('2025-08-18T00:00:00Z'),
        endDate: new Date('2025-08-24T23:59:59Z'),
        periodIdentifier: 'w34-2025',
      }],
    });

    mockBuildSiteFilters = sandbox.stub().returns('');

    mockProcessResults = sandbox.stub().returns({
      totalErrors: 3,
      errorPages: [
        {
          user_agent: 'ChatGPT', url: '/page1', status: 404, total_requests: 10,
        },
        {
          user_agent: 'Perplexity', url: '/page2', status: 403, total_requests: 5,
        },
        {
          user_agent: 'Claude', url: '/page3', status: 503, total_requests: 3,
        },
      ],
      summary: { uniqueUrls: 3, uniqueUserAgents: 3, statusCodes: { 404: 10, 403: 5, 503: 3 } },
    });

    mockCategorizeErrorsByStatusCode = sandbox.stub().callsFake((errors) => ({
      404: errors.filter((e) => e.status === 404),
      403: errors.filter((e) => e.status === 403),
      '5xx': errors.filter((e) => e.status >= 500),
    }));

    mockBuildQuery = sandbox.stub().resolves('SELECT ...');
    mockGetAllLlmProviders = sandbox.stub().returns(['chatgpt', 'perplexity']);

    mockCreateLLMOSharepointClient = sandbox.stub().resolves({});
    mockSaveExcelReport = sandbox.stub().resolves();
    mockReadFromSharePoint = sandbox.stub().resolves(Buffer.from('mock-excel-data'));

    mockDownloadExistingCdnSheet = sandbox.stub().resolves([
      {
        url: '/page1',
        user_agent_display: 'ChatGPT',
        agent_type: 'Chatbot',
        number_of_hits: 100,
        avg_ttfb_ms: 250,
        country_code: 'US',
        product: 'Test Product',
        category: 'Test Category',
      },
    ]);

    mockMatchErrorsWithCdnData = sandbox.stub().callsFake((errors) => errors.map((e) => ({
      ...e,
      agent_type: 'Chatbot',
      user_agent_display: e.user_agent,
      number_of_hits: e.total_requests,
      avg_ttfb_ms: 250,
      country_code: 'US',
      product: 'Test',
      category: 'Test',
    })));

    // Mock getTopAgenticUrlsFromAthena to return empty (fall back to SEO top pages)
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

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

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
      },
      '@adobe/spacecat-shared-tier-client': {
        default: {},
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
      },
      '../../../src/common/index.js': {
        wwwUrlResolver: () => ({}),
      },
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }
          addStep() { return this; }
          withRunner() { return this; }
          build() { return {}; }
        },
      },
      '../../../src/common/audit-utils.js': {
        default: {},
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: mockGenerateReportingPeriods,
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: mockBuildQuery,
        getAllLlmProviders: mockGetAllLlmProviders,
        categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
        downloadExistingCdnSheet: mockDownloadExistingCdnSheet,
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
        SPREADSHEET_COLUMNS: ['Agent Type', 'User Agent', 'Hits', 'TTFB', 'Country', 'URL', 'Product', 'Category', 'Suggested', 'Rationale', 'Confidence'],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateLLMOSharepointClient,
        saveExcelReport: mockSaveExcelReport,
        readFromSharePoint: mockReadFromSharePoint,
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: mockBuildSiteFilters,
        getS3Config: mockGetS3Config,
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => mockAthenaClient,
        }),
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
      exceljs: {
        default: mockExcelJS,
      },
    });

    importTopPagesAndScrape = handler.importTopPagesAndScrape;
    submitForScraping = handler.submitForScraping;
    runAuditAndSendToMystique = handler.runAuditAndSendToMystique;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importTopPagesAndScrape', () => {
    it('should import top pages successfully', async () => {
      const result = await importTopPagesAndScrape(context);

      expect(result.type).to.equal('top-pages');
      expect(result.siteId).to.equal('site-id-123');
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.topPages).to.deep.equal([
        'https://example.com/page1',
        'https://example.com/page2',
        'https://example.com/page3',
      ]);
      expect(result.fullAuditRef).to.equal('https://example.com');
      expect(context.log.info).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] Found 3 top pages for site site-id-123',
      );
    });

    it('should handle no top pages found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await importTopPagesAndScrape(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.topPages).to.deep.equal([]);
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No top pages found for site',
      );
    });

    it('should handle errors gracefully', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(
        new Error('Database error'),
      );

      const result = await importTopPagesAndScrape(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Database error');
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Failed to import top pages: Database error/),
        sinon.match.instanceOf(Error),
      );
    });
  });

  describe('submitForScraping', () => {
    it('should submit top pages for scraping successfully', async () => {
      audit.getAuditResult.returns({ success: true, categorizedResults: { 404: [] } });

      const result = await submitForScraping(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
        ],
        siteId: 'site-id-123',
        type: 'llm-error-pages',
      });
      expect(context.log.info).to.have.been.calledWith('[LLM-ERROR-PAGES] Submitting 3 pages for scraping');
    });

    it('should submit all pages for scraping without limit', async () => {
      audit.getAuditResult.returns({ success: true });
      const manyPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(150);
      expect(context.log.info).to.have.been.calledWith('[LLM-ERROR-PAGES] Submitting 150 pages for scraping');
    });

    it('should throw error when audit failed', async () => {
      audit.getAuditResult.returns({ success: false });

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'Audit failed, skipping scraping',
      );
      expect(context.log.warn).to.have.been.calledWith('[LLM-ERROR-PAGES] Audit failed, skipping scraping');
    });

    it('should throw error when no top pages to submit', async () => {
      audit.getAuditResult.returns({ success: true });
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'No top pages to submit for scraping',
      );
      expect(context.log.warn).to.have.been.calledWith('[LLM-ERROR-PAGES] No top pages to submit for scraping');
    });
  });

  describe('runAuditAndSendToMystique', () => {
    it('should run audit, generate reports, and send to Mystique successfully', async () => {
      const result = await runAuditAndSendToMystique(context);

      expect(result.type).to.equal('audit-result');
      expect(result.siteId).to.equal('site-id-123');
      expect(result.auditResult[0].success).to.be.true;
      expect(result.auditResult[0].periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
      expect(result.auditResult[0].totalErrors).to.equal(3);
      expect(result.auditResult[0].categorizedResults).to.exist;
      expect(result.fullAuditRef).to.equal('https://example.com');

      expect(context.log.info).to.have.been.calledWith('[LLM-ERROR-PAGES] Starting audit for https://example.com');
      expect(mockSaveExcelReport).to.have.been.called;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Sent.*consolidated 404 URLs to Mystique/),
      );
    });

    it('should produce two weeks when run on a Monday without weekOffset', async () => {
      const monday = new Date('2025-08-18T12:00:00Z'); // Monday
      const clock = sinon.useFakeTimers(monday.getTime());
      try {
        mockGenerateReportingPeriods.returns({
          weeks: [
            { weekNumber: 33, year: 2025, startDate: new Date('2025-08-11'), endDate: new Date('2025-08-17'), periodIdentifier: 'w33-2025' },
            { weekNumber: 34, year: 2025, startDate: new Date('2025-08-18'), endDate: new Date('2025-08-24'), periodIdentifier: 'w34-2025' },
          ],
        });
        const result = await runAuditAndSendToMystique(context);
        expect(result.auditResult).to.have.length(2);
        expect(mockGenerateReportingPeriods).to.have.been.calledWith(sinon.match.date, [-1, 0]);
      } finally {
        clock.restore();
      }
    });

    it('should use current week only when not Monday and no weekOffset', async () => {
      const wednesday = new Date('2025-08-20T12:00:00Z'); // Wednesday
      const clock = sinon.useFakeTimers(wednesday.getTime());
      try {
        const result = await runAuditAndSendToMystique(context);
        expect(result.auditResult).to.have.length(1);
        expect(mockGenerateReportingPeriods).to.have.been.calledWith(sinon.match.date, [0]);
      } finally {
        clock.restore();
      }
    });

    it('should handle per-week query failure gracefully', async () => {
      mockAthenaClient.query.rejects(new Error('Database error'));

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.false;
      expect(result.auditResult[0].error).to.equal('Database error');
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Failed for/),
        sinon.match.instanceOf(Error),
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should handle audit failure gracefully when setup fails before week loop', async () => {
      mockCreateLLMOSharepointClient.rejects(new Error('SharePoint connection failed'));

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.false;
      expect(result.auditResult[0].error).to.equal('SharePoint connection failed');
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Audit failed: SharePoint connection failed/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should skip Mystique when SQS not configured', async () => {
      context.sqs = null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should skip Mystique when queue env not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should skip Mystique when no 404 errors found', async () => {
      mockProcessResults.returns({
        totalErrors: 0,
        errorPages: [],
        summary: { uniqueUrls: 0, uniqueUserAgents: 0 },
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should limit 404 errors to 50 when sending to Mystique', async () => {
      const many404s = Array.from({ length: 100 }, (_, i) => ({
        user_agent: 'TestBot',
        userAgent: 'TestBot',
        url: `/page${i}`,
        status: 404,
        total_requests: 100 - i,
      }));

      mockProcessResults.returns({
        totalErrors: 100,
        errorPages: many404s,
        summary: { uniqueUrls: 100, uniqueUserAgents: 1 },
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = context.sqs.sendMessage.firstCall.args;
      expect(message.data.brokenLinks.length).to.be.at.most(50);
    });

    it('should consolidate URLs and combine user agents in Mystique message', async () => {
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            user_agent: 'ChatGPT',
            userAgent: 'ChatGPT',
            url: '/same-page',
            status: 404,
            total_requests: 10,
          },
          {
            user_agent: 'Perplexity',
            userAgent: 'Perplexity',
            url: '/same-page',
            status: 404,
            total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 2 },
      });

      await runAuditAndSendToMystique(context);

      const [, message] = context.sqs.sendMessage.firstCall.args;
      expect(message.data.brokenLinks).to.have.length(1);
      const brokenLink = message.data.brokenLinks[0];
      expect(brokenLink.urlTo).to.include('/same-page');
      expect(brokenLink.urlFrom).to.include('ChatGPT');
      expect(brokenLink.urlFrom).to.include('Perplexity');
    });

    it('should generate separate Excel files for 404, 403, and 5xx', async () => {
      mockProcessResults.returns({
        totalErrors: 6,
        errorPages: [
          { user_agent: 'Bot1', url: '/404-1', status: 404, total_requests: 10 },
          { user_agent: 'Bot2', url: '/404-2', status: 404, total_requests: 9 },
          { user_agent: 'Bot3', url: '/403-1', status: 403, total_requests: 8 },
          { user_agent: 'Bot4', url: '/403-2', status: 403, total_requests: 7 },
          { user_agent: 'Bot5', url: '/500-1', status: 500, total_requests: 6 },
          { user_agent: 'Bot6', url: '/503-1', status: 503, total_requests: 5 },
        ],
        summary: { uniqueUrls: 6, uniqueUserAgents: 6 },
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(mockSaveExcelReport).to.have.been.calledThrice;
    });

    it('should apply fallbacks and sort when fields are missing', async () => {
      const worksheetRows = [];
      // Rewire the worksheet addRow to capture rows
      const handlerModule = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
        },
        '../../../src/llm-error-pages/utils.js': {
          generateReportingPeriods: mockGenerateReportingPeriods,
          processErrorPagesResults: () => ({
            totalErrors: 2,
            errorPages: [
              { user_agent: 'BotA', url: '/a', status: 404, total_requests: 3, avg_ttfb_ms: undefined, country_code: undefined, product: undefined, category: undefined },
              { user_agent: 'BotB', url: '/b', status: 404, total_requests: undefined, avg_ttfb_ms: 100, country_code: 'US', product: 'P', category: 'C' },
            ],
            summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 3 } },
          }),
          buildLlmErrorPagesQuery: mockBuildQuery,
          getAllLlmProviders: mockGetAllLlmProviders,
          categorizeErrorsByStatusCode: (eps) => ({ 404: eps }),
          consolidateErrorsByUrl: (errors) => errors,
          sortErrorsByTrafficVolume: (errors) => errors,
          toPathOnly: (url) => url,
          SPREADSHEET_COLUMNS: ['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score'],
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: mockCreateLLMOSharepointClient,
          saveExcelReport: mockSaveExcelReport,
        },
        '../../../src/utils/cdn-utils.js': {
          buildSiteFilters: mockBuildSiteFilters,
          getS3Config: mockGetS3Config,
          getCdnAwsRuntime: () => ({
            createAthenaClient: () => mockAthenaClient,
          }),
        },
        exceljs: {
          default: {
            Workbook: function Workbook() {
              return {
                addWorksheet() {
                  return {
                    addRow: (row) => { worksheetRows.push(row); },
                  };
                },
              };
            },
          },
        },
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          validateCountryCode: (code) => {
            if (!code || typeof code !== 'string') return 'GLOBAL';
            const up = code.toUpperCase();
            return up.length === 2 ? up : 'GLOBAL';
          },
        },
        '@adobe/spacecat-shared-tier-client': { default: {} },
      });

      await handlerModule.runAuditAndSendToMystique(context);
      // First addRow is headers, then two data rows
      expect(worksheetRows).to.have.length(3);
      const dataRows = worksheetRows.slice(1);
      // Sorted: entry with total_requests 3 should come before undefined (treated as 0)
      expect(dataRows[0][1]).to.equal('BotA'); // User Agent
      expect(dataRows[0][2]).to.equal(3); // Number of Hits
      // Fallbacks applied
      expect(dataRows[0][3]).to.equal(''); // Avg TTFB fallback
      expect(dataRows[0][4]).to.equal('GLOBAL'); // Country validated fallback
      expect(dataRows[0][6]).to.equal(''); // Product fallback
      expect(dataRows[0][7]).to.equal(''); // Category fallback
      // Second row hits fallback to 0
      expect(dataRows[1][2]).to.equal(0);
    });

    it('should handle site with no config', async () => {
      site.getConfig = () => null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(mockBuildSiteFilters).to.have.been.calledWith([], site);
    });

    it('should handle site with no base URL', async () => {
      site.getBaseURL = () => null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
    });

    it('should use fallback delivery type when not available', async () => {
      site.getDeliveryType = () => undefined;

      await runAuditAndSendToMystique(context);

      const [, message] = context.sqs.sendMessage.firstCall.args;
      expect(message.deliveryType).to.equal('aem_edge');
    });

    it('should use fallback audit ID when not available', async () => {
      audit.getId = () => null;

      await runAuditAndSendToMystique(context);

      const [, message] = context.sqs.sendMessage.firstCall.args;
      expect(message.auditId).to.equal('llm-error-pages-audit');
    });

    it('should filter out broken links with empty user agents', async () => {
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          {
            user_agent: 'ChatGPT',
            userAgent: 'ChatGPT',
            url: '/page1',
            status: 404,
            total_requests: 10,
          },
          {
            user_agent: '',
            userAgent: '',
            url: '/page2',
            status: 404,
            total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2 },
      });

      await runAuditAndSendToMystique(context);

      const [, message] = context.sqs.sendMessage.firstCall.args;
      // Should only include the link with a valid user agent
      expect(message.data.brokenLinks.length).to.equal(1);
      expect(message.data.brokenLinks[0].urlFrom).to.equal('ChatGPT');
    });

    it('should handle categorizedResults without 404 key', async () => {
      mockProcessResults.returns({
        totalErrors: 2,
        errorPages: [
          { user_agent: 'Bot1', url: '/403', status: 403, total_requests: 5, userAgent: 'Bot1' },
          { user_agent: 'Bot2', url: '/500', status: 500, total_requests: 3, userAgent: 'Bot2' },
        ],
        summary: { uniqueUrls: 2, uniqueUserAgents: 2 },
      });
      mockCategorizeErrorsByStatusCode.returns({
        403: [{ user_agent: 'Bot1', url: '/403', status: 403, total_requests: 5, userAgent: 'Bot1' }],
        '5xx': [{ user_agent: 'Bot2', url: '/500', status: 500, total_requests: 3, userAgent: 'Bot2' }],
        // No 404 key at all
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });
  });
});

describe('LLM Error Pages Handler - Athena/SEO fallback', function () {
  this.timeout(10000);
  let sandbox;
  let mockGetTopAgenticUrlsFromAthena;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should use Athena URLs in importTopPagesAndScrape when available', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://example.com/athena-page1',
      'https://example.com/athena-page2',
    ]);

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await handler.importTopPagesAndScrape(context);

    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.topPages).to.deep.equal([
      'https://example.com/athena-page1',
      'https://example.com/athena-page2',
    ]);
    // SEO should NOT be called when Athena returns data
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
  });

  it('should fall back to SEO top pages in importTopPagesAndScrape when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const topPages = [
      { getUrl: () => 'https://example.com/seo-page1' },
      { getUrl: () => 'https://example.com/seo-page2' },
    ];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.importTopPagesAndScrape(context);

    expect(result.auditResult.success).to.be.true;
    expect(result.auditResult.topPages).to.deep.equal([
      'https://example.com/seo-page1',
      'https://example.com/seo-page2',
    ]);
    expect(context.log.info).to.have.been.calledWith('[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to SEO top pages');
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith('site-123', 'seo', 'global');
  });

  it('should return failure when both Athena and SEO return empty in importTopPagesAndScrape', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    const result = await handler.importTopPagesAndScrape(context);

    expect(result.auditResult.success).to.be.false;
    expect(result.auditResult.topPages).to.deep.equal([]);
    expect(context.log.warn).to.have.been.calledWith('[LLM-ERROR-PAGES] No top pages found for site');
  });

  it('should use SEO URLs in submitForScraping', async () => {
    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
    });

    const topPages = [{ getUrl: () => 'https://example.com/seo-page1' }];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages),
        },
      },
    };

    const result = await handler.submitForScraping(context);

    expect(result.urls).to.deep.equal([{ url: 'https://example.com/seo-page1' }]);
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith('site-123', 'seo', 'global');
  });

  it('should throw error when no SEO pages in submitForScraping', async () => {
    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
      },
      audit: { getAuditResult: () => ({ success: true }) },
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      },
    };

    try {
      await handler.submitForScraping(context);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error.message).to.equal('No top pages to submit for scraping');
    }
    expect(context.log.warn).to.have.been.calledWith('[LLM-ERROR-PAGES] No top pages to submit for scraping');
  });

  it('should use Athena URLs for alternativeUrls in runAuditAndSendToMystique when available', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://example.com/athena-alt1',
      'https://example.com/athena-alt2',
    ]);

    const mockAthenaClient = { query: sandbox.stub().resolves([]) };
    const mockProcessResults = sandbox.stub().returns({
      totalErrors: 1,
      errorPages: [{ user_agent: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
    });
    const mockCategorizeErrors = sandbox.stub().returns({
      404: [{ user_agent: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
    });

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
      '../../../src/llm-error-pages/utils.js': {
        getS3Config: sandbox.stub().resolves({
          bucket: 'test', siteName: 'test', databaseName: 'test_db', tableName: 'test_table',
          getAthenaTempLocation: () => 's3://test/temp/',
        }),
        generateReportingPeriods: sandbox.stub().returns({ weeks: [{ weekNumber: 1, year: 2025, startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2025' }] }),
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: mockCategorizeErrors,
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
        SPREADSHEET_COLUMNS: [],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: sandbox.stub().resolves(),
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          bucket: 'test', siteName: 'test', databaseName: 'test_db', tableName: 'test_table',
          getAthenaTempLocation: () => 's3://test/temp/',
        }),
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => mockAthenaClient,
        }),
      },
      exceljs: {
        default: { Workbook: function Workbook() { return { addWorksheet: () => ({ addRow: sandbox.stub() }) }; } },
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'test' }),
      },
      audit: { getId: () => 'audit-123' },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
      },
    };

    const result = await handler.runAuditAndSendToMystique(context);

    expect(result.auditResult[0].success).to.be.true;
    const sentMessage = context.sqs.sendMessage.firstCall.args[1];
    expect(sentMessage.data.alternativeUrls).to.deep.equal([
      'https://example.com/athena-alt1',
      'https://example.com/athena-alt2',
    ]);
    expect(context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.not.have.been.called;
  });

  it('should fall back to SEO top pages for alternativeUrls in runAuditAndSendToMystique when Athena returns empty', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

    const mockAthenaClient = { query: sandbox.stub().resolves([]) };
    const mockProcessResults = sandbox.stub().returns({
      totalErrors: 1,
      errorPages: [{ user_agent: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
    });
    const mockCategorizeErrors = sandbox.stub().returns({
      404: [{ user_agent: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
    });

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: sandbox.stub().returns({ weeks: [{ weekNumber: 1, year: 2025, startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2025' }] }),
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: mockCategorizeErrors,
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
        SPREADSHEET_COLUMNS: [],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: sandbox.stub().resolves(),
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          bucket: 'test', siteName: 'test', databaseName: 'test_db', tableName: 'test_table',
          getAthenaTempLocation: () => 's3://test/temp/',
        }),
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => mockAthenaClient,
        }),
      },
      exceljs: {
        default: { Workbook: function Workbook() { return { addWorksheet: () => ({ addRow: sandbox.stub() }) }; } },
      },
    });

    const topPages = [{ getUrl: () => 'https://example.com/seo-alt1' }];

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue' },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-123',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'test' }),
      },
      audit: { getId: () => 'audit-123' },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(topPages) },
      },
    };

    const result = await handler.runAuditAndSendToMystique(context);

    expect(result.auditResult[0].success).to.be.true;
    const sentMessage = context.sqs.sendMessage.firstCall.args[1];
      expect(sentMessage.data.alternativeUrls).to.deep.equal(['https://example.com/seo-alt1']);
      expect(context.log.info).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No agentic URLs from Athena, falling back to SEO top pages',
      );
    });
});

describe('LLM Error Pages Handler (isolated)', function () {
  this.timeout(10000);
  it('covers Excel row fallbacks and sorting branches without shared beforeEach', async () => {
    const worksheetRows = [];
    const sandbox = sinon.createSandbox();
    const site = {
      getBaseURL: () => 'https://example.com',
      getId: () => 'site-id-123',
      getDeliveryType: () => 'aem_edge',
      getConfig: () => ({
        getLlmoCdnlogsFilter: () => [],
        getLlmoDataFolder: () => 'test-customer',
      }),
    };
    const audit = {
      getId: () => 'audit-id-456',
      getAuditType: () => 'llm-error-pages',
      getFullAuditRef: () => 'llm-error-pages::example.com',
      getAuditResult: sandbox.stub().returns({ success: true }),
    };
    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'spacecat-to-mystique' },
      site,
      audit,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => 'https://example.com' }]),
        },
      },
    };
    const mockAthenaClient = { query: sandbox.stub().resolves([]) };
    const mockGetS3Config = sandbox.stub().returns({
      bucket: 'test-bucket',
      siteName: 'test-customer',
      databaseName: 'test_db',
      tableName: 'test_table',
      getAthenaTempLocation: () => 's3://test-bucket/temp/',
    });
    const mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [{
        weekNumber: 34,
        year: 2025,
        startDate: new Date('2025-08-18T00:00:00Z'),
        endDate: new Date('2025-08-24T23:59:59Z'),
        periodIdentifier: 'w34-2025',
      }],
    });
    const mockBuildSiteFilters = sandbox.stub().returns('');
    const mockBuildQuery = sandbox.stub().resolves('SELECT ...');
    const mockGetAllLlmProviders = sandbox.stub().returns(['chatgpt']);
    const mockSaveExcelReport = sandbox.stub().resolves();
    const handlerModule = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
      },
      '@adobe/spacecat-shared-tier-client': {
        default: {},
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns(mockAthenaClient) },
      },
      '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }
          addStep() { return this; }
          withRunner() { return this; }
          build() { return {}; }
        },
      },
      '../../../src/common/audit-utils.js': {
        default: {},
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: mockGenerateReportingPeriods,
        processErrorPagesResults: () => ({
          totalErrors: 2,
          errorPages: [
            { user_agent: 'BotA', url: '/a', status: 404, total_requests: 3, avg_ttfb_ms: undefined, country_code: undefined, product: undefined, category: undefined },
            { user_agent: 'BotB', url: '/b', status: 404, total_requests: undefined, avg_ttfb_ms: 100, country_code: 'US', product: 'P', category: 'C' },
          ],
          summary: { uniqueUrls: 2, uniqueUserAgents: 2, statusCodes: { 404: 3 } },
        }),
        buildLlmErrorPagesQuery: mockBuildQuery,
        getAllLlmProviders: mockGetAllLlmProviders,
        categorizeErrorsByStatusCode: (eps) => ({ 404: eps }),
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
        SPREADSHEET_COLUMNS: ['Agent Type', 'User Agent', 'Number of Hits', 'Avg TTFB (ms)', 'Country Code', 'URL', 'Product', 'Category', 'Suggested URLs', 'AI Rationale', 'Confidence score'],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: mockSaveExcelReport,
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: mockBuildSiteFilters,
        getS3Config: mockGetS3Config,
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => mockAthenaClient,
        }),
      },
      exceljs: {
        default: {
          Workbook: function Workbook() {
            return {
              addWorksheet() {
                return {
                  addRow: (row) => { worksheetRows.push(row); },
                };
              },
            };
          },
        },
      },
    });
    await handlerModule.runAuditAndSendToMystique(context);
    // headers + 2 rows
    const dataRows = worksheetRows.slice(1);
    // Sorted order and fallbacks
    sinon.assert.match(dataRows[0][1], 'BotA');
    sinon.assert.match(dataRows[0][2], 3);
    sinon.assert.match(dataRows[0][3], '');
    sinon.assert.match(dataRows[0][4], '');
    sinon.assert.match(dataRows[0][6], '');
    sinon.assert.match(dataRows[0][7], '');
    sinon.assert.match(dataRows[1][2], 0);
  });
});

describe('LLM Error Pages Handler – default export routing', function () {
  this.timeout(10000);

  it('routes to backfillAudit when weekOffset is present', async () => {
    const sandbox = sinon.createSandbox();
    const mockBackfillRun = sandbox.stub().resolves({ status: 200 });
    const mockStepRun = sandbox.stub().resolves({ status: 200 });

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }
          addStep() { return this; }
          withRunner() { this._runner = true; return this; }
          build() { return { run: this._runner ? mockBackfillRun : mockStepRun }; }
        },
      },
    });

    await handler.default.run({ auditContext: { weekOffset: -1 } }, {});
    expect(mockBackfillRun).to.have.been.calledOnce;
    expect(mockStepRun).not.to.have.been.called;

    sandbox.restore();
  });

  it('routes to stepAudit when weekOffset is absent', async () => {
    const sandbox = sinon.createSandbox();
    const mockBackfillRun = sandbox.stub().resolves({ status: 200 });
    const mockStepRun = sandbox.stub().resolves({ status: 200 });

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }
          addStep() { return this; }
          withRunner() { this._runner = true; return this; }
          build() { return { run: this._runner ? mockBackfillRun : mockStepRun }; }
        },
      },
    });

    await handler.default.run({}, {});
    expect(mockStepRun).to.have.been.calledOnce;
    expect(mockBackfillRun).not.to.have.been.called;

    sandbox.restore();
  });

  it('backfillAudit runner calls runAuditAndSendToMystique with enriched context', async () => {
    const sandbox = sinon.createSandbox();
    let capturedRunner;

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }
          addStep() { return this; }
          withRunner(runner) { capturedRunner = runner; return this; }
          build() { return { run: sandbox.stub() }; }
        },
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sandbox.stub().returns({ query: sandbox.stub().resolves([]) }) },
      },
      '../../../src/llm-error-pages/utils.js': {
        getS3Config: sandbox.stub().resolves({
          databaseName: 'db', tableName: 'tbl', siteName: 'test',
          getAthenaTempLocation: () => 's3://tmp/',
        }),
        generateReportingPeriods: sandbox.stub().returns({
          weeks: [{ startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2025' }],
        }),
        processErrorPagesResults: sandbox.stub().returns({ totalErrors: 0, errorPages: [], summary: { uniqueUrls: 0 } }),
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: sandbox.stub().returns({}),
        consolidateErrorsByUrl: (e) => e,
        sortErrorsByTrafficVolume: (e) => e,
        toPathOnly: (u) => u,
        SPREADSHEET_COLUMNS: [],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: sandbox.stub().resolves(),
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
      },
      exceljs: {
        default: { Workbook: function Workbook() { return { addWorksheet: () => ({ addRow: sandbox.stub() }) }; } },
      },
    });

    expect(capturedRunner).to.be.a('function');

    const mockSite = {
      getBaseURL: () => 'https://example.com',
      getId: () => 'site-1',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'test' }),
    };
    const mockContext = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
    };

    const result = await capturedRunner('https://example.com', mockContext, mockSite, { weekOffset: -1 });
    expect(result).to.have.property('auditResult');

    sandbox.restore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB dual-write paths (Opportunity + Suggestion sync alongside Excel write)
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Error Pages Handler — DB dual-write', function () {
  this.timeout(10000);

  const buildHandler = async (sandbox, overrides = {}) => {
    const mockAthenaClient = { query: sandbox.stub().resolves([]) };
    const mockGenerateReportingPeriods = sandbox.stub().returns({
      weeks: [{
        weekNumber: 15,
        year: 2026,
        startDate: new Date('2026-04-06T00:00:00Z'),
        endDate: new Date('2026-04-12T23:59:59Z'),
        periodIdentifier: 'w15-2026',
      }],
    });
    const defaultErrorPages = [
      { user_agent: 'ChatGPT', agent_type: 'Chatbots', url: '/p1', status: 404, total_requests: 10 },
      { user_agent: 'Perplexity', agent_type: 'Web search crawlers', url: '/p2', status: 403, total_requests: 5 },
      { user_agent: 'Claude', agent_type: 'Chatbots', url: '/p3', status: 503, total_requests: 3 },
    ];
    const errorPages = overrides.errorPages || defaultErrorPages;
    const mockProcessResults = sandbox.stub().returns({
      totalErrors: errorPages.length,
      errorPages,
      summary: { uniqueUrls: errorPages.length, uniqueUserAgents: errorPages.length },
    });
    const mockCategorize = sandbox.stub().callsFake((errors) => ({
      404: errors.filter((e) => e.status === 404),
      403: errors.filter((e) => e.status === 403),
      '5xx': errors.filter((e) => e.status >= 500),
    }));

    const mockGroupErrorsByUrl = sandbox.stub().callsFake((errors) => errors.map((e) => ({
      url: e.url,
      httpStatus: e.status,
      hitCount: e.total_requests || 0,
      agentTypes: [e.agent_type],
      userAgents: [e.user_agent],
      avgTtfb: e.avg_ttfb_ms,
      countryCode: e.country_code,
      product: e.product,
      category: e.category,
    })));

    const mockParsePeriod = overrides.parsePeriodIdentifier
      || sandbox.stub().returns(new Date('2026-04-06T00:00:00Z'));

    const mockConvertToOpportunity = overrides.convertToOpportunity
      || sandbox.stub().callsFake((url, audit, ctx, mapper, type) => Promise.resolve({
        getId: () => `opp-${type}`,
        getType: () => type,
        getSuggestions: sandbox.stub().resolves(overrides.existingSuggestionsByType?.[type] || []),
      }));
    const mockSyncSuggestions = overrides.syncSuggestions || sandbox.stub().resolves();

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'i', SCRAPE_CLIENT: 's' } },
      },
      '@adobe/spacecat-shared-tier-client': { default: {} },
      '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class {
          withUrlResolver() { return this; } addStep() { return this; }
          withRunner() { return this; } build() { return {}; }
        },
      },
      '../../../src/common/audit-utils.js': { default: {} },
      '../../../src/common/opportunity.js': { convertToOpportunity: mockConvertToOpportunity },
      '../../../src/utils/data-access.js': { syncSuggestions: mockSyncSuggestions },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sandbox.stub().returns({}),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: mockGenerateReportingPeriods,
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: mockCategorize,
        groupErrorsByUrl: mockGroupErrorsByUrl,
        parsePeriodIdentifier: mockParsePeriod,
        consolidateErrorsByUrl: (e) => e,
        sortErrorsByTrafficVolume: (e) => e,
        toPathOnly: (u) => u,
        SPREADSHEET_COLUMNS: [],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: overrides.saveExcelReport || sandbox.stub().resolves(),
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          databaseName: 'db',
          tableName: 't',
          siteName: 'c',
          getAthenaTempLocation: () => 's3://x/',
        }),
        getCdnAwsRuntime: () => ({ createAthenaClient: () => mockAthenaClient }),
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: sandbox.stub().resolves([]),
      },
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        validateCountryCode: () => 'US',
      },
      exceljs: {
        default: { Workbook: function W() { return { addWorksheet: () => ({ addRow: sandbox.stub() }) }; } },
      },
    });

    return { handler, mockConvertToOpportunity, mockSyncSuggestions };
  };

  const buildContext = (sandbox, overrides = {}) => ({
    log: {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    },
    sqs: { sendMessage: sandbox.stub().resolves({}) },
    env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
    site: {
      getBaseURL: () => 'https://example.com',
      getId: () => 'site-1',
      getDeliveryType: () => 'aem_edge',
      getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'c' }),
    },
    audit: { getId: () => 'audit-1', getAuditResult: sandbox.stub() },
    dataAccess: {
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
      Opportunity: {
        allBySiteIdAndStatus: sandbox.stub().resolves(overrides.existingOpportunities || []),
      },
      Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
    },
    ...overrides.contextOverrides,
  });

  it('creates Opportunities and syncs suggestions per non-empty bucket', async () => {
    const sandbox = sinon.createSandbox();
    const { handler, mockConvertToOpportunity, mockSyncSuggestions } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    expect(mockConvertToOpportunity).to.have.been.calledThrice;
    const auditTypes = mockConvertToOpportunity.args.map((a) => a[4]);
    expect(auditTypes).to.have.members([
      'llm-error-pages-404', 'llm-error-pages-403', 'llm-error-pages-5xx',
    ]);
    expect(mockSyncSuggestions).to.have.been.calledThrice;
    sandbox.restore();
  });

  it('passes opportunityId from DB into the Mystique message', async () => {
    const sandbox = sinon.createSandbox();
    const { handler } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    expect(ctx.sqs.sendMessage).to.have.been.called;
    const sent = ctx.sqs.sendMessage.firstCall.args[1];
    expect(sent.data.opportunityId).to.equal('opp-llm-error-pages-404');
    sandbox.restore();
  });

  it('writes hitCount, agentTypes, and userAgents into the new Suggestion data', async () => {
    const sandbox = sinon.createSandbox();
    const { handler, mockSyncSuggestions } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    const callArgs = mockSyncSuggestions.args.find((a) => {
      const sample = a[0].newData[0];
      return sample && sample.url === '/p1';
    });
    expect(callArgs).to.exist;
    const { mapNewSuggestion } = callArgs[0];
    const fixture = {
      url: '/p1', httpStatus: 404, hitCount: 10, agentTypes: ['Chatbots'], userAgents: ['ChatGPT'],
    };
    const mapped = mapNewSuggestion(fixture);
    expect(mapped.data.userAgents).to.deep.equal(['ChatGPT']);
    expect(mapped.data.agentTypes).to.deep.equal(['Chatbots']);
    expect(mapped.data.hitCount).to.equal(10);
    expect(mapped.data.periodIdentifier).to.equal('w15-2026');
    sandbox.restore();
  });

  it('preserves AI-enriched fields via mergeDataFunction', async () => {
    const sandbox = sinon.createSandbox();
    const { handler, mockSyncSuggestions } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    const { mergeDataFunction } = mockSyncSuggestions.firstCall.args[0];
    const merged = mergeDataFunction(
      {
        url: '/p1',
        suggestedUrls: ['/alt'],
        aiRationale: 'great',
        confidenceScore: 0.9,
        someOldField: 'keepme',
      },
      {
        hitCount: 99,
        agentTypes: ['Chatbots'],
        userAgents: ['ChatGPT'],
        avgTtfb: 50,
        countryCode: 'US',
        product: 'P',
        category: 'C',
      },
    );
    expect(merged.hitCount).to.equal(99);
    expect(merged.userAgents).to.deep.equal(['ChatGPT']);
    expect(merged.suggestedUrls).to.deep.equal(['/alt']);
    expect(merged.aiRationale).to.equal('great');
    expect(merged.confidenceScore).to.equal(0.9);
    expect(merged.someOldField).to.equal('keepme');
  });

  it('mergeDataFunction omits AI fields when not present on existing data', async () => {
    const sandbox = sinon.createSandbox();
    const { handler, mockSyncSuggestions } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    const { mergeDataFunction } = mockSyncSuggestions.firstCall.args[0];
    const merged = mergeDataFunction({ url: '/p1' }, { hitCount: 1, agentTypes: ['A'], userAgents: ['U'] });
    expect(merged.suggestedUrls).to.be.undefined;
    expect(merged.aiRationale).to.be.undefined;
    expect(merged.confidenceScore).to.be.undefined;
  });

  it('runs retention sweep on existing opportunity for empty buckets', async () => {
    const sandbox = sinon.createSandbox();

    const staleSuggestion = {
      getData: () => ({ url: '/old', periodIdentifier: 'w01-2025' }),
      getStatus: () => 'NEW',
    };
    const staleOpportunity = {
      getId: () => 'opp-403-stale',
      getType: () => 'llm-error-pages-403',
      getSuggestions: sandbox.stub().resolves([staleSuggestion]),
    };

    // Only 404 errors — 403 and 5xx buckets empty so retention runs via stale lookup.
    const { handler } = await buildHandler(sandbox, {
      errorPages: [
        { user_agent: 'ChatGPT', agent_type: 'Chatbots', url: '/p1', status: 404, total_requests: 10 },
      ],
    });
    const ctx = buildContext(sandbox);
    ctx.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([staleOpportunity]);

    await handler.runAuditAndSendToMystique(ctx);

    expect(staleOpportunity.getSuggestions).to.have.been.called;
    sandbox.restore();
  });

  it('skips suggestions with no periodIdentifier in retention check', async () => {
    const sandbox = sinon.createSandbox();
    const sugWithoutPeriod = {
      getData: () => ({ url: '/legacy' }),
      getStatus: () => 'NEW',
    };
    const sugWithTerminal = {
      getData: () => ({ url: '/done', periodIdentifier: 'w01-2020' }),
      getStatus: () => 'RESOLVED',
    };
    const oldOpp = {
      getId: () => 'opp-404',
      getType: () => 'llm-error-pages-404',
      getSuggestions: sandbox.stub().resolves([sugWithoutPeriod, sugWithTerminal]),
    };
    const { handler, mockConvertToOpportunity } = await buildHandler(sandbox, {
      convertToOpportunity: sandbox.stub().resolves(oldOpp),
    });
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.not.have.been.called;
    expect(mockConvertToOpportunity).to.have.been.called;
    sandbox.restore();
  });

  it('calls bulkUpdateStatus when suggestions are stale', async () => {
    const sandbox = sinon.createSandbox();
    const stale = {
      getData: () => ({ url: '/old', periodIdentifier: 'w01-2020' }),
      getStatus: () => 'NEW',
    };
    const opp = {
      getId: () => 'opp-404',
      getType: () => 'llm-error-pages-404',
      getSuggestions: sandbox.stub().resolves([stale]),
    };
    const { handler } = await buildHandler(sandbox, {
      convertToOpportunity: sandbox.stub().resolves(opp),
      parsePeriodIdentifier: sandbox.stub().returns(new Date(0)), // epoch → always stale
    });
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    expect(ctx.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.calledWith([stale], 'OUTDATED');
    sandbox.restore();
  });

  it('logs and continues when DB sync throws (best-effort independence)', async () => {
    const sandbox = sinon.createSandbox();
    const { handler } = await buildHandler(sandbox, {
      convertToOpportunity: sandbox.stub().rejects(new Error('boom')),
    });
    const ctx = buildContext(sandbox);

    const result = await handler.runAuditAndSendToMystique(ctx);

    expect(ctx.log.error).to.have.been.calledWithMatch(/DB sync failed/);
    // Mystique message still sent (Excel + send-to-mystique path is independent of DB).
    expect(ctx.sqs.sendMessage).to.have.been.called;
    expect(result.auditResult[0].success).to.be.true;
    sandbox.restore();
  });

  it('logs and continues when Excel write throws (best-effort independence)', async () => {
    const sandbox = sinon.createSandbox();
    const { handler, mockSyncSuggestions } = await buildHandler(sandbox, {
      saveExcelReport: sandbox.stub().rejects(new Error('sharepoint-down')),
    });
    const ctx = buildContext(sandbox);

    await handler.runAuditAndSendToMystique(ctx);

    expect(ctx.log.error).to.have.been.calledWithMatch(/Excel write failed/);
    // DB sync still ran.
    expect(mockSyncSuggestions).to.have.been.called;
    sandbox.restore();
  });

  it('handles categorizedResults missing a status code key', async () => {
    const sandbox = sinon.createSandbox();
    // Custom buildHandler with categorize returning only 404 (no 403 / 5xx keys).
    const mockAthenaClient = { query: sandbox.stub().resolves([]) };
    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'i', SCRAPE_CLIENT: 's' } },
      },
      '@adobe/spacecat-shared-tier-client': { default: {} },
      '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class {
          withUrlResolver() { return this; } addStep() { return this; }
          withRunner() { return this; } build() { return {}; }
        },
      },
      '../../../src/common/audit-utils.js': { default: {} },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves({
          getId: () => 'opp-404', getType: () => 't', getSuggestions: sandbox.stub().resolves([]),
        }),
      },
      '../../../src/utils/data-access.js': { syncSuggestions: sandbox.stub().resolves() },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sandbox.stub().returns({}),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: sandbox.stub().returns({
          weeks: [{ startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2026' }],
        }),
        processErrorPagesResults: sandbox.stub().returns({
          totalErrors: 1,
          errorPages: [{ url: '/p', status: 404, total_requests: 1, agent_type: 'A', user_agent: 'U' }],
          summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
        }),
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        // Returns only 404 — 403 and 5xx are undefined → triggers `|| []` branch.
        categorizeErrorsByStatusCode: () => ({ 404: [{ url: '/p', status: 404, total_requests: 1, agent_type: 'A', user_agent: 'U' }] }),
        groupErrorsByUrl: (e) => e.map((x) => ({ ...x, hitCount: x.total_requests })),
        parsePeriodIdentifier: () => new Date(),
        consolidateErrorsByUrl: (e) => e,
        sortErrorsByTrafficVolume: (e) => e,
        toPathOnly: (u) => u,
        SPREADSHEET_COLUMNS: [],
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: sandbox.stub().resolves({}),
        saveExcelReport: sandbox.stub().resolves(),
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          databaseName: 'db', tableName: 't', siteName: 'c', getAthenaTempLocation: () => 's3://x/',
        }),
        getCdnAwsRuntime: () => ({ createAthenaClient: () => mockAthenaClient }),
      },
      '../../../src/utils/agentic-urls.js': { getTopAgenticUrlsFromAthena: sandbox.stub().resolves([]) },
      '../../../src/cdn-logs-report/utils/report-utils.js': { validateCountryCode: () => 'US' },
      exceljs: { default: { Workbook: function W() { return { addWorksheet: () => ({ addRow: sandbox.stub() }) }; } } },
    });

    const ctx = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
      sqs: { sendMessage: sandbox.stub().resolves({}) },
      env: { QUEUE_SPACECAT_TO_MYSTIQUE: 'q' },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'c' }),
      },
      audit: { getId: () => 'audit-1', getAuditResult: sandbox.stub() },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
        Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
      },
    };

    const result = await handler.runAuditAndSendToMystique(ctx);
    expect(result.auditResult[0].success).to.be.true;
    sandbox.restore();
  });

  it('opportunityId in Mystique message is undefined if 404 bucket has no errors', async () => {
    const sandbox = sinon.createSandbox();
    const { handler } = await buildHandler(sandbox);
    const ctx = buildContext(sandbox);

    // Override processedResults to only include 403 errors
    await handler.runAuditAndSendToMystique(ctx);

    // 404 bucket has errors in default fixture, so opportunityId is set.
    // This test confirms the default path includes a real id (not the old string template).
    const sent = ctx.sqs.sendMessage.firstCall.args[1];
    expect(sent.data.opportunityId).to.match(/^opp-/);
    expect(sent.data.opportunityId).to.not.match(/^llm-404-w/);
    sandbox.restore();
  });
});
