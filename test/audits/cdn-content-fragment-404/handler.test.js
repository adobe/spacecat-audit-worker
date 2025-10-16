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
import chaiAsPromised from 'chai-as-promised';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('CDN 404 Analysis Handler', () => {
  let sandbox;
  let context;
  let site;
  let handlerModule;
  let athenaClientStub;
  let getStaticContentStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    const fixedDate = new Date('2025-09-18T14:00:00.000Z');
    sandbox.stub(Date, 'now').returns(fixedDate.getTime());
    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
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
        s3Client: { send: sandbox.stub() },
        rawBucket: 'test-raw-bucket',
        imsOrg: '1234567890',
      })
      .build();
    athenaClientStub = {
      execute: sandbox.stub().resolves(),
    };
    getStaticContentStub = sandbox.stub().resolves('SELECT 1;');
    handlerModule = await esmock('../../../src/cdn-content-fragment-404/handler.js', {
      '@adobe/spacecat-shared-athena-client': { AWSAthenaClient: { fromContext: () => athenaClientStub } },
      '@adobe/spacecat-shared-utils': { getStaticContent: getStaticContentStub },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs the full cdnContentFragment404Runner flow', async () => {
    const result = await handlerModule.cdnContentFragment404Runner(context, site);

    expect(getStaticContentStub).to.have.been.calledThrice;
    expect(athenaClientStub.execute).to.have.been.calledThrice;
    expect(result).to.have.property('auditResult');
    expect(result).to.have.property('fullAuditRef');
    expect(result.auditResult).to.include.keys('database', 'rawTable', 'completedAt');
    expect(result.auditResult.database).to.equal('cdn_logs_example_com');
    expect(result.auditResult.rawTable).to.equal('raw_logs_status_example_com');
    expect(result.fullAuditRef).to.equal('s3://test-raw-bucket/1234567890/aggregated-404/2025/09/18/13/');
  });

  it('correctly extracts and escapes customer domain', async () => {
    site.getBaseURL.returns('https://test-site.com');

    const result = await handlerModule.cdnContentFragment404Runner(context, site);

    expect(result.auditResult.database).to.equal('cdn_logs_test_site_com');
    expect(result.auditResult.rawTable).to.equal('raw_logs_status_test_site_com');
  });

  it('generates correct S3 paths with IMS org', async () => {
    const result = await handlerModule.cdnContentFragment404Runner(context, site);

    // Verify the output path includes the IMS org
    expect(result.fullAuditRef).to.include('test-raw-bucket/1234567890/aggregated-404/');

    // Verify SQL calls were made with correct parameters
    expect(getStaticContentStub.firstCall.args[0]).to.have.property('database', 'cdn_logs_example_com');
    expect(getStaticContentStub.secondCall.args[0]).to.have.property('rawLocation', 's3://test-raw-bucket/1234567890/raw/aem-cs-fastly');
    expect(getStaticContentStub.thirdCall.args[0]).to.have.property('output').that.includes('test-raw-bucket/1234567890/aggregated-404/');
  });

  it('uses correct time partitioning for previous hour', async () => {
    // Mock Date.now to return a specific time
    const mockTime = new Date('2025-01-15T14:30:00Z').getTime();
    const originalDateNow = Date.now;
    Date.now = sandbox.stub().returns(mockTime);

    try {
      await handlerModule.cdnContentFragment404Runner(context, site);

      // Should use the previous hour (13:00)
      const unloadCall = getStaticContentStub.thirdCall.args[0];
      expect(unloadCall).to.have.property('year', '2025');
      expect(unloadCall).to.have.property('month', '01');
      expect(unloadCall).to.have.property('day', '15');
      expect(unloadCall).to.have.property('hour', '13');
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('handles hour boundary correctly (previous day)', async () => {
    // Mock Date.now to return midnight
    const mockTime = new Date('2025-01-15T00:30:00Z').getTime();
    const originalDateNow = Date.now;
    Date.now = sandbox.stub().returns(mockTime);

    try {
      await handlerModule.cdnContentFragment404Runner(context, site);

      // Should use the previous hour (23:00 of previous day)
      const unloadCall = getStaticContentStub.thirdCall.args[0];
      expect(unloadCall).to.have.property('year', '2025');
      expect(unloadCall).to.have.property('month', '01');
      expect(unloadCall).to.have.property('day', '14');
      expect(unloadCall).to.have.property('hour', '23');
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('returns completedAt timestamp in ISO format', async () => {
    const beforeTime = new Date();
    const result = await handlerModule.cdnContentFragment404Runner(context, site);
    const afterTime = new Date();

    expect(result.auditResult.completedAt).to.be.a('string');
    const completedAtDate = new Date(result.auditResult.completedAt);
    expect(completedAtDate).to.be.at.least(beforeTime);
    expect(completedAtDate).to.be.at.most(afterTime);
  });

  it('calls athena client with correct descriptions', async () => {
    await handlerModule.cdnContentFragment404Runner(context, site);

    expect(athenaClientStub.execute.firstCall.args[2]).to.equal('[Athena Query] Create database cdn_logs_example_com');
    expect(athenaClientStub.execute.secondCall.args[2]).to.equal('[Athena Query] Create raw logs table cdn_logs_example_com.raw_logs_status_example_com from s3://test-raw-bucket/1234567890/raw/aem-cs-fastly');
    expect(athenaClientStub.execute.thirdCall.args[2]).to.include('[Athena Query] Unload 404 content data to s3://test-raw-bucket/1234567890/aggregated-404/');
  });

  it('loads correct SQL files with proper variables', async () => {
    await handlerModule.cdnContentFragment404Runner(context, site);

    expect(getStaticContentStub.firstCall.args[1]).to.equal('./src/cdn-content-fragment-404/sql/create-database.sql');
    expect(getStaticContentStub.secondCall.args[1]).to.equal('./src/cdn-content-fragment-404/sql/create-raw-table.sql');
    expect(getStaticContentStub.thirdCall.args[1]).to.equal('./src/cdn-content-fragment-404/sql/unload-404-content.sql');
  });

  it('throws if getStaticContent throws on database creation', async () => {
    getStaticContentStub.onFirstCall().rejects(new Error('SQL load error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('SQL load error');
  });

  it('throws if getStaticContent throws on table creation', async () => {
    getStaticContentStub.onSecondCall().rejects(new Error('Table SQL load error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('Table SQL load error');
  });

  it('throws if getStaticContent throws on unload query', async () => {
    getStaticContentStub.onThirdCall().rejects(new Error('Unload SQL load error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('Unload SQL load error');
  });

  it('throws if athenaClient.execute throws on database creation', async () => {
    athenaClientStub.execute.onFirstCall().rejects(new Error('Database creation error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('Database creation error');
  });

  it('throws if athenaClient.execute throws on table creation', async () => {
    athenaClientStub.execute.onSecondCall().rejects(new Error('Table creation error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('Table creation error');
  });

  it('throws if athenaClient.execute throws on unload operation', async () => {
    athenaClientStub.execute.onThirdCall().rejects(new Error('Unload operation error'));

    await expect(
      handlerModule.cdnContentFragment404Runner(context, site),
    ).to.be.rejectedWith('Unload operation error');
  });

  it('throws if rawBucket is undefined in context', async () => {
    const contextWithoutRawBucket = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: { send: sandbox.stub() },
        rawBucket: undefined,
        imsOrg: '1234567890',
      })
      .build();

    await expect(
      handlerModule.cdnContentFragment404Runner(contextWithoutRawBucket, site),
    ).to.be.rejectedWith('Raw bucket is required');
  });

  it('throws if imsOrg is undefined in context', async () => {
    const contextWithoutImsOrg = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        s3Client: { send: sandbox.stub() },
        rawBucket: 'test-raw-bucket',
        imsOrg: undefined,
      })
      .build();

    await expect(
      handlerModule.cdnContentFragment404Runner(contextWithoutImsOrg, site),
    ).to.be.rejectedWith('IMS organization is required');
  });
});
