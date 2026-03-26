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
  tryStartBatchProcessing,
  releaseBatchProcessingClaim,
  markBatchCompleted,
  isBatchCompleted,
  loadAllBatchResults,
  cleanupBatchState,
  clearWorkflowDispatchReservation,
  getTimeoutStatus,
  loadFinalResults,
  markWorkflowDispatchSent,
  tryAcquireFinalizationLock,
  releaseFinalizationLock,
  BATCH_TIMEOUT_CONFIG,
  reserveWorkflowDispatch,
  saveScrapeResultPaths,
  loadScrapeResultPaths,
  markWorkflowDispatchSentWithRetry,
  tryAcquireExecutionLock,
  releaseExecutionLock,
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

    it('should merge object-type broken cache entries with metadata', async () => {
      const existingCache = {
        broken: [{ url: 'https://example.com/old', httpStatus: 404, statusBucket: '4xx', contentType: 'text/html' }],
        working: ['existing-working'],
      };

      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"etag-obj"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      const newBroken = [{ url: 'https://example.com/new', httpStatus: 500, statusBucket: '5xx', contentType: 'text/html' }];
      await updateCache(TEST_AUDIT_ID, newBroken, ['new-working'], mockContext);

      const putCall = mockS3Client.send.secondCall.args[0];
      const savedBody = JSON.parse(putCall.input.Body);
      expect(savedBody.broken).to.have.lengthOf(2);
      const oldEntry = savedBody.broken.find((e) => e.url === 'https://example.com/old');
      expect(oldEntry.httpStatus).to.equal(404);
      const newEntry = savedBody.broken.find((e) => e.url === 'https://example.com/new');
      expect(newEntry.httpStatus).to.equal(500);
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

    it('should retry on ConditionalCheckFailedException-compatible errors', async () => {
      const existingCache = { broken: ['b1'], working: ['w1'] };

      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"old-etag"',
      });
      const conditionalError = new Error('conditional write conflict');
      conditionalError.name = 'ConditionalCheckFailedException';
      conditionalError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onCall(1).rejects(conditionalError);
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"new-etag"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await updateCache(TEST_AUDIT_ID, ['b2'], ['w2'], mockContext);

      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Cache conflict.*attempt 1.*retrying/),
      );
    });

    it('should retry on PreconditionFailed-compatible error code values', async () => {
      const existingCache = { broken: ['b1'], working: ['w1'] };

      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"old-etag"',
      });
      const conditionalError = new Error('conditional write conflict');
      conditionalError.code = 'PreconditionFailed';
      mockS3Client.send.onCall(1).rejects(conditionalError);
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"new-etag"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await updateCache(TEST_AUDIT_ID, ['b2'], ['w2'], mockContext);

      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Cache conflict.*attempt 1.*retrying/),
      );
    });

    it('should retry when conflict metadata is provided without name or message', async () => {
      const existingCache = { broken: ['b1'], working: ['w1'] };

      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"old-etag"',
      });
      const conditionalError = { code: 'PreconditionFailed' };
      mockS3Client.send.onCall(1).rejects(conditionalError);
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(existingCache)),
        },
        ETag: '"new-etag"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await updateCache(TEST_AUDIT_ID, ['b2'], ['w2'], mockContext);

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

    it('should throw error after max retries exhausted', async function retryExhaustionTest() {
      this.timeout(10000);
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

    it('should retry markBatchCompleted on ConditionalCheckFailedException-compatible errors', async () => {
      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({ completed: [] })),
        },
        ETag: '"etag-1"',
      });
      const conditionalError = new Error('conditional write conflict');
      conditionalError.name = 'ConditionalCheckFailedException';
      conditionalError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onCall(1).rejects(conditionalError);
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({ completed: [] })),
        },
        ETag: '"etag-2"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 2, mockContext);

      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Marked batch 2 as completed/),
      );
    });

    it('should retry markBatchCompleted when error message mentions PreconditionFailed', async () => {
      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({ completed: [] })),
        },
        ETag: '"etag-1"',
      });
      const conditionalError = new Error('PreconditionFailed while writing completion marker');
      mockS3Client.send.onCall(1).rejects(conditionalError);
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({ completed: [] })),
        },
        ETag: '"etag-2"',
      });
      mockS3Client.send.onCall(3).resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 2, mockContext);

      expect(mockS3Client.send).to.have.callCount(4);
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Marked batch 2 as completed/),
      );
    });

    it('should throw nullish errors from markBatchCompleted without treating them as conflicts', async () => {
      mockS3Client.send.onCall(0).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({ completed: [] })),
        },
        ETag: '"etag-1"',
      });
      mockS3Client.send.onCall(1).rejects(undefined);

      await expect(markBatchCompleted(TEST_AUDIT_ID, 2, mockContext)).to.be.rejected;
      expect(mockS3Client.send).to.have.callCount(2);
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

  describe('batch processing claims', () => {
    it('should claim a batch for processing', async () => {
      mockS3Client.send.resolves({ ETag: '"claim-etag"' });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.equal('"claim-etag"');
      expect(mockS3Client.send.firstCall.args[0].input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/claims/batch-1.json',
      );
    });

    it('should throw on non-conflict error during initial claim', async () => {
      const s3Error = new Error('S3 access denied');
      s3Error.name = 'AccessDenied';
      mockS3Client.send.onFirstCall().rejects(s3Error);

      await expect(tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext))
        .to.be.rejectedWith('S3 access denied');
    });

    it('should return null when existing claim not found after conflict', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.null;
    });

    it('should throw when loadBatchClaim fails with non-NoSuchKey error', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const s3Error = new Error('S3 throttled');
      s3Error.name = 'Throttling';
      mockS3Client.send.onSecondCall().rejects(s3Error);

      await expect(tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext))
        .to.be.rejectedWith('S3 throttled');
    });

    it('should return null when batch is already claimed and not stale', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            claimStartedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.null;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/already claimed by another worker/),
      );
    });

    it('should reclaim batch with null claimStartedAt (treated as stale)', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({})),
        },
        ETag: '"etag-null"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaim-etag"' });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.equal('"reclaim-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale batch 1 claim/),
      );
    });

    it('should reclaim batch with invalid claimStartedAt (treated as stale)', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            claimStartedAt: 'not-a-date',
          })),
        },
        ETag: '"etag-bad"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaim-etag"' });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.equal('"reclaim-etag"');
    });

    it('should reclaim a released batch claim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'released',
            releasedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-released"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaim-etag"' });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.equal('"reclaim-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale batch 1 claim/),
      );
    });

    it('should reclaim a stale batch claim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            claimStartedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaim-etag"' });

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.equal('"reclaim-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale batch 1 claim/),
      );
    });

    it('should return null when losing reclaim race for stale batch', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            claimStartedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-stale"',
      });
      mockS3Client.send.onThirdCall().rejects(conflictError);

      const result = await tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext);

      expect(result).to.be.null;
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Lost reclaim race for batch 1/),
      );
    });

    it('should throw on non-conflict error during stale reclaim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            claimStartedAt: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-stale"',
      });
      const s3Error = new Error('S3 internal error');
      s3Error.name = 'InternalError';
      mockS3Client.send.onThirdCall().rejects(s3Error);

      await expect(tryStartBatchProcessing(TEST_AUDIT_ID, 1, mockContext))
        .to.be.rejectedWith('S3 internal error');
    });

    it('should release a batch processing claim with conditional overwrite', async () => {
      mockS3Client.send.resolves({});

      await releaseBatchProcessingClaim(TEST_AUDIT_ID, 1, '"claim-etag"', mockContext);

      const putCall = mockS3Client.send.firstCall.args[0];
      expect(putCall.input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/claims/batch-1.json',
      );
      expect(putCall.input.IfMatch).to.equal('"claim-etag"');
      const body = JSON.parse(putCall.input.Body);
      expect(body.status).to.equal('released');
    });

    it('should fall back to unconditional delete when no claimEtag', async () => {
      mockS3Client.send.resolves({});

      await releaseBatchProcessingClaim(TEST_AUDIT_ID, 1, null, mockContext);

      expect(mockS3Client.send.firstCall.args[0].input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/claims/batch-1.json',
      );
    });

    it('should skip release when claim was reclaimed by another worker', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.rejects(conflictError);

      await releaseBatchProcessingClaim(TEST_AUDIT_ID, 1, '"claim-etag"', mockContext);

      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/claim was reclaimed by another worker/),
      );
    });

    it('should log warning when release fails with non-conflict error', async () => {
      mockS3Client.send.rejects(new Error('S3 write failed'));

      await releaseBatchProcessingClaim(TEST_AUDIT_ID, 1, '"claim-etag"', mockContext);

      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to release batch 1 claim/),
      );
    });
  });

  describe('workflow dispatch markers', () => {
    it('should reserve a workflow dispatch', async () => {
      mockS3Client.send.resolves({});

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'continue-10', mockContext, {
        nextBatchIndex: 10,
      });

      expect(result).to.deep.equal({ acquired: true, state: 'acquired' });
      expect(mockS3Client.send.firstCall.args[0].input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/dispatch/continue-10.json',
      );
    });

    it('should return false when workflow dispatch already sent', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'sent',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'continue-10', mockContext);

      expect(result).to.deep.equal({ acquired: false, state: 'sent' });
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/already sent/),
      );
    });

    it('should return false when existing dispatch not found after conflict', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'gone-key', mockContext);

      expect(result).to.deep.equal({ acquired: false, state: 'unknown' });
    });

    it('should throw when loadDispatch fails with non-NoSuchKey error', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const s3Error = new Error('S3 throttled');
      s3Error.name = 'Throttling';
      mockS3Client.send.onSecondCall().rejects(s3Error);

      await expect(reserveWorkflowDispatch(TEST_AUDIT_ID, 'err-key', mockContext))
        .to.be.rejectedWith('S3 throttled');
    });

    it('should return false when existing dispatch is not stale', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-fresh"',
      });

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'active-key', mockContext);

      expect(result).to.deep.equal({ acquired: false, state: 'pending' });
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/already reserved/),
      );
    });

    it('should reclaim dispatch with null updatedAt (treated as stale)', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
          })),
        },
        ETag: '"etag-no-date"',
      });
      mockS3Client.send.onCall(2).resolves({});

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'null-date', mockContext);

      expect(result).to.deep.equal({ acquired: true, state: 'acquired' });
    });

    it('should reclaim dispatch with invalid updatedAt (treated as stale)', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: 'not-a-date',
          })),
        },
        ETag: '"etag-bad-date"',
      });
      mockS3Client.send.onCall(2).resolves({});

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'bad-date', mockContext);

      expect(result).to.deep.equal({ acquired: true, state: 'acquired' });
    });

    it('should reclaim stale workflow dispatch reservation', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-stale"',
      });
      mockS3Client.send.onCall(2).resolves({});

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'stale-key', mockContext);

      expect(result).to.deep.equal({ acquired: true, state: 'acquired' });
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale workflow dispatch/),
      );
    });

    it('should return false when losing reclaim race for stale dispatch', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-stale"',
      });
      mockS3Client.send.onCall(2).rejects(conflictError);

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'race-key', mockContext);

      expect(result).to.deep.equal({ acquired: false, state: 'pending' });
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Lost workflow dispatch reservation race/),
      );
    });

    it('should throw on non-conflict error during stale reclaim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
          })),
        },
        ETag: '"etag-stale"',
      });
      const s3Error = new Error('S3 internal error');
      s3Error.name = 'InternalError';
      mockS3Client.send.onCall(2).rejects(s3Error);

      await expect(reserveWorkflowDispatch(TEST_AUDIT_ID, 'err-key', mockContext))
        .to.be.rejectedWith('S3 internal error');
    });

    it('should throw on non-conflict error during initial write', async () => {
      const s3Error = new Error('S3 unavailable');
      s3Error.name = 'ServiceUnavailable';
      mockS3Client.send.onFirstCall().rejects(s3Error);

      await expect(reserveWorkflowDispatch(TEST_AUDIT_ID, 'err-key', mockContext))
        .to.be.rejectedWith('S3 unavailable');
    });

    it('should mark a workflow dispatch as sent', async () => {
      mockS3Client.send.resolves({});

      await markWorkflowDispatchSent(TEST_AUDIT_ID, 'continue-10', mockContext, {
        nextBatchIndex: 10,
      });

      const body = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(body.status).to.equal('sent');
      expect(body.nextBatchIndex).to.equal(10);
    });

    it('should clear a pending workflow dispatch reservation', async () => {
      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().resolves({});

      await clearWorkflowDispatchReservation(TEST_AUDIT_ID, 'continue-10', mockContext);

      expect(mockS3Client.send.secondCall.args[0].input.Key).to.equal(
        'broken-internal-links/batch-state/test-audit-123/dispatch/continue-10.json',
      );
      expect(mockS3Client.send.secondCall.args[0].input.IfMatch).to.equal('"etag-123"');
      expect(JSON.parse(mockS3Client.send.secondCall.args[0].input.Body).status).to.equal('cleared');
    });

    it('should immediately reclaim a cleared workflow dispatch reservation', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'cleared',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-cleared"',
      });
      mockS3Client.send.onCall(2).resolves({});

      const result = await reserveWorkflowDispatch(TEST_AUDIT_ID, 'continue-10', mockContext);

      expect(result).to.deep.equal({ acquired: true, state: 'acquired' });
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

    it('should paginate when loading batch files', async () => {
      const batch0 = {
        batchNum: 0,
        results: [{ urlFrom: 'page1', urlTo: 'broken1' }],
      };
      const batch1 = {
        batchNum: 1,
        results: [{ urlFrom: 'page2', urlTo: 'broken2' }],
      };

      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      });
      mockS3Client.send.onCall(1).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json' },
        ],
        IsTruncated: false,
      });
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch0)),
        },
      });
      mockS3Client.send.onCall(3).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify(batch1)),
        },
      });

      const results = await loadAllBatchResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.have.lengthOf(2);
      expect(mockS3Client.send.getCall(1).args[0].input.ContinuationToken).to.equal('page-2');
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

    it('should throw error when timeout is reached while loading a batch page', async () => {
      const startTime = 1;
      const safeWindowMs = 13 * 60 * 1000;

      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
        ],
        IsTruncated: false,
      });

      sandbox.stub(Date, 'now')
        .onFirstCall().returns(startTime + safeWindowMs - 1)
        .onSecondCall().returns(startTime + safeWindowMs + 1);

      await expect(loadAllBatchResults(TEST_AUDIT_ID, mockContext, startTime))
        .to.be.rejectedWith('Timeout approaching while loading batch results');
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

    it('should paginate cleanup listings before deleting files', async () => {
      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
        ],
        IsTruncated: true,
        NextContinuationToken: 'page-2',
      });
      mockS3Client.send.onCall(1).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/cache/urls.json' },
        ],
        IsTruncated: false,
      });
      mockS3Client.send.onCall(2).resolves({});
      mockS3Client.send.onCall(3).resolves({});

      await cleanupBatchState(TEST_AUDIT_ID, mockContext);

      expect(mockS3Client.send.getCall(1).args[0].input.ContinuationToken).to.equal('page-2');
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Cleaning up 2 files/),
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

    it('should prefer Lambda runtime remaining time when available', () => {
      const startTime = Date.now() - (5 * 60 * 1000);
      const runtimeContext = {
        getRemainingTimeInMillis: sandbox.stub().returns(45000),
      };

      const status = getTimeoutStatus(startTime, runtimeContext);

      expect(runtimeContext.getRemainingTimeInMillis).to.have.been.calledOnce;
      expect(status.remaining).to.equal(45000);
      expect(status.safeTimeRemaining).to.equal(-75000);
      expect(status.isApproachingTimeout).to.be.true;
    });

    it('should resolve remaining time from nested lambdaContext', () => {
      const startTime = Date.now() - (5 * 60 * 1000);
      const runtimeContext = {
        lambdaContext: {
          getRemainingTimeInMillis: sandbox.stub().returns(60000),
        },
      };

      const status = getTimeoutStatus(startTime, runtimeContext);

      expect(runtimeContext.lambdaContext.getRemainingTimeInMillis).to.have.been.calledOnce;
      expect(status.remaining).to.equal(60000);
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

    it('should preserve same url pair when itemType differs across batches', async () => {
      const batch0 = {
        batchNum: 0,
        results: [{ urlFrom: 'page1', urlTo: 'broken1', itemType: 'link' }],
      };
      const batch1 = {
        batchNum: 1,
        results: [{ urlFrom: 'page1', urlTo: 'broken1', itemType: 'image' }],
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

      const results = await loadFinalResults(TEST_AUDIT_ID, mockContext, Date.now());

      expect(results).to.have.lengthOf(2);
      expect(results.map((entry) => entry.itemType)).to.have.members(['link', 'image']);
    });
  });

  describe('tryAcquireFinalizationLock', () => {
    it('should acquire lock when no existing lock', async () => {
      mockS3Client.send.resolves({ ETag: '"lock-etag"' });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal('"lock-etag"');
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Acquired finalization lock/),
      );
    });

    it('should return false when lock already held and not stale (conflict)', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: new Date().toISOString(),
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"lock-etag"',
      });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal(null);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Finalization lock already held/),
      );
    });

    it('should reclaim stale finalization lock', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: staleTime,
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"stale-lock-etag"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaimed-lock-etag"' });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal('"reclaimed-lock-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale finalization lock/),
      );
    });

    it('should return false when stale lock reclaim race is lost', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: staleTime,
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"stale-lock-etag"',
      });
      mockS3Client.send.onThirdCall().rejects(conflictError);

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal(null);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Lost finalization lock reclaim race/),
      );
    });

    it('should return false when lock file disappears between conflict and load', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const noSuchKeyError = new Error('NoSuchKey');
      noSuchKeyError.name = 'NoSuchKey';
      mockS3Client.send.onSecondCall().rejects(noSuchKeyError);

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal(null);
    });

    it('should throw on non-conflict error during initial put', async () => {
      const s3Error = new Error('S3 service unavailable');
      s3Error.name = 'ServiceUnavailable';
      mockS3Client.send.rejects(s3Error);

      await expect(tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext))
        .to.be.rejectedWith('S3 service unavailable');
    });

    it('should treat lock with missing acquiredAt as stale and reclaim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"no-acquired-etag"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaimed-lock-etag"' });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal('"reclaimed-lock-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale finalization lock/),
      );
    });

    it('should treat lock with invalid date acquiredAt as stale and reclaim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: 'not-a-date',
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"invalid-date-etag"',
      });
      mockS3Client.send.onThirdCall().resolves({ ETag: '"reclaimed-lock-etag"' });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal('"reclaimed-lock-etag"');
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Reclaimed stale finalization lock/),
      );
    });

    it('should return null when finalization lock has a future expiresAt', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"future-lock-etag"',
      });

      const result = await tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext);

      expect(result).to.equal(null);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Finalization lock already held/),
      );
    });

    it('should throw on non-conflict error during stale reclaim', async () => {
      const conflictError = new Error('PreconditionFailed');
      conflictError.name = 'PreconditionFailed';
      conflictError.$metadata = { httpStatusCode: 412 };
      mockS3Client.send.onFirstCall().rejects(conflictError);
      const staleTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            acquiredAt: staleTime,
            auditId: TEST_AUDIT_ID,
          })),
        },
        ETag: '"stale-lock-etag"',
      });
      const s3Error = new Error('S3 write failed');
      s3Error.name = 'InternalError';
      mockS3Client.send.onThirdCall().rejects(s3Error);

      await expect(tryAcquireFinalizationLock(TEST_AUDIT_ID, mockContext))
        .to.be.rejectedWith('S3 write failed');
    });
  });

  describe('releaseFinalizationLock', () => {
    it('should delete the finalization lock file', async () => {
      mockS3Client.send.resolves({});

      await releaseFinalizationLock(TEST_AUDIT_ID, '"lock-etag"', mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(mockS3Client.send.firstCall.args[0].input.Key).to.include('finalization-lock.json');
      expect(mockS3Client.send.firstCall.args[0].input.IfMatch).to.equal('"lock-etag"');
    });

    it('should skip release when finalization lock was reclaimed by another worker', async () => {
      const conflictError = Object.assign(new Error('PreconditionFailed'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
      mockS3Client.send.rejects(conflictError);

      await releaseFinalizationLock(TEST_AUDIT_ID, '"lock-etag"', mockContext);

      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/was already cleared or reclaimed, skipping release/),
      );
    });

    it('should delete the finalization lock file when no etag is available', async () => {
      mockS3Client.send.resolves({});

      await releaseFinalizationLock(TEST_AUDIT_ID, null, mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(mockS3Client.send.firstCall.args[0].input.Key).to.include('finalization-lock.json');
      expect(mockS3Client.send.firstCall.args[0].input.IfMatch).to.be.undefined;
    });

    it('should log a warning when finalization lock release fails with a non-conflict error', async () => {
      mockS3Client.send.rejects(new Error('release failed'));

      await releaseFinalizationLock(TEST_AUDIT_ID, '"lock-etag"', mockContext);

      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to release finalization lock/),
      );
    });
  });

  describe('execution locks', () => {
    it('should acquire an execution lock when no existing lock is present', async () => {
      mockS3Client.send.resolves({ ETag: '"exec-etag"' });

      const result = await tryAcquireExecutionLock(TEST_AUDIT_ID, 'linkchecker-start', mockContext);

      expect(result).to.equal('"exec-etag"');
      expect(mockContext.log.debug).to.have.been.calledWith(
        sinon.match(/Acquired execution lock/),
      );
    });

    it('should return null when execution lock is already held and not stale', async () => {
      const conflictError = Object.assign(new Error('PreconditionFailed'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
      mockS3Client.send.onFirstCall().rejects(conflictError);
      mockS3Client.send.onSecondCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'active',
            lockStartedAt: new Date().toISOString(),
          })),
        },
        ETag: '"exec-etag"',
      });

      const result = await tryAcquireExecutionLock(TEST_AUDIT_ID, 'linkchecker-start', mockContext);

      expect(result).to.equal(null);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Execution lock .* already held/),
      );
    });

    it('should release an execution lock via conditional overwrite', async () => {
      mockS3Client.send.resolves({});

      await releaseExecutionLock(TEST_AUDIT_ID, 'linkchecker-start', '"exec-etag"', mockContext);

      expect(mockS3Client.send).to.have.been.calledOnce;
      expect(mockS3Client.send.firstCall.args[0].input.IfMatch).to.equal('"exec-etag"');
    });
  });

  describe('clearWorkflowDispatchReservation - error path', () => {
    it('should log warning when delete fails', async () => {
      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });
      mockS3Client.send.onSecondCall().rejects(new Error('Delete failed'));

      await clearWorkflowDispatchReservation(TEST_AUDIT_ID, 'test-dispatch', mockContext);

      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to clear workflow dispatch reservation/),
      );
    });

    it('should skip clearing when another worker updates the reservation first', async () => {
      mockS3Client.send.onFirstCall().resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            status: 'pending',
            updatedAt: new Date().toISOString(),
          })),
        },
        ETag: '"etag-123"',
      });
      const conflictError = Object.assign(new Error('PreconditionFailed'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
      mockS3Client.send.onSecondCall().rejects(conflictError);

      await clearWorkflowDispatchReservation(TEST_AUDIT_ID, 'test-dispatch', mockContext);

      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/was updated by another worker before clear/),
      );
    });
  });

  describe('updateCache - first write race protection', () => {
    it('should use IfNoneMatch when no existing cache (etag is null)', async () => {
      mockS3Client.send.onFirstCall().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      mockS3Client.send.onSecondCall().resolves({});

      await updateCache(TEST_AUDIT_ID, ['broken-url'], ['working-url'], mockContext);

      const putCommand = mockS3Client.send.secondCall.args[0];
      expect(putCommand.input.IfNoneMatch).to.equal('*');
      expect(putCommand.input.IfMatch).to.be.undefined;
    });
  });

  describe('markBatchCompleted - first write race protection', () => {
    it('should use IfNoneMatch when no existing completed file (etag is null)', async () => {
      mockS3Client.send.onFirstCall().rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      mockS3Client.send.onSecondCall().resolves({});

      await markBatchCompleted(TEST_AUDIT_ID, 0, mockContext);

      const putCommand = mockS3Client.send.secondCall.args[0];
      expect(putCommand.input.IfNoneMatch).to.equal('*');
      expect(putCommand.input.IfMatch).to.be.undefined;
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

  describe('saveScrapeResultPaths', () => {
    it('should save scrape result paths to S3', async () => {
      mockS3Client.send.resolves({});
      const paths = new Map([['https://example.com/p1', 'scrape/p1.json']]);

      const result = await saveScrapeResultPaths(TEST_AUDIT_ID, paths, mockContext);

      expect(result).to.equal(true);
      expect(mockS3Client.send).to.have.been.calledOnce;
      const putCall = mockS3Client.send.firstCall.args[0];
      expect(putCall.input.Key).to.include('scrape-result-paths.json');
      expect(putCall.input.IfNoneMatch).to.equal('*');
    });

    it('should preserve the existing manifest when scrape result paths already exist', async () => {
      const conflictError = Object.assign(new Error('PreconditionFailed'), {
        name: 'PreconditionFailed',
        $metadata: { httpStatusCode: 412 },
      });
      mockS3Client.send.rejects(conflictError);
      const paths = new Map([['https://example.com/p1', 'scrape/p1.json']]);

      const result = await saveScrapeResultPaths(TEST_AUDIT_ID, paths, mockContext);

      expect(result).to.equal(false);
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Scrape result paths already exist/),
      );
    });

    it('should throw on S3 save failure', async () => {
      mockS3Client.send.rejects(new Error('S3 write error'));
      const paths = new Map([['https://example.com/p1', 'scrape/p1.json']]);

      await expect(saveScrapeResultPaths(TEST_AUDIT_ID, paths, mockContext))
        .to.be.rejectedWith('S3 write error');

      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Failed to save scrape result paths/),
      );
    });
  });

  describe('loadScrapeResultPaths', () => {
    it('should load scrape result paths from S3', async () => {
      const entries = [['https://example.com/p1', 'scrape/p1.json']];
      mockS3Client.send.resolves({
        Body: { transformToString: async () => JSON.stringify(entries) },
      });

      const result = await loadScrapeResultPaths(TEST_AUDIT_ID, mockContext);

      expect(result).to.be.instanceOf(Map);
      expect(result.size).to.equal(1);
      expect(result.get('https://example.com/p1')).to.equal('scrape/p1.json');
    });

    it('should return empty Map when file does not exist', async () => {
      mockS3Client.send.rejects(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));

      const result = await loadScrapeResultPaths(TEST_AUDIT_ID, mockContext);

      expect(result).to.be.instanceOf(Map);
      expect(result.size).to.equal(0);
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/No scrape result paths found/),
      );
    });

    it('should throw on unexpected error', async () => {
      mockS3Client.send.rejects(new Error('S3 throttled'));

      await expect(loadScrapeResultPaths(TEST_AUDIT_ID, mockContext))
        .to.be.rejectedWith('S3 throttled');
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Failed to load scrape result paths/),
      );
    });
  });

  describe('markWorkflowDispatchSentWithRetry', () => {
    it('should succeed on first attempt', async () => {
      mockS3Client.send.resolves({});

      await markWorkflowDispatchSentWithRetry(
        TEST_AUDIT_ID, 'continue-5', mockContext, { nextBatchIndex: 5 },
      );

      expect(mockS3Client.send).to.have.been.calledOnce;
    });

    it('should retry and succeed on second attempt', async () => {
      mockS3Client.send.onFirstCall().rejects(new Error('Transient'));
      mockS3Client.send.onSecondCall().resolves({});

      await markWorkflowDispatchSentWithRetry(
        TEST_AUDIT_ID, 'continue-5', mockContext, { nextBatchIndex: 5 },
      );

      expect(mockS3Client.send).to.have.been.calledTwice;
      expect(mockContext.log.warn).to.have.been.calledWith(
        sinon.match(/Failed to mark dispatch.*attempt 1/),
      );
    });

    it('should throw after all retries exhausted', async () => {
      mockS3Client.send.rejects(new Error('Persistent'));

      await expect(markWorkflowDispatchSentWithRetry(
        TEST_AUDIT_ID, 'continue-5', mockContext, { nextBatchIndex: 5 },
      )).to.be.rejectedWith('Failed to mark dispatch continue-5 as sent after 3 attempts: Persistent');

      expect(mockS3Client.send).to.have.been.calledThrice;
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/ALERT.*Failed to mark dispatch.*after 3 attempts/),
      );
    });
  });

  describe('loadAllBatchResults - corrupt batch handling', () => {
    it('should fail when any batch file is corrupt', async () => {
      mockS3Client.send.onCall(0).resolves({
        Contents: [
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-0.json' },
          { Key: 'broken-internal-links/batch-state/test-audit-123/batches/batch-1.json' },
        ],
        IsTruncated: false,
      });
      mockS3Client.send.onCall(1).resolves({
        Body: {
          transformToString: () => Promise.resolve(JSON.stringify({
            batchNum: 0,
            results: [{ urlFrom: 'https://example.com/page1', urlTo: 'https://example.com/broken' }],
          })),
        },
      });
      mockS3Client.send.onCall(2).resolves({
        Body: {
          transformToString: () => Promise.resolve('NOT VALID JSON'),
        },
      });

      await expect(loadAllBatchResults(TEST_AUDIT_ID, mockContext))
        .to.be.rejected;
    });
  });
});
