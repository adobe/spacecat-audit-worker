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

describe('offsite-brand-presence DRS status handler', () => {
  let sandbox;
  let handler;
  let mockGetJob;
  let mockPostMessageOptional;
  let context;
  let log;

  const BASE_URL = 'https://example.com';
  const SITE_ID = 'site-123';

  function buildMessage(overrides = {}) {
    return {
      type: 'offsite-brand-presence-drs-status',
      siteId: SITE_ID,
      auditContext: {
        baseURL: BASE_URL,
        slackContext: { channelId: 'C123', threadTs: '111.222' },
        jobs: [
          { domain: 'reddit.com', datasetId: 'reddit_comments', jobId: 'job-1' },
          { domain: 'youtube.com', datasetId: 'youtube_videos', jobId: 'job-2' },
        ],
        deadline: Date.now() + 600000,
        ...overrides,
      },
    };
  }

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockGetJob = sandbox.stub();
    mockPostMessageOptional = sandbox.stub().resolves({ success: true, result: {} });

    handler = await esmock('../../src/offsite-brand-presence/drs-status-handler.js', {
      '@adobe/spacecat-shared-drs-client': {
        default: { createFrom: () => ({ getJob: mockGetJob }) },
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    });

    log = {
      info: sandbox.stub(), warn: sandbox.stub(), error: sandbox.stub(), debug: sandbox.stub(),
    };
    context = {
      log,
      sqs: { sendMessage: sandbox.stub().resolves() },
      dataAccess: {
        Configuration: {
          findLatest: sandbox.stub().resolves({ getQueues: () => ({ audits: 'audits-queue-url' }) }),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('posts a single summary when all jobs are terminal', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'COMPLETED_WITH_ERRORS' });

    const result = await handler.default(buildMessage(), context);

    expect(result.status).to.equal(200);
    expect(context.sqs.sendMessage).to.not.have.been.called;
    expect(mockPostMessageOptional).to.have.been.calledOnce;
    const [, channelId, text, opts] = mockPostMessageOptional.firstCall.args;
    expect(channelId).to.equal('C123');
    expect(opts).to.deep.equal({ threadTs: '111.222' });
    expect(text).to.include('example.com');
    expect(text).to.include('reddit_comments');
    expect(text).to.include('COMPLETED');
    expect(text).to.include('COMPLETED_WITH_ERRORS');
  });

  it('includes the error message for a failed job', async () => {
    mockGetJob.withArgs('job-1').resolves({ status: 'COMPLETED' });
    mockGetJob.withArgs('job-2').resolves({ status: 'FAILED', error_message: 'boom' });

    await handler.default(buildMessage(), context);

    const text = mockPostMessageOptional.firstCall.args[2];
    expect(text).to.include('FAILED');
    expect(text).to.include('boom');
  });
});
