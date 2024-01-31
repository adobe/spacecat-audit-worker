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
import { expectedCogsResult, expectedCOGSValue } from '../fixtures/cogs-data.js';

chai.use(sinonChai);
chai.use(chaiAsPromised);
const { expect } = chai;

const sandbox = sinon.createSandbox();

describe('cogs handler test', () => {
  let context;
  let messageBodyJson;
  const COGS_RESULT_MONTH_YEAR = 'Dec-23';
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

  it('raise error, when missing startDate input', async () => {
    delete messageBodyJson.startDate;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, { message: 'Start time  is invalid. Valid format is: yyyy-MM-dd' });
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(500);
  });
  it('raise error, , when missing endDate input', async () => {
    delete messageBodyJson.endDate;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, { message: 'End time  is invalid. Valid format is: yyyy-MM-dd' });
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(500);
  });
  it('raise error, when both startDate and endDate are missing in input', async () => {
    delete messageBodyJson.startDate;
    delete messageBodyJson.endDate;
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, { message: 'Time  is invalid. Valid format is: yyyy-MM-dd' });
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(500);
  });
  it('should pass on correct inputs', async () => {
    messageBodyJson.startDate = '2023-12-01';
    messageBodyJson.endDate = '2024-01-01';
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, expectedCogsResult);
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(204);
    expect(context.sqs.sendMessage).to.have.been.calledOnce;
    expect(context.sqs.sendMessage).to.have.been
      .calledWith(COGS_RESULT_MONTH_YEAR, expectedCOGSValue);
  });
  it('test for new service data', async () => {
    expectedCogsResult.ResultsByTime[0].Groups.push({
      Keys: [
        'AmazonNewService',
        'Environment$',
      ],
      Metrics: {
        UnblendedCost: {
          Amount: '0.049616647',
          Unit: 'USD',
        },
      },
    });
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, expectedCogsResult);
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(204);
  });
  it('test for empty group data set', async () => {
    expectedCogsResult.ResultsByTime[0].Groups = [];
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, expectedCogsResult);
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(404);
  });
  it('test for empty data set', async () => {
    expectedCogsResult.ResultsByTime = [];
    nock('https://ce.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, expectedCogsResult);
    const result = await main(messageBodyJson, context);
    expect(result.status).to.be.equal(404);
  });
});
