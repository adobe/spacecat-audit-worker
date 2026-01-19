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
import nock from 'nock';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('Crawl Detection for Broken Internal Links', () => {
  let detectBrokenLinksFromCrawl;
  let mergeAndDeduplicate;
  let getObjectFromKeyStub;
  let isLinkInaccessibleStub;
  let isWithinAuditScopeStub;

  const baseURL = 'https://example.com';
  const site = {
    getBaseURL: () => baseURL,
    getId: () => 'site-id-1',
  };

  const mockScrapedHTML = `
    <html>
      <body>
        <header><a href="/nav-link">Nav</a></header>
        <main>
          <a href="/good-link">Good Link</a>
          <a href="/broken-link">Broken Link</a>
          <a href="https://external.com/link">External Link</a>
        </main>
        <footer><a href="/footer-link">Footer</a></footer>
      </body>
    </html>
  `;

  const mockContext = {
    s3Client: {},
    env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
    log: {
      info: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    },
    site,
  };

  before(async () => {
    // Create stubs for dependencies
    getObjectFromKeyStub = sinon.stub();
    isLinkInaccessibleStub = sinon.stub();
    isWithinAuditScopeStub = sinon.stub();

    // Mock the module with stubs
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
  });

  afterEach(() => {
    sandbox.reset();
    getObjectFromKeyStub.reset();
    isLinkInaccessibleStub.reset();
    isWithinAuditScopeStub.reset();
    nock.cleanAll();
  });

  after(() => {
    sandbox.restore();
  });

  describe('detectBrokenLinksFromCrawl', () => {
    it('should detect broken internal links from scraped HTML', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      // Mock S3 object
      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: mockScrapedHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      // Mock audit scope check (all links within scope)
      isWithinAuditScopeStub.returns(true);

      // Mock link accessibility checks
      isLinkInaccessibleStub.withArgs('https://example.com/good-link').resolves(false);
      isLinkInaccessibleStub.withArgs('https://example.com/broken-link').resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken-link',
        trafficDomain: 0,
      });

      expect(getObjectFromKeyStub).to.have.been.calledOnceWith(
        mockContext.s3Client,
        'test-bucket',
        's3-key-1',
        mockContext.log,
      );

      // Should only check internal links (not external)
      expect(isLinkInaccessibleStub).to.have.been.calledTwice;
    });

    it('should skip links in header and footer', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: mockScrapedHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should NOT check /nav-link or /footer-link (header/footer links)
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://example.com/nav-link');
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://example.com/footer-link');
    });

    it('should deduplicate broken links by urlFrom|urlTo', async () => {
      const duplicateHTML = `
        <html>
          <body>
            <main>
              <a href="/broken-link">Broken Link 1</a>
              <a href="/broken-link">Broken Link 2</a>
              <a href="/broken-link">Broken Link 3</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: duplicateHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only have 1 entry despite 3 links to same URL
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken-link',
        trafficDomain: 0,
      });
    });

    it('should filter links by audit scope', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/en/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: `<a href="/en/link1">Link1</a><a href="/fr/link2">Link2</a>`,
        },
        finalUrl: 'https://example.com/en/page1',
      });

      // Only /en links are within scope
      isWithinAuditScopeStub.callsFake((url, base) => url.includes('/en'));
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only include /en/link1 (within scope)
      expect(result).to.have.lengthOf(1);
      expect(result[0].urlTo).to.equal('https://example.com/en/link1');
    });

    it('should handle missing or invalid S3 objects', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
        ['https://example.com/page2', 's3-key-2'],
      ]);

      // First page has no rawBody, second page is valid
      getObjectFromKeyStub.onFirstCall().resolves({
        scrapeResult: {},
      });

      getObjectFromKeyStub.onSecondCall().resolves({
        scrapeResult: {
          rawBody: '<a href="/broken">Broken</a>',
        },
        finalUrl: 'https://example.com/page2',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only process page2 (page1 had no rawBody)
      expect(result).to.have.lengthOf(1);
      expect(result[0].urlFrom).to.equal('https://example.com/page2');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/No rawBody in scrapeResult/),
      );
    });

    it('should handle errors gracefully for individual pages', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
        ['https://example.com/page2', 's3-key-2'],
      ]);

      // First page throws error, second page succeeds
      getObjectFromKeyStub.onFirstCall().rejects(new Error('S3 error'));
      getObjectFromKeyStub.onSecondCall().resolves({
        scrapeResult: {
          rawBody: '<a href="/broken">Broken</a>',
        },
        finalUrl: 'https://example.com/page2',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should still process page2 despite page1 error
      expect(result).to.have.lengthOf(1);
      expect(result[0].urlFrom).to.equal('https://example.com/page2');
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error processing.*page1/),
      );
    });

    it('should only check internal links (same origin)', async () => {
      const mixedLinksHTML = `
        <html>
          <body>
            <main>
              <a href="/internal-link">Internal</a>
              <a href="https://external.com/link">External</a>
              <a href="https://example.com/absolute-internal">Absolute Internal</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: mixedLinksHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should only check internal links (not external.com)
      expect(isLinkInaccessibleStub).to.have.been.calledTwice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/internal-link');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/absolute-internal');
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://external.com/link');
    });

    it('should handle www vs non-www subdomains correctly', async () => {
      // Site baseURL is example.com, but scraped pages are from www.example.com
      const siteWithoutWww = {
        getBaseURL: () => 'https://example.com',
        getId: () => 'site-id-1',
      };

      const contextWithoutWww = {
        ...mockContext,
        site: siteWithoutWww,
      };

      const mixedLinksHTML = `
        <html>
          <body>
            <main>
              <a href="/page1">Relative Link</a>
              <a href="https://www.example.com/page2">Absolute with www</a>
              <a href="https://example.com/page3">Absolute without www</a>
              <a href="https://other.com/page4">External</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://www.example.com/start', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: mixedLinksHTML,
        },
        finalUrl: 'https://www.example.com/start',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      await detectBrokenLinksFromCrawl(scrapeResultPaths, contextWithoutWww);

      // Should check all internal links regardless of www
      expect(isLinkInaccessibleStub).to.have.been.calledThrice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://www.example.com/page1');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://www.example.com/page2');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/page3');
      // Should NOT check external link
      expect(isLinkInaccessibleStub).to.not.have.been.calledWith('https://other.com/page4');
    });

    it('should handle invalid hrefs gracefully', async () => {
      const invalidHrefHTML = `
        <html>
          <body>
            <main>
              <a href="javascript:void(0)">Invalid</a>
              <a href="/valid-link">Valid</a>
              <a href="">Empty</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: invalidHrefHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should check valid link and empty href (which resolves to page itself)
      expect(isLinkInaccessibleStub).to.have.been.calledTwice;
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/valid-link');
      expect(isLinkInaccessibleStub).to.have.been.calledWith('https://example.com/page1');
      expect(result).to.have.lengthOf(0);
    });

    it('should handle pages with no internal links', async () => {
      const noInternalLinksHTML = `
        <html>
          <body>
            <main>
              <a href="https://external.com/link1">External 1</a>
              <a href="https://external.com/link2">External 2</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: noInternalLinksHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should not check any links since they're all external
      expect(isLinkInaccessibleStub).to.not.have.been.called;
      expect(result).to.have.lengthOf(0);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/No internal links to validate/),
      );
    });

    it('should handle when getObjectFromKey returns null', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      // Simulate getObjectFromKey returning null
      getObjectFromKeyStub.resolves(null);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should return empty result and log warning
      expect(result).to.have.lengthOf(0);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/No object returned from S3 for https:\/\/example\.com\/page1/),
      );
    });

    it('should handle when object has no scrapeResult', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      // Simulate object without scrapeResult
      getObjectFromKeyStub.resolves({
        finalUrl: 'https://example.com/page1',
        // No scrapeResult property
      });

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should return empty result and log warning
      expect(result).to.have.lengthOf(0);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/No scrapeResult in object for https:\/\/example\.com\/page1/),
      );
    });

    it('should log debug message when page is out of scope', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/fr/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: '<a href="/fr/link1">Link1</a>',
        },
        finalUrl: 'https://example.com/fr/page1',
      });

      // Page is out of scope
      isWithinAuditScopeStub.callsFake((url) => !url.includes('/fr/'));
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // Should filter out the link since page is out of scope
      expect(result).to.have.lengthOf(0);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Page.*is out of audit scope, skipping link validation/),
      );
    });

    it('should handle malformed URLs that cause new URL() to throw', async () => {
      // Use an invalid base URL (finalUrl) to trigger URL parsing errors
      const htmlWithLinks = `
        <html>
          <body>
            <main>
              <a href="/some-link">Link</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: htmlWithLinks,
        },
        finalUrl: 'not-a-valid-url', // Invalid base URL will cause new URL() to throw
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // With invalid base URL, all hrefs should fail to parse and be caught
      // No links should be validated
      expect(isLinkInaccessibleStub).to.not.have.been.called;
      expect(result).to.have.lengthOf(0);

      // Verify the page was processed despite URL parsing errors
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Processing page/),
      );
    });

    it('should log sample of internal links when there are more than 5', async () => {
      // Create HTML with 8 internal links to trigger the "and X more" logging
      const manyLinksHTML = `
        <html>
          <body>
            <main>
              <a href="/link1">Link 1</a>
              <a href="/link2">Link 2</a>
              <a href="/link3">Link 3</a>
              <a href="/link4">Link 4</a>
              <a href="/link5">Link 5</a>
              <a href="/link6">Link 6</a>
              <a href="/link7">Link 7</a>
              <a href="/link8">Link 8</a>
            </main>
          </body>
        </html>
      `;

      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 's3-key-1'],
      ]);

      getObjectFromKeyStub.resolves({
        scrapeResult: {
          rawBody: manyLinksHTML,
        },
        finalUrl: 'https://example.com/page1',
      });

      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(false);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      // All links should be accessible (no broken links)
      expect(result).to.have.lengthOf(0);

      // Verify sample logging (first 5 links)
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Sample resolved internal links:.*link1.*link2.*link3.*link4.*link5/),
      );

      // Verify "and X more" logging when there are more than 5 links
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/\.\.\. and 3 more internal links on this page/),
      );
    });
  });

  describe('mergeAndDeduplicate', () => {
    it('should merge crawl and RUM links, prioritizing RUM traffic data', () => {
      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page3', urlTo: 'https://example.com/broken3', trafficDomain: 0 },
      ];

      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 500 },
        { urlFrom: 'https://example.com/page4', urlTo: 'https://example.com/broken4', trafficDomain: 300 },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      expect(result).to.have.lengthOf(4); // 2 from RUM, 2 unique from crawl

      // Find the merged link
      const mergedLink = result.find((l) => l.urlTo === 'https://example.com/broken1');
      expect(mergedLink.trafficDomain).to.equal(500); // RUM data preserved

      // Crawl-only links should have trafficDomain: 0
      const crawlOnlyLink = result.find((l) => l.urlTo === 'https://example.com/broken2');
      expect(crawlOnlyLink.trafficDomain).to.equal(0);
    });

    it('should deduplicate by urlFrom|urlTo key', () => {
      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
      ];

      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 500 },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      // Should only have 1 entry despite duplicates
      expect(result).to.have.lengthOf(1);
      expect(result[0].trafficDomain).to.equal(500);
    });

    it('should handle empty arrays', () => {
      const result1 = mergeAndDeduplicate([], [], mockContext.log);
      expect(result1).to.have.lengthOf(0);

      const result2 = mergeAndDeduplicate(
        [{ urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 }],
        [],
        mockContext.log,
      );
      expect(result2).to.have.lengthOf(1);

      const result3 = mergeAndDeduplicate(
        [],
        [{ urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 500 }],
        mockContext.log,
      );
      expect(result3).to.have.lengthOf(1);
    });

    it('should preserve all RUM link properties', () => {
      const crawlLinks = [];

      const rumLinks = [
        {
          urlFrom: 'https://example.com/page1',
          urlTo: 'https://example.com/broken1',
          trafficDomain: 500,
          additionalProperty: 'test',
        },
      ];

      const result = mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      expect(result[0]).to.deep.equal({
        urlFrom: 'https://example.com/page1',
        urlTo: 'https://example.com/broken1',
        trafficDomain: 500,
        additionalProperty: 'test',
      });
    });

    it('should log merge statistics', () => {
      const crawlLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 0 },
        { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2', trafficDomain: 0 },
      ];

      const rumLinks = [
        { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1', trafficDomain: 500 },
      ];

      mergeAndDeduplicate(crawlLinks, rumLinks, mockContext.log);

      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Added 1 RUM-detected links/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Crawl-only links: 1/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Total merged: 2 unique broken links/),
      );
    });
  });

  describe('finalUrl fallback', () => {
    it('should use url as fallback when finalUrl is missing', async () => {
      const html = `<html><body><a href="/broken">Link</a></body></html>`;
      const scrapeResultPaths = new Map([['https://example.com/page1', 's3-key-1']]);

      getObjectFromKeyStub.resolves({
        scrapeResult: { rawBody: html },
        // No finalUrl field - should fallback to url
      });
      isWithinAuditScopeStub.returns(true);
      isLinkInaccessibleStub.resolves(true);

      const result = await detectBrokenLinksFromCrawl(scrapeResultPaths, mockContext);

      expect(result).to.have.lengthOf(1);
      expect(result[0].urlFrom).to.equal('https://example.com/page1');
      expect(result[0].urlTo).to.equal('https://example.com/broken');
    });
  });
});
