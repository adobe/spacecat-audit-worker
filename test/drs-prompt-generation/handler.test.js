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
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

describe('DRS Prompt Generation Handler', () => {
  let sandbox;
  let context;
  let mockConfiguration;
  let fetchStub;
  let drsPromptGenerationHandler;
  let mockPostMessageSafe;
  let mockWriteDrsPromptsToLlmoConfig;

  const AUDITS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/audits-queue';
  const PRESIGNED_URL = 'https://drs-bucket.s3.amazonaws.com/results/job-1/data.json?X-Amz-Signature=abc';

  const DRS_PROMPTS = [
    {
      prompt: 'What is Adobe?',
      region: 'us',
      category: 'brand',
      topic: 'general',
      base_url: 'https://adobe.com',
    },
  ];

  before('setup', () => {
    sandbox = sinon.createSandbox();
  });

  beforeEach(async () => {
    mockPostMessageSafe = sandbox.stub().resolves({ success: true });
    mockWriteDrsPromptsToLlmoConfig = sandbox.stub().resolves({ success: true, version: 'v1' });

    const handler = await esmock('../../src/drs-prompt-generation/handler.js', {
      '../../src/utils/slack-utils.js': { postMessageSafe: mockPostMessageSafe },
      '../../src/drs-prompt-generation/drs-config-writer.js': { default: mockWriteDrsPromptsToLlmoConfig },
    });
    drsPromptGenerationHandler = handler.default;

    mockConfiguration = {
      getQueues: sandbox.stub().returns({ audits: AUDITS_QUEUE_URL }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    context.dataAccess.Configuration.findLatest.resolves(mockConfiguration);
    context.s3Client = { send: sandbox.stub().resolves() };
    context.env.S3_IMPORTER_BUCKET_NAME = 'importer-bucket';
    context.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID = 'C-TEST-CHANNEL';

    // Stub global fetch — presigned URL returns DRS prompts
    fetchStub = sandbox.stub(globalThis, 'fetch');
    fetchStub.resolves({
      ok: true,
      json: async () => ({ prompts: DRS_PROMPTS }),
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns ok and logs error when siteId is missing', async () => {
    const message = {
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-1',
        resultLocation: PRESIGNED_URL,
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

  it('returns ok, logs error, and sends Slack alert on JOB_FAILED event', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_FAILED',
        drsJobId: 'job-fail-1',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      'DRS prompt generation job job-fail-1 failed for site site-123. Prompts can be generated manually via DRS dashboard.',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(mockPostMessageSafe).to.have.been.calledOnce;
    const { attachments } = mockPostMessageSafe.firstCall.args[3];
    expect(attachments[0].color).to.equal('#CB3837');
    expect(JSON.stringify(attachments)).to.include('site-123');
    expect(JSON.stringify(attachments)).to.include('Runbook');
  });

  it('shows N/A in Slack alert when drsJobId is undefined', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_FAILED',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    await drsPromptGenerationHandler(message, context);

    expect(mockPostMessageSafe).to.have.been.calledOnce;
    expect(JSON.stringify(mockPostMessageSafe.firstCall.args[3])).to.include('N/A');
  });

  it('returns ok and logs warn on unexpected event type', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_PENDING',
        drsJobId: 'job-2',
        resultLocation: PRESIGNED_URL,
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

  it('downloads and writes config for non-onboarding source without triggering audit', async () => {
    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-3',
        resultLocation: PRESIGNED_URL,
        source: 'manual',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(fetchStub).to.have.been.calledOnceWith(PRESIGNED_URL);
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('triggers llmo-customer-analysis on JOB_COMPLETED + onboarding', async () => {
    const message = {
      siteId: 'site-456',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-4',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;

    const sentMessage = context.sqs.sendMessage.firstCall.args[1];
    expect(sentMessage.type).to.equal('llmo-customer-analysis');
    expect(sentMessage.siteId).to.equal('site-456');
    expect(sentMessage.auditContext.drsJobId).to.equal('job-4');
    expect(sentMessage.auditContext.resultLocation).to.equal(PRESIGNED_URL);
    expect(sentMessage.auditContext).to.not.have.property('drsJsonKey');
    expect(sentMessage.auditContext).to.not.have.property('drsParquetKey');
  });

  it('skips Slack alert when channel env var is not set', async () => {
    delete context.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID;

    const message = {
      siteId: 'site-123',
      auditContext: {
        drsEventType: 'JOB_FAILED',
        drsJobId: 'job-no-channel',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(mockPostMessageSafe).to.not.have.been.called;
  });

  it('still triggers audit and sends Slack alert when presigned URL download fails', async () => {
    fetchStub.rejects(new Error('Network error'));

    const message = {
      siteId: 'site-456',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-5',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      sinon.match('DRS result processing failed for job job-5'),
    );
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(mockPostMessageSafe).to.have.been.calledOnce;
  });

  it('still triggers audit when presigned URL returns non-OK response', async () => {
    fetchStub.resolves({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    const message = {
      siteId: 'site-456',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-expired',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.error).to.have.been.calledWith(
      sinon.match('Failed to download DRS result: 403 Forbidden'),
    );
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
  });

  it('handles DRS returning empty prompts array', async () => {
    fetchStub.resolves({
      ok: true,
      json: async () => ({ prompts: [] }),
    });

    const message = {
      siteId: 'site-789',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-6',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      'DRS job job-6 returned no prompts for site site-789',
    );
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
  });

  it('handles DRS result that is a flat array (no .prompts wrapper)', async () => {
    fetchStub.resolves({
      ok: true,
      json: async () => DRS_PROMPTS,
    });

    const message = {
      siteId: 'site-flat',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-flat',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
  });

  it('handles DRS result that is a non-array object without .prompts', async () => {
    fetchStub.resolves({
      ok: true,
      json: async () => ({ status: 'done', count: 0 }),
    });

    const message = {
      siteId: 'site-obj',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-obj',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      'DRS job job-obj returned no prompts for site site-obj',
    );
  });

  it('sends SQS message with correct structure', async () => {
    const message = {
      siteId: 'site-789',
      auditContext: {
        drsEventType: 'JOB_COMPLETED',
        drsJobId: 'job-7',
        resultLocation: PRESIGNED_URL,
        source: 'onboarding',
      },
    };

    await drsPromptGenerationHandler(message, context);

    const sentMessage = context.sqs.sendMessage.firstCall.args[1];

    expect(sentMessage).to.have.property('type', 'llmo-customer-analysis');
    expect(sentMessage).to.have.property('siteId', 'site-789');
    expect(sentMessage.auditContext).to.have.property('drsJobId', 'job-7');
    expect(sentMessage.auditContext).to.have.property('resultLocation', PRESIGNED_URL);
    expect(sentMessage.auditContext).to.not.have.property('source');
    expect(sentMessage.auditContext).to.not.have.property('drsEventType');
  });

  it('defaults auditContext to empty object when not provided', async () => {
    const message = {
      siteId: 'site-123',
    };

    const result = await drsPromptGenerationHandler(message, context);

    expect(result.status).to.equal(200);
    expect(context.log.warn).to.have.been.calledWith(
      'Unexpected DRS event type: undefined for site site-123',
    );
    expect(context.sqs.sendMessage).to.not.have.been.called;
  });

  it('processes result for all sources on JOB_COMPLETED', async () => {
    const sources = ['onboarding', 'manual', 'api', undefined];

    for (const source of sources) {
      sandbox.restore();

      const localPostMessageSafe = sandbox.stub().resolves({ success: true });

      // eslint-disable-next-line no-await-in-loop
      const handler = await esmock('../../src/drs-prompt-generation/handler.js', {
        '../../src/utils/slack-utils.js': { postMessageSafe: localPostMessageSafe },
        '../../src/drs-prompt-generation/drs-config-writer.js': { default: sandbox.stub().resolves() },
      });
      const localHandler = handler.default;

      context = new MockContextBuilder()
        .withSandbox(sandbox)
        .build();
      context.dataAccess.Configuration.findLatest.resolves(mockConfiguration);
      context.s3Client = { send: sandbox.stub().resolves() };
      context.env.S3_IMPORTER_BUCKET_NAME = 'importer-bucket';
      context.env.SLACK_CHANNEL_LLMO_ONBOARDING_ID = 'C-TEST-CHANNEL';

      fetchStub = sandbox.stub(globalThis, 'fetch');
      fetchStub.resolves({
        ok: true,
        json: async () => ({ prompts: DRS_PROMPTS }),
      });

      const message = {
        siteId: 'site-all',
        auditContext: {
          drsEventType: 'JOB_COMPLETED',
          drsJobId: `job-source-${source}`,
          resultLocation: PRESIGNED_URL,
          source,
        },
      };

      // eslint-disable-next-line no-await-in-loop
      await localHandler(message, context);

      expect(fetchStub, `fetch should be called for source=${source}`).to.have.been.calledOnceWith(PRESIGNED_URL);
    }
  });
});
