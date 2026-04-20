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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

/**
 * Loads the delivery-config-writer handler with detectCdn and identifyRedirects mocked.
 */
async function loadHandler({
  detectCdnImpl = sinon.stub().resolves({ status: 200 }),
  identifyRedirectsImpl = sinon.stub().resolves({ status: 200 }),
} = {}) {
  const detectCdnStub = typeof detectCdnImpl === 'function' && detectCdnImpl.isSinonProxy
    ? detectCdnImpl
    : sinon.stub().callsFake(detectCdnImpl);

  const identifyRedirectsStub = typeof identifyRedirectsImpl === 'function' && identifyRedirectsImpl.isSinonProxy
    ? identifyRedirectsImpl
    : sinon.stub().callsFake(identifyRedirectsImpl);

  const handler = (await esmock('../../src/delivery-config-writer/handler.js', {
    '../../src/detect-cdn/handler.js': { default: detectCdnStub },
    '../../src/identify-redirects/handler.js': { default: identifyRedirectsStub },
  })).default;

  return { handler, detectCdnStub, identifyRedirectsStub };
}

describe('delivery-config-writer handler', () => {
  let sandbox;
  let context;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = {
      log: {
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
        debug: sandbox.spy(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('CDN detection always runs', () => {
    it('calls detectCdn with message params and returns ok', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      const message = {
        siteId: 'site-1',
        baseURL: 'https://example.com',
        slackContext: {},
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(200);
      expect(detectCdnStub).to.have.been.calledOnce;
      expect(detectCdnStub.firstCall.args[0]).to.deep.include({
        siteId: 'site-1',
        baseURL: 'https://example.com',
      });
      expect(identifyRedirectsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWithMatch('CDN detection complete');
    });

    it('uses default slackContext when message has no slackContext', async () => {
      const { handler, detectCdnStub } = await loadHandler();

      const message = { siteId: 'site-2', baseURL: 'https://other.com' };

      await handler(message, context);

      expect(detectCdnStub.firstCall.args[0].slackContext).to.deep.equal({});
    });

    it('handles null message by using defaults', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      const result = await handler(null, context);

      expect(result.status).to.equal(200);
      expect(detectCdnStub).to.have.been.calledOnce;
      expect(detectCdnStub.firstCall.args[0]).to.deep.equal({
        siteId: undefined,
        baseURL: undefined,
        slackContext: {},
      });
      expect(identifyRedirectsStub).to.not.have.been.called;
    });
  });

  describe('missing AEM params (no redirect identification)', () => {
    it('skips redirect identification when programId is missing', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        environmentId: 'e456',
        slackContext: { channelId: 'C123', threadTs: '1234.5678' },
        // no programId
      }, context);

      expect(detectCdnStub).to.have.been.calledOnce;
      expect(identifyRedirectsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWithMatch('missing programId or environmentId');
    });

    it('skips redirect identification when environmentId is missing', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        slackContext: { channelId: 'C123', threadTs: '1234.5678' },
        // no environmentId
      }, context);

      expect(detectCdnStub).to.have.been.calledOnce;
      expect(identifyRedirectsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWithMatch('missing programId or environmentId');
    });

    it('skips redirect identification when both AEM params are missing and no slackContext', async () => {
      const { handler, identifyRedirectsStub } = await loadHandler();

      await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        // no programId, no environmentId, no slackContext
      }, context);

      expect(identifyRedirectsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWithMatch('missing programId or environmentId');
    });
  });

  describe('full execution (CDN + redirects)', () => {
    it('runs both detectCdn and identifyRedirects when AEM params are present with Slack', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      const slackContext = { channelId: 'C999', threadTs: '9876.5432' };

      await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        environmentId: 'e456',
        minutes: 1000,
        updateRedirects: true,
        slackContext,
      }, context);

      expect(detectCdnStub).to.have.been.calledOnce;
      expect(detectCdnStub.firstCall.args[0]).to.deep.equal({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        slackContext,
      });

      expect(identifyRedirectsStub).to.have.been.calledOnce;
      expect(identifyRedirectsStub.firstCall.args[0]).to.deep.equal({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        environmentId: 'e456',
        minutes: 1000,
        updateRedirects: true,
        slackContext,
      });

      expect(context.log.info).to.have.been.calledWithMatch('CDN detection complete');
      expect(context.log.info).to.have.been.calledWithMatch('Redirect identification complete');
    });

    it('runs both detectCdn and identifyRedirects when AEM params are present without Slack', async () => {
      const { handler, detectCdnStub, identifyRedirectsStub } = await loadHandler();

      await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        environmentId: 'e456',
        minutes: 1000,
        updateRedirects: true,
        // no slackContext — self-onboarding via API
      }, context);

      expect(detectCdnStub).to.have.been.calledOnce;
      expect(identifyRedirectsStub).to.have.been.calledOnce;
      expect(identifyRedirectsStub.firstCall.args[0]).to.deep.equal({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        environmentId: 'e456',
        minutes: 1000,
        updateRedirects: true,
        slackContext: {},
      });
      expect(context.log.info).to.have.been.calledWithMatch('Redirect identification complete');
    });

    it('returns ok status after both steps complete', async () => {
      const { handler } = await loadHandler();

      const result = await handler({
        siteId: 'site-1',
        baseURL: 'https://example.com',
        programId: 'p123',
        environmentId: 'e456',
        slackContext: { channelId: 'C123', threadTs: '1234.5678' },
      }, context);

      expect(result.status).to.equal(200);
    });
  });
});
