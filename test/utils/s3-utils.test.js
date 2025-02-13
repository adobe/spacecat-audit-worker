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

import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../../src/utils/s3-utils.js';

use(chaiAsPromised);

describe('S3 Utility Functions', () => {
  const logMock = {
    info: () => {},
    error: () => {},
  };

  describe('getObjectKeysUsingPrefix', () => {
    it('should throw if params are missing', async () => {
      try {
        await getObjectKeysUsingPrefix(null, null, null, logMock);
        throw new Error('Expected an error but none was thrown.');
      } catch (error) {
        expect(error).to.be.an('error');
        expect(error.message).to.equal('Invalid input parameters in getObjectKeysUsingPrefix: ensure s3Client, bucketName, and prefix are provided.');
      }
    });

    it('should return a list of object keys when S3 returns data', async () => {
      const bucketName = 'test-bucket';
      const prefix = 'test-prefix';
      const expectedKeys = ['scrapes/site-id/blog/page1/scrape.json', 'scrapes/site-id/blog/page2/scrape.json', 'scrapes/site-id/blog/page3/scrape.json'];

      const s3ClientStub = {
        send: sinon.stub(),
      };
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
        })))
        .resolves({
          NextContinuationToken: 'token',
          Contents: [
            { Key: 'scrapes/site-id/blog/page1/scrape.json' },
            { Key: 'scrapes/site-id/blog/page2/scrape.json' },
          ],
        });
      s3ClientStub.send
        .withArgs(sinon.match.instanceOf(ListObjectsV2Command).and(sinon.match.has('input', {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: 'token',
        })))
        .resolves({
          Contents: [
            { Key: 'scrapes/site-id/blog/page3/scrape.json' },
          ],
        });

      const keys = await getObjectKeysUsingPrefix(s3ClientStub, bucketName, prefix, logMock);
      expect(keys).to.deep.equal(expectedKeys);
    });

    it('should return an empty list when S3 returns no data', async () => {
      const bucketName = 'test-bucket';
      const prefix = 'test-prefix';

      const s3ClientMock = {
        send: async () => ({ Contents: [] }),
      };

      const keys = await getObjectKeysUsingPrefix(s3ClientMock, bucketName, prefix, logMock);
      expect(keys).to.deep.equal([]);
    });

    it('should log an error and return an empty list when S3 call fails', async () => {
      const bucketName = 'test-bucket';
      const prefix = 'test-prefix';

      const s3ClientMock = {
        send: async () => {
          throw new Error('S3 error');
        },
      };
      const logMock2 = {
        error: (msg, err) => {
          expect(msg).to.equal(`Error while fetching S3 object keys using bucket ${bucketName} and prefix ${prefix}`);
          expect(err.message).to.equal('S3 error');
        },
      };

      try {
        await getObjectKeysUsingPrefix(s3ClientMock, bucketName, prefix, logMock2);
        throw new Error('Expected an error but none was thrown.');
      } catch (error) {
        expect(error).to.be.an('error');
        expect(error.message).to.equal('S3 error');
      }
    });
  });

  describe('getObjectFromKey', () => {
    it('should return null if params are missing', async () => {
      const response = await getObjectFromKey(null, null, null, logMock);
      expect(response).to.be.null;
    });

    it('should return the S3 object when getObject succeeds', async () => {
      const bucketName = 'test-bucket';
      const key = 'test-key';
      const expectedObject = { Body: { transformToString: () => '{"tags": {"title": "sample-title"}}' }, ContentType: 'application/json' };

      const s3ClientMock = {
        send: () => expectedObject,
      };

      const result = await getObjectFromKey(s3ClientMock, bucketName, key, logMock);
      expect(result).to.deep.equal({
        tags: {
          title: 'sample-title',
        },
      });
    });

    it('should return the raw body if the object is not JSON', async () => {
      const bucketName = 'test-bucket';
      const key = 'test-key.test';
      const expectedObject = { Body: { transformToString: () => 'raw body' }, ContentType: 'abc/def' };

      const s3ClientMock = {
        send: () => expectedObject,
      };

      const result = await getObjectFromKey(s3ClientMock, bucketName, key, logMock);
      expect(result).to.equal('raw body');
    });

    it('should log an error and return null when JSON parsing fails', async () => {
      const bucketName = 'test-bucket';
      const key = 'test-key';

      const s3ClientMock = {
        send: () => ({ Body: { transformToString: () => 'invalid-json' }, ContentType: 'application/json' }),
      };

      const result = await getObjectFromKey(s3ClientMock, bucketName, key, logMock);
      expect(result).to.be.null;
    });

    it('should log an error and return null when getObject fails', async () => {
      const bucketName = 'test-bucket';
      const key = 'test-key';

      const s3ClientMock = {
        send: () => {
          throw new Error('S3 getObject error');
        },
      };
      const logMock2 = {
        error: (msg, err) => {
          expect(msg).to.equal(`Error while fetching S3 object from bucket ${bucketName} using key ${key}`);
          expect(err.message).to.equal('S3 getObject error');
        },
      };

      const result = await getObjectFromKey(s3ClientMock, bucketName, key, logMock2);
      expect(result).to.be.null;
    });
  });
});
