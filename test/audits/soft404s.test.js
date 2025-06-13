/*
 * Copyright 2024 Adobe. All rights reserved.
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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import nock from 'nock';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  importTopPages,
  submitForScraping,
  fetchAndProcessPageObject,
  soft404sAutoDetect,
  soft404sAuditRunner,
} from '../../src/soft404s/handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Soft404s Tests', () => {
  let site;
  let context;
  let s3ClientStub;
  let logStub;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    s3ClientStub = {
      send: sinon.stub(),
    };

    site = {
      getId: sinon.stub().returns('test-site-id'),
      getBaseURL: sinon.stub().returns('http://example.com'),
      getIsLive: sinon.stub().returns(true),
      getConfig: sinon.stub().resolves({
        getIncludedURLs: sinon.stub().returns([]),
      }),
    };

    context = {
      site,
      log: logStub,
      s3Client: s3ClientStub,
      dataAccess: {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub(),
        },
      },
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
      },
      baseURL: 'https://example.com',
    };
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('importTopPages', () => {
    it('should return import configuration for top pages', async () => {
      const result = await importTopPages(context);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'test-site-id',
        auditResult: { status: 'preparing', finalUrl: undefined },
        fullAuditRef: 'scrapes/test-site-id/',
        finalUrl: undefined,
      });
    });

    it('should log import message', async () => {
      context.finalUrl = 'https://example.com';
      await importTopPages(context);

      expect(logStub.info).to.have.been.calledWith(
        'Importing top pages for https://example.com',
      );
    });
  });

  describe('submitForScraping', () => {
    it('should return URLs for scraping when top pages exist', async () => {
      const topPages = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page2' },
      ];
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
      ]);
      expect(result.siteId).to.equal('test-site-id');
      expect(result.type).to.equal('soft404s');
    });

    it('should throw error when no top pages found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(submitForScraping(context)).to.be.rejectedWith(
        'No top pages found for site',
      );
    });

    it('should handle site config without included URLs', async () => {
      const topPages = [{ getUrl: () => 'https://example.com/page1' }];
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      // Override the config to return null for includedURLs
      const mockConfigWithNull = {
        getIncludedURLs: sinon.stub().returns(null),
      };
      site.getConfig.resolves(mockConfigWithNull);

      const result = await submitForScraping(context);

      expect(result.urls).to.deep.equal([{ url: 'https://example.com/page1' }]);
    });

    it('should remove duplicate URLs', async () => {
      const topPages = [
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/included' },
      ];
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      // Set up the included URLs mock to include a duplicate
      const mockConfigWithDuplicate = {
        getIncludedURLs: sinon.stub().withArgs('soft404s').returns(['https://example.com/included']),
      };
      site.getConfig.resolves(mockConfigWithDuplicate);

      const result = await submitForScraping(context);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls).to.deep.equal([
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/included' },
      ]);
    });
  });

  describe('fetchAndProcessPageObject', () => {
    const bucketName = 'test-bucket';
    const key = 'scrapes/test-site-id/page1/scrape.json';
    const prefix = 'scrapes/test-site-id/';

    it('should process valid page object successfully', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Test Title' },
          rawBody: '<html><body>Test content</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        bucketName,
        key,
        prefix,
        logStub,
      );

      expect(result).to.deep.equal({
        '/page1': {
          rawBody: '<html><body>Test content</body></html>',
          finalUrl: 'https://example.com/page1',
        },
      });
    });

    it('should handle homepage URL correctly', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/',
        scrapeResult: {
          tags: { title: 'Home' },
          rawBody: '<html><body>Home content</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      const homeKey = 'scrapes/test-site-id/scrape.json';
      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        bucketName,
        homeKey,
        prefix,
        logStub,
      );

      expect(result).to.deep.equal({
        '/': {
          rawBody: '<html><body>Home content</body></html>',
          finalUrl: 'https://example.com/',
        },
      });
    });

    it('should return null when no scraped tags found', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {},
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        bucketName,
        key,
        prefix,
        logStub,
      );

      expect(result).to.be.null;
      expect(logStub.error).to.have.been.calledWith(
        `No Scraped tags found in S3 ${key} object`,
      );
    });

    it('should return null when scrapeResult.tags is not an object', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: 'invalid',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        bucketName,
        key,
        prefix,
        logStub,
      );

      expect(result).to.be.null;
      expect(logStub.error).to.have.been.calledWith(
        `No Scraped tags found in S3 ${key} object`,
      );
    });

    it('should derive pageUrl from key when finalUrl is missing', async () => {
      const mockObject = {
        scrapeResult: {
          tags: { title: 'Test' },
          rawBody: '<html><body>Test</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        bucketName,
        key,
        prefix,
        logStub,
      );

      expect(result).to.deep.equal({
        '/page1': {
          rawBody: '<html><body>Test</body></html>',
          finalUrl: undefined,
        },
      });
    });

    it('should handle missing finalUrl in page object', async () => {
      const testKey = 'scrapes/test-site-id/some-page/scrape.json';
      const testPrefix = 'scrapes/test-site-id/';
      const testBucketName = 'test-bucket';

      const pageObject = {
        // No finalUrl provided
        scrapeResult: {
          tags: { title: 'Valid Page' },
          rawBody: '<html><body>Valid content</body></html>',
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(pageObject) },
          ContentType: 'application/json',
        });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        testBucketName,
        testKey,
        testPrefix,
        logStub,
      );

      expect(result).to.deep.equal({
        '/some-page': {
          rawBody: '<html><body>Valid content</body></html>',
          finalUrl: undefined,
        },
      });
    });

    it('should handle homepage path correctly when finalUrl is missing', async () => {
      const testKey = 'scrapes/test-site-id/scrape.json'; // This will result in empty pageUrl
      const testPrefix = 'scrapes/test-site-id/';
      const testBucketName = 'test-bucket';

      const pageObject = {
        // No finalUrl provided, key represents homepage
        scrapeResult: {
          tags: { title: 'Homepage' },
          rawBody: '<html><body>Homepage content</body></html>',
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(pageObject) },
          ContentType: 'application/json',
        });

      const result = await fetchAndProcessPageObject(
        s3ClientStub,
        testBucketName,
        testKey,
        testPrefix,
        logStub,
      );

      expect(result).to.deep.equal({
        '/': {
          rawBody: '<html><body>Homepage content</body></html>',
          finalUrl: undefined,
        },
      });
    });

    it('should handle invalid HTML input in extractTextAndCountWords', async () => {
      const { extractTextAndCountWords } = await import('../../src/soft404s/utils.js');

      // Test null input
      let result = extractTextAndCountWords(null);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      // Test undefined input
      result = extractTextAndCountWords(undefined);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      // Test non-string input
      result = extractTextAndCountWords(123);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      // Test empty string
      result = extractTextAndCountWords('');
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });
    });

    it('should handle invalid input in checkSoft404Indicators', async () => {
      const { checkSoft404Indicators } = await import('../../src/soft404s/utils.js');

      // Test null input
      let result = checkSoft404Indicators(null);
      expect(result).to.deep.equal([]);

      // Test undefined input
      result = checkSoft404Indicators(undefined);
      expect(result).to.deep.equal([]);

      // Test empty string
      result = checkSoft404Indicators('');
      expect(result).to.deep.equal([]);

      // Test content with no indicators
      result = checkSoft404Indicators('This is normal content');
      expect(result).to.deep.equal([]);

      // Test content with indicators
      result = checkSoft404Indicators('Page not found - sorry');
      expect(result).to.include('page not found');
    });
  });

  describe('soft404sAutoDetect', () => {
    const pagesSet = new Set([
      'scrapes/test-site-id/page1/scrape.json',
      'scrapes/test-site-id/page2/scrape.json',
    ]);

    beforeEach(() => {
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          Contents: [
            { Key: 'scrapes/test-site-id/page1/scrape.json' },
            { Key: 'scrapes/test-site-id/page2/scrape.json' },
            { Key: 'scrapes/test-site-id/other/scrape.json' },
          ],
        });
    });

    it('should detect soft 404 pages correctly', async () => {
      const page1Object = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Page not found' },
          rawBody:
            '<html><body><h1>Page not found</h1><p>Sorry, we could not find the page you are looking for.</p></body></html>',
        },
      };

      const page2Object = {
        finalUrl: 'https://example.com/page2',
        scrapeResult: {
          tags: { title: 'Normal Page' },
          rawBody: `<html><body>${'Valid content '.repeat(100)}</body></html>`,
        },
      };

      s3ClientStub.send
        .withArgs(
          sinon.match((command) => command.constructor.name === 'GetObjectCommand'
            && command.input.Key === 'scrapes/test-site-id/page1/scrape.json'),
        )
        .resolves({
          Body: { transformToString: () => JSON.stringify(page1Object) },
          ContentType: 'application/json',
        });

      s3ClientStub.send
        .withArgs(
          sinon.match((command) => command.constructor.name === 'GetObjectCommand'
            && command.input.Key === 'scrapes/test-site-id/page2/scrape.json'),
        )
        .resolves({
          Body: { transformToString: () => JSON.stringify(page2Object) },
          ContentType: 'application/json',
        });

      nock('https://example.com').head('/page1').reply(200);

      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(1);
      expect(result['/page1']).to.exist;
      expect(result['/page1'].isSoft404).to.be.true;
      expect(result['/page1'].statusCode).to.equal(200);
      expect(result['/page1'].matchedIndicators).to.include('page not found');
      expect(result['/page1'].wordCount).to.be.lessThan(500);
    });

    it('should not flag pages with 404 HTTP status as soft 404', async () => {
      const page1Object = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Page not found' },
          rawBody: '<html><body><h1>404 - Page not found</h1></body></html>',
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(page1Object) },
          ContentType: 'application/json',
        });

      nock('https://example.com').head('/page1').reply(404);

      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(0);
    });

    it('should not flag pages without soft 404 indicators', async () => {
      const page1Object = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Valid Page' },
          rawBody:
            '<html><body><h1>Welcome</h1><p>Valid content here.</p></body></html>',
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(page1Object) },
          ContentType: 'application/json',
        });

      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(0);
    });

    it('should handle HTTP request failures gracefully', async () => {
      const page1Object = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Page not found' },
          rawBody: '<html><body><h1>404 error</h1></body></html>',
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(page1Object) },
          ContentType: 'application/json',
        });

      nock('https://example.com')
        .head('/page1')
        .replyWithError('Network error');

      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(0);
      expect(logStub.warn).to.have.been.called;
    });

    it('should handle missing rawBody or finalUrl', async () => {
      const page1Object = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Test' },
        },
      };

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => JSON.stringify(page1Object) },
          ContentType: 'application/json',
        });

      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(0);
      expect(logStub.warn).to.have.been.calledWith(
        'Missing rawBody or finalUrl for page: /page1',
      );
    });

    it('should detect soft 404 for page with very low word count (< 100) even without indicators', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Test Title' },
          rawBody: '<html><body>Very short content</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      nock('https://example.com')
        .head('/page1')
        .reply(200);

      const result = await soft404sAutoDetect(site, new Set(['scrapes/test-site-id/page1/scrape.json']), context);

      expect(result).to.have.property('/page1');
      expect(result['/page1']).to.deep.include({
        isSoft404: true,
        statusCode: 200,
        wordCount: 2, // "Very short content" = 2 words
      });
    });

    it('should not detect soft 404 for page with very low word count if status is not 200', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Test Title' },
          rawBody: '<html><body>Very short content</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      nock('https://example.com')
        .head('/page1')
        .reply(404);

      const result = await soft404sAutoDetect(site, new Set(['scrapes/test-site-id/page1/scrape.json']), context);

      expect(result).to.be.empty;
    });

    it('should detect soft 404 for page with word count between 100 and 500 only if it has indicators', async () => {
      const mockObject = {
        finalUrl: 'https://example.com/page1',
        scrapeResult: {
          tags: { title: 'Test Title' },
          rawBody: '<html><body>This is a page with more than 100 words but less than 500 words. It should only be detected as a soft 404 if it contains soft 404 indicators. Otherwise, it should be considered a valid page even though it has relatively low content.</body></html>',
        },
      };

      s3ClientStub.send.resolves({
        Body: { transformToString: () => JSON.stringify(mockObject) },
        ContentType: 'application/json',
      });

      nock('https://example.com')
        .head('/page1')
        .reply(200);

      const result = await soft404sAutoDetect(site, new Set(['scrapes/test-site-id/page1/scrape.json']), context);

      // Should not be detected as soft 404 because it has no indicators
      expect(result).to.be.empty;
    });
  });

  describe('soft404sAuditRunner', () => {
    beforeEach(() => {
      context.dataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
            { getUrl: () => 'https://example.com/page1' },
          ]),
        },
      };
    });

    it('should run audit successfully', async () => {
      // Set up the data access for getTopPagesForSiteId (mocking the import from canonical handler)
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({ Contents: [] });

      const result = await soft404sAuditRunner(context);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult.success).to.be.true;
    });

    it('should handle audit errors gracefully', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(
        new Error('Database error'),
      );

      const result = await soft404sAuditRunner(context);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Database error');
    });

    it('should handle S3 connection errors', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]);

      // Mock S3 error
      s3ClientStub.send.rejects(new Error('S3 connection failed'));

      const result = await soft404sAuditRunner(context);

      expect(result.auditResult.success).to.be.false;
      expect(result.auditResult.error).to.include('Audit failed with error');
    });

    it('should handle site with no getConfig method', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]);

      // Override site to have getConfig method that returns null
      site.getConfig = sinon.stub().resolves(null);

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({ Contents: [] });

      const result = await soft404sAuditRunner(context);

      expect(result).to.have.property('auditResult');
      expect(result.auditResult.success).to.be.true;
      expect(result.auditResult.totalPagesChecked).to.equal(1);
    });
  });

  describe('Error handling and edge cases', () => {
    it('should handle malformed JSON in S3 objects', async () => {
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
        .resolves({
          Contents: [{ Key: 'scrapes/test-site-id/page1/scrape.json' }],
        });

      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(GetObjectCommand))
        .resolves({
          Body: { transformToString: () => 'invalid json' },
          ContentType: 'application/json',
        });

      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/page1' },
      ]);

      const pagesSet = new Set(['scrapes/test-site-id/page1/scrape.json']);
      const result = await soft404sAutoDetect(site, pagesSet, context);

      expect(Object.keys(result)).to.have.lengthOf(0);
    });
  });

  describe('extractTextAndCountWords', () => {
    let extractTextAndCountWords;

    beforeEach(async () => {
      const utils = await import('../../src/soft404s/utils.js');
      extractTextAndCountWords = utils.extractTextAndCountWords;
    });

    it('should handle invalid HTML input in extractTextAndCountWords', async () => {
      let result = extractTextAndCountWords(null);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      result = extractTextAndCountWords(undefined);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      result = extractTextAndCountWords(123);
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });

      result = extractTextAndCountWords('');
      expect(result).to.deep.equal({ textContent: '', wordCount: 0 });
    });

    it('should exclude navigation content from word count', () => {
      const html = `
        <nav>
          <ul>
            <li>Home</li>
            <li>About</li>
            <li>Contact</li>
          </ul>
        </nav>
        <main>
          <p>This is the main content</p>
          <p>With multiple paragraphs</p>
        </main>
      `;
      const result = extractTextAndCountWords(html);
      expect(result.wordCount).to.equal(8); // Only counts words from main content
      expect(result.textContent).to.not.include('Home');
      expect(result.textContent).to.not.include('About');
      expect(result.textContent).to.not.include('Contact');
    });

    it('should exclude header and footer content from word count', () => {
      const html = `
        <header>
          <h1>Welcome to our site</h1>
          <p>Header content</p>
        </header>
        <main>
          <p>Main content here</p>
        </main>
        <footer>
          <p>Copyright 2024</p>
          <p>Footer links</p>
        </footer>
      `;
      const result = extractTextAndCountWords(html);
      expect(result.wordCount).to.equal(3); // Only counts words from main content
      expect(result.textContent).to.not.include('Welcome');
      expect(result.textContent).to.not.include('Copyright');
      expect(result.textContent).to.not.include('Footer');
    });

    it('should exclude ad content from word count', () => {
      const html = `
        <div class="ad-container">
          <p>Buy our products</p>
          <p>Special offer</p>
        </div>
        <div id="sidebar-ad">
          <p>Advertisement</p>
        </div>
        <main>
          <p>Actual content here</p>
        </main>
      `;
      const result = extractTextAndCountWords(html);
      expect(result.wordCount).to.equal(3); // Only counts words from main content
      expect(result.textContent).to.not.include('Buy');
      expect(result.textContent).to.not.include('Advertisement');
      expect(result.textContent).to.not.include('Special');
    });

    it('should handle nested elements correctly', () => {
      const html = `
        <header>
          <nav>
            <ul>
              <li>Menu item</li>
            </ul>
          </nav>
        </header>
        <main>
          <p>Main content</p>
          <div class="ad-container">
            <p>Ad content</p>
          </div>
          <p>More content</p>
        </main>
        <footer>
          <p>Footer text</p>
        </footer>
      `;
      const result = extractTextAndCountWords(html);
      expect(result.wordCount).to.equal(4); // Only counts "Main content More content"
      expect(result.textContent).to.not.include('Menu');
      expect(result.textContent).to.not.include('Ad');
      expect(result.textContent).to.not.include('Footer');
    });
  });
});
