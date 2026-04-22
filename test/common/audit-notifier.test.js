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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { ok, notFound } from '@adobe/spacecat-shared-http-utils';

use(sinonChai);

describe('withSlackNotification', () => {
  let sandbox;
  let mockPostMessageOptional;
  let withSlackNotification;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockPostMessageOptional = sandbox.stub().resolves();

    const mod = await esmock('../../src/common/audit-notifier.js', {
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    });
    withSlackNotification = mod.withSlackNotification;
  });

  afterEach(() => {
    sandbox.restore();
  });

  function buildContext(slackContext) {
    return {
      log: {
        warn: sandbox.stub(),
        error: sandbox.stub(),
        info: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().resolves({
            getAuditResult: () => (slackContext ? { slackContext } : {}),
          }),
        },
      },
    };
  }

  it('sends Slack notification on successful handler with slackContext', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = {
      auditId: 'audit-1',
      url: 'https://example.com',
      siteId: 'site-1',
    };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    const result = await wrapped(message, context);

    expect(result.status).to.equal(200);
    expect(innerHandler).to.have.been.calledOnce;
    expect(mockPostMessageOptional).to.have.been.calledOnceWith(
      context,
      'C123',
      sinon.match(/test-audit.*audit finished.*example\.com/),
      { threadTs: '1234.5678' },
    );
  });

  it('skips notification when handler returns non-200', async () => {
    const innerHandler = sandbox.stub().resolves(notFound());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { auditId: 'audit-1', url: 'https://example.com' };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    const result = await wrapped(message, context);

    expect(result.status).to.equal(404);
    expect(mockPostMessageOptional).not.to.have.been.called;
  });

  it('skips notification when auditId is missing', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { url: 'https://example.com', siteId: 'site-1' };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    const result = await wrapped(message, context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).not.to.have.been.called;
  });

  it('skips notification when audit has no slackContext', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { auditId: 'audit-1', url: 'https://example.com' };
    const context = buildContext(null);

    const result = await wrapped(message, context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageOptional).not.to.have.been.called;
  });

  it('resolves url from message.data.url when message.url is absent', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = {
      auditId: 'audit-1',
      data: { url: 'https://from-data.com' },
    };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    await wrapped(message, context);

    expect(mockPostMessageOptional).to.have.been.calledOnceWith(
      context,
      'C123',
      sinon.match(/from-data\.com/),
      { threadTs: '1234.5678' },
    );
  });

  it('falls back to empty string when no url is available', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { auditId: 'audit-1' };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    await wrapped(message, context);

    expect(mockPostMessageOptional).to.have.been.calledOnceWith(
      context,
      'C123',
      sinon.match(/test-audit.*audit finished.*\*\*/),
      { threadTs: '1234.5678' },
    );
  });

  it('does not throw if postMessageOptional fails', async () => {
    mockPostMessageOptional.rejects(new Error('Slack API down'));
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { auditId: 'audit-1', url: 'https://example.com' };
    const context = buildContext({ channelId: 'C123', threadTs: '1234.5678' });

    const result = await wrapped(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledOnce;
  });

  it('does not throw if Audit.findById fails', async () => {
    const innerHandler = sandbox.stub().resolves(ok());
    const wrapped = withSlackNotification('test-audit', innerHandler);

    const message = { auditId: 'audit-1', url: 'https://example.com' };
    const context = {
      log: { warn: sandbox.stub(), error: sandbox.stub() },
      dataAccess: {
        Audit: {
          findById: sandbox.stub().rejects(new Error('DB down')),
        },
      },
    };

    const result = await wrapped(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledOnce;
  });
});
