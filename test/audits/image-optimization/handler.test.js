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
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

const AUDIT_TYPE = 'image-optimization';

describe('Image Optimization Handler', () => {
  let sandbox;
  const bucketName = 'test-bucket';
  const s3BucketPath = 'scrapes/site-id/';
  let context;
  let handlerModule;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        finalUrl: 'https://example.com',
        site: {
          getId: () => 'site-id',
          getBaseURL: () => 'https://example.com',
          getConfig: () => ({
            getIncludedURLs: sandbox.stub().returns([]),
          }),
        },
        audit: {
          getId: () => 'audit-id',
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: bucketName,
          QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
        },
        dataAccess: {
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([
              { getUrl: () => 'https://example.com/page1' },
              { getUrl: () => 'https://example.com/page2' },
            ]),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub().resolves({
              getId: sandbox.stub().returns('opportunity-id'),
              getData: sandbox.stub().returns({}),
              setData: sandbox.stub(),
              save: sandbox.stub().resolves(),
              getType: sandbox.stub().returns(AUDIT_TYPE),
            }),
          },
        },
      })
      .build();

    handlerModule = await import('../../../src/image-optimization/handler.js');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processImportStep', () => {
    it('should prepare import step with correct parameters', async () => {
      const result = await handlerModule.processImportStep(context);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: s3BucketPath,
        type: 'top-pages',
        siteId: 'site-id',
      });
    });

    it('should use site ID for S3 bucket path', async () => {
      const result = await handlerModule.processImportStep(context);
      expect(result.fullAuditRef).to.include('site-id');
    });
  });

  describe('processImageOptimization', () => {
    let sendImageOptimizationToAnalyzerStub;
    let cleanupOutdatedSuggestionsStub;

    beforeEach(async () => {
      sendImageOptimizationToAnalyzerStub = sandbox.stub().resolves();
      cleanupOutdatedSuggestionsStub = sandbox.stub().resolves();

      handlerModule = await esmock('../../../src/image-optimization/handler.js', {
        '../../../src/image-optimization/opportunityHandler.js': {
          sendImageOptimizationToAnalyzer: sendImageOptimizationToAnalyzerStub,
          chunkArray: (array, size) => {
            const chunks = [];
            for (let i = 0; i < array.length; i += size) {
              chunks.push(array.slice(i, i + size));
            }
            return chunks;
          },
          cleanupOutdatedSuggestions: cleanupOutdatedSuggestionsStub,
        },
      });
    });

    it('should create new opportunity when none exists', async () => {
      await handlerModule.processImageOptimization(context);

      expect(context.dataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith('site-id', 'NEW');
      expect(context.dataAccess.Opportunity.create).to.have.been.called;

      const createCall = context.dataAccess.Opportunity.create.firstCall.args[0];
      expect(createCall).to.have.property('siteId', 'site-id');
      expect(createCall).to.have.property('auditId', 'audit-id');
      expect(createCall).to.have.property('type', AUDIT_TYPE);
      expect(createCall).to.have.property('origin', 'AUTOMATION');
      expect(createCall.title).to.include('AVIF');
      expect(createCall.tags).to.include('performance');
      expect(createCall.tags).to.include('core-web-vitals');
      expect(createCall.tags).to.include('images');
    });

    it('should update existing opportunity for new audit run', async () => {
      const existingOpportunity = {
        getId: () => 'existing-oppty-id',
        getType: () => AUDIT_TYPE,
        getData: sandbox.stub().returns({
          totalImages: 100,
          potentialSavingsBytes: 50000,
        }),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([existingOpportunity]);

      await handlerModule.processImageOptimization(context);

      expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
      expect(existingOpportunity.setData).to.have.been.called;
      expect(existingOpportunity.save).to.have.been.called;

      const setDataCall = existingOpportunity.setData.firstCall.args[0];
      expect(setDataCall.analyzerResponsesReceived).to.equal(0);
      expect(setDataCall.processedAnalysisIds).to.deep.equal([]);
      expect(setDataCall.totalImages).to.equal(100);
      expect(setDataCall.potentialSavingsBytes).to.equal(50000);
    });

    it('should send page URLs to analyzer', async () => {
      await handlerModule.processImageOptimization(context);

      expect(sendImageOptimizationToAnalyzerStub).to.have.been.calledWith(
        'https://example.com',
        ['https://example.com/page1', 'https://example.com/page2'],
        'site-id',
        'audit-id',
        context,
      );
    });

    it('should include both top pages and included URLs', async () => {
      context.site.getConfig().getIncludedURLs.returns([
        'https://example.com/included1',
        'https://example.com/included2',
      ]);

      await handlerModule.processImageOptimization(context);

      const urls = sendImageOptimizationToAnalyzerStub.firstCall.args[1];
      expect(urls).to.include('https://example.com/page1');
      expect(urls).to.include('https://example.com/page2');
      expect(urls).to.include('https://example.com/included1');
      expect(urls).to.include('https://example.com/included2');
      expect(urls).to.have.lengthOf(4);
    });

    it('should deduplicate URLs', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([
        { getUrl: () => 'https://example.com/page1' },
        { getUrl: () => 'https://example.com/page1' },
      ]);

      await handlerModule.processImageOptimization(context);

      const urls = sendImageOptimizationToAnalyzerStub.firstCall.args[1];
      expect(urls).to.have.lengthOf(1);
      expect(urls[0]).to.equal('https://example.com/page1');
    });

    it('should throw error when no pages found', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      await expect(
        handlerModule.processImageOptimization(context),
      ).to.be.rejectedWith('No top pages found');
    });

    it('should cleanup outdated suggestions', async function () {
      this.timeout(5000); // Increase timeout for this test

      const opportunity = {
        getId: () => 'oppty-id',
        getType: () => AUDIT_TYPE,
        getData: () => ({}),
        setData: sandbox.stub(),
        save: sandbox.stub().resolves(),
      };

      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([opportunity]);

      await handlerModule.processImageOptimization(context);

      // Wait for cleanup to be called (after 1 second delay in handler)
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(cleanupOutdatedSuggestionsStub).to.have.been.calledWith(opportunity, context.log);
    });

    it('should set correct analyzer batch expectations', async () => {
      const topPages = Array.from({ length: 25 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i}`,
      }));
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      await handlerModule.processImageOptimization(context);

      const createCall = context.dataAccess.Opportunity.create.firstCall.args[0];
      expect(createCall.data.analyzerResponsesExpected).to.equal(3);
    });

    it('should log processing start', async () => {
      await handlerModule.processImageOptimization(context);

      expect(context.log.debug).to.have.been.calledWith(
        '[image-optimization]: Processing image optimization for site site-id',
      );
    });

    it('should handle errors and rethrow', async () => {
      context.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(
        new Error('Database error'),
      );

      await expect(
        handlerModule.processImageOptimization(context),
      ).to.be.rejectedWith('Database error');

      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to process image optimization/),
      );
    });
  });

  describe('Audit Builder', () => {
    it('should export audit handler with correct structure', () => {
      const handler = handlerModule.default;
      expect(handler).to.exist;
      expect(handler).to.have.property('run');
      expect(typeof handler.run).to.equal('function');
    });
  });
});

