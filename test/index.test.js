/*
 * Copyright 2021 Adobe. All rights reserved.
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
import { main } from '../src/index.js';

describe('Index Tests', () => {
  let mockContext;
  beforeEach(() => {
    mockContext = {
      runtime: { region: 'test-region' },
      env: {
        AUDIT_RESULTS_QUEUE_URL: 'queue-url',
      },
      attributes: {
      },
      log: {
        info: () => {},
        error: () => {},
      },
    };
  });

  it('index function returns an error if not triggered by an event', async () => {
    const response = await main({}, mockContext);
    assert.strictEqual(response.headers.get('x-error'), 'Action was not triggered by an event');
  });

  it('index function returns an error if event does not contain a message', async () => {
    const eventMockContext = {
      ...mockContext,
      ...{ invocation: { event: { Records: [{ body: {} }] } } },
    };
    const response = await main({}, eventMockContext);
    assert.strictEqual(response.headers.get('x-error'), 'Event does not contain a message body');
  });

  it('index function returns an error if event message does not contain a domain', async () => {
    const eventMockContext = {
      ...mockContext,
      ...{ invocation: { event: { Records: [{ body: { message: '{ "text": "foo" }' } }] } } },
    };
    const response = await main({}, eventMockContext);
    assert.strictEqual(response.headers.get('x-error'), 'Event message does not contain a domain');
  });

  it('index function returns SUCCESS if trigerred by an event that contain a domain', async () => {
    const eventMockContext = {
      ...mockContext,
      ...{ invocation: { event: { Records: [{ body: { message: '{ "domain": "adobe.com" }' } }] } } },
    };
    const response = await main({}, eventMockContext);
    const reader = response.body.getReader();
    const { value } = await reader.read();
    assert.strictEqual(String.fromCharCode(...value), 'SUCCESS');
  });
});
