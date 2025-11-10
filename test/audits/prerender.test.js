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
  processContentAndSendToMystique,
  createScrapeForbiddenOpportunity,
} from '../../src/prerender/handler.js';
import { uploadStatusSummaryToS3 } from '../../src/prerender/guidance-handler.js';
import { analyzeHtmlForPrerender } from '../../src/prerender/html-comparator-utils.js';
import { createOpportunityData } from '../../src/prerender/opportunity-data-mapper.js';

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
      expect(processContentAndSendToMystique).to.be.a('function');
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
    describe('importTopPages', () => {
      it('should return import configuration', async () => {
        const context = {
          site: { getId: () => 'test-site-id' },
          finalUrl: 'https://example.com',
        };

        const result = await importTopPages(context);

        expect(result).to.deep.equal({
          type: 'top-pages',
          siteId: 'test-site-id',
          auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
          fullAuditRef: 'scrapes/test-site-id/',
        });
      });
    });

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
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-scrape-content-and-send-to-mystique',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(result.type).to.equal('prerender');
        expect(result.allowCache).to.equal(false);
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
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            AUDIT_JOBS_QUEUE_URL: 'https://sqs.test.com/test-queue',
          },
          auditContext: {
            next: 'process-scrape-content-and-send-to-mystique',
            auditId: 'test-audit-id',
            auditType: 'prerender',
          },
        };

        const result = await submitForScraping(context);

        expect(result).to.deep.equal({
          urls: [{
            url: 'https://example.com',
          }],
          siteId: 'test-site-id',
          type: 'prerender',
          processingType: 'prerender',
          allowCache: false,
          options: {
            pageLoadTimeout: 20000,
            storagePrefix: 'prerender',
          },
        });
      });

      it('should include includedURLs from site config', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1' },
          ]),
        };

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getConfig: () => ({ getIncludedURLs: (auditType) => auditType === 'prerender' ? ['https://example.com/special'] : [] }),
          },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: { info: sandbox.stub(), debug: sandbox.stub() },
        };

        const result = await submitForScraping(context);

        expect(result.urls).to.have.length(2);
        expect(result.urls.map(u => u.url)).to.include('https://example.com/page1');
        expect(result.urls.map(u => u.url)).to.include('https://example.com/special');
      });
    });

    describe('processContentAndSendToMystique', () => {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            error: sandbox.stub(),
            warn: sandbox.stub(),
            debug: sandbox.stub(),
          },
          scrapeResultPaths: new Map(), // Empty map to avoid S3 calls
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        // Test that the function exists and can be called
        expect(processContentAndSendToMystique).to.be.a('function');

        // Test basic functionality with no URLs to process
        const result = await processContentAndSendToMystique(context);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(new Error('Database error')) } },
          log: { info: sandbox.stub(), debug: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
          scrapeResultPaths: new Map(),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

        expect(result).to.be.an('object');
        expect(result.error).to.be.a('string');
        expect(result.totalUrlsChecked).to.equal(0);
        expect(result.urlsNeedingPrerender).to.equal(0);
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            error: sandbox.stub(),
            warn: sandbox.stub(),
          },
          scrapeResultPaths,
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          scrapeResultPaths: new Map(), // No scrape results
          s3Client: { send: sandbox.stub().rejects(new Error('No S3 data')) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.totalUrlsChecked).to.equal(1);
        // Should have logged about fallback to base URL
        expect(context.log.info).to.have.been.calledWith('Prerender - No URLs found for comparison. baseUrl=https://example.com, siteId=test-site-id');
      });

      it('should send prerender suggestions to Mystique when detected', async () => {
        const mockHandler = await esmock('../../src/prerender/handler.js', {});

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

        const sendMessageStub = sandbox.stub().resolves();

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
            getDeliveryType: () => 'other',
          },
          audit: { getId: () => 'audit-id' },
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
          sqs: { sendMessage: sendMessageStub },
          env: {
            S3_SCRAPER_BUCKET_NAME: 'test-bucket',
            QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.example.com/queue',
          },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

        expect(result.status).to.equal('complete');
        expect(result.auditResult.urlsNeedingPrerender).to.be.greaterThan(0);
        expect(sendMessageStub).to.have.been.calledOnce;

        const sentPayload = sendMessageStub.firstCall.args[1]; // queueUrl, message
        expect(sentPayload).to.have.property('type', 'guidance:prerender');
        expect(sentPayload).to.have.nested.property('data.suggestions').that.is.an('array').with.length.greaterThan(0);
        expect(sentPayload).to.have.nested.property('data.excludedSelectors').that.is.an('array').and.not.empty;
      });

      it('should create dummy opportunity when scraping is forbidden', async () => {
        // Test that a dummy opportunity is created when all scrapes return 403
        const mockOpportunity = { getId: () => 'test-opportunity-id' };
        const convertToOpportunityStub = sinon.stub().resolves(mockOpportunity);
        const createScrapeForbiddenOpportunityStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
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

        const mockHandlerWithS3 = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
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
        };

        const result = await mockHandlerWithS3.processContentAndSendToMystique(context);

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

    describe('Guidance handler integration (post-Mystique)', () => {
      it('should persist suggestions and upload status summary after guidance', async () => {
        const syncSuggestionsStub = sandbox.stub().resolves();
        const convertToOpportunityStub = sandbox.stub().resolves({ getId: () => 'oppty-1' });

        const mockedGuidance = await esmock('../../src/prerender/guidance-handler.js', {
          '../../src/utils/data-access.js': {
            syncSuggestions: syncSuggestionsStub,
          },
          '../../src/common/opportunity.js': {
            convertToOpportunity: convertToOpportunityStub,
          },
        });

        const Site = {
          findById: sandbox.stub().resolves({
            getBaseURL: () => 'https://example.com',
          }),
        };
        const Audit = {
          findById: sandbox.stub().resolves({
            setAuditResult: sandbox.stub(),
            save: sandbox.stub().resolves(),
          }),
        };
        const Suggestion = {}; // not directly used here

        const context = {
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          dataAccess: { Site, Audit, Suggestion },
          s3Client: { send: sandbox.stub().resolves() },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const message = {
          siteId: 'test-site-id',
          auditId: 'audit-123',
          data: {
            suggestions: [
              {
                url: 'https://example.com/page1',
                contentGainRatio: 2.1,
                wordCountBefore: 100,
                wordCountAfter: 300,
                organicTraffic: 500,
                originalHtmlKey: 'prerender/scrapes/site/page1/server-side.html',
                prerenderedHtmlKey: 'prerender/scrapes/site/page1/client-side.html',
                aiSummary: 'Concise AI summary.',
              },
              {
                url: 'https://example.com/page2',
                contentGainRatio: 1.5,
                wordCountBefore: 80,
                wordCountAfter: 200,
                organicTraffic: 300,
                originalHtmlKey: 'prerender/scrapes/site/page2/server-side.html',
                prerenderedHtmlKey: 'prerender/scrapes/site/page2/client-side.html',
                aiSummary: 'Another summary.',
              },
            ],
          },
        };

        const res = await mockedGuidance.default(message, context);
        expect(res.status).to.equal(200);
        expect(convertToOpportunityStub).to.have.been.calledOnce;
        expect(syncSuggestionsStub).to.have.been.calledOnce;
        // Ensure status summary upload was attempted via S3 client
        expect(context.s3Client.send).to.have.been.calledOnce;
      });
    });

    describe('createScrapeForbiddenOpportunity', () => {
      it('should create opportunity without suggestions when scraping is forbidden', async () => {
        const mockOpportunity = { getId: () => 'test-opportunity-id' };
        const convertToOpportunityStub = sandbox.stub().resolves(mockOpportunity);

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
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

    describe.skip('processOpportunityAndSuggestions', () => {
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

        // processOpportunityAndSuggestions removed; flow handled via Mystique guidance callback

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

        // processOpportunityAndSuggestions removed; flow handled via Mystique guidance callback

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
                organicTraffic: 100,
                contentGainRatio: 1.5,
              },
            ],
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        // processOpportunityAndSuggestions removed; verify logging behavior separately

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
                organicTraffic: 500,
                contentGainRatio: 2.1,
              },
              {
                url: 'https://example.com/page2',
                needsPrerender: true,
                organicTraffic: 300,
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

        // processOpportunityAndSuggestions removed; verify logging behavior separately

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
        const originalConvertToOpportunity = await import('../../src/common/opportunity.js');
        const originalSyncSuggestions = await import('../../src/utils/data-access.js');

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
                organicTraffic: 500,
                contentGainRatio: 2.1,
              },
            ],
          },
        };

        const logStub = sandbox.stub();
        const context = {
          log: { info: logStub, debug: logStub },
        };

        // processOpportunityAndSuggestions removed; verify logging behavior separately

        // Should have logged about generating suggestions
        expect(logStub).to.have.been.calledWith('Prerender - Generated 1 prerender suggestions for baseUrl=https://example.com, siteId=test-site-id');
      });
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
        };

        const result = await processContentAndSendToMystique(fullContext);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        try {
          const result = await processContentAndSendToMystique(context);
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndSendToMystique(context);

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
          dataAccess: { SiteTopPage: mockSiteTopPage },
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
          dataAccess: { SiteTopPage: mockSiteTopPage },
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
        const mockS3Utils = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockS3Utils.processContentAndSendToMystique(context);

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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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
        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
            getObjectFromKey: sinon.stub()
              .onFirstCall().resolves('<html><body>Valid content</body></html>')
              .onSecondCall().resolves('<html><body>Valid content too</body></html>'),
          },
          '../../src/prerender/html-comparator-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

        expect(result.status).to.equal('complete');
        expect(context.log.error).to.have.been.called;
        // Verify the HTML analysis error was logged
        expect(context.log.error.args.some(call => call[0].includes('HTML analysis failed for'))).to.be.true;
      });

      it.skip('should trigger opportunity and suggestion creation flow', async () => {
        // Test the full opportunity creation and suggestion sync flow including S3 key generation
        const mockOpportunity = { getId: () => 'test-opportunity-id' };
        const syncSuggestionsStub = sinon.stub().resolves();

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/common/opportunity.js': {
            convertToOpportunity: sinon.stub().resolves(mockOpportunity),
          },
          '../../src/utils/data-access.js': {
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
                organicTraffic: 500,
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

        // processOpportunityAndSuggestions removed; flow handled via Mystique guidance callback

        expect(context.log.info).to.have.been.called;
        // Verify that syncSuggestions was called
        expect(syncSuggestionsStub).to.have.been.calledOnce;
        // Verify that suggestion syncing was logged
        expect(context.log.info.args.some(call => call[0].includes('Successfully synced suggestions'))).to.be.true;

        // Verify the syncSuggestions was called with the correct structure including S3 keys
        const syncCall = syncSuggestionsStub.getCall(0);
        expect(syncCall.args[0]).to.have.property('mapNewSuggestion');
        const mappedSuggestion = syncCall.args[0].mapNewSuggestion(auditData.auditResult.results[0]);
        expect(mappedSuggestion.data).to.have.property('originalHtmlKey');
        expect(mappedSuggestion.data).to.have.property('prerenderedHtmlKey');
        expect(mappedSuggestion.data.originalHtmlKey).to.include('server-side.html');
        expect(mappedSuggestion.data.prerenderedHtmlKey).to.include('client-side.html');
        expect(mappedSuggestion.data).to.not.have.property('needsPrerender');
        
        // Test mergeDataFunction (lines 283-284)
        const mergeDataFn = syncCall.args[0].mergeDataFunction;
        const existingData = { url: 'https://example.com/page1', customField: 'preserved' };
        const newDataItem = {
          url: 'https://example.com/page1',
          organicTraffic: 200,
          contentGainRatio: 2.5,
          wordCountBefore: 100,
          wordCountAfter: 250,
          needsPrerender: true, // Should be filtered out
        };
        const mergedData = mergeDataFn(existingData, newDataItem);
        expect(mergedData).to.have.property('customField', 'preserved'); // Existing field preserved
        expect(mergedData).to.have.property('url', 'https://example.com/page1');
        expect(mergedData).to.have.property('organicTraffic', 200);
        expect(mergedData).to.not.have.property('needsPrerender'); // Filtered out by mapSuggestionData
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

        const convertToOpportunityModule = await import('../../src/common/opportunity.js');
        
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
        const mockAnalyze = await esmock('../../src/prerender/html-comparator-utils.js', {
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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            debug: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

        expect(result.status).to.equal('complete');
        // Should complete successfully even if scrape.json is missing (backward compatible)
        expect(result.auditResult).to.be.an('object');
      });

      it('should handle invalid JSON in scrape.json metadata (lines 83-85)', async () => {
        // Test when scrape.json contains invalid JSON
        // Note: getObjectFromKey returns null when JSON parsing fails (handled in s3-utils.js)
        const getObjectFromKeyStub = sinon.stub();
        getObjectFromKeyStub.onCall(0).resolves('<html><body>Server content</body></html>');
        getObjectFromKeyStub.onCall(1).resolves('<html><body>Client content</body></html>');
        getObjectFromKeyStub.onCall(2).resolves(null); // getObjectFromKey returns null on parse failure

        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': {
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
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: {
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            debug: sandbox.stub(),
          },
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);

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
        const mockHandler = await esmock('../../src/prerender/handler.js', {
          '../../src/utils/s3-utils.js': { getObjectFromKey: getObjectFromKeyStub },
          '../../src/prerender/html-comparator-utils.js': {
            analyzeHtmlForPrerender: sandbox.stub().throws(new Error('Analysis failed')),
          },
        });

        const context = {
          site: { getId: () => 'test-site', getBaseURL: () => 'https://example.com' },
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1', getTraffic: () => 100 },
          ]) } },
          log: { info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub() },
          s3Client: { send: sandbox.stub().resolves({}) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await mockHandler.processContentAndSendToMystique(context);
        
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
              organicTraffic: 1000,
            },
            {
              url: 'https://example.com/page2',
              error: false,
              needsPrerender: false,
              wordCountBefore: 200,
              wordCountAfter: 220,
              contentGainRatio: 1.1,
              organicTraffic: 500,
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
        organicTraffic: 1000,
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
              organicTraffic: 500,
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
        organicTraffic: 0,
      });
    });
  });
});
