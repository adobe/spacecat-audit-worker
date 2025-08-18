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
  let mockAthenaClient;
  let mockS3Config;
  let mockLog;
  let mockSite;
  let mockSharepointClient;
  let mockSaveExcelReport;
  let mockCreateExcelReport;
  let mockReportUtils;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAthenaClient = {
      query: sandbox.stub().resolves([{ test: 'data' }]),
    };

    mockS3Config = {
      databaseName: 'test_db',
      tableName: 'test_table',
      customerName: 'test_customer',
    };

    mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    mockSite = {
      getBaseURL: sandbox.stub().returns('https://test.com'),
      getConfig: sandbox.stub().returns({
        getCdnLogsConfig: () => ({ filters: [{ key: 'test', value: 'filter' }] }),
        getLlmoDataFolder: () => 'test-folder',
        getGroupedURLs: () => [
          { name: 'home', pattern: '^/$' },
          { name: 'product', pattern: '/products/.+' },
        ],
      }),
    };

    mockSharepointClient = {};

    mockSaveExcelReport = sandbox.stub().resolves();
    mockCreateExcelReport = sandbox.stub().resolves({ worksheets: [] });

    mockReportUtils = {
      createDateRange: sandbox.stub().returns({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-07'),
      }),
      generatePeriodIdentifier: sandbox.stub().returns('2025-W01'),
      generateReportingPeriods: sandbox.stub().returns({
        weeks: [{
          startDate: new Date('2025-01-01'),
          endDate: new Date('2025-01-07'),
          weekLabel: 'Week 1',
        }],
      }),
      buildSiteFilters: sandbox.stub().returns([]),
    };

    reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': mockReportUtils,
      '../../../src/utils/report-uploader.js': {
        saveExcelReport: mockSaveExcelReport,
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createExcelReport: mockCreateExcelReport,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runReport', () => {
    it('runs report with default parameters', async () => {
      const options = {
        provider: 'chatgpt',
        site: mockSite,
        sharepointClient: mockSharepointClient,
      };

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, options);

      expect(mockLog.info).to.have.been.calledWith('Running agentic report for chatgpt for 2025-W01');
      expect(mockCreateExcelReport).to.have.been.called;
      expect(mockSaveExcelReport).to.have.been.called;
    });

    it('handles query execution errors gracefully', async () => {
      mockAthenaClient.query.rejects(new Error('Query failed'));

      const options = {
        provider: 'chatgpt',
        site: mockSite,
        sharepointClient: mockSharepointClient,
      };

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, options);

      expect(mockLog.error).to.have.been.called;
    });

    it('handles site config without filters', async () => {
      mockSite.getConfig.returns({
        getCdnLogsConfig: () => null,
        getLlmoDataFolder: () => null,
        getGroupedURLs: () => [],
      });

      const options = {
        provider: 'chatgpt',
        site: mockSite,
        sharepointClient: mockSharepointClient,
      };

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, options);

      expect(mockReportUtils.buildSiteFilters).to.have.been.calledWith(undefined);
    });

    it('throws error when report generation fails', async () => {
      mockCreateExcelReport.rejects(new Error('Excel creation failed'));

      const options = {
        provider: 'chatgpt',
        site: mockSite,
        sharepointClient: mockSharepointClient,
      };

      await expect(reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, options))
        .to.be.rejectedWith('Excel creation failed');
      expect(mockLog.error).to.have.been.calledWith('agentic report generation failed: Excel creation failed');
    });
  });

  describe('runReportsForAllProviders', () => {
    it('runs reports for all configured providers', async () => {
      const options = {
        site: mockSite,
        sharepointClient: mockSharepointClient,
        reportType: 'agentic',
      };

      await reportRunner.runReportsForAllProviders(
        mockAthenaClient,
        mockS3Config,
        mockLog,
        options,
      );

      expect(mockLog.info).to.have.been.calledWith('Generating agentic reports for providers: chatgpt, perplexity');
      expect(mockLog.info).to.have.been.calledWith('Starting agentic report generation for chatgpt...');
      expect(mockLog.info).to.have.been.calledWith('Successfully generated agentic chatgpt report');
    });

    it('handles individual provider failures gracefully', async () => {
      mockCreateExcelReport.onFirstCall().rejects(new Error('Provider failed'));

      const options = {
        site: mockSite,
        sharepointClient: mockSharepointClient,
        reportType: 'agentic',
      };

      await reportRunner.runReportsForAllProviders(
        mockAthenaClient,
        mockS3Config,
        mockLog,
        options,
      );

      expect(mockLog.error).to.have.been.calledWith('Failed to generate agentic chatgpt report: Provider failed');
      expect(mockLog.info).to.have.been.calledWith('Successfully generated agentic perplexity report');
    });
  });

  describe('runWeeklyReport', () => {
    it('runs weekly reports for all report types', async () => {
      await reportRunner.runWeeklyReport({
        athenaClient: mockAthenaClient,
        s3Config: mockS3Config,
        log: mockLog,
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockLog.info).to.have.been.calledWith('Starting weekly agentic reports...');
      expect(mockLog.info).to.have.been.calledWith('Successfully completed weekly agentic reports');
    });

    it('handles report type failures gracefully', async () => {
      mockCreateExcelReport.rejects(new Error('Weekly report failed'));

      await reportRunner.runWeeklyReport({
        athenaClient: mockAthenaClient,
        s3Config: mockS3Config,
        log: mockLog,
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockLog.error).to.have.been.calledWith('agentic report generation failed: Weekly report failed');
    });
  });
});
