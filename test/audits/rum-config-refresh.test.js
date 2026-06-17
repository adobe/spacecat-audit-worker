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

describe('rum-config-refresh handler', function () {
  this.timeout(10000);
  let context;
  let mockSite;
  let mockConfig;
  let resolveRumDomainKeyStub;
  let toDynamoItemStub;
  let handler;

  beforeEach(async () => {
    resolveRumDomainKeyStub = sandbox.stub().resolves({ hasDomainKey: false, timedOut: false });
    toDynamoItemStub = sandbox.stub().returns({});

    handler = await esmock(
      '../../src/rum-config-refresh/handler.js',
      {
        '@adobe/spacecat-shared-rum-api-client': {
          resolveRumDomainKey: resolveRumDomainKeyStub,
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
      expect(resolveRumDomainKeyStub).not.to.have.been.called;
      expect(mockSite.save).not.to.have.been.called;
    });

    it('proceeds when rumConfig has no lastCheckedAt', async () => {
      mockConfig.getRumConfig.returns(undefined);
      resolveRumDomainKeyStub.resolves({ hasDomainKey: true, timedOut: false });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
    });

    it('proceeds when lastCheckedAt is older than 7 days', async () => {
      const staleDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      mockConfig.getRumConfig.returns({ hasDomainKey: false, lastCheckedAt: staleDate });
      resolveRumDomainKeyStub.resolves({ hasDomainKey: true, timedOut: false });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
    });
  });

  describe('RUM domain key check', () => {
    it('sets hasDomainKey=true and saves when resolveRumDomainKey resolves with a key', async () => {
      resolveRumDomainKeyStub.resolves({ hasDomainKey: true, timedOut: false });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: true, updated: true });
      expect(resolveRumDomainKeyStub).to.have.been.calledOnceWith(mockSite, context);
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(true);
      expect(toDynamoItemStub).to.have.been.calledWith(mockConfig);
      expect(mockSite.save).to.have.been.calledOnce;
    });

    it('sets hasDomainKey=false and saves when no domain key is found', async () => {
      resolveRumDomainKeyStub.resolves({ hasDomainKey: false, timedOut: false });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ hasDomainKey: false, updated: true });
      expect(mockConfig.updateRumConfig).to.have.been.calledWith(false);
      expect(mockSite.save).to.have.been.calledOnce;
    });

    it('skips config update and save when RUM check times out', async () => {
      resolveRumDomainKeyStub.resolves({ hasDomainKey: false, timedOut: true });

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(200);
      const body = await result.json();
      expect(body).to.deep.equal({ skipped: true, reason: 'timeout' });
      expect(mockConfig.updateRumConfig).not.to.have.been.called;
      expect(mockSite.save).not.to.have.been.called;
    });
  });

  describe('save failure', () => {
    it('returns 500 when site.save() throws', async () => {
      resolveRumDomainKeyStub.resolves({ hasDomainKey: true, timedOut: false });
      mockSite.save.rejects(new Error('DynamoDB write failed'));

      const result = await handler.default({ siteId: SITE_ID }, context);

      expect(result.status).to.equal(500);
      expect(context.log.error).to.have.been.calledWithMatch('Failed to save');
    });
  });
});
