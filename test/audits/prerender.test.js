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
import { Audit } from '@adobe/spacecat-shared-data-access';
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
        expect(result.type).to.equal(Audit.AUDIT_TYPES.PRERENDER);
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
          urls: [{ url: 'https://example.com' }],
          siteId: 'test-site-id',
          type: Audit.AUDIT_TYPES.PRERENDER,
        });
      });
    });

    describe('processContentAndGenerateOpportunities', () => {
      it('should process URLs and generate opportunities when prerender is needed', async () => {
        const mockSiteTopPage = {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
            { getUrl: () => 'https://example.com/page1' },
          ]),
        };

        const mockS3Client = {
          getObject: sandbox.stub().resolves({
            Body: {
              transformToString: () => JSON.stringify({
                scrapeResult: {
                  rawBody: '<html><body>Scraped content</body></html>',
                },
              }),
            },
          }),
        };

        const mockFetch = sandbox.stub().resolves({
          ok: true,
          headers: { get: () => 'text/html' },
          text: () => '<html><body>Direct content</body></html>',
        });

        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: mockSiteTopPage },
          log: { info: sandbox.stub(), error: sandbox.stub() },
          s3Client: mockS3Client,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          scrapeResultPaths: new Map(),
        };

        // Mock the fetch function
        global.fetch = mockFetch;

        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('complete');
        expect(result.auditResult).to.be.an('object');
        expect(result.auditResult.results).to.be.an('array');
      });

      it('should handle errors gracefully', async () => {
        const context = {
          site: {
            getId: () => 'test-site-id',
            getBaseURL: () => 'https://example.com',
          },
          audit: { getId: () => 'audit-id' },
          dataAccess: { SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().rejects(new Error('Database error')) } },
          log: { info: sandbox.stub(), error: sandbox.stub() },
        };

        const result = await processContentAndGenerateOpportunities(context);

        expect(result).to.be.an('object');
        expect(result.status).to.equal('ERROR');
        expect(result.error).to.be.a('string');
      });
    });
  });
});
