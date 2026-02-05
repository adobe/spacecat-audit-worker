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
import {
  getBatchStateKey,
  loadBatchState,
  saveBatchState,
  loadFinalResults,
  cleanupBatchState,
  estimateCacheSize,
  SQS_CACHE_SIZE_LIMIT,
} from '../../../src/internal-links/batch-state.js';

use(sinonChai);
use(chaiAsPromised);

describe('Batch State Module', () => {
  let sandbox;
  let mockS3Client;
  let mockContext;

  const TEST_AUDIT_ID = 'test-audit-123';
  const TEST_BUCKET = 'test-bucket';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockS3Client = {
      send: sandbox.stub(),
    };

    mockContext = {
      s3Client: mockS3Client,
      env: { S3_SCRAPER_BUCKET_NAME: TEST_BUCKET },
      log: {
        info: sandbox.stub(),
        warn: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getBatchStateKey', () => {
    it('should generate correct S3 key for audit ID', () => {
      const key = getBatchStateKey('audit-123');
      expect(key).to.equal('broken-internal-links/batch-state/audit-123/state.json');
    });

    it('should handle different audit IDs', () => {
      const key1 = getBatchStateKey('abc-def-ghi');
      const key2 = getBatchStateKey('xyz-123-456');

      expect(key1).to.equal('broken-internal-links/batch-state/abc-def-ghi/state.json');
      expect(key2).to.equal('broken-internal-links/batch-state/xyz-123-456/state.json');
    });
  });

  describe('loadBatchState', () => {
    it('should load existing state from S3', async () => {
      const existingState = {
        results: [{ urlFrom: 'https://example.com', urlTo: 'https://example.com/broken' }],
        brokenUrlsCache: ['https://example.com/broken'],
        workingUrlsCache: ['https://example.com/working'],
        lastBatchNum: 2,
        totalPagesProcessed: 60,
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingState)),
        },
      });

      const result = await loadBatchState(TEST_AUDIT_ID, mockContext);

      expect(result).to.deep.equal(existingState);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Loaded existing state: 1 results, batch 2/),
      );
    });

    it('should handle state with undefined results property', async () => {
      const stateWithoutResults = {
        brokenUrlsCache: ['https://example.com/broken'],
        workingUrlsCache: ['https://example.com/working'],
        lastBatchNum: 1,
        // results property is missing
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(stateWithoutResults)),
        },
      });

      const result = await loadBatchState(TEST_AUDIT_ID, mockContext);

      // loadBatchState now normalizes the state
      expect(result).to.deep.equal({
        results: [],
        brokenUrlsCache: ['https://example.com/broken'],
        workingUrlsCache: ['https://example.com/working'],
        lastBatchNum: 1,
        totalPagesProcessed: 0,
      });
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Loaded existing state: 0 results/),
      );
    });

    it('should handle state with lastBatchNum as 0 (falsy but valid)', async () => {
      const stateWithZeroBatch = {
        results: [{ url: 'test' }],
        brokenUrlsCache: [],
        workingUrlsCache: [],
        lastBatchNum: 0, // 0 is falsy but valid
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(stateWithZeroBatch)),
        },
      });

      await loadBatchState(TEST_AUDIT_ID, mockContext);

      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Loaded existing state: 1 results, batch 0/),
      );
    });

    it('should handle state with null cache arrays', async () => {
      const stateWithNullCaches = {
        results: null,
        brokenUrlsCache: null,
        workingUrlsCache: null,
        lastBatchNum: 0,
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(stateWithNullCaches)),
        },
      });

      const state = await loadBatchState(TEST_AUDIT_ID, mockContext);

      // loadBatchState normalizes null values to empty arrays
      expect(state.results).to.deep.equal([]);
      expect(state.brokenUrlsCache).to.deep.equal([]);
      expect(state.workingUrlsCache).to.deep.equal([]);
      expect(state.lastBatchNum).to.equal(0);
      expect(state.totalPagesProcessed).to.equal(0);
    });

    it('should return default state when no existing state in S3', async () => {
      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      mockS3Client.send.rejects(error);

      const result = await loadBatchState(TEST_AUDIT_ID, mockContext);

      expect(result).to.deep.equal({
        results: [],
        brokenUrlsCache: [],
        workingUrlsCache: [],
        lastBatchNum: -1,
        totalPagesProcessed: 0,
      });
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/No existing state found/),
      );
    });

    it('should throw error for non-NoSuchKey errors', async () => {
      const error = new Error('Access Denied');
      error.name = 'AccessDenied';
      mockS3Client.send.rejects(error);

      await expect(loadBatchState(TEST_AUDIT_ID, mockContext))
        .to.be.rejectedWith('Access Denied');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Failed to load state/),
      );
    });
  });

  describe('saveBatchState', () => {
    it('should save state to S3', async () => {
      mockS3Client.send.resolves({});

      const stateParams = {
        auditId: TEST_AUDIT_ID,
        results: [{ urlFrom: 'https://example.com', urlTo: 'https://example.com/broken' }],
        brokenUrlsCache: ['https://example.com/broken'],
        workingUrlsCache: ['https://example.com/working'],
        batchNum: 1,
        totalPagesProcessed: 30,
      };

      await saveBatchState(stateParams, mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Saved state: batch 1, 1 results/),
      );
    });

    it('should throw error on S3 save failure', async () => {
      mockS3Client.send.rejects(new Error('S3 Error'));

      const stateParams = {
        auditId: TEST_AUDIT_ID,
        results: [],
        brokenUrlsCache: [],
        workingUrlsCache: [],
        batchNum: 0,
        totalPagesProcessed: 0,
      };

      await expect(saveBatchState(stateParams, mockContext))
        .to.be.rejectedWith('S3 Error');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Failed to save state/),
      );
    });
  });

  describe('loadFinalResults', () => {
    it('should load and return results from state', async () => {
      const state = {
        results: [
          { urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken1' },
          { urlFrom: 'https://example.com/page2', urlTo: 'https://example.com/broken2' },
        ],
        lastBatchNum: 3,
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(state)),
        },
      });

      const results = await loadFinalResults(TEST_AUDIT_ID, mockContext);

      expect(results).to.deep.equal(state.results);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Loaded final results: 2 broken links from 4 batches/),
      );
    });

    it('should return empty array when no state exists', async () => {
      const error = new Error('NoSuchKey');
      error.name = 'NoSuchKey';
      mockS3Client.send.rejects(error);

      const results = await loadFinalResults(TEST_AUDIT_ID, mockContext);

      expect(results).to.deep.equal([]);
    });

    it('should handle state with undefined results', async () => {
      const state = {
        lastBatchNum: 1,
        // results is undefined
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(state)),
        },
      });

      const results = await loadFinalResults(TEST_AUDIT_ID, mockContext);

      expect(results).to.deep.equal([]);
    });
  });

  describe('cleanupBatchState', () => {
    it('should delete state file from S3', async () => {
      mockS3Client.send.resolves({});

      await cleanupBatchState(TEST_AUDIT_ID, mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cleaning up state file/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cleanup complete/),
      );
    });

    it('should handle delete failure gracefully', async () => {
      mockS3Client.send.rejects(new Error('Delete failed'));

      // Should not throw
      await cleanupBatchState(TEST_AUDIT_ID, mockContext);

      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to delete state file/),
      );
    });
  });

  describe('estimateCacheSize', () => {
    it('should calculate combined size of cache arrays', () => {
      const brokenUrls = ['https://example.com/broken1', 'https://example.com/broken2'];
      const workingUrls = ['https://example.com/working1'];

      const size = estimateCacheSize(brokenUrls, workingUrls);

      const expectedSize = JSON.stringify(brokenUrls).length + JSON.stringify(workingUrls).length;
      expect(size).to.equal(expectedSize);
    });

    it('should handle empty arrays', () => {
      const size = estimateCacheSize([], []);
      expect(size).to.equal(4); // "[]" + "[]" = 4 chars
    });

    it('should handle large arrays', () => {
      const brokenUrls = Array.from({ length: 100 }, (_, i) => `https://example.com/broken${i}`);
      const workingUrls = Array.from({ length: 500 }, (_, i) => `https://example.com/working${i}`);

      const size = estimateCacheSize(brokenUrls, workingUrls);

      expect(size).to.be.greaterThan(0);
      expect(size).to.equal(
        JSON.stringify(brokenUrls).length + JSON.stringify(workingUrls).length,
      );
    });
  });

  describe('SQS_CACHE_SIZE_LIMIT', () => {
    it('should be 200KB', () => {
      expect(SQS_CACHE_SIZE_LIMIT).to.equal(200 * 1024);
    });
  });
});
