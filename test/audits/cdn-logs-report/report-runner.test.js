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

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockAthenaClient = {
      query: sandbox.stub().resolves([{ agent_type: 'Chatbots', number_of_hits: 100 }]),
    };

    mockS3Config = {
      customerName: 'test-customer',
      databaseName: 'test_db',
      tableName: 'test_table',
    };

    mockLog = {
      info: sandbox.stub(),
      error: sandbox.stub(),
    };

    mockSite = {
      getConfig: sandbox.stub().returns({
        getCdnLogsConfig: () => ({ filters: [] }),
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    mockSharepointClient = {};

    reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', {
      '../../../src/utils/report-uploader.js': {
        saveExcelReport: sandbox.stub().resolves(),
      },
      '../../../src/cdn-logs-report/utils/excel-generator.js': {
        createExcelReport: sandbox.stub().resolves('mock-workbook'),
      },
      '../../../src/cdn-logs-report/constants/report-configs.js': {
        AGENTIC_REPORT_CONFIG: {
          filePrefix: 'agentictraffic',
          folderSuffix: 'agentic-traffic',
          workbookCreator: 'Test Creator',
          sheetName: 'shared-all',
          queryFunction: sandbox.stub().resolves('SELECT * FROM test'),
        },
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('runReport', () => {
    it('runs agentic report with default week offset', async () => {
      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.called;
    });

    it('runs report with custom week offset', async () => {
      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
        weekOffset: -2,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/week offset: -2/),
      );
    });

    it('processes complete report generation flow', async () => {
      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.called;
    });

    it('handles site config with filters', async () => {
      mockSite.getConfig.returns({
        getCdnLogsConfig: () => ({
          filters: [
            { key: 'url', value: ['test'], type: 'include' },
            { key: 'url', value: ['prod'], type: 'include' },
          ],
        }),
        getLlmoDataFolder: () => 'custom-folder',
      });

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
    });

    it('handles missing CDN logs config gracefully', async () => {
      mockSite.getConfig.returns({
        getCdnLogsConfig: () => null,
        getLlmoDataFolder: () => undefined,
      });

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
    });

    it('handles missing getLlmoDataFolder function', async () => {
      mockSite.getConfig.returns({
        getCdnLogsConfig: () => ({ filters: [] }),
        getLlmoDataFolder: () => undefined,
      });

      await reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
    });

    it('handles query execution errors gracefully', async () => {
      mockAthenaClient.query.rejects(new Error('Query failed'));

      await expect(
        reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
          site: mockSite,
          sharepointClient: mockSharepointClient,
        }),
      ).to.be.rejectedWith('Query failed');

      expect(mockLog.error).to.have.been.called;
    });

    it('handles excel report creation errors', async () => {
      const errorStub = sandbox.stub().rejects(new Error('Excel creation failed'));
      reportRunner = await esmock('../../../src/cdn-logs-report/utils/report-runner.js', {
        '../../../src/utils/report-uploader.js': {
          saveExcelReport: sandbox.stub().resolves(),
        },
        '../../../src/cdn-logs-report/utils/excel-generator.js': {
          createExcelReport: errorStub,
        },
        '../../../src/cdn-logs-report/constants/report-configs.js': {
          AGENTIC_REPORT_CONFIG: {
            filePrefix: 'agentictraffic',
            folderSuffix: 'agentic-traffic',
            workbookCreator: 'Test Creator',
            sheetName: 'shared-all',
            queryFunction: sandbox.stub().resolves('SELECT * FROM test'),
          },
        },
      });

      await expect(
        reportRunner.runReport(mockAthenaClient, mockS3Config, mockLog, {
          site: mockSite,
          sharepointClient: mockSharepointClient,
        }),
      ).to.be.rejectedWith('Excel creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        sinon.match(/Agentic report generation failed/),
      );
    });
  });

  describe('runWeeklyReport', () => {
    it('runs weekly agentic report', async () => {
      await reportRunner.runWeeklyReport({
        athenaClient: mockAthenaClient,
        s3Config: mockS3Config,
        log: mockLog,
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockAthenaClient.query).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/Starting agentic report/),
      );
    });

    it('handles report failures gracefully', async () => {
      mockAthenaClient.query.rejects(new Error('Database error'));

      await reportRunner.runWeeklyReport({
        athenaClient: mockAthenaClient,
        s3Config: mockS3Config,
        log: mockLog,
        site: mockSite,
        sharepointClient: mockSharepointClient,
      });

      expect(mockLog.error).to.have.been.calledWith(
        sinon.match(/Failed to generate agentic report/),
      );
    });
  });
});
