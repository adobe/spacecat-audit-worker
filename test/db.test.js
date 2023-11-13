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
import DB from '../src/db.js';
import DBDocClientMock from './dynamo-db-doc-client-mock.js';

describe('DB Tests', () => {
  const region = 'test-region';

  let mockContext;
  let logInfo = '';
  let logError = '';
  const testSite = { domain: 'www.testdomain.com', path: '/testpath' };

  beforeEach(() => {
    mockContext = {
      runtime: { region },
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
    const db = new DB(mockContext);
    assert.strictEqual(db.log, mockContext.log);
  });

  it('should save the successful audit to dynamodb and log success', async () => {
    const DBDocMock = await esmock('../src/db.js', {
      '@aws-sdk/lib-dynamodb': {
        DynamoDBDocumentClient: DBDocClientMock,
      },
    });
    const db = new DBDocMock(mockContext);
    await db.saveAuditIndex(testSite, {
      result: {
        mobile: {
          categories: {
            performance: { score: 0.90 },
            seo: { score: 0.90 },
            'best-practices': { score: 0.90 },
            accessibility: { score: 0.90 },
          },
        },
        desktop: {
          categories: {
            performance: { score: 0.90 },
            seo: { score: 0.90 },
            'best-practices': { score: 0.90 },
            accessibility: { score: 0.90 },
          },
        },
      },
    });
    assert.strictEqual(logInfo, 'Saving successful audit for domain www.testdomain.com saved successfully');
  });

  it('should save the error audit to dynamodb and log success', async () => {
    const DBDocMock = await esmock('../src/db.js', {
      '@aws-sdk/lib-dynamodb': {
        DynamoDBDocumentClient: DBDocClientMock,
      },
    });
    const db = new DBDocMock(mockContext);
    await db.saveAuditError(testSite, {
      error: {
        message: 'Could not run audit for www.testdomain.com',
      },
    });
    assert.strictEqual(logInfo, 'Saving error audit for domain www.testdomain.com saved successfully');
  });

  it('should get the site from dynamodb', async () => {
    const DBDocMock = await esmock('../src/db.js', {
      '@aws-sdk/lib-dynamodb': {
        DynamoDBDocumentClient: DBDocClientMock,
      },
    });
    const db = new DBDocMock(mockContext);
    const site = await db.getSite(testSite.domain, testSite.path);
    assert.strictEqual(logInfo, `Item retrieved successfully: ${testSite}`);
    assert.deepStrictEqual(site, testSite);
  });
});
