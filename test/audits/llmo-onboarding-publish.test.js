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
  let configuration;
  let publishToAdminHlxStub;
  let okStub;
  let badRequestStub;
  let handler;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    okStub = sandbox.stub().callsFake((body = {}) => ({ status: 200, body }));
    badRequestStub = sandbox.stub().callsFake((message) => ({ status: 400, body: { message } }));
    publishToAdminHlxStub = sandbox.stub().resolves();

    site = {
      getConfig: sandbox.stub().returns({
        getLlmoDataFolder: sandbox.stub().returns('dev/example-com'),
      }),
    };

    configuration = {
      getQueues: sandbox.stub().returns({ audits: 'audit-queue' }),
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
        Configuration: {
          findLatest: sandbox.stub().resolves(configuration),
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };

    const module = await esmock('../../src/llmo-onboarding-publish/handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        ok: okStub,
        badRequest: badRequestStub,
      },
      '../../src/utils/report-uploader.js': {
        publishToAdminHlx: publishToAdminHlxStub,
      },
    });

    handler = module.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('attempts publish and queues llmo-customer-analysis for valid messages', async () => {
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
    expect(context.sqs.sendMessage).to.have.been.calledOnceWithExactly(
      'audit-queue',
      {
        type: 'llmo-customer-analysis',
        siteId: 'site-123',
        auditContext: {
          triggerSource: 'llmo-onboard',
          dataFolder: 'dev/example-com',
          onboardingRunId: 'run-123',
        },
      },
    );
    expect(response).to.deep.equal({ status: 200, body: { queued: true } });
  });

  it('still queues llmo-customer-analysis when publish helper swallows errors', async () => {
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
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(response).to.deep.equal({ status: 200, body: { queued: true } });
  });

  it('skips publish and downstream trigger for stale messages', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        dataFolder: 'dev/other-folder',
      },
    };

    const response = await handler(message, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.deep.equal({ status: 200, body: { skipped: true, reason: 'stale-message' } });
  });

  it('skips publish and downstream trigger when site is not found', async () => {
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
    expect(response).to.deep.equal({ status: 200, body: { skipped: true, reason: 'site-not-found' } });
  });

  it('returns badRequest when required fields are missing', async () => {
    const response = await handler({ auditContext: {} }, context);

    expect(publishToAdminHlxStub).to.not.have.been.called;
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(response).to.deep.equal({
      status: 400,
      body: { message: 'Missing required fields: siteId and auditContext.dataFolder' },
    });
  });
});
