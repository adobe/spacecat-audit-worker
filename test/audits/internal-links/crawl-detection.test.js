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

      // Should check both footer and main links
      expect(isLinkInaccessibleStub).to.have.been.calledTwice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/footer-link');
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

    it('should detect broken CSS and JS assets', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithAssets = `
        <html>
          <head>
            <link rel="stylesheet" href="/styles.css">
            <link rel="stylesheet" href="https://example.com/theme.css">
            <script src="/app.js"></script>
            <script src="https://example.com/bundle.js"></script>
          </head>
          <body>
            <main><p>Content</p></main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithAssets },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/styles.css').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/theme.css').resolves(false);
      isLinkInaccessibleStub.withArgs('https://example.com/app.js').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/bundle.js').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.have.lengthOf(2);
      expect(result.results[0].urlTo).to.equal('https://example.com/styles.css');
      expect(result.results[0].itemType).to.equal('css');
      expect(result.results[1].urlTo).to.equal('https://example.com/app.js');
      expect(result.results[1].itemType).to.equal('js');
    });

    it('should handle CSS links with hash fragments', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithHashCss = `
        <html>
          <head>
            <link rel="stylesheet" href="#inline-styles">
            <link rel="stylesheet" href="/valid.css">
          </head>
          <body><main><p>Content</p></main></body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithHashCss },
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

      // Should skip hash-only CSS link
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid.css');
    });

    it('should handle script tags with hash fragments', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithHashJs = `
        <html>
          <head>
            <script src="#inline-script"></script>
            <script src="/valid.js"></script>
          </head>
          <body><main><p>Content</p></main></body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithHashJs },
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

      // Should skip hash-only script
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid.js');
    });

    it('should detect broken CSS assets', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithCss = `
        <html>
          <head>
            <link rel="stylesheet" href="/styles.css">
            <link rel="stylesheet" href="/theme.css">
          </head>
          <body><main><p>Content</p></main></body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithCss },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/styles.css').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/theme.css').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].urlTo).to.equal('https://example.com/styles.css');
      expect(result.results[0].itemType).to.equal('css');
    });

    it('should detect broken JS assets', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithJs = `
        <html>
          <head>
            <script src="/app.js"></script>
            <script src="/bundle.js"></script>
          </head>
          <body><main><p>Content</p></main></body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithJs },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/app.js').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/bundle.js').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].urlTo).to.equal('https://example.com/app.js');
      expect(result.results[0].itemType).to.equal('js');
    });

    it('should detect broken image assets', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithImages = `
        <html>
          <body>
            <main>
              <img src="/broken.png" alt="Broken">
              <img src="/working.jpg" alt="Working">
              <img src="data:image/png;base64,abc" alt="Data URL">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithImages },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/broken.png').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/working.jpg').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].urlTo).to.equal('https://example.com/broken.png');
      expect(result.results[0].itemType).to.equal('image');
    });

    it('should detect broken SVG assets', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithSvg = `
        <html>
          <body>
            <main>
              <img src="/icon.svg" alt="Icon">
              <img src="/logo.SVG" alt="Logo uppercase">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithSvg },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/icon.svg').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/logo.SVG').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].urlTo).to.equal('https://example.com/icon.svg');
      expect(result.results[0].itemType).to.equal('svg');
    });

    it('should skip images with data URLs', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithDataUrl = `
        <html>
          <body>
            <main>
              <img src="data:image/png;base64,iVBORw0KG" alt="Data">
              <img src="/valid.png" alt="Valid">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithDataUrl },
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

      // Should skip data URL
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid.png');
    });

    it('should skip images with hash-only src', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithHashImg = `
        <html>
          <body>
            <main>
              <img src="#placeholder" alt="Placeholder">
              <img src="/valid.png" alt="Valid">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithHashImg },
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

      // Should skip hash-only src
      expect(isLinkInaccessibleStub).to.have.been.calledOnce;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid.png');
    });

    it('should handle subdomains for assets (CDN case)', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithCdnAssets = `
        <html>
          <head>
            <link rel="stylesheet" href="https://cdn.example.com/styles.css">
            <script src="https://assets.example.com/app.js"></script>
          </head>
          <body>
            <main>
              <img src="https://images.example.com/photo.jpg" alt="Photo">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithCdnAssets },
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

      // All CDN assets should be checked
      expect(isLinkInaccessibleStub).to.have.been.calledThrice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://cdn.example.com/styles.css');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://assets.example.com/app.js');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://images.example.com/photo.jpg');
    });

    it('should handle external assets (non-matching hostnames)', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scrapes/page1.json'],
      ]);

      const htmlWithExternalAssets = `
        <html>
          <head>
            <link rel="stylesheet" href="https://external.com/styles.css">
            <link rel="stylesheet" href="/internal.css">
            <script src="https://external.com/app.js"></script>
            <script src="/internal.js"></script>
          </head>
          <body>
            <main>
              <img src="https://external.com/image.png" alt="External">
              <img src="/internal.png" alt="Internal">
            </main>
          </body>
        </html>
      `;

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: htmlWithExternalAssets },
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

      // Should only check internal assets
      expect(isLinkInaccessibleStub).to.have.been.calledThrice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/internal.css');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/internal.js');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/internal.png');
    });
  });

  describe('mergeAndDeduplicate - uncovered branches', () => {
    it('should handle empty RUM links array', () => {
      const mockLog = {
        info: sinon.stub(),
      };

      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
      ];
      const rumLinks = [];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockLog);

      expect(result).to.have.lengthOf(2);
      expect(mockLog.info).to.have.been.calledWith('Merged: 0 RUM + 2 crawl-only = 2 total');
    });

    it('should handle empty crawl links array', () => {
      const mockLog = {
        info: sinon.stub(),
      };

      const crawlLinks = [];
      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 100 },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockLog);

      expect(result).to.have.lengthOf(1);
      expect(mockLog.info).to.have.been.calledWith('Merged: 1 RUM + 0 crawl-only = 1 total');
    });
  });

  describe('Form Actions and Additional Link Types', () => {
    const createMockHtmlWithForms = () => `
      <html>
        <head>
          <title>Test Page</title>
          <link rel="canonical" href="https://example.com/canonical-page" />
          <link rel="alternate" hreflang="es" href="https://example.com/es/page" />
          <link rel="alternate" hreflang="fr" href="https://example.com/fr/page" />
        </head>
        <body>
          <a href="https://example.com/regular-link">Regular Link</a>
          <form action="https://example.com/submit-form" method="POST">
            <input type="text" name="field" />
          </form>
          <form action="https://example.com/another-submit" method="GET">
            <input type="text" name="query" />
          </form>
          <form action="#fragment-only">
            <input type="text" name="ignored" />
          </form>
          <form action="javascript:void(0)">
            <input type="text" name="ignored" />
          </form>
        </body>
      </html>
    `;

    it('should extract form action URLs', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: createMockHtmlWithForms() },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/submit-form').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/another-submit').resolves(false);
      isLinkInaccessibleStub.withArgs('https://example.com/regular-link').resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should find broken form action
      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0]).to.deep.include({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/submit-form',
        itemType: 'form',
        anchorText: '[form action]',
      });
    });

    it('should extract canonical link URLs', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: createMockHtmlWithForms() },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/canonical-page').resolves(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should find broken canonical link
      const canonicalLink = result.results.find((r) => r.itemType === 'canonical');
      expect(canonicalLink).to.exist;
      expect(canonicalLink).to.deep.include({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/canonical-page',
        itemType: 'canonical',
        anchorText: '[canonical]',
      });
    });

    it('should extract alternate language links', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: createMockHtmlWithForms() },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/es/page').resolves(true);
      isLinkInaccessibleStub.withArgs('https://example.com/fr/page').resolves(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should find broken alternate links
      const alternateLinks = result.results.filter((r) => r.itemType === 'alternate');
      expect(alternateLinks).to.have.lengthOf(2);
      
      const esLink = alternateLinks.find((r) => r.anchorText === '[alternate:es]');
      expect(esLink).to.exist;
      expect(esLink.urlTo).to.equal('https://example.com/es/page');

      const frLink = alternateLinks.find((r) => r.anchorText === '[alternate:fr]');
      expect(frLink).to.exist;
      expect(frLink.urlTo).to.equal('https://example.com/fr/page');
    });

    it('should ignore form actions with hash-only or javascript URLs', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: createMockHtmlWithForms() },
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

      // Should NOT check form actions with # or javascript:
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('#fragment-only');
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('javascript:void(0)');
    });

    it('should preserve original URL encoding when extracting links (no pre-validation normalization)', async () => {
      const htmlWithEncodedUrls = `
        <html>
          <head>
            <link rel="canonical" href="https://example.com/page/" />
          </head>
          <body>
            <a href="https://example.com/path/with%20spaces/">Link with spaces</a>
            <form action="https://www.example.com/submit/">
              <input type="text" />
            </form>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithEncodedUrls },
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

      // URLs reported as-is (no %20→hyphen) so broken canonicals with wrong encoding are caught
      expect(result.results).to.have.lengthOf(3);

      const linkResult = result.results.find((r) => r.itemType === 'link');
      expect(linkResult.urlTo).to.equal('https://example.com/path/with%20spaces/');

      const formResult = result.results.find((r) => r.itemType === 'form');
      expect(formResult.urlTo).to.equal('https://www.example.com/submit/');

      const canonicalResult = result.results.find((r) => r.itemType === 'canonical');
      expect(canonicalResult.urlTo).to.equal('https://example.com/page/');
    });

    it('should skip canonical links without href attribute', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      const htmlWithEmptyCanonical = `
        <html>
          <head>
            <link rel="canonical">
          </head>
          <body>
            <a href="/valid-link">Valid</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithEmptyCanonical },
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

      // Should skip canonical without href
      const canonicalLinks = result.results.filter((r) => r.itemType === 'canonical');
      expect(canonicalLinks).to.have.lengthOf(0);
    });

    it('should handle invalid canonical link URLs gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      const htmlWithInvalidCanonical = `
        <html>
          <head>
            <link rel="canonical" href="http://[invalid-bracket">
          </head>
          <body>
            <a href="/valid-link">Valid</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithInvalidCanonical },
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

      // Should skip invalid canonical and process valid link
      expect(result.results).to.have.lengthOf(0);
      const canonicalLinks = result.results.filter((r) => r.itemType === 'canonical');
      expect(canonicalLinks).to.have.lengthOf(0);
    });

    it('should handle invalid form action URLs gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      const htmlWithInvalidForm = `
        <html>
          <body>
            <form action="http://]invalid-bracket">
              <input type="text" name="test" />
            </form>
            <a href="/valid-link">Valid</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithInvalidForm },
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

      // Should skip invalid form action and process valid link
      expect(result.results).to.have.lengthOf(0);
      const formLinks = result.results.filter((r) => r.itemType === 'form');
      expect(formLinks).to.have.lengthOf(0);
    });

    it('should skip alternate links without href attribute', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      const htmlWithEmptyAlternate = `
        <html>
          <head>
            <link rel="alternate" hreflang="es">
            <link rel="alternate" hreflang="fr" href="/valid-fr">
          </head>
          <body>
            <a href="/valid-link">Valid</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithEmptyAlternate },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/valid-fr').resolves(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should skip alternate without href but process valid one
      const alternateLinks = result.results.filter((r) => r.itemType === 'alternate');
      expect(alternateLinks).to.have.lengthOf(1);
      expect(alternateLinks[0].urlTo).to.equal('https://example.com/valid-fr');
    });

    it('should handle invalid alternate link URLs gracefully', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      const htmlWithInvalidAlternate = `
        <html>
          <head>
            <link rel="alternate" hreflang="es" href="http:// invalid-space">
            <link rel="alternate" hreflang="fr" href="/valid-fr">
          </head>
          <body>
            <a href="/valid-link">Valid</a>
          </body>
        </html>
      `;

      getObjectFromKeyStub.withArgs(sinon.match.any, 'test-bucket', 's3-key-1').resolves({
        scrapeResult: { rawBody: htmlWithInvalidAlternate },
        finalUrl: 'https://example.com/page1',
      });

      isLinkInaccessibleStub.withArgs('https://example.com/valid-fr').resolves(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawlBatch({
        scrapeResultPaths,
        batchStartIndex: 0,
        batchSize: 1,
        initialBrokenUrls: [],
        initialWorkingUrls: [],
      }, mockContext);

      // Should skip invalid alternate but process valid one
      const alternateLinks = result.results.filter((r) => r.itemType === 'alternate');
      expect(alternateLinks).to.have.lengthOf(1);
      expect(alternateLinks[0].urlTo).to.equal('https://example.com/valid-fr');
      expect(alternateLinks[0].anchorText).to.equal('[alternate:fr]');
    });
  });

});
