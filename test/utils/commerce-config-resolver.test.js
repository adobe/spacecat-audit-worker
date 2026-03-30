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
import {
  findBestMatchingStoreViewUrl,
  transformToCommerceConfig,
  configGroupKey,
  resolveManualCommerceConfig,
  createMemoizedManualConfigResolver,
} from '../../src/utils/commerce-config-resolver.js';

describe('commerce-config-resolver', () => {
  describe('findBestMatchingStoreViewUrl', () => {
    const config = {
      'https://www.bulk.com/ro': { environmentId: 'env-ro' },
      'https://www.bulk.com': { environmentId: 'env-default' },
      'https://www.bulk.com/ro/electronics': { environmentId: 'env-ro-elec' },
    };

    it('returns the most specific matching store view URL', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.bulk.com/ro/products/sofa.html'))
        .to.equal('https://www.bulk.com/ro');
    });

    it('returns deepest path when multiple match', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.bulk.com/ro/electronics/tv.html'))
        .to.equal('https://www.bulk.com/ro/electronics');
    });

    it('falls back to generic when no specific path matches', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.bulk.com/en/products/chair.html'))
        .to.equal('https://www.bulk.com');
    });

    it('returns null when no URL matches', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.other.com/products/item.html'))
        .to.be.null;
    });

    it('handles boundary safety - /ro should not match /roma', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.bulk.com/roma/products/item.html'))
        .to.equal('https://www.bulk.com');
    });

    it('handles exact match', () => {
      expect(findBestMatchingStoreViewUrl(config, 'https://www.bulk.com/ro'))
        .to.equal('https://www.bulk.com/ro');
    });

    it('handles trailing slashes', () => {
      const configWithSlash = {
        'https://www.bulk.com/ro/': { environmentId: 'env-ro' },
      };
      expect(findBestMatchingStoreViewUrl(configWithSlash, 'https://www.bulk.com/ro/products/item.html'))
        .to.equal('https://www.bulk.com/ro/');
    });

    it('returns null for empty config', () => {
      expect(findBestMatchingStoreViewUrl({}, 'https://www.bulk.com/ro/item.html'))
        .to.be.null;
    });

    it('returns null for null/undefined config', () => {
      expect(findBestMatchingStoreViewUrl(null, 'https://www.bulk.com/item.html'))
        .to.be.null;
      expect(findBestMatchingStoreViewUrl(undefined, 'https://www.bulk.com/item.html'))
        .to.be.null;
    });

    it('returns null for empty product URL', () => {
      expect(findBestMatchingStoreViewUrl(config, '')).to.be.null;
      expect(findBestMatchingStoreViewUrl(config, null)).to.be.null;
      expect(findBestMatchingStoreViewUrl(config, undefined)).to.be.null;
    });
  });

  describe('transformToCommerceConfig', () => {
    it('transforms all fields correctly', () => {
      const storeViewConfig = {
        environmentId: 'env-123',
        websiteCode: 'web-code',
        storeCode: 'store-code',
        storeViewCode: 'view-code',
        magentoEndpoint: 'https://commerce.example.com/graphql',
        magentoAPIKey: 'api-key-123',
      };

      const result = transformToCommerceConfig(storeViewConfig);

      expect(result).to.deep.equal({
        url: 'https://commerce.example.com/graphql',
        headers: {
          'Magento-Environment-Id': 'env-123',
          'Magento-Website-Code': 'web-code',
          'Magento-Store-Code': 'store-code',
          'Magento-Store-View-Code': 'view-code',
          'x-api-key': 'api-key-123',
        },
      });
    });

    it('omits optional fields when not present', () => {
      const storeViewConfig = {
        environmentId: 'env-123',
        websiteCode: 'web-code',
        storeCode: 'store-code',
        storeViewCode: 'view-code',
      };

      const result = transformToCommerceConfig(storeViewConfig);

      expect(result.url).to.be.undefined;
      expect(result.headers).to.not.have.property('x-api-key');
      expect(result.headers['Magento-Environment-Id']).to.equal('env-123');
    });

    it('skips empty string values in headers', () => {
      const storeViewConfig = {
        environmentId: 'env-123',
        websiteCode: '',
        storeCode: 'store-code',
        storeViewCode: 'view-code',
        magentoAPIKey: '',
      };

      const result = transformToCommerceConfig(storeViewConfig);

      expect(result.headers).to.not.have.property('Magento-Website-Code');
      expect(result.headers).to.not.have.property('x-api-key');
    });

    it('returns empty headers for null input', () => {
      const result = transformToCommerceConfig(null);
      expect(result).to.deep.equal({ url: undefined, headers: {} });
    });

    it('returns empty headers for undefined input', () => {
      const result = transformToCommerceConfig(undefined);
      expect(result).to.deep.equal({ url: undefined, headers: {} });
    });
  });

  describe('configGroupKey', () => {
    it('returns storeViewCode from headers', () => {
      const config = {
        url: 'https://example.com/graphql',
        headers: { 'Magento-Store-View-Code': 'view-ro' },
      };
      expect(configGroupKey(config)).to.equal('view-ro');
    });

    it('returns _default for null config', () => {
      expect(configGroupKey(null)).to.equal('_default');
    });

    it('returns _default for undefined config', () => {
      expect(configGroupKey(undefined)).to.equal('_default');
    });

    it('returns _default when header is missing', () => {
      expect(configGroupKey({ headers: {} })).to.equal('_default');
      expect(configGroupKey({})).to.equal('_default');
    });
  });

  describe('resolveManualCommerceConfig', () => {
    const commerceLlmoConfig = {
      'https://www.bulk.com/ro': {
        environmentId: 'env-ro',
        websiteCode: 'web-ro',
        storeCode: 'store-ro',
        storeViewCode: 'view-ro',
        magentoEndpoint: 'https://commerce.ro/graphql',
      },
      'https://www.bulk.com': {
        environmentId: 'env-default',
        websiteCode: 'web-default',
        storeCode: 'store-default',
        storeViewCode: 'view-default',
      },
    };

    it('returns transformed config for matching URL', () => {
      const result = resolveManualCommerceConfig(commerceLlmoConfig, 'https://www.bulk.com/ro/products/item.html');
      expect(result).to.not.be.null;
      expect(result.headers['Magento-Environment-Id']).to.equal('env-ro');
      expect(result.headers['Magento-Store-View-Code']).to.equal('view-ro');
      expect(result.url).to.equal('https://commerce.ro/graphql');
    });

    it('returns null when no match found', () => {
      const result = resolveManualCommerceConfig(commerceLlmoConfig, 'https://www.other.com/item.html');
      expect(result).to.be.null;
    });

    it('returns null for empty config', () => {
      expect(resolveManualCommerceConfig({}, 'https://www.bulk.com/item.html')).to.be.null;
    });

    it('returns null for null config', () => {
      expect(resolveManualCommerceConfig(null, 'https://www.bulk.com/item.html')).to.be.null;
    });

    it('returns null for undefined config', () => {
      expect(resolveManualCommerceConfig(undefined, 'https://www.bulk.com/item.html')).to.be.null;
    });
  });

  describe('createMemoizedManualConfigResolver', () => {
    it('reads commerceLlmoConfig from site once and caches results', () => {
      const commerceLlmoConfig = {
        'https://www.bulk.com/ro': {
          environmentId: 'env-ro',
          websiteCode: 'web-ro',
          storeCode: 'store-ro',
          storeViewCode: 'view-ro',
        },
      };

      const getConfig = sinon.stub().returns({
        state: { commerceLlmoConfig },
      });
      const site = { getConfig };

      const resolver = createMemoizedManualConfigResolver(site);

      // Call twice with same URL
      const result1 = resolver('https://www.bulk.com/ro/item1.html');
      const result2 = resolver('https://www.bulk.com/ro/item2.html');
      const result3 = resolver('https://www.bulk.com/ro/item1.html');

      expect(result1.headers['Magento-Environment-Id']).to.equal('env-ro');
      expect(result2.headers['Magento-Environment-Id']).to.equal('env-ro');
      expect(result3.headers['Magento-Environment-Id']).to.equal('env-ro');

      // getConfig called only once during construction
      expect(getConfig.callCount).to.equal(1);
    });

    it('returns null for all URLs when no commerceLlmoConfig', () => {
      const site = {
        getConfig: sinon.stub().returns({ state: {} }),
      };

      const resolver = createMemoizedManualConfigResolver(site);
      expect(resolver('https://www.bulk.com/item.html')).to.be.null;
    });

    it('returns null for non-matching URLs', () => {
      const commerceLlmoConfig = {
        'https://www.bulk.com/ro': {
          environmentId: 'env-ro',
          websiteCode: 'web-ro',
          storeCode: 'store-ro',
          storeViewCode: 'view-ro',
        },
      };
      const site = {
        getConfig: sinon.stub().returns({ state: { commerceLlmoConfig } }),
      };

      const resolver = createMemoizedManualConfigResolver(site);
      expect(resolver('https://www.other.com/item.html')).to.be.null;
    });

    it('handles site with no getConfig', () => {
      const resolver = createMemoizedManualConfigResolver(null);
      expect(resolver('https://www.bulk.com/item.html')).to.be.null;
    });

    it('handles site with getConfig returning null', () => {
      const site = { getConfig: sinon.stub().returns(null) };
      const resolver = createMemoizedManualConfigResolver(site);
      expect(resolver('https://www.bulk.com/item.html')).to.be.null;
    });
  });
});
