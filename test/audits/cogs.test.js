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
import main from '../../src/cogs/handler.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const sandbox = sinon.createSandbox();

describe('cogs handler test', () => {
  let context;
  let messageBodyJson;
  beforeEach('setup', () => {
    messageBodyJson = {
      type: 'cogs',
      startDate: '2023-12-01',
      endDate: '2024-01-01',
    };
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
    };
  });
  afterEach('clean', () => {
    sandbox.restore();
  });

  it('reject when missing or wrong startDate', async () => {
    delete messageBodyJson.startDate;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'ValidationException: Start time  is invalid. Valid format is: yyyy-MM-dd.');
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(500);
  });
  it('reject when missing or wrong endDate', async () => {
    delete messageBodyJson.endDate;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, 'ValidationException: End time  is invalid. Valid format is: yyyy-MM-dd.');
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(500);
  });
  it('check for starting date of January', async () => {
    messageBodyJson.startDate = '2024-01-01';
    messageBodyJson.endDate = '2024-02-01';
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(messageBodyJson, context)).to.be.fulfilled;
  });
  it('check for starting date of December', async () => {
    messageBodyJson.startDate = '2023-12-01';
    messageBodyJson.endDate = '2024-01-01';
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(messageBodyJson, context)).to.be.fulfilled;
  });
  it('should pass on trigger cogs audit', async () => {
    messageBodyJson.startDate = '2023-12-01';
    messageBodyJson.endDate = '2024-01-01';
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, 'OK');
    await expect(main(messageBodyJson, context)).to.be.fulfilled;
  });
});
