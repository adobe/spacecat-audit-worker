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
import esmock from 'esmock';
import {
  checkJsonEnrichmentNeeded,
  acquireEnrichmentLock,
  releaseEnrichmentLock,
  checkEnrichmentConflict,
  isEnrichmentTimedOut,
  saveEnrichmentMetadata,
  loadEnrichmentMetadata,
  saveEnrichmentJson,
  loadEnrichmentJson,
  urlEnrichmentMetadataS3Key,
  urlEnrichmentJsonS3Key,
  ENRICHMENT_TIMEOUT_MS,
  URL_ENRICHMENT_BATCH_SIZE,
  URL_ENRICHMENT_TYPE,
} from '../../src/geo-brand-presence/util.js';

use(sinonChai);

describe('JSON Enrichment Utilities', () => {
  describe('checkJsonEnrichmentNeeded', () => {
    it('should return empty indices when all prompts have URLs from parquet/Ahrefs', () => {
      const prompts = [
        { prompt: 'What is Adobe?', url: 'https://example.com/page1', source: 'ahrefs' },
        { prompt: 'How to use Photoshop?', url: 'https://example.com/page2', source: 'ahrefs' },
        { prompt: 'Illustrator pricing', url: 'https://example.com/page3', source: 'ahrefs' },
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.false;
      expect(result.indicesToEnrich).to.have.lengthOf(0);
    });

    it('should identify human prompts (empty url) for enrichment', () => {
      const prompts = [
        { prompt: 'What is Adobe?', url: 'https://example.com/page1', source: 'ahrefs' },
        { prompt: 'Custom human prompt', url: '', source: 'human' }, // Human prompt needs enrichment
        { prompt: 'Another human prompt', source: 'human' }, // Missing URL needs enrichment
        { prompt: 'AI prompt with URL', url: 'https://example.com', source: 'ahrefs' },
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.true;
      expect(result.indicesToEnrich).to.deep.equal([1, 2]);
    });

    it('should identify prompts with whitespace-only URLs for enrichment', () => {
      const prompts = [
        { prompt: 'Prompt 1', url: '   ' }, // Whitespace only - needs enrichment
        { prompt: 'Prompt 2', url: '\t\n' }, // Whitespace only - needs enrichment
        { prompt: 'Prompt 3', url: 'https://valid.com' }, // Valid URL - skip
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.true;
      expect(result.indicesToEnrich).to.deep.equal([0, 1]);
    });

    it('should skip prompts without prompt text even if URL is missing', () => {
      const prompts = [
        { prompt: '', url: '' }, // No prompt text - skip
        { prompt: '   ', url: '' }, // Whitespace only prompt - skip
        { url: 'https://example.com' }, // Missing prompt field - skip
        { prompt: 'Valid prompt', url: '' }, // Valid - needs enrichment
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.true;
      expect(result.indicesToEnrich).to.deep.equal([3]); // Only the valid prompt
    });

    it('should handle empty prompts array', () => {
      const result = checkJsonEnrichmentNeeded([]);

      expect(result.needsEnrichment).to.be.false;
      expect(result.indicesToEnrich).to.have.lengthOf(0);
    });

    it('should correctly identify mix of AI and human prompts', () => {
      const prompts = [
        { prompt: 'AI Prompt 0', url: 'https://example.com', source: 'ahrefs' }, // Has URL - skip
        { prompt: 'Human Prompt 1', url: '', source: 'human' }, // Needs enrichment
        { prompt: 'AI Prompt 2', url: 'https://example.com/2', source: 'ahrefs' }, // Has URL - skip
        { prompt: 'Human Prompt 3', source: 'human' }, // Needs enrichment (missing url)
        { prompt: 'AI Prompt 4', url: 'https://example.com/4', source: 'ahrefs' }, // Has URL - skip
        { prompt: 'Human Prompt 5', url: '', source: 'human' }, // Needs enrichment
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.true;
      expect(result.indicesToEnrich).to.deep.equal([1, 3, 5]);
    });

    it('should handle prompts with only url property but no prompt text', () => {
      const prompts = [
        { url: 'https://example.com' }, // No prompt - skip
        { prompt: null, url: '' }, // Null prompt - skip
        { prompt: 'Valid', url: '' }, // Valid - needs enrichment
      ];

      const result = checkJsonEnrichmentNeeded(prompts);

      expect(result.needsEnrichment).to.be.true;
      expect(result.indicesToEnrich).to.deep.equal([2]);
    });
  });

  describe('isEnrichmentTimedOut', () => {
    it('should return false for fresh metadata', () => {
      const metadata = {
        createdAt: new Date().toISOString(),
      };

      expect(isEnrichmentTimedOut(metadata)).to.be.false;
    });

    it('should return true for expired metadata', () => {
      const expiredTime = new Date(Date.now() - ENRICHMENT_TIMEOUT_MS - 1000);
      const metadata = {
        createdAt: expiredTime.toISOString(),
      };

      expect(isEnrichmentTimedOut(metadata)).to.be.true;
    });

    it('should return false for metadata without createdAt', () => {
      expect(isEnrichmentTimedOut({})).to.be.false;
      expect(isEnrichmentTimedOut(null)).to.be.false;
      expect(isEnrichmentTimedOut(undefined)).to.be.false;
    });

    it('should handle metadata at exactly timeout boundary', () => {
      const boundaryTime = new Date(Date.now() - ENRICHMENT_TIMEOUT_MS + 1000);
      const metadata = {
        createdAt: boundaryTime.toISOString(),
      };

      expect(isEnrichmentTimedOut(metadata)).to.be.false;
    });
  });

  describe('Lock Management', () => {
    let s3Client;
    let log;
    const bucket = 'test-bucket';
    const siteId = 'site-123';
    const lockId = 'w03-2025';
    const auditId = 'audit-456';

    beforeEach(() => {
      s3Client = {
        send: sinon.stub(),
      };
      log = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
        debug: sinon.stub(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('acquireEnrichmentLock', () => {
      it('should acquire lock when no existing lock', async () => {
        // No existing lock (NoSuchKey error)
        s3Client.send.onFirstCall().rejects({ name: 'NoSuchKey' });
        // PutObject succeeds
        s3Client.send.onSecondCall().resolves({});

        const result = await acquireEnrichmentLock(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
          log,
        );

        expect(result.acquired).to.be.true;
        expect(log.info).to.have.been.calledWith(
          'Enrichment lock acquired for %s/%s (auditId: %s)',
          siteId,
          lockId,
          auditId,
        );
      });

      it('should not acquire lock when active lock exists', async () => {
        const existingLock = {
          auditId: 'other-audit',
          startedAt: new Date().toISOString(),
        };

        s3Client.send.onFirstCall().resolves({
          Body: {
            transformToString: async () => JSON.stringify(existingLock),
          },
        });

        const result = await acquireEnrichmentLock(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
          log,
        );

        expect(result.acquired).to.be.false;
        expect(result.existingLock).to.deep.equal(existingLock);
      });

      it('should take over expired lock', async () => {
        const expiredLock = {
          auditId: 'old-audit',
          startedAt: new Date(Date.now() - ENRICHMENT_TIMEOUT_MS - 1000).toISOString(),
        };

        s3Client.send.onFirstCall().resolves({
          Body: {
            transformToString: async () => JSON.stringify(expiredLock),
          },
        });
        s3Client.send.onSecondCall().resolves({});

        const result = await acquireEnrichmentLock(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
          log,
        );

        expect(result.acquired).to.be.true;
        expect(log.warn).to.have.been.calledWith(
          sinon.match(/Enrichment lock expired/),
          siteId,
          lockId,
          'old-audit',
          sinon.match.number,
        );
      });
    });

    describe('checkEnrichmentConflict', () => {
      it('should return no conflict when lock matches current audit', async () => {
        const lock = {
          auditId,
          siteId,
          lockId,
        };

        s3Client.send.resolves({
          Body: {
            transformToString: async () => JSON.stringify(lock),
          },
        });

        const result = await checkEnrichmentConflict(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
        );

        expect(result.hasConflict).to.be.false;
      });

      it('should return conflict when lock is missing', async () => {
        s3Client.send.rejects({ name: 'NoSuchKey' });

        const result = await checkEnrichmentConflict(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
        );

        expect(result.hasConflict).to.be.true;
        expect(result.reason).to.equal('lock-missing');
      });

      it('should return conflict when lock belongs to different audit', async () => {
        const lock = {
          auditId: 'different-audit',
          siteId,
          lockId,
        };

        s3Client.send.resolves({
          Body: {
            transformToString: async () => JSON.stringify(lock),
          },
        });

        const result = await checkEnrichmentConflict(
          s3Client,
          bucket,
          siteId,
          lockId,
          auditId,
        );

        expect(result.hasConflict).to.be.true;
        expect(result.reason).to.equal('lock-stolen');
        expect(result.newerAuditId).to.equal('different-audit');
      });
    });

    describe('releaseEnrichmentLock', () => {
      it('should delete the lock file', async () => {
        s3Client.send.resolves({});

        await releaseEnrichmentLock(s3Client, bucket, siteId, lockId, log);

        expect(s3Client.send).to.have.been.calledOnce;
        expect(log.info).to.have.been.calledWith(
          'Enrichment lock released for %s/%s',
          siteId,
          lockId,
        );
      });

      it('should handle delete failure gracefully', async () => {
        s3Client.send.rejects(new Error('Delete failed'));

        await releaseEnrichmentLock(s3Client, bucket, siteId, lockId, log);

        expect(log.warn).to.have.been.calledWith(
          'Failed to release enrichment lock for %s/%s: %s',
          siteId,
          lockId,
          'Delete failed',
        );
      });
    });
  });

  describe('S3 Key Generators', () => {
    it('should generate correct metadata S3 key', () => {
      const auditId = 'test-audit-123';
      const key = urlEnrichmentMetadataS3Key(auditId);
      expect(key).to.equal('temp/url-enrichment/test-audit-123/metadata.json');
    });

    it('should generate correct JSON S3 key', () => {
      const auditId = 'test-audit-456';
      const key = urlEnrichmentJsonS3Key(auditId);
      expect(key).to.equal('temp/url-enrichment/test-audit-456/prompts.json');
    });
  });

  describe('S3 Save/Load Operations', () => {
    let s3Client;
    const bucket = 'test-bucket';
    const auditId = 'test-audit-789';

    beforeEach(() => {
      s3Client = {
        send: sinon.stub(),
      };
    });

    afterEach(() => {
      sinon.restore();
    });

    describe('saveEnrichmentMetadata', () => {
      it('should save metadata to S3', async () => {
        s3Client.send.resolves({});

        const metadata = {
          auditId,
          siteId: 'site-123',
          indicesToEnrich: [1, 3, 5],
          createdAt: new Date().toISOString(),
        };

        await saveEnrichmentMetadata(s3Client, bucket, metadata);

        expect(s3Client.send).to.have.been.calledOnce;
        const putCmd = s3Client.send.firstCall.args[0];
        expect(putCmd.input.Bucket).to.equal(bucket);
        expect(putCmd.input.Key).to.equal(urlEnrichmentMetadataS3Key(auditId));
        expect(putCmd.input.ContentType).to.equal('application/json');
      });
    });

    describe('loadEnrichmentMetadata', () => {
      it('should load metadata from S3', async () => {
        const metadata = {
          auditId,
          indicesToEnrich: [0, 2, 4],
        };

        s3Client.send.resolves({
          Body: {
            transformToString: async () => JSON.stringify(metadata),
          },
        });

        const result = await loadEnrichmentMetadata(s3Client, bucket, auditId);

        expect(result).to.deep.equal(metadata);
      });

      it('should handle undefined Body gracefully', async () => {
        s3Client.send.resolves({
          Body: {
            transformToString: async () => '{}',
          },
        });

        const result = await loadEnrichmentMetadata(s3Client, bucket, auditId);

        expect(result).to.deep.equal({});
      });
    });

    describe('saveEnrichmentJson', () => {
      it('should save prompts to S3', async () => {
        s3Client.send.resolves({});

        const prompts = [
          { prompt: 'Test 1', url: '' },
          { prompt: 'Test 2', url: 'https://example.com' },
        ];

        await saveEnrichmentJson(s3Client, bucket, auditId, prompts);

        expect(s3Client.send).to.have.been.calledOnce;
        const putCmd = s3Client.send.firstCall.args[0];
        expect(putCmd.input.Bucket).to.equal(bucket);
        expect(putCmd.input.Key).to.equal(urlEnrichmentJsonS3Key(auditId));
      });
    });

    describe('loadEnrichmentJson', () => {
      it('should load prompts from S3', async () => {
        const prompts = [
          { prompt: 'Test 1', relatedUrl: 'https://generated.com' },
          { prompt: 'Test 2', url: 'https://example.com' },
        ];

        s3Client.send.resolves({
          Body: {
            transformToString: async () => JSON.stringify(prompts),
          },
        });

        const result = await loadEnrichmentJson(s3Client, bucket, auditId);

        expect(result).to.deep.equal(prompts);
      });

      it('should handle Body returning empty array JSON', async () => {
        s3Client.send.resolves({
          Body: {
            transformToString: async () => '[]',
          },
        });

        const result = await loadEnrichmentJson(s3Client, bucket, auditId);

        expect(result).to.deep.equal([]);
      });
    });
  });

  describe('Constants', () => {
    it('should have correct batch size', () => {
      expect(URL_ENRICHMENT_BATCH_SIZE).to.equal(10);
    });

    it('should have correct enrichment type', () => {
      expect(URL_ENRICHMENT_TYPE).to.equal('enrich:geo-brand-presence-json');
    });

    it('should have correct timeout (10 minutes)', () => {
      expect(ENRICHMENT_TIMEOUT_MS).to.equal(10 * 60 * 1000);
    });
  });
});

describe('JSON Enrichment Handler', () => {
  let s3Client;
  let sqs;
  let log;
  let dataAccess;
  let context;
  let site;
  const bucket = 'test-bucket';
  const auditId = 'test-audit-handler';
  const siteId = 'test-site-handler';

  const createMetadata = (overrides = {}) => ({
    auditId,
    siteId,
    baseURL: 'https://test-site.com',
    deliveryType: 'aem_edge',
    dateContext: { week: 3, year: 2025 },
    providersToUse: ['chatgpt'],
    isDaily: false,
    configVersion: '1.0.0',
    configExists: true,
    indicesToEnrich: [0, 1, 2],
    lockId: 'w3-2025',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const createPrompts = () => [
    { prompt: 'Prompt 0', url: '' },
    { prompt: 'Prompt 1', url: '' },
    { prompt: 'Prompt 2', url: '' },
  ];

  const createMockUtils = (overrides = {}) => ({
    URL_ENRICHMENT_BATCH_SIZE: 10,
    URL_ENRICHMENT_TYPE: 'enrich:geo-brand-presence-json',
    loadEnrichmentMetadata: sinon.stub().resolves(createMetadata()),
    loadEnrichmentJson: sinon.stub().resolves(createPrompts()),
    saveEnrichmentJson: sinon.stub().resolves(),
    processJsonEnrichmentBatch: sinon.stub().resolves(3),
    isEnrichmentTimedOut: sinon.stub().returns(false),
    checkEnrichmentConflict: sinon.stub().resolves({ hasConflict: false }),
    releaseEnrichmentLock: sinon.stub().resolves(),
    transformWebSearchProviderForMystique: sinon.stub().callsFake((p) => p),
    ...overrides,
  });

  const createHandler = async (mockUtilsOverrides = {}) => {
    const mockUtils = createMockUtils(mockUtilsOverrides);
    const handler = await esmock('../../src/geo-brand-presence/json-enrichment-handler.js', {
      '../../src/geo-brand-presence/util.js': mockUtils,
      '../../src/utils/getPresignedUrl.js': {
        getSignedUrl: sinon.stub().resolves('https://presigned-url.com'),
      },
    });
    return { handler, mockUtils };
  };

  beforeEach(() => {
    s3Client = {
      send: sinon.stub().resolves({}),
    };

    sqs = {
      sendMessage: sinon.stub().resolves({}),
    };

    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    site = {
      getId: () => siteId,
      getBaseURL: () => 'https://test-site.com',
      getDeliveryType: () => 'aem_edge',
    };

    dataAccess = {
      Site: {
        findById: sinon.stub().resolves(site),
      },
      Configuration: {
        findLatest: sinon.stub().resolves({
          getQueues: () => ({ audits: 'audit-queue' }),
        }),
      },
    };

    context = {
      log,
      dataAccess,
      sqs,
      s3Client,
      env: {
        S3_IMPORTER_BUCKET_NAME: bucket,
        AWS_REGION: 'us-east-1',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'mystique-queue',
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should export the handler as default', async () => {
    const { handler } = await createHandler();
    expect(handler.default).to.be.a('function');
  });

  describe('Site validation', () => {
    it('should return notFound when site does not exist', async () => {
      dataAccess.Site.findById.resolves(null);
      const { handler } = await createHandler();

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Site not found/),
        sinon.match.any,
        siteId,
      );
    });
  });

  describe('Metadata validation', () => {
    it('should return notFound when metadata is null', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(null),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(404);
    });

    it('should return notFound when metadata has no indicesToEnrich', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves({ auditId }),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(404);
    });
  });

  describe('Timeout handling', () => {
    it('should send fallback to Mystique when enrichment times out', async () => {
      const { handler, mockUtils } = await createHandler({
        isEnrichmentTimedOut: sinon.stub().returns(true),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Enrichment timed out/),
        sinon.match.any,
        auditId,
        sinon.match.any,
      );
      expect(mockUtils.releaseEnrichmentLock).to.have.been.called;
    });
  });

  describe('Conflict detection', () => {
    it('should abort when conflict is detected at start', async () => {
      const { handler } = await createHandler({
        checkEnrichmentConflict: sinon.stub().resolves({
          hasConflict: true,
          reason: 'lock-stolen',
          newerAuditId: 'newer-audit-123',
        }),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Conflict detected/),
        sinon.match.any,
        auditId,
        'lock-stolen',
        'newer-audit-123',
      );
    });

    it('should log "unknown" when newerAuditId is undefined in conflict', async () => {
      const { handler } = await createHandler({
        checkEnrichmentConflict: sinon.stub().resolves({
          hasConflict: true,
          reason: 'lock-missing',
          // newerAuditId is undefined - should fall back to 'unknown'
        }),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Conflict detected/),
        sinon.match.any,
        auditId,
        'lock-missing',
        'unknown', // Falls back to 'unknown' when newerAuditId is undefined
      );
    });

    it('should abort when final conflict is detected', async () => {
      const conflictStub = sinon.stub();
      conflictStub.onFirstCall().resolves({ hasConflict: false });
      conflictStub.onSecondCall().resolves({
        hasConflict: true,
        reason: 'lock-stolen',
        newerAuditId: 'newer-audit-456',
      });

      const { handler } = await createHandler({
        checkEnrichmentConflict: conflictStub,
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Final conflict detected/),
        sinon.match.any,
        auditId,
      );
    });
  });

  describe('Prompts validation', () => {
    it('should return internalServerError when prompts is not an array', async () => {
      const { handler } = await createHandler({
        loadEnrichmentJson: sinon.stub().resolves('not-an-array'),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(500);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Invalid prompts data/),
        sinon.match.any,
        auditId,
      );
    });
  });

  describe('Batch processing with continuation', () => {
    it('should send continuation message when more batches remain', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(createMetadata({
          indicesToEnrich: Array.from({ length: 15 }, (_, i) => i),
        })),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify continuation message was sent
      expect(sqs.sendMessage).to.have.been.calledWith(
        'audit-queue',
        sinon.match({
          type: 'enrich:geo-brand-presence-json',
          auditId,
          siteId,
          batchStart: 10,
        }),
      );
    });

    it('should complete without continuation when all batches are done', async () => {
      const { handler } = await createHandler();

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify Mystique message was sent
      expect(sqs.sendMessage).to.have.been.calledWith(
        'mystique-queue',
        sinon.match({
          type: 'detect:geo-brand-presence',
        }),
      );
    });
  });

  describe('Successful completion', () => {
    it('should send to Mystique and release lock on completion', async () => {
      const { handler, mockUtils } = await createHandler();

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(mockUtils.releaseEnrichmentLock).to.have.been.called;
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Successfully completed JSON enrichment/),
        sinon.match.any,
        auditId,
      );
    });

    it('should send daily detection message when isDaily is true', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(createMetadata({
          isDaily: true,
          dateContext: { week: 3, year: 2025, date: '2025-01-22' },
        })),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify daily detection message
      expect(sqs.sendMessage).to.have.been.calledWith(
        'mystique-queue',
        sinon.match({
          type: 'detect:geo-brand-presence-daily',
          date: '2025-01-22',
        }),
      );
    });

    it('should send messages to all configured providers', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(createMetadata({
          providersToUse: ['chatgpt', 'perplexity', 'gemini'],
        })),
      });

      await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      // Should have 3 messages to Mystique (one per provider)
      expect(sqs.sendMessage.callCount).to.equal(3);
    });

    it('should send config_version as null when configExists is false', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(createMetadata({
          configExists: false,
          configVersion: '1.0.0', // Should be ignored since configExists is false
        })),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify config_version is null when configExists is false
      expect(sqs.sendMessage).to.have.been.calledWith(
        'mystique-queue',
        sinon.match({
          type: 'detect:geo-brand-presence',
          config_version: null,
        }),
      );
    });
  });

  describe('Error handling', () => {
    it('should send fallback and return internalServerError on exception', async () => {
      const { handler } = await createHandler({
        processJsonEnrichmentBatch: sinon.stub().rejects(new Error('Processing failed')),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(500);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error processing JSON enrichment/),
        sinon.match.any,
        auditId,
        'Processing failed',
      );
    });

    it('should log error when fallback to Mystique fails', async () => {
      // Make processing fail
      const { handler } = await createHandler({
        processJsonEnrichmentBatch: sinon.stub().rejects(new Error('Processing failed')),
      });

      // Make S3 upload fail during fallback (when trying to upload prompts for presigned URL)
      s3Client.send.rejects(new Error('S3 upload failed'));

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(500);
      // Should log the fallback failure
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to send fallback to Mystique/),
        sinon.match.any,
        auditId,
        sinon.match.any,
      );
    });

    it('should not send fallback if metadata or prompts are null', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().rejects(new Error('S3 error')),
      });

      const result = await handler.default(
        { auditId, siteId, batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(500);
      // Fallback should not be called since metadata is null
      expect(sqs.sendMessage).to.not.have.been.calledWith(
        'mystique-queue',
        sinon.match.any,
      );
    });
  });

  describe('Default batchStart', () => {
    it('should default batchStart to 0 if not provided', async () => {
      const { handler } = await createHandler();

      const result = await handler.default(
        { auditId, siteId }, // No batchStart
        context,
      );

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Processing batch starting at/),
        sinon.match.any,
        0,
        auditId,
        siteId,
      );
    });
  });
});
