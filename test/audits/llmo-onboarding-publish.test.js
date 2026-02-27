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
import esmock from 'esmock';

use(sinonChai);

describe('LLMO Onboarding Publish Handler', () => {
  let sandbox;
  let context;
  let site;
  let publishToAdminHlxStub;
  let handler;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    publishToAdminHlxStub = sandbox.stub().resolves();

    site = {
      getConfig: sandbox.stub().returns({
        getLlmoDataFolder: sandbox.stub().returns('dev/example-com'),
      }),
    };

    context = {
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(site),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };

    const module = await esmock('../../src/llmo-onboarding-publish/handler.js', {
      '../../src/utils/report-uploader.js': {
        publishToAdminHlx: publishToAdminHlxStub,
      },
    });

    handler = module.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('attempts publish for valid messages', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/example-com',
        onboardingRunId: 'run-123',
        triggerSource: 'llmo-onboard',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.have.been.calledOnceWithExactly(
      'query-index',
      'dev/example-com',
      context.log,
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('uses persisted llmo data folder even when message dataFolder differs', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/other-folder',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.have.been.calledOnceWithExactly(
      'query-index',
      'dev/example-com',
      context.log,
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('works without auditContext dataFolder in the message', async () => {
    const message = { siteId: 'site-123', auditContext: {} };
    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.have.been.calledOnceWithExactly(
      'query-index',
      'dev/example-com',
      context.log,
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('still returns success when publish helper swallows errors', async () => {
    publishToAdminHlxStub.callsFake(async () => {
      context.log.error('Failed to publish via admin.hlx.page');
    });

    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/example-com',
        onboardingRunId: 'run-123',
      },
    };

    const response = await handler(message, context);

    expect(context.log.error).to.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('skips publish when site is not found', async () => {
    context.dataAccess.Site.findById.resolves(null);

    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/example-com',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('skips publish when site has no llmo data folder', async () => {
    site.getConfig.returns({
      getLlmoDataFolder: sandbox.stub().returns(null),
    });

    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/example-com',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.be.undefined;
  });

  it('returns early when siteId is missing', async () => {
    const response = await handler({ auditContext: {} }, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith('[LLMO Onboarding Publish] Missing required field: siteId');
    expect(response).to.be.undefined;
  });

  it('uses context.site when available and skips DB lookup', async () => {
    context.site = site;

    const message = { siteId: 'site-123' };
    const response = await handler(message, context);

    expect(context.dataAccess.Site.findById).to.not.have.been.called;
    expect(publishToAdminHlxStub).to.have.been.calledOnce;
    expect(response).to.be.undefined;
  });

  it('falls back to Site.findById when context.site is not set', async () => {
    delete context.site;

    const message = { siteId: 'site-123' };
    const response = await handler(message, context);

    expect(context.dataAccess.Site.findById).to.have.been.calledOnceWith('site-123');
    expect(publishToAdminHlxStub).to.have.been.calledOnce;
    expect(response).to.be.undefined;
  });
});
