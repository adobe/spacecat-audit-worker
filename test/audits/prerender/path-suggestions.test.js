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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

const BASE_URL = 'https://example.com';

// Helper to create a mock suggestion
function makeSuggestion({
  id = 'sug-1',
  status = 'NEW',
  data = {},
}) {
  const stored = { ...data };
  return {
    getId: () => id,
    getStatus: () => status,
    getData: () => stored,
    setData: (d) => { Object.assign(stored, d); Object.keys(stored).forEach((k) => { if (!(k in d)) delete stored[k]; }); },
    save: sinon.stub().resolves(),
  };
}

// Helper to create a mock site
function makeSite({ baseURL = BASE_URL, configValue = null } = {}) {
  return {
    getId: () => 'site-1',
    getBaseURL: () => baseURL,
    getConfig: () => ({
      get: (key) => (key === 'prerender.pathSuggestionsEnabled' ? configValue : null),
      getLlmoCdnlogsFilter: () => null,
    }),
  };
}

// Helper to create a mock opportunity
function makeOpportunity(suggestions = []) {
  return {
    getId: () => 'opp-1',
    getSuggestions: sinon.stub().resolves(suggestions),
  };
}

describe('Path Suggestions', () => {
  let sandbox;
  let pathSuggestionsModule;
  let mockGetAgenticHitsMapFromAthena;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockGetAgenticHitsMapFromAthena = sandbox.stub().resolves(new Map());

    pathSuggestionsModule = await esmock(
      '../../../src/prerender/features/path-suggestions/path-suggestions.js',
      {
        '../../../src/utils/agentic-urls.js': {
          getAgenticHitsMapFromAthena: mockGetAgenticHitsMapFromAthena,
        },
      },
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  // ─── extractPathType ─────────────────────────────────────────────────────────

  describe('extractPathType', () => {
    let extractPathType;

    beforeEach(() => {
      ({ extractPathType } = pathSuggestionsModule);
    });

    it('returns /products/* for a URL with multiple path segments', () => {
      expect(extractPathType('https://example.com/products/shoes')).to.equal('/products/*');
    });

    it('returns /blog/* for a URL with a single path segment', () => {
      expect(extractPathType('https://example.com/blog')).to.equal('/blog/*');
    });

    it('returns /en/* for a URL with locale prefix', () => {
      expect(extractPathType('https://example.com/en/about/team')).to.equal('/en/*');
    });

    it('returns null for a root URL', () => {
      expect(extractPathType('https://example.com/')).to.be.null;
    });

    it('returns null for a URL with no pathname', () => {
      expect(extractPathType('https://example.com')).to.be.null;
    });

    it('returns null for an invalid URL string', () => {
      expect(extractPathType('not-a-url')).to.be.null;
    });

    it('returns null for an empty string', () => {
      expect(extractPathType('')).to.be.null;
    });
  });

  // ─── RcvPathQualificationStrategy ─────────────────────────────────────────

  describe('RcvPathQualificationStrategy', () => {
    let RcvPathQualificationStrategy;

    beforeEach(() => {
      ({ RcvPathQualificationStrategy } = pathSuggestionsModule);
    });

    function makeUrls(count, {
      valuable = true, agenticTraffic = 10, contentGainRatio = 1.5,
    } = {}) {
      return Array.from({ length: count }, (_, i) => ({
        url: `https://example.com/products/item-${i}`,
        valuable,
        agenticTraffic,
        contentGainRatio,
      }));
    }

    it('disqualifies when urlCount is below minUrls', () => {
      const strategy = new RcvPathQualificationStrategy({ minUrls: 10 });
      const urls = makeUrls(5);
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.false;
      expect(result.reason).to.include('urlCount 5');
    });

    it('qualifies when urlCount is exactly minUrls', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 5, minValuablePct: 50, scoreThreshold: 0,
      });
      const urls = makeUrls(5, { valuable: true, agenticTraffic: 5, contentGainRatio: 1 });
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.true;
    });

    it('disqualifies when valuablePercent is below minValuablePct', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 5, minValuablePct: 60, scoreThreshold: 0,
      });
      // 3 out of 10 = 30% valuable
      const urls = [
        ...makeUrls(3, { valuable: true, agenticTraffic: 10, contentGainRatio: 1 }),
        ...makeUrls(7, { valuable: false, agenticTraffic: 10, contentGainRatio: 1 }),
      ];
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.false;
      expect(result.reason).to.include('valuablePercent');
    });

    it('qualifies when valuablePercent is exactly minValuablePct', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 10, minValuablePct: 50, scoreThreshold: 0,
      });
      const urls = [
        ...makeUrls(5, { valuable: true, agenticTraffic: 10, contentGainRatio: 1 }),
        ...makeUrls(5, { valuable: false, agenticTraffic: 10, contentGainRatio: 1 }),
      ];
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.true;
    });

    it('disqualifies when score is below scoreThreshold', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 5, minValuablePct: 50, scoreThreshold: 5,
      });
      // All valuable, contentGainRatio = 0.5, agenticTraffic = 0
      const urls = makeUrls(10, { valuable: true, agenticTraffic: 0, contentGainRatio: 0.5 });
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.false;
      expect(result.reason).to.include('score');
    });

    it('qualifies when score is exactly at scoreThreshold', () => {
      // score = weightedValuableTraffic + avgContentGainRatio
      // all valuable, equal traffic → weightedValuableTraffic = 1, contentGainRatio = 1 → score = 2
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 10, minValuablePct: 50, scoreThreshold: 2,
      });
      const urls = makeUrls(10, { valuable: true, agenticTraffic: 10, contentGainRatio: 1 });
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.true;
      expect(result.score).to.be.at.least(2);
    });

    it('gracefully handles zero agentic traffic (weightedValuableTraffic stays 0)', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 5, minValuablePct: 50, scoreThreshold: 0,
      });
      const urls = makeUrls(10, { valuable: true, agenticTraffic: 0, contentGainRatio: 2 });
      const result = strategy.qualify('/products/*', urls);
      // weightedValuableTraffic = 0 (totalAgenticTraffic = 0), avgContentGainRatio = 2 → score = 2
      expect(result.qualifies).to.be.true;
      expect(result.score).to.equal(2);
    });

    it('accepts custom minUrls, minValuablePct, scoreThreshold via constructor', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 3,
        minValuablePct: 20,
        scoreThreshold: 0.1,
      });
      const urls = makeUrls(3, { valuable: true, agenticTraffic: 5, contentGainRatio: 1 });
      const result = strategy.qualify('/products/*', urls);
      expect(result.qualifies).to.be.true;
    });

    it('handles undefined contentGainRatio via || 0 fallback in avgContentGainRatio', () => {
      const strategy = new RcvPathQualificationStrategy({
        minUrls: 5, minValuablePct: 50, scoreThreshold: 0,
      });
      // contentGainRatio is undefined — triggers the || 0 branch in the reduce
      const urls = Array.from({ length: 10 }, (_, i) => ({
        url: `https://example.com/products/item-${i}`,
        valuable: true,
        agenticTraffic: 10,
        contentGainRatio: undefined,
      }));
      const result = strategy.qualify('/products/*', urls);
      // avgContentGainRatio = 0 (all undefined), weightedValuableTraffic = 1 → score = 1
      expect(result.qualifies).to.be.true;
      expect(result.score).to.equal(1);
    });
  });

  // ─── findPreservablePathSuggestions ───────────────────────────────────────

  describe('findPreservablePathSuggestions', () => {
    let findPreservablePathSuggestions;

    beforeEach(() => {
      ({ findPreservablePathSuggestions } = pathSuggestionsModule);
    });

    const log = { debug: sinon.stub() };

    it('returns path suggestions in a preservable status', async () => {
      const suggestions = [
        makeSuggestion({ id: 's1', status: 'NEW', data: { allowedRegexPatterns: ['/products/*'] } }),
        makeSuggestion({ id: 's2', status: 'FIXED', data: { allowedRegexPatterns: ['/blog/*'] } }),
        makeSuggestion({ id: 's3', status: 'OUTDATED', data: { allowedRegexPatterns: ['/news/*'] } }),
        makeSuggestion({ id: 's4', status: 'NEW', data: { url: 'https://example.com/page' } }),
      ];
      const opportunity = makeOpportunity(suggestions);
      const result = await findPreservablePathSuggestions(opportunity, log);
      expect(result).to.have.length(2);
      expect(result.map((s) => s.getId())).to.include.members(['s1', 's2']);
    });

    it('returns suggestions with edgeDeployed regardless of status', async () => {
      const suggestions = [
        makeSuggestion({
          id: 's1', status: 'OUTDATED', data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
        }),
      ];
      const opportunity = makeOpportunity(suggestions);
      const result = await findPreservablePathSuggestions(opportunity, log);
      expect(result).to.have.length(1);
    });

    it('returns empty array when no path suggestions exist', async () => {
      const suggestions = [
        makeSuggestion({ id: 's1', status: 'NEW', data: { url: 'https://example.com/page' } }),
      ];
      const opportunity = makeOpportunity(suggestions);
      const result = await findPreservablePathSuggestions(opportunity, log);
      expect(result).to.have.length(0);
    });
  });

  // ─── buildPathTypeSuggestions ─────────────────────────────────────────────

  describe('buildPathTypeSuggestions', () => {
    let buildPathTypeSuggestions;
    let RcvPathQualificationStrategy;

    beforeEach(() => {
      ({ buildPathTypeSuggestions, RcvPathQualificationStrategy } = pathSuggestionsModule);
    });

    const context = {
      log: { warn: sinon.stub(), debug: sinon.stub(), info: sinon.stub() },
    };

    function makePreRenderSuggestions(pathPrefix, count, contentGainRatio = 2) {
      return Array.from({ length: count }, (_, i) => ({
        url: `${BASE_URL}${pathPrefix}/item-${i}`,
        contentGainRatio,
        wordCountBefore: 100,
        wordCountAfter: 200,
      }));
    }

    function makeExistingSuggestions(urlList, status = 'NEW') {
      return urlList.map((url, i) => makeSuggestion({
        id: `es-${i}`,
        status,
        data: { url, valuable: true },
      }));
    }

    it('only includes URLs with NEW or FIXED existing suggestions', async () => {
      const urls = [
        `${BASE_URL}/products/a`,
        `${BASE_URL}/products/b`,
        `${BASE_URL}/products/c`,
      ];
      const existingSuggestions = [
        makeSuggestion({ id: 'e1', status: 'NEW', data: { url: urls[0], valuable: true } }),
        makeSuggestion({ id: 'e2', status: 'FIXED', data: { url: urls[1], valuable: true } }),
        makeSuggestion({ id: 'e3', status: 'OUTDATED', data: { url: urls[2], valuable: true } }),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = urls.map((url) => ({
        url, contentGainRatio: 3, wordCountBefore: 100, wordCountAfter: 300,
      }));

      // Only urls[0] and urls[1] qualify; not enough for PATH_TYPE_MIN_URLS=10
      const strategy = new RcvPathQualificationStrategy({ minUrls: 2, minValuablePct: 50, scoreThreshold: 0 });
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      // 2 eligible URLs grouped into one path suggestion
      expect(results[0].data.allowedRegexPatterns).to.deep.equal(['/products/*']);
    });

    it('excludes URLs with no existing DB suggestion', async () => {
      const opportunity = makeOpportunity([]); // no existing suggestions
      const site = makeSite();
      const preRender = makePreRenderSuggestions('/products', 15);
      const strategy = new RcvPathQualificationStrategy({ minUrls: 5, minValuablePct: 50, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(0);
    });

    it('generates multiple qualifying paths sorted by score descending', async () => {
      const productsUrls = Array.from({ length: 10 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const blogUrls = Array.from({ length: 10 }, (_, i) => `${BASE_URL}/blog/post-${i}`);

      const existingSuggestions = [
        ...makeExistingSuggestions(productsUrls, 'NEW'),
        ...makeExistingSuggestions(blogUrls, 'NEW'),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();

      // Products has higher contentGainRatio → higher score
      const preRender = [
        ...productsUrls.map((url) => ({ url, contentGainRatio: 3, wordCountBefore: 100, wordCountAfter: 300 })),
        ...blogUrls.map((url) => ({ url, contentGainRatio: 1, wordCountBefore: 100, wordCountAfter: 200 })),
      ];

      // agenticTraffic = 0 (default mock), score = 0 + avgContentGainRatio
      const strategy = new RcvPathQualificationStrategy({ minUrls: 5, minValuablePct: 50, scoreThreshold: 0 });
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });

      expect(results).to.have.length(2);
      expect(results[0].data.score).to.be.at.least(results[1].data.score);
      expect(results[0].data.allowedRegexPatterns).to.deep.equal(['/products/*']);
    });

    it('falls back gracefully when Athena fetch fails', async () => {
      mockGetAgenticHitsMapFromAthena.rejects(new Error('Athena error'));

      const urls = Array.from({ length: 10 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();

      const preRender = urls.map((url) => ({
        url, contentGainRatio: 3, wordCountBefore: 100, wordCountAfter: 300,
      }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 5, minValuablePct: 50, scoreThreshold: 0 });

      // Should not throw
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      // With agenticTraffic=0 but contentGainRatio=3 and threshold=0, should still qualify
      expect(results).to.have.length(1);
    });

    it('enriches suggestions with agenticTraffic from Athena map', async () => {
      const urls = Array.from({ length: 10 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const hitsMap = new Map(urls.map((url) => {
        const pathname = new URL(url).pathname;
        return [pathname, 50];
      }));
      mockGetAgenticHitsMapFromAthena.resolves(hitsMap);

      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();

      const preRender = urls.map((url) => ({
        url, contentGainRatio: 1, wordCountBefore: 100, wordCountAfter: 200,
      }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 5, minValuablePct: 50, scoreThreshold: 0 });
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });

      expect(results).to.have.length(1);
      // Score should be higher than pure contentGainRatio since agentic traffic is nonzero
      expect(results[0].data.score).to.be.greaterThan(1);
    });

    it('returns correct suggestion shape for a qualifying path', async () => {
      const urls = Array.from({ length: 10 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = urls.map((url) => ({
        url, contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200,
      }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 5, minValuablePct: 50, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);

      const { key, data } = results[0];
      expect(key).to.equal('/products/*|prerender');
      expect(data.pathType).to.be.undefined;
      expect(data.url).to.equal(`${BASE_URL}/products/*`);
      expect(data.allowedRegexPatterns).to.deep.equal(['/products/*']);
      expect(data.score).to.be.a('number');
      expect(data.contentGainRatio).to.equal(2);
      expect(data.wordCountBefore).to.equal(1000);
      expect(data.wordCountAfter).to.equal(2000);
      expect(data.aiReadablePercent).to.be.a('number');
    });

    it('treats URL as valuable=true when not present in DB suggestion data', async () => {
      // When valuableByPathname does not have the pathname (not in DB suggestions),
      // the enriched entry should default to valuable=true (covers the false branch of valuableByPathname.has)
      const validUrl = `${BASE_URL}/products/item-0`;
      // URL suggestion has no 'valuable' field in data
      const existingSuggestions = [
        makeSuggestion({ id: 'e1', status: 'NEW', data: { url: validUrl } }),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = [{ url: validUrl, contentGainRatio: 2, wordCountBefore: 0, wordCountAfter: 0 }];
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      // With minValuablePct=0 and all default-true valuable, should qualify
      expect(results[0].data.score).to.be.a('number');
    });

    it('uses valuable field from DB suggestion when present (null → treated as false)', async () => {
      const validUrl = `${BASE_URL}/products/item-0`;
      // valuable=null triggers the ?? true fallback in valuableByPathname map
      const existingSuggestions = [
        makeSuggestion({ id: 'e1', status: 'NEW', data: { url: validUrl, valuable: null } }),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = [{ url: validUrl, contentGainRatio: 2, wordCountBefore: 0, wordCountAfter: 0 }];
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      // null ?? true = true, so valuable=true → qualifies
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      expect(results[0].data.score).to.be.a('number');
    });

    it('handles undefined wordCountBefore/After gracefully via || 0 fallback', async () => {
      const urls = Array.from({ length: 5 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      // No wordCountBefore/wordCountAfter — triggers || 0 branch
      const preRender = urls.map((url) => ({ url, contentGainRatio: 2 }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      expect(results[0].data.wordCountBefore).to.equal(0);
      expect(results[0].data.wordCountAfter).to.equal(0);
    });

    it('handles undefined contentGainRatio via || 0 fallback in avgContentGainRatio reduce', async () => {
      const urls = Array.from({ length: 5 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      // contentGainRatio is undefined — triggers || 0 in the results reduce (line ~235)
      const preRender = urls.map((url) => ({ url, wordCountBefore: 100, wordCountAfter: 200 }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      expect(results[0].data.contentGainRatio).to.equal(0);
    });

    it('skips root-level URLs (no first path segment)', async () => {
      const rootUrl = `${BASE_URL}/`;
      const opportunity = makeOpportunity([
        makeSuggestion({ id: 'e1', status: 'NEW', data: { url: rootUrl, valuable: true } }),
      ]);
      const site = makeSite();
      const preRender = [{ url: rootUrl, contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200 }];
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(0);
    });

    it('excludes domain-wide and path suggestions from eligibility scoring', async () => {
      const validUrl = `${BASE_URL}/products/item-0`;
      const existingSuggestions = [
        makeSuggestion({ id: 'e1', status: 'NEW', data: { url: validUrl, valuable: true } }),
        // path suggestion (has allowedRegexPatterns) — must be excluded
        makeSuggestion({ id: 'e2', status: 'NEW', data: { url: `${BASE_URL}/products/item-1`, allowedRegexPatterns: ['/products/*'] } }),
        // isDomainWide=true — must be excluded
        makeSuggestion({ id: 'e3', status: 'NEW', data: { url: `${BASE_URL}/*`, isDomainWide: true } }),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const allUrls = [validUrl, `${BASE_URL}/products/item-1`, `${BASE_URL}/*`];
      const preRender = allUrls.map((url) => ({
        url, contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200,
      }));
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });
      // Only item-0 is eligible (item-1 is path, /* is isDomainWide)
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      expect(results[0].data.allowedRegexPatterns).to.deep.equal(['/products/*']);
    });

    it('gracefully handles a DB suggestion with an invalid URL', async () => {
      const validUrl = `${BASE_URL}/products/item-0`;
      const existingSuggestions = [
        // Invalid URL suggestion — triggers the catch { return null } in eligiblePathnames / valuableByPathname maps
        makeSuggestion({ id: 'invalid', status: 'NEW', data: { url: 'not-a-url', valuable: true } }),
        makeSuggestion({ id: 'valid', status: 'NEW', data: { url: validUrl, valuable: true } }),
      ];
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = [{ url: validUrl, contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200 }];
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });

      // Should not throw; invalid-URL suggestion is skipped silently
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      expect(results).to.have.length(1);
      expect(results[0].data.allowedRegexPatterns).to.deep.equal(['/products/*']);
    });

    it('skips preRenderSuggestions with an invalid URL (filter catch branch)', async () => {
      // A valid existing suggestion for a valid URL and one invalid prerender URL
      const validUrl = `${BASE_URL}/products/item-0`;
      const existingSuggestions = makeExistingSuggestions([validUrl], 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();

      const preRender = [
        { url: 'not-a-valid-url', contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200 },
        { url: validUrl, contentGainRatio: 2, wordCountBefore: 100, wordCountAfter: 200 },
      ];
      const strategy = new RcvPathQualificationStrategy({ minUrls: 1, minValuablePct: 0, scoreThreshold: 0 });
      // Only one valid URL — but extractPathType('not-a-valid-url') is null so it won't be included
      // The filter catch branch is triggered when new URL(s.url) throws
      const results = await buildPathTypeSuggestions(preRender, opportunity, site, context, { strategy });
      // The invalid URL is filtered out; 1 valid URL qualifies with minUrls=1
      expect(results).to.have.length(1);
      expect(results[0].data.allowedRegexPatterns).to.deep.equal(['/products/*']);
    });

    it('triggers debug log and skips path when group does not qualify', async () => {
      const ctxWithDebugStub = {
        log: { warn: sinon.stub(), debug: sinon.stub(), info: sinon.stub() },
      };
      const urls = Array.from({ length: 5 }, (_, i) => `${BASE_URL}/products/item-${i}`);
      const existingSuggestions = makeExistingSuggestions(urls, 'NEW');
      const opportunity = makeOpportunity(existingSuggestions);
      const site = makeSite();
      const preRender = urls.map((url) => ({
        url, contentGainRatio: 1, wordCountBefore: 100, wordCountAfter: 200,
      }));
      // minUrls=10 means the group of 5 won't qualify → log.debug is called
      const strategy = new RcvPathQualificationStrategy({ minUrls: 10, minValuablePct: 50, scoreThreshold: 0 });

      const results = await buildPathTypeSuggestions(preRender, opportunity, site, ctxWithDebugStub, { strategy });
      expect(results).to.have.length(0);
      expect(ctxWithDebugStub.log.debug.calledWith(sinon.match(/Skipping path/))).to.be.true;
    });
  });

  // ─── markSuggestionsAsCoveredByPaths ─────────────────────────────────────

  describe('markSuggestionsAsCoveredByPaths', () => {
    let markSuggestionsAsCoveredByPaths;
    let saveManyStub;
    let ctx;

    beforeEach(() => {
      ({ markSuggestionsAsCoveredByPaths } = pathSuggestionsModule);
      saveManyStub = sinon.stub().resolves();
      ctx = {
        log: { warn: sinon.stub(), debug: sinon.stub(), info: sinon.stub() },
        dataAccess: { Suggestion: { saveMany: saveManyStub } },
      };
    });

    it('marks NEW per-URL suggestions as coveredByPattern when path is deployed', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1` },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.calledOnce).to.be.true;
      expect(urlSuggestion.getData().coveredByPattern).to.equal('path-1');
    });

    it('does not mark suggestion if path prefix does not match', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/blog/post-1` },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
      expect(urlSuggestion.getData().coveredByPattern).to.be.undefined;
    });

    it('does not mark URLs whose path prefix is a substring but not a segment boundary', async () => {
      // /prod/* should NOT cover /products/item-1 — segment boundary enforced
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/prod/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1` },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
      expect(urlSuggestion.getData().coveredByPattern).to.be.undefined;
    });

    it('does not re-mark suggestions already covered by a path', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1`, coveredByPattern: 'path-1' },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
    });

    it('does not re-mark suggestions already covered by domain-wide', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1`, coveredByDomainWide: 'dw-1' },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
    });

    it('self-heals: clears stale coveredByPattern refs to undeployed path suggestions', async () => {
      // A path suggestion that is NOT deployed
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: false },
      });
      // A URL suggestion with a stale coveredByPattern pointing to that path
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1`, coveredByPattern: 'path-1' },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.calledOnce).to.be.true;
      expect(urlSuggestion.getData().coveredByPattern).to.be.undefined;
    });

    it('self-heals: clears coveredByPattern refs to deleted path suggestions', async () => {
      // No path suggestion exists — the referenced one was deleted
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1`, coveredByPattern: 'deleted-path-id' },
      });
      const opportunity = makeOpportunity([urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.calledOnce).to.be.true;
      expect(urlSuggestion.getData().coveredByPattern).to.be.undefined;
    });

    it('does not modify suggestions when no path suggestions are deployed', async () => {
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1` },
      });
      const opportunity = makeOpportunity([urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
    });

    it('does not mark suggestions with edgeDeployed already set', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      const urlSuggestion = makeSuggestion({
        id: 'url-1',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1`, edgeDeployed: true },
      });
      const opportunity = makeOpportunity([pathSuggestion, urlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      expect(saveManyStub.notCalled).to.be.true;
    });

    it('skips suggestions with an invalid URL when checking path prefix (catch branch)', async () => {
      const pathSuggestion = makeSuggestion({
        id: 'path-1',
        status: 'NEW',
        data: { allowedRegexPatterns: ['/products/*'], edgeDeployed: true },
      });
      // A URL suggestion with an invalid URL — triggers catch { return false }
      const invalidUrlSuggestion = makeSuggestion({
        id: 'url-invalid',
        status: 'NEW',
        data: { url: 'not-a-valid-url' },
      });
      const validUrlSuggestion = makeSuggestion({
        id: 'url-valid',
        status: 'NEW',
        data: { url: `${BASE_URL}/products/item-1` },
      });
      const opportunity = makeOpportunity([pathSuggestion, invalidUrlSuggestion, validUrlSuggestion]);

      await markSuggestionsAsCoveredByPaths(opportunity, ctx);

      // Invalid URL suggestion is skipped without error; valid one is covered via saveMany
      expect(saveManyStub.calledOnce).to.be.true;
      expect(validUrlSuggestion.getData().coveredByPattern).to.equal('path-1');
    });
  });
});
