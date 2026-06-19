/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { toPathname, normalizePathnameWithQuery } from '../../../src/prerender/utils/utils.js';

use(sinonChai);

describe('Prerender Utils', () => {
  let sandbox;
  let log;
  let mockSite;
  let mockTierClient;
  let mockEntitlement;
  let TierClientStub;
  let EntitlementStub;
  let utils;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    log = {
      debug: sandbox.stub(),
      warn: sandbox.stub(),
    };

    mockSite = {
      getId: sandbox.stub().returns('test-site-id'),
    };

    mockEntitlement = {
      getTier: sandbox.stub(),
    };

    mockTierClient = {
      checkValidEntitlement: sandbox.stub().resolves({ entitlement: mockEntitlement }),
    };

    TierClientStub = {
      createForSite: sandbox.stub().resolves(mockTierClient),
    };

    EntitlementStub = {
      PRODUCT_CODES: {
        ASO: 'aso-product-code',
        LLMO: 'llmo-product-code',
      },
      TIERS: {
        PAID: 'paid',
        FREE: 'free',
      },
    };

    utils = await esmock('../../../src/prerender/utils/utils.js', {
      '@adobe/spacecat-shared-tier-client': {
        TierClient: TierClientStub,
      },
      '@adobe/spacecat-shared-data-access': {
        Entitlement: EntitlementStub,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isPaidLLMOCustomer', () => {
    it('should return true for paid tier customers', async () => {
      mockEntitlement.getTier.returns('paid');

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.true;
      expect(TierClientStub.createForSite).to.have.been.calledWith(context, mockSite, 'llmo-product-code');
      expect(mockTierClient.checkValidEntitlement).to.have.been.calledOnce;
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/isPaidLLMOCustomer check.*siteId=test-site-id.*tier=paid.*isPaid=true/),
      );
    });

    it('should return false for free tier customers', async () => {
      mockEntitlement.getTier.returns('free');

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(TierClientStub.createForSite).to.have.been.calledWith(context, mockSite, 'llmo-product-code');
      expect(mockTierClient.checkValidEntitlement).to.have.been.calledOnce;
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/isPaidLLMOCustomer check.*siteId=test-site-id.*tier=free.*isPaid=false/),
      );
    });

    it('should handle null tier gracefully', async () => {
      mockEntitlement.getTier.returns(null);

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/tier=null.*isPaid=false/),
      );
    });

    it('should handle undefined tier (using nullish coalescing)', async () => {
      mockEntitlement.getTier.returns(undefined);

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(log.debug).to.have.been.calledWith(
        sinon.match(/tier=null.*isPaid=false/),
      );
    });

    it('should return false and log warning when TierClient.createForSite fails', async () => {
      TierClientStub.createForSite.rejects(new Error('TierClient creation failed'));

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to check paid LLMO customer status.*siteId=test-site-id.*TierClient creation failed/),
      );
    });

    it('should return false and log warning when checkValidEntitlement fails', async () => {
      mockTierClient.checkValidEntitlement.rejects(new Error('Entitlement check failed'));

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to check paid LLMO customer status.*siteId=test-site-id.*Entitlement check failed/),
      );
    });

    it('should return false and log warning when getTier throws error', async () => {
      mockEntitlement.getTier.throws(new Error('getTier failed'));

      const context = { site: mockSite, log };
      const result = await utils.isPaidLLMOCustomer(context);

      expect(result).to.be.false;
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Failed to check paid LLMO customer status.*siteId=test-site-id.*getTier failed/),
      );
    });
  });

  describe('mergeAndGetUniqueHtmlUrls', () => {
    it('should merge multiple URL arrays and remove duplicates by path', () => {
      const urls1 = ['https://www.example.com/page1', 'https://www.example.com/page2'];
      const urls2 = ['https://example.com/page1', 'https://www.example.com/page3'];
      const urls3 = ['https://example.com/page2/', 'https://www.example.com/page4'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2, urls3);

      // Should have 4 unique paths: /page1, /page2, /page3, /page4
      expect(result.urls).to.have.lengthOf(4);
      expect(result.urls).to.include('https://www.example.com/page1'); // First occurrence
      expect(result.urls).to.include('https://www.example.com/page2'); // First occurrence
      expect(result.urls).to.include('https://www.example.com/page3');
      expect(result.urls).to.include('https://www.example.com/page4');
      expect(result.filteredCount).to.equal(0);
    });

    it('should preserve the first URL when duplicates have www differences', () => {
      const urls1 = ['https://www.example.com/page'];
      const urls2 = ['https://example.com/page'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://www.example.com/page'); // First one wins
      expect(result.filteredCount).to.equal(0);
    });

    it('should normalize trailing slashes in paths', () => {
      const urls1 = ['https://example.com/page/'];
      const urls2 = ['https://example.com/page'];
      const urls3 = ['https://example.com/page//'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2, urls3);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page/'); // First one wins
      expect(result.filteredCount).to.equal(0);
    });

    it('should treat root paths as identical', () => {
      const urls1 = ['https://example.com/'];
      const urls2 = ['https://example.com'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2);

      // Root paths with and without trailing slash are the same (both normalize to '/')
      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/'); // First one wins
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle empty arrays', () => {
      const result = utils.mergeAndGetUniqueHtmlUrls([], [], []);

      expect(result.urls).to.be.an('array');
      expect(result.urls).to.have.lengthOf(0);
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle single array input', () => {
      const urls = ['https://example.com/page1', 'https://example.com/page2'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls).to.deep.equal(urls);
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle invalid URLs gracefully', () => {
      const urls1 = ['https://example.com/valid'];
      const urls2 = ['not-a-valid-url'];
      const urls3 = ['https://example.com/another'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2, urls3);

      // Should include all URLs, even invalid ones
      expect(result.urls).to.have.lengthOf(3);
      expect(result.urls).to.include('https://example.com/valid');
      expect(result.urls).to.include('not-a-valid-url');
      expect(result.urls).to.include('https://example.com/another');
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle URLs with query parameters (default: dedup by pathname only)', () => {
      const urls1 = ['https://example.com/page?foo=bar'];
      const urls2 = ['https://example.com/page?baz=qux'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2);

      // Same path but different query params - should keep only first one
      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page?foo=bar');
      expect(result.filteredCount).to.equal(0);
    });

    it('should keep URLs with different query params when includeQueryParams is true', () => {
      const urls = [
        'https://example.com/page?filter=iphone',
        'https://example.com/page?filter=mac',
        'https://example.com/page',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls, { includeQueryParams: true });

      expect(result.urls).to.have.lengthOf(3);
      expect(result.urls).to.deep.equal(urls);
    });

    it('should still dedup identical URLs when includeQueryParams is true', () => {
      const urls = [
        'https://example.com/page?filter=iphone',
        'https://example.com/page?filter=iphone',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls, { includeQueryParams: true });

      expect(result.urls).to.have.lengthOf(1);
    });

    it('should keep URLs with same query params in different order when includeQueryParams is true', () => {
      const urls = [
        'https://example.com/page?b=2&a=1',
        'https://example.com/page?a=1&b=2',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls, { includeQueryParams: true });

      // Raw query strings differ, so both are kept (exact CSV input preserved)
      expect(result.urls).to.have.lengthOf(2);
    });

    it('should work with multiple arrays and includeQueryParams option', () => {
      const urls1 = ['https://example.com/page?a=1'];
      const urls2 = ['https://example.com/page?b=2'];
      const urls3 = ['https://example.com/other'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2, urls3, { includeQueryParams: true });

      expect(result.urls).to.have.lengthOf(3);
    });

    it('should handle URLs with hash fragments', () => {
      const urls1 = ['https://example.com/page#section1'];
      const urls2 = ['https://example.com/page#section2'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2);

      // Same path but different hash - should keep only first one
      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page#section1');
      expect(result.filteredCount).to.equal(0);
    });

    it('should handle mixed URL arrays with duplicates across multiple sources', () => {
      const agenticUrls = [
        'https://www.example.com/agentic1',
        'https://example.com/agentic2/',
      ];
      const topPagesUrls = [
        'https://example.com/agentic1', // duplicate with www difference
        'https://www.example.com/top1',
      ];
      const includedUrls = [
        'https://example.com/agentic2', // duplicate with trailing slash difference
        'https://example.com/included1',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(agenticUrls, topPagesUrls, includedUrls);

      // Should have 4 unique paths: /agentic1, /agentic2, /top1, /included1
      expect(result.urls).to.have.lengthOf(4);
      expect(result.filteredCount).to.equal(0);
    });

    it('should preserve original URL format (not normalize domain)', () => {
      const urls = ['https://www.example.com/page', 'https://www.example.com/other'];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      // Should keep www in the result
      expect(result.urls[0]).to.equal('https://www.example.com/page');
      expect(result.urls[1]).to.equal('https://www.example.com/other');
      expect(result.filteredCount).to.equal(0);
    });

    it('should filter out PDF URLs', () => {
      const urls = [
        'https://example.com/page1',
        'https://example.com/document.pdf',
        'https://example.com/page2',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      expect(result.urls).to.have.lengthOf(2);
      expect(result.urls).to.include('https://example.com/page1');
      expect(result.urls).to.include('https://example.com/page2');
      expect(result.urls).to.not.include('https://example.com/document.pdf');
      expect(result.filteredCount).to.equal(1);
    });

    it('should filter out image URLs', () => {
      const urls = [
        'https://example.com/page',
        'https://example.com/logo.png',
        'https://example.com/photo.jpg',
        'https://example.com/icon.svg',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page');
      expect(result.filteredCount).to.equal(3);
    });

    it('should filter out various non-HTML file types', () => {
      const urls = [
        'https://example.com/page',
        'https://example.com/file.pdf',
        'https://example.com/image.jpg',
        'https://example.com/video.mp4',
        'https://example.com/archive.zip',
        'https://example.com/data.json',
        'https://example.com/style.css',
        'https://example.com/script.js',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page');
      expect(result.filteredCount).to.equal(7);
    });

    it('should handle mixed HTML and non-HTML URLs with duplicates', () => {
      const urls1 = [
        'https://www.example.com/page1',
        'https://example.com/doc.pdf',
        'https://example.com/page2',
      ];
      const urls2 = [
        'https://example.com/page1', // duplicate
        'https://example.com/image.png',
        'https://example.com/page3',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls1, urls2);

      expect(result.urls).to.have.lengthOf(3);
      expect(result.urls).to.include('https://www.example.com/page1');
      expect(result.urls).to.include('https://example.com/page2');
      expect(result.urls).to.include('https://example.com/page3');
      expect(result.filteredCount).to.equal(2); // pdf and png
    });

    it('should be case-insensitive when checking file extensions', () => {
      const urls = [
        'https://example.com/page',
        'https://example.com/document.PDF',
        'https://example.com/image.JPG',
        'https://example.com/photo.Png',
      ];

      const result = utils.mergeAndGetUniqueHtmlUrls(urls);

      expect(result.urls).to.have.lengthOf(1);
      expect(result.urls[0]).to.equal('https://example.com/page');
      expect(result.filteredCount).to.equal(3);
    });
  });

  describe('toPathname', () => {
    it('should return the pathname for a valid URL', () => {
      expect(toPathname('https://www.adobe.com/test/page')).to.equal('/test/page');
    });

    it('should return lowercased raw string for an invalid URL', () => {
      expect(toPathname('Not-A-Valid-URL')).to.equal('not-a-valid-url');
    });

    it('should strip trailing slash from non-root paths', () => {
      expect(toPathname('https://www.adobe.com/test/page/')).to.equal('/test/page');
    });

    it('should preserve / for root path', () => {
      expect(toPathname('https://adobe.com/')).to.equal('/');
    });

    it('should return / for a bare domain with no path', () => {
      expect(toPathname('https://adobe.com')).to.equal('/');
    });

    it('should lowercase the pathname', () => {
      expect(toPathname('https://www.adobe.com/Test/Page')).to.equal('/test/page');
    });

    it('should lowercase and strip trailing slash together', () => {
      expect(toPathname('https://www.adobe.com/Test/Page/')).to.equal('/test/page');
    });
  });

  describe('normalizePathnameWithQuery', () => {
    it('should return the pathname for a valid URL', () => {
      expect(normalizePathnameWithQuery('https://www.adobe.com/test/page')).to.equal('/test/page');
    });

    it('should strip trailing slash from non-root paths', () => {
      expect(normalizePathnameWithQuery('https://www.adobe.com/test/page/')).to.equal('/test/page');
    });

    it('should preserve / for root path', () => {
      expect(normalizePathnameWithQuery('https://adobe.com/')).to.equal('/');
    });

    it('should append the query string', () => {
      expect(normalizePathnameWithQuery('https://adobe.com/test?foo=bar')).to.equal('/test?foo=bar');
    });

    it('should lowercase the pathname but preserve query param casing', () => {
      expect(normalizePathnameWithQuery('https://adobe.com/Test/Page?Token=ABC')).to.equal('/test/page?Token=ABC');
    });

    it('should lowercase and strip trailing slash together', () => {
      expect(normalizePathnameWithQuery('https://adobe.com/Test/Page/?foo=bar')).to.equal('/test/page?foo=bar');
    });

    it('should return lowercased raw string for an invalid URL', () => {
      expect(normalizePathnameWithQuery('Not-A-URL')).to.equal('not-a-url');
    });

    it('should preserve percent-encoding and lowercase hex digits (%41BC/Page → %41bc/page)', () => {
      expect(normalizePathnameWithQuery('https://example.com/%41BC/Page')).to.equal('/%41bc/page');
    });
  });

  describe('pathname-based suggestion key dedup', () => {
    const AUDIT_TYPE = 'prerender';
    const buildKey = (data) => (data.key ? data.key : `${toPathname(data.url)}|${AUDIT_TYPE}`);

    // Case 1: existing suggestion updated in place after domain shift (no duplicate created)
    it('should match existing and new suggestion by pathname when domain shifts (www → no-www)', () => {
      const existing = [{ url: 'https://www.adobe.com/test' }];
      const newData = [{ url: 'https://adobe.com/test' }];

      const newDataKeySet = new Set(newData.map(buildKey));
      const updatedInPlace = existing.filter((s) => newDataKeySet.has(buildKey(s)));
      const createdNew = newData.filter(
        (d) => !new Set(existing.map(buildKey)).has(buildKey(d)),
      );

      expect(updatedInPlace).to.have.lengthOf(1);
      expect(createdNew).to.have.lengthOf(0);
    });

    // Case 1: trailing slash variant treated as same page (no duplicate)
    it('should match existing and new suggestion by pathname when trailing slash differs', () => {
      const existing = [{ url: 'https://adobe.com/products' }];
      const newData = [{ url: 'https://adobe.com/products/' }];

      const newDataKeySet = new Set(newData.map(buildKey));
      const updatedInPlace = existing.filter((s) => newDataKeySet.has(buildKey(s)));
      const createdNew = newData.filter(
        (d) => !new Set(existing.map(buildKey)).has(buildKey(d)),
      );

      expect(updatedInPlace).to.have.lengthOf(1);
      expect(createdNew).to.have.lengthOf(0);
    });

    // Case 2: existing suggestion marked outdated when page is scraped but no longer needs prerender
    it('should identify existing suggestion as outdated when its pathname is not in new audit data', () => {
      const existing = [{ url: 'https://adobe.com/old-page' }];
      const newData = [{ url: 'https://adobe.com/new-page' }];

      const newDataKeySet = new Set(newData.map(buildKey));
      const outdated = existing.filter((s) => !newDataKeySet.has(buildKey(s)));

      expect(outdated).to.have.lengthOf(1);
    });

    // Case 5: genuinely new page creates a new suggestion
    it('should identify new audit data as a new suggestion when no existing suggestion matches its pathname', () => {
      const existing = [{ url: 'https://adobe.com/existing-page' }];
      const newData = [
        { url: 'https://adobe.com/existing-page' },
        { url: 'https://adobe.com/brand-new-page' },
      ];

      const existingKeySet = new Set(existing.map(buildKey));
      const createdNew = newData.filter((d) => !existingKeySet.has(buildKey(d)));

      expect(createdNew).to.have.lengthOf(1);
      expect(createdNew[0].url).to.equal('https://adobe.com/brand-new-page');
    });
  });
});
