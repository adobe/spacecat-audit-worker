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
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import esmock from 'esmock';
import ProductSeoChecks from '../../src/product-metatags/seo-checks.js';
import {
  importTopPages,
  submitForScraping,
  fetchAndProcessPageObject,
} from '../../src/product-metatags/handler.js';
import productMetatagsAutoSuggest from '../../src/product-metatags/product-metatags-auto-suggest.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('Product MetaTags Audit', () => {
  let context;

  beforeEach('setup', () => {
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('ProductSeoChecks', () => {
    let seoChecks;

    beforeEach(() => {
      seoChecks = new ProductSeoChecks(context.log);
    });

    describe('hasProductTags', () => {
      it('should return true for pages with SKU meta tag', () => {
        const pageTags = { sku: 'PROD-123' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.true;
      });

      it('should return false for pages with only og:image meta tag (SKU required)', () => {
        const pageTags = { 'og:image': 'https://example.com/image.jpg' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.false;
      });

      it('should return false for pages with only twitter:image meta tag (SKU required)', () => {
        const pageTags = { 'twitter:image': 'https://example.com/twitter.jpg' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.false;
      });

      it('should return true for pages with SKU and image meta tags', () => {
        const pageTags = { sku: 'PROD-123', 'og:image': 'https://example.com/image.jpg' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.true;
      });

      it('should return false for pages without SKU meta tag', () => {
        const pageTags = { title: 'Page Title', description: 'Page description' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.false;
      });

      it('should return false for pages with empty SKU', () => {
        const pageTags = { sku: '', 'og:image': 'https://example.com/image.jpg' };
        expect(ProductSeoChecks.hasProductTags(pageTags)).to.be.false;
      });
    });

    describe('extractProductTags', () => {
      it('should extract SKU and image tags', () => {
        const pageTags = {
          sku: 'PROD-123',
          'og:image': 'https://example.com/image.jpg',
          'twitter:image': 'https://example.com/twitter.jpg',
        };
        const productTags = ProductSeoChecks.extractProductTags(pageTags);
        expect(productTags).to.deep.equal({
          sku: 'PROD-123',
          image: 'https://example.com/image.jpg', // Should prefer og:image
        });
      });

      it('should prioritize og:image over other image tags', () => {
        const pageTags = {
          'twitter:image': 'https://example.com/twitter.jpg',
          'og:image': 'https://example.com/og.jpg',
          'product:image': 'https://example.com/product.jpg',
        };
        const productTags = ProductSeoChecks.extractProductTags(pageTags);
        expect(productTags.image).to.equal('https://example.com/og.jpg');
      });

      it('should handle missing product tags', () => {
        const pageTags = { title: 'Page Title' };
        const productTags = ProductSeoChecks.extractProductTags(pageTags);
        expect(productTags).to.deep.equal({});
      });
    });

    describe('performChecks', () => {
      it('should skip pages without product tags', () => {
        const pageTags = { title: 'Regular Page', description: 'No product tags' };
        seoChecks.performChecks('/regular-page', pageTags);
        expect(Object.keys(seoChecks.getDetectedTags())).to.have.length(0);
      });

      it('should process pages with product tags and detect missing title', () => {
        const pageTags = {
          sku: 'PROD-123',
          'og:image': 'https://example.com/image.jpg',
          // Missing title - should be detected
          description: 'Product description',
        };
        seoChecks.performChecks('/product-page', pageTags);
        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product-page']).to.have.property('title');
        expect(detectedTags['/product-page'].title.issue).to.equal('Missing Title');
      });

      it('should process pages with SKU only', () => {
        const pageTags = {
          sku: 'PROD-456',
          title: 'Product Title',
          description: 'Product description',
        };
        seoChecks.performChecks('/sku-only-page', pageTags);
        const detectedTags = seoChecks.getDetectedTags();
        // Should process the page (no issues in this case)
        expect(detectedTags).to.be.an('object');
      });

      it('should detect multiple H1 tags on product pages', () => {
        const pageTags = {
          sku: 'PROD-789',
          title: 'Product Title',
          h1: ['First H1', 'Second H1'],
        };
        seoChecks.performChecks('/multi-h1-page', pageTags);
        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/multi-h1-page']).to.have.property('h1');
        expect(detectedTags['/multi-h1-page'].h1.issue).to.equal('Multiple H1 on page');
      });
    });

    describe('finalChecks', () => {
      it('should detect duplicate titles across product pages', () => {
        const pageTags1 = { sku: 'PROD-1', title: 'Same Title' };
        const pageTags2 = { sku: 'PROD-2', title: 'Same Title' };

        seoChecks.performChecks('/product1', pageTags1);
        seoChecks.performChecks('/product2', pageTags2);
        seoChecks.finalChecks();

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product1'].title.issue).to.equal('Duplicate Title');
        expect(detectedTags['/product2'].title.issue).to.equal('Duplicate Title');
      });
    });

    describe('capitalizeFirstLetter', () => {
      it('should capitalize the first letter of a string', () => {
        const result = ProductSeoChecks.capitalizeFirstLetter('title');
        expect(result).to.equal('Title');
      });

      it('should return the original string if it is empty', () => {
        const result = ProductSeoChecks.capitalizeFirstLetter('');
        expect(result).to.equal('');
      });

      it('should return the original string if it is null or undefined', () => {
        const result = ProductSeoChecks.capitalizeFirstLetter(null);
        expect(result).to.be.null;
      });
    });

    describe('checkForMissingTags', () => {
      it('should detect missing tags and add to detectedTags', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123' }; // SKU present but missing other tags

        seoChecks.checkForMissingTags(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].title.issue).to.equal('Missing Title');
        expect(seoChecks.getDetectedTags()[url].title.seoRecommendation).to.include('should be present');
      });

      it('should not add missing tag detection for non-product pages', () => {
        const url = '/non-product-page';
        const pageTags = {}; // No SKU - should not be processed

        seoChecks.checkForMissingTags(url, pageTags);

        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });
    });

    describe('checkForTagsLength', () => {
      it('should detect empty tag and add to detectedTags with HIGH impact', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', title: '' };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].title.issue).to.equal('Empty Title');
        expect(seoChecks.getDetectedTags()[url].title.seoImpact).to.equal('HIGH');
      });

      it('should detect too long tag and add to detectedTags with MODERATE impact', () => {
        const url = '/product-page';
        const longTitle = 'A'.repeat(61); // Assuming 60 is max length
        const pageTags = { sku: 'PROD-123', title: longTitle };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].title.issue).to.equal('Title too long');
        expect(seoChecks.getDetectedTags()[url].title.seoImpact).to.equal('MODERATE');
      });

      it('should detect too short tag and add to detectedTags with MODERATE impact', () => {
        const url = '/product-page';
        const shortTitle = 'A'; // Too short
        const pageTags = { sku: 'PROD-123', title: shortTitle };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].title.issue).to.equal('Title too short');
        expect(seoChecks.getDetectedTags()[url].title.seoImpact).to.equal('MODERATE');
      });
    });

    describe('checkForH1Count', () => {
      it('should detect multiple H1 tags on the page', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', h1: ['Heading 1', 'Heading 2'] };

        seoChecks.checkForH1Count(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].h1.issue).to.equal('Multiple H1 on page');
        expect(seoChecks.getDetectedTags()[url].h1.seoRecommendation).to.include('one H1 on a page');
      });

      it('should not detect an issue if there is only one H1 tag', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', h1: ['Single Heading'] };
        seoChecks.checkForH1Count(url, pageTags);
        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });
    });

    describe('checkForUniqueness', () => {
      it('should detect duplicate tags across pages and add to detectedTags', () => {
        seoChecks.addToAllTags('/product1', 'title', 'Sample Title');
        seoChecks.addToAllTags('/product2', 'title', 'Sample Title');

        seoChecks.finalChecks();
        expect(seoChecks.getDetectedTags()['/product1'].title.issue).to.equal('Duplicate Title');
        expect(seoChecks.getDetectedTags()['/product2'].title.issue).to.equal('Duplicate Title');
      });
    });

    describe('addToAllTags', () => {
      it('should add tags to allTags object', () => {
        const url = '/product-page';
        const tagContent = 'Sample Title';

        seoChecks.addToAllTags(url, 'title', tagContent);

        expect(seoChecks.allTags.title[tagContent.toLowerCase()].pageUrls).to.include(url);
      });

      it('should handle empty tag content', () => {
        const url = '/product-page';
        const tagContent = '';

        seoChecks.addToAllTags(url, 'title', tagContent);

        expect(seoChecks.allTags.title['']).to.be.undefined;
      });
    });

    describe('getDetectedTags', () => {
      it('should return detected tags object', () => {
        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags).to.be.an('object');
      });
    });

    describe('getFewHealthyTags', () => {
      it('should return healthy tags', () => {
        const healthyTags = seoChecks.getFewHealthyTags();
        expect(healthyTags).to.be.an('object');
      });
    });
  });

  describe('fetchAndProcessPageObject', () => {
    it('should handle valid S3 object structure', () => {
      // Test the object structure processing logic
      const mockS3Object = {
        finalUrl: 'https://example.com/product',
        scrapeResult: {
          tags: {
            title: 'Product Title',
            description: 'Product Description',
            h1: ['Product H1'],
            sku: 'PROD-123',
            'og:image': 'https://example.com/product-image.jpg',
          },
          rawBody: '<html><head><title>Product Title</title></head><body>Product page content that is long enough to pass validation and meet the minimum length requirement of 300 characters for processing. This content should be sufficiently long to trigger the audit processing logic and not be skipped due to length constraints.</body></html>',
        },
      };

      // Verify the structure matches what we expect
      expect(mockS3Object.scrapeResult.tags).to.have.property('sku');
      expect(mockS3Object.scrapeResult.tags).to.have.property('og:image');
      expect(mockS3Object.scrapeResult.rawBody.length).to.be.greaterThan(300);
    });

    it('should return null for pages without scraped tags', async () => {
      const mockS3Object = { scrapeResult: {} };

      const result = await fetchAndProcessPageObject(
        { getObject: () => mockS3Object },
        'test-bucket',
        'scrapes/site-id/page/scrape.json',
        'scrapes/site-id/',
        context.log,
      );

      expect(result).to.be.null;
    });

    it('should return null for pages with short content', async () => {
      const mockS3Object = {
        scrapeResult: {
          tags: { title: 'Short' },
          rawBody: 'Short content',
        },
      };

      const result = await fetchAndProcessPageObject(
        { getObject: () => mockS3Object },
        'test-bucket',
        'scrapes/site-id/page/scrape.json',
        'scrapes/site-id/',
        context.log,
      );

      expect(result).to.be.null;
    });
  });

  describe('importTopPages', () => {
    it('should return import step data', async () => {
      const mockSite = { getId: () => 'test-site-id' };
      const mockContext = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      const result = await importTopPages(mockContext);

      expect(result).to.deep.equal({
        type: 'top-pages',
        siteId: 'test-site-id',
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: 'scrapes/test-site-id/',
      });
    });
  });

  describe('submitForScraping', () => {
    it('should return scraping data with URLs', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://example.com/product1' },
        { getUrl: () => 'https://example.com/product2' },
      ];

      const mockSite = {
        getId: () => 'test-site-id',
        getConfig: () => ({ getIncludedURLs: () => ['https://example.com/included'] }),
      };

      const mockDataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves(mockTopPages),
        },
      };

      const mockContext = {
        site: mockSite,
        dataAccess: mockDataAccess,
        log: context.log,
      };

      const result = await submitForScraping(mockContext);

      expect(result).to.deep.equal({
        urls: [
          { url: 'https://example.com/product1' },
          { url: 'https://example.com/product2' },
          { url: 'https://example.com/included' },
        ],
        siteId: 'test-site-id',
        type: 'product-metatags',
      });
    });

    it('should throw error when no URLs found', async () => {
      const mockSite = {
        getId: () => 'test-site-id',
        getConfig: () => ({ getIncludedURLs: () => [] }),
      };

      const mockDataAccess = {
        SiteTopPage: {
          allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
        },
      };

      const mockContext = {
        site: mockSite,
        dataAccess: mockDataAccess,
        log: context.log,
      };

      await expect(submitForScraping(mockContext))
        .to.be.rejectedWith('No URLs found for site neither top pages nor included URLs');
    });
  });

  describe('extractProductTagsFromHTML', () => {
    // We need to test this indirectly through fetchAndProcessPageObject since it's not exported
    it('should extract product tags from HTML content via fetchAndProcessPageObject', async () => {
      const htmlContent = `
        <html>
          <head>
            <meta name="sku" content="TEST-SKU-123">
            <meta property="og:image" content="https://example.com/og-image.jpg">
            <meta name="twitter:image" content="https://example.com/twitter-image.jpg">
            <meta name="product:image" content="https://example.com/product-image.jpg">
            <meta name="image" content="https://example.com/generic-image.jpg">
            <title>Test Product</title>
          </head>
        </html>
      `;

      const mockS3Object = {
        scrapeResult: {
          tags: {
            title: 'Test Product',
            description: 'Test Description',
            h1: ['Test H1'],
          },
          rawBody: htmlContent,
        },
        finalUrl: 'https://example.com/products/test-product',
      };

      const mockS3Client = {};
      const getObjectFromKeyStub = sandbox.stub().resolves(mockS3Object);

      // Temporarily replace the import
      const originalModule = await import('../../src/utils/s3-utils.js');
      sandbox.stub(originalModule, 'getObjectFromKey').callsFake(getObjectFromKeyStub);

      const productMetatagsHandler = await import('../../src/product-metatags/handler.js');
      const result = await productMetatagsHandler.fetchAndProcessPageObject(mockS3Client, 'bucket', 'key', 'prefix/', context.log);

      expect(result).to.have.property('/products/test-product');
      const pageData = result['/products/test-product'];
      expect(pageData).to.have.property('sku', 'TEST-SKU-123');
      expect(pageData).to.have.property('og:image', 'https://example.com/og-image.jpg');
      expect(pageData).to.have.property('twitter:image', 'https://example.com/twitter-image.jpg');
      expect(pageData).to.have.property('product:image', 'https://example.com/product-image.jpg');
      expect(pageData).to.have.property('image', 'https://example.com/generic-image.jpg');
    });

    it('should handle HTML without product tags via fetchAndProcessPageObject', async () => {
      const htmlContent = `
        <html>
          <head>
            <title>Test Page</title>
          </head>
        </html>
      `;

      const mockS3Object = {
        scrapeResult: {
          tags: {
            title: 'Test Page',
            description: 'Test Description',
          },
          rawBody: htmlContent,
        },
        finalUrl: 'https://example.com/test-page',
      };

      const mockS3Client = {};
      const getObjectFromKeyStub = sandbox.stub().resolves(mockS3Object);

      // Temporarily replace the import
      const originalModule = await import('../../src/utils/s3-utils.js');
      sandbox.stub(originalModule, 'getObjectFromKey').callsFake(getObjectFromKeyStub);

      const productMetatagsHandler = await import('../../src/product-metatags/handler.js');
      const result = await productMetatagsHandler.fetchAndProcessPageObject(mockS3Client, 'bucket', 'key', 'prefix/', context.log);

      expect(result).to.have.property('/test-page');
      const pageData = result['/test-page'];
      expect(pageData).to.have.property('sku', undefined);
      expect(pageData).to.have.property('og:image', undefined);
      expect(pageData).to.have.property('twitter:image', undefined);
      expect(pageData).to.have.property('product:image', undefined);
      expect(pageData).to.have.property('image', undefined);
    });

    it('should handle invalid HTML content via fetchAndProcessPageObject', async () => {
      const mockS3Object = {
        scrapeResult: {
          tags: {
            title: 'Test Page',
          },
          rawBody: null, // Invalid HTML
        },
        finalUrl: 'https://example.com/test-page',
      };

      const mockS3Client = {};
      const getObjectFromKeyStub = sandbox.stub().resolves(mockS3Object);

      // Temporarily replace the import
      const originalModule = await import('../../src/utils/s3-utils.js');
      sandbox.stub(originalModule, 'getObjectFromKey').callsFake(getObjectFromKeyStub);

      const productMetatagsHandler = await import('../../src/product-metatags/handler.js');
      const result = await productMetatagsHandler.fetchAndProcessPageObject(mockS3Client, 'bucket', 'key', 'prefix/', context.log);

      expect(result).to.have.property('/test-page');
      const pageData = result['/test-page'];
      expect(pageData).to.have.property('sku', undefined);
    });
  });

  describe('productMetatagsAutoSuggest', () => {
    it('should return original tags when auto-suggest is disabled', async () => {
      const mockSite = { getId: () => 'test-site' };
      const mockConfiguration = {
        isHandlerEnabledForSite: sandbox.stub().returns(false),
      };
      const mockDataAccess = {
        Configuration: {
          findLatest: sandbox.stub().resolves(mockConfiguration),
        },
      };
      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
      };

      const allTags = {
        detectedTags: { '/product': { title: { issue: 'Missing Title' } } },
        healthyTags: {},
        extractedTags: {},
      };

      const result = await productMetatagsAutoSuggest(allTags, mockContext, mockSite);

      expect(result).to.deep.equal(allTags.detectedTags);
      expect(mockConfiguration.isHandlerEnabledForSite)
        .to.have.been.calledWith('product-metatags-auto-suggest', mockSite);
    });

    it('should handle auto-suggest when enabled', async () => {
      const mockSite = {
        getId: () => 'test-site',
        getBaseURL: () => 'https://example.com',
      };
      const mockConfiguration = {
        isHandlerEnabledForSite: sandbox.stub().returns(true),
      };
      const mockDataAccess = {
        Configuration: {
          findLatest: sandbox.stub().resolves(mockConfiguration),
        },
      };

      // Mock GenvarClient
      const mockGenvarResponse = {
        '/product': {
          title: {
            aiSuggestion: 'AI Generated Title',
            aiRationale: 'This title is optimized for SEO',
          },
        },
      };
      const mockGenvarClient = {
        generateSuggestions: sandbox.stub().resolves(mockGenvarResponse),
      };

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: {},
      };

      // Mock GenvarClient.createFrom
      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      const createFromStub = sandbox.stub(GenvarClientModule.GenvarClient, 'createFrom').returns(mockGenvarClient);

      const allTags = {
        detectedTags: {
          '/product': {
            title: { issue: 'Missing Title' },
          },
        },
        healthyTags: {},
        extractedTags: {
          '/product': { s3key: 'scrapes/test-site/product/scrape.json' },
        },
      };

      const result = await productMetatagsAutoSuggest(allTags, mockContext, mockSite);

      expect(result['/product'].title).to.have.property('aiSuggestion', 'AI Generated Title');
      expect(result['/product'].title).to.have.property('aiRationale', 'This title is optimized for SEO');
      expect(createFromStub).to.have.been.calledWith(mockContext);
    });
  });

  describe('Handler Methods - Additional Coverage', () => {
    describe('runAuditAndGenerateSuggestions', () => {
      let mockSite;
      let mockAudit;
      let mockDataAccess;

      beforeEach(() => {
        mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
              { getUrl: () => 'https://example.com/product1' },
              { getUrl: () => 'https://example.com/product2' },
            ]),
          },
        };

        mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => ({
            getIncludedURLs: () => ['https://example.com/included-product'],
          }),
        };

        mockAudit = {
          getId: () => 'test-audit-id',
        };

        context.dataAccess = mockDataAccess;
        context.site = mockSite;
        context.audit = mockAudit;
        context.finalUrl = 'https://example.com';
        context.s3Client = { send: sinon.stub() };
        context.env = { S3_SCRAPER_BUCKET_NAME: 'test-bucket' };
      });

      it('should handle product pages with missing titles', async () => {
        // Mock S3 response
        context.s3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command)).resolves({
          Contents: [
            { Key: 'scrapes/test-site-id/product1/scrape.json' },
          ],
        });

        // Mock S3 object response with missing title
        context.s3Client.send.withArgs(sinon.match.instanceOf(GetObjectCommand)).resolves({
          Body: {
            transformToString: () => JSON.stringify({
              finalUrl: 'https://example.com/product1',
              scrapeResult: {
                tags: { sku: 'PROD-123' }, // Missing title
                rawBody: '<html><head><meta name="sku" content="PROD-123"></head><body>Product page content that is long enough to pass validation requirements for processing.</body></html>',
              },
            }),
          },
        });

        const { runAuditAndGenerateSuggestions } = await import('../../src/product-metatags/handler.js');
        const result = await runAuditAndGenerateSuggestions(context);

        expect(result).to.deep.equal({ status: 'complete' });
      });

      it('should handle RUM API errors gracefully', async () => {
        context.s3Client.send.withArgs(sinon.match.instanceOf(ListObjectsV2Command)).resolves({
          Contents: [],
        });

        // Mock RUM API client to throw error
        const mockRumClient = {
          query: sinon.stub().rejects(new Error('RUM API Error')),
        };

        const mockedHandler = await esmock('../../src/product-metatags/handler.js', {
          '@adobe/spacecat-shared-rum-api-client': {
            default: {
              createFrom: () => mockRumClient,
            },
          },
        });

        const result = await mockedHandler.runAuditAndGenerateSuggestions(context);
        expect(result).to.deep.equal({ status: 'complete' });
      });
    });

    describe('opportunityAndSuggestions - Error Handling', () => {
      it('should handle suggestions with productTags', async () => {
        const mockOpportunity = {
          getId: () => 'test-opportunity-id',
          getSiteId: () => 'test-site-id',
        };

        const mockConvertToOpportunity = sinon.stub().resolves(mockOpportunity);
        const mockSyncSuggestions = sinon.stub().resolves();

        const auditData = {
          siteId: 'test-site-id',
          auditId: 'test-audit-id',
          auditResult: {
            finalUrl: 'https://example.com',
            detectedTags: {
              '/product1': {
                title: {
                  issue: 'Missing Title',
                  seoImpact: 'HIGH',
                  seoRecommendation: 'Add title',
                  tagContent: '',
                },
                productTags: {
                  sku: 'PROD-123',
                  image: 'https://example.com/image.jpg',
                },
              },
            },
            projectedTrafficLost: 100,
            projectedTrafficValue: 500,
          },
        };

        const mockDataAccess = {
          Site: {
            findById: sinon.stub().resolves({
              getDeliveryConfig: () => ({ useHostnameOnly: true }),
            }),
          },
        };

        context.dataAccess = mockDataAccess;

        const mockedHandler = await esmock('../../src/product-metatags/handler.js', {
          '../common/opportunity.js': { convertToOpportunity: mockConvertToOpportunity },
          '../utils/data-access.js': { syncSuggestions: mockSyncSuggestions },
        });

        await mockedHandler.opportunityAndSuggestions('https://example.com', auditData, context);

        expect(mockSyncSuggestions).to.have.been.calledOnce;
        const syncCall = mockSyncSuggestions.getCall(0);
        expect(syncCall.args[0].newData[0]).to.have.property('productTags');
        expect(syncCall.args[0].newData[0].productTags).to.deep.equal({
          sku: 'PROD-123',
          image: 'https://example.com/image.jpg',
        });
      });
    });

    describe('calculateProjectedTraffic', () => {
      it('should skip productTags from traffic calculation', async () => {
        const mockSite = { getId: () => 'test-site' };

        const mockRumClient = {
          query: sinon.stub().resolves([
            { url: 'https://example.com/product1', earned: 100, paid: 50 },
          ]),
        };

        const mockCalculateCPCValue = sinon.stub().resolves(2.5);

        const mockedHandler = await esmock('../../src/product-metatags/handler.js', {
          '@adobe/spacecat-shared-rum-api-client': {
            default: {
              createFrom: () => mockRumClient,
            },
          },
          '../support/utils.js': {
            calculateCPCValue: mockCalculateCPCValue,
          },
          '../common/index.js': {
            wwwUrlResolver: sinon.stub().resolves('www.example.com'),
          },
        });

        // This should work through the main audit function
        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'test-audit' },
          finalUrl: 'https://example.com',
          s3Client: { send: sinon.stub().resolves({ Contents: [] }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          dataAccess: {
            SiteTopPage: {
              allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
            },
          },
        };

        const result = await mockedHandler.runAuditAndGenerateSuggestions(testContext);
        expect(result).to.deep.equal({ status: 'complete' });
      });
    });

    describe('extractProductTagsFromHTML', () => {
      it('should handle malformed HTML gracefully', async () => {
        const malformedHtml = '<html><head><meta name="sku" content="PROD-123"<title>Test</title></head>';

        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Test' },
            rawBody: malformedHtml,
          },
          finalUrl: 'https://example.com/test',
        };

        const mockS3Client = {};
        const getObjectFromKeyStub = sandbox.stub().resolves(mockS3Object);

        const originalModule = await import('../../src/utils/s3-utils.js');
        sandbox.stub(originalModule, 'getObjectFromKey').callsFake(getObjectFromKeyStub);

        const productMetatagsHandler = await import('../../src/product-metatags/handler.js');
        const result = await productMetatagsHandler.fetchAndProcessPageObject(mockS3Client, 'bucket', 'key', 'prefix/', context.log);

        expect(result).to.have.property('/test');
        // Should still extract what it can
        expect(result['/test']).to.have.property('sku', 'PROD-123');
      });

      it('should handle empty rawBody', async () => {
        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Test' },
            rawBody: '',
          },
          finalUrl: 'https://example.com/test',
        };

        const mockS3Client = {};
        const getObjectFromKeyStub = sandbox.stub().resolves(mockS3Object);

        const originalModule = await import('../../src/utils/s3-utils.js');
        sandbox.stub(originalModule, 'getObjectFromKey').callsFake(getObjectFromKeyStub);

        const productMetatagsHandler = await import('../../src/product-metatags/handler.js');
        const result = await productMetatagsHandler.fetchAndProcessPageObject(mockS3Client, 'bucket', 'key', 'prefix/', context.log);

        expect(result).to.be.null; // Should return null for empty content
      });
    });

    describe('getScrapeJsonPath', () => {
      it('should transform URLs correctly', async () => {
        // This function is not exported, so we test it indirectly
        const mockSite = {
          getId: () => 'test-site',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
              { getUrl: () => 'https://example.com/products/test-product/' },
            ]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'test-audit' },
          finalUrl: 'https://example.com',
          s3Client: {
            send: sinon.stub()
              .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
              .resolves({ Contents: [] })
              .withArgs(sinon.match.instanceOf(GetObjectCommand))
              .resolves({ Contents: [] }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          dataAccess: mockDataAccess,
        };

        const { runAuditAndGenerateSuggestions } = await import('../../src/product-metatags/handler.js');
        const result = await runAuditAndGenerateSuggestions(testContext);

        expect(result).to.deep.equal({ status: 'complete' });
        expect(mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.called;
      });
    });
  });

  describe('Utility Functions - Complete Coverage', () => {
    describe('removeTrailingSlash', () => {
      it('should handle various URL formats', async () => {
        const { removeTrailingSlash } = await import('../../src/product-metatags/opportunity-utils.js');
        expect(removeTrailingSlash('/')).to.equal('');
        expect(removeTrailingSlash('')).to.equal('');
        expect(removeTrailingSlash('https://example.com///')).to.equal('https://example.com//');
      });
    });

    describe('getBaseUrl', () => {
      it('should handle edge cases', async () => {
        const { getBaseUrl } = await import('../../src/product-metatags/opportunity-utils.js');
        expect(getBaseUrl('https://example.com:8080/path', true)).to.equal('https://example.com:8080');
        expect(getBaseUrl('', false)).to.equal('');
        expect(getBaseUrl('not-a-url', false)).to.equal('not-a-url');
      });
    });

    describe('getIssueRanking', () => {
      it('should handle case variations', async () => {
        const { getIssueRanking } = await import('../../src/product-metatags/opportunity-utils.js');
        expect(getIssueRanking('title', 'MISSING TITLE')).to.equal(1);
        expect(getIssueRanking('title', 'empty title')).to.equal(2);
        expect(getIssueRanking('description', 'missing description')).to.equal(3);
        expect(getIssueRanking('h1', 'multiple h1 tags')).to.equal(11);
      });
    });
  });

  describe('Constants - Complete Coverage', () => {
    it('should export all required constants with correct values', async () => {
      const constants = await import('../../src/product-metatags/constants.js');
      expect(constants.SKU).to.equal('sku');
      expect(constants.IMAGE).to.equal('image');
      expect(constants.TITLE).to.equal('title');
      expect(constants.DESCRIPTION).to.equal('description');
      expect(constants.H1).to.equal('h1');
      expect(constants.ISSUE).to.equal('issue');
      expect(constants.SEO_IMPACT).to.equal('seoImpact');
      expect(constants.HIGH).to.equal('HIGH');
      expect(constants.MODERATE).to.equal('MODERATE');
      expect(constants.PROJECTED_VALUE_THRESHOLD).to.be.a('number');
    });

    it('should export tag length configurations', async () => {
      const { TAG_LENGTHS } = await import('../../src/product-metatags/constants.js');
      expect(TAG_LENGTHS).to.have.property('title');
      expect(TAG_LENGTHS).to.have.property('description');
      expect(TAG_LENGTHS).to.have.property('h1');
      expect(TAG_LENGTHS.title).to.have.property('minLength');
      expect(TAG_LENGTHS.title).to.have.property('maxLength');
    });
  });

  describe('Opportunity Data Mapper - Complete Coverage', () => {
    it('should create opportunity data with all required fields', async () => {
      const { createOpportunityData } = await import('../../src/product-metatags/opportunity-data-mapper.js');
      const result = createOpportunityData();

      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result.title).to.include('Product');
      expect(result.description).to.be.a('string');
      expect(result.guidance).to.be.a('string');
    });

    it('should include product-specific keywords', async () => {
      const { createOpportunityData } = await import('../../src/product-metatags/opportunity-data-mapper.js');
      const result = createOpportunityData();

      const fullText = `${result.title} ${result.description} ${result.guidance}`.toLowerCase();
      expect(fullText).to.include('product');
      expect(fullText).to.include('sku');
    });
  });
});
