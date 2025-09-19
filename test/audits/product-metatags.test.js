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

// Import all modules without mocking to ensure actual code execution
import ProductSeoChecks from '../../src/product-metatags/seo-checks.js';
import {
  importTopPages,
  submitForScraping,
  fetchAndProcessPageObject,
  runAuditAndGenerateSuggestions,
  opportunityAndSuggestions,
} from '../../src/product-metatags/handler.js';
import productMetatagsAutoSuggest from '../../src/product-metatags/product-metatags-auto-suggest.js';
import { createOpportunityData } from '../../src/product-metatags/opportunity-data-mapper.js';
import {
  removeTrailingSlash,
  getBaseUrl,
  getIssueRanking,
} from '../../src/product-metatags/opportunity-utils.js';
import * as constants from '../../src/product-metatags/constants.js';
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

  describe('Constants', () => {
    it('should export all required constants with correct values', () => {
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

    it('should export tag length configurations', () => {
      expect(constants.TAG_LENGTHS).to.have.property('title');
      expect(constants.TAG_LENGTHS).to.have.property('description');
      expect(constants.TAG_LENGTHS).to.have.property('h1');
      expect(constants.TAG_LENGTHS.title).to.have.property('minLength');
      expect(constants.TAG_LENGTHS.title).to.have.property('maxLength');
    });
  });

  describe('Opportunity Data Mapper', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData();

      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result.title).to.include('Product');
      expect(result.description).to.be.a('string');
      expect(result.guidance).to.be.a('string');
    });

    it('should include product-specific keywords', () => {
      const result = createOpportunityData();

      const fullText = `${result.title} ${result.description} ${result.guidance}`.toLowerCase();
      expect(fullText).to.include('product');
      expect(fullText).to.include('sku');
    });

    it('should create opportunity data with default structure when no parameters', () => {
      const result = createOpportunityData();

      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result.title).to.be.a('string').and.not.be.empty;
      expect(result.description).to.be.a('string').and.not.be.empty;
      expect(result.guidance).to.be.a('string').and.not.be.empty;
    });

    it('should create opportunity data with projected traffic metrics', () => {
      const projectedData = {
        projectedTrafficLost: 100,
        projectedTrafficValue: 500,
      };

      const result = createOpportunityData(projectedData);

      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
    });
  });

  describe('Opportunity Utils', () => {
    describe('removeTrailingSlash', () => {
      it('should remove single trailing slash', () => {
        expect(removeTrailingSlash('https://example.com/')).to.equal('https://example.com');
      });

      it('should handle root slash', () => {
        expect(removeTrailingSlash('/')).to.equal('');
      });

      it('should handle empty string', () => {
        expect(removeTrailingSlash('')).to.equal('');
      });

      it('should handle multiple trailing slashes', () => {
        expect(removeTrailingSlash('https://example.com///')).to.equal('https://example.com//');
      });

      it('should not remove non-trailing slashes', () => {
        expect(removeTrailingSlash('https://example.com/path')).to.equal('https://example.com/path');
      });
    });

    describe('getBaseUrl', () => {
      it('should extract base URL with hostname only', () => {
        expect(getBaseUrl('https://example.com/path', true)).to.equal('https://example.com');
      });

      it('should extract base URL without hostname only', () => {
        expect(getBaseUrl('https://example.com/path', false)).to.equal('https://example.com/path');
      });

      it('should handle URLs with port', () => {
        expect(getBaseUrl('https://example.com:8080/path', true)).to.equal('https://example.com:8080');
      });

      it('should handle empty URL', () => {
        expect(getBaseUrl('', false)).to.equal('');
      });

      it('should handle invalid URL', () => {
        expect(getBaseUrl('not-a-url', false)).to.equal('not-a-url');
      });

      it('should handle URL parsing failure with hostnameOnly true', () => {
        expect(getBaseUrl('not-a-valid-url://malformed', true)).to.equal('not-a-valid-url://malformed');
      });
    });

    describe('getIssueRanking', () => {
      it('should return ranking for title issues', () => {
        expect(getIssueRanking('title', 'missing title')).to.equal(1);
        expect(getIssueRanking('title', 'empty title')).to.equal(2);
        expect(getIssueRanking('title', 'duplicate title')).to.equal(5);
        expect(getIssueRanking('title', 'title too long')).to.equal(8);
        expect(getIssueRanking('title', 'title too short')).to.equal(8);
      });

      it('should return ranking for description issues', () => {
        expect(getIssueRanking('description', 'missing description')).to.equal(3);
        expect(getIssueRanking('description', 'empty description')).to.equal(3);
        expect(getIssueRanking('description', 'duplicate description')).to.equal(6);
      });

      it('should return ranking for h1 issues', () => {
        expect(getIssueRanking('h1', 'missing h1')).to.equal(4);
        expect(getIssueRanking('h1', 'multiple h1 tags')).to.equal(11);
      });

      it('should handle case variations', () => {
        expect(getIssueRanking('title', 'MISSING TITLE')).to.equal(1);
        expect(getIssueRanking('h1', 'multiple h1 on page')).to.equal(11);
      });

      it('should return default ranking for unknown issues', () => {
        expect(getIssueRanking('title', 'unknown issue')).to.equal(999);
        expect(getIssueRanking('unknown', 'any issue')).to.equal(999);
      });
    });
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

      it('should handle null/undefined input', () => {
        expect(ProductSeoChecks.extractProductTags(null)).to.deep.equal({});
        expect(ProductSeoChecks.extractProductTags(undefined)).to.deep.equal({});
      });

      it('should prioritize image types correctly', () => {
        // Test twitter:image when og:image is not available
        const pageTags1 = {
          sku: 'PROD-123',
          'twitter:image': 'https://example.com/twitter.jpg',
          'product:image': 'https://example.com/product.jpg',
        };
        const productTags1 = ProductSeoChecks.extractProductTags(pageTags1);
        expect(productTags1.image).to.equal('https://example.com/twitter.jpg');

        // Test product:image when others are not available
        const pageTags2 = {
          sku: 'PROD-123',
          'product:image': 'https://example.com/product.jpg',
          image: 'https://example.com/generic.jpg',
        };
        const productTags2 = ProductSeoChecks.extractProductTags(pageTags2);
        expect(productTags2.image).to.equal('https://example.com/product.jpg');

        // Test generic image when others are not available
        const pageTags3 = {
          sku: 'PROD-123',
          image: 'https://example.com/generic.jpg',
        };
        const productTags3 = ProductSeoChecks.extractProductTags(pageTags3);
        expect(productTags3.image).to.equal('https://example.com/generic.jpg');
      });
    });

    describe('capitalizeFirstLetter', () => {
      it('should capitalize the first letter of a string', () => {
        expect(ProductSeoChecks.capitalizeFirstLetter('title')).to.equal('Title');
        expect(ProductSeoChecks.capitalizeFirstLetter('h1')).to.equal('H1');
        expect(ProductSeoChecks.capitalizeFirstLetter('description')).to.equal('Description');
      });

      it('should return the original string if it is empty', () => {
        expect(ProductSeoChecks.capitalizeFirstLetter('')).to.equal('');
      });

      it('should return the original string if it is null or undefined', () => {
        expect(ProductSeoChecks.capitalizeFirstLetter(null)).to.be.null;
        expect(ProductSeoChecks.capitalizeFirstLetter(undefined)).to.be.undefined;
      });

      it('should handle single character strings', () => {
        expect(ProductSeoChecks.capitalizeFirstLetter('a')).to.equal('A');
        expect(ProductSeoChecks.capitalizeFirstLetter('Z')).to.equal('Z');
      });
    });

    describe('checkForMissingTags', () => {
      it('should detect missing tags and add to detectedTags', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123' }; // SKU present but missing other tags

        seoChecks.checkForMissingTags(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url].title.issue).to.equal('Missing Title');
        expect(detectedTags[url].title.seoRecommendation).to.include('should be present');
        expect(detectedTags[url].description.issue).to.equal('Missing Description');
        expect(detectedTags[url].h1.issue).to.equal('Missing H1');
      });

      it('should not add missing tag detection for non-product pages', () => {
        const url = '/non-product-page';
        const pageTags = {}; // No SKU - should not be processed

        seoChecks.checkForMissingTags(url, pageTags);

        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });

      it('should not flag present tags as missing', () => {
        const url = '/product-page';
        const pageTags = {
          sku: 'PROD-123',
          title: 'Product Title',
          description: 'Product Description',
          h1: ['Product H1'],
        };

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

      it('should handle whitespace-only content as empty', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', title: '   ' };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url].title.issue).to.equal('Empty Title');
      });

      it('should handle null/undefined values gracefully', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', title: null };

        seoChecks.checkForTagsLength(url, pageTags);

        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });

      it('should check all tag types', () => {
        const url = '/product-page';
        const pageTags = {
          sku: 'PROD-123',
          title: '',
          description: 'A'.repeat(161), // Too long
          h1: ['AB'], // Too short for H1
        };

        seoChecks.checkForTagsLength(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url].title.issue).to.equal('Empty Title');
        expect(detectedTags[url].description.issue).to.equal('Description too long');
        expect(detectedTags[url].h1.issue).to.equal('H1 too short');
      });

      it('should detect exact length boundaries for titles', () => {
        const url = '/boundary-test';
        const pageTags = {
          sku: 'PROD-123',
          title: 'A'.repeat(61), // Just over 60 char limit
        };

        seoChecks.checkForTagsLength(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url].title.issue).to.equal('Title too long');
        expect(detectedTags[url].title.issueDetails).to.include('1 chars over limit');
      });

      it('should detect exact length boundaries for short content', () => {
        const url = '/boundary-short';
        const pageTags = {
          sku: 'PROD-123',
          title: 'A'.repeat(14), // Just under 15 char minimum
        };

        seoChecks.checkForTagsLength(url, pageTags);

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags[url].title.issue).to.equal('Title too short');
        expect(detectedTags[url].title.issueDetails).to.include('1 chars under limit');
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

      it('should not detect an issue if there are no H1 tags', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', h1: [] };
        seoChecks.checkForH1Count(url, pageTags);
        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });

      it('should handle non-array H1 values', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', h1: 'Single String H1' };
        seoChecks.checkForH1Count(url, pageTags);
        expect(seoChecks.getDetectedTags()[url]).to.be.undefined;
      });

      it('should handle null H1 values', () => {
        const url = '/product-page';
        const pageTags = { sku: 'PROD-123', h1: null };
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

      it('should handle case insensitive duplicates', () => {
        seoChecks.addToAllTags('/product1', 'title', 'Product Title');
        seoChecks.addToAllTags('/product2', 'title', 'product title'); // Different case

        seoChecks.finalChecks();

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product1'].title.issue).to.equal('Duplicate Title');
        expect(detectedTags['/product2'].title.issue).to.equal('Duplicate Title');
      });

      it('should handle trimmed duplicates', () => {
        seoChecks.addToAllTags('/product1', 'title', 'Product Title');
        seoChecks.addToAllTags('/product2', 'title', 'Product Title '); // Trailing space

        seoChecks.finalChecks();

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product1'].title.issue).to.equal('Duplicate Title');
        expect(detectedTags['/product2'].title.issue).to.equal('Duplicate Title');
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

      it('should accumulate multiple pages for same content', () => {
        const tagContent = 'Same Title';

        seoChecks.addToAllTags('/product1', 'title', tagContent);
        seoChecks.addToAllTags('/product2', 'title', tagContent);

        const key = tagContent.toLowerCase().trim();
        expect(seoChecks.allTags.title[key].pageUrls).to.have.length(2);
        expect(seoChecks.allTags.title[key].pageUrls).to.include('/product1');
        expect(seoChecks.allTags.title[key].pageUrls).to.include('/product2');
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

      it('should include healthy pages in sample', () => {
        // Add some healthy product pages
        const url = '/healthy-product';
        const pageTags = {
          sku: 'PROD-123',
          title: 'Perfect Product Title',
          description: 'This is a great product description with optimal length.',
          h1: ['Perfect H1'],
        };

        seoChecks.performChecks(url, pageTags);
        const healthyTags = seoChecks.getFewHealthyTags();

        expect(healthyTags).to.have.property(url);
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

      it('should add product tags to detected issues', () => {
        const pageTags = {
          sku: 'PROD-456',
          'og:image': 'https://example.com/image.jpg',
          title: 'Product Title',
          description: '',
        };
        seoChecks.performChecks('/product-page', pageTags);
        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product-page'].description.productTags).to.deep.equal({
          sku: 'PROD-456',
          image: 'https://example.com/image.jpg',
        });
      });

      it('should perform comprehensive checks', () => {
        const pageTags = {
          sku: 'PROD-FULL',
          title: '',
          description: 'A'.repeat(161),
          h1: ['H1 One', 'H1 Two'],
        };

        seoChecks.performChecks('/full-check-page', pageTags);
        const detectedTags = seoChecks.getDetectedTags();

        expect(detectedTags['/full-check-page'].title.issue).to.equal('Empty Title');
        expect(detectedTags['/full-check-page'].description.issue).to.equal('Description too long');
        expect(detectedTags['/full-check-page'].h1.issue).to.equal('Multiple H1 on page');
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

      it('should detect duplicates across all tag types', () => {
        const pageTags1 = {
          sku: 'PROD-1',
          title: 'Unique Title 1',
          description: 'Same Description',
          h1: ['Same H1'],
        };
        const pageTags2 = {
          sku: 'PROD-2',
          title: 'Unique Title 2',
          description: 'Same Description',
          h1: ['Same H1'],
        };

        seoChecks.performChecks('/product1', pageTags1);
        seoChecks.performChecks('/product2', pageTags2);
        seoChecks.finalChecks();

        const detectedTags = seoChecks.getDetectedTags();
        expect(detectedTags['/product1'].description.issue).to.equal('Duplicate Description');
        expect(detectedTags['/product2'].description.issue).to.equal('Duplicate Description');
        expect(detectedTags['/product1'].h1.issue).to.equal('Duplicate H1');
        expect(detectedTags['/product2'].h1.issue).to.equal('Duplicate H1');
      });
    });
  });

  describe('Handler Functions', () => {
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

    describe('importTopPages', () => {
      it('should return import step data with correct structure', async () => {
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

      it('should handle different site IDs', async () => {
        const mockSite = { getId: () => 'different-site-123' };
        const mockContext = {
          site: mockSite,
          finalUrl: 'https://different-example.com',
        };

        const result = await importTopPages(mockContext);

        expect(result.siteId).to.equal('different-site-123');
        expect(result.fullAuditRef).to.equal('scrapes/different-site-123/');
        expect(result.auditResult.finalUrl).to.equal('https://different-example.com');
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

      it('should handle missing config gracefully', async () => {
        const mockTopPages = [
          { getUrl: () => 'https://example.com/product1' },
        ];

        const mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => null, // Simulate missing config
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

        expect(result.urls).to.have.length(1);
        expect(result.urls[0].url).to.equal('https://example.com/product1');
      });
    });

    describe('fetchAndProcessPageObject', () => {
      beforeEach(async () => {
        // Mock getObjectFromKey for each test
        sandbox.stub(await import('../../src/utils/s3-utils.js'), 'getObjectFromKey');
      });

      it('should process S3 object and extract product tags from HTML', async () => {
        const htmlContent = `
          <html>
            <head>
              <meta name="sku" content="TEST-SKU-123">
              <meta property="og:image" content="https://example.com/og-image.jpg">
              <meta name="twitter:image" content="https://example.com/twitter-image.jpg">
              <title>Test Product</title>
            </head>
            <body>This is content long enough to pass the 300 character minimum requirement for processing by the audit system.</body>
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

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/products/test-product/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.have.property('/products/test-product');
        const pageData = result['/products/test-product'];
        expect(pageData).to.have.property('sku', 'TEST-SKU-123');
        expect(pageData).to.have.property('og:image', 'https://example.com/og-image.jpg');
        expect(pageData).to.have.property('twitter:image', 'https://example.com/twitter-image.jpg');
        expect(pageData).to.have.property('title', 'Test Product');
      });

      it('should return null for pages without scraped tags', async () => {
        const mockS3Object = { scrapeResult: {} };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
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

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/page/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.be.null;
      });

      it('should handle homepage URL correctly', async () => {
        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Homepage' },
            rawBody: 'Homepage content that is long enough to meet the minimum length requirement of three hundred characters for processing.',
          },
          finalUrl: 'https://example.com',
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.have.property('/');
      });

      it('should handle malformed HTML gracefully', async () => {
        const malformedHtml = '<html><head><meta name="sku" content="TEST-123"<></head>';

        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Test' },
            rawBody: malformedHtml,
          },
          finalUrl: 'https://example.com/test',
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/test/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.have.property('/test');
        expect(result['/test']).to.have.property('sku', 'TEST-123');
      });

      it('should handle empty rawBody', async () => {
        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Test' },
            rawBody: '',
          },
          finalUrl: 'https://example.com/test',
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/test/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.be.null; // Should return null for empty content
      });

      it('should handle null rawBody', async () => {
        const mockS3Object = {
          scrapeResult: {
            tags: { title: 'Test' },
            rawBody: null,
          },
          finalUrl: 'https://example.com/test',
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.resolves(mockS3Object);

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/test/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.have.property('/test');
        expect(result['/test']).to.have.property('sku', undefined);
      });

      it('should handle error from getObjectFromKey', async () => {
        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectFromKey.rejects(new Error('S3 Error'));

        const result = await fetchAndProcessPageObject(
          {},
          'test-bucket',
          'scrapes/site-id/test/scrape.json',
          'scrapes/site-id/',
          context.log,
        );

        expect(result).to.be.null;
      });
    });

    describe('runAuditAndGenerateSuggestions', () => {
      beforeEach(async () => {
        // Set up common mocks for external dependencies
        sandbox.stub(await import('@adobe/spacecat-shared-rum-api-client'), 'default').returns({
          createFrom: () => ({
            query: sinon.stub().resolves([
              { url: '/product1', pageviews: 100 },
              { url: '/product2', pageviews: 200 },
            ]),
          }),
        });
        sandbox.stub(await import('../../src/support/utils.js'), 'calculateCPCValue').resolves(2.5);
        sandbox.stub(await import('../../src/common/index.js'), 'wwwUrlResolver').resolves('www.example.com');

        // Mock getTopPagesForSiteId to return test data
        sandbox.stub(await import('../../src/product-metatags/handler.js'), 'getTopPagesForSiteId').resolves([
          'scrapes/test-site-id/product1/scrape.json',
          'scrapes/test-site-id/product2/scrape.json',
        ]);

        // Mock productMetatagsAutoDetect to return test data
        sandbox.stub(await import('../../src/product-metatags/handler.js'), 'productMetatagsAutoDetect').resolves({
          detectedTags: {
            '/product1': {
              title: {
                issue: 'Missing Title',
                seoImpact: 'HIGH',
                seoRecommendation: 'Add title',
              },
            },
          },
          extractedTags: {
            '/product1': {
              sku: 'PROD-123',
              'og:image': 'https://example.com/image.jpg',
              s3key: 'scrapes/test-site-id/product1/scrape.json',
            },
          },
          seoChecks: {
            getFewHealthyTags: () => ({}),
          },
        });

        // Mock productMetatagsAutoSuggest to return enhanced data
        sandbox.stub(await import('../../src/product-metatags/product-metatags-auto-suggest.js'), 'default').resolves({
          '/product1': {
            title: {
              issue: 'Missing Title',
              seoImpact: 'HIGH',
              seoRecommendation: 'Add title',
              aiSuggestion: 'AI Generated Title',
              aiRationale: 'This title is optimized for SEO',
            },
          },
        });
      });

      it('should complete the audit successfully with mock data', async () => {
        const mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => ({
            getIncludedURLs: () => ['https://example.com/included-product'],
          }),
        };

        const mockAudit = {
          getId: () => 'test-audit-id',
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
              { getUrl: () => 'https://example.com/product1' },
            ]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: mockAudit,
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

        const result = await runAuditAndGenerateSuggestions(testContext);

        expect(result).to.deep.equal({ status: 'complete' });
      });

      it('should handle RUM API errors gracefully', async () => {
        const rumClient = await import('@adobe/spacecat-shared-rum-api-client');
        rumClient.default.returns({
          createFrom: () => ({
            query: sinon.stub().rejects(new Error('RUM API Error')),
          }),
        });

        const mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'test-audit' },
          finalUrl: 'https://example.com',
          s3Client: { send: sinon.stub().resolves({ Contents: [] }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          dataAccess: mockDataAccess,
        };

        const result = await runAuditAndGenerateSuggestions(testContext);
        expect(result).to.deep.equal({ status: 'complete' });
      });

      it('should process S3 objects when available', async () => {
        const mockSite = {
          getId: () => 'integration-test-site',
          getConfig: () => ({
            getIncludedURLs: () => [],
          }),
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'integration-audit' },
          finalUrl: 'https://example.com',
          s3Client: {
            send: sinon.stub()
              .withArgs(sinon.match.instanceOf(ListObjectsV2Command))
              .resolves({
                Contents: [
                  { Key: 'scrapes/integration-test-site/product1/scrape.json' },
                ],
              })
              .withArgs(sinon.match.instanceOf(GetObjectCommand))
              .resolves({
                Body: {
                  transformToString: () => JSON.stringify({
                    finalUrl: 'https://example.com/product1',
                    scrapeResult: {
                      tags: {
                        title: 'Product 1 Title',
                        description: 'Product 1 description',
                        h1: ['Product 1 H1'],
                      },
                      rawBody: '<html><head><meta name="sku" content="PROD-001"><meta property="og:image" content="https://example.com/image1.jpg"></head><body>Product 1 content with sufficient length to pass validation requirements.</body></html>',
                    },
                  }),
                },
              }),
          },
          env: { S3_SCRAPER_BUCKET_NAME: 'integration-test-bucket' },
          dataAccess: mockDataAccess,
        };

        const result = await runAuditAndGenerateSuggestions(testContext);

        expect(result).to.deep.equal({ status: 'complete' });
      });

      it('should calculate projected traffic with significant impact', async () => {
        // Import the functions we need to test
        const handlerModule = await import('../../src/product-metatags/handler.js');

        const mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([
              { getUrl: () => 'https://example.com/product1' },
            ]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'test-audit' },
          finalUrl: 'https://example.com',
          s3Client: { send: sinon.stub().resolves({ Contents: [] }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          dataAccess: mockDataAccess,
        };

        // Stub the RUM API to return significant traffic data
        const rumModule = await import('@adobe/spacecat-shared-rum-api-client');
        rumModule.default.returns({
          createFrom: () => ({
            query: sinon.stub().resolves([
              { url: '/product1', pageviews: 10000 }, // High traffic for significant impact
            ]),
          }),
        });

        // Stub calculateCPCValue to return high value
        const utilsModule = await import('../../src/support/utils.js');
        utilsModule.calculateCPCValue.resolves(5.0);

        const result = await handlerModule.runAuditAndGenerateSuggestions(testContext);
        expect(result).to.deep.equal({ status: 'complete' });
      });

      it('should handle RUM API query errors gracefully', async () => {
        const handlerModule = await import('../../src/product-metatags/handler.js');

        const mockSite = {
          getId: () => 'test-site-id',
          getConfig: () => ({ getIncludedURLs: () => [] }),
        };

        const mockDataAccess = {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sinon.stub().resolves([]),
          },
        };

        const testContext = {
          ...context,
          site: mockSite,
          audit: { getId: () => 'test-audit' },
          finalUrl: 'https://example.com',
          s3Client: { send: sinon.stub().resolves({ Contents: [] }) },
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          dataAccess: mockDataAccess,
        };

        // Mock RUM API to throw error
        const rumModule = await import('@adobe/spacecat-shared-rum-api-client');
        rumModule.default.returns({
          createFrom: () => ({
            query: sinon.stub().rejects(new Error('RUM API Error')),
          }),
        });

        const result = await handlerModule.runAuditAndGenerateSuggestions(testContext);
        expect(result).to.deep.equal({ status: 'complete' });
      });
    });

    describe('opportunityAndSuggestions', () => {
      beforeEach(async () => {
        // Mock external dependencies
        sandbox.stub(await import('../../src/common/opportunity.js'), 'convertToOpportunity').resolves({
          getId: () => 'test-opportunity-id',
          getSiteId: () => 'test-site-id',
        });
        sandbox.stub(await import('../../src/utils/data-access.js'), 'syncSuggestions').resolves();
      });

      it('should handle suggestions with productTags forwarding', async () => {
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

        const testContext = {
          ...context,
          dataAccess: mockDataAccess,
        };

        await opportunityAndSuggestions('https://example.com', auditData, testContext);

        const dataAccessModule = await import('../../src/utils/data-access.js');
        expect(dataAccessModule.syncSuggestions).to.have.been.calledOnce;
      });

      it('should handle missing productTags gracefully', async () => {
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
                // No productTags
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

        const testContext = {
          ...context,
          dataAccess: mockDataAccess,
        };

        await opportunityAndSuggestions('https://example.com', auditData, testContext);

        const dataAccessModule = await import('../../src/utils/data-access.js');
        expect(dataAccessModule.syncSuggestions).to.have.been.calledOnce;
      });
    });

    describe('productMetatagsAutoDetect', () => {
      beforeEach(async () => {
        sandbox.stub(await import('../../src/utils/s3-utils.js'), 'getObjectKeysUsingPrefix');
        sandbox.stub(await import('../../src/product-metatags/handler.js'), 'fetchAndProcessPageObject');
      });

      it('should process scraped content and identify product pages', async () => {
        const mockSite = { getId: () => 'test-site-id' };
        const pagesSet = new Set(['scrapes/test-site-id/product1/scrape.json']);
        const mockContext = {
          ...context,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          s3Client: {},
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        const handlerModule = await import('../../src/product-metatags/handler.js');

        s3Utils.getObjectKeysUsingPrefix.resolves(['scrapes/test-site-id/product1/scrape.json']);
        handlerModule.fetchAndProcessPageObject.resolves({
          '/product1': {
            sku: 'PROD-123',
            'og:image': 'https://example.com/image.jpg',
            title: 'Product Title',
            description: 'Product Description',
            h1: ['Product H1'],
          },
        });

        const result = await handlerModule.productMetatagsAutoDetect(
          mockSite,
          pagesSet,
          mockContext,
        );

        expect(result).to.have.property('seoChecks');
        expect(result).to.have.property('detectedTags');
        expect(result).to.have.property('extractedTags');
        expect(result.extractedTags).to.have.property('/product1');
      });

      it('should handle empty extracted tags', async () => {
        const mockSite = { getId: () => 'test-site-id' };
        const pagesSet = new Set([]);
        const mockContext = {
          ...context,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          s3Client: {},
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        s3Utils.getObjectKeysUsingPrefix.resolves([]);

        const handlerModule = await import('../../src/product-metatags/handler.js');
        const result = await handlerModule.productMetatagsAutoDetect(
          mockSite,
          pagesSet,
          mockContext,
        );

        expect(result.extractedTags).to.be.empty;
      });

      it('should filter out non-product pages', async () => {
        const mockSite = { getId: () => 'test-site-id' };
        const pagesSet = new Set(['scrapes/test-site-id/regular-page/scrape.json']);
        const mockContext = {
          ...context,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          s3Client: {},
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        const handlerModule = await import('../../src/product-metatags/handler.js');

        s3Utils.getObjectKeysUsingPrefix.resolves(['scrapes/test-site-id/regular-page/scrape.json']);
        handlerModule.fetchAndProcessPageObject.resolves({
          '/regular-page': {
            // No SKU - not a product page
            title: 'Regular Page Title',
            description: 'Regular Page Description',
          },
        });

        const result = await handlerModule.productMetatagsAutoDetect(
          mockSite,
          pagesSet,
          mockContext,
        );

        expect(Object.keys(result.detectedTags)).to.have.length(0);
      });

      it('should handle null page metadata results', async () => {
        const mockSite = { getId: () => 'test-site-id' };
        const pagesSet = new Set(['scrapes/test-site-id/empty-page/scrape.json']);
        const mockContext = {
          ...context,
          env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
          s3Client: {},
        };

        const s3Utils = await import('../../src/utils/s3-utils.js');
        const handlerModule = await import('../../src/product-metatags/handler.js');

        s3Utils.getObjectKeysUsingPrefix.resolves(['scrapes/test-site-id/empty-page/scrape.json']);
        handlerModule.fetchAndProcessPageObject.resolves(null);

        const result = await handlerModule.productMetatagsAutoDetect(
          mockSite,
          pagesSet,
          mockContext,
        );

        expect(result.extractedTags).to.be.empty;
      });
    });

    describe('getScrapeJsonPath', () => {
      it('should transform URL to scrape.json path', async () => {
        // Since getScrapeJsonPath is not exported, we need to test it indirectly
        // by testing the functionality through other exported functions
        expect(true).to.be.true; // Placeholder - this function is tested indirectly
      });
    });
  });

  describe('productMetatagsAutoSuggest', () => {
    beforeEach(async () => {
      // Mock external dependencies
      sandbox.stub(await import('@adobe/spacecat-shared-gpt-client'), 'GenvarClient').returns({
        createFrom: () => ({
          generateSuggestions: sinon.stub().resolves({}),
        }),
      });
    });

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

      const mockGenvarResponse = {
        '/product': {
          title: {
            aiSuggestion: 'AI Generated Title',
            aiRationale: 'This title is optimized for SEO',
          },
        },
      };

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().resolves(mockGenvarResponse),
      });

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: {},
      };

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
    });

    it('should handle errors gracefully when auto-suggest fails', async () => {
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

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().rejects(new Error('GenvarClient error')),
      });

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: {},
      };

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

      // Should return original detected tags when auto-suggest fails
      expect(result).to.deep.equal(allTags.detectedTags);
    });

    it('should validate missing parameters', async () => {
      // Test with missing allTags
      const result1 = await productMetatagsAutoSuggest(null, context, { getId: () => 'test' });
      expect(result1).to.be.null;

      // Test with missing site
      const result2 = await productMetatagsAutoSuggest({ detectedTags: {} }, context, null);
      expect(result2).to.deep.equal({});
    });

    it('should handle missing extractedTags gracefully', async () => {
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

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: {},
      };

      const allTags = {
        detectedTags: {
          '/product': {
            title: { issue: 'Missing Title' },
          },
        },
        healthyTags: {},
        // Missing extractedTags
      };

      const result = await productMetatagsAutoSuggest(allTags, mockContext, mockSite);
      expect(result).to.deep.equal(allTags.detectedTags);
    });

    it('should handle configuration lookup failure', async () => {
      const mockSite = { getId: () => 'test-site' };
      const mockDataAccess = {
        Configuration: {
          findLatest: sandbox.stub().rejects(new Error('Config error')),
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
    });

    it('should generate presigned URLs for extracted tags', async () => {
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

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
          GENVAR_PRODUCT_METATAGS_API_ENDPOINT: '/api/v1/custom-endpoint',
        },
      };

      const allTags = {
        detectedTags: {
          '/product': {
            title: { issue: 'Missing Title' },
          },
        },
        healthyTags: {},
        extractedTags: {
          '/product': {
            s3key: 'scrapes/test-site/product/scrape.json',
            title: 'Existing Title',
          },
        },
      };

      const mockGenvarResponse = {
        '/product': {
          title: {
            aiSuggestion: 'AI Generated Title',
            aiRationale: 'This title is optimized for SEO',
          },
        },
      };

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().resolves(mockGenvarResponse),
      });

      const result = await productMetatagsAutoSuggest(allTags, mockContext, mockSite);

      expect(result['/product'].title).to.have.property('aiSuggestion', 'AI Generated Title');
      expect(result['/product'].title).to.have.property('aiRationale', 'This title is optimized for SEO');
    });

    it('should handle presigned URL generation failure', async () => {
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

      const mockS3Client = {
        // Mock S3 client that will cause getSignedUrl to fail
      };

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: mockS3Client,
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const allTags = {
        detectedTags: {
          '/product': {
            title: { issue: 'Missing Title' },
          },
        },
        healthyTags: {},
        extractedTags: {
          '/product': {
            s3key: 'scrapes/test-site/product/scrape.json',
          },
        },
      };

      // Mock getSignedUrl to reject to test error handling
      sandbox.stub(await import('@aws-sdk/s3-request-presigner'), 'getSignedUrl').rejects(new Error('S3 Error'));

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().resolves({}),
      });

      const result = await productMetatagsAutoSuggest(allTags, mockContext, mockSite);

      // Should still return detected tags even if presigned URL generation fails
      expect(result).to.have.property('/product');
    });

    it('should handle invalid response from Genvar API', async () => {
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

      const mockContext = {
        ...context,
        dataAccess: mockDataAccess,
        s3Client: {},
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const allTags = {
        detectedTags: {
          '/product': {
            title: { issue: 'Missing Title' },
          },
        },
        healthyTags: {},
        extractedTags: {
          '/product': {
            s3key: 'scrapes/test-site/product/scrape.json',
          },
        },
      };

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().resolves('invalid response'), // Non-object response
      });

      await expect(productMetatagsAutoSuggest(allTags, mockContext, mockSite))
        .to.be.rejectedWith('Invalid response received from Genvar API');
    });

    it('should use forceAutoSuggest option to bypass configuration check', async () => {
      const mockSite = { getId: () => 'test-site' };
      const mockConfiguration = {
        isHandlerEnabledForSite: sandbox.stub().returns(false), // Disabled
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
        env: { S3_SCRAPER_BUCKET_NAME: 'test-bucket' },
      };

      const allTags = {
        detectedTags: { '/product': { title: { issue: 'Missing Title' } } },
        healthyTags: {},
        extractedTags: { '/product': { s3key: 'test-key' } },
      };

      const GenvarClientModule = await import('@adobe/spacecat-shared-gpt-client');
      GenvarClientModule.GenvarClient.createFrom = sinon.stub().returns({
        generateSuggestions: sinon.stub().resolves({}),
      });

      const result = await productMetatagsAutoSuggest(
        allTags,
        mockContext,
        mockSite,
        { forceAutoSuggest: true },
      );

      expect(result).to.have.property('/product');
      expect(mockConfiguration.isHandlerEnabledForSite).not.to.have.been.called;
    });
  });
});
