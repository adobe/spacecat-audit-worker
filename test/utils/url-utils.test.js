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
  it('should return null for empty or invalid input', () => {
    expect(parseCustomUrls(null)).to.be.null;
    expect(parseCustomUrls(undefined)).to.be.null;
    expect(parseCustomUrls('')).to.be.null;
    expect(parseCustomUrls('   ')).to.be.null;
    expect(parseCustomUrls(123)).to.be.null;
    expect(parseCustomUrls([])).to.be.null;
  });

  it('should handle single URL', () => {
    const result = parseCustomUrls('https://example.com/page1');
    expect(result).to.deep.equal(['https://example.com/page1']);
  });

  it('should handle comma-separated URLs', () => {
    const result = parseCustomUrls('https://example.com/page1,https://example.com/page2,https://example.com/page3');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ]);
  });

  it('should trim whitespace from URLs', () => {
    const result = parseCustomUrls(' https://example.com/page1 ,  https://example.com/page2  ');
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should remove duplicates', () => {
    const result = parseCustomUrls('https://example.com/page1,https://example.com/page1,https://example.com/page2');
    expect(result).to.deep.equal(['https://example.com/page1', 'https://example.com/page2']);
  });

  it('should handle empty entries in comma-separated values', () => {
    const result = parseCustomUrls('https://example.com/page1,,https://example.com/page2, ,https://example.com/page3');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ]);
  });

  it('should handle URLs with query parameters', () => {
    const result = parseCustomUrls('https://example.com/page1?param=value,https://example.com/page2?a=1&b=2');
    expect(result).to.deep.equal([
      'https://example.com/page1?param=value',
      'https://example.com/page2?a=1&b=2',
    ]);
  });

  it('should handle URLs with fragments', () => {
    const result = parseCustomUrls('https://example.com/page1#section,https://example.com/page2#top');
    expect(result).to.deep.equal([
      'https://example.com/page1#section',
      'https://example.com/page2#top',
    ]);
  });

  it('should handle mixed URL formats', () => {
    const result = parseCustomUrls('https://example.com/page1,http://other.com/page2,https://third.com/page3');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'http://other.com/page2',
      'https://third.com/page3',
    ]);
  });

  it('should return null for string with only empty values', () => {
    const result = parseCustomUrls(',,, ,  ,');
    expect(result).to.be.null;
  });
});
