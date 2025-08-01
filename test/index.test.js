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
import { main } from '../src/index.js';

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
    expect(errorSpy).to.have.been.calledWith('no such audit type: unknown-type');
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

  describe('Warmup Handler', () => {
    it('handles warmup requests successfully', async () => {
      messageBodyJson.type = 'warmup';
      messageBodyJson.siteId = 'warmup-site-1';
      messageBodyJson.warmupId = '1';
      context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);

      const infoSpy = sandbox.spy(console, 'info');
      const resp = await main(request, context);

      expect(resp.status).to.equal(200);
      expect(infoSpy).to.have.been.calledWith('Warmup request 1 received for warmup-site-1 - keeping Lambda warm');

      const responseBody = JSON.parse(await resp.text());
      expect(responseBody).to.deep.include({
        status: 'OK',
        message: 'Lambda warmed successfully',
        type: 'warmup',
        warmupId: '1',
        siteId: 'warmup-site-1',
      });
      expect(responseBody.timestamp).to.be.a('string');
    });

    it('handles warmup requests with missing warmupId', async () => {
      messageBodyJson.type = 'warmup';
      messageBodyJson.siteId = 'warmup-site-2';
      // warmupId is missing
      context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);

      const resp = await main(request, context);

      expect(resp.status).to.equal(200);

      const responseBody = JSON.parse(await resp.text());
      expect(responseBody).to.deep.include({
        status: 'OK',
        message: 'Lambda warmed successfully',
        type: 'warmup',
        warmupId: '1', // Should use default value
        siteId: 'warmup-site-2',
      });
    });

    it('handles warmup requests with different warmupId values', async () => {
      messageBodyJson.type = 'warmup';
      messageBodyJson.siteId = 'warmup-site-3';
      messageBodyJson.warmupId = '5';
      context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);

      const resp = await main(request, context);

      expect(resp.status).to.equal(200);

      const responseBody = JSON.parse(await resp.text());
      expect(responseBody).to.deep.include({
        status: 'OK',
        message: 'Lambda warmed successfully',
        type: 'warmup',
        warmupId: '5',
        siteId: 'warmup-site-3',
      });
    });

    it('handles warmup requests with missing siteId', async () => {
      messageBodyJson.type = 'warmup';
      messageBodyJson.warmupId = '3';
      // siteId is missing
      context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);

      const resp = await main(request, context);

      expect(resp.status).to.equal(200);

      const responseBody = JSON.parse(await resp.text());
      expect(responseBody).to.deep.include({
        status: 'OK',
        message: 'Lambda warmed successfully',
        type: 'warmup',
        warmupId: '3',
      });
      expect(responseBody.siteId).to.be.undefined;
    });
  });
});
