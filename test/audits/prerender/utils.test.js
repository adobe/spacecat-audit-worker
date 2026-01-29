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

/* eslint-env mocha */

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

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

  describe('mergeUniqueUrls', () => {
    it('should merge multiple URL arrays and remove duplicates by path', () => {
      const urls1 = ['https://www.example.com/page1', 'https://www.example.com/page2'];
      const urls2 = ['https://example.com/page1', 'https://www.example.com/page3'];
      const urls3 = ['https://example.com/page2/', 'https://www.example.com/page4'];

      const result = utils.mergeUniqueUrls(urls1, urls2, urls3);

      // Should have 4 unique paths: /page1, /page2, /page3, /page4
      expect(result).to.have.lengthOf(4);
      expect(result).to.include('https://www.example.com/page1'); // First occurrence
      expect(result).to.include('https://www.example.com/page2'); // First occurrence
      expect(result).to.include('https://www.example.com/page3');
      expect(result).to.include('https://www.example.com/page4');
    });

    it('should preserve the first URL when duplicates have www differences', () => {
      const urls1 = ['https://www.example.com/page'];
      const urls2 = ['https://example.com/page'];

      const result = utils.mergeUniqueUrls(urls1, urls2);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('https://www.example.com/page'); // First one wins
    });

    it('should normalize trailing slashes in paths', () => {
      const urls1 = ['https://example.com/page/'];
      const urls2 = ['https://example.com/page'];
      const urls3 = ['https://example.com/page//'];

      const result = utils.mergeUniqueUrls(urls1, urls2, urls3);

      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('https://example.com/page/'); // First one wins
    });

    it('should treat root paths as identical', () => {
      const urls1 = ['https://example.com/'];
      const urls2 = ['https://example.com'];

      const result = utils.mergeUniqueUrls(urls1, urls2);

      // Root paths with and without trailing slash are the same (both normalize to '/')
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('https://example.com/'); // First one wins
    });

    it('should handle empty arrays', () => {
      const result = utils.mergeUniqueUrls([], [], []);

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
    });

    it('should handle single array input', () => {
      const urls = ['https://example.com/page1', 'https://example.com/page2'];

      const result = utils.mergeUniqueUrls(urls);

      expect(result).to.have.lengthOf(2);
      expect(result).to.deep.equal(urls);
    });

    it('should handle invalid URLs gracefully', () => {
      const urls1 = ['https://example.com/valid'];
      const urls2 = ['not-a-valid-url'];
      const urls3 = ['https://example.com/another'];

      const result = utils.mergeUniqueUrls(urls1, urls2, urls3);

      // Should include all URLs, even invalid ones
      expect(result).to.have.lengthOf(3);
      expect(result).to.include('https://example.com/valid');
      expect(result).to.include('not-a-valid-url');
      expect(result).to.include('https://example.com/another');
    });

    it('should handle URLs with query parameters', () => {
      const urls1 = ['https://example.com/page?foo=bar'];
      const urls2 = ['https://example.com/page?baz=qux'];

      const result = utils.mergeUniqueUrls(urls1, urls2);

      // Same path but different query params - should keep only first one
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('https://example.com/page?foo=bar');
    });

    it('should handle URLs with hash fragments', () => {
      const urls1 = ['https://example.com/page#section1'];
      const urls2 = ['https://example.com/page#section2'];

      const result = utils.mergeUniqueUrls(urls1, urls2);

      // Same path but different hash - should keep only first one
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.equal('https://example.com/page#section1');
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

      const result = utils.mergeUniqueUrls(agenticUrls, topPagesUrls, includedUrls);

      // Should have 4 unique paths: /agentic1, /agentic2, /top1, /included1
      expect(result).to.have.lengthOf(4);
    });

    it('should preserve original URL format (not normalize domain)', () => {
      const urls = ['https://www.example.com/page', 'https://www.example.com/other'];

      const result = utils.mergeUniqueUrls(urls);

      // Should keep www in the result
      expect(result[0]).to.equal('https://www.example.com/page');
      expect(result[1]).to.equal('https://www.example.com/other');
    });
  });
});

