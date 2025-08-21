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

describe('Report Runner', () => {
  let sandbox;
  let reportRunner;
  let mockAthenaClient;
  let mockSaveExcelReport;
  let mockCreateExcelReport;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAthenaClient = {
      query: sandbox.stub().resolves([
        { url: '/test', visits: 100 },
        { url: '/page', visits: 50 },
      ]),
    };

    mockSaveExcelReport = sandbox.stub().resolves();
    mockCreateExcelReport = sandbox.stub().resolves({
      creator: 'test',
      addWorksheet: sandbox.stub(),
    });

    reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', {
      '../../../src/utils/report-uploader.js': {
        saveExcelReport: mockSaveExcelReport,
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createExcelReport: mockCreateExcelReport,
      },
      '../../../src/cdn-logs-report/constants/report-configs.js': {
        AGENTIC_REPORT_CONFIG: {
          folderSuffix: 'agentic-traffic',
          sheetName: 'Agentic Traffic',
          filePrefix: 'agentic-traffic-report',
          workbookCreator: 'SpaceCat',
          queryFunction: sandbox.stub().resolves('SELECT * FROM test'),
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runWeeklyReport', () => {
    it('runs weekly report successfully', async () => {
      const options = {
        athenaClient: mockAthenaClient,
        s3Config: {
          databaseName: 'test_db',
          tableName: 'test_table',
          customerName: 'test_customer',
        },
        log: { info: sandbox.spy(), error: sandbox.spy() },
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getLlmoCdnlogsFilter: () => [],
            getLlmoDataFolder: () => 'test-folder',

          }),
        },
        sharepointClient: {},
        weekOffset: -1,
      };

      await reportRunner.runWeeklyReport(options);

      expect(options.log.info).to.have.been.calledWith(sinon.match(/Running agentic report/));
      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(mockCreateExcelReport).to.have.been.calledOnce;
      expect(mockSaveExcelReport).to.have.been.calledOnce;
    });

    it('handles errors during report generation', async () => {
      const options = {
        athenaClient: mockAthenaClient,
        s3Config: {
          databaseName: 'test_db',
          tableName: 'test_table',
          customerName: 'test_customer',
        },
        log: { info: sandbox.spy(), error: sandbox.spy() },
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getLlmoCdnlogsFilter: () => [],
            getLlmoDataFolder: () => 'test-folder',

          }),
        },
        sharepointClient: {},
        weekOffset: -1,
      };

      mockAthenaClient.query.rejects(new Error('Query failed'));

      await reportRunner.runWeeklyReport(options);

      expect(options.log.error).to.have.been.calledWith(sinon.match(/Failed to generate agentic report/));
    });
  });

  describe('runReport', () => {
    it('runs report with custom options', async () => {
      const options = {
        athenaClient: mockAthenaClient,
        s3Config: {
          databaseName: 'test_db',
          tableName: 'test_table',
          customerName: 'test_customer',
        },
        log: { info: sandbox.spy(), error: sandbox.spy() },
        site: {
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getLlmoCdnlogsFilter: () => [],
            getLlmoDataFolder: () => 'test-folder',

          }),
        },
        sharepointClient: {},
        weekOffset: -2,
      };

      await reportRunner.runReport(mockAthenaClient, options.s3Config, options.log, options);

      expect(options.log.info).to.have.been.calledWith(sinon.match(/Running agentic report/));
      expect(mockAthenaClient.query).to.have.been.calledOnce;
    });
  });
});
