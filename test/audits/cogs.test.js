/*
 * Copyright 2024 Adobe. All rights reserved.
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
import sinon from 'sinon';
import chai from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import { main } from '../../src/index.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const sandbox = sinon.createSandbox();

describe('cogs handler test', () => {
  let context;
  const request = new Request('https://space.cat');
  let messageBodyJson;
  beforeEach('setup', () => {
    messageBodyJson = {
      type: 'cogs',
      startDate: '2023-12-01',
      endDate: '2024-01-01',
      auditContext: {
        finalUrl: 'adobe.com',
      },
    };
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      env: {
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_REGION: 'us-west-2',
      },
      invocation: {
        event: {
          Records: [{
            body: JSON.stringify(messageBodyJson),
          }],
        },
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });
  afterEach('clean', () => {
    sandbox.restore();
  });

  it('cogs call failed on missing AWS_REGION', async () => {
    delete context.env.AWS_REGION;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'UnrecognizedClientException: unrecognized region');
    const result = await main(request, context);
    expect(result.status).to.be.equal(500);
  });
  it('reject when aws credentials are missing or wrong', async () => {
    delete context.env.AWS_ACCESS_KEY_ID;
    delete context.env.AWS_SECRET_ACCESS_KEY;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'UnrecognizedClientException: The security token included in the request is invalid');
    const result = await main(request, context);
    expect(result.status).to.be.equal(500);
  });

  it('reject when missing or wrong startDate', async () => {
    delete messageBodyJson.startDate;
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'ValidationException: Start time  is invalid. Valid format is: yyyy-MM-dd.');
    const result = await main(request, context);
    expect(result.status).to.be.equal(500);
  });
  it('reject when missing or wrong endDate', async () => {
    delete messageBodyJson.endDate;
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'ValidationException: End time  is invalid. Valid format is: yyyy-MM-dd.');
    const result = await main(request, context);
    expect(result.status).to.be.equal(500);
  });
  it('check for starting date of January', async () => {
    messageBodyJson.startDate = '2024-01-01';
    messageBodyJson.endDate = '2024-02-01';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(request, context)).to.be.fulfilled;
  });
  it('check for starting date of December', async () => {
    messageBodyJson.startDate = '2023-12-01';
    messageBodyJson.endDate = '2024-01-01';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(request, context)).to.be.fulfilled;
  });
  it('should pass on trigger cogs audit', async () => {
    messageBodyJson.startDate = '2023-12-01';
    messageBodyJson.endDate = '2024-01-01';
    context.invocation.event.Records[0].body = JSON.stringify(messageBodyJson);
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(request, context)).to.be.fulfilled;
  });
});
