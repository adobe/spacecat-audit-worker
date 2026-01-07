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

import {
  extractPathPattern,
  groupUrlsByPattern,
  smartSampleUrls,
} from '../../src/utils/url-sampling.js';

import { expect } from 'chai';
import sinon from 'sinon';

describe('url-sampling', () => {
  describe('extractPathPattern', () => {
    it('returns /* for root URL', () => {
      expect(extractPathPattern('https://example.com/')).to.equal('/*');
      expect(extractPathPattern('https://example.com')).to.equal('/*');
    });

    it('returns /segment/* for single segment path', () => {
      expect(extractPathPattern('https://example.com/about')).to.equal('/about/*');
      expect(extractPathPattern('https://example.com/contact/')).to.equal('/contact/*');
    });

    it('returns first two segments for multi-segment paths', () => {
      expect(extractPathPattern('https://example.com/products/shoes/nike')).to.equal('/products/shoes/*');
      expect(extractPathPattern('https://example.com/blog/2024/seo-tips')).to.equal('/blog/2024/*');
      expect(extractPathPattern('https://example.com/de/products/shoes')).to.equal('/de/products/*');
    });

    it('returns /unknown/* for invalid URLs', () => {
      expect(extractPathPattern('not-a-url')).to.equal('/unknown/*');
      expect(extractPathPattern('')).to.equal('/unknown/*');
    });
  });

  describe('groupUrlsByPattern', () => {
    it('groups URLs by their path pattern', () => {
      const urls = [
        'https://example.com/products/shoes/nike',
        'https://example.com/products/shoes/adidas',
        'https://example.com/blog/2024/post1',
        'https://example.com/blog/2024/post2',
        'https://example.com/about',
      ];

      const groups = groupUrlsByPattern(urls);

      expect(groups['/products/shoes/*']).to.have.lengthOf(2);
      expect(groups['/blog/2024/*']).to.have.lengthOf(2);
      expect(groups['/about/*']).to.have.lengthOf(1);
    });

    it('returns empty object for empty array', () => {
      const groups = groupUrlsByPattern([]);
      expect(groups).to.deep.equal({});
    });
  });

  describe('smartSampleUrls', () => {
    it('returns empty array for null or empty input', () => {
      expect(smartSampleUrls(null)).to.deep.equal([]);
      expect(smartSampleUrls([])).to.deep.equal([]);
    });

    it('returns all URLs if count is below maxUrls', () => {
      const urls = [
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/c',
      ];

      const result = smartSampleUrls(urls, 200);
      expect(result).to.deep.equal(urls);
    });

    it('samples proportionally from each group', () => {
      // Create 10 URLs from /products/* and 10 from /blog/*
      const urls = [];
      for (let i = 0; i < 10; i += 1) {
        urls.push(`https://example.com/products/shoes/item${i}`);
      }
      for (let i = 0; i < 10; i += 1) {
        urls.push(`https://example.com/blog/2024/post${i}`);
      }

      // Sample only 6 - should get 3 from each group
      const result = smartSampleUrls(urls, 6);

      expect(result).to.have.lengthOf(6);

      const productUrls = result.filter((u) => u.includes('/products/'));
      const blogUrls = result.filter((u) => u.includes('/blog/'));

      expect(productUrls).to.have.lengthOf(3);
      expect(blogUrls).to.have.lengthOf(3);
    });

    it('handles uneven group sizes', () => {
      const urls = [
        'https://example.com/products/shoes/item1',
        'https://example.com/products/shoes/item2',
        'https://example.com/blog/2024/post1',
      ];

      // Sample 2 - should get 1 from each group
      const result = smartSampleUrls(urls, 2);

      expect(result).to.have.lengthOf(2);
    });

    it('logs sampling info when logger is provided', () => {
      const urls = [];
      for (let i = 0; i < 10; i += 1) {
        urls.push(`https://example.com/products/shoes/item${i}`);
      }

      const log = {
        info: sinon.stub(),
        debug: sinon.stub(),
      };

      smartSampleUrls(urls, 5, log);

      expect(log.info.calledTwice).to.be.true;
      expect(log.debug.calledOnce).to.be.true;
    });

    it('trims result to maxUrls when proportional sampling exceeds limit', () => {
      // Create many groups with few URLs each
      const urls = [];
      for (let i = 0; i < 50; i += 1) {
        urls.push(`https://example.com/section${i}/page`);
      }

      // With 50 groups and maxUrls=10, perGroup would be ceil(10/50)=1
      // but we'd still get 50 URLs, so it should trim to 10
      const result = smartSampleUrls(urls, 10);

      expect(result).to.have.lengthOf(10);
    });
  });
});
