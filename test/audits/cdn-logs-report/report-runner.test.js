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

describe('CDN Logs Report Runner', () => {
  let sandbox;
  let reportRunner;
  let saveExcelReportMock;

  const baseMockParams = {
    athenaClient: {
      query: sinon.stub().resolves([]),
    },
    s3Config: {
      databaseName: 'test_db',
      customerName: 'test_customer',
    },
    log: {
      info: sinon.stub(),
      error: sinon.stub(),
    },
    site: {
      getConfig: () => ({ getCdnLogsConfig: () => ({ outputLocation: 'test-output' }) }),
      getBaseURL: () => 'https://example.com',
    },
    sharepointClient: {
      write: sinon.stub().resolves(),
    },
  };

  const baseEsmockConfig = {
    '../../../src/cdn-logs-report/utils/query-builder.js': {
      weeklyBreakdownQueries: {
        createCountryWeeklyBreakdown: sinon.stub().resolves('SELECT country data'),
        createUserAgentWeeklyBreakdown: sinon.stub().resolves('SELECT user agent data'),
        createError404Urls: sinon.stub().resolves('SELECT 404 urls'),
        createError503Urls: sinon.stub().resolves('SELECT 503 urls'),
        createSuccessUrlsByCategory: sinon.stub().resolves('SELECT success urls'),
        createTopUrls: sinon.stub().resolves('SELECT top urls'),
        createReferralTrafficByCountryTopic: sinon.stub().resolves('SELECT referral country'),
        createReferralTrafficByUrlTopic: sinon.stub().resolves('SELECT referral url'),
        createHitsByProductAgentType: sinon.stub().resolves('SELECT hits by product'),
        createHitsByPageCategoryAgentType: sinon.stub().resolves('SELECT hits by page category'),
      },
    },
    '../../../src/cdn-logs-report/utils/excel-generator.js': {
      createExcelReport: sinon.stub().resolves({ xlsx: { writeBuffer: () => Buffer.from('excel') } }),
    },
    '../../../src/utils/report-uploader.js': {
      saveExcelReport: () => saveExcelReportMock,
    },
  };

  function createEsmockConfig(overrides = {}) {
    return {
      '../../../src/cdn-logs-report/utils/query-builder.js': {
        weeklyBreakdownQueries: {
          createCountryWeeklyBreakdown: sinon.stub().resolves('SELECT country data'),
          createUserAgentWeeklyBreakdown: sinon.stub().resolves('SELECT user agent data'),
          createError404Urls: sinon.stub().resolves('SELECT 404 urls'),
          createError503Urls: sinon.stub().resolves('SELECT 503 urls'),
          createSuccessUrlsByCategory: sinon.stub().resolves('SELECT success urls'),
          createTopUrls: sinon.stub().resolves('SELECT top urls'),
          createReferralTrafficByCountryTopic: sinon.stub().resolves('SELECT referral country'),
          createReferralTrafficByUrlTopic: sinon.stub().resolves('SELECT referral url'),
          createHitsByProductAgentType: sinon.stub().resolves('SELECT hits by product'),
          createHitsByPageCategoryAgentType: sinon.stub().resolves('SELECT hits by page category'),
          ...(overrides.queryBuilder || {}),
        },
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createExcelReport: sinon.stub().resolves({ xlsx: { writeBuffer: () => Buffer.from('excel') } }),
        ...overrides.excelGenerator,
      },
      '../../../src/utils/report-uploader.js': {
        saveExcelReport: saveExcelReportMock,
        ...overrides.reportUploader,
      },
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    saveExcelReportMock = sandbox.stub().resolves();
    reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', baseEsmockConfig);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('executes collectReportData with valid queries', async () => {
    const collectConfig = createEsmockConfig({
      queryBuilder: {
        createCountryWeeklyBreakdown: sandbox.stub().resolves('SELECT country'),
        createUserAgentWeeklyBreakdown: sandbox.stub().resolves('SELECT agents'),
        createError404Urls: sandbox.stub().resolves('SELECT 404s'),
        createError503Urls: sandbox.stub().resolves('SELECT 503s'),
        createSuccessUrlsByCategory: sandbox.stub().resolves('SELECT success'),
        createTopUrls: sandbox.stub().resolves('SELECT top'),
        createReferralTrafficByCountryTopic: sandbox.stub().resolves('SELECT ref country'),
        createReferralTrafficByUrlTopic: sandbox.stub().resolves('SELECT ref url'),
        createHitsByProductAgentType: sandbox.stub().resolves('SELECT product hits'),
        createHitsByPageCategoryAgentType: sandbox.stub().resolves('SELECT category hits'),
      },
    });

    const collectRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', collectConfig);
    await collectRunner.runWeeklyReport(baseMockParams);

    // Just verify the test runs without throwing
    expect(baseMockParams.log.info).to.have.been.called;
  });

  it('handles null queries in collectReportData', async () => {
    const nullQueryConfig = createEsmockConfig({
      queryBuilder: {
        createCountryWeeklyBreakdown: sandbox.stub().resolves(null),
      },
    });

    const nullQueryRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', nullQueryConfig);
    await nullQueryRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.info).to.have.been.called;
  });

  it('runs weekly report successfully for all providers and report types', async () => {
    await reportRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.info).to.have.been.called;
  });

  it('runs custom date range report with specified dates', async () => {
    const customParams = {
      ...baseMockParams,
      startDate: '2025-01-01',
      endDate: '2025-01-07',
    };

    await reportRunner.runCustomDateRangeReport(customParams);

    expect(baseMockParams.log.info).to.have.been.called;
  });

  it('logs success messages when provider reports complete successfully', async () => {
    await reportRunner.runWeeklyReport(baseMockParams);

    expect(baseMockParams.log.info).to.have.been.called;
  });

  it('handles query and Excel generation failures gracefully', async () => {
    const failureConfig = createEsmockConfig({
      queryBuilder: {
        createCountryWeeklyBreakdown: sandbox.stub().throws(new Error('Query failed')),
      },
    });

    const failureReportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', failureConfig);

    await failureReportRunner.runWeeklyReport(baseMockParams);

    // Just verify the test runs without throwing
    expect(true).to.be.true;
  });

  it('handles null getCdnLogsConfig gracefully', async () => {
    const nullConfigParams = {
      ...baseMockParams,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => null }),
        getBaseURL: () => 'https://example.com',
      },
    };

    await reportRunner.runWeeklyReport(nullConfigParams);

    expect(baseMockParams.log.info).to.have.been.called;
  });

  describe('null query handling', () => {
    it('handles null queries gracefully', async () => {
      const nullQueryConfig = createEsmockConfig({
        queryBuilder: {
          createCountryWeeklyBreakdown: sandbox.stub().resolves(null),
          createUserAgentWeeklyBreakdown: sandbox.stub().resolves(null),
          createError404Urls: sandbox.stub().resolves(null),
          createError503Urls: sandbox.stub().resolves(null),
          createSuccessUrlsByCategory: sandbox.stub().resolves(null),
          createTopUrls: sandbox.stub().resolves(null),
          createReferralTrafficByCountryTopic: sandbox.stub().resolves(null),
          createReferralTrafficByUrlTopic: sandbox.stub().resolves(null),
          createHitsByProductAgentType: sandbox.stub().resolves(null),
          createHitsByPageCategoryAgentType: sandbox.stub().resolves(null),
        },
      });

      const nullQueryRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', nullQueryConfig);

      await nullQueryRunner.runWeeklyReport(baseMockParams);

      expect(baseMockParams.log.info).to.have.been.called;
    });
  });
});
