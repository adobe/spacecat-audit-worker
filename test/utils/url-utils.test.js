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
import nock from 'nock';
import {
  isPreviewPage,
  getCountryCodeFromLang,
  parseCustomUrls,
  findBestMatchingPath,
  isPdfUrl,
} from '../../src/utils/url-utils.js';
import * as utils from '../../src/utils/url-utils.js';

describe('isPdfUrl', () => {
  it('should return true for URLs ending with .pdf', () => {
    expect(isPdfUrl('https://example.com/document.pdf')).to.be.true;
    expect(isPdfUrl('https://example.com/path/to/file.pdf')).to.be.true;
    expect(isPdfUrl('https://www.bmw.fr/content/dam/bmw/brochure.pdf')).to.be.true;
  });

  it('should return true for URLs with .pdf regardless of case', () => {
    expect(isPdfUrl('https://example.com/document.PDF')).to.be.true;
    expect(isPdfUrl('https://example.com/file.Pdf')).to.be.true;
    expect(isPdfUrl('https://example.com/doc.PdF')).to.be.true;
  });

  it('should return false for non-PDF URLs', () => {
    expect(isPdfUrl('https://example.com/page.html')).to.be.false;
    expect(isPdfUrl('https://example.com/image.jpg')).to.be.false;
    expect(isPdfUrl('https://example.com/document.docx')).to.be.false;
    expect(isPdfUrl('https://example.com/page')).to.be.false;
  });

  it('should return true for URLs with query parameters after .pdf', () => {
    expect(isPdfUrl('https://example.com/doc.pdf?version=1')).to.be.true;
    expect(isPdfUrl('https://example.com/file.pdf#page=2')).to.be.true;
  });

  it('should return false for invalid URLs', () => {
    expect(isPdfUrl('not-a-url')).to.be.false;
    expect(isPdfUrl('')).to.be.false;
    expect(isPdfUrl(null)).to.be.false;
    expect(isPdfUrl(undefined)).to.be.false;
  });

  it('should return false for URLs containing "pdf" but not ending with .pdf', () => {
    expect(isPdfUrl('https://example.com/pdf-documents/page')).to.be.false;
    expect(isPdfUrl('https://example.com/my-pdf-file.html')).to.be.false;
  });
});

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

  it('should remove angle brackets from URLs', () => {
    const result = parseCustomUrls('<https://example.com/page1>,<https://example.com/page2>');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });

  it('should handle mixed URLs with and without angle brackets', () => {
    const result = parseCustomUrls('<https://example.com/page1>,https://example.com/page2,<https://example.com/page3>');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
      'https://example.com/page3',
    ]);
  });

  it('should handle angle brackets with whitespace', () => {
    const result = parseCustomUrls(' < https://example.com/page1 > ,  <https://example.com/page2>  ');
    expect(result).to.deep.equal([
      'https://example.com/page1',
      'https://example.com/page2',
    ]);
  });
});

describe('filterBrokenSuggestedUrls', () => {
  const baseURL = 'https://example.com';

  afterEach(() => {
    nock.cleanAll();
  });

  it('should return only working URLs from the same domain', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
      'https://www.other.com/page3',
    ];

    nock('https://www.example.com')
      .get('/page1').reply(200)
      .get('/page2')
      .reply(200);

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal([
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ]);
  });

  it('should filter out broken URLs', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ];
    nock('https://www.example.com')
      .get('/page1').reply(404)
      .get('/page2')
      .reply(200);

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page2']);
  });

  it('should filter out URLs from different domains', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.other.com/page2',
    ];
    nock('https://www.example.com')
      .get('/page1').reply(200);

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page1']);
  });

  it('should handle fetch errors gracefully', async () => {
    const suggestedUrls = [
      'https://www.example.com/page1',
      'https://www.example.com/page2',
    ];
    nock('https://www.example.com')
      .get('/page1').replyWithError('Network error')
      .get('/page2')
      .reply(200);

    const result = await utils.filterBrokenSuggestedUrls(suggestedUrls, baseURL);
    expect(result).to.deep.equal(['https://www.example.com/page2']);
  });
});

describe('isUnscrapeable', () => {
  it('should return true for PDF files', () => {
    expect(utils.isUnscrapeable('https://example.com/document.pdf')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/document.PDF')).to.be.true;
  });

  it('should return true for Office files', () => {
    expect(utils.isUnscrapeable('https://example.com/data.xls')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/data.xlsx')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/slides.ppt')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/slides.pptx')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/report.doc')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/report.docx')).to.be.true;
  });

  it('should return true for other document types', () => {
    expect(utils.isUnscrapeable('https://example.com/file.rtf')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/file.ps')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/drawing.dwf')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/map.kml')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/map.kmz')).to.be.true;
    expect(utils.isUnscrapeable('https://example.com/animation.swf')).to.be.true;
  });

  it('should return false for HTML pages', () => {
    expect(utils.isUnscrapeable('https://example.com/page.html')).to.be.false;
    expect(utils.isUnscrapeable('https://example.com/page')).to.be.false;
    expect(utils.isUnscrapeable('https://example.com/')).to.be.false;
  });

  it('should handle invalid URLs gracefully', () => {
    expect(utils.isUnscrapeable('not-a-url')).to.be.false;
    expect(utils.isUnscrapeable('')).to.be.false;
  });
});

