/*
 * Copyright 2026 Adobe. All rights reserved.
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
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

const SITE_ID = 'test-site-id';
const BASE_URL = 'https://www.example.com';

describe('rum-config-refresh handler', () => {
  let context;
  let mockSite;
  let mockConfig;
  let retrieveDomainkeyStub;
  let toDynamoItemStub;
  let handler;

  beforeEach(async () => {
    retrieveDomainkeyStub = sandbox.stub();
    toDynamoItemStub = sandbox.stub().returns({});

    handler = await esmock(
      '../../src/rum-config-refresh/handler.js',
      {
        '@adobe/spacecat-shared-rum-api-client': {
          default: {
            createFrom: () => ({ retrieveDomainkey: retrieveDomainkeyStub }),
          },
        },
        '@adobe/spacecat-shared-data-access/src/models/site/config.js': {
          Config: { toDynamoItem: toDynamoItemStub },
        },
      },
    );

    mockConfig = {
      getRumConfig: sandbox.stub().returns(undefined),
      updateRumConfig: sandbox.stub(),
      getFetchConfig: sandbox.stub().returns(undefined),
    };

    mockSite = {
      getBaseURL: sandbox.stub().returns(BASE_URL),
      getConfig: sandbox.stub().returns(mockConfig),
      setConfig: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Site.findById.resolves(mockSite);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('missing siteId', () => {
    it('returns ok with skipped=true when siteId is absent from message', async () => {
      const result = await handler.default({}, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'missing siteId' });
      expect(context.log.error).to.have.been.calledWithMatch('Missing siteId');
      expect(context.dataAccess.Site.findById).not.to.have.been.called;
    });
  });

  describe('site not found', () => {
    it('returns ok with skipped=true when site does not exist', async () => {
      context.dataAccess.Site.findById.resolves(null);

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'site not found' });
      expect(context.log.error).to.have.been.calledWithMatch('Site not found');
    });
  });

  describe('staleness check', () => {
    it('skips when rumConfig was checked within the last 7 days', async () => {
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      mockConfig.getRumConfig.returns({ hasDomainKey: true, lastCheckedAt: recentDate });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'recently checked' });
      expect(retrieveDomainkeyStub).not.to.have.been.called;
      expect(mockSite.save).not.to.have.been.called;
    });

    it('proceeds when rumConfig has no lastCheckedAt', async () => {
      mockConfig.getRumConfig.returns(undefined);
      retrieveDomainkeyStub.resolves('domainkey-value');

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
    });

    it('proceeds when lastCheckedAt is older than 7 days', async () => {
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      mockConfig.getRumConfig.returns({ hasDomainKey: false, lastCheckedAt: staleDate });
      retrieveDomainkeyStub.resolves('domainkey-value');

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
    });
  });

  describe('RUM domain key check', () => {
    it('sets hasDomainKey=true when retrieveDomainkey resolves', async () => {
      retrieveDomainkeyStub.resolves('domainkey-abc');

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(true);
      expect(toDynamoItemStub).to.have.been.calledWith(mockConfig);
      expect(mockSite.save).to.have.been.calledOnce;
    });

    it('sets hasDomainKey=false when retrieveDomainkey rejects', async () => {
      retrieveDomainkeyStub.rejects(new Error('no domain key found'));

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: false, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(false);
      expect(toDynamoItemStub).to.have.been.calledWith(mockConfig);
      expect(mockSite.save).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWithMatch('RUM check failed');
    });

    it('skips config update and does not write lastCheckedAt when RUM check times out', async () => {
      const clock = sinon.useFakeTimers();
      retrieveDomainkeyStub.returns(new Promise(() => {})); // never resolves

      const resultPromise = handler.default({ siteId: SITE_ID }, context);
      await clock.tickAsync(4000); // advance past the 3 s timeout
      const result = await resultPromise;
      clock.restore();

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'timeout' });
      expect(mockConfig.updateRumConfig).not.to.have.been.called;
      expect(mockSite.save).not.to.have.been.called;
      expect(context.log.error).to.have.been.calledWithMatch('timed out');
    });

    it('extracts hostname from baseURL before calling retrieveDomainkey', async () => {
      retrieveDomainkeyStub.resolves('domainkey-abc');

      await handler.default({ siteId: SITE_ID }, context);

      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.example.com');
    });

    it('tries overrideBaseURL first when fetchConfig.overrideBaseURL is set', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.override.com' });
      retrieveDomainkeyStub.resolves('domainkey-abc');

      const result = await handler.default({ siteId: SITE_ID }, context);

      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.override.com');
      expect(retrieveDomainkeyStub).not.to.have.been.calledWith('www.example.com');
    });

    it('falls back to baseURL when overrideBaseURL domain key lookup fails', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.override.com' });
      retrieveDomainkeyStub
        .withArgs('www.override.com').rejects(new Error('404'))
        .withArgs('www.example.com').resolves('domainkey-abc');

      const result = await handler.default({ siteId: SITE_ID }, context);

      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      sinon.assert.callOrder(
        retrieveDomainkeyStub.withArgs('www.override.com'),
        retrieveDomainkeyStub.withArgs('www.example.com'),
      );
      expect(context.log.info).to.have.been.calledWithMatch('RUM check failed for www.override.com');
    });

    it('falls back to baseURL only when overrideBaseURL is malformed', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'not-a-valid-url' });
      retrieveDomainkeyStub.resolves('domainkey-abc');

      const result = await handler.default({ siteId: SITE_ID }, context);

      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      expect(retrieveDomainkeyStub).to.have.been.calledOnce;
      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.example.com');
      expect(context.log.warn).to.have.been.calledWithMatch('Malformed overrideBaseURL');
    });

    it('skips when baseURL is malformed', async () => {
      mockSite.getBaseURL.returns('not-a-valid-url');

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'malformed baseURL' });
      expect(retrieveDomainkeyStub).not.to.have.been.called;
      expect(mockSite.save).not.to.have.been.called;
      expect(context.log.error).to.have.been.calledWithMatch('Malformed baseURL');
    });

    it('uses baseURL when fetchConfig is set but overrideBaseURL is absent', async () => {
      mockConfig.getFetchConfig.returns({ someOtherProp: 'value' });
      retrieveDomainkeyStub.resolves('domainkey-abc');

      const result = await handler.default({ siteId: SITE_ID }, context);

      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      expect(retrieveDomainkeyStub).to.have.been.calledOnce;
      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.example.com');
    });

    it('deduplicates when overrideBaseURL hostname matches baseURL hostname', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.example.com' });
      retrieveDomainkeyStub.resolves('domainkey-abc');

      await handler.default({ siteId: SITE_ID }, context);

      expect(retrieveDomainkeyStub).to.have.been.calledOnce;
      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.example.com');
    });

    it('times out before reaching baseURL when override domain hangs', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.override.com' });
      const clock = sinon.useFakeTimers();
      retrieveDomainkeyStub.withArgs('www.override.com').returns(new Promise(() => {}));
      retrieveDomainkeyStub.withArgs('www.example.com').resolves('domainkey-abc');

      const resultPromise = handler.default({ siteId: SITE_ID }, context);
      await clock.tickAsync(4000);
      const result = await resultPromise;
      clock.restore();

      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'timeout' });
      expect(retrieveDomainkeyStub).not.to.have.been.calledWith('www.example.com');
      expect(mockSite.save).not.to.have.been.called;
    });

    it('sets hasDomainKey=false when all domain candidates fail', async () => {
      mockConfig.getFetchConfig.returns({ overrideBaseURL: 'https://www.override.com' });
      retrieveDomainkeyStub.rejects(new Error('404'));

      const result = await handler.default({ siteId: SITE_ID }, context);

      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: false, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(false);
      expect(context.log.warn).to.have.been.calledWithMatch('No domain key found');
    });
  });

  describe('save failure', () => {
    it('returns 500 when site.save() throws', async () => {
      retrieveDomainkeyStub.resolves('domainkey-abc');
      mockSite.save.rejects(new Error('DynamoDB write failed'));

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWithMatch('Failed to save');
    });
  });
});
