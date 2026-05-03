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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a minimal mock Opportunity object that satisfies the handler's interface.
 * @param {string} [id] - Opportunity ID returned by getId().
 * @param {Array}  [suggestions] - Suggestions returned by getSuggestions().
 */
function makeMockOpportunity(id = 'opp-id', suggestions = [], sandbox) {
  return {
    getId: () => id,
    getSuggestions: sandbox.stub().resolves(suggestions),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main describe block — shared beforeEach with esmock
// ─────────────────────────────────────────────────────────────────────────────

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
  let mockCategorizeErrorsByStatusCode;
  let mockGetTopAgenticUrlsFromAthena;
  let mockConvertToOpportunity;
  let mockSyncSuggestions;
  let mockOpportunity;

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

    // Mock Opportunity returned by convertToOpportunity — one per status code bucket.
    // Separate Opportunity objects per bucket so opportunityMap keys are distinct.
    const opp404 = makeMockOpportunity('opp-404', [], sandbox);
    const opp403 = makeMockOpportunity('opp-403', [], sandbox);
    const opp5xx = makeMockOpportunity('opp-5xx', [], sandbox);

    // Default: convertToOpportunity returns a different opportunity per call.
    mockOpportunity = opp404; // reference for assertions on the 404 bucket
    mockConvertToOpportunity = sandbox.stub()
      .onFirstCall().resolves(opp404)
      .onSecondCall().resolves(opp403)
      .onThirdCall().resolves(opp5xx);

    mockSyncSuggestions = sandbox.stub().resolves();

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
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([]),
          create: sandbox.stub().resolves(mockOpportunity),
        },
        Suggestion: {
          bulkUpdateStatus: sandbox.stub().resolves(),
          saveMany: sandbox.stub().resolves(),
        },
      },
    };

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
          user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/page1', status: 404, total_requests: 10,
        },
        {
          user_agent: 'Perplexity', agent_type: 'Perplexity', url: '/page2', status: 403, total_requests: 5,
        },
        {
          user_agent: 'Claude', agent_type: 'Claude', url: '/page3', status: 503, total_requests: 3,
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
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([]);

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
      '../../../src/common/opportunity.js': {
        convertToOpportunity: mockConvertToOpportunity,
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: mockSyncSuggestions,
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sandbox.stub().returns({
          origin: 'AUTOMATION',
          title: 'Mock Opportunity',
          description: 'Mock',
          guidance: { steps: [] },
          tags: ['isElmo', 'llm', 'Availability'],
          data: {},
        }),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: mockGenerateReportingPeriods,
        processErrorPagesResults: mockProcessResults,
        buildLlmErrorPagesQuery: mockBuildQuery,
        getAllLlmProviders: mockGetAllLlmProviders,
        categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
        groupErrorsByUrl: (errors) => errors, // identity — syncSuggestions is mocked anyway
        parsePeriodIdentifier: () => new Date(), // current date → nothing gets OUTDATED
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
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
    });

    importTopPagesAndScrape = handler.importTopPagesAndScrape;
    submitForScraping = handler.submitForScraping;
    runAuditAndSendToMystique = handler.runAuditAndSendToMystique;
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ─── importTopPagesAndScrape ────────────────────────────────────────────────

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

  // ─── submitForScraping ─────────────────────────────────────────────────────

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

  // ─── runAuditAndSendToMystique ─────────────────────────────────────────────

  describe('runAuditAndSendToMystique', () => {
    it('should create Opportunities in DB and send 404s to Mystique', async () => {
      const result = await runAuditAndSendToMystique(context);

      expect(result.type).to.equal('audit-result');
      expect(result.siteId).to.equal('site-id-123');
      expect(result.auditResult[0].success).to.be.true;
      expect(result.auditResult[0].periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
      expect(result.auditResult[0].totalErrors).to.equal(3);
      expect(result.fullAuditRef).to.equal('https://example.com');

      // Three Opportunities created — one per status code bucket (404, 403, 5xx)
      expect(mockConvertToOpportunity).to.have.been.calledThrice;
      expect(mockSyncSuggestions).to.have.been.calledThrice;

      // SQS message sent with correct opportunityId from the 404 Opportunity
      expect(context.sqs.sendMessage).to.have.been.calledOnce;
      const [, message] = context.sqs.sendMessage.firstCall.args;
      expect(message.data.opportunityId).to.equal('opp-404');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Sent.*consolidated 404 URLs to Mystique/),
      );
    });

    it('should produce two weeks of audit results when run on a Monday without weekOffset', async () => {
      const monday = new Date('2025-08-18T12:00:00Z'); // Monday
      const clock = sinon.useFakeTimers(monday.getTime());
      try {
        mockGenerateReportingPeriods.returns({
          weeks: [
            { weekNumber: 33, year: 2025, startDate: new Date('2025-08-11'), endDate: new Date('2025-08-17'), periodIdentifier: 'w33-2025' },
            { weekNumber: 34, year: 2025, startDate: new Date('2025-08-18'), endDate: new Date('2025-08-24'), periodIdentifier: 'w34-2025' },
          ],
        });
        // Reset stub so it resolves an opportunity for each of the 6 calls (3 buckets × 2 weeks)
        mockConvertToOpportunity.reset();
        mockConvertToOpportunity.resolves(makeMockOpportunity('opp-id', [], sandbox));

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

    it('should handle outer audit failure gracefully when Athena client setup fails', async () => {
      // Simulate failure before the week loop by making getS3Config throw
      mockGetS3Config.throws(new Error('S3 config error'));

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.false;
      expect(result.auditResult[0].error).to.equal('S3 config error');
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] Audit failed: S3 config error/),
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

    it('should create three Opportunities — one per status code bucket (404, 403, 5xx)', async () => {
      mockProcessResults.returns({
        totalErrors: 6,
        errorPages: [
          {
            user_agent: 'Bot1', agent_type: 'ChatGPT', url: '/404-1', status: 404, total_requests: 10,
          },
          {
            user_agent: 'Bot2', agent_type: 'ChatGPT', url: '/404-2', status: 404, total_requests: 9,
          },
          {
            user_agent: 'Bot3', agent_type: 'Claude', url: '/403-1', status: 403, total_requests: 8,
          },
          {
            user_agent: 'Bot4', agent_type: 'Claude', url: '/403-2', status: 403, total_requests: 7,
          },
          {
            user_agent: 'Bot5', agent_type: 'Perplexity', url: '/500-1', status: 500, total_requests: 6,
          },
          {
            user_agent: 'Bot6', agent_type: 'Perplexity', url: '/503-1', status: 503, total_requests: 5,
          },
        ],
        summary: { uniqueUrls: 6, uniqueUserAgents: 6 },
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      // One convertToOpportunity call per bucket (404, 403, 5xx)
      expect(mockConvertToOpportunity).to.have.been.calledThrice;
      const auditTypes = mockConvertToOpportunity.args.map((args) => args[4]);
      expect(auditTypes).to.include('llm-error-pages-404');
      expect(auditTypes).to.include('llm-error-pages-403');
      expect(auditTypes).to.include('llm-error-pages-5xx');
    });

    it('should skip Opportunity creation for empty status code buckets', async () => {
      // Only 404 errors — 403 and 5xx buckets are empty
      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [
          {
            user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/page1', status: 404, total_requests: 10,
          },
        ],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
      });
      mockCategorizeErrorsByStatusCode.returns({
        404: [{ user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/page1', status: 404, total_requests: 10 }],
        // No 403 or 5xx
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      // Only one Opportunity created (for 404)
      expect(mockConvertToOpportunity).to.have.been.calledOnce;
      expect(mockSyncSuggestions).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] No 403 errors for w34-2025, skipping sync/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/\[LLM-ERROR-PAGES\] No 5xx errors for w34-2025, skipping sync/),
      );
    });

    it('should run retention on existing opportunity even when bucket has no new errors', async () => {
      // 403 bucket has no new errors, but an existing opportunity exists in the DB.
      // Retention cleanup should still run against its suggestions.
      const staleOpportunity = makeMockOpportunity('opp-403-existing', [], sandbox);
      staleOpportunity.getType = () => 'llm-error-pages-403';

      context.dataAccess.Opportunity.allBySiteIdAndStatus = sandbox.stub().resolves([staleOpportunity]);

      mockProcessResults.returns({
        totalErrors: 1,
        errorPages: [{ user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/page1', status: 404, total_requests: 10 }],
        summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
      });
      mockCategorizeErrorsByStatusCode.returns({
        404: [{ user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/page1', status: 404, total_requests: 10 }],
        // 403 and 5xx empty — staleOpportunity found for 403
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      // getSuggestions called on the stale 403 opportunity for retention check
      expect(staleOpportunity.getSuggestions).to.have.been.calledOnce;
    });

    it('should skip suggestions with no periodIdentifier in the 4-week cleanup', async () => {
      // Suggestion missing periodIdentifier — the !lastSeen branch returns false
      const noTimestamp = {
        getData: () => ({ url: '/legacy', /* no periodIdentifier */ }),
        getStatus: () => 'NEW',
      };
      const freshOpportunity = makeMockOpportunity('opp-nots', [noTimestamp], sandbox);
      mockConvertToOpportunity.reset();
      mockConvertToOpportunity.resolves(freshOpportunity);

      // parsePeriodIdentifier returns epoch to make everything "stale", but
      // noTimestamp will be skipped because lastSeen is undefined.
      const handler = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-data-access': {
          Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
        },
        '@adobe/spacecat-shared-tier-client': { default: {} },
        '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
        '../../../src/common/audit-builder.js': {
          AuditBuilder: class AuditBuilder {
            withUrlResolver() { return this; }

            addStep() { return this; }

            withRunner() { return this; }

            build() { return {}; }
          },
        },
        '../../../src/common/audit-utils.js': { default: {} },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: mockSyncSuggestions,
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          createOpportunityData: sandbox.stub().returns({}),
        },
        '../../../src/llm-error-pages/utils.js': {
          generateReportingPeriods: mockGenerateReportingPeriods,
          processErrorPagesResults: mockProcessResults,
          buildLlmErrorPagesQuery: mockBuildQuery,
          getAllLlmProviders: mockGetAllLlmProviders,
          categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
          groupErrorsByUrl: (errors) => errors,
          parsePeriodIdentifier: () => new Date(0),
          consolidateErrorsByUrl: (errors) => errors,
          sortErrorsByTrafficVolume: (errors) => errors,
          toPathOnly: (url) => url,
        },
        '../../../src/utils/cdn-utils.js': {
          buildSiteFilters: mockBuildSiteFilters,
          getS3Config: mockGetS3Config,
          getCdnAwsRuntime: () => ({ createAthenaClient: () => mockAthenaClient }),
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
        },
      });

      const result = await handler.runAuditAndSendToMystique(context);

      // Should succeed — the legacy suggestion is skipped, not errored
      expect(result.auditResult[0].success).to.be.true;
      // bulkUpdateStatus should NOT have been called (no eligible stale suggestions)
      expect(context.dataAccess.Suggestion.bulkUpdateStatus).not.to.have.been.called;
    });

    it('should include s3Config metadata in outer error result when setup fails after getS3Config', async () => {
      // getS3Config succeeds (s3Config is defined) but getCdnAwsRuntime throws — covers
      // the s3Config?.property branches in the outer catch block.
      const handler = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-data-access': {
          Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
        },
        '@adobe/spacecat-shared-tier-client': { default: {} },
        '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
        '../../../src/common/audit-builder.js': {
          AuditBuilder: class AuditBuilder {
            withUrlResolver() { return this; }

            addStep() { return this; }

            withRunner() { return this; }

            build() { return {}; }
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
          buildLlmErrorPagesQuery: mockBuildQuery,
          getAllLlmProviders: mockGetAllLlmProviders,
          categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
          groupErrorsByUrl: (errors) => errors,
          parsePeriodIdentifier: () => new Date(),
          consolidateErrorsByUrl: (errors) => errors,
          sortErrorsByTrafficVolume: (errors) => errors,
          toPathOnly: (url) => url,
        },
        '../../../src/utils/cdn-utils.js': {
          buildSiteFilters: mockBuildSiteFilters,
          getS3Config: mockGetS3Config, // succeeds → s3Config is defined
          getCdnAwsRuntime: () => { throw new Error('Runtime setup failed'); }, // throws after getS3Config
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
        },
      });

      const result = await handler.runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.false;
      expect(result.auditResult[0].error).to.equal('Runtime setup failed');
      // s3Config is defined here so these should be the actual values (not undefined)
      expect(result.auditResult[0].database).to.equal('test_db');
      expect(result.auditResult[0].table).to.equal('test_table');
      expect(result.auditResult[0].customer).to.equal('test-customer');
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
        403: [{ user_agent: 'Bot1', agent_type: 'Bot1', url: '/403', status: 403, total_requests: 5 }],
        '5xx': [{ user_agent: 'Bot2', agent_type: 'Bot2', url: '/500', status: 500, total_requests: 3 }],
        // No 404 key
      });

      const result = await runAuditAndSendToMystique(context);

      expect(result.auditResult[0].success).to.be.true;
      expect(context.log.warn).to.have.been.calledWith(
        '[LLM-ERROR-PAGES] No 404 errors found, skipping Mystique message',
      );
      expect(context.sqs.sendMessage).not.to.have.been.called;
    });

    it('should outdate stale suggestions older than 4 weeks', async () => {
      // Simulate an existing Suggestion whose periodIdentifier is in the past
      const staleSuggestion = {
        getData: () => ({ url: '/old-page', periodIdentifier: 'w01-2025' }),
        getStatus: () => 'NEW',
      };
      const freshOpportunity = makeMockOpportunity('opp-fresh', [staleSuggestion], sandbox);
      mockConvertToOpportunity.reset();
      mockConvertToOpportunity.resolves(freshOpportunity);

      // Override parsePeriodIdentifier to return a date older than 4 weeks for 'w01-2025'
      const handler = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-data-access': {
          Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
        },
        '@adobe/spacecat-shared-tier-client': { default: {} },
        '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
        '../../../src/common/audit-builder.js': {
          AuditBuilder: class AuditBuilder {
            withUrlResolver() { return this; }

            addStep() { return this; }

            withRunner() { return this; }

            build() { return {}; }
          },
        },
        '../../../src/common/audit-utils.js': { default: {} },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: mockSyncSuggestions,
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          createOpportunityData: sandbox.stub().returns({}),
        },
        '../../../src/llm-error-pages/utils.js': {
          generateReportingPeriods: mockGenerateReportingPeriods,
          processErrorPagesResults: mockProcessResults,
          buildLlmErrorPagesQuery: mockBuildQuery,
          getAllLlmProviders: mockGetAllLlmProviders,
          categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
          groupErrorsByUrl: (errors) => errors,
          // Return epoch for 'w01-2025' so it's treated as stale
          parsePeriodIdentifier: (pid) => (pid === 'w01-2025' ? new Date(0) : new Date()),
          consolidateErrorsByUrl: (errors) => errors,
          sortErrorsByTrafficVolume: (errors) => errors,
          toPathOnly: (url) => url,
        },
        '../../../src/utils/cdn-utils.js': {
          buildSiteFilters: mockBuildSiteFilters,
          getS3Config: mockGetS3Config,
          getCdnAwsRuntime: () => ({ createAthenaClient: () => mockAthenaClient }),
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
        },
      });

      await handler.runAuditAndSendToMystique(context);

      expect(context.dataAccess.Suggestion.bulkUpdateStatus).to.have.been.called;
      const [outdatedSuggestions, status] = context.dataAccess.Suggestion.bulkUpdateStatus.firstCall.args;
      expect(outdatedSuggestions).to.include(staleSuggestion);
      expect(status).to.equal('OUTDATED');
    });

    it('should pass syncSuggestions the correct auditType buildKey per bucket', async () => {
      await runAuditAndSendToMystique(context);

      const calls = mockSyncSuggestions.args;
      expect(calls).to.have.length(3);

      // Verify buildKey generates the correct prefix for each bucket
      const [call404] = calls;
      const { buildKey: buildKey404 } = call404[0];
      expect(buildKey404({ url: '/foo' })).to.equal('llm-error-pages-404::/foo');

      const [, call403] = calls;
      const { buildKey: buildKey403 } = call403[0];
      expect(buildKey403({ url: '/bar' })).to.equal('llm-error-pages-403::/bar');

      const [,, call5xx] = calls;
      const { buildKey: buildKey5xx } = call5xx[0];
      expect(buildKey5xx({ url: '/baz' })).to.equal('llm-error-pages-5xx::/baz');
    });

    it('should produce correct Suggestion shape from mapNewSuggestion', async () => {
      await runAuditAndSendToMystique(context);

      const calls = mockSyncSuggestions.args;
      expect(calls.length).to.be.greaterThan(0);

      const { mapNewSuggestion } = calls[0][0]; // first bucket (404)
      const error = {
        url: '/broken-page',
        httpStatus: 404,
        agentTypes: ['ChatGPT', 'Perplexity'],
        hitCount: 42,
        avgTtfb: 180,
        countryCode: 'US',
        product: 'Blog',
        category: 'Tech',
      };

      const suggestion = mapNewSuggestion(error);

      expect(suggestion.opportunityId).to.equal('opp-404'); // from the first bucket's opportunity
      expect(suggestion.type).to.equal('REDIRECT_UPDATE');
      expect(suggestion.rank).to.equal(42);
      expect(suggestion.data.url).to.equal('/broken-page');
      expect(suggestion.data.httpStatus).to.equal(404);
      expect(suggestion.data.agentTypes).to.deep.equal(['ChatGPT', 'Perplexity']);
      expect(suggestion.data.hitCount).to.equal(42);
      expect(suggestion.data.avgTtfb).to.equal(180);
      expect(suggestion.data.countryCode).to.equal('US');
      expect(suggestion.data.product).to.equal('Blog');
      expect(suggestion.data.category).to.equal('Tech');
      expect(suggestion.data.periodIdentifier).to.match(/^w\d{2}-\d{4}$/);
      expect(suggestion.data.weeklyData).to.be.undefined;
    });

    it('should skip suggestions already marked OUTDATED/FIXED in the 4-week cleanup', async () => {
      // Stale suggestion that is already OUTDATED — should NOT be re-processed
      const alreadyOutdated = {
        getData: () => ({ url: '/old', periodIdentifier: 'w01-2025' }),
        getStatus: () => 'OUTDATED',
      };
      // Another stale suggestion that is FIXED
      const alreadyFixed = {
        getData: () => ({ url: '/fixed', periodIdentifier: 'w01-2025' }),
        getStatus: () => 'FIXED',
      };
      // A genuinely new suggestion (current week) — should not be touched
      const freshSuggestion = {
        getData: () => ({ url: '/fresh', periodIdentifier: 'w34-2025' }),
        getStatus: () => 'NEW',
      };

      const freshOpportunity = makeMockOpportunity('opp-fresh', [alreadyOutdated, alreadyFixed, freshSuggestion], sandbox);
      mockConvertToOpportunity.reset();
      mockConvertToOpportunity.resolves(freshOpportunity);

      const handler = await esmock('../../../src/llm-error-pages/handler.js', {
        '@adobe/spacecat-shared-data-access': {
          Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
        },
        '@adobe/spacecat-shared-tier-client': { default: {} },
        '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
        '../../../src/common/audit-builder.js': {
          AuditBuilder: class AuditBuilder {
            withUrlResolver() { return this; }

            addStep() { return this; }

            withRunner() { return this; }

            build() { return {}; }
          },
        },
        '../../../src/common/audit-utils.js': { default: {} },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: mockSyncSuggestions,
        },
        '../../../src/llm-error-pages/opportunity-data-mapper.js': {
          createOpportunityData: sandbox.stub().returns({}),
        },
        '../../../src/llm-error-pages/utils.js': {
          generateReportingPeriods: mockGenerateReportingPeriods,
          processErrorPagesResults: mockProcessResults,
          buildLlmErrorPagesQuery: mockBuildQuery,
          getAllLlmProviders: mockGetAllLlmProviders,
          categorizeErrorsByStatusCode: mockCategorizeErrorsByStatusCode,
          groupErrorsByUrl: (errors) => errors,
          // Always return epoch → all suggestions appear stale
          parsePeriodIdentifier: () => new Date(0),
          consolidateErrorsByUrl: (errors) => errors,
          sortErrorsByTrafficVolume: (errors) => errors,
          toPathOnly: (url) => url,
        },
        '../../../src/utils/cdn-utils.js': {
          buildSiteFilters: mockBuildSiteFilters,
          getS3Config: mockGetS3Config,
          getCdnAwsRuntime: () => ({ createAthenaClient: () => mockAthenaClient }),
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: mockGetTopAgenticUrlsFromAthena,
        },
      });

      await handler.runAuditAndSendToMystique(context);

      // bulkUpdateStatus should only be called with the genuinely-stale fresh suggestion
      // — the already-OUTDATED and already-FIXED ones are excluded by the status check
      const calls = context.dataAccess.Suggestion.bulkUpdateStatus.args;
      if (calls.length > 0) {
        const [outdatedList] = calls[0];
        expect(outdatedList).not.to.include(alreadyOutdated);
        expect(outdatedList).not.to.include(alreadyFixed);
      }
    });

    it('should preserve AI-enriched fields in mergeDataFunction', async () => {
      await runAuditAndSendToMystique(context);

      const calls = mockSyncSuggestions.args;
      expect(calls.length).to.be.greaterThan(0);

      const { mergeDataFunction } = calls[0][0];
      const existingData = {
        url: '/page1',
        hitCount: 5,
        agentTypes: ['Claude'],
        suggestedUrls: ['https://example.com/alt1'],
        aiRationale: 'Best match based on content',
        confidenceScore: 0.87,
      };
      const newDataItem = {
        url: '/page1',
        hitCount: 12,
        agentTypes: ['ChatGPT', 'Perplexity'],
        avgTtfb: 250,
        countryCode: 'US',
        product: 'Blog',
        category: 'Tech',
      };

      const merged = mergeDataFunction(existingData, newDataItem);

      // Live metrics updated
      expect(merged.hitCount).to.equal(12);
      expect(merged.agentTypes).to.deep.equal(['ChatGPT', 'Perplexity']);

      // AI-enriched fields preserved
      expect(merged.suggestedUrls).to.deep.equal(['https://example.com/alt1']);
      expect(merged.aiRationale).to.equal('Best match based on content');
      expect(merged.confidenceScore).to.equal(0.87);

      // periodIdentifier stamped
      expect(merged.periodIdentifier).to.equal('w34-2025');
      expect(merged.weeklyData).to.be.undefined;
    });

    it('should not carry forward AI fields that are absent from existingData', async () => {
      await runAuditAndSendToMystique(context);

      const { mergeDataFunction } = mockSyncSuggestions.args[0][0];

      // existingData has no AI-enriched fields yet (freshly created Suggestion)
      const existingData = {
        url: '/page1',
        hitCount: 5,
        agentTypes: ['Claude'],
        periodIdentifier: 'w33-2025',
      };
      const newDataItem = {
        url: '/page1',
        hitCount: 12,
        agentTypes: ['ChatGPT'],
        avgTtfb: 200,
        countryCode: 'US',
        product: 'Docs',
        category: 'Help',
      };

      const merged = mergeDataFunction(existingData, newDataItem);

      expect(merged.suggestedUrls).to.be.undefined;
      expect(merged.aiRationale).to.be.undefined;
      expect(merged.confidenceScore).to.be.undefined;
      expect(merged.weeklyData).to.be.undefined;
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Athena / SEO fallback tests
// ─────────────────────────────────────────────────────────────────────────────

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

  // ─── importTopPagesAndScrape fallbacks ────────────────────────────────────

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

  // ─── runAuditAndSendToMystique alternativeUrls fallback ───────────────────

  /**
   * Builds a minimal esmock for runAuditAndSendToMystique tests in this describe block.
   * Returns the handler module.
   */
  async function buildFallbackHandler(
    sb,
    {
      mockAthenaClientLocal,
      mockProcessResultsLocal,
      mockCategorizeErrorsLocal,
      getTopAgenticStub,
      convertToOpportunityStub,
      syncSuggestionsStub,
    },
  ) {
    const opp = {
      getId: () => 'opp-fallback',
      getSuggestions: sb.stub().resolves([]),
    };

    return esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import-worker', SCRAPE_CLIENT: 'scrape-client' } },
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: { fromContext: sb.stub().returns(mockAthenaClientLocal) },
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: getTopAgenticStub,
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: convertToOpportunityStub || sb.stub().resolves(opp),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub || sb.stub().resolves(),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sb.stub().returns({}),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: sb.stub().returns({
          weeks: [{ weekNumber: 1, year: 2025, startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2025' }],
        }),
        processErrorPagesResults: mockProcessResultsLocal,
        buildLlmErrorPagesQuery: sb.stub().resolves('SELECT'),
        getAllLlmProviders: sb.stub().returns([]),
        categorizeErrorsByStatusCode: mockCategorizeErrorsLocal,
        groupErrorsByUrl: (errors) => errors,
        parsePeriodIdentifier: () => new Date(),
        consolidateErrorsByUrl: (errors) => errors,
        sortErrorsByTrafficVolume: (errors) => errors,
        toPathOnly: (url) => url,
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sb.stub().returns(''),
        getS3Config: sb.stub().returns({
          bucket: 'test', customerName: 'test', databaseName: 'test_db', tableName: 'test_table',
          getAthenaTempLocation: () => 's3://test/temp/',
        }),
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => mockAthenaClientLocal,
        }),
      },
    });
  }

  it('should use Athena URLs for alternativeUrls in runAuditAndSendToMystique when available', async () => {
    mockGetTopAgenticUrlsFromAthena = sandbox.stub().resolves([
      'https://example.com/athena-alt1',
      'https://example.com/athena-alt2',
    ]);

    const mockAthenaClientLocal = { query: sandbox.stub().resolves([]) };
    const mockProcessResultsLocal = sandbox.stub().returns({
      totalErrors: 1,
      errorPages: [{ user_agent: 'Bot', agent_type: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
    });
    const mockCategorizeErrorsLocal = sandbox.stub().returns({
      404: [{ user_agent: 'Bot', agent_type: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
    });

    const handler = await buildFallbackHandler(sandbox, {
      mockAthenaClientLocal,
      mockProcessResultsLocal,
      mockCategorizeErrorsLocal,
      getTopAgenticStub: mockGetTopAgenticUrlsFromAthena,
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
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]), create: sandbox.stub().resolves({ getId: () => 'opp-id', getSuggestions: sandbox.stub().resolves([]) }) },
        Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
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

    const mockAthenaClientLocal = { query: sandbox.stub().resolves([]) };
    const mockProcessResultsLocal = sandbox.stub().returns({
      totalErrors: 1,
      errorPages: [{ user_agent: 'Bot', agent_type: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
      summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
    });
    const mockCategorizeErrorsLocal = sandbox.stub().returns({
      404: [{ user_agent: 'Bot', agent_type: 'Bot', url: '/404-page', status: 404, total_requests: 10, userAgent: 'Bot' }],
    });

    const handler = await buildFallbackHandler(sandbox, {
      mockAthenaClientLocal,
      mockProcessResultsLocal,
      mockCategorizeErrorsLocal,
      getTopAgenticStub: mockGetTopAgenticUrlsFromAthena,
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
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]), create: sandbox.stub().resolves({ getId: () => 'opp-id', getSuggestions: sandbox.stub().resolves([]) }) },
        Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
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

// ─────────────────────────────────────────────────────────────────────────────
// Isolated test: mergeDataFunction field grouping coverage
// ─────────────────────────────────────────────────────────────────────────────

describe('LLM Error Pages Handler (isolated)', function () {
  this.timeout(10000);

  it('mergeDataFunction stamps periodIdentifier and refreshes all live metrics', async () => {
    const sandbox = sinon.createSandbox();
    const capturedSyncArgs = [];

    const opp = {
      getId: () => 'opp-captured',
      getSuggestions: sandbox.stub().resolves([]),
    };

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '@adobe/spacecat-shared-data-access': {
        Audit: { AUDIT_STEP_DESTINATIONS: { IMPORT_WORKER: 'import', SCRAPE_CLIENT: 'scrape' } },
      },
      '@adobe/spacecat-shared-tier-client': { default: {} },
      '../../../src/common/index.js': { wwwUrlResolver: () => ({}) },
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }

          addStep() { return this; }

          withRunner() { return this; }

          build() { return {}; }
        },
      },
      '../../../src/common/audit-utils.js': { default: {} },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves(opp),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: (args) => { capturedSyncArgs.push(args); return Promise.resolve(); },
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sandbox.stub().returns({}),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: sandbox.stub().returns({
          weeks: [{
            weekNumber: 15, year: 2026, startDate: new Date(), endDate: new Date(), periodIdentifier: 'w15-2026',
          }],
        }),
        processErrorPagesResults: sandbox.stub().returns({
          totalErrors: 1,
          errorPages: [{
            user_agent: 'ChatGPT', agent_type: 'ChatGPT', url: '/a', status: 404, total_requests: 42,
            avg_ttfb_ms: 180, country_code: 'US', product: 'Blog', category: 'Tech',
          }],
          summary: { uniqueUrls: 1, uniqueUserAgents: 1 },
        }),
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: sandbox.stub().callsFake((eps) => ({ 404: eps })),
        groupErrorsByUrl: (errors) => errors,
        parsePeriodIdentifier: () => new Date(),
        consolidateErrorsByUrl: (e) => e,
        sortErrorsByTrafficVolume: (e) => e,
        toPathOnly: (u) => u,
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          bucket: 'b', customerName: 'c', databaseName: 'db', tableName: 'tbl',
          getAthenaTempLocation: () => 's3://b/tmp/',
        }),
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => ({ query: sandbox.stub().resolves([]) }),
        }),
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: sandbox.stub().resolves([]),
      },
    });

    const context = {
      log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
      site: {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-1',
        getDeliveryType: () => 'aem_edge',
        getConfig: () => ({ getLlmoCdnlogsFilter: () => [], getLlmoDataFolder: () => 'test' }),
      },
      audit: { getId: () => 'audit-1' },
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]), create: sandbox.stub().resolves(opp) },
        Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
      },
    };

    await handler.runAuditAndSendToMystique(context);

    expect(capturedSyncArgs).to.have.length(1); // one bucket (404 only)
    const { mergeDataFunction } = capturedSyncArgs[0];

    const existing = {
      url: '/a', hitCount: 5, agentTypes: ['Claude'], periodIdentifier: 'w14-2026',
      suggestedUrls: ['https://example.com/alt'],
      aiRationale: 'Great match',
      confidenceScore: 0.9,
    };
    const newItem = {
      url: '/a', hitCount: 42, agentTypes: ['ChatGPT'],
      avgTtfb: 180, countryCode: 'US', product: 'Blog', category: 'Tech',
    };

    const merged = mergeDataFunction(existing, newItem);

    // Live metrics refreshed
    expect(merged.hitCount).to.equal(42);
    expect(merged.agentTypes).to.deep.equal(['ChatGPT']);
    expect(merged.avgTtfb).to.equal(180);
    expect(merged.countryCode).to.equal('US');
    expect(merged.periodIdentifier).to.equal('w15-2026');

    // AI fields preserved
    expect(merged.suggestedUrls).to.deep.equal(['https://example.com/alt']);
    expect(merged.aiRationale).to.equal('Great match');
    expect(merged.confidenceScore).to.equal(0.9);

    // No weeklyData — history array removed per design
    expect(merged.weeklyData).to.be.undefined;

    sandbox.restore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Default export routing
