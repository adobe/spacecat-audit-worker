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
import { getObjectKeysUsingPrefix, getObjectFromKey } from '../../src/utils/s3-utils.js';

use(chaiAsPromised);

describe('S3 Utility Functions', () => {
  const logMock = {
    error: () => {},
  };

  describe('getObjectKeysUsingPrefix', () => {
    it('should return a list of object keys when S3 returns data', async () => {
      const bucketName = 'test-bucket';
      const prefix = 'test-prefix';
      const expectedKeys = ['file1.txt', 'file2.txt'];

      const s3ClientMock = {
        send: async () => ({
          Contents: expectedKeys.map((key) => ({ Key: key })),
        }),
      };

      const keys = await getObjectKeysUsingPrefix(s3ClientMock, bucketName, prefix, logMock);
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

      const keys = await getObjectKeysUsingPrefix(s3ClientMock, bucketName, prefix, logMock2);
      expect(keys).to.deep.equal([]);
    });
  });

  describe('getObjectFromKey', () => {
    it('should return the S3 object when getObject succeeds', async () => {
      const bucketName = 'test-bucket';
      const key = 'test-key';
      const expectedObject = { Body: { transformToString: () => '{"tags": {"title": "sample-title"}}' } };

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

    it('should return null and log an error when getObject fails', async () => {
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
