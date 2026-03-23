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

async function loadHandler(detectCdnFromUrlImpl = null) {
  const detectCdnFromUrlStub = sinon.stub();
  if (detectCdnFromUrlImpl) {
    detectCdnFromUrlStub.callsFake(detectCdnFromUrlImpl);
  } else {
    detectCdnFromUrlStub.resolves({ cdn: 'Cloudflare' });
  }

  const postMessageSafe = sinon.stub().resolves({ success: true });

  const detectCdn = (await esmock('../../src/detect-cdn/handler.js', {
    '../../src/detect-cdn/cdn-detector.js': { detectCdnFromUrl: detectCdnFromUrlStub },
    '../../src/utils/slack-utils.js': { postMessageSafe },
  })).default;

  return {
    detectCdn,
    detectCdnFromUrlStub,
    postMessageSafe,
  };
}

describe('detect-cdn handler', () => {
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

  it('ignores messages missing slackContext.channelId or threadTs', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    const resp = await detectCdn(
      { baseURL: 'https://example.com', slackContext: {} },
      context,
    );
    expect(resp).to.exist;
    expect(resp.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWithMatch('Missing slackContext.channelId');
    expect(postMessageSafe).to.not.have.been.called;
  });

  it('ignores when message is undefined (uses default slackContext)', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    const resp = await detectCdn(undefined, context);
    expect(resp).to.exist;
    expect(resp.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWithMatch('Missing slackContext');
    expect(postMessageSafe).to.not.have.been.called;
  });

  it('ignores when channelId is missing', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    await detectCdn(
      {
        baseURL: 'https://example.com',
        slackContext: { threadTs: '123.456' },
      },
      context,
    );
    expect(context.log.warn).to.have.been.calledWithMatch('Missing slackContext.channelId');
    expect(postMessageSafe).to.not.have.been.called;
  });

  it('ignores when threadTs is missing', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    await detectCdn(
      {
        baseURL: 'https://example.com',
        slackContext: { channelId: 'C1' },
      },
      context,
    );
    expect(context.log.warn).to.have.been.calledWithMatch('Missing slackContext');
    expect(postMessageSafe).to.not.have.been.called;
  });

  it('posts warning when baseURL is missing or empty', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    await detectCdn(
      {
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[1]).to.equal('C1');
    expect(postMessageSafe.firstCall.args[2]).to.include('detect-cdn: missing or invalid URL');
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({ threadTs: '123.456' });
  });

  it('posts warning when baseURL is invalid (empty string)', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    await detectCdn(
      {
        baseURL: '   ',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[2]).to.include('missing or invalid URL');
  });

  it('includes slack target in missing-URL warning when provided', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();
    await detectCdn(
      {
        slackContext: {
          channelId: 'C1',
          threadTs: '123.456',
          target: 'WORKSPACE_EXTERNAL',
        },
      },
      context,
    );

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
  });

  it('calls detectCdnFromUrl and posts result to Slack on success', async () => {
    const { detectCdn, detectCdnFromUrlStub, postMessageSafe } = await loadHandler();

    await detectCdn(
      {
        baseURL: 'https://www.cloudflare.com',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(detectCdnFromUrlStub).to.have.been.calledOnce;
    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[1]).to.equal('C1');
    expect(postMessageSafe.firstCall.args[2]).to.include('*Detected CDN:* `Cloudflare`');
    expect(postMessageSafe.firstCall.args[2]).to.include('https://www.cloudflare.com');
    expect(postMessageSafe.firstCall.args[3]).to.deep.include({ threadTs: '123.456' });
  });

  it('normalizes URL without scheme to https', async () => {
    const { detectCdn, detectCdnFromUrlStub } = await loadHandler();

    await detectCdn(
      {
        baseURL: 'example.com',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(detectCdnFromUrlStub).to.have.been.calledOnce;
    expect(detectCdnFromUrlStub.firstCall.args[0]).to.equal('https://example.com');
  });

  it('passes through http URL without rewriting to https', async () => {
    const { detectCdn, detectCdnFromUrlStub } = await loadHandler();

    await detectCdn(
      {
        baseURL: 'http://example.com',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(detectCdnFromUrlStub).to.have.been.calledOnce;
    expect(detectCdnFromUrlStub.firstCall.args[0]).to.equal('http://example.com');
  });

  it('includes siteId in Slack message when provided', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();

    await detectCdn(
      {
        baseURL: 'https://example.com',
        siteId: 'site-uuid-456',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(postMessageSafe.firstCall.args[2]).to.include('(siteId: `site-uuid-456`)');
    expect(postMessageSafe.firstCall.args[2]).to.include('*Detected CDN:*');
  });

  it('posts error message when detectCdnFromUrl returns error', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler(() => Promise.resolve({ cdn: 'unknown', error: 'fetch failed' }));

    await detectCdn(
      {
        baseURL: 'https://example.com',
        slackContext: { channelId: 'C1', threadTs: '123.456' },
      },
      context,
    );

    expect(postMessageSafe).to.have.been.calledOnce;
    expect(postMessageSafe.firstCall.args[2]).to.include('*CDN detection*');
    expect(postMessageSafe.firstCall.args[2]).to.include('Could not fetch URL: `fetch failed`');
  });

  it('includes slack target in postMessageSafe when provided', async () => {
    const { detectCdn, postMessageSafe } = await loadHandler();

    await detectCdn(
      {
        baseURL: 'https://example.com',
        slackContext: {
          channelId: 'C1',
          threadTs: '123.456',
          target: 'WORKSPACE_EXTERNAL',
        },
      },
      context,
    );

    expect(postMessageSafe.firstCall.args[3]).to.deep.include({
      threadTs: '123.456',
      target: 'WORKSPACE_EXTERNAL',
    });
  });

  it('uses TLS-insecure fetch when NODE_TLS_REJECT_UNAUTHORIZED is 0', async () => {
    const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    try {
      const { detectCdn, detectCdnFromUrlStub } = await loadHandler();
      await detectCdn(
        {
          baseURL: 'https://example.com',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        context,
      );
      expect(detectCdnFromUrlStub).to.have.been.calledOnce;
      expect(detectCdnFromUrlStub.firstCall.args[1]).to.be.a('function');
    } finally {
      if (original !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    }
  });

  it('uses tracingFetch when NODE_TLS_REJECT_UNAUTHORIZED is not 0 (covers default fetch branch)', async () => {
    const original = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
    try {
      const { detectCdn, detectCdnFromUrlStub } = await loadHandler();
      await detectCdn(
        {
          baseURL: 'https://example.com',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        context,
      );
      expect(detectCdnFromUrlStub).to.have.been.calledOnce;
      expect(detectCdnFromUrlStub.firstCall.args[1]).to.be.a('function');
    } finally {
      if (original !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = original;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    }
  });

  describe('deliveryConfig update (same pattern as identify-redirects)', () => {
    it('updates site deliveryConfig.cdn when siteId is present and site is found', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const setDeliveryConfig = sandbox.stub();
      const save = sandbox.stub().resolves();
      const getDeliveryConfig = sandbox.stub().returns({ programId: '12652' });
      const mockSite = {
        setDeliveryConfig,
        getDeliveryConfig,
        save,
      };
      const findById = sandbox.stub().resolves(mockSite);
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(findById).to.have.been.calledOnceWith('site-uuid-123');
      expect(setDeliveryConfig).to.have.been.calledOnceWith({
        programId: '12652',
        cdn: 'cloudflare',
      });
      expect(save).to.have.been.calledOnce;
      expect(postMessageSafe).to.have.been.calledWithMatch(ctx, 'C1', sinon.match.string, sinon.match.object);
    });

    it('sets deliveryConfig.cdn to "none" when detection returns unknown or error', async () => {
      const { detectCdn } = await loadHandler(() => Promise.resolve({ cdn: 'unknown' }));
      const setDeliveryConfig = sandbox.stub();
      const save = sandbox.stub().resolves();
      const findById = sandbox.stub().resolves({
        setDeliveryConfig,
        getDeliveryConfig: sandbox.stub().returns({}),
        save,
      });
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(setDeliveryConfig).to.have.been.calledOnceWith({ cdn: 'none' });
      expect(save).to.have.been.calledOnce;
    });

    it('posts warning and does not save when siteId is present but site not found', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const findById = sandbox.stub().resolves(null);
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-404',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(findById).to.have.been.calledOnceWith('site-uuid-404');
      expect(context.log.warn).to.have.been.calledWithMatch('[detect-cdn] Site not found');
      const warningCall = postMessageSafe.getCalls().find((c) => c.args[2]?.includes('Could not update delivery config'));
      expect(warningCall).to.exist;
      expect(warningCall.args[2]).to.include('site not found');
    });

    it('includes slack target in warning when site not found and target provided', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const findById = sandbox.stub().resolves(null);
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-404',
          slackContext: { channelId: 'C1', threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' },
        },
        ctx,
      );

      const warningCall = postMessageSafe.getCalls().find((c) => c.args[2]?.includes('site not found'));
      expect(warningCall).to.exist;
      expect(warningCall.args[3]).to.deep.include({ threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' });
    });

    it('skips deliveryConfig update when context has no dataAccess', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const resp = await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        context,
      );
      expect(resp.status).to.equal(200);
      expect(postMessageSafe).to.have.been.calledOnce;
    });

    it('logs error and posts warning when deliveryConfig update throws (e.g. save fails)', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const saveError = new Error('DynamoDB write failed');
      const save = sandbox.stub().rejects(saveError);
      const findById = sandbox.stub().resolves({
        getDeliveryConfig: sandbox.stub().returns({}),
        setDeliveryConfig: sandbox.stub(),
        save,
      });
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      const resp = await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(resp.status).to.equal(200);
      expect(ctx.log.error).to.have.been.calledWithMatch('[detect-cdn] Failed to update deliveryConfig', {
        siteId: 'site-uuid-123',
        error: 'DynamoDB write failed',
      });
      const warningCall = postMessageSafe.getCalls().find((c) => c.args[2]?.includes('Could not update delivery config'));
      expect(warningCall).to.exist;
      expect(warningCall.args[2]).to.include('DynamoDB write failed');
    });

    it('includes slack target in catch-block warning when save fails and slack target provided', async () => {
      const { detectCdn, postMessageSafe } = await loadHandler();
      const save = sandbox.stub().rejects(new Error('Save failed'));
      const findById = sandbox.stub().resolves({
        getDeliveryConfig: sandbox.stub().returns({}),
        setDeliveryConfig: sandbox.stub(),
        save,
      });
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' },
        },
        ctx,
      );

      const warningCall = postMessageSafe.getCalls().find((c) => c.args[2]?.includes('Could not update delivery config'));
      expect(warningCall).to.exist;
      expect(warningCall.args[3]).to.deep.include({ threadTs: '123.456', target: 'WORKSPACE_EXTERNAL' });
    });

    it('uses context.site when context.site.getId() === siteId (does not call findById)', async () => {
      const { detectCdn } = await loadHandler();
      const setDeliveryConfig = sandbox.stub();
      const save = sandbox.stub().resolves();
      const getDeliveryConfig = sandbox.stub().returns({ programId: '12652' });
      const mockSite = {
        getId: sandbox.stub().returns('site-uuid-123'),
        getDeliveryConfig,
        setDeliveryConfig,
        save,
      };
      const findById = sandbox.stub();
      const ctx = {
        ...context,
        site: mockSite,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(findById).to.not.have.been.called;
      expect(setDeliveryConfig).to.have.been.calledOnceWith({
        programId: '12652',
        cdn: 'cloudflare',
      });
      expect(save).to.have.been.calledOnce;
    });

    it('merges with empty object when getDeliveryConfig returns null', async () => {
      const { detectCdn } = await loadHandler();
      const setDeliveryConfig = sandbox.stub();
      const save = sandbox.stub().resolves();
      const findById = sandbox.stub().resolves({
        getDeliveryConfig: sandbox.stub().returns(null),
        setDeliveryConfig,
        save,
      });
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(setDeliveryConfig).to.have.been.calledOnceWith({ cdn: 'cloudflare' });
      expect(save).to.have.been.calledOnce;
    });

    it('merges with empty object when getDeliveryConfig returns undefined', async () => {
      const { detectCdn } = await loadHandler();
      const setDeliveryConfig = sandbox.stub();
      const save = sandbox.stub().resolves();
      const findById = sandbox.stub().resolves({
        getDeliveryConfig: sandbox.stub().returns(undefined),
        setDeliveryConfig,
        save,
      });
      const ctx = {
        ...context,
        dataAccess: { Site: { findById } },
      };

      await detectCdn(
        {
          baseURL: 'https://example.com',
          siteId: 'site-uuid-123',
          slackContext: { channelId: 'C1', threadTs: '123.456' },
        },
        ctx,
      );

      expect(setDeliveryConfig).to.have.been.calledOnceWith({ cdn: 'cloudflare' });
      expect(save).to.have.been.calledOnce;
    });
  });
});
