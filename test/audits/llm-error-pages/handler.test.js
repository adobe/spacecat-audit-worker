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

    mockGetS3Config = sandbox.stub().resolves({
      bucket: 'test-bucket',
      customerName: 'test-customer',
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
        downloadExistingCdnSheet: mockDownloadExistingCdnSheet,
        matchErrorsWithCdnData: mockMatchErrorsWithCdnData,
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

    it('should limit to 100 pages when submitting for scraping', async () => {
      audit.getAuditResult.returns({ success: true });
      const manyPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(manyPages);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(100);
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
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
      expect(result.auditResult.totalErrors).to.equal(3);
      expect(result.auditResult.categorizedResults).to.exist;
      expect(result.fullAuditRef).to.equal('https://example.com');

      expect(context.log.info).to.have.been.calledWith('[LLM-ERROR-PAGES] Starting audit for https://example.com');
      expect(mockSaveExcelReport).to.have.been.called;
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Sent.*consolidated 404 URLs to Mystique/),
      );
    });

    it('should handle audit failure gracefully', async () => {
      mockAthenaClient.query.rejects(new Error('Database error'));

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.equal('Database error');
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Audit failed: Database error/),
        sinon.match.instanceOf(Error),
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should skip Excel generation when no CDN data available', async () => {
      mockDownloadExistingCdnSheet.resolves([]);

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] No existing CDN data found/),
      );
      expect(mockSaveExcelReport).not.to.have.been.called;
    });

    it('should skip Mystique when SQS not configured', async () => {
      context.sqs = null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] SQS or Mystique queue not configured, skipping message',
      );
    });

    it('should skip Mystique when queue env not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.true;
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

      expect(result.auditResult.success).to.be.true;
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

      expect(result.auditResult.success).to.be.true;
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

      expect(result.auditResult.success).to.be.true;
      expect(mockSaveExcelReport).to.have.been.calledThrice;
    });

    it('should handle site with no config', async () => {
      site.getConfig = () => null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.true;
      expect(mockBuildSiteFilters).to.have.been.calledWith([], site);
    });

    it('should handle site with no base URL', async () => {
      site.getBaseURL = () => null;

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult.success).to.be.true;
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

      expect(result.auditResult.success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });
  });
});
