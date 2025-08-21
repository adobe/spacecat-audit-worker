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

describe('CDN Analysis Handler', () => {
  let sandbox;
  let context;
  let site;
  let handlerModule;
  let athenaClientStub;
  let getStaticContentStub;
  let resolveCdnBucketNameStub;
  let discoverCdnProvidersStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
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
      })
      .build();
    athenaClientStub = {
      execute: sandbox.stub().resolves(),
    };
    getStaticContentStub = sandbox.stub().resolves('SELECT 1;');
    resolveCdnBucketNameStub = sandbox.stub().resolves('test-bucket');
    discoverCdnProvidersStub = sandbox.stub().resolves(['fastly']);

    handlerModule = await esmock('../../../src/cdn-analysis/handler.js', {
      '@adobe/spacecat-shared-athena-client': { AWSAthenaClient: { fromContext: () => athenaClientStub } },
      '@adobe/spacecat-shared-utils': { getStaticContent: getStaticContentStub },
      '../../../src/utils/cdn-utils.js': {
        resolveCdnBucketName: resolveCdnBucketNameStub,
        extractCustomerDomain: () => 'example_com',
        isLegacyBucket: () => false,
        discoverCdnProviders: discoverCdnProvidersStub,
        buildCdnPaths: () => ({
          rawLocation: 's3://test-bucket/raw/fastly/',
          aggregatedOutput: 's3://test-bucket/aggregated/2025/01/15/10/',
          tempLocation: 's3://test-bucket/temp/athena-results/',
        }),
      },
      '../../../src/common/base-audit.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs the full cdnLogAnalysisRunner flow', async () => {
    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(resolveCdnBucketNameStub).to.have.been.calledOnce;
    expect(discoverCdnProvidersStub).to.have.been.calledOnce;
    expect(getStaticContentStub).to.have.been.calledThrice;
    expect(athenaClientStub.execute).to.have.been.calledThrice;
    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.include.keys('database', 'providers', 'completedAt');
    expect(result.auditResult.database).to.equal('cdn_logs_example_com');
    expect(result.auditResult.providers).to.have.length(1);
    expect(result.auditResult.providers[0]).to.have.property('cdnType', 'fastly');
  });

  it('handles multiple CDN providers', async () => {
    discoverCdnProvidersStub.resolves(['fastly', 'akamai']);

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(result.auditResult.providers).to.have.length(2);
    expect(athenaClientStub.execute).to.have.been.callCount(5);
  });

  it('returns error when no bucket found', async () => {
    resolveCdnBucketNameStub.resolves(null);

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
    expect(result.fullAuditRef).to.be.null;
  });

  it('handles athena execution errors', async () => {
    athenaClientStub.execute.onFirstCall().rejects(new Error('Athena error'));

    await expect(
      handlerModule.cdnLogAnalysisRunner('https://example.com', context, site),
    ).to.be.rejectedWith('Athena error');
  });

  it('handles SQL loading errors', async () => {
    getStaticContentStub.onFirstCall().rejects(new Error('SQL load error'));

    await expect(
      handlerModule.cdnLogAnalysisRunner('https://example.com', context, site),
    ).to.be.rejectedWith('SQL load error');
  });
});
