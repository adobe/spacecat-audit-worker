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
  let mergeAndDeduplicate;
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
    mergeAndDeduplicate = module.mergeAndDeduplicate;

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
      // Create page with 25 links to trigger multiple batches (batch size is 20)
      const linksHtml = Array.from({ length: 25 }, (_, i) => 
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

      // With 25 links and batch size 20, should have 2 batches
      // Delay should be added between batches (covers lines 169-171)
      expect(isLinkInaccessibleStub.callCount).to.equal(25);
    });
  });
});
