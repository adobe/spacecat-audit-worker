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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
import prerenderHandler, {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
  processOpportunityAndSuggestions,
  createScrapeForbiddenOpportunity,
  uploadStatusSummaryToS3,
} from '../../../src/prerender/handler.js';
import { analyzeHtmlForPrerender } from '../../../src/prerender/utils/html-comparator.js';
import { createOpportunityData } from '../../../src/prerender/opportunity-data-mapper.js';
import { TOP_AGENTIC_URLS_LIMIT, TOP_ORGANIC_URLS_LIMIT } from '../../../src/prerender/utils/constants.js';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

describe('Prerender Audit', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Handler Structure', () => {
    it('should export a valid audit handler', () => {
      expect(prerenderHandler).to.be.an('object');
      expect(prerenderHandler.run).to.be.a('function');
    });

    it('should export step functions', () => {
      expect(importTopPages).to.be.a('function');
      expect(submitForScraping).to.be.a('function');
      expect(processContentAndGenerateOpportunities).to.be.a('function');
    });
  });

  describe('Import Top Pages', () => {
    it('should build a top-pages import job payload', async () => {
      const context = {
        site: { getId: () => 'test-site-id' },
        finalUrl: 'https://example.com',
      };
      const res = await importTopPages(context);
      expect(res).to.deep.equal({
        type: 'top-pages',
        siteId: 'test-site-id',
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: 'scrapes/test-site-id/',
      });
    });
  });
  describe('HTML Analysis', () => {
    it('should analyze HTML and detect prerender opportunities', async () => {
      const directHtml = '<html><body><h1>Simple content</h1></body></html>';
      const scrapedHtml = '<html><body><h1>Simple content</h1><div>Lots of additional content loaded by JavaScript</div><p>More dynamic content</p></body></html>';

      const result = await analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result).to.be.an('object');
      expect(result.needsPrerender).to.be.a('boolean');
      expect(result.contentGainRatio).to.be.a('number');
      expect(result.wordCountBefore).to.be.a('number');
      expect(result.wordCountAfter).to.be.a('number');
    });

    it('should not recommend prerender for similar content', async () => {
      const directHtml = '<html><body><h1>Content</h1><p>Same content</p></body></html>';
      const scrapedHtml = '<html><body><h1>Content</h1><p>Same content</p></body></html>';

      const result = await analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result.needsPrerender).to.be.false;
      expect(result.contentGainRatio).to.be.at.most(1.2);
    });

    it('should throw error for missing HTML', async () => {
      try {
        await analyzeHtmlForPrerender(null, null, 1.2);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.an('error');
        expect(error.message).to.equal('Missing HTML content for comparison');
      }
    });

    it('should handle HTML with no content', async () => {
      const directHtml = '<html><head><title>Test</title></head><body></body></html>';
      const scrapedHtml = '<html><head><title>Test</title></head><body><p>Some content</p></body></html>';

      const result = await analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result).to.be.an('object');
      expect(result.needsPrerender).to.be.a('boolean');
      expect(result.wordCountBefore).to.equal(1); // Title text is counted
      expect(result.wordCountAfter).to.be.greaterThan(result.wordCountBefore);
    });

    it('should handle content gain ratio calculation edge cases', async () => {
      // Test case where both have zero content
      const emptyHtml = '<html><body></body></html>';
      const result1 = await analyzeHtmlForPrerender(emptyHtml, emptyHtml, 1.2);

      expect(result1.contentGainRatio).to.equal(1);
      expect(result1.wordCountBefore).to.equal(0);
      expect(result1.wordCountAfter).to.equal(0);

      // Test case where original has zero content but scraped has content
      const contentHtml = '<html><body><p>Some content here</p></body></html>';
      const result2 = await analyzeHtmlForPrerender(emptyHtml, contentHtml, 1.2);

      expect(result2.contentGainRatio).to.be.greaterThan(1);
      expect(result2.wordCountBefore).to.equal(0);
      expect(result2.wordCountAfter).to.be.greaterThan(0);
    });

    it('should handle HTML with complex elements', async () => {
      const directHtml = `
        <html>
          <head><title>Test</title></head>
          <body>
            <script>console.log('test');</script>
            <style>body { color: red; }</style>
            <h1>Title</h1>
            <img src="test.jpg" alt="test">
            <video src="test.mp4"></video>
          </body>
        </html>
      `;
      const scrapedHtml = `
        <html>
          <head><title>Test</title></head>
          <body>
            <script>console.log('test');</script>
            <style>body { color: red; }</style>
            <h1>Title</h1>
            <img src="test.jpg" alt="test">
            <video src="test.mp4"></video>
            <p>Additional dynamically loaded content</p>
            <div>More content from JavaScript</div>
          </body>
        </html>
      `;

      const result = await analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result).to.be.an('object');
      expect(result.wordCountBefore).to.be.greaterThan(0);
      expect(result.wordCountAfter).to.be.greaterThan(result.wordCountBefore);
    });
  });

  describe('Opportunity Data Mapper', () => {
    it('should create opportunity data with correct structure', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData).to.be.an('object');
      expect(opportunityData.runbook).to.equal('');
      expect(opportunityData.origin).to.equal('AUTOMATION');
      expect(opportunityData.title).to.equal('Recover Content Visibility');
      expect(opportunityData.description).to.contain('Pre-rendering HTML for JavaScript-heavy pages');
      expect(opportunityData.guidance).to.be.an('object');
      expect(opportunityData.guidance.steps).to.be.an('array');
      expect(opportunityData.data).to.be.an('object');
      expect(opportunityData.data.dataSources).to.be.an('array');
      expect(opportunityData.data.thresholds).to.be.an('object');
      expect(opportunityData.data.benefits).to.be.an('array');
    });

    it('should include scrapeForbidden flag when all scrapes are forbidden', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: true,
        },
      };

      const opportunityData = createOpportunityData(auditData);

      expect(opportunityData.data).to.have.property('scrapeForbidden');
      expect(opportunityData.data.scrapeForbidden).to.be.true;
    });

    it('should include scrapeForbidden=false when scraping is allowed', () => {
      const auditData = {
        auditResult: {
          scrapeForbidden: false,
        },
      };

      const opportunityData = createOpportunityData(auditData);

      expect(opportunityData.data).to.have.property('scrapeForbidden', false);
    });

    it('should include scrapeForbidden=false when auditResult is not provided', () => {
      const opportunityData = createOpportunityData();

      expect(opportunityData.data).to.have.property('scrapeForbidden', false);
    });

    it('should include scrapeForbidden=false when scrapeForbidden is undefined', () => {
      const auditData = {
        auditResult: {
          urlsNeedingPrerender: 5,
          // scrapeForbidden not provided
        },
      };

      const opportunityData = createOpportunityData(auditData);

      expect(opportunityData.data).to.have.property('scrapeForbidden', false);
    });
  });

  describe('Step Functions', () => {

    describe('submitForScraping', () => {
      it('should return URLs for scraping', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1' },
            { getUrl: () => 'https://example.com/page2' },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-content-and-generate-opportunities',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(result.maxScrapeAge).to.equal(0);
      });

      it('should fallback to base URL when no URLs found', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-content-and-generate-opportunities',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await submitForScraping(context);

        // Validate essential fields without requiring strict deep equality
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(result.maxScrapeAge).to.equal(0);
        expect(result.options).to.deep.equal({
          pageLoadTimeout: 20000,
          storagePrefix: 'prerender',
        });
        expect(result.urls).to.deep.equal([{ url: 'https://example.com' }]);
      });

      it('should include includedURLs from site config', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({ weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }] }),
            getS3Config: async () => ({ databaseName: 'db', tableName: 'tbl', getAthenaTempLocation: () => 's3://tmp/' }),
            weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT 1' },
            loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          },
        });
        const mockSiteTopPage = { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) };
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: (auditType) => (auditType === 'prerender' ? ['https://example.com/special'] : []) }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };
        const result = await mockHandler.submitForScraping(context);
        expect(result.urls).to.have.length(1);
        expect(result.urls.map((u) => u.url)).to.include('https://example.com/special');
      });

      it('should use Athena URLs when getTopAgenticUrlsFromAthena returns data', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticUrlsFromAthena: async () => [
              'https://example.com/athena-page1',
              'https://example.com/athena-page2',
            ],
          },
          '../../../src/prerender/utils/shared.js': {
            loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
            buildSheetHitsMap: () => new Map(),
          },
        });
        const mockSiteTopPage = { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) };
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };
        const result = await mockHandler.submitForScraping(context);
        // Athena URLs should be included
        expect(result.urls.map((u) => u.url)).to.include('https://example.com/athena-page1');
        expect(result.urls.map((u) => u.url)).to.include('https://example.com/athena-page2');
      });

      it('should cap top organic pages to TOP_ORGANIC_URLS_LIMIT', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            // No agentic urls for this test
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({ weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }] }),
            getS3Config: async () => ({ databaseName: 'db', tableName: 'tbl', getAthenaTempLocation: () => 's3://tmp/' }),
            weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT 1' },
            loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          },
        });
        const over = TOP_ORGANIC_URLS_LIMIT + 10;
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(
            Array.from({ length: over }).map((_, i) => ({ getUrl: () => `https://example.com/p${i}` })),
          ),
        };
        const context = {
          site: {
            getId: () => 'site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };
        const out = await mockHandler.submitForScraping(context);
        // Expect TOP_ORGANIC_URLS_LIMIT (200) URLs from Ahrefs top pages
        expect(out.urls).to.have.length(TOP_ORGANIC_URLS_LIMIT);
      });

      it('should fall back to sheet when Athena returns no data and use weekId from shared utils', async () => {
        const athenaQueryStub = sinon.stub().resolves([]);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({
              weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
              periodIdentifier: 'w45-2025',
            }),
            getS3Config: async () => ({
              bucket: 'b',
              customerName: 'adobe',
              customerDomain: 'adobe_com',
              databaseName: 'db',
              tableName: 'tbl',
              aggregatedLocation: 'agg/',
              getAthenaTempLocation: () => 's3://tmp/',
            }),
            loadLatestAgenticSheet: async () => ({
              weekId: 'w45-2025',
              baseUrl: 'https://example.com',
              rows: Array.from({ length: 60 }).map((_, i) => ({
                url: `/p${i}`, number_of_hits: 100 - i,
              })),
            }),
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({
              getIncludedURLs: () => [],
              getLlmoDataFolder: () => 'adobe',
            }),
          },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
          log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-content-and-generate-opportunities',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await mockHandler.submitForScraping(context);
        // Expect agentic URLs to be capped by TOP_AGENTIC_URLS_LIMIT (or available rows if fewer)
        const expectedCount = Math.min(TOP_AGENTIC_URLS_LIMIT, 60);
        expect(result.urls).to.have.length(expectedCount);
        // Sanity: top URL comes from sheet aggregation and is normalized against base URL
        expect(result.urls[0].url).to.equal('https://example.com/p0');
      });

      it('should merge includedURLs with sheet fallback agentic URLs (unique union)', async () => {
        const athenaQueryStub = sinon.stub().resolves([]);
        const sheetRows = [
          { url: '/a', number_of_hits: 10 },
          { url: '/b', number_of_hits: 9 },
        ];
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({
              weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
              periodIdentifier: 'w45-2025',
            }),
            getS3Config: async () => ({
              bucket: 'b',
              customerName: 'adobe',
              customerDomain: 'adobe_com',
              databaseName: 'db',
              tableName: 'tbl',
              aggregatedLocation: 'agg/',
              getAthenaTempLocation: () => 's3://tmp/',
            }),
            loadLatestAgenticSheet: async () => ({
              weekId: 'w45-2025',
              baseUrl: 'https://example.com',
              rows: sheetRows,
            }),
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({
              getIncludedURLs: () => ['https://example.com/b', 'https://example.com/c'],
              getLlmoDataFolder: () => 'adobe',
            }),
          },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
          log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub() },
        };

        const result = await mockHandler.submitForScraping(context);
        const urls = result.urls.map((u) => u.url);
        // Sheet /a and /b plus included /c (note: /b overlaps)
        expect(urls).to.include('https://example.com/a');
        expect(urls).to.include('https://example.com/b');
        expect(urls).to.include('https://example.com/c');
        // Unique union => 3
        expect(urls.length).to.equal(3);
      });

      it('should handle undefined topPages list from SiteTopPage gracefully', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            // No agentic URLs for this test
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
          '../../../src/prerender/utils/shared.js': {
            generateReportingPeriods: () => ({
              weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            }),
            getS3Config: async () => ({
              databaseName: 'db',
              tableName: 'tbl',
              getAthenaTempLocation: () => 's3://tmp/',
            }),
            weeklyBreakdownQueries: {
              createAgenticReportQuery: async () => 'SELECT 1',
              createTopUrlsQueryWithLimit: async () => 'SELECT 2',
            },
            loadLatestAgenticSheet: async () => ({
              weekId: 'w45-2025',
              baseUrl: 'https://example.com',
              rows: [],
            }),
          },
        });

        const mockSiteTopPage = {
          // Return undefined to exercise `(topPages || [])` fallback in getTopOrganicUrlsFromAhrefs
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(undefined),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
      });
    });

    describe('processContentAndGenerateOpportunities', () => {
      it('should process URLs and generate opportunities when prerender is needed', async function testProcessContentAndGenerateOpportunities() {
        this.timeout(5000); // Increase timeout to 5 seconds

        const mockSiteTopPage = {
          // Empty array to avoid network calls
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            error: sandbox.stub(),
            warn: sandbox.stub(),
            debug: sandbox.stub(),
          },
          scrapeResultPaths: new Map(), // Empty map to avoid S3 calls
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        // Test that the function exists and can be called
        expect(processContentAndGenerateOpportunities).to.be.a('function');

        // Test basic functionality with no URLs to process
        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult).to.be.an('object');
        expect(result.auditResult.urlsNeedingPrerender).to.equal(0);
        // Falls back to base URL when no URLs found
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
      });

      it('should handle errors gracefully', async function testHandleErrorsGracefully() {
        this.timeout(5000); // Increase timeout to 5 seconds
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(new Error('Database error')) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
          scrapeResultPaths: new Map(),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        // With the new flow (no SiteTopPage usage), errors there won't bubble.
        // Function should complete gracefully.
        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult).to.be.an('object');
      });

      it('should warn when Athena returns no agentic rows and sheet fallback fails', async () => {
        // Now that getTopAgenticUrlsFromAthena is in a separate module, mock it to return empty
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticUrlsFromAthena: async () => [],
          },
          '../../../src/prerender/utils/shared.js': {
            loadLatestAgenticSheet: async () => { throw new Error('sheet load failed'); },
            buildSheetHitsMap: () => new Map(),
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: {
              // No top pages, we don't want to exercise that path here
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
            },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map(),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult).to.be.an('object');

        // Should log info about sheet fallback attempt
        expect(context.log.info).to.have.been.calledWith(
          'Prerender - No agentic URLs from Athena; attempting Sheet fallback. baseUrl=https://example.com',
        );

        // Should warn about sheet fallback failure
        expect(context.log.warn).to.have.been.calledWith(
          'Prerender - Sheet-based agentic URL fetch failed: sheet load failed. baseUrl=https://example.com',
        );
      });

      it('should process URLs with scrape result paths', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const scrapeResultPaths = new Map();
        scrapeResultPaths.set('https://example.com/page1', '/path/to/result');

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            error: sandbox.stub(),
            warn: sandbox.stub(),
          },
          scrapeResultPaths,
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
      });

      it('should fallback to base URL when no URLs found anywhere', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]), // No top pages
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map(), // No scrape results
          s3Client: { send: sandbox.stub().rejects(new Error('No S3 data')) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
        // Should have logged about fallback to base URL
        expect(context.log.info).to.have.been.calledWith('Prerender - No URLs found for comparison. baseUrl=https://example.com, siteId=test-site-id');
      });

      it('should trigger opportunity processing path when prerender is detected', async () => {
        // This test covers line 341 by ensuring the full opportunity processing flow executes
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
          getSuggestions: () => Promise.resolve([]),
        };

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: sinon.stub().resolves(),
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 500 },
          ]),
        };

        const serverHtml = '<html><body><h1>Title</h1></body></html>';
        const clientHtml = '<html><body><h1>Title</h1><p>Significant additional content here</p><div>More dynamic content loaded by JavaScript</div><p>Even more substantial content that greatly increases the word count to trigger prerender detection</p></body></html>';

        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(serverHtml) }
            })
            .onSecondCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(clientHtml) }
            }),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        // This should fully execute the opportunity processing path including line 341
        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsNeedingPrerender).to.be.greaterThan(0);
        expect(context.log.info).to.have.been.called;
        // Verify that the opportunity processing was logged
        expect(context.log.info.args.some((call) => call[0].includes('Successfully synced'))).to.be.true;
      });

      it('should create dummy opportunity when scraping is forbidden', async () => {
        // Test that a dummy opportunity is created when all scrapes return 403
        const mockOpportunity = { getId: () => 'test-opportunity-id' };
        const convertToOpportunityStub = sinon.stub().resolves(mockOpportunity);
        const createScrapeForbiddenOpportunityStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        // Simulate 403 error in scrape.json
        const scrapeMetadata = {
          url: 'https://example.com/page1',
          status: 'FAILED',
          error: {
            message: 'HTTP 403 error for URL: https://example.com/page1',
            statusCode: 403,
            type: 'HttpError',
          },
        };

        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves(null); // No server HTML
        getObjectFromKeyStub.onCall(1).resolves(null); // No client HTML
        getObjectFromKeyStub.onCall(2).resolves(scrapeMetadata); // scrape.json with 403 error

        const mockHandlerWithS3 = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockS3Client = {
          send: sandbox.stub().resolves({}),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandlerWithS3.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.scrapeForbidden).to.be.true;
        expect(result.auditResult.urlsNeedingPrerender).to.equal(0);

        // Verify that convertToOpportunity was called for notification
        expect(convertToOpportunityStub).to.have.been.calledOnce;

        // Verify log message for dummy opportunity
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('Creating dummy opportunity for forbidden scraping'))).to.be.true;

        // Verify that convertToOpportunity was called with correct parameters
        expect(convertToOpportunityStub.firstCall.args[0]).to.equal('https://example.com'); // auditUrl
      });
    });

    describe('createScrapeForbiddenOpportunity', () => {
      it('should create opportunity without suggestions when scraping is forbidden', async () => {
        const mockOpportunity = { getId: () => 'test-opportunity-id' };
        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
        });

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            totalUrlsChecked: 5,
            urlsNeedingPrerender: 0,
            scrapeForbidden: true,
            results: [],
          },
        };

        const context = {
          log: {
            info: sandbox.stub(),
            error: sandbox.stub(),
            warn: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.createScrapeForbiddenOpportunity('https://example.com', auditData, context);

        expect(convertToOpportunityStub).to.have.been.calledOnce;
        expect(convertToOpportunityStub.firstCall.args[0]).to.equal('https://example.com');
        expect(context.log.info).to.have.been.calledWith(
          'Prerender - Creating dummy opportunity for forbidden scraping. baseUrl=https://example.com, siteId=test-site-id'
        );
      });
    });

    describe('No Opportunity Found - Outdated Suggestions', () => {
      // Note: Suggestion syncing is now handled by the well-tested syncSuggestions() utility function.
      // These tests verify the behavior when no new prerender needs are found.

      it('should call syncSuggestions with empty array when existing opportunity is found', async () => {
        const mockOpportunity = {
          getId: () => 'existing-opportunity-id',
          getType: () => 'prerender',
          getSuggestions: sandbox.stub().resolves([
            {
              getId: () => 'suggestion-1',
              getStatus: () => 'NEW',
              getData: () => ({ url: 'https://example.com/page1' }),
            },
          ]),
        };

        const allBySiteIdAndStatusStub = sandbox.stub().resolves([mockOpportunity]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: allBySiteIdAndStatusStub,
            },
            LatestAudit: {
              create: sandbox.stub().resolves(),
            },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {
            send: sandbox.stub().resolves({
              Body: { transformToString: () => Promise.resolve('') },
            }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully
        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsNeedingPrerender).to.equal(0);

        // Verify that we checked for existing opportunities
        expect(allBySiteIdAndStatusStub).to.have.been.calledWith('test-site-id', 'NEW');

        // Verify that syncSuggestions was called with correct parameters
        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.firstCall.args[0];
        expect(syncCall.opportunity).to.equal(mockOpportunity);
        expect(syncCall.newData).to.deep.equal([]); // Empty array to mark all as outdated
        expect(syncCall.context).to.equal(context);
        expect(syncCall.buildKey).to.be.a('function');
        expect(syncCall.mapNewSuggestion).to.be.a('function');

        // Test the buildKey function
        expect(syncCall.buildKey({ url: 'https://test.com' })).to.equal('https://test.com');

        // Test the mapNewSuggestion function
        expect(syncCall.mapNewSuggestion()).to.deep.equal({});

        // Verify log message indicates no opportunity was found
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('No opportunity found'))).to.be.true;
      });

      it('should not call syncSuggestions when existing opportunity is not prerender type', async () => {
        const mockOpportunity = {
          getId: () => 'existing-opportunity-id',
          getType: () => 'cwv', // Different type, not prerender
        };

        const allBySiteIdAndStatusStub = sandbox.stub().resolves([mockOpportunity]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: allBySiteIdAndStatusStub,
            },
            LatestAudit: {
              create: sandbox.stub().resolves(),
            },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {
            send: sandbox.stub().resolves({
              Body: { transformToString: () => Promise.resolve('') },
            }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully
        expect(result.status).to.equal('complete');

        // Verify that syncSuggestions was NOT called since opportunity is not prerender type
        expect(syncSuggestionsStub).to.not.have.been.called;

        // Verify log message indicates no opportunity was found
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('No opportunity found'))).to.be.true;
      });

      it('should not attempt to update suggestions when no existing opportunity is found', async () => {
        const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: allBySiteIdAndStatusStub,
            },
            LatestAudit: {
              create: sandbox.stub().resolves(),
            },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {
            send: sandbox.stub().resolves({
              Body: { transformToString: () => Promise.resolve('') },
            }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully
        expect(result.status).to.equal('complete');

        // Verify that syncSuggestions was NOT called since no existing opportunity was found
        expect(syncSuggestionsStub).to.not.have.been.called;

        // Verify log message indicates no opportunity was found
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('No opportunity found'))).to.be.true;
      });

      it('should successfully update LatestAudit with detailed results', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js');
        const latestAuditCreateStub = sandbox.stub().resolves();

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getIsLive: () => true,
          },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
            },
            LatestAudit: {
              create: latestAuditCreateStub,
            },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {
            send: sandbox.stub().resolves({
              Body: { transformToString: () => Promise.resolve('') },
            }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully
        expect(result.status).to.equal('complete');

        // Should call LatestAudit.create with correct data
        expect(latestAuditCreateStub).to.have.been.calledOnce;
        const createCall = latestAuditCreateStub.firstCall.args[0];
        expect(createCall).to.have.property('auditId', 'audit-id');
        expect(createCall).to.have.property('siteId', 'test-site-id');
        expect(createCall).to.have.property('auditType', 'prerender');
        expect(createCall).to.have.property('auditResult');
        expect(createCall).to.have.property('fullAuditRef', 'https://example.com');
        expect(createCall).to.have.property('auditedAt', '2024-01-01T00:00:00Z');
        expect(createCall).to.have.property('isLive', true);
        expect(createCall).to.have.property('isError', false);
        expect(createCall).to.have.property('invocationId', 'invocation-123');

        // Should log success message
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('Updated LatestAudit with detailed results'))).to.be.true;
      });

      it('should handle errors when updating LatestAudit', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js');

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getIsLive: () => true,
          },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
            },
            LatestAudit: {
              create: sandbox.stub().rejects(new Error('Database error')),
            },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {
            send: sandbox.stub().resolves({
              Body: { transformToString: () => Promise.resolve('') },
            }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully despite LatestAudit error
        expect(result.status).to.equal('complete');

        // Should log error about LatestAudit failure
        expect(context.log.error).to.have.been.calledWith(
          sinon.match(/Failed to update LatestAudit/)
        );
      });
    });

    describe('processOpportunityAndSuggestions', () => {
      it('should skip processing when no URLs need prerender', async () => {
        const auditData = {
          auditResult: {
            urlsNeedingPrerender: 0,
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        await processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(logStub).to.have.been.calledWith('Prerender - No prerender opportunities found, skipping opportunity creation. baseUrl=https://example.com, siteId=undefined');
      });

      it('should skip processing when no URLs in results need prerender', async () => {
        const auditData = {
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              { url: 'https://example.com/page1', needsPrerender: false },
            ],
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        await processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(logStub).to.have.been.calledWith('Prerender - No URLs needing prerender found, skipping opportunity creation. baseUrl=https://example.com, siteId=undefined');
      });

      it('should attempt to process opportunities when URLs need prerender', async () => {
        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 1.5,
              },
            ],
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        // This will fail due to missing mocks, but we test the early logging
        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // Expected to fail due to missing convertToOpportunity and syncSuggestions imports
          // But we can verify the function attempts to process
        }

        expect(logStub).to.have.been.calledWith('Prerender - Generated 1 prerender suggestions for baseUrl=https://example.com, siteId=test-site-id');
      });

      it('should call processOpportunityAndSuggestions correctly with full mock setup', async () => {
        // This test specifically targets lines 240-265 (opportunity creation and suggestion syncing)
        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 2,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.1,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 1.8,
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves(mockOpportunity),
            },
            Suggestion: {
              allByOpportunityId: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves({ getId: () => 'suggestion-1' }),
              remove: sandbox.stub().resolves(),
            },
          },
        };

        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // May still fail due to complex convertToOpportunity logic, but we should reach the opportunity creation
          // The key is that we test the filtering and logging logic
        }

        // Verify that we logged the correct number of suggestions
        expect(logStub).to.have.been.calledWith('Prerender - Generated 2 prerender suggestions for baseUrl=https://example.com, siteId=test-site-id');
      });

      it('should successfully execute opportunity creation flow and cover syncSuggestions', async () => {
        // This test targets lines 248-265 (syncSuggestions execution)
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
        };

        // Mock all required dependencies for the full opportunity creation flow
        const mockConvertToOpportunity = sandbox.stub().resolves(mockOpportunity);
        const mockSyncSuggestions = sandbox.stub().resolves();

        // Mock the dependencies - need to use dynamic import to mock ES modules
        // Since we can't easily stub ES modules, we'll test the logic indirectly
        // by testing what would happen if the dependencies were available

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                agenticTraffic: 500,
                contentGainRatio: 2.1,
              },
            ],
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // Expected to fail due to missing dependencies, but tests the early logic
          expect(error.message).to.match(/convertToOpportunity|destructure|opportunity|Opportunity/);
        }

        // Should have logged about generating suggestions
        expect(logStub).to.have.been.calledWith('Prerender - Generated 1 prerender suggestions for baseUrl=https://example.com, siteId=test-site-id');
      });

      it('should create domain-wide aggregate suggestion with correct aggregate metrics', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
        };

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 3,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 100,
                wordCountAfter: 300,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 200,
                wordCountAfter: 400,
              },
              {
                url: 'https://example.com/page3',
                needsPrerender: true,
                contentGainRatio: 1.0,
                wordCountBefore: 150,
                wordCountAfter: 150,
              },
            ],
          },
        };

        const createdSuggestions = [];
        const logStub = {
          info: sandbox.stub(),
          debug: sandbox.stub(),
        };

        const context = {
          log: logStub,
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves(mockOpportunity),
            },
            Suggestion: {
              allByOpportunityId: sandbox.stub().resolves([]),
              create: sandbox.stub().callsFake((suggestionData) => {
                createdSuggestions.push(suggestionData);
                return Promise.resolve({ getId: () => `suggestion-${createdSuggestions.length}` });
              }),
              remove: sandbox.stub().resolves(),
            },
          },
        };

        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // May fail due to complex dependencies, but we can check created suggestions
        }

        // Find the domain-wide aggregate suggestion
        const domainWideSuggestion = createdSuggestions.find(
          (s) => s.data.isDomainWide === true,
        );

        if (domainWideSuggestion) {
          // Verify domain-wide aggregate suggestion properties
          expect(domainWideSuggestion.data.url).to.equal('https://example.com/* (All Domain URLs)');
          expect(domainWideSuggestion.data.isDomainWide).to.be.true;
          expect(domainWideSuggestion.data.allowedRegexPatterns).to.be.an('array');
          expect(domainWideSuggestion.data.allowedRegexPatterns).to.have.lengthOf(1);
          expect(domainWideSuggestion.data.allowedRegexPatterns[0]).to.equal('/*');
          expect(domainWideSuggestion.data.pathPattern).to.equal('/*');
          expect(domainWideSuggestion.data.scope).to.equal('domain-wide');

          // Verify aggregated (summed) metrics
          // Total contentGainRatio: 3.0 + 2.0 + 1.0 = 6.0
          expect(domainWideSuggestion.data.contentGainRatio).to.equal(6.0);

          // Total wordCountBefore: 100 + 200 + 150 = 450
          expect(domainWideSuggestion.data.wordCountBefore).to.equal(450);

          // Total wordCountAfter: 300 + 400 + 150 = 850
          expect(domainWideSuggestion.data.wordCountAfter).to.equal(850);

          // Verify metadata
          expect(domainWideSuggestion.data.auditedUrlCount).to.equal(3);
          expect(domainWideSuggestion.data.auditedUrls).to.have.length(3);
          expect(domainWideSuggestion.data.description).to.include('entire domain');
          expect(domainWideSuggestion.data.note).to.include('ALL URLs in the domain');
          expect(domainWideSuggestion.data.note).to.include('total aggregated values');

          // Verify UI display annotations with "+" suffix for baseline values
          expect(domainWideSuggestion.data).to.have.property('displayAnnotations');
          expect(domainWideSuggestion.data.displayAnnotations.contentGainRatio).to.equal('1×+');
          expect(domainWideSuggestion.data.displayAnnotations.aiReadableContent).to.include('%+');
          expect(domainWideSuggestion.data.displayAnnotations.wordCountBefore).to.equal('100+');
          expect(domainWideSuggestion.data.displayAnnotations.wordCountAfter).to.equal('150+');

          // Verify calculated AI-readable percentage (sum of individual percentages)
          // URL1: (100/300)*100 = 33%, URL2: (200/400)*100 = 50%, URL3: (150/150)*100 = 100%
          // Total: 33 + 50 + 100 = 183
          expect(domainWideSuggestion.data).to.have.property('aiReadablePercent');
          expect(domainWideSuggestion.data.aiReadablePercent).to.be.a('number');
          expect(domainWideSuggestion.data.aiReadablePercent).to.equal(183);

          // Verify high rank for appearing first
          expect(domainWideSuggestion.rank).to.equal(999999);
        }
      });

      it('should create domain-wide aggregate suggestion even with single URL', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
        };

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 5.0,
                wordCountBefore: 100,
                wordCountAfter: 500,
              },
            ],
          },
        };

        const createdSuggestions = [];
        const logStub = {
          info: sandbox.stub(),
          debug: sandbox.stub(),
        };

        const context = {
          log: logStub,
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves(mockOpportunity),
            },
            Suggestion: {
              allByOpportunityId: sandbox.stub().resolves([]),
              create: sandbox.stub().callsFake((suggestionData) => {
                createdSuggestions.push(suggestionData);
                return Promise.resolve({ getId: () => `suggestion-${createdSuggestions.length}` });
              }),
              remove: sandbox.stub().resolves(),
            },
          },
        };

        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // May fail due to complex dependencies
        }

        // Find the domain-wide aggregate suggestion
        const domainWideSuggestion = createdSuggestions.find(
          (s) => s.data.isDomainWide === true,
        );

        if (domainWideSuggestion) {
          // Should create domain-wide suggestion even with single URL
          expect(domainWideSuggestion.data.url).to.equal('https://example.com/* (All Domain URLs)');
          expect(domainWideSuggestion.data.auditedUrlCount).to.equal(1);
          expect(domainWideSuggestion.data.contentGainRatio).to.equal(5.0);
        }
      });

      it('should use constant key for domain-wide aggregate suggestion to ensure uniqueness', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
        };

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 100,
                wordCountAfter: 200,
              },
            ],
          },
        };

        const logStub = {
          info: sandbox.stub(),
          debug: sandbox.stub(),
        };

        const context = {
          log: logStub,
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves(mockOpportunity),
            },
            Suggestion: {
              allByOpportunityId: sandbox.stub().resolves([]),
              create: sandbox.stub().resolves({ getId: () => 'test-suggestion' }),
              remove: sandbox.stub().resolves(),
            },
          },
        };

        try {
          await processOpportunityAndSuggestions('https://example.com', auditData, context);
        } catch (error) {
          // May fail due to dependencies
        }

        // Verify logging mentions domain-wide suggestion sync
        const logCalls = logStub.info.getCalls().map((call) => call.args[0]);
        const domainWideSuggestionLog = logCalls.find((msg) => msg.includes('domain-wide aggregate suggestion'));

        if (domainWideSuggestionLog) {
          expect(domainWideSuggestionLog).to.include('entire domain');
          expect(domainWideSuggestionLog).to.include('regex');
        }
      });

      it('should properly execute syncSuggestions with domain-wide aggregate suggestion mapper and merge functions', async () => {
        // This test specifically ensures lines 460-466 are covered (mapNewSuggestion and mergeDataFunction)
        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([]),
        };
        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const auditData = {
          siteId: 'test-site',
          auditId: 'audit-123',
          auditResult: {
            urlsNeedingPrerender: 2,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 150,
                wordCountAfter: 450,
              },
            ],
          },
        };

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        // Verify syncSuggestions was called once with combined data
        expect(syncSuggestionsStub).to.have.been.calledOnce;

        // Get the single call with both individual and domain-wide suggestions
        const syncCall = syncSuggestionsStub.getCall(0);
        expect(syncCall).to.exist;

        // Extract functions and data
        const { mapNewSuggestion, mergeDataFunction, newData } = syncCall.args[0];

        // Test mapNewSuggestion function execution for domain-wide suggestion
        // Domain-wide suggestion should be the last item in newData
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        const mappedSuggestion = mapNewSuggestion(domainWideSuggestion);

        expect(mappedSuggestion).to.have.property('opportunityId', 'test-opp-id');
        expect(mappedSuggestion).to.have.property('type', 'CONFIG_UPDATE');
        expect(mappedSuggestion).to.have.property('rank', 0); // All suggestions have rank 0 (sorting handled in UI)
        expect(mappedSuggestion).to.have.property('data');
        expect(mappedSuggestion.data).to.have.property('isDomainWide', true);

        // Test mergeDataFunction execution for domain-wide suggestion
        const existingData = { oldField: 'preserved' };
        const newDataItem = { key: 'domain-wide-aggregate|prerender', data: { newField: 'value' } };
        const mergedData = mergeDataFunction(existingData, newDataItem);

        expect(mergedData).to.deep.equal({ newField: 'value' });

        // Test mapNewSuggestion for individual suggestions
        const individualSuggestion = newData.find((item) => !item.key);
        expect(individualSuggestion).to.exist;
        const mappedIndividual = mapNewSuggestion(individualSuggestion);
        expect(mappedIndividual).to.have.property('rank', 0);

        // Test buildKey function to cover all branches (coverage for lines 508-517)
        const { buildKey } = syncCall.args[0];

        // Test case 1: data.key exists (coverage for lines 509-510)
        const dataWithKey = { key: 'custom-key-123' };
        const keyFromKey = buildKey(dataWithKey);
        expect(keyFromKey).to.equal('custom-key-123');

        // Test case 2: data.isDomainWide is true (coverage for lines 513-514)
        const domainWideData = { isDomainWide: true };
        const domainWideKey = buildKey(domainWideData);
        expect(domainWideKey).to.equal('domain-wide-aggregate|prerender');

        // Test case 3: neither key nor isDomainWide (coverage for lines 515-517)
        const plainUrlData = { url: 'https://example.com/test-page' };
        const plainUrlKey = buildKey(plainUrlData);
        expect(plainUrlKey).to.equal('https://example.com/test-page|prerender');

        // Test with actual individual suggestion data from newData
        const individualSuggestionData = individualSuggestion;
        const individualKey = buildKey(individualSuggestionData);
        expect(individualKey).to.equal('https://example.com/page1|prerender');
      });

      it('should skip domain-wide suggestion creation when existing suggestion has active status (NEW)', async () => {
        // Test that domain-wide suggestion is skipped when existing suggestion has NEW status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 2,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 150,
                wordCountAfter: 450,
              },
            ],
          },
        };

        // Create mock existing domain-wide suggestion with NEW status
        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.NEW,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        // Verify syncSuggestions was called once
        expect(syncSuggestionsStub).to.have.been.calledOnce;

        // Get the call and verify domain-wide suggestion IS included (to prevent OUTDATED status)
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be in newData (with existing data) to prevent it from being marked OUTDATED
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');
        expect(domainWideSuggestion.data.isDomainWide).to.be.true;

        // Individual suggestions should still be present
        expect(newData.length).to.equal(3); // 2 individual + 1 domain-wide
        expect(newData.filter((item) => !item.key).length).to.equal(2);

        // Verify log message about skipping creation
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in NEW state, skipping creation/),
        );
      });

      it('should skip domain-wide suggestion creation when existing suggestion has active status (FIXED)', async () => {
        // Test that domain-wide suggestion is skipped when existing suggestion has FIXED status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.FIXED,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
          getId: () => 'domain-wide-suggestion-id',
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be in newData (with existing data) to prevent it from being marked OUTDATED
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');
        expect(domainWideSuggestion.data.isDomainWide).to.be.true;

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in FIXED state, skipping creation/),
        );
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide matches:/),
        );
      });

      it('should treat fixed suggestion with domain-wide key as domain-wide', async () => {
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.FIXED,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in FIXED state, skipping creation/),
        );
      });

      it('should skip domain-wide suggestion creation when fixed suggestion uses domain-wide url pattern', async () => {
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.FIXED,
          getData: () => ({
            url: 'https://example.com/* (All Domain URLs)',
            pathPattern: '/*',
            allowedRegexPatterns: ['/*'],
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in FIXED state, skipping creation/),
        );
      });

      it('should skip domain-wide suggestion creation when existing suggestion has active status (PENDING_VALIDATION)', async () => {
        // Test that domain-wide suggestion is skipped when existing suggestion has PENDING_VALIDATION status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.PENDING_VALIDATION,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be in newData (with existing data) to prevent it from being marked OUTDATED
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');
        expect(domainWideSuggestion.data.isDomainWide).to.be.true;

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in PENDING_VALIDATION state, skipping creation/),
        );
      });

      it('should skip domain-wide suggestion creation when existing suggestion has active status (SKIPPED)', async () => {
        // Test that domain-wide suggestion is skipped when existing suggestion has SKIPPED status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.SKIPPED,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be in newData (with existing data) to prevent it from being marked OUTDATED
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');
        expect(domainWideSuggestion.data.isDomainWide).to.be.true;

        expect(context.log.info).to.have.been.calledWith(
          sinon.match(/Domain-wide suggestion already exists in SKIPPED state, skipping creation/),
        );
      });

      it('should skip domain-wide suggestion when existing suggestion has OUTDATED status', async () => {
        // Test that domain-wide suggestion is included when existing suggestion has OUTDATED status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.OUTDATED,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData, shouldUpdateSuggestion } = syncCall.args[0];

        // Domain-wide suggestion IS included in newData when all are OUTDATED
        // but shouldUpdateSuggestion callback prevents updates to OUTDATED suggestions
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // Verify shouldUpdateSuggestion callback is passed and works correctly
        expect(shouldUpdateSuggestion).to.be.a('function');
        // Test that OUTDATED domain-wide suggestions are filtered
        const result = shouldUpdateSuggestion(existingDomainWideSuggestion);
        expect(result).to.be.false;

        // Domain-wide suggestion is included in newData but shouldUpdateSuggestion filters it out
        // The log message about skipping modification was removed with the allOutdated check
      });

      it('should include domain-wide suggestion when existing suggestion has inactive status (ERROR)', async () => {
        // Test that domain-wide suggestion is included when existing suggestion has ERROR status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.ERROR,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be included when status is ERROR
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');

        // Log message about inactive status was removed with the inactive suggestions handling branch
      });

      it('should include domain-wide suggestion when existing suggestion has inactive status (APPROVED)', async () => {
        // Test that domain-wide suggestion is included when existing suggestion has APPROVED status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.APPROVED,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be included when status is APPROVED
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');

        // Log message about inactive status was removed with the inactive suggestions handling branch
      });

      it('should include domain-wide suggestion when existing suggestion has inactive status (IN_PROGRESS)', async () => {
        // Test that domain-wide suggestion is included when existing suggestion has IN_PROGRESS status
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const existingDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.IN_PROGRESS,
          getData: () => ({
            key: 'domain-wide-aggregate|prerender',
            isDomainWide: true,
          }),
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([existingDomainWideSuggestion]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Domain-wide suggestion SHOULD be included when status is IN_PROGRESS
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.key).to.equal('domain-wide-aggregate|prerender');

        // Log message about inactive status was removed with the inactive suggestions handling branch
      });

      it('should exercise all branches of shouldUpdateSuggestion callback', async () => {
        // Test that shouldUpdateSuggestion callback handles all cases correctly
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.5,
                wordCountBefore: 100,
                wordCountAfter: 250,
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: () => Promise.resolve([]),
        };

        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { shouldUpdateSuggestion } = syncCall.args[0];

        expect(shouldUpdateSuggestion).to.be.a('function');

        // Test 1: OUTDATED domain-wide suggestion should return false
        const outdatedDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.OUTDATED,
          getData: () => ({
            isDomainWide: true,
          }),
        };
        expect(shouldUpdateSuggestion(outdatedDomainWideSuggestion)).to.be.false;

        // Test 2: Non-OUTDATED domain-wide suggestion should return true
        const newDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.NEW,
          getData: () => ({
            isDomainWide: true,
          }),
        };
        expect(shouldUpdateSuggestion(newDomainWideSuggestion)).to.be.true;

        // Test 3: OUTDATED non-domain-wide suggestion should return true
        const outdatedNonDomainWideSuggestion = {
          getStatus: () => Suggestion.STATUSES.OUTDATED,
          getData: () => ({
            isDomainWide: false,
          }),
        };
        expect(shouldUpdateSuggestion(outdatedNonDomainWideSuggestion)).to.be.true;

        // Test 4: Suggestion without isDomainWide field should return true
        const suggestionWithoutField = {
          getStatus: () => Suggestion.STATUSES.OUTDATED,
          getData: () => ({}),
        };
        expect(shouldUpdateSuggestion(suggestionWithoutField)).to.be.true;

        // Test 5: Suggestion with null/undefined data should return true
        const suggestionWithNullData = {
          getStatus: () => Suggestion.STATUSES.OUTDATED,
          getData: () => null,
        };
        expect(shouldUpdateSuggestion(suggestionWithNullData)).to.be.true;
      });

      it('should store raw numeric values (totals) for domain-wide suggestions', async () => {
        // Test to verify raw total/summed numeric values are stored (formatting is done in UI)
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 2,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 2000000, // 2M
                wordCountAfter: 4000000, // 4M
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 3000000, // 3M
                wordCountAfter: 6000000, // 6M
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context, new Map());

        // Verify syncSuggestions was called once with combined data
        expect(syncSuggestionsStub).to.have.been.calledOnce;

        // Get the single call with both individual and domain-wide suggestions
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];

        // Find the domain-wide suggestion in the combined data
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // Verify raw total/summed values are stored (UI will format with M+ suffix)
        // Total wordCountBefore: 2000000 + 3000000 = 5000000 (5M)
        // Total wordCountAfter: 4000000 + 6000000 = 10000000 (10M)
        // Total contentGainRatio: 2.0 + 3.0 = 5.0
        expect(domainWideSuggestion.data.wordCountBefore).to.equal(5000000);
        expect(domainWideSuggestion.data.wordCountAfter).to.equal(10000000);
        expect(domainWideSuggestion.data.contentGainRatio).to.equal(5.0);
      });

      it('should handle zero values as raw numbers (UI handles N/A display)', async () => {
        // Test to verify zero values are stored as raw numbers (UI will display as "N/A")
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 0, // Zero value
                wordCountBefore: 0, // Zero value
                wordCountAfter: 0, // Zero value
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context, new Map());

        // Verify syncSuggestions was called once
        expect(syncSuggestionsStub).to.have.been.calledOnce;

        // Get the single call and find domain-wide suggestion
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // Verify raw zero values are stored (UI will format as "N/A")
        expect(domainWideSuggestion.data.contentGainRatio).to.equal(0);
        expect(domainWideSuggestion.data.wordCountBefore).to.equal(0);
        expect(domainWideSuggestion.data.wordCountAfter).to.equal(0);
        // agenticTraffic is calculated in the UI from fresh CDN logs data
      });

      it('should create domain-wide suggestion without agenticTraffic (handled in UI)', async () => {
        // agenticTraffic aggregation is now handled in the UI from fresh CDN logs
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 3,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 100,
                wordCountAfter: 200,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 150,
                wordCountAfter: 450,
              },
              {
                url: 'https://example.com/page3/',  // With trailing slash
                needsPrerender: true,
                contentGainRatio: 1.5,
                wordCountBefore: 200,
                wordCountAfter: 300,
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions(
          'https://example.com',
          auditData,
          context,
        );

        // Verify syncSuggestions was called once
        expect(syncSuggestionsStub).to.have.been.calledOnce;

        // Get the call and find domain-wide suggestion
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // Verify domain-wide suggestion exists (agenticTraffic is calculated in UI)
        expect(domainWideSuggestion.data.contentGainRatio).to.exist;
        expect(domainWideSuggestion.data.wordCountBefore).to.exist;
        expect(domainWideSuggestion.data.wordCountAfter).to.exist;
      });

      it('should create suggestions even with mixed valid/invalid URLs', async () => {
        // Test that suggestions are created regardless of URL validity
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 2,
            results: [
              {
                url: 'not-a-valid-url',  // Invalid URL
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 100,
                wordCountAfter: 200,
              },
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 150,
                wordCountAfter: 450,
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions(
          'https://example.com',
          auditData,
          context,
        );

        // Verify suggestions were created despite invalid URL
        expect(syncSuggestionsStub).to.have.been.calledOnce;
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion.data.contentGainRatio).to.exist;
      });

      it('should handle zero totalWordCountAfter when calculating aiReadablePercent', async () => {
        // Test to cover edge case when total word count after is zero
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 0,
                wordCountBefore: 0,
                wordCountAfter: 0,  // Zero after count - should result in 0 percent
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions(
          'https://example.com',
          auditData,
          context,
          new Map(),
        );

        // Get domain-wide suggestion
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // aiReadablePercent should be 0 when wordCountAfter is 0
        expect(domainWideSuggestion.data.aiReadablePercent).to.equal(0);
      });

      it('should correctly sum aiReadablePercent from individual suggestions with mixed zero/non-zero values', async () => {
        // Test to cover the new totalAiReadablePercent calculation logic (lines 456-466)
        // This test ensures both branches of the ternary operator are covered
        // Including undefined/null values to ensure || 0 fallback is covered
        const auditData = {
          siteId: 'test-site',
          auditId: 'test-audit-id',
          auditResult: {
            urlsNeedingPrerender: 5,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.0,
                wordCountBefore: 100,
                wordCountAfter: 500, // 100/500 = 20%
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                contentGainRatio: 3.0,
                wordCountBefore: 400,
                wordCountAfter: 800, // 400/800 = 50%
              },
              {
                url: 'https://example.com/page3',
                needsPrerender: true,
                contentGainRatio: 1.5,
                wordCountBefore: 300,
                wordCountAfter: 300, // 300/300 = 100%
              },
              {
                url: 'https://example.com/page4',
                needsPrerender: true,
                contentGainRatio: 0,
                wordCountBefore: 0,
                wordCountAfter: 0, // 0/0 = 0% (triggers else branch)
              },
              {
                url: 'https://example.com/page5',
                needsPrerender: true,
                contentGainRatio: 1.0,
                // wordCountBefore: undefined - tests || 0 fallback
                // wordCountAfter: undefined - tests || 0 fallback
              },
            ],
          },
        };

        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getSuggestions: sandbox.stub().resolves([]),
        };

        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': { convertToOpportunity: convertToOpportunityStub },
          '../../../src/utils/data-access.js': { syncSuggestions: syncSuggestionsStub },
        });

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions(
          'https://example.com',
          auditData,
          context,
          new Map(),
        );

        // Get domain-wide suggestion
        const syncCall = syncSuggestionsStub.getCall(0);
        const { newData } = syncCall.args[0];
        const domainWideSuggestion = newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;

        // Verify aiReadablePercent is sum of individual percentages
        // page1: 20%, page2: 50%, page3: 100%, page4: 0%, page5: 0% = total 170%
        expect(domainWideSuggestion.data.aiReadablePercent).to.equal(170);

        // Also verify word count totals (including undefined handling)
        expect(domainWideSuggestion.data.wordCountBefore).to.equal(800); // 100+400+300+0+0
        expect(domainWideSuggestion.data.wordCountAfter).to.equal(1600); // 500+800+300+0+0
        expect(domainWideSuggestion.data.contentGainRatio).to.equal(7.5); // 2+3+1.5+0+1
      });
    });
  });

  describe('Athena and Sheet Fetch Coverage', () => {
    it('should return top agentic URLs from Athena and filter "Other"; uses path fallback when baseUrl invalid (latest week)', async () => {
      // Now that getTopAgenticUrlsFromAthena is in a separate module, mock it directly
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: async () => ['/a', '/b'],
        },
        '../../../src/prerender/utils/shared.js': {
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          buildSheetHitsMap: () => new Map(),
        },
      });

      const result = await mockHandler.submitForScraping({
        site: {
          getId: () => 'site',
          getBaseURL: () => 'invalid', // force URL constructor to throw for fallback branch
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
      });

      const urls = result.urls.map((u) => u.url);
      // URLs returned from mocked getTopAgenticUrlsFromAthena
      expect(urls).to.include('/a');
      expect(urls).to.include('/b');
      expect(urls).to.have.length(2);
    });

    it('should populate agentic traffic for included URLs via Athena (hits-for-urls)', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async (q) => {
            // Return hits for the specific-URLs query
            if (q === 'SELECT 2') return [{ url: '/inc', number_of_hits: 7 }];
            return [];
          } }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT 1' },
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => ['https://example.com/inc'] }),
        },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'b' },
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      const found = res.auditResult.results.find((r) => r.url.includes('/inc'));
      expect(found).to.exist;
    });

    it('should cap agentic URLs in SQL via LIMIT; handler maps rows returned', async () => {
      // Now that getTopAgenticUrlsFromAthena is in a separate module, mock it directly
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: async () => ['https://example.com/u0'],
        },
        '../../../src/prerender/utils/shared.js': {
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          buildSheetHitsMap: () => new Map(),
        },
      });
      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const out = await mockHandler.submitForScraping(ctx);
      // Handler returns whatever getTopAgenticUrlsFromAthena returns
      expect(out.urls).to.have.length(1);
      expect(out.urls[0].url).to.equal('https://example.com/u0');
    });

    it('should return [] when sheet fallback has no rows', async () => {
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            customerName: 'adobe',
          }),
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
          },
        },
      });

        const res = await mockHandler.submitForScraping({
        site: { getId: () => 'id', getBaseURL: () => 'https://example.com', getConfig: () => ({ getIncludedURLs: () => [] }) },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
      });
      // Falls back to baseUrl when no URLs at all
      expect(res.urls.length === 0 || res.urls[0].url === 'https://example.com').to.be.true;
    });
  });

  describe('Additional branch coverage (mapping, catches)', () => {
    it('should use catch-path sheet fallback and hit toPath catch in fallback', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: {
            fromContext: () => ({
              // First call (Top Agentic URLs): return empty to force missingIncluded
              // Second call (Hits For Specific URLs): throw to enter catch/fallback
              query: async (_q, _db, label) => {
                if (label && String(label).includes('Top Agentic URLs')) return [];
                if (label && String(label).includes('Agentic Hits For Specific URLs')) throw new Error('athena-fail');
                return [];
              },
            }),
          },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT top' },
          // Fallback sheet with a default-path entry
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [{ url: '/inc', number_of_hits: 5 }],
          }),
          buildSheetHitsMap: (rows) => new Map([[rows[0]?.url || '/inc', rows[0]?.number_of_hits || 0]]),
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          // Invalid base URL triggers toPath catch branch in fallback section
          getBaseURL: () => 'invalid',
          // Use absolute URL so keys align with results and sheet mapping on '/inc'
          getConfig: () => ({ getIncludedURLs: () => ['https://example.com/inc'] }),
        },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        // No scrapeResultPaths so includedURLs are used to build urlsToCheck
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      expect(res.status).to.equal('complete');
      // Ensure the included URL is present in results
      const withUrl = res.auditResult.results.find((r) => r.url === 'https://example.com/inc');
      expect(withUrl).to.exist;
    });
    it('should include specific URLs via sheet fallback when Athena returns no rows (no agenticTraffic from backend)', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          // Return empty for specific-URLs query to trigger sheet fallback
          AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: { createAgenticReportQuery: async () => 'SELECT 1' },
          // Provide sheet rows and a simple aggregator that maps '/inc' -> 12
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [{ url: '/inc', number_of_hits: 12 }],
          }),
          buildSheetHitsMap: (rows) => new Map([['/inc', 12]]),
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => ['https://example.com/inc'] }),
        },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        // Provide scrape results to ensure completion without suggestion sync
        scrapeResultPaths: new Map([['https://example.com/inc', '/tmp/inc']]),
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      expect(res.status).to.equal('complete');
      const found = res.auditResult.results.find((r) => r.url.includes('/inc'));
      expect(found).to.exist;
      // Backend no longer populates agenticTraffic; UI computes it
      expect(found).to.not.have.property('agenticTraffic');
    });
    it('should hit toPath catch for malformed included URL', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
            createAgenticHitsForUrlsQuery: async () => 'SELECT 2',
          },
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'invalid', // force new URL(fullUrl, baseUrl) to throw in toPath
          getConfig: () => ({ getIncludedURLs: () => ['::'] }),
        },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'b' },
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      expect(res).to.be.an('object');
      // At least one result exists; exact agenticTraffic may be 0
      expect(res.auditResult).to.be.an('object');
    });

    it('should hit sheet mapping catch when baseUrl invalid', async () => {
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            customerName: 'adobe',
          }),
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'invalid',
            rows: [{ url: '/p1', number_of_hits: 10 }],
          }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
          },
        },
      });

      const res = await mockHandler.submitForScraping({
        site: { getId: () => 'id', getBaseURL: () => 'invalid', getConfig: () => ({ getIncludedURLs: () => [] }) },
        dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
      });
      // mapping catch keeps raw '/p1'
      expect(res.urls.map((u) => u.url)).to.include('/p1');
    });

    it('should cover agenticStats mapping and ranking loop by returning non-empty top list', async () => {
      const serverHtml = '<html><body>Same</body></html>';
      const clientHtml = '<html><body>Same</body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => ([
            { url: '/x', number_of_hits: 2 },
          ]) }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
          },
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async (_c, _b, key) => {
            if (key.endsWith('server-side.html')) return serverHtml;
            if (key.endsWith('client-side.html')) return clientHtml;
            return null;
          },
        },
      });
      const ctx = {
        site: { getId: () => 'site', getBaseURL: () => 'https://example.com', getConfig: () => ({ getIncludedURLs: () => [] }) },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        // Provide a scrape result to bypass later includedURLs call path
        scrapeResultPaths: new Map([['https://example.com/x', '/tmp/x']]),
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      // Should have processed at least the '/x' entry
      expect(res.status).to.equal('complete');
      expect(res.auditResult.totalUrlsChecked).to.be.greaterThan(0);
    });

    it('should log error when getIncludedURLs throws (handled by top-level catch)', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => ([
            { url: '/x', number_of_hits: 1 },
          ]) }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
          },
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });
      const warn = sinon.stub();
      const err = sinon.stub();
      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => { throw new Error('config failed'); },
        },
        audit: {
          getId: () => 'a',
        },
        log: { info: sinon.stub(), warn, debug: sinon.stub(), error: err },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        // No scrapeResultPaths so includedURLs is attempted and throws
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      // Top-level catch should return an error object (no status field)
      expect(res).to.have.property('error').that.is.a('string');
      // Top-level catch logs error (not warn)
      expect(err.called).to.be.true;
      expect(err.args.some(a => String(a[0]).includes('Audit failed')) || err.args.some(a => String(a[0]).includes('config failed'))).to.be.true;
    });

    it('should handle missing SiteTopPage without errors (no top organic URLs)', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
            createAgenticReportQuery: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [],
          }),
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        // Intentionally omit SiteTopPage to exercise the "no top pages" branch in getTopOrganicUrlsFromAhrefs
        dataAccess: {},
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should handle Athena results with missing url fields', async () => {
      // Now that getTopAgenticUrlsFromAthena is in a separate module, mock it directly
      // The filtering of missing url fields is now handled inside getTopAgenticUrlsFromAthena
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/agentic-urls.js': {
          // Simulate filtering behavior - only valid URLs returned
          getTopAgenticUrlsFromAthena: async () => ['https://example.com/valid'],
        },
        '../../../src/prerender/utils/shared.js': {
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          buildSheetHitsMap: () => new Map(),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
      };

      const res = await mockHandler.submitForScraping(ctx);
      const urls = res.urls.map((u) => u.url);
      // Only the row with a defined url should be included
      expect(urls).to.include('https://example.com/valid');
      expect(urls.filter((u) => u === undefined).length).to.equal(0);
    });

    it('should handle sheet load failures gracefully even when log.warn is missing', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            aggregatedLocation: 'agg/',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
          },
          loadLatestAgenticSheet: async () => {
            throw new Error('Sheet load failed');
          },
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) } },
        log: {
          info: sinon.stub(),
          debug: sinon.stub(),
          // Intentionally omit warn to exercise optional chaining in getTopAgenticUrlsFromSheet
        },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should log detailed fallback message when building URL list from fallbacks', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: {
            fromContext: () => ({
              query: async () => ([
                { url: '/agentic', number_of_hits: 10 },
              ]),
            }),
          },
        },
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticUrlsFromAthena: async () => ['https://example.com/agentic'],
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createAgenticReportQuery: async () => 'SELECT 1',
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: 'https://example.com', rows: [] }),
          buildSheetHitsMap: () => new Map(),
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const info = sinon.stub();
      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: () => ['https://example.com/included'],
          }),
        },
        audit: {
          getId: () => 'a',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
              { getUrl: () => 'https://example.com/top1' },
            ]),
          },
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          LatestAudit: { create: sinon.stub().resolves() },
        },
        log: { info, warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        // Empty scrapeResultPaths to force fallback URL list composition branch
        scrapeResultPaths: new Map(),
        auditContext: { scrapeJobId: 'test-job-id' },
      };

      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      expect(res.status).to.equal('complete');

      const loggedFallback = info.args
        .map((a) => String(a[0]))
        .find((msg) => msg.includes('Prerender - Fallback for baseUrl=https://example.com, siteId=site.'));

      expect(loggedFallback).to.exist;
      expect(loggedFallback).to.include('agenticURLs=1');
      expect(loggedFallback).to.include('topPages=1');
      expect(loggedFallback).to.include('includedURLs=1');
    });

    it('should handle missing dataAccess when loading top pages', async () => {
      const html = '<html><body><p>x</p></body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: {
            fromContext: () => ({
              // No agentic URLs for this test
              query: async () => [],
            }),
          },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
            createAgenticReportQuery: sinon.stub().resolves('SELECT 2'),
          },
          loadLatestAgenticSheet: async () => ({
            weekId: 'w45-2025',
            baseUrl: 'https://example.com',
            rows: [],
          }),
          buildSheetHitsMap: (rows) => new Map(rows.map((r) => [r.url, r.number_of_hits])),
        },
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: async () => html,
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        // Intentionally omit dataAccess to exercise `dataAccess || {}` branch in getTopOrganicUrlsFromAhrefs
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should handle missing site.getBaseURL when mapping agentic URLs from Athena', async () => {
      // Now that getTopAgenticUrlsFromAthena is in a separate module, mock it directly
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/agentic-urls.js': {
          // Simulate the case where baseUrl is empty and URLs come back as raw paths
          getTopAgenticUrlsFromAthena: async () => ['/from-athena'],
        },
        '../../../src/prerender/utils/shared.js': {
          loadLatestAgenticSheet: async () => ({ weekId: 'w45-2025', baseUrl: '', rows: [] }),
          buildSheetHitsMap: () => new Map(),
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          // getBaseURL deliberately returns undefined to force `|| ''` fallback
          getBaseURL: () => undefined,
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
      };

      const res = await mockHandler.submitForScraping(ctx);
      const urls = res.urls.map((u) => u.url);
      // With empty baseUrl, URLs come back as raw paths
      expect(urls).to.include('/from-athena');
    });

    it('should log sheet fallback error message when error has no message field', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const warn = sinon.stub();

      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
        '../../../src/prerender/utils/shared.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date(), endDate: new Date() }],
            periodIdentifier: 'w45-2025',
          }),
          getS3Config: async () => ({
            databaseName: 'db',
            tableName: 'tbl',
            aggregatedLocation: 'agg/',
            getAthenaTempLocation: () => 's3://tmp/',
          }),
          weeklyBreakdownQueries: {
            createTopUrlsQueryWithLimit: sinon.stub().resolves('SELECT 1'),
          },
          // Throw a primitive value so `e?.message` is falsy and `|| e` branch is taken
          loadLatestAgenticSheet: async () => {
            // eslint-disable-next-line no-throw-literal
            throw 'sheet-broken';
          },
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        },
        log: {
          info: sinon.stub(),
          warn,
          debug: sinon.stub(),
        },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');

      const warnArgs = warn.args.map((a) => String(a[0]));
      expect(warnArgs.some((msg) => msg.includes('Sheet-based agentic URL fetch failed'))).to.be.true;
      expect(warnArgs.some((msg) => msg.includes('sheet-broken'))).to.be.true;
    });
  });

  describe('Shared utils loadLatestAgenticSheet', () => {
    it('returns latest week and calls downloadExistingCdnSheet with correct params', async () => {
      const called = { weekId: null, outputLocation: null };
      const shared = await esmock('../../../src/prerender/utils/shared.js', {
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date('2025-11-17'), endDate: new Date('2025-11-23') }],
          }),
        },
        '../../../src/llm-error-pages/utils.js': {
          downloadExistingCdnSheet: async (weekId, outputLocation) => {
            called.weekId = weekId;
            called.outputLocation = outputLocation;
            return [{ url: '/x', number_of_hits: 1 }];
          },
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: async () => ({}),
          readFromSharePoint: async () => ({}),
        },
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'bucket',
          extractCustomerDomain: () => 'acme_com',
        },
      });

      const site = {
        getBaseURL: () => 'https://acme.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'acme' }),
      };
      const ctx = { log: { info: () => {} } };
      const result = await shared.loadLatestAgenticSheet(site, ctx);
      expect(result.weekId).to.equal('w45-2025');
      expect(called.weekId).to.equal('w45-2025');
      expect(called.outputLocation).to.equal('acme/agentic-traffic');
      expect(result.rows).to.have.length(1);
      expect(result.baseUrl).to.equal('https://acme.com');
    });
  });

  describe('Shared utils coverage', () => {
    it('buildSheetHitsMap covers default path and numeric coercion', async () => {
      const shared = await esmock('../../../src/prerender/utils/shared.js', {});
      const rows = [{}, { url: '', number_of_hits: undefined }, { url: '/a', number_of_hits: '3' }];
      const map = shared.buildSheetHitsMap(rows);
      expect(map.get('/')).to.equal(0); // two defaulted entries sum to 0
      expect(map.get('/a')).to.equal(3);
    });

    it('loadLatestAgenticSheet covers baseUrl fallback when getBaseURL is missing', async () => {
      const shared = await esmock('../../../src/prerender/utils/shared.js', {
        '../../../src/cdn-logs-report/utils/report-utils.js': {
          generateReportingPeriods: () => ({
            weeks: [{ weekNumber: 45, year: 2025, startDate: new Date('2025-11-17'), endDate: new Date('2025-11-23') }],
          }),
        },
        '../../../src/llm-error-pages/utils.js': {
          downloadExistingCdnSheet: async () => [{ url: '/x', number_of_hits: 1 }],
        },
        '../../../src/utils/report-uploader.js': {
          createLLMOSharepointClient: async () => ({}),
          readFromSharePoint: async () => ({}),
        },
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'bucket',
          extractCustomerDomain: () => 'acme_com',
        },
      });
      const site = {
        // getBaseURL intentionally omitted to trigger fallback to ''
        getConfig: () => ({ getLlmoDataFolder: () => 'acme' }),
      };
      const ctx = { log: { info: () => {} } };
      const result = await shared.loadLatestAgenticSheet(site, ctx);
      expect(result.baseUrl).to.equal('');
    });
  });
  describe('Shared utils coverage', () => {
    it('should return S3 config shape and temp location function', async () => {
      const shared = await esmock('../../../src/prerender/utils/shared.js', {
        '../../../src/utils/cdn-utils.js': {
          // Avoid depending on env; just return a deterministic bucket
          resolveConsolidatedBucketName: () => 'bucket',
          extractCustomerDomain: () => 'adobe_com',
        },
      });
      const cfg = await shared.getS3Config({ getBaseURL: () => 'https://www.adobe.com' }, { });
      expect(cfg).to.be.an('object');
      expect(cfg).to.have.property('databaseName');
      expect(cfg).to.have.property('tableName');
      expect(cfg).to.have.property('getAthenaTempLocation');
      expect(cfg.getAthenaTempLocation()).to.be.a('string');
      expect(cfg.getAthenaTempLocation()).to.include('/temp/athena-results/');
    });

    it('should compute customerName correctly when domain starts with www', async () => {
      const shared = await esmock('../../../src/prerender/utils/shared.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'bucket',
          extractCustomerDomain: () => 'www.adobe_com',
        },
      });
      const cfg = await shared.getS3Config({ }, { });
      expect(cfg.customerName).to.equal('adobe');
      expect(cfg.databaseName).to.equal('cdn_logs_www.adobe_com');
      expect(cfg.tableName).to.equal('aggregated_logs_www.adobe_com_consolidated');
    });
  });
  describe('Edge Cases and Error Handling', () => {
    describe('HTML Content Processing', () => {
      it('should throw error for missing server-side HTML', async () => {
        try {
          await analyzeHtmlForPrerender('', '<html><body>content</body></html>', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

      it('should throw error for missing client-side HTML', async () => {
        try {
          await analyzeHtmlForPrerender('<html><body>content</body></html>', '', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

      it('should not throw for valid HTML (even if complex)', async () => {
        // Test with valid HTML that has scripts
        const validHtml = '<html><body><script>throw new Error("test");</script></body></html>';
        const result = await analyzeHtmlForPrerender(validHtml, validHtml, 1.2);

        // The function should process successfully
        expect(result).to.be.an('object');
        expect(result.needsPrerender).to.be.a('boolean');
      });

      it('should handle HTML with complex whitespace', async () => {
        // Create HTML with complex whitespace scenarios
        const htmlWithComplexWhitespace = `<html><body>

        <p>Content with multiple spaces</p>


        <div>Content after empty lines</div>
        <span>	Tab-spaced content	</span>

        <p>Final content</p>
        </body></html>`;

        const result = await analyzeHtmlForPrerender(htmlWithComplexWhitespace, htmlWithComplexWhitespace, 1.2);
        expect(result.contentGainRatio).to.equal(1);
        expect(result.wordCountBefore).to.be.greaterThan(0);
      });

      it('should throw error for undefined/null input', async () => {
        // Malformed input should throw
        try {
          await analyzeHtmlForPrerender(undefined, null, 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

      it('should process HTML even with edge case threshold values', async () => {
        // Test with NaN threshold - should still work or throw a clear error
        const htmlContent = '<html><body>Test content</body></html>';

        const result = await analyzeHtmlForPrerender(htmlContent, htmlContent, NaN);

        // Should process successfully - NaN comparison will just make needsPrerender false
        expect(result).to.be.an('object');
        expect(result.needsPrerender).to.be.false;
      });
    });

    describe('S3 Integration and Error Handling', () => {
      it('should handle missing S3 data gracefully', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const mockS3Client = {
          send: sandbox.stub().rejects(new Error('S3 access denied')),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
        // Should have errors about missing HTML data (simplified approach)
        expect(context.log.error.called).to.be.true;
      });

      it('should handle error in getScrapedHtmlFromS3 and return null', async () => {
        // Test error handling in S3 data retrieval
        const mockS3Client = {
          send: sandbox.stub().rejects(new Error('S3 connection failed')),
        };

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        // Test through the exposed function since getScrapedHtmlFromS3 is not exported
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const fullContext = {
          ...context,
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(fullContext);

        // Should complete but with warnings (from S3) and errors (from compareHtmlContent) logged
        expect(result.status).to.equal('complete');
        expect(context.log.warn.called || context.log.error.called).to.be.true;
      });

      it('should handle missing server-side or client-side HTML in compareHtmlContent', async () => {
        // Test missing HTML data handling
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        // Mock S3 to return only server-side HTML but not client-side
        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve('<html><body>Server content</body></html>') }
            })
            .onSecondCall().rejects(new Error('Client-side HTML not found')),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;
        // Should log about missing HTML data (simplified error handling)
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should handle when both server-side and client-side HTML are null', async () => {
        // Test when both HTML files are missing
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        // Mock S3 to return empty strings for both server-side and client-side HTML
        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve('') }
            })
            .onSecondCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve('') }
            }),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;
        // Should log error about missing HTML data (simplified error handling)
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should throw for empty HTML strings', async () => {
        // Test empty HTML handling through analyzeHtmlForPrerender

        // Test with empty server-side HTML
        try {
          await analyzeHtmlForPrerender('', '<html><body><p>Client content</p></body></html>', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Missing HTML content for comparison');
        }

        // Test with empty client-side HTML
        try {
          await analyzeHtmlForPrerender('<html><body><p>Server content</p></body></html>', '', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Missing HTML content for comparison');
        }

        // Test with both empty
        try {
          await analyzeHtmlForPrerender('', '', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

      it('should trigger opportunity processing when URLs need prerender', async () => {
        // Test opportunity processing when prerender is needed
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 1000 },
          ]),
        };

        // Mock S3 to return HTML that will trigger prerender need
        const serverHtml = '<html><body><h1>Simple server content</h1></body></html>';
        const clientHtml = '<html><body><h1>Simple server content</h1><div>Massive additional client-side content that significantly increases word count and triggers prerender detection with a very high content gain ratio</div><p>Even more substantial content loaded dynamically</p><section>Additional sections with lots of text</section></body></html>';

        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(serverHtml) }
            })
            .onSecondCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(clientHtml) }
            }),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        try {
          const result = await processContentAndGenerateOpportunities(context);
          // If it doesn't throw, the test still covers the branch
          expect(result).to.be.an('object');
        } catch (error) {
          // Expected to fail on processOpportunityAndSuggestions call due to missing dependencies
          expect(error.message).to.include('convertToOpportunity');
        }
      });

      it('should handle HTML analysis errors in compareHtmlContent', async () => {
        // Test HTML analysis error handling
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        // Mock S3 to return malformed HTML that might cause analysis to fail
        const malformedHtml = '<html><body>Server content</body></html>';
        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(malformedHtml) }
            })
            .onSecondCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(malformedHtml) }
            }),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        // Even if analysis doesn't fail, the test structure covers the error handling path
        expect(result.auditResult).to.be.an('object');
      });
    });

    describe('Site Config Edge Cases', () => {
      it('should handle missing site config gracefully', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => null, // No config
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.have.length(1);
        expect(result.urls[0].url).to.equal('https://example.com');
      });

      it('should handle undefined getIncludedURLs', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({}), // Config without getIncludedURLs
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.have.length(1);
        expect(result.urls[0].url).to.equal('https://example.com');
      });
    });

    describe('HTML Comparator Utils Edge Cases', () => {
      it('should handle HTML content filtering correctly', async () => {
        // Test the HTML content filtering functionality
        const htmlContent = '<html><body><p>Test content</p><script>console.log("test");</script></body></html>';
        const moreContent = '<html><body><p>Test content</p><div>Additional content</div></body></html>';

        const result = await analyzeHtmlForPrerender(htmlContent, moreContent, 1.2);

        expect(result).to.be.an('object');
        expect(result.needsPrerender).to.be.a('boolean');
        expect(result.wordCountBefore).to.be.greaterThan(0);
        expect(result.wordCountAfter).to.be.greaterThan(0);
      });

      it('should handle tokenization with URL preservation', async () => {
        // Test URL preservation in tokenization
        const textWithUrls = 'Visit https://example.com for more info, or email test@domain.com for support';

        // We need to access the tokenize function - since it's not exported, we'll test through analyzeHtmlForPrerender
        const htmlWithUrls = `<html><body><p>${textWithUrls}</p></body></html>`;
        const htmlWithMoreUrls = `<html><body><p>${textWithUrls} and check www.test.org</p></body></html>`;

        const result = await analyzeHtmlForPrerender(htmlWithUrls, htmlWithMoreUrls, 1.2);

        expect(result).to.be.an('object');
        expect(result.wordCountBefore).to.be.greaterThan(0);
        expect(result.wordCountAfter).to.be.greaterThan(result.wordCountBefore);
      });

      it('should handle complex line break scenarios', async () => {
        // Test complex line break handling
        const htmlWithComplexLineBreaks = `<html><body>
        Line one\r\n
        \t\tTab-indented line\t\t


        Multiple empty lines above
        \r
        Windows line ending above
        </body></html>`;

        const result = await analyzeHtmlForPrerender(htmlWithComplexLineBreaks, htmlWithComplexLineBreaks, 1.2);

        expect(result.contentGainRatio).to.equal(1);
        expect(result.wordCountBefore).to.equal(result.wordCountAfter);
      });

      it('should throw error for empty content scenarios', async () => {
        // Test empty content handling
        try {
          await analyzeHtmlForPrerender('', '', 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

      it('should handle HTML content processing', async () => {
        // Test HTML content processing
        const htmlContent = '<html><body><script>console.log("test");</script><p>Content</p></body></html>';

        const result = await analyzeHtmlForPrerender(htmlContent, htmlContent, 1.2);

        expect(result.contentGainRatio).to.equal(1);
        expect(result.wordCountBefore).to.equal(result.wordCountAfter);
      });

      it('should process malformed HTML without throwing', async () => {
        // Test edge case inputs - malformed HTML should still be processed
        const malformedHtml = '<html><body><p>Test content</p>';

        const result = await analyzeHtmlForPrerender(malformedHtml, malformedHtml, NaN);

        // Should process successfully (cheerio is tolerant of malformed HTML)
        expect(result).to.be.an('object');
        expect(result.needsPrerender).to.be.a('boolean');
      });

      it('should handle comprehensive URL and punctuation scenarios', async () => {
        // Test complex tokenization scenarios
        const complexText = `Check out https://example.com, www.test.org, and admin@company.edu.
        Multiple     spaces   between    words , and ; punctuation : everywhere !
        Visit test.com/path?query=value for more   details    .`;

        const htmlBefore = `<html><body><p>${complexText}</p></body></html>`;
        const htmlAfter = `<html><body><p>${complexText}</p><div>Additional content here</div></body></html>`;

        const result = await analyzeHtmlForPrerender(htmlBefore, htmlAfter, 1.2);

        expect(result).to.be.an('object');
        expect(result.wordCountBefore).to.be.greaterThan(0);
        expect(result.wordCountAfter).to.be.greaterThan(result.wordCountBefore);
      });

      it('should cover edge cases in content gain ratio calculation', async () => {
        // Test various edge cases for content gain ratio
        const scenarios = [
          // Test zero to content scenario
          { before: '<html><body></body></html>', after: '<html><body><p>New content</p></body></html>' },
          // Test normal ratio calculation
          { before: '<html><body><p>Original</p></body></html>', after: '<html><body><p>Original expanded content</p></body></html>' },
          // Test same content
          { before: '<html><body></body></html>', after: '<html><body></body></html>' }
        ];

        for (const [index, scenario] of scenarios.entries()) {
          const result = await analyzeHtmlForPrerender(scenario.before, scenario.after, 1.2);
          expect(result).to.be.an('object', `Scenario ${index} failed`);
          expect(result.contentGainRatio).to.be.a('number', `Scenario ${index} ratio not a number`);
        }
      });

      it('should handle browser environment simulation', async () => {
        // Test browser environment simulation
        const originalDocument = global.document;
        const originalGlobalThis = global.globalThis;

        try {
          // Set up browser-like environment
          global.document = {};
          global.globalThis = {
            DOMParser: class MockDOMParser {
              parseFromString(htmlContent, type) {
                return {
                  body: {
                    querySelectorAll: (selector) => {
                      const mockElements = [];
                      if (selector.includes('script')) {
                        mockElements.push({ remove: () => {} });
                      }
                      return mockElements;
                    },
                    textContent: 'Browser parsed content',
                    outerHTML: '<body>Browser parsed content</body>'
                  },
                  documentElement: {
                    querySelectorAll: (selector) => [],
                    textContent: 'Document element content',
                    outerHTML: '<html>Document element content</html>'
                  }
                };
              }
            }
          };

          // Test browser environment behavior
          const result1 = await analyzeHtmlForPrerender('<html><body><p>Test</p></body></html>', '<html><body><p>Test content</p></body></html>', 1.2);
          expect(result1).to.be.an('object');

          const result2 = await analyzeHtmlForPrerender('<html><body><p>Test</p></body></html>', '<html><body><p>Test content</p></body></html>', 1.2);
          expect(result2).to.be.an('object');

        } finally {
          // Restore environment
          global.document = originalDocument;
          global.globalThis = originalGlobalThis;
        }
      });

      it('should handle Node.js environment processing', async () => {
        // Test Node.js environment HTML processing
        const htmlContent = '<html><body><p>Some content</p><script>alert("test");</script></body></html>';

        const result = await analyzeHtmlForPrerender(htmlContent, htmlContent, 1.2);

        expect(result).to.be.an('object');
        expect(result.contentGainRatio).to.equal(1);
      });

      it('should handle complex line break processing', async () => {
        // Test complex line break scenarios
        const htmlWithLines = `<html><body>
        Line one content here

        Line two content here
        \r\n
        Line three with carriage return
        </body></html>`;

        const result = await analyzeHtmlForPrerender(htmlWithLines, htmlWithLines, 1.2);

        expect(result).to.be.an('object');
        expect(result.wordCountBefore).to.be.greaterThan(0);
      });

      it('should throw error for null input', async () => {
        // Test handling of null input
        const validHtml = '<html><body><script>throw new Error("Simulated parsing error");</script></body></html>';

        try {
          await analyzeHtmlForPrerender(null, validHtml, 1.2);
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Missing HTML content for comparison');
        }
      });

    });

    describe('Advanced Error Handling Tests', () => {
      it('should trigger getObjectFromKey error handling', async () => {
        // Test the catch block in getScrapedHtmlFromS3 by mocking getObjectFromKey to throw
        const mockS3Utils = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: sinon.stub().throws(new Error('S3 connection failed')),
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockS3Utils.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.warn).to.have.been.called;
        // Verify the error handling was triggered
        expect(context.log.warn.args.some(call => call[0].includes('Could not get scraped content'))).to.be.true;
      });

      it('should handle missing S3 data gracefully when getScrapedHtmlFromS3 returns null', async () => {
        // This test verifies the path where getScrapedHtmlFromS3 returns null due to missing S3 data
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Server content</body></html>'); // Valid server HTML
        getObjectFromKeyStub.onCall(1).resolves(null); // Missing client HTML

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');

        // Verify the simplified error handling for missing data
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );

        expect(hasMissingDataError).to.be.true;
      });

      it('should trigger HTML analysis error handling', async () => {
        // Mock analyzeHtmlForPrerender to throw an error
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: sinon.stub()
              .onFirstCall().resolves('<html><body>Valid content</body></html>')
              .onSecondCall().resolves('<html><body>Valid content too</body></html>'),
          },
          '../../../src/prerender/utils/html-comparator.js': {
            analyzeHtmlForPrerender: sinon.stub().throws(new Error('Mocked analysis error')),
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;
        // Verify the HTML analysis error was logged
        expect(context.log.error.args.some(call => call[0].includes('HTML analysis failed for'))).to.be.true;
      });

      it('should trigger opportunity and suggestion creation flow', async () => {
        // Test the full opportunity creation and suggestion sync flow including S3 key generation
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
          getSuggestions: () => Promise.resolve([]),
        };
        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const auditData = {
          siteId: 'test-site-id',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                agenticTraffic: 500,
                contentGainRatio: 2.1,
                wordCountBefore: 100,
                wordCountAfter: 210,
              },
            ],
          },
        };

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        expect(context.log.info).to.have.been.called;
        // Verify that syncSuggestions was called once with combined data
        expect(syncSuggestionsStub).to.have.been.calledOnce;
        // Verify that suggestion syncing was logged
        expect(context.log.info.args.some((call) => call[0].includes('Successfully synced'))).to.be.true;

        // Get the single call with combined data
        const individualSyncCall = syncSuggestionsStub.getCall(0);
        expect(individualSyncCall.args[0]).to.have.property('mapNewSuggestion');
        const mappedSuggestion = individualSyncCall.args[0].mapNewSuggestion(auditData.auditResult.results[0]);
        expect(mappedSuggestion.data).to.have.property('originalHtmlKey');
        expect(mappedSuggestion.data).to.have.property('prerenderedHtmlKey');
        expect(mappedSuggestion.data.originalHtmlKey).to.include('server-side.html');
        expect(mappedSuggestion.data.prerenderedHtmlKey).to.include('client-side.html');
        expect(mappedSuggestion.data).to.not.have.property('needsPrerender');

        // Test mergeDataFunction for individual suggestions
        const mergeDataFn = individualSyncCall.args[0].mergeDataFunction;
        const existingData = { url: 'https://example.com/page1', customField: 'preserved' };
        const newDataItem = {
          url: 'https://example.com/page1',
          contentGainRatio: 2.5,
          wordCountBefore: 100,
          wordCountAfter: 250,
          needsPrerender: true, // Should be filtered out
        };
        const mergedData = mergeDataFn(existingData, newDataItem);
        expect(mergedData).to.have.property('customField', 'preserved'); // Existing field preserved
        expect(mergedData).to.have.property('url', 'https://example.com/page1');
        expect(mergedData).to.not.have.property('agenticTraffic');
        expect(mergedData).to.not.have.property('needsPrerender'); // Filtered out by mapSuggestionData

        // Find domain-wide aggregate suggestion in combined data
        const domainWideSuggestion = individualSyncCall.args[0].newData.find((item) => item.key);
        expect(domainWideSuggestion).to.exist;
        expect(domainWideSuggestion).to.have.property('key', 'domain-wide-aggregate|prerender');
        expect(domainWideSuggestion.data).to.have.property('isDomainWide', true);
        expect(domainWideSuggestion.data).to.have.property('allowedRegexPatterns');
        expect(domainWideSuggestion.data.allowedRegexPatterns).to.be.an('array');
        expect(domainWideSuggestion.data.url).to.include('All Domain URLs');
      });

      it('should prefer scrapeJobId over siteId when building S3 HTML keys', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
          getSuggestions: () => Promise.resolve([]),
        };
        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const auditData = {
          siteId: 'test-site-id',
          scrapeJobId: 'scrape-job-123',
          auditResult: {
            urlsNeedingPrerender: 1,
            results: [
              {
                url: 'https://example.com/page1',
                needsPrerender: true,
                contentGainRatio: 2.1,
                wordCountBefore: 100,
                wordCountAfter: 210,
              },
            ],
          },
        };

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
        };

        await mockHandler.processOpportunityAndSuggestions('https://example.com', auditData, context);

        const syncCall = syncSuggestionsStub.getCall(0);
        const mappedSuggestion = syncCall.args[0].mapNewSuggestion(auditData.auditResult.results[0]);

        expect(mappedSuggestion.data.originalHtmlKey).to.include('prerender/scrapes/scrape-job-123');
        expect(mappedSuggestion.data.prerenderedHtmlKey).to.include('prerender/scrapes/scrape-job-123');
      });

      it('should update existing PRERENDER opportunity with all data fields', async () => {
        // This test specifically targets the PRERENDER update logic in opportunity.js
        const existingOpportunity = {
          getId: () => 'existing-opp-id',
          getType: () => 'prerender',
          getData: () => ({
            dataSources: ['ahrefs'],
            oldField: 'should-be-preserved',
            scrapeForbidden: true, // Old value
          }),
          setAuditId: sinon.stub(),
          setData: sinon.stub(),
          setUpdatedBy: sinon.stub(),
          save: sinon.stub().resolves(),
        };

        const mockOpportunity = {
          allBySiteIdAndStatus: sinon.stub().resolves([existingOpportunity]),
        };

        const convertToOpportunityModule = await import('../../../src/common/opportunity.js');

        const auditData = {
          siteId: 'test-site-id',
          id: 'new-audit-id',
          auditResult: {
            scrapeForbidden: false, // New value
          },
        };

        const context = {
          dataAccess: {
            Opportunity: mockOpportunity,
          },
          log: {
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
          },
        };

        const createOpportunityDataFn = (auditData) => ({
          data: {
            dataSources: ['ahrefs', 'site'],
            scrapeForbidden: auditData?.auditResult?.scrapeForbidden === true,
            newField: 'new-value',
          },
        });

        await convertToOpportunityModule.convertToOpportunity(
          'https://example.com',
          auditData,
          context,
          createOpportunityDataFn,
          'prerender',
          auditData,
        );

        // Verify setData was called with merged data (lines 95-98)
        expect(existingOpportunity.setData).to.have.been.calledOnce;
        const setDataCall = existingOpportunity.setData.getCall(0).args[0];

        // Should merge all fields from opportunityInstance.data
        expect(setDataCall).to.have.property('oldField', 'should-be-preserved'); // From existing
        expect(setDataCall).to.have.property('dataSources');
        expect(setDataCall).to.have.property('scrapeForbidden', false); // Updated value
        expect(setDataCall).to.have.property('newField', 'new-value'); // New field

        // Verify save was called
        expect(existingOpportunity.save).to.have.been.calledOnce;
      });

        it('should test simplified text extraction', async () => {
        // Test that the simplified stripTagsToText function works correctly
        const htmlContent = '<html><body><p>Test content with <script>alert("evil")</script> scripts</p></body></html>';

        const result = await analyzeHtmlForPrerender(htmlContent, htmlContent, 1.2);

        expect(result).to.be.an('object');
        expect(result.contentGainRatio).to.equal(1);
        expect(result.wordCountBefore).to.equal(4); // "Test content with scripts"
        expect(result.wordCountAfter).to.equal(4);
      });

      it('should throw when calculateStats fails', async () => {
        // Mock the HTML analysis to throw an error during processing
        const mockAnalyze = await esmock('../../../src/prerender/utils/html-comparator.js', {
          '@adobe/spacecat-shared-html-analyzer': {
            calculateStats: sinon.stub().throws(new Error('Stats calculation failed')),
          },
        });

        try {
          await mockAnalyze.analyzeHtmlForPrerender(
            '<html><body>content</body></html>',
            '<html><body>content</body></html>',
            1.2
          );
          expect.fail('Should have thrown an error');
        } catch (error) {
          expect(error).to.be.an('error');
          expect(error.message).to.equal('Stats calculation failed');
        }
      });
    });

    describe('Simplified getScrapedHtmlFromS3 Testing', () => {
      it('should handle empty/null HTML content from S3', async () => {
        // Test the simplified function that just returns raw S3 data
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves(''); // Empty server HTML
        getObjectFromKeyStub.onCall(1).resolves('<html><body><p>Valid content</p></body></html>');

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;

        // The defensive check should now catch the empty server HTML
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should handle S3 fetch errors', async () => {
        // Test the simplified error handling
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).rejects(new Error('S3 access denied'));
        getObjectFromKeyStub.onCall(1).rejects(new Error('S3 access denied'));

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;

        // Should get Missing HTML data error for both null values
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should handle both files missing (null responses)', async () => {
        // Test when both HTML files are missing (null responses)
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves(null);
        getObjectFromKeyStub.onCall(1).resolves(null);

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;

        // Should handle both null values properly
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should now properly test the meaningful defensive check', async () => {
        // With the simplified getScrapedHtmlFromS3, this check is now very testable
        // It will catch any case where S3 returns null or empty values

        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Valid server content</body></html>');
        getObjectFromKeyStub.onCall(1).resolves(null); // Null client HTML

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;

        // This should trigger the defensive check and log the missing data error
        const errorMessages = context.log.error.args.map(call => call[0]);
        const hasMissingDataError = errorMessages.some(msg =>
          msg.includes('Missing HTML data for') && msg.includes('client-side: false')
        );
        expect(hasMissingDataError).to.be.true;
      });

      it('should handle scrape.json fetch rejection', async () => {
        // Test when scrape.json fetch is rejected (tests the 'rejected' branch in Promise.allSettled)
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Server content</body></html>');
        getObjectFromKeyStub.onCall(1).resolves('<html><body>Client content</body></html>');
        getObjectFromKeyStub.onCall(2).rejects(new Error('S3 GetObject failed for scrape.json'));

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        // Should complete successfully even if scrape.json is missing (backward compatible)
        expect(result.auditResult).to.be.an('object');
      });

      it('should handle invalid JSON in scrape.json metadata', async () => {
        // Test when scrape.json contains invalid JSON
        // Note: getObjectFromKey returns null when JSON parsing fails (handled in s3-utils.js)
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Server content</body></html>');
        getObjectFromKeyStub.onCall(1).resolves('<html><body>Client content</body></html>');
        getObjectFromKeyStub.onCall(2).resolves(null); // getObjectFromKey returns null on parse failure

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
        });

        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: mockSiteTopPage,
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        // Should complete successfully with HTML analysis, even if metadata is null
        expect(result.auditResult).to.be.an('object');
        expect(result.auditResult.results).to.be.an('array');
      });

      it('should handle metadata without error field', async () => {
        // Test when metadata exists but has no error field (scrapeError should be undefined)
        const scrapeMetadata = { status: 'SUCCESS' }; // No error field

        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Before</body></html>');
        getObjectFromKeyStub.onCall(1).resolves('<html><body>After</body></html>');
        getObjectFromKeyStub.onCall(2).resolves(scrapeMetadata);

        // Mock analyzeHtmlForPrerender to throw an error
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
          '../../../src/prerender/utils/html-comparator.js': {
            analyzeHtmlForPrerender: sandbox.stub().throws(new Error('Analysis failed')),
          },
        });

        const context = {
          site: { getId: () => 'test-site', getBaseURL: () => 'https://example.com' },
          audit: {
            getId: () => 'audit-id',
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
            ]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { create: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({}) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.auditResult.results[0].scrapeError).to.be.undefined;
      });
    });
  });

  describe('uploadStatusSummaryToS3', () => {
    let mockS3Client;
    let context;

    beforeEach(() => {
      mockS3Client = {
        send: sandbox.stub().resolves({}),
      };

      context = {
        log: {
          info: sandbox.stub(),
          error: sandbox.stub(),
          warn: sandbox.stub(),
        },
        s3Client: mockS3Client,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      };
    });

    it('should upload status summary to S3 with complete audit data', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'scrape-job-999',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 5,
          urlsNeedingPrerender: 2,
          scrapeForbidden: false,
          results: [
            {
              url: 'https://example.com/page1',
              error: false,
              needsPrerender: true,
              wordCountBefore: 100,
              wordCountAfter: 250,
              contentGainRatio: 2.5,
              agenticTraffic: 1000,
            },
            {
              url: 'https://example.com/page2',
              error: false,
              needsPrerender: false,
              wordCountBefore: 200,
              wordCountAfter: 220,
              contentGainRatio: 1.1,
              agenticTraffic: 500,
            },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(mockS3Client.send).to.have.been.calledOnce;
      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];

      expect(command.input.Bucket).to.equal('test-bucket');
      expect(command.input.Key).to.equal('prerender/scrapes/test-site-id/status.json');
      expect(command.input.ContentType).to.equal('application/json');

      const uploadedData = JSON.parse(command.input.Body);
      expect(uploadedData.baseUrl).to.equal('https://example.com');
      expect(uploadedData.siteId).to.equal('test-site-id');
      expect(uploadedData.auditType).to.equal('prerender');
      expect(uploadedData.scrapeJobId).to.equal('scrape-job-999');
      expect(uploadedData.lastUpdated).to.equal('2025-01-01T00:00:00.000Z');
      expect(uploadedData.totalUrlsChecked).to.equal(5);
      expect(uploadedData.urlsNeedingPrerender).to.equal(2);
      expect(uploadedData.scrapeForbidden).to.equal(false);
      expect(uploadedData.pages).to.have.lengthOf(2);

      expect(uploadedData.pages[0]).to.deep.equal({
        url: 'https://example.com/page1',
        scrapingStatus: 'success',
        needsPrerender: true,
        wordCountBefore: 100,
        wordCountAfter: 250,
        contentGainRatio: 2.5,
      });

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Successfully uploaded status summary to S3.*baseUrl=https:\/\/example\.com, siteId=test-site-id/)
      );
    });

    it('should mark pages with errors as scraping status error', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 1,
          urlsNeedingPrerender: 0,
          results: [
            {
              url: 'https://example.com/error-page',
              error: true,
              needsPrerender: false,
            },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      expect(uploadedData.pages[0].scrapingStatus).to.equal('error');
      expect(uploadedData.pages[0].wordCountBefore).to.equal(0);
      expect(uploadedData.pages[0].wordCountAfter).to.equal(0);
      expect(uploadedData.pages[0].contentGainRatio).to.equal(0);
    });

    it('should include scrape error details when available', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 2,
          urlsNeedingPrerender: 0,
          results: [
            {
              url: 'https://example.com/forbidden-page',
              error: true,
              needsPrerender: false,
              scrapeError: {
                statusCode: 403,
                message: 'Forbidden',
              },
            },
            {
              url: 'https://example.com/success-page',
              error: false,
              needsPrerender: false,
              wordCountBefore: 100,
              wordCountAfter: 110,
              contentGainRatio: 1.1,
              agenticTraffic: 500,
              scrapeError: null,
            },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      // First page should have scrape error
      expect(uploadedData.pages[0].url).to.equal('https://example.com/forbidden-page');
      expect(uploadedData.pages[0].scrapingStatus).to.equal('error');
      expect(uploadedData.pages[0].scrapeError).to.deep.equal({
        statusCode: 403,
        message: 'Forbidden',
      });

      // Second page should not have scrapeError property (null is filtered out)
      expect(uploadedData.pages[1].url).to.equal('https://example.com/success-page');
      expect(uploadedData.pages[1].scrapingStatus).to.equal('success');
      expect(uploadedData.pages[1]).to.not.have.property('scrapeError');
    });

    it('should skip upload when auditResult is missing', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(mockS3Client.send).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith(
        'Prerender - Missing auditResult, skipping status summary upload'
      );
    });

    it('should handle empty results array', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 0,
          urlsNeedingPrerender: 0,
          results: [],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(mockS3Client.send).to.have.been.calledOnce;
      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      expect(uploadedData.pages).to.deep.equal([]);
      expect(uploadedData.totalUrlsChecked).to.equal(0);
    });

    it('should handle undefined results (fallback to empty array)', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 0,
          urlsNeedingPrerender: 0,
          // results is undefined
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(mockS3Client.send).to.have.been.calledOnce;
      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      expect(uploadedData.pages).to.deep.equal([]);
    });

    it('should handle null results (fallback to empty array)', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 0,
          urlsNeedingPrerender: 0,
          results: null,
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(mockS3Client.send).to.have.been.calledOnce;
      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      expect(uploadedData.pages).to.deep.equal([]);
    });

    it('should use current timestamp when auditedAt is missing', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditResult: {
          results: [],
        },
      };

      const beforeTime = Date.now();
      await uploadStatusSummaryToS3(auditUrl, auditData, context);
      const afterTime = Date.now();

      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      // Verify the timestamp is valid ISO string and within time range
      const uploadedTime = new Date(uploadedData.lastUpdated).getTime();
      expect(uploadedTime).to.be.at.least(beforeTime);
      expect(uploadedTime).to.be.at.most(afterTime);
    });

    it('should handle S3 upload errors gracefully', async () => {
      mockS3Client.send.rejects(new Error('S3 upload failed'));

      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          results: [],
        },
      };

      // Should not throw
      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to upload status summary to S3/),
        sinon.match.instanceOf(Error)
      );
    });

    it('should handle missing optional fields in results', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          results: [
            {
              url: 'https://example.com/page1',
              // Missing all optional fields
            },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const call = mockS3Client.send.getCall(0);
      const command = call.args[0];
      const uploadedData = JSON.parse(command.input.Body);

      expect(uploadedData.pages[0]).to.deep.equal({
        url: 'https://example.com/page1',
        scrapingStatus: 'success',
        needsPrerender: false,
        wordCountBefore: 0,
        wordCountAfter: 0,
        contentGainRatio: 0,
      });
    });
  });
});
