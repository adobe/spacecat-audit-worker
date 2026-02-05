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
// Direct import for tests that don't need mocked fetch (for proper coverage tracking)
import BrightDataClientDirect from '../../src/support/bright-data-client.js';

use(sinonChai);
use(chaiAsPromised);

describe('BrightDataClient', () => {
  let BrightDataClient;
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
    BrightDataClient = await esmock('../../src/support/bright-data-client.js', {
      '@adobe/spacecat-shared-utils': {
        hasText: (str) => typeof str === 'string' && str.trim().length > 0,
        tracingFetch: fetchStub,
      },
    });

    // Use direct import for client instance (proper coverage)
    client = new BrightDataClientDirect('test-api-key', 'test-zone', logMock);
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
      const newClient = BrightDataClientDirect.createFrom(context);
      expect(newClient).to.be.instanceOf(BrightDataClientDirect);
    });

    it('throws error when API key is missing', () => {
      const context = {
        env: { BRIGHT_DATA_ZONE: 'zone-abc' },
        log: logMock,
      };
      expect(() => BrightDataClientDirect.createFrom(context))
        .to.throw('BRIGHT_DATA_API_KEY is not configured');
    });

    it('throws error when zone is missing', () => {
      const context = {
        env: { BRIGHT_DATA_API_KEY: 'api-key-123' },
        log: logMock,
      };
      expect(() => BrightDataClientDirect.createFrom(context))
        .to.throw('BRIGHT_DATA_ZONE is not configured');
    });
  });

  describe('extractLocale', () => {
    it('extracts xx_yy locale from path', () => {
      expect(client.extractLocale('https://example.com/en_us/products')).to.equal('en_us');
      expect(client.extractLocale('https://example.com/de_ch/about')).to.equal('de_ch');
      expect(client.extractLocale('https://example.com/fr_ca/')).to.equal('fr_ca');
    });

    it('extracts 2-letter locale from path when in whitelist', () => {
      expect(client.extractLocale('https://example.com/it/products')).to.equal('it');
      expect(client.extractLocale('https://example.com/de/about')).to.equal('de');
      expect(client.extractLocale('https://example.com/nl/')).to.equal('nl');
      expect(client.extractLocale('https://example.com/ja/docs')).to.equal('ja');
    });

    it('returns null for 2-letter codes not in whitelist', () => {
      expect(client.extractLocale('https://example.com/ab/products')).to.be.null;
      expect(client.extractLocale('https://example.com/xy/about')).to.be.null;
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

    it('tries fallback queries when first attempt returns no results', async () => {
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

      const result = await mockedClient.googleSearchWithFallback(
        'https://example.com',
        'https://example.com/it/products/item',
        1,
      );

      expect(callCount).to.be.greaterThan(1);
      expect(result.results).to.have.lengthOf(1);
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
