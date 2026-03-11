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
  saveBatchResults,
  updateCache,
  loadCache,
  markBatchCompleted,
  isBatchCompleted,
  loadAllBatchResults,
  cleanupBatchState,
  getTimeoutStatus,
  loadFinalResults,
  BATCH_TIMEOUT_CONFIG,
} from '../../../src/internal-links/batch-state.js';

use(sinonChai);
use(chaiAsPromised);

describe('Batch State Module - Hybrid Storage', () => {
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

  describe('saveBatchResults', () => {
    it('should save batch results to S3', async () => {
      mockS3Client.send.resolves({});

      const results = [
        { urlFrom: 'https://example.com', urlTo: 'https://example.com/broken' },
      ];

      await saveBatchResults(TEST_AUDIT_ID, 1, results, 10, mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      const putCall = mockS3Client.send.firstCall.args[0];
      expect(putCall.input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json',
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Saved batch 1: 1 results, 10 pages/),
      );
    });

    it('should throw error on S3 save failure', async () => {
      mockS3Client.send.rejects(new Error('S3 Error'));

      await expect(saveBatchResults(TEST_AUDIT_ID, 1, [], 0, mockContext))
        .to.be.rejectedWith('S3 Error');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Failed to save batch 1/),
      );
    });
  });

  describe('updateCache', () => {
    it('should create new cache when none exists', async () => {
      const noKeyError = new Error('NoSuchKey');
      noKeyError.name = 'NoSuchKey';
      mockS3Client.send.onFirstCall().rejects(noKeyError);
      mockS3Client.send.onSecondCall().resolves({});

      await updateCache(TEST_AUDIT_ID, ['broken1'], ['working1'], mockContext);

      expect(mockS3Client.send).to.have.been.calledTwice;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cache updated.*1 broken, 1 working/),
      );
    });

    it('should merge with existing cache', async () => {
      const existingCache = {
        broken: ['existing-broken'],
        working: ['existing-working'],
      };

      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      await updateCache(TEST_AUDIT_ID, ['new-broken'], ['new-working'], mockContext);

      expect(mockS3Client.send).to.have.been.calledTwice;
      const putCall = mockS3Client.send.secondCall.args[0];
      expect(putCall.input.IfMatch).to.equal('"etag-123"');
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cache updated.*2 broken, 2 working/),
      );
    });

    it('should retry on PreconditionFailed', async () => {
      const existingCache = { broken: ['b1'], working: ['w1'] };

      // First attempt: load succeeds, put fails with PreconditionFailed
      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"old-etag"',
      });
      const preconditionError = new Error('PreconditionFailed');
      preconditionError.name = 'PreconditionFailed';
      mockS3Client.send.onCall(1).rejects(preconditionError);

      // Second attempt: load with updated cache, put succeeds
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            broken: ['b1', 'b2'],
            working: ['w1', 'w2'],
          })),
        },
        ETag: '"new-etag"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await updateCache(TEST_AUDIT_ID, ['b3'], ['w3'], mockContext);

      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Cache conflict.*attempt 1.*retrying/),
      );
    });

    it('should deduplicate URLs in cache', async () => {
      const noKeyError = new Error('NoSuchKey');
      noKeyError.name = 'NoSuchKey';
      mockS3Client.send.onFirstCall().rejects(noKeyError);
      mockS3Client.send.onSecondCall().resolves({});

      // Add duplicate URLs
      await updateCache(
        TEST_AUDIT_ID,
        ['broken1', 'broken1', 'broken2'],
        ['working1', 'working1'],
        mockContext,
      );

      const putCall = mockS3Client.send.secondCall.args[0];
      const savedData = JSON.parse(putCall.input.Body);
      expect(savedData.broken).to.have.lengthOf(2);
      expect(savedData.working).to.have.lengthOf(1);
    });

    it('should throw error after max retries exhausted', async () => {
      const existingCache = { broken: [], working: [] };
      const preconditionError = new Error('PreconditionFailed');
      preconditionError.name = 'PreconditionFailed';

      // All attempts fail with PreconditionFailed
      mockS3Client.send.callsFake(async (command) => {
        const commandName = command.constructor.name;
        if (commandName === 'GetObjectCommand') {
          return {
            Body: {
              transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
            },
            ETag: '"etag"',
          };
        }
        // All PUT attempts fail
        throw preconditionError;
      });

      await expect(updateCache(TEST_AUDIT_ID, ['b1'], ['w1'], mockContext))
        .to.be.rejectedWith('PreconditionFailed');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Cache update failed after 5 attempts: PreconditionFailed/),
      );
    });

    it('should throw error when maxRetries is 0', async () => {
      // Edge case: maxRetries = 0 means no attempts
      await expect(updateCache(TEST_AUDIT_ID, ['b1'], ['w1'], mockContext, 0))
        .to.be.rejectedWith('Failed to update cache after 0 attempts');
    });
  });

  describe('loadCache', () => {
    it('should load existing cache', async () => {
      const cache = {
        broken: ['broken1', 'broken2'],
        working: ['working1'],
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(cache)),
        },
      });

      const result = await loadCache(TEST_AUDIT_ID, mockContext);

      expect(result.brokenUrlsCache).to.have.lengthOf(2);
      expect(result.workingUrlsCache).to.have.lengthOf(1);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Loaded cache: 2 broken, 1 working/),
      );
    });

    it('should return empty cache when none exists', async () => {
      const noKeyError = new Error('NoSuchKey');
      noKeyError.name = 'NoSuchKey';
      mockS3Client.send.rejects(noKeyError);

      const result = await loadCache(TEST_AUDIT_ID, mockContext);

      expect(result.brokenUrlsCache).to.deep.equal([]);
      expect(result.workingUrlsCache).to.deep.equal([]);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/No cache found/),
      );
    });

    it('should throw error for non-NoSuchKey S3 errors', async () => {
      const s3Error = new Error('AccessDenied');
      s3Error.name = 'AccessDenied';
      mockS3Client.send.rejects(s3Error);

      await expect(loadCache(TEST_AUDIT_ID, mockContext))
        .to.be.rejectedWith('AccessDenied');
    });

    it('should handle missing broken/working arrays in cache', async () => {
      // Cache without broken/working arrays (fallback to empty arrays)
      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({})),
        },
        ETag: '"etag-123"',
      });

      const result = await loadCache(TEST_AUDIT_ID, mockContext);

      expect(result.brokenUrlsCache).to.deep.equal([]);
      expect(result.workingUrlsCache).to.deep.equal([]);
    });
  });

  describe('markBatchCompleted', () => {
    it('should mark batch as completed', async () => {
      const noKeyError = new Error('NoSuchKey');
      noKeyError.name = 'NoSuchKey';
      mockS3Client.send.onFirstCall().rejects(noKeyError);
      mockS3Client.send.onSecondCall().resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      expect(mockS3Client.send).to.have.been.calledTwice;
      const putCall = mockS3Client.send.secondCall.args[0];
      const savedData = JSON.parse(putCall.input.Body);
      expect(savedData.completed).to.deep.equal([1]);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Marked batch 1 as completed/),
      );
    });

    it('should add to existing completed batches', async () => {
      const existing = { completed: [0, 1, 2] };

      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existing)),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 3, mockContext);

      const putCall = mockS3Client.send.secondCall.args[0];
      const savedData = JSON.parse(putCall.input.Body);
      expect(savedData.completed).to.deep.equal([0, 1, 2, 3]);
    });

    it('should deduplicate batch numbers', async () => {
      const existing = { completed: [0, 1] };

      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existing)),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      const putCall = mockS3Client.send.secondCall.args[0];
      const savedData = JSON.parse(putCall.input.Body);
      expect(savedData.completed).to.deep.equal([0, 1]);
    });

    it('should throw error after max retries for markBatchCompleted', async () => {
      const existing = { completed: [0] };
      const preconditionError = new Error('PreconditionFailed');
      preconditionError.name = 'PreconditionFailed';

      // All attempts fail with PreconditionFailed
      mockS3Client.send.callsFake(async (command) => {
        const commandName = command.constructor.name;
        if (commandName === 'GetObjectCommand') {
          return {
            Body: {
              transformToString: () => Promise.resolve(JSON.stringify(existing)),
            },
            ETag: '"etag"',
          };
        }
        // All PUT attempts fail
        throw preconditionError;
      });

      await expect(markBatchCompleted(TEST_AUDIT_ID, 1, mockContext))
        .to.be.rejectedWith('PreconditionFailed');
    });

    it('should handle missing completed array in completion file', async () => {
      // Completion file without completed array (fallback to empty array)
      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({})),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      const putCall = mockS3Client.send.secondCall.args[0];
      const savedData = JSON.parse(putCall.input.Body);
      expect(savedData.completed).to.deep.equal([1]);
    });
  });

  describe('isBatchCompleted', () => {
    it('should return true if batch is completed', async () => {
      const completed = { completed: [0, 1, 2] };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(completed)),
        },
      });

      const result = await isBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.true;
    });

    it('should return false if batch is not completed', async () => {
      const completed = { completed: [0, 2] };

      mockS3Client.send.resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(completed)),
        },
      });

      const result = await isBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.false;
    });

    it('should return false when no completion file exists', async () => {
      const noKeyError = new Error('NoSuchKey');
      noKeyError.name = 'NoSuchKey';
      mockS3Client.send.rejects(noKeyError);

      const result = await isBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.false;
    });

    it('should return false and log error on S3 error', async () => {
      const s3Error = new Error('S3 Service Error');
      s3Error.name = 'ServiceUnavailable';
      mockS3Client.send.rejects(s3Error);

      const result = await isBatchCompleted(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.false;
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error checking batch completion: S3 Service Error/),
      );
    });
  });

  describe('loadAllBatchResults', () => {
    it('should load all batch results', async () => {
      const batch0 = {
        batchNum: 0,
        results: [{ urlFrom: 'page1', urlTo: 'broken1' }],
        pagesProcessed: 10,
      };
      const batch1 = {
        batchNum: 1,
        results: [{ urlFrom: 'page2', urlTo: 'broken2' }],
        pagesProcessed: 10,
      };

      // Mock listObjectsV2 to return 2 batches
      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json' },
        ],
      });

      // Mock getObject calls for each batch (Promise.all runs them in parallel)
      mockS3Client.send.onCall(1).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch0)),
        },
      });
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch1)),
        },
      });

      const results = await loadAllBatchResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.have.lengthOf(2);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Loading 2 batch files/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Merged 2 batches: 2 unique broken links/),
      );
    });

    it('should return empty array when no batch files exist', async () => {
      mockS3Client.send.resolves({ Contents: [] });

      const results = await loadAllBatchResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.deep.equal([]);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/No batch files found/),
      );
    });

    it('should deduplicate results from multiple batches', async () => {
      const batch0 = {
        batchNum: 0,
        results: [
          { urlFrom: 'page1', urlTo: 'broken1' },
          { urlFrom: 'page2', urlTo: 'broken2' },
        ],
      };
      const batch1 = {
        batchNum: 1,
        results: [
          { urlFrom: 'page1', urlTo: 'broken1' }, // Duplicate
          { urlFrom: 'page3', urlTo: 'broken3' },
        ],
      };

      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json' },
        ],
      });

      mockS3Client.send.onCall(1).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch0)),
        },
      });
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch1)),
        },
      });

      const results = await loadAllBatchResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.have.lengthOf(3); // 3 unique links (duplicate removed)
    });

    it('should throw error when approaching timeout', async () => {
      // Start time 14 minutes ago (approaching 15 min timeout)
      const startTime = Date.now() - (14 * 60 * 1000);

      await expect(loadAllBatchResults(TEST_AUDIT_ID, mockContext, startTime))
        .to.be.rejectedWith('Timeout approaching - cannot complete merge operation');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Approaching timeout, cannot safely load all batch results/),
      );
    });
  });

  describe('cleanupBatchState', () => {
    it('should delete all batch state files', async () => {
      // Mock list response
      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json' },
          { Key: 'broken-internal-links/batch-state/test-audit-123/cache/urls.json' },
        ],
      });

      // Mock delete responses
      mockS3Client.send.onCall(1).resolves({});
      mockS3Client.send.onCall(2).resolves({});
      mockS3Client.send.onCall(3).resolves({});

      await cleanupBatchState(TEST_AUDIT_ID, mockContext);

      // Should call: 1 list + 3 deletes = 4 calls
      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cleaning up 3 files/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cleanup complete/),
      );
    });

    it('should handle delete failures gracefully', async () => {
      mockS3Client.send.rejects(new Error('Delete failed'));

      // Should not throw
      await cleanupBatchState(TEST_AUDIT_ID, mockContext);

      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Cleanup failed/),
      );
    });
  });

  describe('getTimeoutStatus', () => {
    it('should calculate timeout status correctly', () => {
      const startTime = Date.now() - (5 * 60 * 1000); // 5 minutes ago

      const status = getTimeoutStatus(startTime);

      expect(status.elapsed).to.be.closeTo(5 * 60 * 1000, 100);
      expect(status.percentUsed).to.be.closeTo((5 / 15) * 100, 1);
      expect(status.isApproachingTimeout).to.be.false;
      expect(status.safeTimeRemaining).to.be.closeTo(8 * 60 * 1000, 100);
    });

    it('should detect approaching timeout', () => {
      const startTime = Date.now() - (14 * 60 * 1000); // 14 minutes ago

      const status = getTimeoutStatus(startTime);

      expect(status.isApproachingTimeout).to.be.true;
      expect(status.percentUsed).to.be.greaterThan(86);
    });

    it('should handle timeout exceeded', () => {
      const startTime = Date.now() - (16 * 60 * 1000); // 16 minutes ago (exceeded)

      const status = getTimeoutStatus(startTime);

      expect(status.isApproachingTimeout).to.be.true;
      expect(status.safeTimeRemaining).to.be.lessThan(0);
    });
  });

  describe('loadFinalResults', () => {
    it('should delegate to loadAllBatchResults', async () => {
      const batch0 = {
        batchNum: 0,
        results: [{ urlFrom: 'page1', urlTo: 'broken1' }],
      };

      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
        ],
      });
      mockS3Client.send.onCall(1).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch0)),
        },
      });

      const results = await loadFinalResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.have.lengthOf(1);
      expect(results[0].urlTo).to.equal('broken1');
    });
  });

  describe('BATCH_TIMEOUT_CONFIG', () => {
    it('should have correct timeout configuration', () => {
      expect(BATCH_TIMEOUT_CONFIG).to.have.property('LAMBDA_TIMEOUT_MS');
      expect(BATCH_TIMEOUT_CONFIG).to.have.property('TIMEOUT_BUFFER_MS');
      expect(BATCH_TIMEOUT_CONFIG).to.have.property('SAFE_PROCESSING_TIME_MS');

      expect(BATCH_TIMEOUT_CONFIG.LAMBDA_TIMEOUT_MS).to.equal(15 * 60 * 1000);
      expect(BATCH_TIMEOUT_CONFIG.TIMEOUT_BUFFER_MS).to.equal(2 * 60 * 1000);
      expect(BATCH_TIMEOUT_CONFIG.SAFE_PROCESSING_TIME_MS).to.equal(13 * 60 * 1000);
    });
  });
});