describe('url-utils.findBestMatchingPath', () => {
  const sectionData = {
    default: {},
    '/en/': {},
    '/en/us/': {},
    '/en/us/products/': {},
  };

  it('returns default when contextPath is falsy or "default"', () => {
    expect(findBestMatchingPath(sectionData, null)).to.equal('default');
    expect(findBestMatchingPath(sectionData, undefined)).to.equal('default');
    expect(findBestMatchingPath(sectionData, 'default')).to.equal('default');
  });

  it('returns the deepest matching path for a given context', () => {
    expect(findBestMatchingPath(sectionData, '/en/us/products/item')).to.equal('/en/us/products/');
    expect(findBestMatchingPath(sectionData, '/en/us/')).to.equal('/en/us/');
    expect(findBestMatchingPath(sectionData, '/en/ca/foo')).to.equal('/en/');
  });

  it('returns default when no match is found', () => {
    expect(findBestMatchingPath(sectionData, '/de/')).to.equal('default');
  });
});

describe('joinBaseAndPath', () => {
  it('should handle dash path by returning base URL with trailing slash', () => {
    expect(utils.joinBaseAndPath('https://example.com', '-')).to.equal('https://example.com/');
    expect(utils.joinBaseAndPath('https://example.com/', '-')).to.equal('https://example.com/');
  });

  it('should join base URL and path correctly', () => {
    expect(utils.joinBaseAndPath('https://example.com', '/page1')).to.equal('https://example.com/page1');
    expect(utils.joinBaseAndPath('https://example.com/', '/page1')).to.equal('https://example.com/page1');
    expect(utils.joinBaseAndPath('https://example.com', 'page1')).to.equal('https://example.com/page1');
    expect(utils.joinBaseAndPath('https://example.com/', 'page1')).to.equal('https://example.com/page1');
  });

  it('should handle various base URL and path combinations', () => {
    expect(utils.joinBaseAndPath('https://example.com', '/products/analytics')).to.equal('https://example.com/products/analytics');
    expect(utils.joinBaseAndPath('https://example.com/', 'products/analytics')).to.equal('https://example.com/products/analytics');
    expect(utils.joinBaseAndPath('https://example.com/base', '/page')).to.equal('https://example.com/base/page');
    expect(utils.joinBaseAndPath('https://example.com/base/', 'page')).to.equal('https://example.com/base/page');
  });
});

describe('stripQueryString', () => {
  it('should remove query string from URL', () => {
    expect(utils.stripQueryString('https://example.com/page?foo=bar'))
      .to.equal('https://example.com/page');
  });

  it('should remove multiple query parameters', () => {
    expect(utils.stripQueryString('https://example.com/page?foo=bar&baz=qux'))
      .to.equal('https://example.com/page');
  });

  it('should handle URLs without query strings', () => {
    expect(utils.stripQueryString('https://example.com/page'))
      .to.equal('https://example.com/page');
  });

  it('should handle root URLs', () => {
    expect(utils.stripQueryString('https://example.com/'))
      .to.equal('https://example.com/');
  });

  it('should return original value for invalid URLs', () => {
    expect(utils.stripQueryString('not-a-url')).to.equal('not-a-url');
    expect(utils.stripQueryString('')).to.equal('');
  });
});

describe('normalizeUrlForComparison', () => {
  it('should lowercase URL', () => {
    expect(utils.normalizeUrlForComparison('HTTPS://EXAMPLE.COM/Page'))
      .to.equal('https://example.com/page');
  });

  it('should strip trailing slashes', () => {
    expect(utils.normalizeUrlForComparison('https://example.com/page/'))
      .to.equal('https://example.com/page');
  });

  it('should strip multiple trailing slashes', () => {
    expect(utils.normalizeUrlForComparison('https://example.com/page///'))
      .to.equal('https://example.com/page');
  });

  it('should handle undefined', () => {
    expect(utils.normalizeUrlForComparison(undefined)).to.be.undefined;
  });

  it('should handle null', () => {
    expect(utils.normalizeUrlForComparison(null)).to.be.undefined;
  });

  it('should return original value when toLowerCase throws', () => {
    const badUrl = {
      toLowerCase: () => { throw new Error('Cannot lowercase'); },
    };
    expect(utils.normalizeUrlForComparison(badUrl)).to.equal(badUrl);
  });
});

describe('urlsMatch', () => {
  it('should match identical URLs', () => {
    expect(utils.urlsMatch(
      'https://example.com/page',
      'https://example.com/page',
    )).to.be.true;
  });

  it('should match URLs with different cases', () => {
    expect(utils.urlsMatch(
      'https://example.com/Page',
      'https://example.com/page',
    )).to.be.true;
  });

  it('should match URLs with/without trailing slash', () => {
    expect(utils.urlsMatch(
      'https://example.com/page/',
      'https://example.com/page',
    )).to.be.true;
  });

  it('should match URLs ignoring query strings', () => {
    expect(utils.urlsMatch(
      'https://example.com/page?foo=bar',
      'https://example.com/page',
    )).to.be.true;
  });

  it('should match URLs with different query strings', () => {
    expect(utils.urlsMatch(
      'https://example.com/page?foo=bar',
      'https://example.com/page?baz=qux',
    )).to.be.true;
  });

  it('should not match different URLs', () => {
    expect(utils.urlsMatch(
      'https://example.com/page1',
      'https://example.com/page2',
    )).to.be.false;
  });

  it('should not match URLs with different hosts', () => {
    expect(utils.urlsMatch(
      'https://example.com/page',
      'https://other.com/page',
    )).to.be.false;
  });
});
