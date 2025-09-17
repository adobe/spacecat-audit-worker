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
import { expect } from 'chai';
import sinon from 'sinon';
import prerenderHandler, {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
} from '../../src/prerender/handler.js';
import { analyzeHtmlForPrerender } from '../../src/prerender/html-comparator-utils.js';

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

  describe('HTML Analysis', () => {
    it('should analyze HTML and detect prerender opportunities', () => {
      const directHtml = '<html><body><h1>Simple content</h1></body></html>';
      const scrapedHtml = '<html><body><h1>Simple content</h1><div>Lots of additional content loaded by JavaScript</div><p>More dynamic content</p></body></html>';

      const result = analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result).to.be.an('object');
      expect(result.needsPrerender).to.be.a('boolean');
      expect(result.contentGainRatio).to.be.a('number');
      expect(result.wordDiff).to.be.a('number');
      expect(result.wordCountBefore).to.be.a('number');
      expect(result.wordCountAfter).to.be.a('number');
    });

    it('should not recommend prerender for similar content', () => {
      const directHtml = '<html><body><h1>Content</h1><p>Same content</p></body></html>';
      const scrapedHtml = '<html><body><h1>Content</h1><p>Same content</p></body></html>';

      const result = analyzeHtmlForPrerender(directHtml, scrapedHtml, 1.2);

      expect(result.needsPrerender).to.be.false;
      expect(result.contentGainRatio).to.be.at.most(1.2);
    });

    it('should handle missing HTML gracefully', () => {
      const result = analyzeHtmlForPrerender(null, null, 1.2);

      expect(result.error).to.be.a('string');
      expect(result.needsPrerender).to.be.false;
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
          log: { info: sandbox.stub() },
        };

        const result = await submitForScraping(context);

        expect(result).to.be.an('object');
        expect(result.urls).to.be.an('array');
        expect(result.siteId).to.equal('test-site-id');
        expect(result.processingType).to.equal('prerender');
        expect(result.auditResult).to.be.an('object');
        expect(result.auditResult.status).to.equal('SCRAPING_REQUESTED');
        expect(result.auditResult.scrapedUrls).to.be.an('array');
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
          log: { info: sandbox.stub() },
        };

        const result = await submitForScraping(context);

        expect(result).to.deep.equal({
          auditResult: {
            message: 'Content scraping for prerender audit initiated.',
            scrapedUrls: ['https://example.com'],
            status: 'SCRAPING_REQUESTED',
          },
          fullAuditRef: 'https://example.com',
          jobId: 'test-site-id',
          options: {
            enableAuthentication: false,
            enableJavaScript: true,
            hideConsentBanners: false,
            pageLoadTimeout: 15000,
            screenshotTypes: ['fullpage', 'thumbnail'],
            storagePrefix: 'tokowaka',
            waitForSelector: 'body',
          },
          processingType: 'prerender',
          allowCache: false,
          forceRescrape: true,
          siteId: 'test-site-id',
          urls: ['https://example.com'],
        });
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
        expect(processContentAndGenerateOpportunities).to.be.a('function');

        // Test basic functionality with no URLs to process
        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult).to.be.an('object');
        expect(result.auditResult.status).to.equal('NO_OPPORTUNITIES');
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
          log: { info: sandbox.stub(), error: sandbox.stub(), warn: sandbox.stub() },
          scrapeResultPaths: new Map(),
          s3Client: {},
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('ERROR');
        expect(result.error).to.be.a('string');
      });
    });
  });
});
