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
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

const AUDIT_TYPE = AuditModel.AUDIT_TYPES.ALT_TEXT;

describe('Image Alt Text Handler', () => {
  let sandbox;
  const bucketName = 'test-bucket';
  const s3BucketPath = 'scrapes/site-id/';
  let context;
  let tracingFetchStub;
  let handlerModule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    tracingFetchStub = sandbox.stub().resolves({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Buffer.from('test-blob')),
      headers: new Map([['Content-Length', '100']]),
    });
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        s3Client: {
          send: sandbox.stub().resolves({
            Contents: [
              { Key: `${s3BucketPath}page1/scrape.json` },
              { Key: `${s3BucketPath}page2/scrape.json` },
            ],
          }),
        },
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-id',
          resolveFinalURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: sandbox.stub().returns([]),
          }),
        },
        audit: {
          getId: () => 'audit-id',
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: bucketName,
          IMS_HOST: 'test-ims-host',
          IMS_CLIENT_ID: 'test-client-id',
          IMS_CLIENT_CODE: 'test-client-code',
          IMS_CLIENT_SECRET: 'test-client-secret',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getUrl: () => 'https://example.com/page1' },
              { getUrl: () => 'https://example.com/page2' },
            ]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({}),
          },
        },
        imsHost: 'test-ims-host',
        clientId: 'test-client-id',
        clientCode: 'test-client-code',
        clientSecret: 'test-client-secret',
      })
      .build();

    // Mock the module using esmock
    handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
      '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processImportStep', () => {
    it('should prepare import step with correct parameters', async () => {
      const result = await handlerModule.processImportStep(context);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: s3BucketPath,
        type: 'top-pages',
        siteId: 'site-id',
      });
    });
  });

  describe('prepareScrapingStep', () => {
    it('should prepare scraping step with top pages only', async () => {
      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should prepare scraping step with top pages and included URLs', async () => {
      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns([
        'https://example.com/page3',
        'https://example.com/page4',
      ]);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
          { url: 'https://example.com/page4' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should prepare scraping step with included URLs only when no top pages', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns(['https://example.com/page3']);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [{ url: 'https://example.com/page3' }],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should deduplicate URLs between top pages and included URLs', async () => {
      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns([
        'https://example.com/page1', // duplicate
        'https://example.com/page3',
      ]);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
          { url: 'https://example.com/page3' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should throw error if no URLs found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns([]);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      await expect(handlerModule.prepareScrapingStep(context)).to.be.rejectedWith(
        'No URLs found for site neither top pages nor included URLs',
      );
    });

    it('should handle when site config is null', async () => {
      context.site.getConfig = () => null;

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should handle when getIncludedURLs returns null', async () => {
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns(null);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });

    it('should handle when site.getConfig() is undefined', async () => {
      // Set getConfig to undefined to test optional chaining fallback
      const originalSite = context.site;
      context.site = {
        ...originalSite,
        getConfig: undefined,
      };

      const result = await handlerModule.prepareScrapingStep(context);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
        siteId: 'site-id',
        type: 'alt-text',
      });
    });
  });

  describe('fetchPageScrapeAndRunAudit', () => {
    it('should return null if no raw HTML content found', async () => {
      context.s3Client.send.resolves(
        { Body: { transformToString: sandbox.stub().resolves(JSON.stringify({})) } },
      );

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        'scrape.json',
        s3BucketPath,
        context.log,
      );

      expect(result).to.be.null;
      expect(context.log.debug).to.have.been.calledWith(
        '[alt-text]: No raw HTML content found in S3 scrape.json object',
      );
    });

    it('should process images and identify decorative ones', async () => {
      const mockScrapeResult = {
        scrapeResult: {
          rawBody: `
            <html>
              <body>
                <img src="image1.jpg" alt="Image 1" />
                <img src="image2.jpg" role="presentation" src="image2.jpg" />
                <img src="image3.jpg" aria-hidden="true" src="image3.jpg" />
                <img src="image4.jpg" alt="" src="image4.jpg" />
              </body>
            </html>
          `,
        },
      };

      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(mockScrapeResult)),
        },
      });

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        `${s3BucketPath}page1/scrape.json`,
        s3BucketPath,
        context.log,
      );

      expect(result).to.not.be.null;
      expect(result).to.have.property('/page1');
      expect(result['/page1']).to.have.property('images');
      expect(result['/page1'].images).to.have.lengthOf(4);
      expect(result['/page1'].images.filter((img) => img.isDecorative)).to.have.lengthOf(3);
    });

    it('should handle when S3 object is null', async () => {
      context.s3Client.send.resolves(null);

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        'scrape.json',
        s3BucketPath,
        context.log,
      );

      expect(result).to.be.null;
    });

    it('should handle when scrapeResult is missing', async () => {
      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({})),
        },
      });

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        'scrape.json',
        s3BucketPath,
        context.log,
      );

      expect(result).to.be.null;
    });

    it('should handle when rawBody is empty string', async () => {
      const mockScrapeResult = {
        scrapeResult: {
          rawBody: '',
        },
      };

      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(mockScrapeResult)),
        },
      });

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        'scrape.json',
        s3BucketPath,
        context.log,
      );

      expect(result).to.be.null;
    });

    it('should handle homepage URL (root path)', async () => {
      const mockScrapeResult = {
        scrapeResult: {
          rawBody: '<html><head></head><body><img src="test.jpg" alt="test" /></body></html>',
        },
      };

      // Mock JSDOM and utility functions to avoid localStorage issues
      const handlerModuleWithMocks = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        jsdom: {
          JSDOM: class MockJSDOM {
            constructor() {
              this.window = {
                document: {
                  getElementsByTagName: () => [
                    {
                      getAttribute: sandbox.stub()
                        .withArgs('src')
                        .returns('test.jpg')
                        .withArgs('alt')
                        .returns('test'),
                    },
                  ],
                },
              };
            }
          },
        },
        '../../../src/image-alt-text/utils.js': {
          shouldShowImageAsSuggestion: sandbox.stub().returns(true),
          isImageDecorative: sandbox.stub().returns(false),
        },
        'get-xpath': sandbox.stub().returns('//img[1]'),
      });

      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(mockScrapeResult)),
        },
      });

      const result = await handlerModuleWithMocks.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        `${s3BucketPath}/scrape.json`, // root/homepage path
        s3BucketPath,
        context.log,
      );

      expect(result).to.not.be.null;
      expect(result).to.have.property('/');
      expect(result['/']).to.have.property('images');
      expect(result['/'].images).to.have.lengthOf(1);
    });

    it('should filter out images without src attribute', async () => {
      const mockScrapeResult = {
        scrapeResult: {
          rawBody: `
            <html>
              <body>
                <img src="image1.jpg" alt="Image 1" />
                <img alt="No src" />
                <img src="" alt="Empty src" />
                <img src="image2.jpg" />
              </body>
            </html>
          `,
        },
      };

      context.s3Client.send.resolves({
        ContentType: 'application/json',
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(mockScrapeResult)),
        },
      });

      const result = await handlerModule.fetchPageScrapeAndRunAudit(
        context.s3Client,
        bucketName,
        `${s3BucketPath}page1/scrape.json`,
        s3BucketPath,
        context.log,
      );

      expect(result).to.not.be.null;
      expect(result['/page1'].images).to.have.lengthOf(2); // Only images with non-empty src
      expect(result['/page1'].images.every((img) => img.src)).to.be.true;
    });
  });

  describe('processAltTextAuditStep', () => {
    let convertToOpportunityStub;
    let auditEngineStub;
    let s3UtilsStub;

    beforeEach(async () => {
      convertToOpportunityStub = sandbox.stub().resolves();
      auditEngineStub = {
        performPageAudit: sandbox.stub(),
        filterImages: sandbox.stub().resolves(),
        finalizeAudit: sandbox.stub(),
        getAuditedTags: sandbox.stub().returns({
          imagesWithoutAltText: [
            { src: 'image1.jpg', xpath: '//img[1]' },
            { src: 'image2.jpg', xpath: '//img[2]' },
          ],
        }),
      };

      s3UtilsStub = {
        getObjectKeysUsingPrefix: sandbox.stub().resolves([
          `${s3BucketPath}/scrape.json`, // homepage
          `${s3BucketPath}page1/scrape.json`,
          `${s3BucketPath}page2/scrape.json`,
          `${s3BucketPath}other-page/scrape.json`, // not in top pages or included URLs
        ]),
        getObjectFromKey: sandbox.stub().resolves({
          scrapeResult: {
            rawBody: '<html><body><img src="test.jpg" /></body></html>',
          },
        }),
      };

      // Mock the module with our stubs
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': { default: convertToOpportunityStub },
        '../../../src/image-alt-text/auditEngine.js': { default: sandbox.stub().returns(auditEngineStub) },
        '../../../src/utils/s3-utils.js': s3UtilsStub,
      });
    });

    it('should process only top pages when no included URLs', async () => {
      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });

      // Should only process 2 pages (page1, page2) from top pages, not the other-page
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/found 2 relevant scraped pages to analyze out of 4 total scraped pages/),
      );

      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(convertToOpportunityStub.firstCall.args[0]).to.equal('https://example.com');
      expect(convertToOpportunityStub.firstCall.args[1]).to.deep.include({
        siteId: 'site-id',
        auditId: 'audit-id',
      });
    });

    it('should process top pages and included URLs', async () => {
      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns(['https://example.com/other-page']);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });

      // Should now process 3 pages (page1, page2, other-page)
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/found 3 relevant scraped pages to analyze out of 4 total scraped pages/),
      );

      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('should handle case when no relevant scraped content is found', async () => {
      s3UtilsStub.getObjectKeysUsingPrefix.resolves([
        `${s3BucketPath}different-page/scrape.json`, // not in top pages
      ]);
      auditEngineStub.getAuditedTags.returns({ imagesWithoutAltText: [] });

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/no relevant scraped content found for specified pages, cannot proceed with audit/),
      );
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('should handle case when no images are found', async () => {
      // Mock the page results to have no images
      const noImagesS3UtilsStub = {
        getObjectKeysUsingPrefix: sandbox.stub().resolves([
          `${s3BucketPath}page1/scrape.json`,
        ]),
        getObjectFromKey: sandbox.stub().resolves({
          scrapeResult: {
            rawBody: '<html><body></body></html>',
          },
        }),
      };

      // Re-mock the module with our updated stubs
      handlerModule = await esmock('../../../src/image-alt-text/handler.js', {
        '@adobe/spacecat-shared-utils': { tracingFetch: tracingFetchStub },
        '../../../src/image-alt-text/opportunityHandler.js': { default: convertToOpportunityStub },
        '../../../src/image-alt-text/auditEngine.js': { default: sandbox.stub().returns(auditEngineStub) },
        '../../../src/utils/s3-utils.js': noImagesS3UtilsStub,
      });

      sandbox.stub(handlerModule, 'fetchPageScrapeAndRunAudit').resolves({
        '/page1': {
          images: [],
          dom: {},
        },
      });
      auditEngineStub.getAuditedTags.returns(
        { imagesWithoutAltText: [], decorativeImagesCount: 0 },
      );

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      // Check that the message appears in any of the log calls
      const logMessages = context.log.info.getCalls().map((call) => call.args[0]);
      const expectedMessage = `[${AUDIT_TYPE}]: Found no images without alt text from the scraped content in bucket ${bucketName} with path ${s3BucketPath}`;
      expect(logMessages).to.include(expectedMessage);
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('should log correct counts for top pages and included URLs', async () => {
      // Reset the stub and configure it for this test
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns([
        'https://example.com/page3',
        'https://example.com/page1', // duplicate with top page
      ]);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      await handlerModule.processAltTextAuditStep(context);

      // Should log 2 top pages, 2 included URLs, 3 total after deduplication
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Received topPages: 2, includedURLs: 2, totalPages to process after removing duplicates: 3/),
      );
    });

    it('should handle when site config is null in processAltTextAuditStep', async () => {
      context.site.getConfig = () => null;

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });

      // Should only process top pages
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Received topPages: 2, includedURLs: 0, totalPages to process after removing duplicates: 2/),
      );
    });

    it('should handle when getIncludedURLs returns null in processAltTextAuditStep', async () => {
      const getIncludedURLsStub = sandbox.stub();
      getIncludedURLsStub.withArgs('alt-text').returns(null);
      context.site.getConfig = () => ({
        getIncludedURLs: getIncludedURLsStub,
      });

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });

      // Should only process top pages
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Received topPages: 2, includedURLs: 0, totalPages to process after removing duplicates: 2/),
      );
    });

    it('should handle when fetchPageScrapeAndRunAudit returns null', async () => {
      // Override the fetchPageScrapeAndRunAudit to return null for some pages
      sandbox.stub(handlerModule, 'fetchPageScrapeAndRunAudit')
        .onFirstCall().resolves(null)
        .onSecondCall()
        .resolves({
          '/page2': {
            images: [{ src: 'test.jpg', alt: 'test' }],
            dom: {},
          },
        });

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(convertToOpportunityStub).to.have.been.calledOnce;
    });

    it('should handle when audit engine returns empty results', async () => {
      auditEngineStub.getAuditedTags.returns({
        imagesWithoutAltText: [],
      });

      const result = await handlerModule.processAltTextAuditStep(context);

      expect(result).to.deep.equal({ status: 'complete' });
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Identified 0 images \(after filtering\)/),
      );
    });
  });
});
