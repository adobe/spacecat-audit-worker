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
import sinonChai from 'sinon-chai';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Patterns Uploader', () => {
  let sandbox;
  let generatePatternsWorkbook;
  let mockAnalyzeProducts;
  let mockAnalyzePageTypes;
  let mockCreateExcelReport;
  let mockSaveExcelReport;
  let mockCreateTopUrlsQuery;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAnalyzeProducts = sandbox.stub().resolves({ 'product-1': 'regex-1' });
    mockAnalyzePageTypes = sandbox.stub().resolves({ 'pagetype-1': 'regex-1' });
    mockCreateExcelReport = sandbox.stub().resolves({});
    mockSaveExcelReport = sandbox.stub().resolves();
    mockCreateTopUrlsQuery = sandbox.stub().resolves('SELECT * FROM table');

    const module = await esmock('../../../src/cdn-logs-report/patterns/patterns-uploader.js', {
      '../../../src/cdn-logs-report/patterns/product-analysis.js': {
        analyzeProducts: mockAnalyzeProducts,
      },
      '../../../src/cdn-logs-report/patterns/page-type-analysis.js': {
        analyzePageTypes: mockAnalyzePageTypes,
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createExcelReport: mockCreateExcelReport,
      },
      '../../../src/utils/report-uploader.js': {
        saveExcelReport: mockSaveExcelReport,
      },
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createTopUrlsQuery: mockCreateTopUrlsQuery,
        },
      },
    });

    generatePatternsWorkbook = module.generatePatternsWorkbook;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createMockOptions = (overrides = {}) => ({
    site: {
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
    sharepointClient: {},
    ...overrides,
  });

  it('successfully generates patterns workbook', async () => {
    const clock = sandbox.useFakeTimers();
    const options = createMockOptions();
    const promise = generatePatternsWorkbook(options);

    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith('patterns.json not found, generating patterns.xlsx...');
    expect(options.context.log.info).to.have.been.calledWith('Fetched 2 URLs for pattern generation');
    expect(options.context.log.info).to.have.been.calledWith('Successfully generated and uploaded patterns.xlsx');
    expect(mockAnalyzeProducts).to.have.been.called;
    expect(mockAnalyzePageTypes).to.have.been.called;
    expect(mockCreateExcelReport).to.have.been.called;
    expect(mockSaveExcelReport).to.have.been.called;

    clock.restore();
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
    const clock = sandbox.useFakeTimers();
    mockAnalyzeProducts.resolves(null);
    const options = createMockOptions();

    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    expect(mockCreateExcelReport).to.have.been.called;

    clock.restore();
  });

  it('handles empty pagetype regexes', async () => {
    const clock = sandbox.useFakeTimers();
    mockAnalyzePageTypes.resolves(null);
    const options = createMockOptions();

    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    expect(mockCreateExcelReport).to.have.been.called;

    clock.restore();
  });

  it('returns false when both product and pagetype arrays are empty', async () => {
    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({});
    const options = createMockOptions();

    const result = await generatePatternsWorkbook(options);

    expect(result).to.be.false;
    expect(options.context.log.warn).to.have.been.calledWith('No pattern data available to generate report');
    expect(mockCreateExcelReport).to.not.have.been.called;
    expect(mockSaveExcelReport).to.not.have.been.called;
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
    const clock = sandbox.useFakeTimers();
    const options = createMockOptions({
      athenaClient: {
        query: sandbox.stub().resolves([{ url: '/path1' }, { url: null }, { url: '/path2' }]),
      },
    });

    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    expect(options.context.log.info).to.have.been.calledWith('Fetched 2 URLs for pattern generation');

    clock.restore();
  });

  it('processes product and pagetype data correctly', async () => {
    const clock = sandbox.useFakeTimers();
    mockAnalyzeProducts.resolves({
      'product-1': 'regex-1',
      'product-2': 'regex-2',
    });
    mockAnalyzePageTypes.resolves({
      'pagetype-1': 'regex-1',
      'pagetype-2': 'regex-2',
    });

    const options = createMockOptions();
    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    expect(mockCreateExcelReport).to.have.been.calledWith(
      sinon.match({
        'shared-products': sinon.match.array,
        'shared-pagetype': sinon.match.array,
      }),
      sinon.match.object,
      sinon.match.object,
    );

    clock.restore();
  });

  it('merges new and existing patterns', async () => {
    const clock = sandbox.useFakeTimers();
    mockAnalyzeProducts.resolves({ 'new-product': 'regex-new' });

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old' }],
      pagePatterns: [{ name: 'old-page', regex: 'regex-old' }],
    };

    const options = createMockOptions({ existingPatterns, configCategories: ['new-product'] });
    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    const callArgs = mockCreateExcelReport.getCall(0).args[0];
    expect(callArgs['shared-products']).to.have.length(2);
    expect(callArgs['shared-pagetype']).to.have.length(1);

    clock.restore();
  });

  it('keeps existing patterns when LLM generates nothing', async () => {
    const clock = sandbox.useFakeTimers();
    mockAnalyzeProducts.resolves({});
    mockAnalyzePageTypes.resolves({});

    const existingPatterns = {
      topicPatterns: [{ name: 'old-product', regex: 'regex-old' }],
      pagePatterns: [{ name: 'old-page', regex: 'regex-old' }],
    };

    const options = createMockOptions({ existingPatterns });
    const promise = generatePatternsWorkbook(options);
    await clock.tickAsync(3000);
    const result = await promise;

    expect(result).to.be.true;
    const callArgs = mockCreateExcelReport.getCall(0).args[0];
    expect(callArgs['shared-products']).to.have.length(1);
    expect(callArgs['shared-pagetype']).to.have.length(1);

    clock.restore();
  });
});

