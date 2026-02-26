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
import drsPromptGenerationHandler from '../../src/drs-prompt-generation/handler.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('DRS Prompt Generation Handler', () => {
  let sandbox;
  let context;
  let mockConfiguration;

  const AUDITS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue';

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(() => {
    mockConfiguration = {
      getQueues: sandbox.stub().returns({ audits: AUDITS_QUEUE_URL }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Configuration.findLatest.resolves(mockConfiguration);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns ok and logs error when siteId is missing', async () => {
    const message = {
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-1',
        resultLocation: 's3://bucket/result',
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      'DRS prompt generation notification missing site_id in metadata',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('returns ok and logs error on JOB_FAILED event', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_FAILED',
        drsJobId: 'job-fail-1',
        resultLocation: 's3://bucket/result',
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      'DRS prompt generation job job-fail-1 failed for site site-123. Prompts can be generated manually via DRS dashboard.',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('returns ok and logs warn on unexpected event type', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_PENDING',
        drsJobId: 'job-2',
        resultLocation: 's3://bucket/result',
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      'Unexpected DRS event type: JOB_PENDING for site site-123',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('returns ok and does not send message when source is not onboarding', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-3',
        resultLocation: 's3://bucket/result',
        source: 'manual',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith(
      'DRS job job-3 was not triggered by onboarding (source: manual), skipping llmo-customer-analysis trigger',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('sends llmo-customer-analysis message on JOB_COMPLETED with onboarding source', async () => {
    const message = {
      siteId: 'site-456',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-4',
        resultLocation: 's3://bucket/prompts/result',
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Configuration.findLatest).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been.calledWith(
      AUDITS_QUEUE_URL,
      {
        type: 'llmo-customer-analysis',
        siteId: 'site-456',
        auditContext: {
          drsJobId: 'job-4',
          resultLocation: 's3://bucket/prompts/result',
        },
      },
    );
    expect(context.log.info).to.have.been.calledWith(
      'Triggered llmo-customer-analysis for site site-456 after DRS prompt generation job job-4',
    );
  });

  it('sends SQS message with correct structure (no extra fields in auditContext)', async () => {
    const message = {
      siteId: 'site-789',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-5',
        resultLocation: 's3://bucket/output',
        source: 'onboarding',
      },
    };

    await drsPromptGenerationHandler(message, context);

    const sentMessage = context.sqs.sendMessage.firstCall.args[1];

    expect(sentMessage).to.have.property('type', 'llmo-customer-analysis');
    expect(sentMessage).to.have.property('siteId', 'site-789');
    expect(sentMessage.auditContext).to.deep.equal({
      drsJobId: 'job-5',
      resultLocation: 's3://bucket/output',
    });
    // Verify source and drsEventType are NOT forwarded in auditContext
    expect(sentMessage.auditContext).to.not.have.property('source');
    expect(sentMessage.auditContext).to.not.have.property('drsEventType');
  });

  it('defaults auditContext to empty object when not provided', async () => {
    const message = {
      siteId: 'site-123',
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    // drsEventType is undefined, which is not 'JOB_FAILED' and not 'JOB_COMPLETED'
    expect(context.log.warn).to.have.been.calledWith(
      'Unexpected DRS event type: undefined for site site-123',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });
});
