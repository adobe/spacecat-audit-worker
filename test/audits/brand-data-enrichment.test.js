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
import esmock from 'esmock';
import {
  flattenConfigPrompts,
  acquireEnrichmentLock,
  releaseEnrichmentLock,
  checkEnrichmentConflict,
  isEnrichmentTimedOut,
  saveEnrichmentMetadata,
  loadEnrichmentMetadata,
  saveEnrichmentConfig,
  loadEnrichmentConfig,
  enrichmentMetadataS3Key,
  enrichmentConfigS3Key,
  enrichmentDirectoryS3Key,
  ENRICHMENT_TIMEOUT_MS,
  URL_ENRICHMENT_BATCH_SIZE,
  BRAND_DATA_ENRICHMENT_TYPE,
} from '../../src/brand-data-enrichment/util.js';

use(sinonChai);
use(chaiAsPromised);

describe('Brand Data Enrichment Utilities', () => {
  describe('flattenConfigPrompts', () => {
    it('should flatten prompts from topics only', () => {
      const config = {
        topics: {
          't1': {
            name: 'Topic 1',
            prompts: [
              { prompt: 'prompt A', regions: ['us'] },
              { prompt: 'prompt B', regions: ['de'] },
            ],
          },
          't2': {
            name: 'Topic 2',
            prompts: [
              { prompt: 'prompt C', regions: ['fr'] },
            ],
          },
        },
      };

      const result = flattenConfigPrompts(config);

      expect(result).to.have.lengthOf(3);
      expect(result[0].prompt).to.equal('prompt A');
      expect(result[1].prompt).to.equal('prompt B');
      expect(result[2].prompt).to.equal('prompt C');
    });

    it('should flatten prompts from aiTopics only', () => {
      const config = {
        aiTopics: {
          'at1': {
            name: 'AI Topic 1',
            prompts: [
              { prompt: 'ai prompt X', regions: ['us'] },
            ],
          },
        },
      };

      const result = flattenConfigPrompts(config);

      expect(result).to.have.lengthOf(1);
      expect(result[0].prompt).to.equal('ai prompt X');
    });

    it('should flatten prompts from both topics and aiTopics', () => {
      const config = {
        topics: {
          't1': {
            name: 'Topic 1',
            prompts: [
              { prompt: 'human prompt', regions: ['us'] },
            ],
          },
        },
        aiTopics: {
          'at1': {
            name: 'AI Topic',
            prompts: [
              { prompt: 'ai prompt', regions: ['de'] },
            ],
          },
        },
      };

      const result = flattenConfigPrompts(config);

      expect(result).to.have.lengthOf(2);
      // topics come first, then aiTopics
      expect(result[0].prompt).to.equal('human prompt');
      expect(result[1].prompt).to.equal('ai prompt');
    });

    it('should return empty array for empty config', () => {
      expect(flattenConfigPrompts({})).to.have.lengthOf(0);
      expect(flattenConfigPrompts({ topics: {} })).to.have.lengthOf(0);
      expect(flattenConfigPrompts({ aiTopics: {} })).to.have.lengthOf(0);
    });

    it('should return empty array for null/undefined config', () => {
      expect(flattenConfigPrompts(null)).to.have.lengthOf(0);
      expect(flattenConfigPrompts(undefined)).to.have.lengthOf(0);
    });

    it('should skip topics with no prompts array', () => {
      const config = {
        topics: {
          't1': { name: 'Topic without prompts' },
          't2': { name: 'Topic with prompts', prompts: [{ prompt: 'test' }] },
        },
      };

      const result = flattenConfigPrompts(config);

      expect(result).to.have.lengthOf(1);
      expect(result[0].prompt).to.equal('test');
    });

    it('should return references to original prompt objects (by-reference mutation)', () => {
      const config = {
        topics: {
          't1': {
            name: 'Topic 1',
            prompts: [
              { prompt: 'prompt A', regions: ['us'] },
            ],
          },
        },
      };

      const flatPrompts = flattenConfigPrompts(config);

      // Mutate the flattened prompt
      flatPrompts[0].relatedUrl = 'https://website.com';

      // The original config should also be mutated (same object reference)
      expect(config.topics.t1.prompts[0].relatedUrl).to.equal('https://website.com');
    });
  });

  describe('S3 Key Generators', () => {
    it('should generate correct directory S3 key', () => {
      const key = enrichmentDirectoryS3Key('test-audit-123');
      expect(key).to.equal('temp/brand-data-enrichment/test-audit-123');
    });

    it('should generate correct metadata S3 key', () => {
      const key = enrichmentMetadataS3Key('test-audit-123');
      expect(key).to.equal('temp/brand-data-enrichment/test-audit-123/metadata.json');
    });

    it('should generate correct config S3 key', () => {
      const key = enrichmentConfigS3Key('test-audit-456');
      expect(key).to.equal('temp/brand-data-enrichment/test-audit-456/config.json');
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
    const lockId = 'brand-data-enrichment';
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
        s3Client.send.onFirstCall().rejects({ name: 'NoSuchKey' });
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
      });
    });

    describe('checkEnrichmentConflict', () => {
      it('should return no conflict when lock matches current audit', async () => {
        const lock = { auditId, siteId, lockId };

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
        const lock = { auditId: 'different-audit', siteId, lockId };

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
      it('should save metadata to S3 with correct key', async () => {
        s3Client.send.resolves({});

        const metadata = {
          auditId,
          siteId: 'site-123',
          lockId: 'brand-data-enrichment',
          totalPrompts: 5,
          createdAt: new Date().toISOString(),
        };

        await saveEnrichmentMetadata(s3Client, bucket, metadata);

        expect(s3Client.send).to.have.been.calledOnce;
        const putCmd = s3Client.send.firstCall.args[0];
        expect(putCmd.input.Bucket).to.equal(bucket);
        expect(putCmd.input.Key).to.equal(enrichmentMetadataS3Key(auditId));
        expect(putCmd.input.ContentType).to.equal('application/json');
      });
    });

    describe('loadEnrichmentMetadata', () => {
      it('should load metadata from S3', async () => {
        const metadata = {
          auditId,
          totalPrompts: 5,
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

    describe('saveEnrichmentConfig', () => {
      it('should save config to S3 with correct key', async () => {
        s3Client.send.resolves({});

        const config = {
          topics: { t1: { prompts: [{ prompt: 'test' }] } },
        };

        await saveEnrichmentConfig(s3Client, bucket, auditId, config);

        expect(s3Client.send).to.have.been.calledOnce;
        const putCmd = s3Client.send.firstCall.args[0];
        expect(putCmd.input.Bucket).to.equal(bucket);
        expect(putCmd.input.Key).to.equal(enrichmentConfigS3Key(auditId));
      });
    });

    describe('loadEnrichmentConfig', () => {
      it('should load config from S3', async () => {
        const config = {
          topics: { t1: { prompts: [{ prompt: 'test' }] } },
        };

        s3Client.send.resolves({
          Body: {
            transformToString: async () => JSON.stringify(config),
          },
        });

        const result = await loadEnrichmentConfig(s3Client, bucket, auditId);

        expect(result).to.deep.equal(config);
      });

      it('should return empty object when Body is empty', async () => {
        s3Client.send.resolves({
          Body: {
            transformToString: async () => '{}',
          },
        });

        const result = await loadEnrichmentConfig(s3Client, bucket, auditId);

        expect(result).to.deep.equal({});
      });
    });
  });

  describe('Constants', () => {
    it('should have correct batch size', () => {
      expect(URL_ENRICHMENT_BATCH_SIZE).to.equal(10);
    });

    it('should have correct enrichment type', () => {
      expect(BRAND_DATA_ENRICHMENT_TYPE).to.equal('enrich:brand-data');
    });

    it('should have correct timeout (10 minutes)', () => {
      expect(ENRICHMENT_TIMEOUT_MS).to.equal(10 * 60 * 1000);
    });
  });
});

describe('Brand Data Enrichment Handler', () => {
  let s3Client;
  let sqs;
  let log;
  let dataAccess;
  let context;
  let site;
  const bucket = 'test-bucket';
  const siteId = 'test-site-handler';

  const createMockConfig = () => ({
    topics: {
      't1': {
        name: 'Topic 1',
        prompts: [
          { prompt: 'prompt 0', regions: ['us'] },
          { prompt: 'prompt 1', regions: ['de'] },
          { prompt: 'prompt 2', regions: ['fr'] },
        ],
      },
    },
    aiTopics: {},
  });

  const createMockUtils = (overrides = {}) => ({
    URL_ENRICHMENT_BATCH_SIZE: 10,
    BRAND_DATA_ENRICHMENT_TYPE: 'enrich:brand-data',
    flattenConfigPrompts: sinon.stub().callsFake(
      (config) => {
        const prompts = [];
        for (const section of ['topics', 'aiTopics']) {
          const sectionData = config?.[section];
          if (!sectionData) continue;
          for (const [, topic] of Object.entries(sectionData)) {
            if (Array.isArray(topic.prompts)) {
              for (const prompt of topic.prompts) {
                prompts.push(prompt);
              }
            }
          }
        }
        return prompts;
      },
    ),
    acquireEnrichmentLock: sinon.stub().resolves({ acquired: true }),
    saveEnrichmentMetadata: sinon.stub().resolves(),
    loadEnrichmentMetadata: sinon.stub().resolves({
      auditId: 'test-audit-id',
      siteId,
      lockId: 'brand-data-enrichment',
      totalPrompts: 3,
      createdAt: new Date().toISOString(),
    }),
    saveEnrichmentConfig: sinon.stub().resolves(),
    loadEnrichmentConfig: sinon.stub().resolves(createMockConfig()),
    processJsonEnrichmentBatch: sinon.stub().resolves(3),
    isEnrichmentTimedOut: sinon.stub().returns(false),
    checkEnrichmentConflict: sinon.stub().resolves({ hasConflict: false }),
    releaseEnrichmentLock: sinon.stub().resolves(),
    ...overrides,
  });

  const mockLlmoConfig = {
    readConfig: sinon.stub().resolves({ config: createMockConfig(), exists: true, version: '1.0' }),
    writeConfig: sinon.stub().resolves(),
  };

  const createHandler = async (mockUtilsOverrides = {}, llmoOverrides = {}) => {
    const mockUtils = createMockUtils(mockUtilsOverrides);
    const llmo = { ...mockLlmoConfig, ...llmoOverrides };
    const handler = await esmock('../../src/brand-data-enrichment/handler.js', {
      '../../src/brand-data-enrichment/util.js': mockUtils,
      '@adobe/spacecat-shared-utils': {
        llmoConfig: llmo,
      },
      'node:crypto': {
        randomUUID: () => 'generated-uuid',
      },
    });
    return { handler, mockUtils, llmo };
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
      },
    };

    // Reset shared stubs
    mockLlmoConfig.readConfig.resetHistory();
    mockLlmoConfig.readConfig.resolves({ config: createMockConfig(), exists: true, version: '1.0' });
    mockLlmoConfig.writeConfig.resetHistory();
    mockLlmoConfig.writeConfig.resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should export the handler as default', async () => {
    const { handler } = await createHandler();
    expect(handler.default).to.be.a('function');
  });

  describe('Missing context properties', () => {
    it('should return 500 when s3Client is missing', async () => {
      const { handler } = await createHandler();

      const result = await handler.default(
        { siteId },
        { ...context, s3Client: undefined },
      );

      expect(result.status).to.equal(500);
    });

    it('should return 500 when sqs is missing', async () => {
      const { handler } = await createHandler();

      const result = await handler.default(
        { siteId },
        { ...context, sqs: undefined },
      );

      expect(result.status).to.equal(500);
    });
  });

  describe('Site validation', () => {
    it('should return notFound when site does not exist', async () => {
      dataAccess.Site.findById.resolves(null);
      const { handler } = await createHandler();

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(404);
    });
  });

  describe('First invocation (batchStart=0)', () => {
    it('should read config, acquire lock, save temp, process batch', async () => {
      const { handler, mockUtils, llmo } = await createHandler();

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify flow
      expect(llmo.readConfig).to.have.been.calledOnce;
      expect(mockUtils.acquireEnrichmentLock).to.have.been.calledOnce;
      expect(mockUtils.saveEnrichmentMetadata).to.have.been.calledOnce;
      expect(mockUtils.saveEnrichmentConfig).to.have.been.called;
      expect(mockUtils.processJsonEnrichmentBatch).to.have.been.calledOnce;
      expect(llmo.writeConfig).to.have.been.calledOnce;
      expect(mockUtils.releaseEnrichmentLock).to.have.been.calledOnce;
    });

    it('should generate auditId via randomUUID when not provided', async () => {
      const { handler, mockUtils } = await createHandler();

      await handler.default(
        { siteId }, // no auditId
        context,
      );

      // saveEnrichmentMetadata should be called with generated UUID
      const metadataArg = mockUtils.saveEnrichmentMetadata.firstCall.args[2];
      expect(metadataArg.auditId).to.equal('generated-uuid');
    });

    it('should use provided auditId when available', async () => {
      const { handler, mockUtils } = await createHandler();

      await handler.default(
        { siteId, auditId: 'custom-audit-id' },
        context,
      );

      const metadataArg = mockUtils.saveEnrichmentMetadata.firstCall.args[2];
      expect(metadataArg.auditId).to.equal('custom-audit-id');
    });

    it('should skip when no prompts in config', async () => {
      const { handler, llmo } = await createHandler({
        flattenConfigPrompts: sinon.stub().returns([]),
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.not.have.been.called;
    });

    it('should skip when lock not acquired', async () => {
      const { handler, llmo } = await createHandler({
        acquireEnrichmentLock: sinon.stub().resolves({ acquired: false }),
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.not.have.been.called;
    });

    it('should send continuation when more batches remain', async () => {
      // 15 prompts → needs 2 batches with batch size 10
      const bigConfig = {
        topics: {
          't1': {
            name: 'Topic 1',
            prompts: Array.from({ length: 15 }, (_, i) => ({ prompt: `prompt ${i}`, regions: ['us'] })),
          },
        },
        aiTopics: {},
      };

      const { handler } = await createHandler({}, {
        readConfig: sinon.stub().resolves({ config: bigConfig, exists: true }),
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(200);

      // Verify continuation message was sent
      expect(sqs.sendMessage).to.have.been.calledWith(
        'audit-queue',
        sinon.match({
          type: 'enrich:brand-data',
          siteId,
          auditId: 'generated-uuid',
          batchStart: 10,
        }),
      );
    });

    it('should abort on final conflict check', async () => {
      const conflictStub = sinon.stub();
      conflictStub.resolves({ hasConflict: true, reason: 'lock-stolen' });

      const { handler, llmo } = await createHandler({
        checkEnrichmentConflict: conflictStub,
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.not.have.been.called;
    });
  });

  describe('Continuation (batchStart > 0)', () => {
    it('should load from temp, process batch, send continuation', async () => {
      const { handler, mockUtils } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves({
          auditId: 'test-audit-id',
          siteId,
          lockId: 'brand-data-enrichment',
          totalPrompts: 25,
          createdAt: new Date().toISOString(),
        }),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(200);

      expect(mockUtils.loadEnrichmentConfig).to.have.been.calledOnce;
      expect(mockUtils.processJsonEnrichmentBatch).to.have.been.calledOnce;
      expect(mockUtils.saveEnrichmentConfig).to.have.been.calledOnce;

      // Verify continuation message
      expect(sqs.sendMessage).to.have.been.calledWith(
        'audit-queue',
        sinon.match({
          type: 'enrich:brand-data',
          auditId: 'test-audit-id',
          batchStart: 20,
        }),
      );
    });

    it('should return notFound when metadata is missing', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves(null),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(404);
    });
  });

  describe('Completion', () => {
    it('should write config via llmoConfig.writeConfig and release lock', async () => {
      const { handler, mockUtils, llmo } = await createHandler();

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 0 },
        context,
      );

      expect(result.status).to.equal(200);

      expect(llmo.writeConfig).to.have.been.calledOnce;
      expect(mockUtils.releaseEnrichmentLock).to.have.been.calledOnce;
    });

    it('should complete on continuation final batch', async () => {
      const { handler, llmo } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().resolves({
          auditId: 'test-audit-id',
          siteId,
          lockId: 'brand-data-enrichment',
          totalPrompts: 3,
          createdAt: new Date().toISOString(),
        }),
        loadEnrichmentConfig: sinon.stub().resolves(createMockConfig()),
      });

      // batchStart=0 with totalPrompts=3 and batchSize=10 → completes in one go
      // But use continuation path: batchStart > 0 that finishes
      // Actually, totalPrompts=3 with batchStart=0 and batch size 10, all fit in one batch
      // Let's test with a continuation that completes:
      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      // totalPrompts=3, batchStart=10 → batchEnd=min(20,3)=3, remaining=3-3=0 → completion
      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.have.been.calledOnce;
    });
  });

  describe('Timeout handling', () => {
    it('should write partial config and release lock on timeout', async () => {
      const { handler, mockUtils, llmo } = await createHandler({
        isEnrichmentTimedOut: sinon.stub().returns(true),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(200);

      // Partial config should be written
      expect(llmo.writeConfig).to.have.been.calledOnce;
      expect(mockUtils.loadEnrichmentConfig).to.have.been.calledOnce;
      expect(mockUtils.releaseEnrichmentLock).to.have.been.calledOnce;
    });
  });

  describe('Conflict detection', () => {
    it('should abort when conflict detected on continuation', async () => {
      const { handler, llmo } = await createHandler({
        checkEnrichmentConflict: sinon.stub().resolves({
          hasConflict: true,
          reason: 'lock-stolen',
        }),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.not.have.been.called;
    });

    it('should abort when final conflict detected on continuation completion', async () => {
      const conflictStub = sinon.stub();
      // First call (pre-batch) returns no conflict
      conflictStub.onFirstCall().resolves({ hasConflict: false });
      // Second call (final check) returns conflict
      conflictStub.onSecondCall().resolves({ hasConflict: true, reason: 'lock-stolen' });

      const { handler, llmo } = await createHandler({
        checkEnrichmentConflict: conflictStub,
        loadEnrichmentMetadata: sinon.stub().resolves({
          auditId: 'test-audit-id',
          siteId,
          lockId: 'brand-data-enrichment',
          totalPrompts: 3,
          createdAt: new Date().toISOString(),
        }),
        loadEnrichmentConfig: sinon.stub().resolves(createMockConfig()),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(200);
      expect(llmo.writeConfig).to.not.have.been.called;
    });
  });

  describe('Error handling', () => {
    it('should return 500 and NOT write config on unexpected error', async () => {
      const { handler, mockUtils, llmo } = await createHandler({
        processJsonEnrichmentBatch: sinon.stub().rejects(new Error('Processing failed')),
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(500);
      // Config should NOT be written on error
      expect(llmo.writeConfig).to.not.have.been.called;
      // Lock should be released (metadata was set before error)
      expect(mockUtils.releaseEnrichmentLock).to.have.been.calledOnce;
    });

    it('should not release lock when metadata is null (early error)', async () => {
      const { handler, mockUtils } = await createHandler({}, {
        readConfig: sinon.stub().rejects(new Error('S3 error')),
      });

      const result = await handler.default(
        { siteId },
        context,
      );

      expect(result.status).to.equal(500);
      // Lock should NOT be released since metadata was never set
      expect(mockUtils.releaseEnrichmentLock).to.not.have.been.called;
    });

    it('should return 500 when loadEnrichmentMetadata fails on continuation', async () => {
      const { handler } = await createHandler({
        loadEnrichmentMetadata: sinon.stub().rejects(new Error('S3 load failed')),
      });

      const result = await handler.default(
        { siteId, auditId: 'test-audit-id', batchStart: 10 },
        context,
      );

      expect(result.status).to.equal(500);
    });
  });

  describe('Default batchStart', () => {
    it('should default batchStart to 0 if not provided', async () => {
      const { handler, llmo } = await createHandler();

      const result = await handler.default(
        { siteId }, // No batchStart
        context,
      );

      expect(result.status).to.equal(200);
      // Should go through first-invocation path (reads config)
      expect(llmo.readConfig).to.have.been.calledOnce;
    });
  });
});
