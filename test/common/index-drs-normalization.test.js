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
import { Request } from '@adobe/fetch';
import { main } from '../../src/index.js';

use(sinonChai);

describe('Index DRS message normalization', () => {
  const sandbox = sinon.createSandbox();
  let context;

  beforeEach(() => {
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x';
    context = {
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves({
            getId: sandbox.stub().returns('site-123'),
          }),
        },
        Configuration: {
          findLatest: sandbox.stub().resolves({
            getQueues: () => ({ audits: 'https://sqs.us-east-1.amazonaws.com/123/audit-jobs' }),
          }),
        },
      },
      env: {},
      log: {
        debug: sandbox.spy(),
        info: sandbox.spy(),
        warn: sandbox.spy(),
        error: sandbox.spy(),
      },
      runtime: { region: 'us-east-1' },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('normalizes a DRS SNS notification into audit worker format', async () => {
    const drsMessage = {
      event_type: 'JOB_COMPLETED',
      job_id: 'drs-job-123',
      provider_id: 'prompt_generation_base_url',
      result_location: 's3://bucket/results.json',
      metadata: {
        site_id: 'site-123',
        source: 'onboarding',
        brand: 'TestBrand',
      },
    };

    context.invocation = {
      event: {
        Records: [{ body: JSON.stringify(drsMessage) }],
      },
    };

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    // Verify sqs.sendMessage was called (handler triggers llmo-customer-analysis)
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    const [, sentMessage] = context.sqs.sendMessage.firstCall.args;
    expect(sentMessage.type).to.equal('llmo-customer-analysis');
    expect(sentMessage.siteId).to.equal('site-123');
  });

  it('passes brand_presence_batch_id through normalization', async () => {
    const drsMessage = {
      event_type: 'JOB_COMPLETED',
      job_id: 'drs-job-bp',
      provider_id: 'prompt_generation_base_url',
      result_location: 's3://bucket/results.json',
      metadata: {
        site_id: 'site-123',
        source: 'onboarding',
        brand: 'TestBrand',
        brand_presence_batch_id: 'bp-onboarding-drs-job-bp',
      },
    };

    context.invocation = {
      event: {
        Records: [{ body: JSON.stringify(drsMessage) }],
      },
    };

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(200);
    expect(context.log.info).to.have.been.calledWith(
      sinon.match('Received drs:prompt_generation_base_url audit request'),
      sinon.match({
        auditContext: sinon.match({
          brandPresenceBatchId: 'bp-onboarding-drs-job-bp',
        }),
      }),
    );
  });

  it('returns 404 for DRS message with unknown provider_id', async () => {
    const drsMessage = {
      event_type: 'JOB_COMPLETED',
      job_id: 'drs-job-456',
      provider_id: 'unknown_provider',
      result_location: 's3://bucket/results.json',
      metadata: { site_id: 'site-123' },
    };

    context.invocation = {
      event: {
        Records: [{ body: JSON.stringify(drsMessage) }],
      },
    };

    const resp = await main(new Request('https://space.cat'), context);

    expect(resp.status).to.equal(404);
    expect(context.log.error).to.have.been.calledWith('no such audit type: drs:unknown_provider');
  });
});
