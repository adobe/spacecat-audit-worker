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
    nock.disableNetConnect();
    context = {
      log: console,
      runtime: {
        region: 'us-east-1',
      },
    };
  });

  afterEach('clean', () => {
    sandbox.restore();
    nock.cleanAll();
    nock.enableNetConnect();
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
      await ctx.sqs.sendMessage('https://sqs.us-east-1.amazonaws.com/123456789/test-queue', { key: 'value' });
    }).with(sqsWrapper);

    await expect(action({}, context)).to.be.rejectedWith(errorResponse.message);

    const errorMessage = `Message send failed. Type: ${errorResponse.type}, Code: ${errorResponse.code}, Message: ${errorResponse.message}`;
    expect(errorSpy).to.have.been.calledWith(errorMessage);
  });

  it('initialize and use a new sqs if not initialized before', async () => {
    const messageId = 'message-id';
    const message = { key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
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

    expect(logSpy).to.have.been.calledWith(`Success, message sent. Queue: test-queue, Type: unknown, MessageID: ${messageId}`);
  });

  it('automatically adds traceId from context to message', async () => {
    const message = { key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    const traceId = '1-69665d08-b1edce7e1f49715d3a7d6957';
    context.traceId = traceId;

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        const parsedMessage = JSON.parse(MessageBody);
        expect(parsedMessage.traceId).to.equal(traceId);
        expect(parsedMessage.key).to.equal(message.key);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('does not overwrite existing traceId in message', async () => {
    const existingTraceId = '1-existing-trace-id';
    const message = { key: 'value', traceId: existingTraceId };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    context.traceId = '1-context-trace-id';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        const parsedMessage = JSON.parse(MessageBody);
        expect(parsedMessage.traceId).to.equal(existingTraceId);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('works without traceId when context.traceId is undefined', async () => {
    const message = { key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    // context.traceId is undefined

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        const parsedMessage = JSON.parse(MessageBody);
        expect(parsedMessage.traceId).to.be.undefined;
        expect(parsedMessage.key).to.equal(message.key);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('auto-extracts type as MessageGroupId for fair queuing', async () => {
    const message = { type: 'backlinks', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageGroupId).to.equal('backlinks');
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('explicit msgGroupId takes precedence over type', async () => {
    const message = { type: 'backlinks', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageGroupId).to.equal('custom-group');
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message, 'custom-group');
    }).with(sqsWrapper)({}, context);
  });

  it('does not set MessageGroupId when no type and no explicit groupId', async () => {
    const message = { key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageGroupId).to.be.undefined;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('includes MessageDeduplicationId when an explicit msgDedupId is provided', async () => {
    const message = { type: 'agentic_traffic', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/analytics-queue.fifo';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageDeduplicationId).to.equal('batch-uuid-abc');
        expect(parsed.MessageGroupId).to.equal('agentic_traffic:site-1');
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message, 'agentic_traffic:site-1', 0, 'batch-uuid-abc');
    }).with(sqsWrapper)({}, context);
  });

  it('omits MessageDeduplicationId when no msgDedupId is provided', async () => {
    const message = { type: 'agentic_traffic', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/analytics-queue.fifo';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageDeduplicationId).to.be.undefined;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);
  });

  it('omits MessageDeduplicationId on a standard (non-.fifo) queue even if msgDedupId is provided', async () => {
    // Standard queues reject MessageDeduplicationId with InvalidParameterValue.
    // The same code path runs both before and after a queue is converted to
    // FIFO; the FIFO-suffix gate keeps it safe in either state.
    const message = { type: 'agentic_traffic', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/analytics-queue';

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const parsed = JSON.parse(body);
        expect(parsed.MessageDeduplicationId).to.be.undefined;
        // MessageGroupId is still set — standard queues now accept it for fair queuing.
        expect(parsed.MessageGroupId).to.equal('agentic_traffic:site-1');
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(parsed.MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message, 'agentic_traffic:site-1', 0, 'batch-uuid-abc');
    }).with(sqsWrapper)({}, context);
  });

  it('includes DedupID in log when msgDedupId is set', async () => {
    const message = { type: 'agentic_traffic', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/analytics-queue.fifo';
    const logSpy = sandbox.spy(context.log, 'info');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message, 'agentic_traffic:site-1', 0, 'batch-uuid-abc');
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith(
      'Success, message sent. Queue: analytics-queue.fifo, Type: agentic_traffic, MessageID: message-id, GroupID: agentic_traffic:site-1, DedupID: batch-uuid-abc',
    );
  });

  it('includes GroupID in log when MessageGroupId is set', async () => {
    const message = { type: 'accessibility', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    const logSpy = sandbox.spy(context.log, 'info');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith(
      'Success, message sent. Queue: test-queue, Type: accessibility, MessageID: message-id, GroupID: accessibility',
    );
  });

  it('includes TraceID and GroupID in log when both context traceId and message type are set', async () => {
    const traceId = '1-trace-for-both-branches';
    context.traceId = traceId;
    const message = { type: 'guidance:reddit-analysis', key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    const logSpy = sandbox.spy(context.log, 'info');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith(
      `Success, message sent. Queue: test-queue, Type: guidance:reddit-analysis, MessageID: message-id, TraceID: ${traceId}, GroupID: guidance:reddit-analysis`,
    );
  });

  it('uses unknown as fallback when queueUrl is null or undefined', async () => {
    const message = { key: 'value' };
    const logSpy = sandbox.spy(context.log, 'info');

    // Mock any POST request to SQS endpoint - AWS SDK v3 may format requests
    // differently when queueUrl is null
    nock('https://sqs.us-east-1.amazonaws.com')
      .post(/.*/)
      .reply(200, (uri, body) => {
        // Parse body - AWS SDK v3 sends JSON with MessageBody field
        const parsedBody = JSON.parse(body);
        // Extract MessageBody from the actual request to calculate correct MD5
        const { MessageBody } = parsedBody;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    // Also mock localhost:4566 (LocalStack) in case SDK tries to use it when queueUrl is null
    nock('http://localhost:4566')
      .post(/.*/)
      .reply(200, (uri, body) => {
        const parsedBody = JSON.parse(body);
        const { MessageBody } = parsedBody;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(null, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith('Success, message sent. Queue: unknown, Type: unknown, MessageID: message-id');
  });

  it('uses unknown as queue name when URL trailing slash yields empty last segment', async () => {
    const message = { key: 'value' };
    const queueUrl = 'https://sqs.us-east-1.amazonaws.com/123456789/';
    const logSpy = sandbox.spy(context.log, 'info');

    nock('https://sqs.us-east-1.amazonaws.com')
      .post('/')
      .reply(200, (_, body) => {
        const { MessageBody } = JSON.parse(body);
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(queueUrl, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith('Success, message sent. Queue: unknown, Type: unknown, MessageID: message-id');
  });

  it('uses unknown as fallback when queueUrl is undefined', async () => {
    const message = { key: 'value' };
    const logSpy = sandbox.spy(context.log, 'info');

    // Mock any POST request to SQS endpoint
    nock('https://sqs.us-east-1.amazonaws.com')
      .post(/.*/)
      .reply(200, (uri, body) => {
        // Parse body - AWS SDK v3 sends JSON with MessageBody field
        const parsedBody = JSON.parse(body);
        // Extract MessageBody from the actual request to calculate correct MD5
        const { MessageBody } = parsedBody;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    // Also mock localhost:4566 (LocalStack) in case SDK tries to use it
    nock('http://localhost:4566')
      .post(/.*/)
      .reply(200, (uri, body) => {
        const parsedBody = JSON.parse(body);
        const { MessageBody } = parsedBody;
        return {
          MessageId: 'message-id',
          MD5OfMessageBody: crypto.createHash('md5').update(MessageBody, 'utf-8').digest('hex'),
        };
      });

    await wrap(async (req, ctx) => {
      await ctx.sqs.sendMessage(undefined, message);
    }).with(sqsWrapper)({}, context);

    expect(logSpy).to.have.been.calledWith('Success, message sent. Queue: unknown, Type: unknown, MessageID: message-id');
  });
});
