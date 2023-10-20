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
import queueWrapper from '../src/queue-wrapper.js';
import SQSQueue from '../src/sqs-queue.js';

describe('Queue Wrapper Tests', () => {
  let mockFunc;
  let mockRequest;
  let mockContext;

  beforeEach(() => {
    mockFunc = async () => {};
    mockRequest = {};
    mockContext = {
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'queue-url',
      },
      attributes: {},
      region: 'test-region',
      log: {
        info: () => {},
        error: () => {},
      },
    };
  });

  it('should throw error if queue url is not provided', async () => {
    mockContext.env.AUDIT_RESULTS_QUEUE_URL = null;

    try {
      await queueWrapper(mockFunc)(mockRequest, mockContext);
      assert.fail('Expected error to be thrown');
    } catch (error) {
      assert.strictEqual(error.message, 'AUDIT_RESULTS_QUEUE_URL env variable is empty/not provided');
    }
  });

  it('should set queue url in context attributes', async () => {
    await queueWrapper(mockFunc)(mockRequest, mockContext);
    assert.strictEqual(mockContext.attributes.queueUrl, 'queue-url');
  });

  it('should create queue if not present in context', async () => {
    await queueWrapper(mockFunc)(mockRequest, mockContext);
    assert(mockContext.queue instanceof SQSQueue, 'context.queue was not correctly instantiated.');
  });

  it('should not re-initialize queue if already present in context', async () => {
    const mockQueue = new SQSQueue(mockContext);
    mockContext.queue = mockQueue;

    await queueWrapper(mockFunc)(mockRequest, mockContext);

    assert.strictEqual(mockContext.queue, mockQueue, 'context.queue was re-initialized.');
  });
});
