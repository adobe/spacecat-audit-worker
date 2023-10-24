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
import dynamoDBWrapper from '../src/db-wrapper.js';
import DB from '../src/db.js';

describe('DB Wrapper Tests', () => {
  let mockFunc;
  let mockRequest;
  let mockContext;

  beforeEach(() => {
    mockFunc = async () => {};
    mockRequest = {};
    mockContext = {
      attributes: {},
      runtime: {
        region: 'test-region',
      },
      log: {
        info: () => {},
        error: () => {},
      },
    };
  });

  it('should create db if not present in context', async () => {
    await dynamoDBWrapper(mockFunc)(mockRequest, mockContext);
    assert(mockContext.db instanceof DB, 'context.db was not correctly instantiated.');
  });

  it('should not re-initialize db if already present in context', async () => {
    const mockDB = new DB(mockContext);
    mockContext.db = mockDB;

    await dynamoDBWrapper(mockFunc)(mockRequest, mockContext);

    assert.strictEqual(mockContext.db, mockDB, 'context.db was re-initialized.');
  });
});
