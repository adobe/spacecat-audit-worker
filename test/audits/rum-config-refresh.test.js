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
  let handler;

  beforeEach(async () => {
    retrieveDomainkeyStub = sandbox.stub();

    handler = await esmock(
      '../../src/rum-config-refresh/handler.js',
      {
        '@adobe/spacecat-shared-rum-api-client': {
          default: {
            createFrom: () => ({ retrieveDomainkey: retrieveDomainkeyStub }),
          },
        },
      },
    );

    mockConfig = {
      getRumConfig: sandbox.stub().returns(undefined),
      updateRumConfig: sandbox.stub(),
    };

    mockSite = {
      getBaseURL: sandbox.stub().returns(BASE_URL),
      getConfig: sandbox.stub().returns(mockConfig),
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
      expect(mockSite.save).to.have.been.calledOnce;
    });

    it('sets hasDomainKey=false when retrieveDomainkey rejects', async () => {
      retrieveDomainkeyStub.rejects(new Error('no domain key found'));

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: false, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(false);
      expect(mockSite.save).to.have.been.calledOnce;
      expect(context.log.warn).to.have.been.calledWithMatch('RUM check failed');
    });

    it('sets hasDomainKey=false when RUM check times out', async () => {
      const clock = sinon.useFakeTimers();
      retrieveDomainkeyStub.returns(new Promise(() => {})); // never resolves

      const resultPromise = handler.default({ siteId: SITE_ID }, context);
      await clock.tickAsync(4000); // advance past the 3 s timeout
      const result = await resultPromise;
      clock.restore();

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: false, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(false);
      expect(context.log.warn).to.have.been.calledWithMatch('timed out');
    });

    it('strips protocol from baseURL before calling retrieveDomainkey', async () => {
      retrieveDomainkeyStub.resolves('domainkey-abc');

      await handler.default({ siteId: SITE_ID }, context);

      expect(retrieveDomainkeyStub).to.have.been.calledWith('www.example.com');
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
