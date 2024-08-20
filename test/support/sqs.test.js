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
/* eslint-disable no-unused-expressions */ // expect statements

import wrap from '@adobe/helix-shared-wrap';
import sinon from 'sinon';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import crypto from 'crypto';
import sqsWrapper from '../../src/support/sqs.js';

use(sinonChai);
use(chaiAsPromised);

const sandbox = sinon.createSandbox();

describe('sqs', () => {
  let context;

  beforeEach('setup', () => {
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
    };
  });

  afterEach('clean', () => {
    sandbox.restore();
  });

  it('do not initialize a new sqs if already initialized', async () => {
    const instance = {
      sendMessage: sandbox.stub().resolves(),
    };
    context.sqs = instance;

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage('queue', 'message');
    }).with(sqsWrapper)({}, context);

    expect(instance.sendMessage).to.have.been.calledOnce;
  });

  it('message sending fails', async () => {
    const errorResponse = {
      type: 'Sender',
      code: 'InvalidParameterValue',
      message: 'invalid param',
    };
    const errorSpy = sandbox.spy(context.log, 'error');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(400, errorResponse);

    const action = wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage('queue-url', { key: 'value' });
    }).with(sqsWrapper);

    await expect(action({}, context)).to.be.rejectedWith(errorResponse.message);

    const errorMessage = `Message sent failed. Type: ${errorResponse.type}, Code: ${errorResponse.code}, Message: ${errorResponse.message}`;
    expect(errorSpy).to.have.been.calledWith(errorMessage);
  });

  it('initialize and use a new sqs if not initialized before', async () => {
    const messageId = 'message-id';
    const message = { key: 'value' };
    const queueUrl = 'queue-url';
    const logSpy = sandbox.spy(context.log, 'info');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody, QueueUrl } = JSON.parse(body);
        expect(QueueUrl).to.equal(queueUrl);
        expect(JSON.parse(MessageBody).key).to.equal(message.key);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith(`Success, message sent. MessageID:  ${messageId}`);
  });
});
