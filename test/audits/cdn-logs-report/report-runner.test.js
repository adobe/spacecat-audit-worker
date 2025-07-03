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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('CDN Logs Report Runner', () => {
  let reportRunner;
  let baseMockParams;
  let saveExcelReportMock;

  const createMockParams = (overrides = {}) => ({
    athenaClient: {
      query: sandbox.stub().resolves([
        { country_code: 'US', week_1: 100 },
        { user_agent: 'chrome', status: 200, total_requests: 75 },
      ]),
    },
    s3Config: {
      bucket: 'test',
      customerName: 'test-customer',
      databaseName: 'test_db',
      tableName: 'test_table',
    },
    log: { info: sandbox.stub(), error: sandbox.stub() },
    site: {
      getBaseURL: () => 'https://test.com',
      getConfig: () => ({
        getCdnLogsConfig: () => ({ outputLocation: 'sharepoint-site', filters: [] }),
        getGroupedURLs: sandbox.stub().returns([]),
      }),
    },
    sharepointClient: { upload: sandbox.stub().resolves() },
    ...overrides,
  });

  const createEsmockConfig = (overrides = {}) => {
    saveExcelReportMock = sandbox.stub().resolves();
    return {
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createCountryWeeklyBreakdown: sandbox.stub().resolves('SELECT country data'),
          createUserAgentWeeklyBreakdown: sandbox.stub().resolves('SELECT user agent data'),
          createUrlStatusWeeklyBreakdown: sandbox.stub().resolves('SELECT url status data'),
          createTopBottomUrlsByStatus: sandbox.stub().resolves('SELECT top bottom urls'),
          createError404Urls: sandbox.stub().resolves('SELECT 404 errors'),
          createError503Urls: sandbox.stub().resolves('SELECT 503 errors'),
          createSuccessUrlsByCategory: sandbox.stub().resolves('SELECT success urls'),
          createTopUrls: sandbox.stub().resolves('SELECT top urls'),
          ...overrides.queryBuilder,
        },
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createCDNLogsExcelReport: sandbox.stub().resolves({ xlsx: { writeBuffer: () => Buffer.from('excel') } }),
        ...overrides.excelGenerator,
      },
      '../../../src/cdn-logs-report/utils/report-uploader.js': {
        saveExcelReport: saveExcelReportMock,
        ...overrides.reportUploader,
      },
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        createDateRange: sandbox.stub().returns({ startDate: new Date('2024-01-01'), endDate: new Date('2024-01-07') }),
        generatePeriodIdentifier: sandbox.stub().returns('2024-W01'),
        generateReportingPeriods: sandbox.stub().returns({ weeks: [{ startDate: new Date('2024-01-01'), endDate: new Date('2024-01-07') }] }),
        buildSiteFilters: sandbox.stub().returns([]),
        ...overrides.reportUtils,
      },
    };
  };

  beforeEach(async () => {
    baseMockParams = createMockParams();
    reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', createEsmockConfig());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs weekly report successfully for all providers', async () => {
    await reportRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.info).to.have.been.calledWith('Generating reports for providers: chatgpt, perplexity');
    expect(baseMockParams.log.info).to.have.been.calledWith('Starting report generation for chatgpt...');
    expect(baseMockParams.log.info).to.have.been.calledWith('Starting report generation for perplexity...');
    expect(baseMockParams.athenaClient.query.callCount).to.be.greaterThan(10);
  });

  it('runs custom date range report with specified dates', async () => {
    const customParams = {
      ...baseMockParams,
      startDateStr: '2025-01-01',
      endDateStr: '2025-01-07',
    };

    await reportRunner.runCustomDateRangeReport(customParams);

    expect(baseMockParams.log.info).to.have.been.calledWith('Generating reports for providers: chatgpt, perplexity');
    expect(baseMockParams.athenaClient.query).to.have.been.called;
  });

  it('handles provider-specific errors gracefully and continues with other providers', async () => {
    baseMockParams.athenaClient.query.onCall(0).rejects(new Error('First query failed'));
    baseMockParams.athenaClient.query.onCall(1).rejects(new Error('Second query failed'));

    await reportRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.error.callCount).to.be.greaterThan(1);
    expect(baseMockParams.log.info).to.have.been.calledWith('Starting report generation for perplexity...');
  });

  it('logs success messages when provider reports complete successfully', async () => {
    await reportRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.info).to.have.been.calledWith('Successfully generated chatgpt report');
    expect(baseMockParams.log.info).to.have.been.calledWith('Successfully generated perplexity report');
    expect(baseMockParams.log.error).to.not.have.been.called;
  });

  it('handles query and Excel generation failures gracefully', async () => {
    baseMockParams.athenaClient.query.rejects(new Error('Query failed'));

    const failureRunner = await esmock(
      '../../../src/cdn-logs-report/utils/report-runner.js',
      createEsmockConfig({
        excelGenerator: {
          createCDNLogsExcelReport: sandbox.stub().rejects(new Error('Excel generation failed')),
        },
      }),
    );

    await failureRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.error.callCount).to.be.greaterThan(1);
  });

  it('handles null getCdnLogsConfig gracefully', async () => {
    const testParams = createMockParams({
      site: {
        getBaseURL: () => 'https://test.com',
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
      },
    });

    await reportRunner.runWeeklyReport(testParams);

    expect(testParams.log.info).to.have.been.calledWith('Generating reports for providers: chatgpt, perplexity');
    expect(saveExcelReportMock).to.have.been.called;
  });

  describe('null query handling', () => {
    it('continues processing other queries when some return null and others fail', async () => {
      const mockQueryBuilder = {
        createCountryWeeklyBreakdown: sandbox.stub().resolves('SELECT country data'),
        createUserAgentWeeklyBreakdown: sandbox.stub().resolves(null),
        createUrlStatusWeeklyBreakdown: sandbox.stub().resolves('SELECT url status data'),
        createTopBottomUrlsByStatus: sandbox.stub().resolves('SELECT top bottom urls'),
        createError404Urls: sandbox.stub().resolves('SELECT 404 errors'),
        createError503Urls: sandbox.stub().resolves(null),
        createSuccessUrlsByCategory: sandbox.stub().resolves(null),
        createTopUrls: sandbox.stub().resolves('SELECT top urls'),
      };

      const mixedRunner = await esmock(
        '../../../src/cdn-logs-report/utils/report-runner.js',
        createEsmockConfig({
          queryBuilder: mockQueryBuilder,
        }),
      );

      const testParams = createMockParams();

      testParams.athenaClient.query
        .onCall(0).resolves([{ country_code: 'US', week_1: 100 }])
        .onCall(1).rejects(new Error('Query failed'))
        .onCall(2)
        .resolves([{ page_type: 'product', week_1: 50 }])
        .onCall(3)
        .resolves([{ url: '/test', status: 200 }])
        .onCall(4)
        .resolves([{ url: '/error', status: 404 }]);

      await mixedRunner.runWeeklyReport(testParams);

      expect(testParams.athenaClient.query.callCount).to.equal(10);
      expect(testParams.log.error.callCount).to.be.greaterThan(0);

      expect(testParams.log.info).to.have.been.calledWith('Successfully generated chatgpt report');
      expect(testParams.log.info).to.have.been.calledWith('Successfully generated perplexity report');
    });
  });
});
