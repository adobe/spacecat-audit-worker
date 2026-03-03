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
import { isDynamicPageUrl, filterOutDynamicUrls } from '../../../src/summarization/dynamic-content-filter.js';

describe('summarization dynamic-content-filter', () => {
  describe('isDynamicPageUrl', () => {
    it('returns false for empty or non-string', () => {
      expect(isDynamicPageUrl('')).to.be.false;
      expect(isDynamicPageUrl(null)).to.be.false;
      expect(isDynamicPageUrl(undefined)).to.be.false;
      expect(isDynamicPageUrl(123)).to.be.false;
    });

    it('returns false for static content URLs', () => {
      expect(isDynamicPageUrl('https://example.com/')).to.be.false;
      expect(isDynamicPageUrl('https://example.com/about')).to.be.false;
      expect(isDynamicPageUrl('https://example.com/products/shoes')).to.be.false;
      expect(isDynamicPageUrl('/blog/post-1')).to.be.false;
    });

    it('returns true for URLs with dynamic path segments', () => {
      expect(isDynamicPageUrl('https://example.com/search')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/search?q=foo')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/cart')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/checkout')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/login')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/account')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/admin')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/feed')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/dashboard')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/filter/category')).to.be.true;
      expect(isDynamicPageUrl('/api/users')).to.be.true;
    });

    it('matches segment case-insensitively', () => {
      expect(isDynamicPageUrl('https://example.com/SEARCH')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/Cart')).to.be.true;
    });

    it('matches segment anywhere in path', () => {
      expect(isDynamicPageUrl('https://example.com/shop/cart')).to.be.true;
      expect(isDynamicPageUrl('https://example.com/help/search')).to.be.true;
    });

    it('returns false for invalid URL when used as path', () => {
      expect(isDynamicPageUrl('not-a-url')).to.be.false;
    });

    it('returns false for invalid full URL (URL constructor throws)', () => {
      expect(isDynamicPageUrl('https://')).to.be.false;
      expect(isDynamicPageUrl('http://[')).to.be.false;
    });
  });

  describe('filterOutDynamicUrls', () => {
    it('returns empty array for non-array input', () => {
      expect(filterOutDynamicUrls(null)).to.deep.equal([]);
      expect(filterOutDynamicUrls(undefined)).to.deep.equal([]);
    });

    it('keeps only static URLs and preserves order', () => {
      const urls = [
        'https://example.com/',
        'https://example.com/search',
        'https://example.com/about',
        'https://example.com/cart',
        'https://example.com/products',
      ];
      expect(filterOutDynamicUrls(urls)).to.deep.equal([
        'https://example.com/',
        'https://example.com/about',
        'https://example.com/products',
      ]);
    });

    it('returns all URLs when none are dynamic', () => {
      const urls = ['https://example.com/', 'https://example.com/about', 'https://example.com/contact'];
      expect(filterOutDynamicUrls(urls)).to.deep.equal(urls);
    });

    it('returns empty array when all URLs are dynamic', () => {
      const urls = ['https://example.com/search', 'https://example.com/cart', 'https://example.com/login'];
      expect(filterOutDynamicUrls(urls)).to.deep.equal([]);
    });
  });
});
