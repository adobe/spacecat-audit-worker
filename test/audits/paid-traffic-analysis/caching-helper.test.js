/*
 * Copyright 2025 Adobe. All rights reserved.
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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  fileExists,
  addResultJsonToCache,
} from '../../../src/paid-traffic-analysis/caching-helper.js';

use(sinonChai);
use(chaiAsPromised);

describe('Paid Traffic Analysis Caching Helper', () => {
  let sandbox;
  let mockS3;
  let mockLog;
  const testCacheKey = 's3://test-bucket/rum-metrics-compact/cache/site-123/abc123.json';
  const testBucketName = 'test-bucket';
  const testKey = 'rum-metrics-compact/cache/site-123/abc123.json';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockS3 = {
      send: sandbox.stub(),
    };

    mockLog = {
      info: sandbox.spy(),
      debug: sandbox.spy(),
      warn: sandbox.spy(),
      error: sandbox.spy(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('fileExists', () => {
    it('should check if file exists', async () => {
      mockS3.send.resolves({});

      const result = await fileExists(mockS3, testCacheKey, mockLog);

      expect(result).to.be.true;
      expect(mockS3.send).to.have.been.calledOnce;
      const command = mockS3.send.getCall(0).args[0];
      expect(command).to.be.instanceOf(HeadObjectCommand);
      expect(command.input).to.deep.equal({
        Bucket: testBucketName,
        Key: testKey,
      });
    });

    it('should return false when file does not exist', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.name = 'NotFound';
      mockS3.send.rejects(notFoundError);

      const result = await fileExists(mockS3, testCacheKey, mockLog);

      expect(result).to.be.false;
      expect(mockS3.send).to.have.been.calledOnce;
    });

    it('should return false and log warning on other errors', async () => {
      const networkError = new Error('Network error');
      mockS3.send.rejects(networkError);

      const result = await fileExists(mockS3, testCacheKey, mockLog);

      expect(result).to.be.false;
      expect(mockS3.send).to.have.been.calledOnce;
      expect(mockLog.warn).to.have.been.calledWith(
        `Unexpected result when checking cache file existence: ${testCacheKey}`,
        networkError,
      );
    });
  });

  describe('addResultJsonToCache', () => {
    const testData = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];

    it('should successfully cache JSON data', async () => {
      mockS3.send.resolves({});

      await addResultJsonToCache(mockS3, testCacheKey, testData, mockLog);
      expect(mockS3.send).to.have.been.calledOnce;
      const command = mockS3.send.getCall(0).args[0];
      expect(command).to.be.instanceOf(PutObjectCommand);
      expect(mockLog.info).to.have.been.calledWith(
        `Successfully cached result to: ${testCacheKey}`,
      );
    });

    it('should handle empty data', async () => {
      mockS3.send.resolves({});

      await addResultJsonToCache(mockS3, testCacheKey, [], mockLog);
    });

    it('should handle null data', async () => {
      mockS3.send.resolves({});

      await addResultJsonToCache(mockS3, testCacheKey, null, mockLog);
    });

    it('should ignore s3 exception and proceed', async () => {
      mockS3.send.rejects(new Error('S3 failure'));

      await addResultJsonToCache(mockS3, testCacheKey, null, mockLog);
    });
  });
});
