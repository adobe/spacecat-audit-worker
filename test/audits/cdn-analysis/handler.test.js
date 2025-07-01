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
  let determineCdnProviderStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().returns({
        getCdnLogsConfig: sandbox.stub().returns({ bucketName: 'test-bucket' }),
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
        s3Client: { send: sandbox.stub() },
      })
      .build();
    athenaClientStub = {
      execute: sandbox.stub().resolves(),
    };
    getStaticContentStub = sandbox.stub().resolves('SELECT 1;');
    determineCdnProviderStub = sandbox.stub().resolves('akamai');
    handlerModule = await esmock('../../../src/cdn-analysis/handler.js', {
      '../../../src/utils/athena-client.js': { AWSAthenaClient: { fromContext: () => athenaClientStub } },
      '@adobe/spacecat-shared-utils': { getStaticContent: getStaticContentStub },
      '../../../src/cdn-analysis/utils/cdn-utils.js': { determineCdnProvider: determineCdnProviderStub },
      '../../../src/common/base-audit.js': { wwwUrlResolver: (siteObj) => siteObj.getBaseURL() },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('runs the full cdnLogAnalysisRunner flow', async () => {
    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);
    expect(determineCdnProviderStub).to.have.been.calledOnce;
    expect(getStaticContentStub).to.have.been.calledThrice;
    expect(athenaClientStub.execute).to.have.been.calledThrice;
    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.include.keys('cdnType', 'database', 'rawTable', 'output', 'completedAt');
    expect(result.auditResult.cdnType).to.equal('akamai');
    expect(context.log.info).to.have.been.calledWith('Using AKAMAI provider');
  });

  it('throws if determineCdnProvider throws', async () => {
    determineCdnProviderStub.rejects(new Error('S3 error'));
    await expect(handlerModule.cdnLogAnalysisRunner('https://example.com', context, site))
      .to.be.rejectedWith('S3 error');
  });

  it('uses default bucket name if getCdnLogsConfig returns undefined', async () => {
    site.getConfig = sandbox.stub()
      .returns({ getCdnLogsConfig: sandbox.stub().returns(undefined) });
    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);
    expect(result.auditResult.database).to.equal('cdn_logs_example_com');
    expect(determineCdnProviderStub).to.have.been.calledOnce;
    expect(getStaticContentStub).to.have.been.calledThrice;
    expect(athenaClientStub.execute).to.have.been.calledThrice;
  });

  it('uses fallback bucket name if site.getConfig is undefined', async () => {
    site.getConfig = () => ({ getCdnLogsConfig: () => undefined });
    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);
    expect(result.auditResult.database).to.equal('cdn_logs_example_com');
    expect(determineCdnProviderStub).to.have.been.calledOnce;
    expect(getStaticContentStub).to.have.been.calledThrice;
    expect(athenaClientStub.execute).to.have.been.calledThrice;
  });

  it('throws if athenaClient.execute throws', async () => {
    athenaClientStub.execute.onFirstCall().rejects(new Error('Athena error'));
    await expect(
      handlerModule.cdnLogAnalysisRunner('https://example.com', context, site),
    ).to.be.rejectedWith('Athena error');
  });

  it('throws if loadSql throws', async () => {
    getStaticContentStub.onFirstCall().rejects(new Error('SQL load error'));
    await expect(
      handlerModule.cdnLogAnalysisRunner('https://example.com', context, site),
    ).to.be.rejectedWith('SQL load error');
  });
});
