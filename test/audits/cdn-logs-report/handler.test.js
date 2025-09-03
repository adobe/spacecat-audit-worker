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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);

describe('CDN Logs Report Handler', async function test() {
  this.timeout(5000);
  let sandbox;
  let context;
  let site;
  let runCdnLogsReport;
  let mockGetS3Config;
  let mockLoadSql;
  let mockEnsureTableExists;
  let mockAthenaExecute;
  let mockRunWeeklyReport;
  let mockCreateLLMOSharepointClient;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    site = {
      getId: () => 'test-site',
      getBaseURL: () => 'https://example.com',
      getOrganizationId: () => 'org-123',
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
        getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        getCdnLogsConfig: () => null,
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: {
          send: sandbox.stub().resolves(),
        },
        dataAccess: {
          Organization: {
            findById: sandbox.stub().resolves({
              getImsOrgId: () => 'ims-org-id',
            }),
          },
        },
      })
      .build();

    mockGetS3Config = sandbox.stub().resolves({
      bucket: 'test-bucket',
      databaseName: 'test_db',
      customerName: 'test_customer',
      getAthenaTempLocation: () => 's3://temp-location',
    });

    mockLoadSql = sandbox.stub().resolves('CREATE DATABASE test_db');
    mockEnsureTableExists = sandbox.stub().resolves();
    mockAthenaExecute = sandbox.stub().resolves();
    mockRunWeeklyReport = sandbox.stub().resolves();
    mockCreateLLMOSharepointClient = sandbox.stub().resolves({});

    const handlerModule = await esmock('../../../src/cdn-logs-report/handler.js', {
      '../../../src/cdn-logs-report/utils/report-utils.js': {
        getS3Config: mockGetS3Config,
        loadSql: mockLoadSql,
        ensureTableExists: mockEnsureTableExists,
      },
      '@adobe/spacecat-shared-athena-client': {
        AWSAthenaClient: {
          fromContext: () => ({
            execute: mockAthenaExecute,
          }),
        },
      },
      '../../../src/cdn-logs-report/utils/report-runner.js': {
        runWeeklyReport: mockRunWeeklyReport,
      },
      '../../../src/utils/report-uploader.js': {
        createLLMOSharepointClient: mockCreateLLMOSharepointClient,
      },
      '../../../src/utils/data-access.js': {
        getImsOrgId: () => Promise.resolve('ims-org-id'),
      },
    });

    runCdnLogsReport = handlerModule.default.runner;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs CDN logs report successfully', async () => {
    const result = await runCdnLogsReport('https://example.com', context, site);

    expect(mockGetS3Config).to.have.been.calledWith(site, context);
    expect(mockCreateLLMOSharepointClient).to.have.been.calledWith(context);
    expect(mockLoadSql).to.have.been.calledWith('create-database', { database: 'test_db' });
    expect(mockAthenaExecute).to.have.been.callCount(1);
    expect(mockEnsureTableExists).to.have.been.callCount(2);
    expect(mockRunWeeklyReport).to.have.been.callCount(2);
    expect(context.log.info).to.have.been.calledWith('Starting CDN logs report audit for https://example.com');
    expect(context.log.info).to.have.been.calledWith('Running weekly report: agentic...');
    expect(context.log.info).to.have.been.calledWith('Running weekly report: referral...');

    expect(result.auditResult).to.deep.equal([{
      customer: 'test_customer',
      database: 'test_db',
      name: 'agentic',
      table: 'aggregated_logs_undefined',
    }, {
      customer: 'test_customer',
      database: 'test_db',
      name: 'referral',
      table: 'aggregated_referral_logs_undefined',
    }]);
    expect(result.fullAuditRef).to.equal('test-folder');
  });

  it('handles no CDN bucket found', async () => {
    mockGetS3Config.resolves(null);

    const result = await runCdnLogsReport('https://example.com', context, site);

    expect(result.auditResult).to.have.property('success', false);
    expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
    expect(result.auditResult).to.have.property('completedAt');
    expect(result.auditResult.completedAt).to.be.a('string');
    expect(result.fullAuditRef).to.equal('https://example.com');
  });

  it('handles missing bucket in S3 config', async () => {
    mockGetS3Config.resolves({ bucket: null });

    const result = await runCdnLogsReport('https://example.com', context, site);

    expect(result.auditResult).to.have.property('success', false);
    expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
    expect(result.auditResult).to.have.property('completedAt');
    expect(result.auditResult.completedAt).to.be.a('string');
  });

  it('passes weekOffset to runWeeklyReport', async () => {
    const auditContext = { weekOffset: -2 };

    await runCdnLogsReport('https://example.com', context, site, auditContext);

    expect(mockRunWeeklyReport).to.have.been.calledWith({
      athenaClient: sinon.match.object,
      s3Config: sinon.match.object,
      reportConfig: sinon.match.has('name', 'agentic'),
      log: context.log,
      site,
      sharepointClient: sinon.match.object,
      weekOffset: -2,
    });

    expect(mockRunWeeklyReport).to.have.been.calledWith({
      athenaClient: sinon.match.object,
      s3Config: sinon.match.object,
      reportConfig: sinon.match.has('name', 'referral'),
      log: context.log,
      site,
      sharepointClient: sinon.match.object,
      weekOffset: -2,
    });
  });

  it('uses default weekOffset when not provided', async () => {
    await runCdnLogsReport('https://example.com', context, site);

    expect(mockRunWeeklyReport).to.have.been.calledWithMatch({
      athenaClient: sinon.match.object,
      s3Config: sinon.match.object,
      reportConfig: sinon.match.has('name', 'agentic'),
      log: context.log,
      site,
      sharepointClient: sinon.match.object,
      weekOffset: -1,
    });

    expect(mockRunWeeklyReport).to.have.been.calledWithMatch({
      athenaClient: sinon.match.object,
      s3Config: sinon.match.object,
      reportConfig: sinon.match.has('name', 'referral'),
      log: context.log,
      site,
      sharepointClient: sinon.match.object,
      weekOffset: -1,
    });
  });
});
