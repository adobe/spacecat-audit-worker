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
      categoryRules: [{ name: 'product-1', regex: 'regex-1', sort_order: 0 }],
      pageTypeRules: [{ name: 'pagetype-1', regex: 'regex-1', sort_order: 0 }],
      updatedBy: 'audit-worker:agentic-patterns',
    }));
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
    expect(mockReplaceRules).to.have.been.calledWith(sinon.match({
      categoryRules: [
        { name: 'product-1', regex: 'regex-1', sort_order: 0 },
        { name: 'product-2', regex: 'regex-2', sort_order: 1 },
      ],
      pageTypeRules: [
        { name: 'pagetype-1', regex: 'regex-1', sort_order: 0 },
        { name: 'pagetype-2', regex: 'regex-2', sort_order: 1 },
      ],
    }));
  });

  it('merges new and existing patterns and keep only config categories', async () => {
    mockAnalyzeProducts.resolves({ 'new-product': 'regex-new' });

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old' }],
      pagePatterns: [{ name: 'old-page', regex: 'regex-old' }],
    };

    const options = createMockOptions({ existingPatterns, configCategories: ['new-product'] });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal([
      { name: 'new-product', regex: 'regex-new', sort_order: 0 },
    ]);
    expect(callArgs.pageTypeRules).to.deep.equal([
      { name: 'old-page', regex: 'regex-old', sort_order: 0 },
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
      { name: 'old-product', regex: 'regex-old', sort_order: 0 },
    ]);
    expect(callArgs.pageTypeRules).to.deep.equal([
      { name: 'old-page', regex: 'regex-old', sort_order: 0 },
    ]);
  });

  it('keeps explicit existing sort order while merging before final reindexing', async () => {
    mockAnalyzeProducts.resolves({ 'new-product': 'regex-new' });
    mockAnalyzePageTypes.resolves({});

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old', sort_order: 3 }],
      pagePatterns: [],
    };

    const options = createMockOptions({
      existingPatterns,
      configCategories: ['old-product', 'new-product'],
    });
    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.true;
    const callArgs = mockReplaceRules.getCall(0).args[0];
    expect(callArgs.categoryRules).to.deep.equal([
      { name: 'old-product', regex: 'regex-old', sort_order: 0 },
      { name: 'new-product', regex: 'regex-new', sort_order: 1 },
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
