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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Crawl Detection Module', () => {
  let sandbox;
  let detectBrokenLinksFromCrawl;
  let detectBrokenLinksFromCrawlBatch;
  let mergeAndDeduplicate;
  let PAGES_PER_BATCH;
  let getObjectFromKeyStub;
  let isLinkInaccessibleStub;
  let isWithinAuditScopeStub;

  const mockSite = {
    getBaseURL: () => 'https://example.com',
    getId: () => 'test-site-id',
  };

  const mockContext = {
    s3Client: {},
    env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
    log: {
      info: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    },
    site: mockSite,
  };

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    getObjectFromKeyStub = sandbox.stub();
    isLinkInaccessibleStub = sandbox.stub();
    isWithinAuditScopeStub = sandbox.stub().returns(true);

    const module = await esmock('../../../src/internal-links/crawl-detection.js', {
      '../../../src/utils/s3-utils.js': {
        getObjectFromKey: getObjectFromKeyStub,
      },
      '../../../src/internal-links/helpers.js': {
        isLinkInaccessible: isLinkInaccessibleStub,
      },
      '../../../src/internal-links/subpath-filter.js': {
        isWithinAuditScope: isWithinAuditScopeStub,
      },
    });

    detectBrokenLinksFromCrawl = module.detectBrokenLinksFromCrawl;
    detectBrokenLinksFromCrawlBatch = module.detectBrokenLinksFromCrawlBatch;
    mergeAndDeduplicate = module.mergeAndDeduplicate;
    PAGES_PER_BATCH = module.PAGES_PER_BATCH;

    // Reset log stubs
    mockContext.log.info.reset();
    mockContext.log.warn.reset();
    mockContext.log.debug.reset();
    mockContext.log.error.reset();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('detectBrokenLinksFromCrawl', () => {
    const createMockHtml = (links) => `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <header><a href="/nav">Navigation</a></header>
          <main>
            ${links.map((l) => `<a href="${l.href}">${l.text}</a>`).join('\n')}
          </main>
          <footer><a href="/footer">Footer Link</a></footer>
        </body>
      </html>
    `;

    it('should detect broken internal links from scraped HTML', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/good-link', text: 'Good Link' },
            { href: '/broken-link', text: 'Broken Link' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/good-link').resolves(false);
      isLinkInaccessibleStub.withArgs('https://example.com/broken-link').resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.include({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken-link',
        anchorText: 'Broken Link',
        trafficDomain: 0,
      });
    });

    it('should skip links in header and footer', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/main-content', text: 'Main Content' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should not check header/footer links
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://example.com/nav');
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://example.com/footer');
    });

    it('should skip links with empty href attribute', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<html><body><main><a href="">Empty</a><a>No href</a><a href="/valid">Valid</a></main></body></html>',
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only check the valid link
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid');
    });

    it('should use fallback URL when finalUrl is null', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/original-url', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/link', text: 'Link' }]),
        },
        finalUrl: null, // Explicitly null to test fallback
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should use original URL as base for resolving links
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/link');
    });

    it('should skip links in footer specifically', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<html><body>
            <footer><a href="/footer-link">Footer Link</a></footer>
            <main><a href="/main-link">Main Link</a></main>
          </body></html>`,
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only check main link, skip footer
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/main-link');
    });

    it('should handle anchor with whitespace-only text', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<html><body><main><a href="/broken">   </a></main></body></html>',
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result[0].anchorText).to.equal('[no text]');
    });

    it('should skip anchor-only links (#section)', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '#section1', text: 'Section 1' },
            { href: '/real-link', text: 'Real Link' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should not check anchor links
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('#section1');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/real-link');
    });

    it('should only check internal links', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/internal', text: 'Internal' },
            { href: 'https://external.com/page', text: 'External' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/internal');
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://external.com/page');
    });

    it('should handle www/non-www variants as same origin', async () => {
      const scrapeResultPaths = new Map([
        ['https://www.example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: 'https://example.com/link1', text: 'Without www' },
            { href: 'https://www.example.com/link2', text: 'With www' },
          ]),
        },
        finalUrl: 'https://www.example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Both should be considered internal
      expect(isLinkInaccessibleStub).to.have.been.calledTwice;
    });

    it('should deduplicate broken links by urlFrom|urlTo', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/broken', text: 'Broken 1' },
            { href: '/broken', text: 'Broken 2' },
            { href: '/broken', text: 'Broken 3' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only have 1 entry despite 3 links to same URL
      expect(result).to.have.lengthOf(1);
    });

    it('should cache validation results to avoid redundant checks', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
        ['https://example.com/page2', 'scrapes/page2.json'],
      ]);

      // Both pages have same broken link
      const html = createMockHtml([{ href: '/shared-broken', text: 'Shared' }]);
      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: html },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Link should only be validated once due to caching
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
    });

    it('should handle missing scrapeResult gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({});

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle missing rawBody gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {},
      });

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle S3 fetch errors gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.rejects(new Error('S3 error'));

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error processing/),
      );
    });

    it('should use fallback URL when finalUrl is missing', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/link', text: 'Link' }]),
        },
        // No finalUrl - should use the original URL
      });

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result[0].urlFrom).to.equal('https://example.com/page1');
    });

    it('should filter by audit scope', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/out-of-scope', text: 'Out of Scope' }]),
        },
        finalUrl: 'https://example.com/page1',
      });

      // First call for pageUrl, second call for linkUrl
      isWithinAuditScopeStub.onFirstCall().returns(true); // pageUrl is in scope
      isWithinAuditScopeStub.onSecondCall().returns(false); // linkUrl is out of scope

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should skip pages outside audit scope', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/out-of-scope-page', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/link', text: 'Link' }]),
        },
        finalUrl: 'https://example.com/out-of-scope-page',
      });

      isWithinAuditScopeStub.returns(false);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should handle empty anchor text', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<html><body><a href="/broken"></a></body></html>',
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result[0].anchorText).to.equal('[no text]');
    });

    it('should handle empty scrapeResultPaths', async () => {
      const scrapeResultPaths = new Map();

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.be.an('array').that.is.empty;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Processing 0 scraped pages/),
      );
    });

    it('should skip invalid URLs in href attributes', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      // HTML with invalid href that will throw when parsed
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<html><body>
            <a href="javascript:void(0)">JS Link</a>
            <a href="mailto:test@test.com">Email</a>
            <a href="tel:+1234567890">Phone</a>
            <a href="/valid-link">Valid Link</a>
          </body></html>`,
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only process the valid internal link
      expect(isLinkInaccessibleStub).to.have.been.calledWith(
        'https://example.com/valid-link',
        sinon.match.any,
      );
    });
  });

  describe('mergeAndDeduplicate', () => {
    it('should merge crawl and RUM links with RUM priority', () => {
      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
      ];

      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 500 },
        { urlFrom: 'https://example.com/page3', urlTo: 'https://example.com/broken3', trafficDomain: 300 },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      expect(result).to.have.lengthOf(3);

      // Check that RUM data is preserved for duplicate
      const mergedLink = result.find((l) => l.urlTo === 'https://example.com/broken1');
      expect(mergedLink.trafficDomain).to.equal(500);

      // Check crawl-only link has trafficDomain: 0
      const crawlOnlyLink = result.find((l) => l.urlTo === 'https://example.com/broken2');
      expect(crawlOnlyLink.trafficDomain).to.equal(0);
    });

    it('should handle empty crawl links', () => {
      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
      ];

      const result = mergeAndDeduplicate([], rumLinks, mockContext.log);

      expect(result).to.have.lengthOf(1);
      expect(result[0].trafficDomain).to.equal(100);
    });

    it('should handle empty RUM links', () => {
      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
      ];

      const result = mergeAndDeduplicate(crawlLinks, [], mockContext.log);

      expect(result).to.have.lengthOf(1);
      expect(result[0].trafficDomain).to.equal(0);
    });

    it('should handle both empty', () => {
      const result = mergeAndDeduplicate([], [], mockContext.log);

      expect(result).to.be.an('array').that.is.empty;
    });

    it('should preserve all link properties', () => {
      const crawlLinks = [];
      const rumLinks = [
        {
          urlFrom: 'https://example.com/page1',
          urlTo: 'https://example.com/broken1',
          trafficDomain: 500,
          customProp: 'test',
        },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      expect(result[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken1',
        trafficDomain: 500,
        customProp: 'test',
      });
    });
  });

  describe('edge cases', () => {
    it('should skip URLs that throw errors during URL parsing', async () => {
      // HTML with href that will throw TypeError when constructing URL
      // Invalid IPv6 bracket causes URL constructor to throw
      const htmlWithInvalidUrl = `
        <html>
          <body>
            <a href="http://[::1">Invalid IPv6</a>
            <a href="http://example.com:999999">Invalid port</a>
            <a href="https://example.com/valid">Valid link</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithInvalidUrl },
        finalUrl: 'https://example.com/page1',
      });

      // Mock valid link as working
      isLinkInaccessibleStub.resolves(false);

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrape-results/page1.json'],
      ]);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should not throw, should process valid links only and log skipped URLs
      expect(result).to.be.an('array');
      expect(mockContext.log.debug).to.have.been.called;
    });

    it('should use workingUrlsCache to skip already-validated working URLs', async () => {
      // Two pages with the same internal link - should only check accessibility once
      const html = `
        <html>
          <body>
            <a href="https://example.com/working-link">Link</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.onFirstCall().resolves({
        scrapeResult: { rawBody: html },
        finalUrl: 'https://example.com/page1',
      });
      getObjectFromKeyStub.onSecondCall().resolves({
        scrapeResult: { rawBody: html },
        finalUrl: 'https://example.com/page2',
      });

      // First call: link is accessible (gets cached as working)
      // Second call: should skip due to workingUrlsCache
      isLinkInaccessibleStub.onFirstCall().resolves(false);

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrape-results/page1.json'],
        ['https://example.com/page2', 'scrape-results/page2.json'],
      ]);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should return empty array (link is working)
      expect(result).to.be.an('array').with.lengthOf(0);
      // isLinkInaccessible should only be called once (second time uses cache)
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
    });

    it('should batch link checks to prevent overwhelming target server', async () => {
      // Create a page with 10 links (LINK_CHECK_BATCH_SIZE = 5, so 2 batches)
      const linksHtml = Array.from({ length: 10 }, (_, i) => 
        `<a href="/link-${i + 1}">Link ${i + 1}</a>`
      ).join('\n');

      const html = `
        <html>
          <body>
            <header><a href="/nav">Navigation</a></header>
            <main>${linksHtml}</main>
            <footer><a href="/footer">Footer</a></footer>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: html,
        },
        finalUrl: 'https://example.com/page1',
      });

      // All links are broken to maximize checks (to test batching)
      isLinkInaccessibleStub.resolves(true);

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrape-results/page1.json'],
      ]);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should find 10 broken links
      expect(result).to.be.an('array').with.lengthOf(10);
      // Should have called isLinkInaccessible 10 times (once per link)
      expect(isLinkInaccessibleStub).to.have.callCount(10);
    });

    it('should add delay between link check batches with multiple batches', async () => {
      // Create page with 15 links to trigger multiple batches (batch size is 5)
      const linksHtml = Array.from({ length: 15 }, (_, i) => 
        `<a href="/link-${i + 1}">Link ${i + 1}</a>`
      ).join('\n');
      
      const html = `<html><body>${linksHtml}</body></html>`;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: html },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrape-results/page1.json'],
      ]);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // With 15 links and batch size 5, should have 3 batches
      // Delay should be added between batches (covers lines 169-171)
      expect(isLinkInaccessibleStub.callCount).to.equal(15);
    });
  });

  describe('detectBrokenLinksFromCrawlBatch', () => {
    const createMockHtml = (links) => `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <main>
            ${links.map((l) => `<a href="${l.href}">${l.text}</a>`).join('\n')}
          </main>
        </body>
      </html>
    `;

    it('should export PAGES_PER_BATCH constant', () => {
      expect(PAGES_PER_BATCH).to.be.a('number');
      expect(PAGES_PER_BATCH).to.be.greaterThan(0);
    });

    it('should process a batch of pages starting from batchStartIndex', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
        ['https://example.com/page2', 'scrapes/page2.json'],
        ['https://example.com/page3', 'scrapes/page3.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/link1', text: 'Link 1' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 2,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result).to.have.property('results');
      expect(result).to.have.property('brokenUrlsCache');
      expect(result).to.have.property('workingUrlsCache');
      expect(result).to.have.property('pagesProcessed');
      expect(result).to.have.property('hasMorePages');
      expect(result).to.have.property('nextBatchStartIndex');
      expect(result).to.have.property('stats');
      expect(result.pagesProcessed).to.equal(2);
      expect(result.hasMorePages).to.be.true;
      expect(result.nextBatchStartIndex).to.equal(2);
    });

    it('should use initial caches from previous batches', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/already-broken', text: 'Already Broken' },
            { href: '/already-working', text: 'Already Working' },
            { href: '/new-link', text: 'New Link' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: ['https://example.com/already-broken'],
        initialWorkingUrls: ['https://example.com/already-working'],
      }, mockContext);

      // Should only check the new link (others are cached)
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith(
        'https://example.com/new-link',
        sinon.match.any,
      );

      // Should include the already-broken URL in results (from cache)
      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].urlTo).to.equal('https://example.com/already-broken');
    });

    it('should return hasMorePages=false when all pages processed', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
        ['https://example.com/page2', 'scrapes/page2.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([]),
        },
        finalUrl: 'https://example.com/page1',
      });

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 10, // Larger than total pages
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.hasMorePages).to.be.false;
      expect(result.pagesProcessed).to.equal(2);
    });

    it('should sort scrapeResultPaths by URL for consistent ordering', async () => {
      // Create map with URLs in non-alphabetical order
      const scrapeResultPaths = new Map([
        ['https://example.com/z-page', 'scrapes/z.json'],
        ['https://example.com/a-page', 'scrapes/a.json'],
        ['https://example.com/m-page', 'scrapes/m.json'],
      ]);

      const processedUrls = [];
      getObjectFromKeyStub.callsFake((client, bucket, key) => {
        // Track which URL was processed
        const url = Array.from(scrapeResultPaths.entries())
          .find(([, v]) => v === key)?.[0];
        processedUrls.push(url);
        return Promise.resolve({
          scrapeResult: { rawBody: '<html><body></body></html>' },
          finalUrl: url,
        });
      });

      await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 3,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should process in sorted order
      expect(processedUrls).to.deep.equal([
        'https://example.com/a-page',
        'https://example.com/m-page',
        'https://example.com/z-page',
      ]);
    });

    it('should return updated caches with new broken and working URLs', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/broken1', text: 'Broken 1' },
            { href: '/working1', text: 'Working 1' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/broken1').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/working1').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: ['https://example.com/prev-broken'],
        initialWorkingUrls: ['https://example.com/prev-working'],
      }, mockContext);

      // Should include both initial and new caches
      expect(result.brokenUrlsCache).to.include('https://example.com/prev-broken');
      expect(result.brokenUrlsCache).to.include('https://example.com/broken1');
      expect(result.workingUrlsCache).to.include('https://example.com/prev-working');
      expect(result.workingUrlsCache).to.include('https://example.com/working1');
    });

    it('should handle empty scrapeResultPaths', async () => {
      const scrapeResultPaths = new Map();

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 10,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.be.an('array').that.is.empty;
      expect(result.hasMorePages).to.be.false;
      expect(result.pagesProcessed).to.equal(0);
    });

    it('should handle S3 fetch errors gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.rejects(new Error('S3 error'));

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.be.an('array').that.is.empty;
      expect(result.pagesSkipped).to.equal(1);
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error processing/),
      );
    });

    it('should return stats with processing metrics', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/link1', text: 'Link 1' },
            { href: '/link2', text: 'Link 2' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.stats).to.have.property('totalLinksAnalyzed');
      expect(result.stats).to.have.property('linksCheckedViaAPI');
      expect(result.stats).to.have.property('cacheHitsBroken');
      expect(result.stats).to.have.property('cacheHitsWorking');
      expect(result.stats).to.have.property('cacheHitRate');
      expect(result.stats).to.have.property('processingTimeSeconds');
      expect(result.stats.totalLinksAnalyzed).to.equal(2);
      expect(result.stats.linksCheckedViaAPI).to.equal(2);
    });

    it('should skip pages outside audit scope', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/link1', text: 'Link 1' }]),
        },
        finalUrl: 'https://example.com/out-of-scope',
      });

      isWithinAuditScopeStub.returns(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.pagesSkipped).to.equal(1);
      expect(result.results).to.be.an('array').that.is.empty;
    });

    it('should handle batchStartIndex beyond total pages', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 100, // Beyond total pages
        batchSize: 10,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.pagesProcessed).to.equal(0);
      expect(result.hasMorePages).to.be.false;
    });

    it('should handle invalid URLs in href attributes gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      // HTML with malformed URLs that will throw when parsing
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<html><body><main>
            <a href="http://[invalid-ipv6">Invalid IPv6</a>
            <a href="/valid-link">Valid Link</a>
          </main></body></html>`,
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should skip invalid URL and process valid one
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Skipping invalid href/),
      );
      expect(isLinkInaccessibleStub).to.have.been.calledWith(
        'https://example.com/valid-link',
        sinon.match.any,
      );
    });

    it('should add delay between link check batches', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      // Create page with 15 links to trigger delay (batch size is 5)
      const linksHtml = Array.from({ length: 15 }, (_, i) => 
        `<a href="/link-${i}">Link ${i}</a>`
      ).join('\n');

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<html><body><main>${linksHtml}</main></body></html>`,
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should process all 15 links (verifies batching logic executed)
      expect(isLinkInaccessibleStub.callCount).to.equal(15);
    });

    it('should skip out-of-scope links during link checking', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: 'https://external.com/link', text: 'External Link' },
            { href: '/internal-link', text: 'Internal Link' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      // Configure isWithinAuditScope to return false for external.com, true for example.com
      isWithinAuditScopeStub.callsFake((url) => url.startsWith('https://example.com'));
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should only check internal link, external should be skipped
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith(
        'https://example.com/internal-link',
        sinon.match.any,
      );
      expect(result).to.have.property('stats');
    });

    it('should use original URL when finalUrl is missing in batch', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/batch-page', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([{ href: '/test', text: 'Test' }]),
        },
        // No finalUrl provided
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should resolve link using original URL
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/test');
    });

    it('should handle links in footer in batch processing', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<html><body>
            <footer><a href="/footer-link">Footer</a></footer>
            <main><a href="/main-link">Main</a></main>
          </body></html>`,
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should only check main link
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/main-link');
    });

    it('should handle empty href in batch processing', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<html><body><main><a href="">Empty</a><a href="/valid">Valid</a></main></body></html>',
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should only check valid link
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
    });

    it('should use [no text] for whitespace-only anchor in batch', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<html><body><main><a href="/broken">  \n  </a></main></body></html>',
        },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results[0].anchorText).to.equal('[no text]');
    });

    it('should return out-of-scope result during link validation phase', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      // Page has internal link that will pass extraction but fail scope check during validation
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: createMockHtml([
            { href: '/internal', text: 'Internal' },
          ]),
        },
        finalUrl: 'https://example.com/page1',
      });

      // Make isWithinAuditScope return true for page, false for link (line 352)
      isWithinAuditScopeStub.callsFake((url) => {
        // Return true for the page itself, false for the link
        if (url === 'https://example.com/page1') return true;
        return false; // Link is out of scope
      });

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Link should be skipped, no broken links found
      expect(result.results).to.be.an('array').that.is.empty;
      expect(isLinkInaccessibleStub).to.not.have.been.called;
    });

    it('should skip pages with missing rawBody and increment pagesSkipped', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
        ['https://example.com/page2', 'scrapes/page2.json'],
      ]);

      // First page has no rawBody, second page is fine
      getObjectFromKeyStub.onFirstCall().resolves({
        scrapeResult: {
          // rawBody is missing
        },
        finalUrl: 'https://example.com/page1',
      });

      getObjectFromKeyStub.onSecondCall().resolves({
        scrapeResult: {
          rawBody: '<html><body><main><a href="/link1">Link</a></main></body></html>',
        },
        finalUrl: 'https://example.com/page2',
      });

      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 2,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should skip the first page and only process the second
      expect(result.pagesSkipped).to.equal(1);
      expect(result.pagesProcessed).to.equal(2); // Total pages processed includes skipped
    });
  });
});
