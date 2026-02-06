/*
 * Copyright 2023 Adobe. All rights reserved.
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

import { main } from './utils.js';

use(sinonChai);

const sandbox = sinon.createSandbox();

describe('Index Tests', () => {
  const request = new Request('https://space.cat');
  let context;
  let messageBodyJson;

  beforeEach('setup', () => {
    process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs22.x';
    messageBodyJson = {
      type: 'dummy',
      url: 'site-id',
      auditContext: {
        key: 'value',
      },
    };
    context = {
      dataAccess: {},
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
    };
  });

  afterEach('clean', () => {
    sandbox.restore();
  });

  it('requests without a valid event payload are rejected', async () => {
    delete context.invocation;
    const resp = await main(request, context);

    expect(resp.status).to.equal(400);
    expect(resp.headers.get('x-error')).to.equal('Event does not contain any records');
  });

  it('rejects when a message received with unknown type audit', async () => {
    messageBodyJson.type = 'unknown-type';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    const errorSpy = sandbox.spy(console, 'error');
    const resp = await main(request, context);

    expect(resp.status).to.equal(404);
    // Check that an error containing 'no such audit type: unknown-type' was logged
    expect(errorSpy.args.some((args) => args.some(
      (arg) => (typeof arg === 'string' && arg.includes('no such audit type: unknown-type'))
        || (typeof arg === 'object' && arg?.message?.includes('no such audit type: unknown-type')),
    ))).to.be.true;
  });

  it('rejects when a new type audit fails', async () => {
    messageBodyJson.type = 'apex';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    const resp = await main(request, context);
    expect(resp.status).to.equal(500);
  });

  it('happy path', async () => {
    const resp = await main(request, context);
    expect(resp.status).to.equal(200);
  });

  it('logs abort information when message contains abort property (covers line 227)', async () => {
    const infoSpy = sandbox.spy(console, 'info');
    messageBodyJson.abort = {
      reason: 'bot-protection',
      details: {
        blockedUrlsCount: 5,
        totalUrlsCount: 10,
      },
    };
    messageBodyJson.jobId = 'test-job-123';
    messageBodyJson.siteId = 'test-site-456';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);

    const resp = await main(request, context);

    expect(resp.status).to.equal(200);
    // Verify that log.info was called with message object containing abort information
    const logCall = infoSpy.args.find((args) => args[1]?.abort);
    expect(logCall).to.exist;
    expect(logCall[1]).to.have.property('abort');
    expect(logCall[1].abort.reason).to.equal('bot-protection');
    expect(logCall[1].jobId).to.equal('test-job-123');
    expect(logCall[1].siteId).to.equal('test-site-456');
  });
});
