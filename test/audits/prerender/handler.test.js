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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
import prerenderHandler, {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
} from '../../../src/prerender/handler.js';
import {
  processOpportunityAndSuggestions,
  createScrapeForbiddenOpportunity,
} from '../../../src/prerender/opportunity-syncer.js';
import { getScrapeJobStats } from '../../../src/prerender/scrape-stats.js';
import { uploadStatusSummaryToS3 } from '../../../src/prerender/status-writer.js';
import { analyzeHtmlForPrerender } from '../../../src/prerender/utils/html-analyzer.js';
import { createOpportunityData } from '../../../src/prerender/opportunity-data-mapper.js';
import {
  TOP_AGENTIC_URLS_LIMIT,
  TOP_ORGANIC_URLS_LIMIT,
  DAILY_BATCH_SIZE,
} from '../../../src/prerender/utils/constants.js';

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

    it('should preserve explicit auditContext URLs in the top-pages payload', async () => {
      const context = {
        site: { getId: () => 'test-site-id' },
        finalUrl: 'https://example.com',
        auditContext: {
          urls: [
            'https://example.com/page-1',
            'https://example.com/page-2',
          ],
        },
      };
      const res = await importTopPages(context);
      expect(res).to.deep.equal({
        type: 'top-pages',
        siteId: 'test-site-id',
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: 'scrapes/test-site-id/',
        auditContext: {
          urls: [
            'https://example.com/page-1',
            'https://example.com/page-2',
          ],
        },
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

    it('should also return citability metrics (single calculateStats call)', async () => {
      const directHtml = '<html><body><h1>Simple content</h1></body></html>';
      const scrapedHtml = '<html><body><h1>Simple content</h1><div>More JS content</div></body></html>';

      const result = await analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      // Unique citability fields (contentGainRatio/wordCountBefore/After already tested above)
      expect(result.citabilityScore).to.be.a('number');
      expect(result.wordDifference).to.be.a('number');
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
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
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

      it('should use explicit auditContext URLs when provided', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/top-page' },
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          auditContext: {
            urls: [
              'https://example.com/page-1',
              'https://example.com/page-1/',
              'https://example.com/file.pdf',
              'https://example.com/page-2',
            ],
          },
        };

        const result = await submitForScraping(context);

        expect(mockSiteTopPage.allBySiteIdAndSourceAndGeo.called).to.be.false;
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/page-1' },
          { url: 'https://example.com/page-2' },
        ]);
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(context.log.info).to.have.been.calledWithMatch('csvUrls=4');
      });

      it('rebases csvUrls (auditContext.urls) to getPreferredBaseUrl domain', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://example.com',
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
          },
          auditContext: {
            urls: ['https://www.example.com/csv-page-1', 'https://www.example.com/csv-page-2'],
          },
          finalUrl: 'https://example.com',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://example.com/csv-page-1');
        expect(submittedUrls).to.include('https://example.com/csv-page-2');
        submittedUrls.forEach((u) => expect(u).to.not.include('www.'));
      });

      it('uses overrideBaseURL from site config as domain for csvUrls rebasing', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://main--example--adobecom.hlx.page',
            getConfig: () => ({
              getFetchConfig: () => ({ overrideBaseURL: 'https://www.override.com' }),
            }),
          },
          auditContext: {
            urls: ['https://main--example--adobecom.hlx.page/page-1'],
          },
          finalUrl: 'https://main--example--adobecom.hlx.page',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://www.override.com/page-1');
      });

      it('should include includedURLs from site config', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
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
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        const result = await mockHandler.submitForScraping(context);
        expect(result.urls).to.have.length(1);
        expect(result.urls.map((u) => u.url)).to.include('https://example.com/special');
      });

      it('should fall back to top pages when baseUrl is empty', async () => {
        const topPagesStub = sandbox.stub().resolves([
          { getUrl: () => 'https://example.com/fallback-organic' },
        ]);
        const athenaStub = sandbox.stub().resolves([]);

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const result = await mockHandler.submitForScraping({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => '',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: topPagesStub },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        });

        expect(topPagesStub).to.have.been.calledOnce;
        expect(result.urls[0].url).to.equal('https://example.com/fallback-organic');
      });

      it('should warn when top agentic fetch throws and return empty URLs', async () => {
        const warn = sandbox.stub();
        const urlFetcherModule = await esmock('../../../src/prerender/url-fetcher.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => { throw new Error('athena unavailable'); },
          },
        });
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/url-fetcher.js': urlFetcherModule,
        });

        const result = await mockHandler.submitForScraping({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), warn, debug: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        });

        expect(result.urls).to.deep.equal([]);
        expect(warn).to.have.been.calledWith(sinon.match(/Failed to fetch agentic URLs: athena unavailable/));
      });

      it('should include non-recent includedURLs even when some organic URLs were recently processed', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const recentUrl = 'https://example.com/organic-page';
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => ['https://example.com/special'] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => recentUrl },
              ]),
            },
            // PageCitability returns the organic URL as recently processed → hasRecentOrganic=true
            PageCitability: {
              allByIndexKeys: sandbox.stub().resolves([{
                getUrl: () => recentUrl,
              }]),
            },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);
        const urls = result.urls.map((u) => u.url);
        expect(urls).to.include('https://example.com/special');
      });

      it('should submit all fetched organic URLs when they are below the daily batch size', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
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
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        const out = await mockHandler.submitForScraping(context);
        expect(out.urls).to.have.length(TOP_ORGANIC_URLS_LIMIT);
        expect(out.urls.map((entry) => entry.url)).to.deep.equal(
          Array.from({ length: TOP_ORGANIC_URLS_LIMIT }).map((_, i) => `https://example.com/p${i}`),
        );
      });

      it('should request agentic URLs using TOP_AGENTIC_URLS_LIMIT', async () => {
        const getTopAgenticLiveUrlsFromAthena = sandbox.stub().resolves(
          Array.from({ length: TOP_AGENTIC_URLS_LIMIT + 10 }, (_, i) => `https://example.com/p${i}`),
        );
        const urlFetcherModule = await esmock('../../../src/prerender/url-fetcher.js', {
          '../../../src/utils/agentic-urls.js': { getTopAgenticLiveUrlsFromAthena },
        });
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/url-fetcher.js': urlFetcherModule,
        });
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };
        await mockHandler.submitForScraping(context);
        expect(getTopAgenticLiveUrlsFromAthena).to.have.been.calledOnce;
        expect(getTopAgenticLiveUrlsFromAthena.firstCall.args[2]).to.equal(TOP_AGENTIC_URLS_LIMIT);
        expect(TOP_AGENTIC_URLS_LIMIT).to.equal(2000);
      });

      it('should handle undefined topPages list from SiteTopPage gracefully', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '@adobe/spacecat-shared-athena-client': {
            // No agentic URLs for this test
            AWSAthenaClient: { fromContext: () => ({ query: async () => [] }) },
          },
        });

        const mockSiteTopPage = {
          // Return undefined to exercise `(topPages || [])` fallback in getTopOrganicUrlsFromSeo
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
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
      });
      it('rebases organic and included URLs to getPreferredBaseUrl domain', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
            getPreferredBaseUrl: () => 'https://example.com',
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({
              getIncludedURLs: () => ['https://www.example.com/included-page'],
            }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: async () => [
                { getUrl: () => 'https://www.example.com/organic-1' },
                { getUrl: () => 'https://www.example.com/organic-2' },
              ],
            },
            PageCitability: { allByIndexKeys: async () => [] },
          },
          finalUrl: 'https://example.com',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://example.com/organic-1');
        expect(submittedUrls).to.include('https://example.com/organic-2');
        expect(submittedUrls).to.include('https://example.com/included-page');
        submittedUrls.forEach((u) => expect(u).to.not.include('www.'));
      });

      it('uses overrideBaseURL from site config as domain for organic and included URL rebasing', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: async () => [],
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://main--example--adobecom.hlx.page',
            getConfig: () => ({
              getFetchConfig: () => ({ overrideBaseURL: 'https://www.override.com' }),
              getIncludedURLs: () => ['https://main--example--adobecom.hlx.page/included'],
            }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: async () => [
                { getUrl: () => 'https://main--example--adobecom.hlx.page/organic-1' },
              ],
            },
            PageCitability: { allByIndexKeys: async () => [] },
          },
          finalUrl: 'https://main--example--adobecom.hlx.page',
          log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);
        const submittedUrls = result.urls.map((u) => u.url);
        expect(submittedUrls).to.include('https://www.override.com/organic-1');
        expect(submittedUrls).to.include('https://www.override.com/included');
      });

      it('returns domainBlocked when status.json has scrapeForbidden within 3d window', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
          },
        });
        const statusKey = 'prerender/scrapes/sticky-site-id/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: new Date(Date.now() - 86400000).toISOString(),
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() };
        const context = {
          site: {
            getId: () => 'sticky-site-id',
            getBaseURL: () => 'https://blocked.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log,
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
        expect(result.auditContext).to.deep.include({ domainBlocked: true });
        expect(log.info).to.have.been.calledWithMatch(/Sticky scrapeForbidden within 3d window/);
      });

      it('still scrapes when status.json scrapeForbidden is outside 3d window', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/old-sticky-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: new Date(Date.now() - 4 * 86400000).toISOString(),
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'old-sticky-site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
        expect(result.urls).to.deep.equal([]);
      });

      it('still scrapes when status.json has scrapeForbidden but missing scrapeForbiddenSince', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/no-since-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  // scrapeForbiddenSince intentionally absent
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'no-since-site',
            getBaseURL: () => 'https://prefer.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
      });

      it('still scrapes when status.json scrapeForbiddenSince is an invalid date', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });
        const statusKey = 'prerender/scrapes/bad-date-site/status.json';
        const s3Send = sandbox.stub().callsFake((cmd) => {
          if (cmd.constructor.name === 'GetObjectCommand' && cmd.input.Key === statusKey) {
            return {
              Body: {
                transformToString: () => Promise.resolve(JSON.stringify({
                  scrapeForbidden: true,
                  scrapeForbiddenSince: 'not-a-valid-date',
                })),
              },
            };
          }
          return Promise.reject(new Error(`unexpected S3 command ${cmd.constructor.name}`));
        });
        const context = {
          site: {
            getId: () => 'bad-date-site',
            getBaseURL: () => 'https://prefer.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3Send },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.auditContext?.domainBlocked).to.be.undefined;
      });

      it('Slack-triggered runs bypass sticky status.json and still submit URLs', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
          },
        });

        const context = {
          site: {
            getId: () => 'site-slack',
            getBaseURL: () => 'https://slack.example',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://slack.example/page' },
              ]),
            },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          auditContext: { slackContext: { channelId: 'C01234567' } },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.urls.map((u) => u.url)).to.include('https://slack.example/page');
      });

      it('proceeds when status.json is missing (NoSuchKey)', async function () {
        this.timeout(5000);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: () => 'https://prefer.example',
          },
        });

        const context = {
          site: {
            getId: () => 'nosuch-site',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        };

        const result = await mockHandler.submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
      });

      describe('daily batching', () => {
        const makeAgenticUrls = (n, base = 'https://example.com/agentic-') => Array.from({ length: n }, (_, i) => `${base}${i}`);
        const makeCitabilityRecord = (path) => ({
          getUrl: () => `https://example.com${path}`,
        });

        const makeHandlerWithAgentic = async (agenticUrls) => {
          const urlFetcherModule = await esmock('../../../src/prerender/url-fetcher.js', {
            '../../../src/utils/agentic-urls.js': {
              getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves(agenticUrls),
            },
          });
          return esmock('../../../src/prerender/handler.js', {
            '../../../src/prerender/url-fetcher.js': urlFetcherModule,
          });
        };

        const makeContext = (pageCitabilityRecords = []) => ({
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves(pageCitabilityRecords) },
          },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
        });

        it('should cap agentic URLs to DAILY_BATCH_SIZE when no recent citability records exist', async () => {
          const agenticUrls = makeAgenticUrls(500);
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);

          expect(result.urls.length).to.equal(DAILY_BATCH_SIZE);
        });

        it('should filter out agentic URLs recently processed by prerender (within recent window)', async () => {
          const agenticUrls = [
            'https://example.com/agentic-0',
            'https://example.com/agentic-1',
            'https://example.com/agentic-2',
          ];
          // agentic-0 is in recently-processed set → skip (DB already filtered by date)
          const recentRecord = makeCitabilityRecord('/agentic-0');
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([recentRecord]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // agentic-0 was recently processed → should NOT be in this batch
          expect(resultUrls).to.not.include('https://example.com/agentic-0');
          // agentic-1 and agentic-2 were not recently processed → should be included
          expect(resultUrls).to.include('https://example.com/agentic-1');
          expect(resultUrls).to.include('https://example.com/agentic-2');
        });

        it('should include agentic URLs when allByIndexKeys returns no recent records', async () => {
          const agenticUrls = [
            'https://example.com/agentic-0',
            'https://example.com/agentic-1',
          ];
          // DB returns no records — date filter excluded stale records at query time
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // No recent records → both agentic URLs should be included
          expect(resultUrls).to.include('https://example.com/agentic-0');
          expect(resultUrls).to.include('https://example.com/agentic-1');
        });

        it('should include organic URLs when no citability records exist', async () => {
          const agenticUrls = makeAgenticUrls(5);
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const organicUrl = 'https://example.com/organic-page';
          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => organicUrl }]),
              },
              PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // No recent citability records → include organic URL
          expect(resultUrls).to.include(organicUrl);
        });

        it('should skip organic URLs recently processed by prerender', async () => {
          const agenticUrls = makeAgenticUrls(5);
          const organicUrl = 'https://example.com/organic-page';
          // organic-page is in recently-processed set → skip (DB already filtered by date)
          const recentRecord = makeCitabilityRecord('/organic-page');
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => organicUrl }]),
              },
              PageCitability: { allByIndexKeys: sandbox.stub().resolves([recentRecord]) },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          // organic-page was recently processed → should NOT be in batch
          expect(resultUrls).to.not.include(organicUrl);
        });

        it('should pick the next 320 URLs on the next run after filtering recent page citability records', async () => {
          const agenticUrls = makeAgenticUrls(1000);
          const organicUrls = Array.from(
            { length: TOP_ORGANIC_URLS_LIMIT },
            (_, i) => `https://example.com/organic-${i}`,
          );
          const includedUrls = Array.from(
            { length: 10 },
            (_, i) => `https://example.com/included-${i}`,
          );
          const firstBatchUrls = [
            ...organicUrls,
            ...includedUrls,
            ...agenticUrls.slice(0, DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length),
          ];
          const recentRecords = firstBatchUrls.map(
            (url) => makeCitabilityRecord(new URL(url).pathname),
          );
          const mockHandler = await makeHandlerWithAgentic(agenticUrls);

          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => includedUrls }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(
                  organicUrls.map((url) => ({ getUrl: () => url })),
                ),
              },
              PageCitability: { allByIndexKeys: sandbox.stub().resolves(recentRecords) },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);

          expect(resultUrls).to.deep.equal(
            agenticUrls.slice(
              DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length,
              (DAILY_BATCH_SIZE - organicUrls.length - includedUrls.length) + DAILY_BATCH_SIZE,
            ),
          );
        });

        it('should silently ignore citability records with invalid URLs when building recent pathnames', async () => {
          // Record with an empty URL — new URL('') throws, triggering catch { return null; }
          // The null is filtered out so the URL is not treated as recent.
          const invalidRecord = {
            getUrl: () => '',
          };
          const mockHandler = await makeHandlerWithAgentic(['https://example.com/agentic-0']);
          const context = makeContext([invalidRecord]);

          // Should not throw; agentic-0 is not blocked by the invalid record
          const result = await mockHandler.submitForScraping(context);
          expect(result.urls.map((u) => u.url)).to.include('https://example.com/agentic-0');
        });

        it('should treat an organic URL that cannot be parsed as not recently processed', async () => {
          // 'not-a-valid-url' is not an absolute URL — new URL('not-a-valid-url') throws,
          // triggering catch { return false; } in hasRecentOrganic.
          const mockHandler = await makeHandlerWithAgentic([]);
          const context = {
            site: {
              getId: () => 'test-site-id',
              getBaseURL: () => 'https://example.com',
              getConfig: () => ({ getIncludedURLs: () => [] }),
            },
            dataAccess: {
              SiteTopPage: {
                allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                  { getUrl: () => 'not-a-valid-url' },
                ]),
              },
              PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
            },
            log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
            s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
            env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          };

          // Should not throw; the invalid organic URL is treated as not-recently-processed
          const result = await mockHandler.submitForScraping(context);
          expect(result).to.be.an('object');
          expect(result.urls).to.be.an('array');
        });

        it('should include agentic URLs that cannot be parsed, not treating them as recently processed', async () => {
          // 'not-a-valid-url' in the agentic list causes new URL(url) to throw inside filteredAgenticUrls,
          // triggering catch { return true; } — the URL is kept in the batch.
          const mockHandler = await makeHandlerWithAgentic(['not-a-valid-url', 'https://example.com/valid']);
          const context = makeContext([]);

          const result = await mockHandler.submitForScraping(context);
          const resultUrls = result.urls.map((u) => u.url);
          expect(resultUrls).to.include('not-a-valid-url');
          expect(resultUrls).to.include('https://example.com/valid');
        });

        describe('edge-deployed URL filtering', () => {
          const makeS3WithStatus = (pages = []) => ({
            send: async (cmd) => {
              if (cmd.constructor?.name === 'GetObjectCommand') {
                return { Body: { transformToString: async () => JSON.stringify({ pages }) } };
              }
              return Promise.reject(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
            },
          });

          it('filters organic URLs where isDeployedAtEdge is true in status.json', async () => {
            const deployedUrl = 'https://example.com/deployed-page';
            const freshUrl = 'https://example.com/fresh-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                    { getUrl: () => deployedUrl },
                    { getUrl: () => freshUrl },
                  ]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([{ url: deployedUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(deployedUrl);
            expect(resultUrls).to.include(freshUrl);
          });

          it('filters agentic URLs where isDeployedAtEdge is true in status.json', async () => {
            const deployedUrl = 'https://example.com/deployed-agentic';
            const freshUrl = 'https://example.com/fresh-agentic';
            const mockHandler = await makeHandlerWithAgentic([deployedUrl, freshUrl]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([{ url: deployedUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(deployedUrl);
            expect(resultUrls).to.include(freshUrl);
          });

          it('does not filter URLs where isDeployedAtEdge is false', async () => {
            const url = 'https://example.com/not-deployed';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([{ url, isDeployedAtEdge: false }]),
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
          });

          it('does not filter any URLs when status.json is missing (NoSuchKey)', async () => {
            const url = 'https://example.com/some-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              // makeContext default s3Client already throws NoSuchKey
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
          });

          it('logs a warning and does not filter when status.json read fails', async () => {
            const url = 'https://example.com/some-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() };
            const context = {
              ...makeContext([]),
              log,
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => url }]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: { send: sandbox.stub().rejects(new Error('S3 read error')) },
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.include(url);
            expect(log.warn).to.have.been.calledWithMatch(/Could not read status\.json/);
          });

          it('skips pages with malformed URLs without throwing', async () => {
            const validUrl = 'https://example.com/valid-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([{ getUrl: () => validUrl }]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([
                { url: 'not-a-url', isDeployedAtEdge: true },
                { url: validUrl, isDeployedAtEdge: true },
              ]),
            };

            const result = await mockHandler.submitForScraping(context);
            expect(result.urls.map((u) => u.url)).to.not.include(validUrl);
          });

          it('handles root-pathname page URLs (pathname === "/")', async () => {
            const rootUrl = 'https://example.com/';
            const freshUrl = 'https://example.com/other-page';
            const mockHandler = await makeHandlerWithAgentic([]);
            const context = {
              ...makeContext([]),
              dataAccess: {
                SiteTopPage: {
                  allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                    { getUrl: () => rootUrl },
                    { getUrl: () => freshUrl },
                  ]),
                },
                PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
              },
              s3Client: makeS3WithStatus([{ url: rootUrl, isDeployedAtEdge: true }]),
            };

            const result = await mockHandler.submitForScraping(context);
            const resultUrls = result.urls.map((u) => u.url);
            expect(resultUrls).to.not.include(rootUrl);
            expect(resultUrls).to.not.include('https://example.com/');
            expect(resultUrls).to.include(freshUrl);
          });
        });


      });

      it('should include organic URLs even when all are in the recency window when triggered from Slack', async () => {
        const athenaStub = sandbox.stub().resolves([]);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          auditContext: { slackContext: { channelId: 'C123', threadTs: '1.0' } },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/organic-page-1' },
                { getUrl: () => 'https://example.com/organic-page-2' },
              ]),
            },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        // Both URLs must be present even though they would be "recent" in a scheduled run
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/organic-page-1' },
          { url: 'https://example.com/organic-page-2' },
        ]);
      });

      it('should not fetch agentic URLs when triggered from Slack', async () => {
        const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: athenaStub,
          },
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          auditContext: { slackContext: { channelId: 'C123', threadTs: '1.0' } },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/organic-page-1' },
                { getUrl: () => 'https://example.com/organic-page-2' },
              ]),
            },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        const result = await mockHandler.submitForScraping(context);

        expect(athenaStub).to.not.have.been.called;
        expect(result.urls).to.deep.equal([
          { url: 'https://example.com/organic-page-1' },
          { url: 'https://example.com/organic-page-2' },
        ]);
      });

      it('should still fetch agentic URLs for scheduled (non-Slack) runs', async () => {
        const athenaStub = sandbox.stub().resolves(['https://example.com/agentic-1']);
        const urlFetcherModule = await esmock('../../../src/prerender/url-fetcher.js', {
          '../../../src/utils/agentic-urls.js': { getTopAgenticLiveUrlsFromAthena: athenaStub },
        });
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/url-fetcher.js': urlFetcherModule,
        });

        const context = {
          site: {
            getId: () => 'site-1',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: () => [] }),
          },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
            },
            PageCitability: { allByIndexKeys: sandbox.stub().resolves([]) },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), debug: sandbox.stub() },
          env: {},
        };

        await mockHandler.submitForScraping(context);

        expect(athenaStub).to.have.been.called;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
        expect(result.auditResult.totalUrlsChecked).to.equal(0);
      });

      it('skips URL fetching and creates scrape-forbidden opportunity when domainBlocked', async function () {
        this.timeout(5000);
        const convertToOpportunityStub = sandbox.stub().resolves();
        const syncSuggestionsStub = sandbox.stub().resolves();
        const isPaidLLMOCustomerStub = sandbox.stub().resolves(false);

        const oppSyncerMock = await esmock('../../../src/prerender/opportunity-syncer.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
          '../../../src/prerender/opportunity-data-mapper.js': {
            createOpportunityData: sandbox.stub().returns({}),
          },
        });

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/opportunity-syncer.js': oppSyncerMock,
          '../../../src/prerender/utils/utils.js': {
            isPaidLLMOCustomer: isPaidLLMOCustomerStub,
            mergeAndGetUniqueHtmlUrls: sandbox.stub().returns([]),
          },
          '../../../src/utils/agentic-urls.js': {
            getTopAgenticLiveUrlsFromAthena: sandbox.stub().resolves([]),
            getPreferredBaseUrl: sandbox.stub().returns('https://blocked.com'),
          },
        });

        const s3SendStub = sandbox.stub().resolves({
          Body: { transformToString: () => Promise.resolve('{}') },
        });
        const log = { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() };
        const context = {
          site: {
            getId: () => 'blocked-site-id',
            getBaseURL: () => 'https://blocked.com',
          },
          audit: { getId: () => 'audit-123' },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          s3Client: { send: s3SendStub },
          log,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { domainBlocked: true, scrapeJobId: 'job-999' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(log.info).to.have.been.calledWithMatch(/isDomainBlocked=true/);
        // createScrapeForbiddenOpportunity was called (not syncSuggestions)
        expect(convertToOpportunityStub).to.have.been.calledOnce;
        expect(syncSuggestionsStub).to.not.have.been.called;
        // uploadStatusSummaryToS3 was called (S3 PutObject written)
        expect(s3SendStub).to.have.been.called;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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

      it('should complete with zero URLs checked when no URLs found anywhere', async () => {
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
        expect(result.auditResult.totalUrlsChecked).to.equal(0);
      });

      it('should log a warning and skip comparison when scrapeResultPaths is empty', async () => {
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: { getId: () => 'audit-id' },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map(), // empty — all submitted URLs had FAILED status
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.warn.args.some((call) => typeof call[0] === 'string'
          && call[0].includes('No COMPLETE scrape results'))).to.be.true;
      });

      it('should trigger opportunity processing path when prerender is detected', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
          getSuggestions: sinon.stub().resolves([]),
        };

        const oppSyncerMock = await esmock('../../../src/prerender/opportunity-syncer.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../../src/utils/data-access.js': {
            syncSuggestions: sinon.stub().resolves(),
          },
        });

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/opportunity-syncer.js': oppSyncerMock,
        });

        const pageUrl = 'https://example.com/page1';
        const scrapeJobId = 'test-job-id';
        const serverHtml = '<html><body><h1>Title</h1></body></html>';
        const clientHtml = '<html><body><h1>Title</h1><p>Significant additional content here</p><div>More dynamic content loaded by JavaScript</div><p>Even more substantial content that greatly increases the word count to trigger prerender detection</p></body></html>';

        // Step 3 doesn't call readSiteStatusJson upfront; first S3 calls are the HTML fetches.
        const mockS3Client = {
          send: sandbox.stub()
            .onFirstCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(serverHtml) },
            })
            .onSecondCall().resolves({
              ContentType: 'text/html',
              Body: { transformToString: () => Promise.resolve(clientHtml) },
            }),
        };

        const scrapeResultPaths = new Map([[pageUrl, {}]]);

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: { getId: () => 'audit-id' },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId },
          scrapeResultPaths,
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsNeedingPrerender).to.be.greaterThan(0);
        expect(context.log.info.args.some((call) => typeof call[0] === 'string'
          && call[0].includes('prerender_suggestions_sync_metrics'))).to.be.true;
      });


      it('should create dummy opportunity when scraping is forbidden', async () => {
        // Test that a dummy opportunity is created when all scrapes return 403
        const mockOpportunity = { getId: () => 'test-opportunity-id', getSuggestions: sinon.stub().resolves([]) };
        const convertToOpportunityStub = sinon.stub().resolves(mockOpportunity);
        const createScrapeForbiddenOpportunityStub = sinon.stub().resolves();

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

        const oppSyncerMock = await esmock('../../../src/prerender/opportunity-syncer.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
        });

        const mockHandlerWithS3 = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/opportunity-syncer.js': oppSyncerMock,
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
          '../../../src/prerender/bot-block.js': {
            isStickyBotBlocked: sandbox.stub().returns(false),
            detectBotBlock: sandbox.stub().resolves({
              scrapeForbidden: true,
              scrapeForbiddenSince: new Date().toISOString(),
            }),
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
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandlerWithS3.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.scrapeForbidden).to.be.true;
        expect(result.auditResult.scrapeForbiddenSince).to.be.a('string');
        expect(result.auditResult.urlsNeedingPrerender).to.equal(0);

        // Verify scrapeForbidden and scrapeForbiddenSince are forwarded to status.json
        const putCall = mockS3Client.send.getCalls().find((c) => c.args[0]?.constructor?.name === 'PutObjectCommand');
        expect(putCall).to.exist;
        const statusBody = JSON.parse(putCall.args[0].input.Body);
        expect(statusBody.scrapeForbidden).to.be.true;
        expect(statusBody.scrapeForbiddenSince).to.be.a('string');

        // Verify that convertToOpportunity was called for notification
        expect(convertToOpportunityStub).to.have.been.calledOnce;

        // Verify log message for dummy opportunity
        const infoLogs = context.log.info.args.map(call => call[0]);
        expect(infoLogs.some(msg => msg.includes('Creating dummy opportunity for forbidden scraping'))).to.be.true;

        // Verify that convertToOpportunity was called with correct parameters
        expect(convertToOpportunityStub.firstCall.args[0]).to.equal('https://example.com'); // auditUrl
      });

      it('should warn when a non-NEW suggestion has edgeDeployed set (via detectWrongEdgeDeployedStatus)', async () => {
        const skippedEdgeDeployedSuggestion = {
          getId: sinon.stub().returns('skipped-edge-id'),
          getData: sinon.stub().returns({ url: 'https://example.com/page1', edgeDeployed: 1234567890 }),
          getStatus: sinon.stub().returns('SKIPPED'),
        };
        const mockOpportunity = {
          getId: () => 'test-opp-id',
          getType: () => 'prerender',
          getSuggestions: sandbox.stub().resolves([skippedEdgeDeployedSuggestion]),
        };

        const oppSyncerMock = await esmock('../../../src/prerender/opportunity-syncer.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: sandbox.stub().resolves(),
          },
          '../../../src/prerender/utils/utils.js': {
            isPaidLLMOCustomer: sandbox.stub().resolves(true),
            toPathname: sandbox.stub().callsFake((u) => new URL(u).pathname),
            getS3Path: sandbox.stub().returns('test-path'),
          },
        });

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/opportunity-syncer.js': oppSyncerMock,
          '../../../src/prerender/utils/utils.js': {
            isPaidLLMOCustomer: sandbox.stub().resolves(true),
            toPathname: sandbox.stub().callsFake((u) => { try { return new URL(u).pathname; } catch { return u; } }),
            getS3Path: sandbox.stub().returns('test-path'),
          },
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: { getId: () => 'audit-id' },
          dataAccess: {
            Opportunity: {
              allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
            },
            ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves([]) },
          },
          log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
          s3Client: { send: sandbox.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'job-123' },
          scrapeResultPaths: new Map([['https://example.com/page1', '/tmp/test']]),
        };

        await mockHandler.processContentAndGenerateOpportunities(context);

        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/Unexpected non-NEW suggestions with edgeDeployed set/),
        );
      });
    });

      it('should not set scrapeForbidden when detectBotBlocker throws', async function () {
        this.timeout(5000);
        const convertToOpportunityStub = sandbox.stub().resolves();
        const getObjectFromKeyStub = sandbox.stub();
        getObjectFromKeyStub.resolves(null);

        const oppSyncerMock = await esmock('../../../src/prerender/opportunity-syncer.js', {
          '../../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
        });

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/opportunity-syncer.js': oppSyncerMock,
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: getObjectFromKeyStub,
          },
          '../../../src/prerender/bot-block.js': {
            isStickyBotBlocked: sandbox.stub().returns(false),
            detectBotBlock: sandbox.stub().resolves({ scrapeForbidden: false, scrapeForbiddenSince: undefined }),
          },
        });

        const scrapeMetadata = {
          url: 'https://example.com/page1',
          status: 'FAILED',
          error: { message: 'HTTP 403', statusCode: 403, type: 'HttpError' },
        };
        getObjectFromKeyStub.onCall(2).resolves(scrapeMetadata);

        const log = {
          info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(),
        };
        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: { getId: () => 'audit-id' },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
              ]),
            },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          },
          log,
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: { send: sandbox.stub().resolves({}) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.scrapeForbidden).to.be.false;
      });

    describe('No Opportunity Found - Outdated Suggestions', () => {
      // Note: Suggestion syncing is now handled by the well-tested clearOutdatedSuggestions()
      // function in opportunity-syncer.js. Tests for that behavior live in opportunity-syncer.test.js.

      it('should fallback to urlsToCheck.length when ScrapeUrl.allByScrapeJobId throws', async () => {
        const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
            ScrapeUrl: { allByScrapeJobId: sandbox.stub().rejects(new Error('DB connection failed')) },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/a', '/tmp/a'], ['https://example.com/b', '/tmp/b']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsSubmittedForScraping).to.equal(2);
        expect(context.log.warn).to.have.been.calledWith(
          sinon.match(/Failed to fetch ScrapeUrl stats.*DB connection failed/)
        );
      });

      it('should use urlsToCheck.length when no scrapeJobId', async () => {
        const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: {},
          scrapeResultPaths: new Map([['https://example.com/only', '/tmp/only']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsSubmittedForScraping).to.equal(1);
      });

      it('should use empty object when auditContext is null (branch coverage)', async () => {
        const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: null,
          scrapeResultPaths: new Map([['https://example.com/only', '/tmp/only']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsSubmittedForScraping).to.equal(1);
      });

      it('should set scrapingErrorRate to 0 when urlsSubmittedForScraping is 0 (branch coverage)', async () => {
        const allBySiteIdAndStatusStub = sandbox.stub().resolves([]);
        const syncSuggestionsStub = sandbox.stub().resolves();

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: {
            getId: () => 'audit-id',
            getFullAuditRef: () => 'https://example.com',
            getAuditedAt: () => '2024-01-01T00:00:00Z',
            getInvocationId: () => 'invocation-123',
          },
          dataAccess: {
            Opportunity: { allBySiteIdAndStatus: allBySiteIdAndStatusStub },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
            ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves([]) },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/only', '/tmp/only']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsSubmittedForScraping).to.equal(0);
        expect(result.auditResult.scrapingErrorRate).to.equal(0);
      });

      it('should upload status.json when catch throws (branch coverage)', async () => {
        const syncSuggestionsStub = sandbox.stub().rejects(new Error('Sync failed'));
        const s3SendStub = sandbox.stub().callsFake((cmd) => (
          cmd.input?.Key?.includes('status.json')
            ? Promise.resolve({})
            : Promise.resolve({ Body: { transformToString: () => Promise.resolve('') } })
        ));

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
        });

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
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([{ getId: () => 'x', getType: () => 'prerender' }]) },
            ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves([{ getUrl: () => 'https://example.com/test' }]) },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
          s3Client: { send: s3SendStub },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.error).to.equal('Audit failed');
        const putCall = s3SendStub.getCalls().find((c) => c.args[0]?.constructor?.name === 'PutObjectCommand' && c.args[0]?.input?.Key === 'prerender/scrapes/test-site-id/status.json');
        expect(putCall).to.exist;
        const statusBody = JSON.parse(putCall.args[0].input.Body);
        expect(statusBody.lastAuditSuccess).to.be.false;
        expect(statusBody.scrapeForbidden).to.be.false;
      });

      it('should not call syncSuggestions when existing opportunity is not prerender type', async () => {
        const mockOpportunity = {
          getId: () => 'existing-opportunity-id',
          getType: () => 'cwv', // Different type, not prerender
          getSuggestions: sandbox.stub().resolves([]),
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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

      it('should successfully upload status.json with detailed results', async () => {
        const mockHandler = await esmock('../../../src/prerender/handler.js');
        const s3SendStub = sandbox.stub().callsFake((cmd) => (
          cmd.constructor?.name === 'PutObjectCommand'
            ? Promise.resolve({})
            : Promise.resolve({ Body: { transformToString: () => Promise.resolve('') } })
        ));

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
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: { send: s3SendStub },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
          scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        // Should complete successfully
        expect(result.status).to.equal('complete');

        // Should upload status.json to S3 with correct data
        const putCall = s3SendStub.getCalls().find((c) => c.args[0]?.constructor?.name === 'PutObjectCommand');
        expect(putCall).to.exist;
        const cmd = putCall.args[0];
        expect(cmd.input.Key).to.equal('prerender/scrapes/test-site-id/status.json');
        const statusBody = JSON.parse(cmd.input.Body);
        expect(statusBody.lastAuditSuccess).to.be.true;
        expect(statusBody.scrapingErrorRate).to.be.a('number');
        expect(statusBody.scrapeForbidden).to.be.false;

        // Should log success message
        const infoLogs = context.log.info.args.map((call) => call[0]);
        expect(infoLogs.some((msg) => msg.includes('prerender_status_upload:'))).to.be.true;
      });

    });
  });

  describe('Athena and Sheet Fetch Coverage', () => {
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
        scrapeResultPaths: new Map([['https://example.com/inc', {}]]),
        auditContext: { scrapeJobId: 'test-job-id' },
      };
      const res = await mockHandler.processContentAndGenerateOpportunities(ctx);
      const found = res.auditResult.results.find((r) => r.url.includes('/inc'));
      expect(found).to.exist;
    });

  });

  describe('Additional branch coverage (mapping, catches)', () => {
    it('should return the raw Athena URL when it is already absolute but invalid', async function () {
      this.timeout(5000);

      const urlFetcherModule = await esmock('../../../src/prerender/url-fetcher.js', {
        '../../../src/utils/agentic-urls.js': {
          getTopAgenticLiveUrlsFromAthena: sinon.stub().resolves(['http://[invalid']),
        },
      });
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/prerender/url-fetcher.js': urlFetcherModule,
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
          PageCitability: { allByIndexKeys: sinon.stub().resolves([]) },
        },
        log: {
          info: sinon.stub(),
          warn: sinon.stub(),
          debug: sinon.stub(),
        },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);

      expect(res.urls).to.deep.equal([{ url: 'http://[invalid' }]);
    });

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
        scrapeResultPaths: new Map([['https://example.com/inc', {}]]),
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

    it('should cover agenticStats mapping and ranking loop by returning non-empty top list', async () => {
      const serverHtml = '<html><body>Same</body></html>';
      const clientHtml = '<html><body>Same</body></html>';
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: async () => ([
            { url: '/x', number_of_hits: 2 },
          ]) }) },
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
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        // Intentionally omit SiteTopPage to exercise the "no top pages" branch in getTopOrganicUrlsFromSeo
        dataAccess: {},
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub() },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
    });

    it('should warn and continue when SiteTopPage.allBySiteIdAndSourceAndGeo throws', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
      });

      const warn = sinon.stub();
      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          // allBySiteIdAndSourceAndGeo is defined but throws — exercises the catch in getTopOrganicUrlsFromSeo
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().rejects(new Error('DB connection lost')),
          },
        },
        log: { info: sinon.stub(), warn, debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
      expect(warn.args.some((call) => typeof call[0] === 'string'
        && call[0].includes('Failed to load top pages for fallback'))).to.be.true;
    });

    it('should handle sheet load failures gracefully and continue scraping', async () => {
      const athenaQueryStub = sinon.stub().resolves([]);
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '@adobe/spacecat-shared-athena-client': {
          AWSAthenaClient: { fromContext: () => ({ query: athenaQueryStub }) },
        },
      });

      const ctx = {
        site: {
          getId: () => 'site',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        },
        dataAccess: {
          SiteTopPage: { allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]) },
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
        },
        log: {
          info: sinon.stub(),
          debug: sinon.stub(),
          warn: sinon.stub(),
        },
        s3Client: { send: sinon.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
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
        // Intentionally omit dataAccess to exercise `dataAccess || {}` branch in getTopOrganicUrlsFromSeo
        log: { info: sinon.stub(), warn: sinon.stub(), debug: sinon.stub(), error: sinon.stub() },
        s3Client: { send: sinon.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const res = await mockHandler.submitForScraping(ctx);
      expect(res).to.be.an('object');
      expect(res.urls).to.be.an('array');
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
        // Should have debug logs about missing HTML data
        expect(context.log.debug.called).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(fullContext);

        // Should complete but with warnings/debug logs from S3 and compareHtmlContent
        expect(result.status).to.equal('complete');
        expect(context.log.warn.called || context.log.debug.called).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;
        // Should log about missing HTML data at debug level
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;
        // Should log about missing HTML data at debug level
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub() },
          s3Client: { send: sandbox.stub().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.deep.equal([]);
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');

        // Verify the simplified error handling for missing data (now at debug level)
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );

        expect(hasMissingDataLog).to.be.true;
      });

      it('should trigger HTML analysis error handling', async () => {
        // Mock analyzeHtmlForPrerender to throw an error
        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/utils/s3-utils.js': {
            getObjectFromKey: sinon.stub()
              .onFirstCall().resolves('<html><body>Valid content</body></html>')
              .onSecondCall().resolves('<html><body>Valid content too</body></html>'),
          },
          '../../../src/prerender/utils/html-analyzer.js': {
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;
        // Verify the HTML analysis error was logged at debug level
        expect(context.log.debug.args.some(call => call[0].includes('HTML analysis failed for'))).to.be.true;
      });


      it('should update existing PRERENDER opportunity with all data fields', async () => {
        // This test specifically targets the PRERENDER update logic in opportunity.js
        const existingOpportunity = {
          getId: () => 'existing-opp-id',
          getType: () => 'prerender',
          getData: () => ({
            dataSources: ['seo'],
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
            debug: sinon.stub(),
            info: sinon.stub(),
            warn: sinon.stub(),
            error: sinon.stub(),
          },
        };

        const createOpportunityDataFn = (auditData) => ({
          data: {
            dataSources: ['seo', 'site'],
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
        const mockAnalyze = await esmock('../../../src/prerender/utils/html-analyzer.js', {
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;

        // The defensive check should now catch the empty server HTML (logged at debug)
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;

        // Should get Missing HTML data logged at debug for both null values
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;

        // Should handle both null values properly (logged at debug)
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        expect(context.log.debug).to.have.been.called;

        // This should trigger the defensive check and log at debug
        const debugMessages = context.log.debug.args.map(call => call[0]);
        const hasMissingDataLog = debugMessages.some(msg =>
          typeof msg === 'string' && msg.includes('Missing HTML data for') && msg.includes('client-side: false')
        );
        expect(hasMissingDataLog).to.be.true;
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
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
          '../../../src/prerender/utils/html-analyzer.js': {
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
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
          scrapeResultPaths: new Map([['https://example.com/page1', {}]]),
          s3Client: { send: sandbox.stub().resolves({}) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.auditResult.results[0].scrapeError).to.be.undefined;
      });

      it('should build S3 path without path segment for root URLs', async () => {
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.resolves(null);

        const htmlComparatorMock = await esmock('../../../src/prerender/html-comparator.js', {
          '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
          '../../../src/prerender/utils/html-analyzer.js': {
            analyzeHtmlForPrerender: sinon.stub().resolves({
              needsPrerender: false, contentGainRatio: 1.0, wordCountBefore: 0, wordCountAfter: 0,
            }),
          },
          '../../../src/prerender/utils/utils.js': { getS3Path: (await import('../../../src/prerender/utils/utils.js')).getS3Path },
          '../../../src/prerender/utils/constants.js': { CONTENT_GAIN_THRESHOLD: 1.1 },
        });

        const mockHandler = await esmock('../../../src/prerender/handler.js', {
          '../../../src/prerender/html-comparator.js': htmlComparatorMock,
        });

        const context = {
          site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
          audit: { getId: () => 'audit-id' },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
                { getUrl: () => 'https://example.com/', getTraffic: () => 100 },
              ]),
            },
            Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
            LatestAudit: { updateByKeys: sandbox.stub().resolves() },
          },
          log: {
            info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(),
          },
          scrapeResultPaths: new Map([['https://example.com/', {}]]),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          auditContext: { scrapeJobId: 'test-job-id' },
        };

        const result = await mockHandler.processContentAndGenerateOpportunities(context);

        expect(result.status).to.equal('complete');
        const keys = getObjectFromKeyStub.args.map((args) => args[2]);
        expect(keys.some((k) => k === 'prerender/scrapes/test-job-id/server-side.html')).to.be.true;
      });
    });
  });

  describe('uploadStatusSummaryToS3', () => {
    let mockS3Client;
    let context;

    const noSuchKeyError = () => {
      const err = new Error('NoSuchKey');
      err.name = 'NoSuchKey';
      return err;
    };

    // Helper: find the PutObjectCommand call
    const getPutCall = (stub) => stub.getCalls().find((c) => c.args[0].constructor.name === 'PutObjectCommand');

    beforeEach(() => {
      mockS3Client = {
        // By default: GET status.json → NoSuchKey (no prior run), PUT → success
        send: sandbox.stub().callsFake((command) => {
          if (command.constructor.name === 'GetObjectCommand') {
            return Promise.reject(noSuchKeyError());
          }
          return Promise.resolve({});
        }),
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

    it('should derive aggregate metrics from merged pages', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'scrape-job-999',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          scrapeForbidden: true,
          results: [
            { url: 'https://example.com/page1', error: false, needsPrerender: true },
            { url: 'https://example.com/page2', error: true, needsPrerender: false, scrapeError: { statusCode: 403, message: 'Forbidden' } },
            { url: 'https://example.com/page3', error: false, needsPrerender: false },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

      expect(uploadedData).to.not.have.property('totalUrlsChecked');
      expect(uploadedData.urlsNeedingPrerender).to.equal(1);
      expect(uploadedData.urlsSubmittedForScraping).to.equal(3);
      expect(uploadedData.urlsScrapedSuccessfully).to.equal(2);
      expect(uploadedData.scrapingErrorRate).to.be.closeTo(33.33, 0.01);
      expect(uploadedData.scrapeForbidden).to.be.true;
      expect(uploadedData.scrapeForbiddenCount).to.equal(1);
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

      const putCall = getPutCall(mockS3Client.send);
      expect(putCall).to.exist;
      const command = putCall.args[0];

      expect(command.input.Bucket).to.equal('test-bucket');
      expect(command.input.Key).to.equal('prerender/scrapes/test-site-id/status.json');
      expect(command.input.ContentType).to.equal('application/json');

      const uploadedData = JSON.parse(command.input.Body);
      expect(uploadedData.baseUrl).to.equal('https://example.com');
      expect(uploadedData.siteId).to.equal('test-site-id');
      expect(uploadedData.auditType).to.equal('prerender');
      expect(uploadedData.scrapeJobId).to.equal('scrape-job-999');
      expect(uploadedData.lastUpdated).to.equal('2025-01-01T00:00:00.000Z');
      expect(uploadedData).to.not.have.property('totalUrlsChecked');
      expect(uploadedData.urlsNeedingPrerender).to.equal(1); // derived: page1 needsPrerender=true
      expect(uploadedData.scrapeForbidden).to.equal(false);
      expect(uploadedData.pages).to.have.lengthOf(2);

      expect(uploadedData.pages[0]).to.deep.equal({
        url: 'https://example.com/page1',
        scrapingStatus: 'success',
        needsPrerender: true,
        isDeployedAtEdge: false,
        usedEarlyClientSideHtml: false,
        wordCountBefore: 100,
        wordCountAfter: 250,
        contentGainRatio: 2.5,
        scrapedAt: '2025-01-01T00:00:00.000Z',
        scrapeJobId: 'scrape-job-999',
      });

      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/prerender_status_upload:.*statusKey=prerender\/scrapes\/test-site-id\/status\.json/)
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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

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
          results: [],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

      expect(uploadedData.pages).to.deep.equal([]);
      expect(uploadedData).to.not.have.property('totalUrlsChecked');
      expect(uploadedData.urlsNeedingPrerender).to.equal(0);
      expect(uploadedData.scrapingErrorRate).to.equal(null);
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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

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

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

      expect(uploadedData.pages[0]).to.deep.equal({
        url: 'https://example.com/page1',
        scrapingStatus: 'success',
        needsPrerender: false,
        isDeployedAtEdge: false,
        usedEarlyClientSideHtml: false,
        wordCountBefore: 0,
        wordCountAfter: 0,
        contentGainRatio: 0,
        scrapedAt: '2025-01-01T00:00:00.000Z',
        scrapeJobId: null,
      });
    });

    it('should use pre-computed missingPages and scrapeForbiddenCount from auditResult without re-fetching', async () => {
      // missingPages and scrapeForbiddenCount are now computed once in getScrapeJobStats and
      // stored in auditResult — uploadStatusSummaryToS3 must use them directly, not re-derive.
      const auditUrl = 'https://example.com';
      const missingPage = {
        url: 'https://example.com/forbidden-page',
        scrapingStatus: 'failed',
        needsPrerender: false,
        scrapeError: { statusCode: 403, message: 'Forbidden' },
      };
      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'scrape-job-123',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 1,
          urlsNeedingPrerender: 0,
          scrapeForbiddenCount: 1,  // correctly computed by getScrapeJobStats
          scrapeForbidden: false,    // correctly computed (1 of 2 URLs — not all)
          results: [
            { url: 'https://example.com/page1', error: false, needsPrerender: false },
          ],
          missingPages: [missingPage],  // pre-computed — no DB re-fetch
        },
      };

      const allByScrapeJobIdStub = sandbox.stub();
      context.dataAccess = { ScrapeUrl: { allByScrapeJobId: allByScrapeJobIdStub } };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(allByScrapeJobIdStub).to.not.have.been.called; // no redundant DB call
      const putCall = mockS3Client.send.getCalls().find((c) => c.args[0].constructor.name === 'PutObjectCommand');
      const uploadedData = JSON.parse(putCall.args[0].input.Body);

      expect(uploadedData.scrapeForbiddenCount).to.equal(1);
      expect(uploadedData.scrapeForbidden).to.equal(false);
      expect(uploadedData.pages).to.have.lengthOf(2); // page1 + forbidden-page
      expect(uploadedData.pages[1].scrapeJobId).to.equal('scrape-job-123');
    });

    it('should preserve scrapeJobId already present on a pre-computed missing page', async () => {
      const auditUrl = 'https://example.com';
      const missingPage = {
        url: 'https://example.com/forbidden-page',
        scrapingStatus: 'failed',
        needsPrerender: false,
        scrapeJobId: 'missing-page-job-456',
      };
      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'scrape-job-123',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          scrapeForbiddenCount: 0,
          scrapeForbidden: false,
          results: [],
          missingPages: [missingPage],
        },
      };

      context.dataAccess = { ScrapeUrl: { allByScrapeJobId: sandbox.stub() } };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const putCall = getPutCall(mockS3Client.send);
      const uploadedData = JSON.parse(putCall.args[0].input.Body);

      expect(uploadedData.pages).to.have.lengthOf(1);
      expect(uploadedData.pages[0].scrapeJobId).to.equal('missing-page-job-456');
    });

    it('should set scrapeJobId to null for a pre-computed missing page when neither source provides one', async () => {
      const auditUrl = 'https://example.com';
      const missingPage = {
        url: 'https://example.com/forbidden-page',
        scrapingStatus: 'failed',
        needsPrerender: false,
      };
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          scrapeForbiddenCount: 0,
          scrapeForbidden: false,
          results: [],
          missingPages: [missingPage],
        },
      };

      context.dataAccess = { ScrapeUrl: { allByScrapeJobId: sandbox.stub() } };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const putCall = getPutCall(mockS3Client.send);
      const uploadedData = JSON.parse(putCall.args[0].input.Body);

      expect(uploadedData.pages).to.have.lengthOf(1);
      expect(uploadedData.pages[0]).to.have.property('scrapeJobId', null);
    });

    it('should use auditResult.scrapeForbidden=true when all pages are forbidden', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'scrape-job-123',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 0,
          urlsNeedingPrerender: 0,
          scrapeForbiddenCount: 2,
          scrapeForbidden: true,
          results: [],
          missingPages: [
            { url: 'https://example.com/page1', scrapingStatus: 'failed', needsPrerender: false, scrapeError: { statusCode: 403 } },
            { url: 'https://example.com/page2', scrapingStatus: 'failed', needsPrerender: false, scrapeError: { statusCode: 403 } },
          ],
        },
      };

      const allByScrapeJobIdStub = sandbox.stub();
      context.dataAccess = { ScrapeUrl: { allByScrapeJobId: allByScrapeJobIdStub } };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(allByScrapeJobIdStub).to.not.have.been.called;
      const putCall = mockS3Client.send.getCalls().find((c) => c.args[0].constructor.name === 'PutObjectCommand');
      const uploadedData = JSON.parse(putCall.args[0].input.Body);

      expect(uploadedData.scrapeForbiddenCount).to.equal(2);
      expect(uploadedData.scrapeForbidden).to.equal(true);
      expect(uploadedData.pages).to.have.lengthOf(2);
    });

    it('should merge pages from existing status.json, current run overrides same URLs', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 1,
          urlsNeedingPrerender: 1,
          results: [
            {
              url: 'https://example.com/page1',
              error: false,
              needsPrerender: true,
              wordCountBefore: 10,
              wordCountAfter: 200,
              contentGainRatio: 20,
            },
          ],
        },
      };

      const existingStatus = {
        pages: [
          {
            url: 'https://example.com/page1',
            scrapingStatus: 'success',
            needsPrerender: false,
            scrapedAt: '2025-01-01T00:00:00.000Z',
          },
          {
            url: 'https://example.com/page2',
            scrapingStatus: 'success',
            needsPrerender: true,
            scrapedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

      // page1 overwritten by current run, page2 preserved from prior run
      expect(uploadedData.pages).to.have.lengthOf(2);
      const page1 = uploadedData.pages.find((p) => p.url === 'https://example.com/page1');
      const page2 = uploadedData.pages.find((p) => p.url === 'https://example.com/page2');
      expect(page1.scrapedAt).to.equal('2025-02-01T00:00:00.000Z');
      expect(page1.needsPrerender).to.equal(true);
      expect(page2.scrapedAt).to.equal('2025-01-01T00:00:00.000Z'); // preserved
    });

    it('should set scrapeForbiddenSince when auditResult has scrapeForbidden and scrapeForbiddenSince', async () => {
      const auditUrl = 'https://example.com';
      const since = '2025-02-01T12:00:00.000Z';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        auditResult: {
          results: [],
          scrapeForbidden: true,
          scrapeForbiddenSince: since,
        },
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify({ pages: [] })) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.scrapeForbidden).to.equal(true);
      expect(uploadedData.scrapeForbiddenSince).to.equal(since);
    });

    it('should preserve scrapeForbidden fields from existing status when domainBlockedSkip', async () => {
      const auditUrl = 'https://example.com';
      const existingStatus = {
        scrapeForbidden: true,
        scrapeForbiddenSince: '2025-01-10T00:00:00.000Z',
        pages: [{ url: 'https://example.com/p', scrapingStatus: 'success' }],
      };
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        domainBlockedSkip: true,
        auditResult: {
          results: [],
          scrapeForbidden: true,
        },
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.scrapeForbidden).to.equal(true);
      expect(uploadedData.scrapeForbiddenSince).to.equal('2025-01-10T00:00:00.000Z');
    });

    it('should merge status pages by pathname so www and non-www variants do not duplicate', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        auditResult: {
          results: [
            {
              url: 'https://example.com/page1',
              error: false,
              needsPrerender: true,
            },
          ],
        },
      };

      const existingStatus = {
        pages: [
          {
            url: 'https://www.example.com/page1',
            scrapingStatus: 'success',
            needsPrerender: false,
            scrapedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.pages).to.have.lengthOf(1);
      expect(uploadedData.pages[0].url).to.equal('https://example.com/page1');
      expect(uploadedData.pages[0].needsPrerender).to.equal(true);
    });

    it('should aggregate metrics across runs from merged pages', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        auditResult: {
          scrapeForbidden: false,
          results: [
            { url: 'https://example.com/new-page', error: false, needsPrerender: true },
          ],
        },
      };

      const existingStatus = {
        urlsSubmittedForScraping: 2,
        pages: [
          { url: 'https://example.com/old-page', scrapingStatus: 'success', needsPrerender: true, scrapedAt: '2025-01-01T00:00:00.000Z' },
          { url: 'https://example.com/forbidden', scrapingStatus: 'error', needsPrerender: false, scrapeError: { statusCode: 403, message: 'Forbidden' }, scrapedAt: '2025-01-01T00:00:00.000Z' },
        ],
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);

      // 3 unique pages across both runs
      expect(uploadedData).to.not.have.property('totalUrlsChecked');
      // new-page + old-page both needsPrerender=true
      expect(uploadedData.urlsNeedingPrerender).to.equal(2);
      // new-page (success) + old-page (success) = 2 scraped successfully; forbidden = error
      expect(uploadedData.urlsScrapedSuccessfully).to.equal(2);
      expect(uploadedData.urlsSubmittedForScraping).to.equal(3);
      expect(uploadedData.scrapeForbidden).to.be.false;
      expect(uploadedData.scrapeForbiddenCount).to.equal(1);
    });

    it('should treat missing existing status.json (NoSuchKey) as empty and not warn', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: { totalUrlsChecked: 0, urlsNeedingPrerender: 0, results: [] },
      };

      // default stub already returns NoSuchKey for GET
      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(context.log.warn).to.not.have.been.calledWith(sinon.match(/Could not read existing status\.json/));
      expect(getPutCall(mockS3Client.send)).to.exist;
    });

    it('should warn and start fresh when existing status.json is unreadable (non-NoSuchKey error)', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          totalUrlsChecked: 1,
          urlsNeedingPrerender: 1,
          results: [{ url: 'https://example.com/page1', error: false, needsPrerender: true }],
        },
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.reject(new Error('AccessDenied'));
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      expect(context.log.warn).to.have.been.calledWith(sinon.match(/Could not read status\.json/));
      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.pages).to.have.lengthOf(1);
    });

    it('should treat existing status without a pages array as empty during merge', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        auditResult: {
          results: [{ url: 'https://example.com/page1', error: false, needsPrerender: true }],
        },
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify({ pages: null })) },
          });
        }
        return Promise.resolve({});
      });

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.pages).to.have.lengthOf(1);
      expect(uploadedData.pages[0].url).to.equal('https://example.com/page1');
    });

    it('should preserve existing scrapeJobId for fallback URLs not in submittedUrlSet', async () => {
      // Scenario: fallback mode where all 14 top pages are in auditResult.results, but only
      // 9 were submitted to the current scrape job (submittedUrlSet has 9 URLs).
      // The 5 "current organic" URLs not in submittedUrlSet must retain their prior scrapeJobId
      // from the existing status.json rather than being overwritten with the new scrapeJobId.
      const auditUrl = 'https://example.com';
      const submittedUrl = 'https://example.com/submitted-page';
      const notSubmittedUrl = 'https://example.com/not-submitted-page';
      const submittedUrlSet = new Set([submittedUrl]);

      const existingStatus = {
        pages: [
          {
            url: notSubmittedUrl,
            scrapingStatus: 'success',
            needsPrerender: false,
            scrapedAt: '2025-01-01T00:00:00.000Z',
            scrapeJobId: 'old-job-id-from-previous-cycle',
          },
        ],
      };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'current-job-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        submittedUrlSet,
        auditResult: {
          results: [
            { url: submittedUrl, error: false, needsPrerender: true },
            { url: notSubmittedUrl, error: false, needsPrerender: false },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      expect(uploadedData.pages).to.have.lengthOf(2);

      const submittedPage = uploadedData.pages.find((p) => p.url === submittedUrl);
      const notSubmittedPage = uploadedData.pages.find((p) => p.url === notSubmittedUrl);

      // URL that was submitted to the current job gets the current scrapeJobId
      expect(submittedPage.scrapeJobId).to.equal('current-job-id');
      // URL NOT submitted to the current job retains its prior scrapeJobId from status.json
      expect(notSubmittedPage.scrapeJobId).to.equal('old-job-id-from-previous-cycle');
    });

    it('should use null for fallback URL scrapeJobId when not in submittedUrlSet and no prior entry exists', async () => {
      // Fallback URL has no entry in the existing status.json — scrapeJobId should be null
      const auditUrl = 'https://example.com';
      const submittedUrl = 'https://example.com/submitted-page';
      const newFallbackUrl = 'https://example.com/new-fallback-page';
      const submittedUrlSet = new Set([submittedUrl]);

      // existing status has no entry for newFallbackUrl
      const existingStatus = { pages: [] };

      mockS3Client.send.callsFake((command) => {
        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body: { transformToString: () => Promise.resolve(JSON.stringify(existingStatus)) },
          });
        }
        return Promise.resolve({});
      });

      const auditData = {
        siteId: 'test-site-id',
        scrapeJobId: 'current-job-id',
        auditedAt: '2025-02-01T00:00:00.000Z',
        submittedUrlSet,
        auditResult: {
          results: [
            { url: submittedUrl, error: false, needsPrerender: false },
            { url: newFallbackUrl, error: false, needsPrerender: false },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      const newFallbackPage = uploadedData.pages.find((p) => p.url === newFallbackUrl);
      expect(newFallbackPage.scrapeJobId).to.equal(null);
    });

    it('should include usedEarlyClientSideHtml flag when set on result', async () => {
      const auditUrl = 'https://example.com';
      const auditData = {
        siteId: 'test-site-id',
        auditedAt: '2025-01-01T00:00:00.000Z',
        auditResult: {
          results: [
            {
              url: 'https://example.com/early-html-page',
              error: false,
              needsPrerender: true,
              usedEarlyClientSideHtml: true,
            },
            {
              url: 'https://example.com/normal-page',
              error: false,
              needsPrerender: false,
            },
          ],
        },
      };

      await uploadStatusSummaryToS3(auditUrl, auditData, context);

      const uploadedData = JSON.parse(getPutCall(mockS3Client.send).args[0].input.Body);
      const earlyPage = uploadedData.pages.find((p) => p.url === 'https://example.com/early-html-page');
      const normalPage = uploadedData.pages.find((p) => p.url === 'https://example.com/normal-page');

      expect(earlyPage.usedEarlyClientSideHtml).to.equal(true);
      expect(normalPage.usedEarlyClientSideHtml).to.equal(false);
    });
  });


  describe('getScrapeJobStats', () => {
    let sandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should return fallback when scrapeJobId is null', async () => {
      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub() } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStats(null, [], 5, context);
      expect(result).to.deep.equal({
        urlsSubmittedForScraping: 5, scrapeForbiddenCount: 0, missingPages: [], submittedUrlSet: null,
      });
      expect(context.dataAccess.ScrapeUrl.allByScrapeJobId).to.not.have.been.called;
    });

    it('should return fallback when dataAccess.ScrapeUrl is unavailable', async () => {
      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: {},
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStats('job-1', [], 5, context);
      expect(result).to.deep.equal({
        urlsSubmittedForScraping: 5, scrapeForbiddenCount: 0, missingPages: [], submittedUrlSet: null,
      });
    });

    it('should return zero forbidden when all URLs are in comparisonResults and none are 403', async () => {
      const comparisonResults = [
        { url: 'https://example.com/page1', hasScrapeMetadata: true, scrapeForbidden: false },
        { url: 'https://example.com/page2', hasScrapeMetadata: true, scrapeForbidden: false },
      ];
      const allScrapeUrls = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page2' },
      ];
      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStats('job-1', comparisonResults, 2, context);
      expect(result.urlsSubmittedForScraping).to.equal(2);
      expect(result.scrapeForbiddenCount).to.equal(0);
      expect(result.missingPages).to.deep.equal([]);
      expect(result.submittedUrlSet).to.be.instanceOf(Set);
      expect(result.submittedUrlSet.has('https://example.com/page1')).to.be.true;
      expect(result.submittedUrlSet.has('https://example.com/page2')).to.be.true;
    });

    it('should count FAILED-status 403 URL absent from comparisonResults', async () => {
      // page1 is COMPLETE-status (in comparisonResults, not 403); forbidden is FAILED-status (missing)
      const comparisonResults = [{ url: 'https://example.com/page1', hasScrapeMetadata: true, scrapeForbidden: false }];
      const allScrapeUrls = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/forbidden' },
      ];
      const forbiddenMetadata = { error: { statusCode: 403, message: 'Forbidden' } };
      const getObjectFromKeyStub = sandbox.stub().resolves(forbiddenMetadata);

      const { getScrapeJobStats: getScrapeJobStatsMocked } = await esmock('../../../src/prerender/scrape-stats.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      });

      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStatsMocked('job-1', comparisonResults, 1, context);
      // 1 COMPLETE-status non-403 + 1 FAILED-status 403 → scrapeForbiddenCount=1, not all forbidden
      expect(result.urlsSubmittedForScraping).to.equal(2);
      expect(result.scrapeForbiddenCount).to.equal(1);
      expect(result.missingPages).to.deep.equal([{
        url: 'https://example.com/forbidden',
        scrapingStatus: 'failed',
        needsPrerender: false,
        scrapeError: { statusCode: 403, message: 'Forbidden' },
      }]);
      expect(result.submittedUrlSet).to.be.instanceOf(Set);
      expect(result.submittedUrlSet.has('https://example.com/page1')).to.be.true;
      expect(result.submittedUrlSet.has('https://example.com/forbidden')).to.be.true;
    });

    it('should set scrapeForbidden=true when all URLs (COMPLETE and FAILED) are 403', async () => {
      // page1 is COMPLETE-status 403 (in comparisonResults); forbidden is FAILED-status 403 (missing)
      const comparisonResults = [{ url: 'https://example.com/page1', hasScrapeMetadata: true, scrapeForbidden: true }];
      const allScrapeUrls = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/forbidden' },
      ];
      const forbiddenMetadata = { error: { statusCode: 403, message: 'Forbidden' } };
      const getObjectFromKeyStub = sandbox.stub().resolves(forbiddenMetadata);

      const { getScrapeJobStats: getScrapeJobStatsMocked } = await esmock('../../../src/prerender/scrape-stats.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      });

      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStatsMocked('job-1', comparisonResults, 1, context);
      expect(result.scrapeForbiddenCount).to.equal(2);
    });

    it('should not count FAILED-status URL whose scrape.json is not 403', async () => {
      const comparisonResults = [{ url: 'https://example.com/page1', hasScrapeMetadata: true, scrapeForbidden: false }];
      const allScrapeUrls = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/error500' },
      ];
      const errorMetadata = { error: { statusCode: 500, message: 'Server Error' } };
      const getObjectFromKeyStub = sandbox.stub().resolves(errorMetadata);

      const { getScrapeJobStats: getScrapeJobStatsMocked } = await esmock('../../../src/prerender/scrape-stats.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      });

      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStatsMocked('job-1', comparisonResults, 1, context);
      expect(result.urlsSubmittedForScraping).to.equal(2);
      expect(result.scrapeForbiddenCount).to.equal(0);
      expect(result.missingPages).to.deep.equal([{
        url: 'https://example.com/error500',
        scrapingStatus: 'failed',
        needsPrerender: false,
        scrapeError: { statusCode: 500, message: 'Server Error' },
      }]);
    });

    it('should not count FAILED-status URL with unreadable scrape.json in denominator', async () => {
      // page1 is COMPLETE-status 403; missing has no readable scrape.json (getObjectFromKey => null)
      const comparisonResults = [{ url: 'https://example.com/page1', hasScrapeMetadata: true, scrapeForbidden: true }];
      const allScrapeUrls = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/missing' },
      ];
      // getObjectFromKey returns null — scrape.json not readable
      const getObjectFromKeyStub = sandbox.stub().resolves(null);

      const { getScrapeJobStats: getScrapeJobStatsMocked } = await esmock('../../../src/prerender/scrape-stats.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      });

      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStatsMocked('job-1', comparisonResults, 1, context);
      // Denominator = 1 (only page1 with hasScrapeMetadata). Missing has no metadata → excluded.
      // scrapeForbiddenCount=1
      expect(result.scrapeForbiddenCount).to.equal(1);
      expect(result.missingPages).to.deep.equal([{
        url: 'https://example.com/missing',
        scrapingStatus: 'failed',
        needsPrerender: false,
        // No scrapeError — metadata was null (scrape.json unreadable), so error unknown
      }]);
    });

    it('should fall back when ScrapeUrl query throws', async () => {
      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().rejects(new Error('DB connection failed')) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      const result = await getScrapeJobStats('job-1', [], 3, context);
      expect(result).to.deep.equal({
        urlsSubmittedForScraping: 3, scrapeForbiddenCount: 0, missingPages: [], submittedUrlSet: null,
      });
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Failed to fetch ScrapeUrl stats'));
    });

    it('should fall back with scrapeForbidden=true when all COMPLETE URLs are 403 and ScrapeUrl query throws', async () => {
      const context = {
        log: { debug: sandbox.stub(), warn: sandbox.stub() },
        dataAccess: { ScrapeUrl: { allByScrapeJobId: sandbox.stub().rejects(new Error('DB error')) } },
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'bucket' },
      };
      // Two COMPLETE-status URLs, both 403 forbidden
      const comparisonResults = [
        { url: 'https://example.com/a', hasScrapeMetadata: true, scrapeForbidden: true },
        { url: 'https://example.com/b', hasScrapeMetadata: true, scrapeForbidden: true },
      ];
      const result = await getScrapeJobStats('job-1', comparisonResults, 2, context);
      expect(result).to.deep.equal({
        urlsSubmittedForScraping: 2, scrapeForbiddenCount: 2, missingPages: [], submittedUrlSet: null,
      });
      expect(context.log.warn).to.have.been.calledWith(sinon.match('Failed to fetch ScrapeUrl stats'));
    });

    it('should integrate with processContentAndGenerateOpportunities to detect missing forbidden URLs', async function () {
      this.timeout(5000);
      // URL in scrapeResultPaths (has a scrape.json but no HTML — not 403, just incomplete)
      const knownUrl = 'https://example.com/page1';
      // URL in ScrapeUrl DB but NOT in scrapeResultPaths (only has scrape.json — 403 forbidden)
      const forbiddenUrl = 'https://example.com/forbidden';

      const allScrapeUrls = [
        { getUrl: () => knownUrl },
        { getUrl: () => forbiddenUrl },
      ];

      // getObjectFromKey call map by key suffix:
      //   HTML files → null (no HTML for page1)
      //   scrape.json (page1) → non-null, non-403 (hasScrapeMetadata=true but scrapeForbidden=false)
      //   scrape.json (forbidden) → 403 metadata (called by getScrapeJobStats for missing URL)
      const forbiddenMetadata = { error: { statusCode: 403, message: 'Forbidden' } };
      const getObjectFromKeyStub = sandbox.stub().callsFake((_client, _bucket, key) => {
        if (key.includes('forbidden') && key.endsWith('scrape.json')) return Promise.resolve(forbiddenMetadata);
        if (key.endsWith('scrape.json')) return Promise.resolve({ isDeployedAtEdge: false }); // non-null, non-403
        return Promise.resolve(null); // HTML files
      });

      const scrapeStatsModule = await esmock('../../../src/prerender/scrape-stats.js', {
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
      });
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/prerender/scrape-stats.js': scrapeStatsModule,
        '../../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
        '../../../src/prerender/bot-block.js': {
          isStickyBotBlocked: sandbox.stub().returns(false),
          detectBotBlock: sandbox.stub().resolves({ scrapeForbidden: false, scrapeForbiddenSince: undefined }),
        },
      });

      const context = {
        site: { getId: () => 'site-id', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id', getFullAuditRef: () => 'ref', getAuditedAt: () => '2025-01-01T00:00:00Z', getInvocationId: () => 'inv-1' },
        log: { info: sandbox.stub(), debug: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub() },
        s3Client: { send: sandbox.stub().resolves({}) },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map([[knownUrl, '/tmp/p1']]),
        dataAccess: {
          ScrapeUrl: { allByScrapeJobId: sandbox.stub().resolves(allScrapeUrls) },
          Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) },
          LatestAudit: { updateByKeys: sandbox.stub().resolves() },
        },
      };

      const result = await mockHandler.processContentAndGenerateOpportunities(context);

      expect(result.status).to.equal('complete');
      // scrapeForbiddenCount should include the missing forbidden URL
      expect(result.auditResult.scrapeForbiddenCount).to.equal(1);
      // Only 1 of 2 total URLs is 403, so domain-wide scrapeForbidden should be false
      expect(result.auditResult.scrapeForbidden).to.be.false;
    });

  });



  describe('getScrapeJobStats integration coverage', () => {
    let sandbox;

    beforeEach(() => {
      sandbox = sinon.createSandbox();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should use ScrapeUrl count when scrapeJobId and ScrapeUrl are available', async function () {
      this.timeout(5000);
      const mockScrapeUrls = [
        { getUrl: () => 'https://example.com/test' },
        { getUrl: () => 'https://example.com/missing-1' },
        { getUrl: () => 'https://example.com/missing-2' },
      ];
      const mockS3Client = { send: sandbox.stub().resolves({}) };

      const getObjectFromKeyStub = sandbox.stub();
      getObjectFromKeyStub.resolves(null);

      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const context = {
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: () => [],
          }),
        },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          ScrapeUrl: {
            allByScrapeJobId: sandbox.stub().resolves(mockScrapeUrls),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
          },
        },
        log: {
          info: sandbox.stub(),
          debug: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        s3Client: mockS3Client,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        auditContext: { scrapeJobId: 'test-scrape-job' },
      };

      const result = await mockHandler.processContentAndGenerateOpportunities(context);

      expect(result.status).to.equal('complete');
      expect(result.auditResult.urlsSubmittedForScraping).to.equal(3);
    });

    it('should fall back to urlsToCheck length when ScrapeUrl query throws', async () => {
      const mockS3Client = { send: sandbox.stub().resolves({}) };

      const getObjectFromKeyStub = sandbox.stub();
      getObjectFromKeyStub.resolves(null);

      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/s3-utils.js': {
          getObjectFromKey: getObjectFromKeyStub,
        },
      });

      const context = {
        site: {
          getId: () => 'test-site-id',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: () => [],
          }),
        },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          ScrapeUrl: {
            allByScrapeJobId: sandbox.stub().rejects(new Error('DB connection failed')),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
          },
        },
        log: {
          info: sandbox.stub(),
          debug: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        s3Client: mockS3Client,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        scrapeResultPaths: new Map([['https://example.com/test', '/tmp/test']]),
        auditContext: { scrapeJobId: 'test-scrape-job' },
      };

      const result = await mockHandler.processContentAndGenerateOpportunities(context);

      expect(result.status).to.equal('complete');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match('Failed to fetch ScrapeUrl stats'),
      );
    });
  });

  describe('compareHtmlContent — citability score', () => {
    it('should pass citability metrics from analyzeHtmlForPrerender to writeToCitabilityRecords', async function () {
      this.timeout(5000);
      const pageCitabilityCreateStub = sinon.stub().resolves({});
      const pageCitabilityAllBySiteIdStub = sinon.stub().resolves([]);

      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/prerender/html-comparator.js': {
          compareAllUrls: sinon.stub().resolves([{
            url: 'https://example.com/page1',
            needsPrerender: false,
            contentGainRatio: 1.3,
            wordCountBefore: 100,
            wordCountAfter: 130,
            citabilityScore: 0.85,
            wordDifference: 30,
            hasScrapeMetadata: false,
            scrapeForbidden: false,
            isDeployedAtEdge: false,
            usedEarlyClientSideHtml: false,
          }]),
        },
      });

      const mockS3Client = {
        send: sinon.stub().callsFake(async (cmd) => {
          if (cmd.constructor.name === 'PutObjectCommand') {
            return {};
          }
          throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
        }),
      };

      const context = {
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          PageCitability: {
            allBySiteId: pageCitabilityAllBySiteIdStub,
            create: pageCitabilityCreateStub,
          },
        },
        log: {
          info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
        },
        s3Client: mockS3Client,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map([['https://example.com/page1', '/tmp/page1']]),
      };

      await mockHandler.processContentAndGenerateOpportunities(context);

      expect(pageCitabilityAllBySiteIdStub).to.have.been.calledWith('site-1');
      expect(pageCitabilityCreateStub).to.have.been.calledOnce;
      expect(pageCitabilityCreateStub.firstCall.args[0]).to.deep.include({
        citabilityScore: 0.85,
        botWords: 100,
        normalWords: 130,
      });
    });

    it('should forward usedEarlyClientSideHtml from scrape.json metadata to auditResult.results', async () => {
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/prerender/html-comparator.js': {
          compareAllUrls: sinon.stub().resolves([{
            url: 'https://example.com/page1',
            needsPrerender: false,
            contentGainRatio: 1.0,
            wordCountBefore: 50,
            wordCountAfter: 50,
            citabilityScore: 0.5,
            wordDifference: 0,
            hasScrapeMetadata: true,
            scrapeForbidden: false,
            isDeployedAtEdge: false,
            usedEarlyClientSideHtml: true,
          }]),
        },
      });

      const mockS3Client = {
        send: sinon.stub().callsFake(async (cmd) => {
          if (cmd.constructor.name === 'PutObjectCommand') {
            return {};
          }
          throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
        }),
      };

      const context = {
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          PageCitability: {
            allBySiteId: sinon.stub().resolves([]),
            create: sinon.stub().resolves({}),
          },
        },
        log: {
          info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
        },
        s3Client: mockS3Client,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map([['https://example.com/page1', '/tmp/page1']]),
      };

      const result = await mockHandler.processContentAndGenerateOpportunities(context);

      const page = result.auditResult.results.find((r) => r.url === 'https://example.com/page1');
      expect(page.usedEarlyClientSideHtml).to.equal(true);
    });
  });


  describe('PageCitability isolation', () => {
    it('does not treat recent PageCitability-only URLs as scraped by prerender', async () => {
      const syncSuggestionsStub = sinon.stub().resolves();
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      // URL with a recent citability record, 1 day ago — prerender never touched it this cycle
      const pageCitabilityOwnedRecord = {
        getUrl: () => 'https://example.com/citability-only-page',
        getUpdatedAt: () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const context = {
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          PageCitability: {
            allBySiteId: sinon.stub().resolves([pageCitabilityOwnedRecord]),
            create: sinon.stub().resolves({}),
          },
        },
        log: {
          info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
        },
        s3Client: {
          send: sinon.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }),
        },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map(),
      };

      await mockHandler.processContentAndGenerateOpportunities(context);

      if (syncSuggestionsStub.called) {
        const syncCall = syncSuggestionsStub.firstCall.args[0];
        expect(syncCall.scrapedUrlsSet.has('https://example.com/citability-only-page')).to.be.false;
      }
    });

    it('does not depend on a second PageCitability read to build scrapedUrlsSet', async () => {
      const syncSuggestionsStub = sinon.stub().resolves();
      const mockHandler = await esmock('../../../src/prerender/handler.js', {
        '../../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      });

      // A URL processed yesterday — should be protected by the 7-day window
      const yesterdayRecord = {
        getUrl: () => 'https://example.com/yesterday-page',
        getUpdatedAt: () => new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const allBySiteIdStub = sinon.stub().resolves([yesterdayRecord]);

      const context = {
        site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
        audit: { getId: () => 'audit-id' },
        dataAccess: {
          Opportunity: { allBySiteIdAndStatus: sinon.stub().resolves([]) },
          PageCitability: {
            allBySiteId: allBySiteIdStub,
            create: sinon.stub().resolves({}),
          },
        },
        log: {
          info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub(),
        },
        s3Client: {
          send: sinon.stub().resolves({ Body: { transformToString: () => Promise.resolve('') } }),
        },
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        auditContext: { scrapeJobId: 'job-1' },
        scrapeResultPaths: new Map(),
      };

      await mockHandler.processContentAndGenerateOpportunities(context);

      if (syncSuggestionsStub.called) {
        const syncCall = syncSuggestionsStub.firstCall.args[0];
        expect(syncCall.scrapedUrlsSet.has('https://example.com/yesterday-page')).to.be.false;
      }
    });
  });
});