// ─────────────────────────────────────────────────────────────────────────────

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

    const mockOpp = {
      getId: () => 'opp-backfill',
      getSuggestions: sandbox.stub().resolves([]),
    };

    const handler = await esmock('../../../src/llm-error-pages/handler.js', {
      '../../../src/common/audit-builder.js': {
        AuditBuilder: class AuditBuilder {
          withUrlResolver() { return this; }

          addStep() { return this; }

          withRunner(runner) { capturedRunner = runner; return this; }

          build() { return { run: sandbox.stub() }; }
        },
      },
      '../../../src/common/opportunity.js': {
        convertToOpportunity: sandbox.stub().resolves(mockOpp),
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: sandbox.stub().resolves(),
      },
      '../../../src/llm-error-pages/opportunity-data-mapper.js': {
        createOpportunityData: sandbox.stub().returns({}),
      },
      '../../../src/llm-error-pages/utils.js': {
        generateReportingPeriods: sandbox.stub().returns({
          weeks: [{ startDate: new Date(), endDate: new Date(), periodIdentifier: 'w01-2025' }],
        }),
        processErrorPagesResults: sandbox.stub().returns({ totalErrors: 0, errorPages: [], summary: { uniqueUrls: 0 } }),
        buildLlmErrorPagesQuery: sandbox.stub().resolves('SELECT'),
        getAllLlmProviders: sandbox.stub().returns([]),
        categorizeErrorsByStatusCode: sandbox.stub().returns({}),
        groupErrorsByUrl: (e) => e,
        parsePeriodIdentifier: () => new Date(),
        consolidateErrorsByUrl: (e) => e,
        sortErrorsByTrafficVolume: (e) => e,
        toPathOnly: (u) => u,
      },
      '../../../src/utils/cdn-utils.js': {
        buildSiteFilters: sandbox.stub().returns(''),
        getS3Config: sandbox.stub().returns({
          bucket: 'b', customerName: 'c', databaseName: 'db', tableName: 'tbl',
          getAthenaTempLocation: () => 's3://b/tmp/',
        }),
        getCdnAwsRuntime: () => ({
          createAthenaClient: () => ({ query: sandbox.stub().resolves([]) }),
        }),
      },
      '../../../src/utils/agentic-urls.js': {
        getTopAgenticUrlsFromAthena: sandbox.stub().resolves([]),
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
      dataAccess: {
        SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]), create: sandbox.stub().resolves(mockOpp) },
        Suggestion: { bulkUpdateStatus: sandbox.stub().resolves() },
      },
    };

    const result = await capturedRunner('https://example.com', mockContext, mockSite, { weekOffset: -1 });
    expect(result).to.have.property('auditResult');

    sandbox.restore();
  });
});
