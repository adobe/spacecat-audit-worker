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
import nock from 'nock';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

let runCdnLogsReport;

describe('CDN Logs Report Audit', () => {
  let context;
  const site = {
    getId: () => 'test-site',
    getBaseURL: () => 'https://example.com',
  };

  const mockGetS3Config = sandbox.stub().returns({
    databaseName: 'test_db',
    tableName: 'test_table',
    customerName: 'test_customer',
    getAthenaTempLocation: () => 's3://temp-location',
  });

  const mockLoadSql = sandbox.stub().resolves('CREATE DATABASE test_db');
  const mockEnsureTableExists = sandbox.stub().resolves();
  const mockAthenaExecute = sandbox.stub().resolves();
  const mockRunWeeklyReport = sandbox.stub().resolves();
  const mockRunCustomDateRangeReport = sandbox.stub().resolves();
  const mockHelixWrite = sandbox.stub();

  beforeEach(async () => {
    sandbox.reset();

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        runtime: { name: 'aws-lambda', region: 'us-east-1' },
        func: { package: 'spacecat-services', version: 'ci', name: 'test' },
        message: {},
        athenaClient: {
          execute: mockAthenaExecute,
        },
        helixContent: {
          write: mockHelixWrite,
        },
      })
      .build();

    mockGetS3Config.returns({
      databaseName: 'test_db',
      tableName: 'test_table',
      customerName: 'test_customer',
      getAthenaTempLocation: () => 's3://temp-location',
    });

    const handlerModule = await esmock('../../../src/cdn-logs-report/handler.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        getS3Config: mockGetS3Config,
        loadSql: mockLoadSql,
        ensureTableExists: mockEnsureTableExists,
      },
      '../../../src/utils/athena-client.js': {
        AWSAthenaClient: {
          fromContext: () => ({
            execute: mockAthenaExecute,
          }),
        },
      },
      '../../../src/cdn-logs-report/utils/report-runner.js': {
        runWeeklyReport: mockRunWeeklyReport,
        runCustomDateRangeReport: mockRunCustomDateRangeReport,
      },
      '@adobe/spacecat-helix-content-sdk': {
        createFrom: sandbox.stub().resolves({
          write: mockHelixWrite,
        }),
      },
    });

    runCdnLogsReport = handlerModule.default.runner;
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  it('runs weekly CDN logs report', async () => {
    const result = await runCdnLogsReport('https://example.com', context, site);

    expect(context.log.info).to.have.been.calledWith('Running weekly report...');
    expect(result.auditResult.reportType).to.equal('cdn-report-weekly');
    expect(result.auditResult.database).to.equal('test_db');
    expect(result.auditResult.customer).to.equal('test_customer');
    expect(result.fullAuditRef).to.include('test_customer');
  });

  it('runs custom date range CDN logs report', async () => {
    context.message = {
      type: 'runCustomDateRange',
      startDate: '2025-06-01',
      endDate: '2025-06-07',
    };

    const result = await runCdnLogsReport('https://example.com', context, site);

    expect(context.log.info).to.have.been.calledWith('Running custom report: 2025-06-01 to 2025-06-07');
    expect(result.auditResult.reportType).to.equal('custom');
    expect(result.auditResult.dateRange).to.deep.equal({
      startDate: '2025-06-01',
      endDate: '2025-06-07',
    });
  });

  it('throws error when custom report is missing dates', async () => {
    context.message = {
      type: 'runCustomDateRange',
    };

    try {
      await runCdnLogsReport('https://example.com', context, site);
    } catch (err) {
      expect(err.message).to.include('Custom date range requires startDate and endDate in message');
    }
  });
});
