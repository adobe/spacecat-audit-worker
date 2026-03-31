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
  let publishToAdminHlxStub;
  let handler;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    publishToAdminHlxStub = sandbox.stub().resolves();
    context = {
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
        debug: sandbox.stub(),
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
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.have.been.calledOnceWithExactly(
      'query-index',
      'dev/example-com',
      context.log,
    );
    expect(response).to.be.undefined;
  });

  it('publishes with message dataFolder value', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/other-folder',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.have.been.calledOnceWithExactly(
      'query-index',
      'dev/other-folder',
      context.log,
    );
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
    expect(response).to.be.undefined;
  });

  it('returns early when siteId is missing', async () => {
    const response = await handler({ auditContext: {} }, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith('[LLMO Onboarding Publish] Missing required field: siteId');
    expect(response).to.be.undefined;
  });

  it('returns early when dataFolder is missing', async () => {
    context.site = {
      getConfig: sandbox.stub().returns({
        getLlmoDataFolder: sandbox.stub().returns('dev/site-config-folder'),
      }),
    };

    const response = await handler({ siteId: 'site-123', auditContext: {} }, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.log.error).to.have.been.calledWith(
      '[LLMO Onboarding Publish] Missing required field: auditContext.dataFolder',
      sinon.match({
        siteId: 'site-123',
      }),
    );
    expect(response).to.be.undefined;
  });
});
