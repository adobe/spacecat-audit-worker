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

import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Patterns Uploader', () => {
  let sandbox;
  let generatePatternsWorkbook;
  let mockAnalyzeProducts;
  let mockAnalyzePageTypes;
  let mockCreateTopUrlsQuery;
  let mockReplaceRules;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAnalyzeProducts = sandbox.stub().resolves({ 'product-1': 'regex-1' });
    mockAnalyzePageTypes = sandbox.stub().resolves({ 'pagetype-1': 'regex-1' });
    mockCreateTopUrlsQuery = sandbox.stub().resolves('SELECT * FROM table');
    mockReplaceRules = sandbox.stub().resolves({ category_rules: 1, page_type_rules: 1 });

    const module = await esmock('../../../src/cdn-logs-report/patterns/patterns-uploader.js', {
      '../../../src/cdn-logs-report/patterns/product-analysis.js': {
        analyzeProducts: mockAnalyzeProducts,
      },
      '../../../src/cdn-logs-report/patterns/page-type-analysis.js': {
        analyzePageTypes: mockAnalyzePageTypes,
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createTopUrlsQuery: mockCreateTopUrlsQuery,
        },
      },
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        replaceAgenticUrlClassificationRules: mockReplaceRules,
      },
    });

    generatePatternsWorkbook = module.generatePatternsWorkbook;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createMockOptions = (overrides = {}) => ({
    site: {
      getId: () => 'test-site',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    },
    context: {
      log: {
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      },
    },
    athenaClient: {
      query: sandbox.stub().resolves([{ url: '/path1' }, { url: '/path2' }]),
    },
    s3Config: {
      databaseName: 'test-db',
      tableName: 'test-table',
    },
    periods: [{ start: '2025-01-01', end: '2025-01-07' }],
    ...overrides,
  });

  it('successfully generates and syncs DB rules', async () => {
    const options = createMockOptions();
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith('No DB patterns found, generating fresh rules...');
    expect(options.context.log.info).to.have.been.calledWith('Fetched 2 URLs for pattern generation');
    expect(options.context.log.info).to.have.been.calledWith(
      'Successfully synced patterns to DB for site test-site: 1 category rules, 1 page type rules',
    );
    expect(mockAnalyzeProducts).to.have.been.called;
    expect(mockAnalyzePageTypes).to.have.been.called;
    expect(mockReplaceRules).to.have.been.calledWith(sinon.match({
      site: options.site,
      context: options.context,
      updatedBy: 'audit-worker:agentic-patterns',
    }));
    // LLMO-5036: auto-derived rules carry customer-edit metadata
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.have.lengthOf(1);
    expect(callArgs.categoryRules[0]).to.include({
      name: 'product-1',
      regex: 'regex-1',
      sort_order: 0,
      source: 'ai',
      derivation_method: 'llm',
    });
    expect(callArgs.categoryRules[0].sample_urls).to.deep.equal([]);
    expect(callArgs.pageTypeRules[0]).to.include({
      name: 'pagetype-1',
      regex: 'regex-1',
      sort_order: 0,
      source: 'ai',
      derivation_method: 'llm',
    });
    expect(callArgs.pageTypeRules[0].sample_urls).to.deep.equal([]);
  });

  it('returns false when no URLs fetched', async () => {
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().resolves([]),
      },
    });

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(options.context.log.warn).to.have.been.calledWith('No URLs fetched from Athena for pattern generation');
  });

  it('returns false when athena query returns null', async () => {
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().resolves(null),
      },
    });

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(options.context.log.warn).to.have.been.calledWith('No URLs fetched from Athena for pattern generation');
  });

  it('handles empty product regexes', async () => {
    mockAnalyzeProducts.resolves(null);
    const options = createMockOptions();

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(mockReplaceRules).to.have.been.called;
  });

  it('handles empty pagetype regexes', async () => {
    mockAnalyzePageTypes.resolves(null);
    const options = createMockOptions();

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(mockReplaceRules).to.have.been.called;
  });

  it('returns false when both product and pagetype arrays are empty', async () => {
    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({});
    const options = createMockOptions();

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(options.context.log.warn).to.have.been.calledWith('No pattern data available to generate report');
    expect(mockReplaceRules).to.not.have.been.called;
  });

  it('handles errors and returns false', async () => {
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().rejects(new Error('Query failed')),
      },
    });

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(options.context.log.error).to.have.been.calledWith('Failed to generate patterns: Query failed');
  });

  it('handles URLs with null values', async () => {
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().resolves([{ url: '/path1' }, { url: null }, { url: '/path2' }]),
      },
    });

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith('Fetched 2 URLs for pattern generation');
  });

  it('drops URLs that collapse to empty after stripping query/fragment', async () => {
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().resolves([
          { url: '/path1' },
          { url: '?only=query' },
          { url: '#only-fragment' },
          { url: '/path2' },
        ]),
      },
    });

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith('Fetched 2 URLs for pattern generation');
  });

  it('processes product and pagetype data correctly', async () => {
    mockAnalyzeProducts.resolves({
      'product-1': 'regex-1',
      'product-2': 'regex-2',
    });
    mockAnalyzePageTypes.resolves({
      'pagetype-1': 'regex-1',
      'pagetype-2': 'regex-2',
    });

    const options = createMockOptions();
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules.map((r) => r.name)).to.deep.equal(['product-1', 'product-2']);
    expect(callArgs.categoryRules.map((r) => r.sort_order)).to.deep.equal([0, 1]);
    callArgs.categoryRules.forEach((r) => {
      expect(r.source).to.equal('ai');
      expect(r.derivation_method).to.equal('llm');
      expect(r.sample_urls).to.deep.equal([]);
    });
    expect(callArgs.pageTypeRules.map((r) => r.name)).to.deep.equal(['pagetype-1', 'pagetype-2']);
    callArgs.pageTypeRules.forEach((r) => {
      expect(r.source).to.equal('ai');
      expect(r.derivation_method).to.equal('llm');
    });
  });

  it('LLMO-5036: sample_urls is populated by applying each LLM-emitted regex back over the input paths (capped at 20)', async () => {
    // 25 product paths, 5 docs paths, 2 misc paths
    const productPaths = Array.from({ length: 25 }, (_, i) => `/products/photoshop-${i}`);
    const docsPaths = Array.from({ length: 5 }, (_, i) => `/docs/getting-started-${i}`);
    const miscPaths = ['/about', '/contact'];
    const allPaths = [...productPaths, ...docsPaths, ...miscPaths].map((url) => ({ url }));

    mockAnalyzeProducts.resolves({ photoshop: '(?i)/products/photoshop' });
    mockAnalyzePageTypes.resolves({ documentation: '(?i)/docs/' });

    const options = createMockOptions({
      athenaClient: { query: sandbox.stub().resolves(allPaths) },
    });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];

    // Category rule "photoshop" should have 20 sample URLs (capped), all from /products/photoshop-*
    expect(callArgs.categoryRules).to.have.length(1);
    expect(callArgs.categoryRules[0].name).to.equal('photoshop');
    expect(callArgs.categoryRules[0].sample_urls).to.have.length(20);
    callArgs.categoryRules[0].sample_urls.forEach((url) => {
      expect(url).to.match(/^\/products\/photoshop-\d+$/);
    });

    // Page-type rule "documentation" should have 5 sample URLs (under the cap), all /docs/*
    expect(callArgs.pageTypeRules).to.have.length(1);
    expect(callArgs.pageTypeRules[0].name).to.equal('documentation');
    expect(callArgs.pageTypeRules[0].sample_urls).to.deep.equal(docsPaths);
  });

  it('LLMO-5036: sample_urls stays empty when LLM regex matches no input paths', async () => {
    mockAnalyzeProducts.resolves({ ghost: '(?i)/no-match-anywhere' });
    mockAnalyzePageTypes.resolves({});

    const options = createMockOptions();
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules[0].sample_urls).to.deep.equal([]);
  });

  it('strips stray quotes the LLM wrapped around alternation branches so the rule matches', async () => {
    // Reproduces the westjet bug: (?i)(destinations/('discover'|'decouvrir'))
    // matched 0 URLs because paths never contain quote chars.
    const paths = [
      '/en-ca/destinations/discover/tampa',
      '/en-ca/destinations/decouvrir/montreal',
      '/en-ca/hotels/maui',
    ].map((url) => ({ url }));

    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({
      'destination page': "(?i)(destinations/('discover'|'decouvrir'))",
    });

    const options = createMockOptions({
      athenaClient: { query: sandbox.stub().resolves(paths) },
    });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    const rule = callArgs.pageTypeRules.find((r) => r.name === 'destination page');
    expect(rule).to.exist;
    expect(rule.regex).to.equal('(?i)(destinations/(discover|decouvrir))');
    expect(rule.sample_urls).to.deep.equal([
      '/en-ca/destinations/discover/tampa',
      '/en-ca/destinations/decouvrir/montreal',
    ]);
  });

  it('leaves a non-string regex untouched and drops it as invalid', async () => {
    // stripStrayQuotes only operates on strings; a non-string value (LLM
    // emitting a number/object) passes through unchanged and is dropped by
    // the downstream validity check rather than throwing on .replace().
    const paths = ['/en-ca/destinations/discover/tampa'].map((url) => ({ url }));

    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({ 'broken rule': 12345 });

    const options = createMockOptions({
      athenaClient: { query: sandbox.stub().resolves(paths) },
    });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(mockReplaceRules).to.not.have.been.called;
  });

  it('LLMO-5036: scheduled run reuses existing rules and preserves provenance fields', async () => {
    const existingPatterns = {
      topicPatterns: [{
        name: 'existing-product',
        regex: '/products',
        sort_order: 0,
        source: 'human',
        sample_urls: ['/products/x'],
        derivation_method: 'common-prefix',
      }],
      pagePatterns: [{
        name: 'existing-page',
        regex: '/docs',
        sort_order: 0,
        source: 'ai',
        sample_urls: [],
        derivation_method: 'llm',
      }],
    };
    const options = createMockOptions({ existingPatterns });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(mockAnalyzeProducts).to.not.have.been.called;
    expect(mockAnalyzePageTypes).to.not.have.been.called;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal(existingPatterns.topicPatterns);
    expect(callArgs.pageTypeRules).to.deep.equal(existingPatterns.pagePatterns);
  });

  it('sanitizes round-tripped sample_urls before posting (drops non-strings, overlong, caps at 50)', async () => {
    const longUrl = `/x/${'a'.repeat(2050)}`;
    const existingPatterns = {
      topicPatterns: [{
        name: 'bad-array',
        regex: '/products',
        sort_order: 0,
        sample_urls: ['/ok', 123, null, longUrl, ...Array.from({ length: 60 }, (_, i) => `/p${i}`)],
      }],
      pagePatterns: [{
        name: 'non-array',
        regex: '/docs',
        sort_order: 0,
        sample_urls: 'not-an-array',
      }],
    };
    const options = createMockOptions({ existingPatterns });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    const sanitized = callArgs.categoryRules[0].sample_urls;
    expect(sanitized).to.have.length(50);
    expect(sanitized).to.not.include(123);
    expect(sanitized).to.not.include(null);
    expect(sanitized).to.not.include(longUrl);
    expect(sanitized[0]).to.equal('/ok');
    expect(callArgs.pageTypeRules[0].sample_urls).to.deep.equal([]);
  });

  it('skips product analysis when existing topic patterns are present (reuses them)', async () => {
    mockAnalyzeProducts.resolves({ 'new-product': 'regex-new' });

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old' }],
      pagePatterns: [{ name: 'old-page', regex: 'regex-old' }],
    };

    const options = createMockOptions({ existingPatterns });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(mockAnalyzeProducts).to.not.have.been.called;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal([
      { name: 'old-product', regex: 'regex-old', sort_order: 0, sample_urls: [] },
    ]);
    expect(callArgs.pageTypeRules).to.deep.equal([
      { name: 'old-page', regex: 'regex-old', sort_order: 0, sample_urls: [] },
    ]);
  });

  it('keeps existing patterns when LLM generates nothing', async () => {
    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({});

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old' }],
      pagePatterns: [{ name: 'old-page', regex: 'regex-old' }],
    };

    const options = createMockOptions({ existingPatterns });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(mockAnalyzeProducts).to.not.have.been.called;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal([
      { name: 'old-product', regex: 'regex-old', sort_order: 0, sample_urls: [] },
    ]);
    expect(callArgs.pageTypeRules).to.deep.equal([
      { name: 'old-page', regex: 'regex-old', sort_order: 0, sample_urls: [] },
    ]);
  });

  it('reindexes merged rules sequentially regardless of existing sort order', async () => {
    mockAnalyzeProducts.resolves({ 'new-product': 'regex-new' });
    mockAnalyzePageTypes.resolves({});

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old', sort_order: 3 }],
      pagePatterns: [],
    };

    const options = createMockOptions({ existingPatterns });
    const result = await generatePatternsWorkbook(options);

    // Topic patterns exist so analyzeProducts is skipped — only old-product survives.
    expect(result).to.be.true;
    expect(mockAnalyzeProducts).to.not.have.been.called;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal([
      { name: 'old-product', regex: 'regex-old', sort_order: 0, sample_urls: [] },
    ]);
  });

  it('logs local rule counts when RPC does not return counts', async () => {
    mockReplaceRules.resolves(null);
    const options = createMockOptions();

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith(
      'Successfully synced patterns to DB for site test-site: 1 category rules, 1 page type rules',
    );
  });
});
