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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('BrightDataClient', () => {
  let BrightDataClient;
  let isValidLocale;
  let extractLocaleFromUrl;
  let buildLocaleSearchUrl;
  let localesMatch;
  let client;
  let logMock;
  let fetchStub;

  beforeEach(async () => {
    logMock = {
      info: sinon.spy(),
      error: sinon.spy(),
      debug: sinon.spy(),
      warn: sinon.spy(),
    };

    fetchStub = sinon.stub();

    // Mock the module with esmock to intercept tracingFetch
    const BrightDataModule = await esmock('../../src/support/bright-data-client.js', {
      '@adobe/spacecat-shared-utils': {
        hasText: (str) => typeof str === 'string' && str.trim().length > 0,
        tracingFetch: fetchStub,
        prependSchema: (url) => (url?.startsWith('http') ? url : `https://${url}`),
      },
    });
    BrightDataClient = BrightDataModule.default;
    ({
      isValidLocale, extractLocaleFromUrl, buildLocaleSearchUrl, localesMatch,
    } = BrightDataModule);

    // Use the mocked BrightDataClient for client instance
    client = new BrightDataClient('test-api-key', 'test-zone', logMock);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('createFrom', () => {
    it('creates client with valid credentials', () => {
      const context = {
        env: {
          BRIGHT_DATA_API_KEY: 'api-key-123',
          BRIGHT_DATA_ZONE: 'zone-abc',
        },
        log: logMock,
      };
      const newClient = BrightDataClient.createFrom(context);
      expect(newClient).to.be.instanceOf(BrightDataClient);
    });

    it('throws error when API key is missing', () => {
      const context = {
        env: { BRIGHT_DATA_ZONE: 'zone-abc' },
        log: logMock,
      };
      expect(() => BrightDataClient.createFrom(context))
        .to.throw('BRIGHT_DATA_API_KEY is not configured');
    });

    it('throws error when zone is missing', () => {
      const context = {
        env: { BRIGHT_DATA_API_KEY: 'api-key-123' },
        log: logMock,
      };
      expect(() => BrightDataClient.createFrom(context))
        .to.throw('BRIGHT_DATA_ZONE is not configured');
    });
  });

  describe('extractLocale', () => {
    it('extracts xx_yy locale from path', () => {
      expect(client.extractLocale('https://example.com/en_us/products')).to.equal('en_us');
      expect(client.extractLocale('https://example.com/de_ch/about')).to.equal('de_ch');
      expect(client.extractLocale('https://example.com/fr_ca/')).to.equal('fr_ca');
    });

    it('extracts xx-yy dash-separated locale from path (preserves dash)', () => {
      expect(client.extractLocale('https://example.com/ko-kr/products')).to.equal('ko-kr');
      expect(client.extractLocale('https://example.com/pt-br/about')).to.equal('pt-br');
      expect(client.extractLocale('https://example.com/en-us/page')).to.equal('en-us');
      expect(client.extractLocale('https://example.com/zh-tw/')).to.equal('zh-tw');
    });

    it('extracts 2-letter locale from path when in whitelist', () => {
      expect(client.extractLocale('https://example.com/it/products')).to.equal('it');
      expect(client.extractLocale('https://example.com/de/about')).to.equal('de');
      expect(client.extractLocale('https://example.com/nl/')).to.equal('nl');
      expect(client.extractLocale('https://example.com/ja/docs')).to.equal('ja');
    });

    it('extracts country codes from LOCALE_ALLOWLIST (dk, uk, at, etc.)', () => {
      expect(client.extractLocale('https://example.com/dk/products')).to.equal('dk');
      expect(client.extractLocale('https://example.com/uk/about')).to.equal('uk');
      expect(client.extractLocale('https://example.com/at/page')).to.equal('at');
      expect(client.extractLocale('https://example.com/ch/docs')).to.equal('ch');
    });

    it('extracts regional codes (apac, emea, eu, etc.)', () => {
      expect(client.extractLocale('https://example.com/eu/products')).to.equal('eu');
      expect(client.extractLocale('https://example.com/apac/about')).to.equal('apac');
      expect(client.extractLocale('https://example.com/emea/page')).to.equal('emea');
    });

    it('returns null for codes not in any locale list', () => {
      expect(client.extractLocale('https://example.com/xy/products')).to.be.null;
      expect(client.extractLocale('https://example.com/zz/about')).to.be.null;
      expect(client.extractLocale('https://example.com/blog/article')).to.be.null;
    });

    it('returns null for xx_yy when language not in whitelist', () => {
      expect(client.extractLocale('https://example.com/xy_zz/products')).to.be.null;
    });

    it('returns null when no locale in path', () => {
      expect(client.extractLocale('https://example.com/products/item')).to.be.null;
      expect(client.extractLocale('https://example.com/')).to.be.null;
    });

    it('handles invalid URLs gracefully', () => {
      expect(client.extractLocale('not-a-url')).to.be.null;
      expect(logMock.error).to.have.been.called;
    });
  });

  describe('extractLocaleFromBaseUrl', () => {
    it('extracts locale from base URL with locale path', () => {
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/it')).to.equal('it');
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/en_us/')).to.equal('en_us');
    });

    it('extracts dash-separated locale from base URL (preserves dash)', () => {
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/ko-kr')).to.equal('ko-kr');
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/pt-br/')).to.equal('pt-br');
    });

    it('extracts country and regional codes from base URL', () => {
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/dk')).to.equal('dk');
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/uk')).to.equal('uk');
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/eu/')).to.equal('eu');
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/apac')).to.equal('apac');
    });

    it('returns null for base URL without locale', () => {
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com')).to.be.null;
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/')).to.be.null;
    });

    it('returns null for invalid codes', () => {
      expect(client.extractLocaleFromBaseUrl('https://www.bulk.com/xy')).to.be.null;
    });

    it('handles invalid URLs gracefully', () => {
      expect(client.extractLocaleFromBaseUrl('not-a-url')).to.be.null;
    });
  });

  describe('extractKeywordTokens', () => {
    it('extracts tokens from URL path', () => {
      const tokens = client.extractKeywordTokens('https://example.com/products/great-product-name');
      expect(tokens).to.deep.equal(['products', 'great', 'product', 'name']);
    });

    it('strips file extensions', () => {
      const tokens = client.extractKeywordTokens('https://example.com/page.html');
      expect(tokens).to.deep.equal(['page']);
    });

    it('strips locale prefix from path', () => {
      const tokens = client.extractKeywordTokens('https://example.com/it/products/item');
      expect(tokens).to.deep.equal(['products', 'item']);
    });

    it('strips provided locale from path', () => {
      const tokens = client.extractKeywordTokens('https://example.com/en_us/products/item', { locale: 'en_us' });
      expect(tokens).to.deep.equal(['products', 'item']);
    });

    it('removes date patterns', () => {
      const tokens = client.extractKeywordTokens('https://example.com/blog/2023/05/article-title');
      expect(tokens).to.deep.equal(['blog', 'article', 'title']);
    });

    it('filters out short and numeric tokens', () => {
      const tokens = client.extractKeywordTokens('https://example.com/a/123/product');
      expect(tokens).to.deep.equal(['product']);
    });

    it('handles empty path', () => {
      const tokens = client.extractKeywordTokens('https://example.com/');
      expect(tokens).to.deep.equal([]);
    });

    it('strips common prefixes when option enabled', () => {
      const tokens = client.extractKeywordTokens('https://example.com/blog/article-title', { stripCommonPrefixes: true });
      expect(tokens).to.deep.equal(['article', 'title']);
    });

    it('handles invalid URLs gracefully', () => {
      const tokens = client.extractKeywordTokens('not-a-url');
      expect(tokens).to.deep.equal([]);
      expect(logMock.error).to.have.been.called;
    });

    it('decodes URL-encoded characters', () => {
      const tokens = client.extractKeywordTokens('https://example.com/product%20name');
      expect(tokens).to.include('product');
      expect(tokens).to.include('name');
    });

    it('handles malformed URL encoding gracefully', () => {
      // %E2%80 is incomplete/malformed UTF-8 sequence
      const tokens = client.extractKeywordTokens('https://example.com/product%E2%80/item');
      expect(tokens).to.include('item');
    });

    it('strips unknown xx_yy patterns when no locale provided', () => {
      const tokens = client.extractKeywordTokens('https://example.com/xy_zz/products/item');
      expect(tokens).to.deep.equal(['products', 'item']);
    });
  });

  describe('extractKeywords', () => {
    it('extracts and logs keywords', () => {
      const keywords = client.extractKeywords('https://example.com/products/great-item');
      expect(keywords).to.equal('products great item');
      expect(logMock.debug).to.have.been.called;
    });

    it('respects maxTokens option', () => {
      const keywords = client.extractKeywords('https://example.com/a/b/c/d/e/products', { maxTokens: 2 });
      expect(keywords.split(' ').length).to.be.at.most(2);
    });

    it('respects maxChars option', () => {
      const keywords = client.extractKeywords('https://example.com/very-long-product-name-here', { maxChars: 20 });
      expect(keywords.length).to.be.at.most(20);
    });
  });

  describe('stripFileExtension', () => {
    it('strips known extensions', () => {
      expect(client.stripFileExtension('page.html')).to.equal('page');
      expect(client.stripFileExtension('doc.pdf')).to.equal('doc');
      expect(client.stripFileExtension('image.jpg')).to.equal('image');
      expect(client.stripFileExtension('file.json')).to.equal('file');
    });

    it('preserves unknown extensions', () => {
      expect(client.stripFileExtension('file.xyz')).to.equal('file.xyz');
    });

    it('preserves segments without extensions', () => {
      expect(client.stripFileExtension('product-name')).to.equal('product-name');
    });
  });

  describe('isUsefulToken', () => {
    it('returns true for valid tokens', () => {
      expect(client.isUsefulToken('product')).to.be.true;
      expect(client.isUsefulToken('ab')).to.be.true;
      expect(client.isUsefulToken('test123')).to.be.true;
    });

    it('returns false for short tokens', () => {
      expect(client.isUsefulToken('a')).to.be.false;
    });

    it('returns false for numeric tokens', () => {
      expect(client.isUsefulToken('123')).to.be.false;
      expect(client.isUsefulToken('456789')).to.be.false;
    });

    it('returns false for non-letter tokens', () => {
      expect(client.isUsefulToken('---')).to.be.false;
      expect(client.isUsefulToken('123---')).to.be.false;
    });

    it('returns false for empty/null tokens', () => {
      expect(client.isUsefulToken('')).to.be.false;
      expect(client.isUsefulToken(null)).to.be.false;
      expect(client.isUsefulToken(undefined)).to.be.false;
    });
  });

  describe('trimTokensByCharLimit', () => {
    it('trims tokens from end by default', () => {
      const tokens = ['one', 'two', 'three', 'four'];
      const result = client.trimTokensByCharLimit(tokens, 10);
      expect(result.join(' ').length).to.be.at.most(10);
    });

    it('trims tokens from start when fromStart is true', () => {
      const tokens = ['one', 'two', 'three', 'four'];
      const result = client.trimTokensByCharLimit(tokens, 10, { fromStart: true });
      expect(result.join(' ').length).to.be.at.most(10);
      expect(result[0]).to.equal('one');
    });

    it('returns all tokens when under limit', () => {
      const tokens = ['a', 'b'];
      const result = client.trimTokensByCharLimit(tokens, 100);
      expect(result).to.deep.equal(tokens);
    });

    it('returns all tokens when no limit', () => {
      const tokens = ['one', 'two'];
      expect(client.trimTokensByCharLimit(tokens, 0)).to.deep.equal(tokens);
      expect(client.trimTokensByCharLimit(tokens, null)).to.deep.equal(tokens);
    });
  });

  describe('buildKeywordsFromTokens', () => {
    it('joins tokens with spaces', () => {
      expect(client.buildKeywordsFromTokens(['a', 'b', 'c'])).to.equal('a b c');
    });

    it('limits tokens from end by default', () => {
      const tokens = ['one', 'two', 'three', 'four', 'five'];
      expect(client.buildKeywordsFromTokens(tokens, { maxTokens: 3 })).to.equal('three four five');
    });

    it('limits tokens from start when fromStart is true', () => {
      const tokens = ['one', 'two', 'three', 'four', 'five'];
      expect(client.buildKeywordsFromTokens(tokens, { maxTokens: 3, fromStart: true })).to.equal('one two three');
    });

    it('respects character limit', () => {
      const tokens = ['products', 'electrolyte', 'sachets', 'blackcurrant'];
      const result = client.buildKeywordsFromTokens(tokens, { maxChars: 20 });
      expect(result.length).to.be.at.most(20);
    });

    it('handles empty tokens', () => {
      expect(client.buildKeywordsFromTokens([])).to.equal('');
    });
  });

  describe('buildSiteScope', () => {
    it('builds scope without locale', () => {
      expect(client.buildSiteScope('example.com')).to.equal('site:example.com');
    });

    it('builds scope with locale path', () => {
      expect(client.buildSiteScope('example.com', 'it')).to.equal('site:example.com/it');
      expect(client.buildSiteScope('example.com', 'en_us')).to.equal('site:example.com/en_us');
    });
  });

  describe('buildSearchQuery', () => {
    it('builds query with scope and keywords', () => {
      const query = client.buildSearchQuery('site:example.com', 'product name');
      expect(query).to.equal('site:example.com product name');
    });

    it('builds query with just scope when no keywords', () => {
      const query = client.buildSearchQuery('site:example.com', '');
      expect(query).to.equal('site:example.com');
      expect(logMock.debug).to.have.been.called;
    });

    it('builds query with null keywords', () => {
      const query = client.buildSearchQuery('site:example.com', null);
      expect(query).to.equal('site:example.com');
    });
  });

  describe('isValidLocale', () => {
    it('returns true for valid ISO 639-1 language codes', () => {
      expect(isValidLocale('en')).to.be.true;
      expect(isValidLocale('de')).to.be.true;
      expect(isValidLocale('fr')).to.be.true;
      expect(isValidLocale('da')).to.be.true;
      expect(isValidLocale('ja')).to.be.true;
    });

    it('returns true for valid ISO 3166-1 country codes', () => {
      expect(isValidLocale('dk')).to.be.true;
      expect(isValidLocale('at')).to.be.true;
      expect(isValidLocale('ch')).to.be.true;
      expect(isValidLocale('us')).to.be.true;
      expect(isValidLocale('gb')).to.be.true;
    });

    it('returns true for common regional codes', () => {
      expect(isValidLocale('eu')).to.be.true;
      expect(isValidLocale('apac')).to.be.true;
      expect(isValidLocale('emea')).to.be.true;
    });

    it('is case-insensitive', () => {
      expect(isValidLocale('DK')).to.be.true;
      expect(isValidLocale('Fr')).to.be.true;
      expect(isValidLocale('EU')).to.be.true;
    });

    it('returns false for invalid or non-locale segments', () => {
      expect(isValidLocale('blog')).to.be.false;
      expect(isValidLocale('products')).to.be.false;
      expect(isValidLocale('api')).to.be.false;
      expect(isValidLocale('xyz')).to.be.false;
      expect(isValidLocale('123')).to.be.false;
    });

    it('returns false for null, undefined, empty string, and non-strings', () => {
      expect(isValidLocale(null)).to.be.false;
      expect(isValidLocale(undefined)).to.be.false;
      expect(isValidLocale('')).to.be.false;
      expect(isValidLocale(123)).to.be.false;
      expect(isValidLocale({})).to.be.false;
    });

    it('returns true for composite locales with dash', () => {
      expect(isValidLocale('ko-kr')).to.be.true;
      expect(isValidLocale('en-us')).to.be.true;
      expect(isValidLocale('pt-br')).to.be.true;
      expect(isValidLocale('zh-tw')).to.be.true;
    });

    it('returns true for composite locales with underscore', () => {
      expect(isValidLocale('ko_kr')).to.be.true;
      expect(isValidLocale('en_us')).to.be.true;
      expect(isValidLocale('pt_br')).to.be.true;
    });

    it('is case-insensitive for composite locales', () => {
      expect(isValidLocale('KO-KR')).to.be.true;
      expect(isValidLocale('En-Us')).to.be.true;
      expect(isValidLocale('PT_BR')).to.be.true;
    });

    it('returns false for composite locales with invalid parts', () => {
      expect(isValidLocale('xx-yy')).to.be.false;
      expect(isValidLocale('en-xyz')).to.be.false;
      expect(isValidLocale('foo-bar')).to.be.false;
    });
  });

  describe('extractLocaleFromUrl', () => {
    it('extracts simple locale from URL path', () => {
      expect(extractLocaleFromUrl('https://example.com/dk/page')).to.equal('dk');
      expect(extractLocaleFromUrl('https://example.com/en/blog')).to.equal('en');
      expect(extractLocaleFromUrl('https://example.com/fr/')).to.equal('fr');
    });

    it('extracts composite locale from URL path', () => {
      expect(extractLocaleFromUrl('https://example.com/ko-kr/blog')).to.equal('ko-kr');
      expect(extractLocaleFromUrl('https://example.com/en_us/products')).to.equal('en_us');
      expect(extractLocaleFromUrl('https://example.com/pt-br/page')).to.equal('pt-br');
    });

    it('returns null when first segment is not a locale', () => {
      expect(extractLocaleFromUrl('https://example.com/blog/page')).to.be.null;
      expect(extractLocaleFromUrl('https://example.com/products/item')).to.be.null;
      expect(extractLocaleFromUrl('https://example.com/api/v2')).to.be.null;
    });

    it('returns null for root URLs', () => {
      expect(extractLocaleFromUrl('https://example.com')).to.be.null;
      expect(extractLocaleFromUrl('https://example.com/')).to.be.null;
    });

    it('returns null for invalid inputs', () => {
      expect(extractLocaleFromUrl(null)).to.be.null;
      expect(extractLocaleFromUrl(undefined)).to.be.null;
      expect(extractLocaleFromUrl('')).to.be.null;
      expect(extractLocaleFromUrl(123)).to.be.null;
    });

    it('returns null for URLs with empty path segments', () => {
      expect(extractLocaleFromUrl('https://example.com//')).to.be.null;
    });

    it('returns null for malformed URLs that throw in URL constructor', () => {
      expect(extractLocaleFromUrl('http://[')).to.be.null;
    });

    it('handles URLs without scheme', () => {
      expect(extractLocaleFromUrl('example.com/dk/page')).to.equal('dk');
      expect(extractLocaleFromUrl('example.com/blog/page')).to.be.null;
    });
  });

  describe('buildLocaleSearchUrl', () => {
    it('appends locale from broken link when base URL has no subpath', () => {
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/dk/broken-page'))
        .to.equal('https://example.com/dk');
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/fr/page'))
        .to.equal('https://example.com/fr');
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/ko-kr/page'))
        .to.equal('https://example.com/ko-kr');
    });

    it('returns base URL unchanged when base already has a subpath', () => {
      expect(buildLocaleSearchUrl('https://example.com/uk', 'https://example.com/uk/broken'))
        .to.equal('https://example.com/uk');
      expect(buildLocaleSearchUrl('https://example.com/uk', 'https://example.com/fr/broken'))
        .to.equal('https://example.com/uk');
    });

    it('returns base URL unchanged when broken link has no valid locale', () => {
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/blog/page'))
        .to.equal('https://example.com');
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/products/item'))
        .to.equal('https://example.com');
    });

    it('returns base URL unchanged when broken link is root', () => {
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com'))
        .to.equal('https://example.com');
      expect(buildLocaleSearchUrl('https://example.com', 'https://example.com/'))
        .to.equal('https://example.com');
    });

    it('prepends schema to base URL without schema', () => {
      expect(buildLocaleSearchUrl('example.com', 'https://example.com/dk/page'))
        .to.equal('https://example.com/dk');
    });
  });

  describe('localesMatch', () => {
    it('returns true when both locales are the same', () => {
      expect(localesMatch('en', 'en')).to.be.true;
      expect(localesMatch('ko-kr', 'ko-kr')).to.be.true;
      expect(localesMatch('dk', 'dk')).to.be.true;
    });

    it('returns true when both locales are null/undefined (no locale)', () => {
      expect(localesMatch(null, null)).to.be.true;
      expect(localesMatch(undefined, undefined)).to.be.true;
      expect(localesMatch(null, undefined)).to.be.true;
    });

    it('returns false when one has locale and the other does not', () => {
      expect(localesMatch('en', null)).to.be.false;
      expect(localesMatch(null, 'en')).to.be.false;
      expect(localesMatch('ko-kr', undefined)).to.be.false;
    });

    it('returns false when locales differ', () => {
      expect(localesMatch('en', 'fr')).to.be.false;
      expect(localesMatch('ko-kr', 'en')).to.be.false;
      expect(localesMatch('dk', 'de')).to.be.false;
    });

    it('is case-insensitive', () => {
      expect(localesMatch('EN', 'en')).to.be.true;
      expect(localesMatch('Ko-KR', 'ko-kr')).to.be.true;
    });
  });

  describe('resolveGoogleLocaleParams', () => {
    it('returns null hl/gl when no locale', () => {
      expect(client.resolveGoogleLocaleParams(null)).to.deep.equal({ hl: null, gl: null });
      expect(client.resolveGoogleLocaleParams(undefined)).to.deep.equal({ hl: null, gl: null });
    });

    it('maps xx_yy locale to hl/gl', () => {
      expect(client.resolveGoogleLocaleParams('en_us')).to.deep.equal({ hl: 'en', gl: 'US' });
      expect(client.resolveGoogleLocaleParams('de_ch')).to.deep.equal({ hl: 'de', gl: 'CH' });
      expect(client.resolveGoogleLocaleParams('fr_ca')).to.deep.equal({ hl: 'fr', gl: 'CA' });
    });

    it('maps xx-yy dash-separated locale to hl/gl', () => {
      expect(client.resolveGoogleLocaleParams('ko-kr')).to.deep.equal({ hl: 'ko', gl: 'KR' });
      expect(client.resolveGoogleLocaleParams('pt-br')).to.deep.equal({ hl: 'pt', gl: 'BR' });
      expect(client.resolveGoogleLocaleParams('en-us')).to.deep.equal({ hl: 'en', gl: 'US' });
    });

    it('maps 2-letter locale to hl and default gl', () => {
      expect(client.resolveGoogleLocaleParams('it')).to.deep.equal({ hl: 'it', gl: 'IT' });
      expect(client.resolveGoogleLocaleParams('de')).to.deep.equal({ hl: 'de', gl: 'DE' });
      expect(client.resolveGoogleLocaleParams('ja')).to.deep.equal({ hl: 'ja', gl: 'JP' });
    });

    it('returns null for invalid locale formats', () => {
      expect(client.resolveGoogleLocaleParams('xyz')).to.deep.equal({ hl: null, gl: null });
      expect(client.resolveGoogleLocaleParams('xy_zz')).to.deep.equal({ hl: null, gl: null });
      expect(client.resolveGoogleLocaleParams('toolong')).to.deep.equal({ hl: null, gl: null });
    });
  });

  describe('googleSearchByQuery', () => {
    let mockedClient;

    beforeEach(() => {
      // Use esmocked client for tests that need mocked fetch
      const MockedClientClass = BrightDataClient.default;
      mockedClient = new MockedClientClass('test-api-key', 'test-zone', logMock);
    });

    it('makes API request and returns results', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [
            { link: 'https://example.com/page1', title: 'Page 1' },
            { link: 'https://example.com/page2', title: 'Page 2' },
          ],
        }),
      });

      const results = await mockedClient.googleSearchByQuery('site:example.com test', 2);
      expect(results).to.have.lengthOf(2);
      expect(results[0].link).to.equal('https://example.com/page1');
      expect(fetchStub).to.have.been.calledOnce;
    });

    it('returns empty array on API error', async () => {
      fetchStub.resolves({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const results = await mockedClient.googleSearchByQuery('site:example.com test', 1);
      expect(results).to.deep.equal([]);
      expect(logMock.error).to.have.been.called;
    });

    it('returns empty array on network error', async () => {
      fetchStub.rejects(new Error('Network error'));

      const results = await mockedClient.googleSearchByQuery('site:example.com test', 1);
      expect(results).to.deep.equal([]);
      expect(logMock.error).to.have.been.called;
    });

    it('sets hl/gl params when locale provided', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({ organic: [] }),
      });

      await mockedClient.googleSearchByQuery('site:example.com test', 1, 'it');

      const callArgs = fetchStub.firstCall.args;
      const body = JSON.parse(callArgs[1].body);
      expect(body.url).to.include('hl=it');
      expect(body.url).to.include('gl=IT');
    });

    it('omits hl/gl params when no locale', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({ organic: [] }),
      });

      await mockedClient.googleSearchByQuery('site:example.com test', 1, null);

      const callArgs = fetchStub.firstCall.args;
      const body = JSON.parse(callArgs[1].body);
      expect(body.url).to.not.include('hl=');
      expect(body.url).to.not.include('gl=');
    });

    it('limits results to numResults', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [
            { link: 'https://example.com/1' },
            { link: 'https://example.com/2' },
            { link: 'https://example.com/3' },
          ],
        }),
      });

      const results = await mockedClient.googleSearchByQuery('site:example.com', 2);
      expect(results).to.have.lengthOf(2);
    });

    it('handles empty organic results', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({}),
      });

      const results = await mockedClient.googleSearchByQuery('site:example.com', 1);
      expect(results).to.deep.equal([]);
    });
  });

  describe('googleSearchWithFallback', () => {
    let mockedClient;

    beforeEach(() => {
      // Use esmocked client for tests that need mocked fetch
      const MockedClientClass = BrightDataClient.default;
      mockedClient = new MockedClientClass('test-api-key', 'test-zone', logMock);
    });

    it('returns results on first attempt if found', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/result', title: 'Result' }],
        }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/item.html',
        1,
      );

      expect(result.results).to.have.lengthOf(1);
      expect(result.results[0].link).to.equal('https://example.com/result');
      expect(result.locale).to.equal('it');
      expect(result.usedLocale).to.be.true;
    });

    it('tries fallback queries when first attempt returns no results (with feature flag enabled)', async () => {
      // Enable locale fallback feature flag
      const clientWithFallback = new BrightDataClient(
        'test-api-key',
        'test-zone',
        logMock,
        { BRIGHT_DATA_LOCALE_FALLBACK_ENABLED: 'true' },
      );

      let callCount = 0;
      fetchStub.callsFake(async () => {
        callCount += 1;
        if (callCount === 1) {
          return { ok: true, json: async () => ({ organic: [] }) };
        }
        return {
          ok: true,
          json: async () => ({ organic: [{ link: 'https://example.com/fallback' }] }),
        };
      });

      const result = await clientWithFallback.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/item',
        1,
      );

      expect(callCount).to.be.greaterThan(1);
      expect(result.results).to.have.lengthOf(1);
    });

    it('does NOT fall back to non-locale search by default (locale isolation)', async () => {
      // Default behavior: no fallback (BRIGHT_DATA_LOCALE_FALLBACK_ENABLED=false/undefined)
      let callCount = 0;
      fetchStub.callsFake(async () => {
        callCount += 1;
        // Always return empty results to test fallback is NOT attempted
        return { ok: true, json: async () => ({ organic: [] }) };
      });

      const result = await client.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/item', // Has locale
        1,
      );

      // Should only make calls for locale-scoped search + keyword fallbacks (not non-locale scope)
      // With locale 'it', it should try: site:example.com/it with various keyword combinations
      // But should NOT try site:example.com (non-locale)
      expect(callCount).to.be.lessThan(10); // Reasonable upper bound for keyword variations
      expect(result.results).to.have.lengthOf(0); // All attempts returned empty
    });

    it('returns empty results when all fallbacks fail', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({ organic: [] }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/item',
        1,
      );

      expect(result.results).to.deep.equal([]);
      expect(result.usedLocale).to.be.false;
    });

    it('handles URL without locale', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/result' }],
        }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/products/item',
        1,
      );

      expect(result.results).to.have.lengthOf(1);
      expect(result.locale).to.be.null;
      expect(result.usedLocale).to.be.false;
    });

    it('uses locale from base URL if present', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/it/result' }],
        }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com/it',
        'https://example.com/it/products/item',
        1,
      );

      expect(result.results).to.have.lengthOf(1);
      expect(result.locale).to.equal('it');
    });

    it('builds correct keyword variants for long URLs', async () => {
      const capturedQueries = [];
      fetchStub.callsFake(async (url, options) => {
        const body = JSON.parse(options.body);
        capturedQueries.push(body.url);
        return { ok: true, json: async () => ({ organic: [] }) };
      });

      await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/electrolyte/sachets/blackcurrant/single',
        1,
      );

      // Should have tried multiple keyword variants
      expect(capturedQueries.length).to.be.greaterThan(1);
    });

    it('passes stripCommonPrefixes option', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/result' }],
        }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/blog/article-title',
        1,
        { stripCommonPrefixes: true },
      );

      expect(result.results).to.have.lengthOf(1);
    });

    it('handles invalid maxTokens option gracefully', async () => {
      const capturedQueries = [];
      fetchStub.callsFake(async (url, options) => {
        const body = JSON.parse(options.body);
        capturedQueries.push(body.url);
        return { ok: true, json: async () => ({ organic: [] }) };
      });

      // Pass maxTokens as null to trigger the fallback to tokens.length
      await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/products/category/item',
        1,
        { maxTokens: null },
      );

      // Should still attempt searches using tokens.length as fallback
      expect(capturedQueries.length).to.be.greaterThan(0);
    });

    it('handles zero maxTokens option gracefully', async () => {
      const capturedQueries = [];
      fetchStub.callsFake(async (url, options) => {
        const body = JSON.parse(options.body);
        capturedQueries.push(body.url);
        return { ok: true, json: async () => ({ organic: [] }) };
      });

      // Pass maxTokens as 0 to trigger the fallback to tokens.length
      await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/products/category/item',
        1,
        { maxTokens: 0 },
      );

      // Should still attempt searches using tokens.length as fallback
      expect(capturedQueries.length).to.be.greaterThan(0);
    });

    it('respects maxTokens and maxChars options', async () => {
      fetchStub.resolves({
        ok: true,
        json: async () => ({
          organic: [{ link: 'https://example.com/result' }],
        }),
      });

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/products/very/long/path/with/many/segments',
        1,
        { maxTokens: 3, maxChars: 30 },
      );

      expect(result.results).to.have.lengthOf(1);
      expect(result.keywords.split(' ').length).to.be.at.most(3);
    });
  });
});
