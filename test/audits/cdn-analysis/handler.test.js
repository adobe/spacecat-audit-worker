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
  let getBucketInfoStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    site = {
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().returns({
        getLlmoCdnBucketConfig: () => null,
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
    resolveCdnBucketNameStub = sandbox.stub().resolves('test-bucket');
    discoverCdnProvidersStub = sandbox.stub().resolves(['fastly']);
    getBucketInfoStub = sandbox.stub().resolves({ isLegacy: false, providers: ['fastly'] });

    handlerModule = await esmock('../../../src/cdn-analysis/handler.js', {
      '@adobe/spacecat-shared-athena-client': { AWSAthenaClient: { fromContext: () => athenaClientStub } },
      '@adobe/spacecat-shared-utils': { getStaticContent: getStaticContentStub },
      '../../../src/utils/cdn-utils.js': {
        resolveCdnBucketName: resolveCdnBucketNameStub,
        extractCustomerDomain: () => 'example_com',
        getBucketInfo: getBucketInfoStub,
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
    expect(getBucketInfoStub).to.have.been.calledOnce;
    expect(getStaticContentStub).to.have.been.callCount(4);
    expect(athenaClientStub.execute).to.have.been.callCount(4);
    expect(result).to.have.property('auditResult');
    expect(result.auditResult).to.include.keys('database', 'providers', 'completedAt');
    expect(result.auditResult.database).to.equal('cdn_logs_example_com');
    expect(result.auditResult.providers).to.have.length(1);
    expect(result.auditResult.providers[0]).to.have.property('cdnType', 'fastly');
  });

  it('handles multiple CDN providers', async () => {
    getBucketInfoStub.resolves({ isLegacy: false, providers: ['fastly', 'akamai'] });

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(result.auditResult.providers).to.have.length(2);
    expect(athenaClientStub.execute).to.have.been.callCount(7);
  });

  it('falls back to discoverCdnProviders when getBucketInfo returns empty providers', async () => {
    getBucketInfoStub.resolves({ isLegacy: true, providers: [] });
    discoverCdnProvidersStub.resolves(['akamai']);

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(getBucketInfoStub).to.have.been.calledOnce;
    expect(discoverCdnProvidersStub).to.have.been.calledOnce;
    expect(result.auditResult.providers).to.have.length(1);
    expect(result.auditResult.providers[0]).to.have.property('cdnType', 'akamai');
  });

  it('returns error when no bucket found', async () => {
    resolveCdnBucketNameStub.resolves(null);

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(result.auditResult).to.have.property('error', 'No CDN bucket found');
    expect(result.fullAuditRef).to.equal('https://example.com');
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

  it('skips CloudFlare processing for non-23 hours but processes other CDNs', async () => {
    getBucketInfoStub.resolves({ isLegacy: false, providers: ['cloudflare', 'fastly'] });

    const originalDateNow = Date.now;
    const mockTime = new Date('2024-12-25T15:30:00Z').getTime();
    Date.now = sandbox.stub().returns(mockTime);

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site);

    expect(result.auditResult.providers).to.have.length(1);
    expect(result.auditResult.providers[0]).to.have.property('cdnType', 'fastly');

    Date.now = originalDateNow;
  });

  it('uses provided auditContext when valid and pads fields', async () => {
    const auditContext = {
      year: 2025, month: 1, day: 2, hour: 3,
    };

    await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));

    expect(unloadCall).to.exist;
    expect(unloadCall.args[0]).to.include({
      year: '2025',
      month: '01',
      day: '02',
      hour: '03',
    });
  });

  it('ignores invalid auditContext (non-integer) and falls back to previous UTC hour', async () => {
    const auditContext = {
      year: '2025', month: 1, day: 2, hour: 3,
    }; // invalid: year is string

    const originalDateNow = Date.now;
    // Now = 2025-03-10T08:15Z -> previous hour = 07
    Date.now = sandbox.stub().returns(new Date('2025-03-10T08:15:00Z').getTime());

    await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));

    expect(unloadCall).to.exist;
    expect(unloadCall.args[0]).to.include({
      year: '2025',
      month: '03',
      day: '10',
      hour: '07',
    });

    Date.now = originalDateNow;
  });

  it('fallback handles midnight rollover in UTC (prev day/month/year)', async () => {
    const originalDateNow = Date.now;
    // Now = 2025-01-01T00:05Z -> previous hour = 2024-12-31T23
    Date.now = sandbox.stub().returns(new Date('2025-01-01T00:05:00Z').getTime());

    await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site /* no auditContext */);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));

    expect(unloadCall).to.exist;
    expect(unloadCall.args[0]).to.include({
      year: '2024',
      month: '12',
      day: '31',
      hour: '23',
    });

    Date.now = originalDateNow;
  });

  it('skips CloudFlare when auditContext.hour !== "23"', async () => {
    getBucketInfoStub.resolves({ isLegacy: false, providers: ['cloudflare', 'fastly'] });
    const auditContext = {
      year: 2025, month: 6, day: 15, hour: 22,
    };

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    expect(result.auditResult.providers.map((p) => p.cdnType)).to.deep.equal(['fastly']);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));

    expect(unloadCall.args[0]).to.include({
      year: '2025',
      month: '06',
      day: '15',
      hour: '22',
    });
  });

  it('processes CloudFlare when auditContext.hour === "23"', async () => {
    getBucketInfoStub.resolves({ isLegacy: false, providers: ['cloudflare'] });
    const auditContext = {
      year: 2025, month: 6, day: 15, hour: 23,
    };

    const result = await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    expect(result.auditResult.providers).to.have.length(1);
    expect(result.auditResult.providers[0]).to.have.property('cdnType', 'cloudflare');
    expect(getStaticContentStub).to.have.been.callCount(4);
    expect(athenaClientStub.execute).to.have.been.callCount(4);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));

    expect(unloadCall.args[0]).to.include({
      year: '2025',
      month: '06',
      day: '15',
      hour: '23',
    });
  });

  it('passes hour parts from auditContext to discoverCdnProviders when legacy bucket', async () => {
    getBucketInfoStub.resolves({ isLegacy: true, providers: [] });
    discoverCdnProvidersStub.resolves(['fastly']);
    const auditContext = {
      year: 2025, month: 1, day: 2, hour: 3,
    };

    await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    expect(discoverCdnProvidersStub).to.have.been.calledWith(
      context.s3Client,
      'test-bucket',
      {
        year: '2025', month: '01', day: '02', hour: '03',
      },
    );
  });

  it('pads provided single-digit month/day/hour in auditContext in both unload queries', async () => {
    const auditContext = {
      year: 2025, month: 9, day: 7, hour: 4,
    };

    await handlerModule.cdnLogAnalysisRunner('https://example.com', context, site, auditContext);

    const unloadCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated.sql'));
    const unloadReferralCall = getStaticContentStub
      .getCalls()
      .find((c) => c.args[1].endsWith('/unload-aggregated-referral.sql'));

    expect(unloadCall.args[0]).to.include({
      year: '2025', month: '09', day: '07', hour: '04',
    });
    expect(unloadReferralCall.args[0]).to.include({
      year: '2025', month: '09', day: '07', hour: '04',
    });
  });
});
