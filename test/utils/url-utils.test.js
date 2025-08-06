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
import { isPreviewPage, getCountryCodeFromLang, parseCustomUrls } from '../../src/utils/url-utils.js';

describe('isPreviewPage', () => {
  it('should return true for preview pages', () => {
    const url = 'https://www.example.page/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.true;
  });

  it('should return false for non-preview pages', () => {
    const url = 'https://www.example.com/test1';
    const result = isPreviewPage(url);
    expect(result).to.be.false;
  });
  it('should return the country code from a language code', () => {
    expect(getCountryCodeFromLang('en-US')).to.equal('us');
    expect(getCountryCodeFromLang('fr_CA')).to.equal('ca');
  });

  it('should return the default country code if the language code is not in the format of "language-country" or "language_country"', () => {
    expect(getCountryCodeFromLang('en')).to.equal('us');
    expect(getCountryCodeFromLang('en', 'fr')).to.equal('fr');
  });
  it('should return the default country if the language code is not present', () => {
    expect(getCountryCodeFromLang(null)).to.equal('us');
    expect(getCountryCodeFromLang(undefined)).to.equal('us');
  });
});

describe('parseCustomUrls Function', () => {
  const domain = 'https://example.com';

  it('should return null for empty or invalid input', () => {
    expect(parseCustomUrls(null, domain)).to.be.null;
    expect(parseCustomUrls(undefined, domain)).to.be.null;
    expect(parseCustomUrls([], domain)).to.be.null;
    expect(parseCustomUrls([''], domain)).to.be.null;
    expect(parseCustomUrls(['   '], domain)).to.be.null;
    expect(parseCustomUrls(['', '  ', ''], domain)).to.be.null;
  });

  it('should handle single relative URL', () => {
    const result = parseCustomUrls(['/page1'], domain);
    expect(result).to.deep.equal(['https://example.com/page1']);
  });

  it('should handle multiple relative URLs', () => {
    const result = parseCustomUrls(['/page1', '/page2'], domain);
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should handle comma-separated URLs', () => {
    const result = parseCustomUrls(['/page1,/page2,/page3'], domain);
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ]);
  });

  it('should handle mixed relative and full URLs', () => {
    const result = parseCustomUrls(['/page1', 'https://example.com/page2'], domain);
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should handle URLs without leading slash', () => {
    const result = parseCustomUrls(['page1', 'page2'], domain);
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should remove duplicates', () => {
    const result = parseCustomUrls(['/page1', '/page1', '/page2'], domain);
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should remove duplicates after normalization', () => {
    const result = parseCustomUrls(['/page1', 'page1', 'https://example.com/page1'], domain);
    expect(result).to.deep.equal(['https://example.com/page1']);
  });

  it('should trim whitespace', () => {
    const result = parseCustomUrls([' /page1 ', '  /page2  '], domain);
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should handle domain with trailing slash', () => {
    const result = parseCustomUrls(['/page1'], 'https://example.com/');
    expect(result).to.deep.equal(['https://example.com/page1']);
  });

  it('should preserve full URLs from different domains', () => {
    const result = parseCustomUrls(['https://other.com/page1', '/page2'], domain);
    expect(result).to.deep.equal(['https://other.com/page1', 'https://example.com/page2']);
  });

  it('should handle HTTP URLs', () => {
    const result = parseCustomUrls(['http://other.com/page1', '/page2'], domain);
    expect(result).to.deep.equal(['http://other.com/page1', 'https://example.com/page2']);
  });

  it('should handle complex paths', () => {
    const result = parseCustomUrls(['/products/category/item', '/blog/2024/article'], domain);
    expect(result).to.deep.equal([
      'https://example.com/products/category/item',
      'https://example.com/blog/2024/article',
    ]);
  });

  it('should return relative URLs unchanged when no domain provided', () => {
    const result = parseCustomUrls(['/page1', '/page2'], null);
    expect(result).to.deep.equal(['/page1', '/page2']);
  });

  it('should handle empty entries in comma-separated values', () => {
    const result = parseCustomUrls(['/page1,,/page2, ,/page3'], domain);
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ]);
  });

  it('should handle mixed comma-separated and array entries', () => {
    const result = parseCustomUrls(['/page1,/page2', '/page3', 'page4,page5'], domain);
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
      'https://example.com/page4',
      'https://example.com/page5',
    ]);
  });

  it('should handle URLs with query parameters', () => {
    const result = parseCustomUrls(['/page1?param=value', '/page2?a=1&b=2'], domain);
    expect(result).to.deep.equal([
      'https://example.com/page1?param=value',
      'https://example.com/page2?a=1&b=2',
    ]);
  });

  it('should handle URLs with fragments', () => {
    const result = parseCustomUrls(['/page1#section', '/page2#top'], domain);
    expect(result).to.deep.equal([
      'https://example.com/page1#section',
      'https://example.com/page2#top',
    ]);
  });

  it('should handle not-a-string input that passes array check', () => {
    const result = parseCustomUrls('not-an-array', domain);
    expect(result).to.be.null;
  });
});
