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

import assert from 'assert';
import esmock from 'esmock';
import SqsClientMock from './sqs-client-mock.js';
import SQSQueue from '../src/sqs-queue.js';

describe('SQSQueue Tests', () => {
  const region = 'test-region';
  const queueUrl = 'https://queue-url';
  const messageId = 'testMessageId';

  let mockContext;
  let logInfo = '';
  let logError = '';

  beforeEach(() => {
    mockContext = {
      attributes: {
        queueUrl,
      },
      region,
      log: {
        info: (message) => {
          logInfo = message;
        },
        error: (message) => {
          logError = message;
        },
      },
    };
  });

  it('should initialize with provided context', () => {
    const queue = new SQSQueue(mockContext);
    assert.strictEqual(queue.queueUrl, mockContext.attributes.queueUrl);
    assert.strictEqual(queue.log, mockContext.log);
    assert.strictEqual(logInfo, `Creating SQS client in region ${region}`);
  });

  it('should send a message to the queue and log success', async () => {
    const SQSQueueMock = await esmock('../src/sqs-queue.js', {
      '@aws-sdk/client-sqs': {
        SQSClient: SqsClientMock,
      },
    });
    const queue = new SQSQueueMock(mockContext);
    await queue.sendAuditResult('test message');
    assert.strictEqual(logInfo, `Success, message sent. MessageID: ${messageId}`);
  });

  it('should throw an error, when sending a message to the queue fails', async () => {
    const SQSQueueMock = await esmock('../src/sqs-queue.js', {
      '@aws-sdk/client-sqs': {
        SQSClient: SqsClientMock,
      },
    });
    const queue = new SQSQueueMock(mockContext);
    try {
      await queue.sendAuditResult('error test message');
      assert.fail('Expected SQLClient to throw an error');
    } catch (error) {
      assert.strictEqual(logError, 'Error: SQSClient.send encountered an error');
    }
  });
});
