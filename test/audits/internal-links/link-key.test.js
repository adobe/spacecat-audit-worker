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

import { expect } from 'chai';
import {
  normalizeComparableUrl,
  getUrlCacheKey,
  buildBrokenLinkKey,
} from '../../../src/internal-links/link-key.js';

describe('link-key utilities', () => {
  describe('normalizeComparableUrl', () => {
    it('returns falsy values as-is', () => {
      expect(normalizeComparableUrl(null)).to.be.null;
      expect(normalizeComparableUrl(undefined)).to.be.undefined;
      expect(normalizeComparableUrl('')).to.equal('');
    });

    it('strips default HTTPS port 443', () => {
      expect(normalizeComparableUrl('https://example.com:443/path'))
        .to.equal('https://example.com/path');
    });

    it('strips default HTTP port 80', () => {
      expect(normalizeComparableUrl('http://example.com:80/path'))
        .to.equal('http://example.com/path');
    });

    it('preserves non-default ports', () => {
      expect(normalizeComparableUrl('https://example.com:8080/path'))
        .to.equal('https://example.com:8080/path');
    });

    it('strips trailing slashes from pathname', () => {
      expect(normalizeComparableUrl('https://example.com/path/'))
        .to.equal('https://example.com/path');
    });

    it('strips hash fragments', () => {
      expect(normalizeComparableUrl('https://example.com/path#section'))
        .to.equal('https://example.com/path');
    });

    it('lowercases hostname', () => {
      expect(normalizeComparableUrl('https://EXAMPLE.COM/Path'))
        .to.equal('https://example.com/Path');
    });

    it('returns unparseable URLs as-is', () => {
      expect(normalizeComparableUrl('not-a-url')).to.equal('not-a-url');
    });
  });

  describe('getUrlCacheKey', () => {
    it('normalizes a URL', () => {
      expect(getUrlCacheKey('https://example.com/path#frag'))
        .to.equal('https://example.com/path');
    });
  });

  describe('buildBrokenLinkKey', () => {
    it('joins urlFrom, urlTo, and itemType', () => {
      const key = buildBrokenLinkKey({
        urlFrom: 'https://example.com/source',
        urlTo: 'https://example.com/target',
        itemType: 'image',
      });
      expect(key).to.equal('https://example.com/source|https://example.com/target|image');
    });

    it('defaults itemType to link', () => {
      const key = buildBrokenLinkKey({
        urlFrom: 'https://example.com/source',
        urlTo: 'https://example.com/target',
      });
      expect(key).to.equal('https://example.com/source|https://example.com/target|link');
    });
  });
});
