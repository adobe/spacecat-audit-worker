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
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Readability Opportunities Guidance Handler', () => {
  let handler;
  let logStub;
  let mockOpportunity;
  let mockContext;
  let mockS3Client;
  let syncSuggestionsStub;

  const S3_RESULTS = [
    {
      status: 'success',
      selector: '#content p:nth-child(1)',
      data: {
        success: true,
        page_url: 'https://example.com/page1',
        original_paragraph: 'Original complex text with many words.',
        current_flesch_score: 25.3,
        improved_paragraph: 'Simple clear text.',
        improved_flesch_score: 75.5,
        seo_recommendation: 'Simplify language',
        ai_rationale: 'Use shorter sentences',
      },
    },
  ];

  before(async function setupMocks() {
    this.timeout(5000);

    syncSuggestionsStub = sinon.stub();

    handler = await esmock('../../../src/readability/opportunities/guidance-handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        ok: sinon.stub().returns({ ok: true }),
        notFound: sinon.stub().returns({ notFound: true }),
        badRequest: sinon.stub().returns({ badRequest: true }),
        noContent: sinon.stub().returns({ noContent: true }),
        internalServerError: sinon.stub().returns({ internalServerError: true }),
      },
      '@adobe/spacecat-shared-data-access': {
        Suggestion: { TYPES: { CONTENT_UPDATE: 'CONTENT_UPDATE' } },
      },
      '../../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
    });
  });

  beforeEach(() => {
    syncSuggestionsStub.reset();
    syncSuggestionsStub.resolves();

    logStub = {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
    };

    mockOpportunity = {
      getId: sinon.stub().returns('opp-1'),
      getAuditId: sinon.stub().returns('audit-123'),
    };

    mockS3Client = {
      send: sinon.stub(),
    };

    // Default: S3 GetObject returns batch results, DeleteObject succeeds
    mockS3Client.send.callsFake((command) => {
      if (command.constructor.name === 'GetObjectCommand' || command.input?.Key?.includes('results')) {
        return Promise.resolve({
          Body: {
            transformToString: sinon.stub().resolves(JSON.stringify(S3_RESULTS)),
          },
        });
      }
      // DeleteObjectCommand
      return Promise.resolve();
    });

    mockContext = {
      log: logStub,
      s3Client: mockS3Client,
      env: {
        S3_MYSTIQUE_BUCKET_NAME: 'test-bucket',
      },
      dataAccess: {
        Site: {
          findById: sinon.stub().resolves({
            getId: sinon.stub().returns('site-1'),
            getBaseURL: sinon.stub().returns('https://example.com'),
          }),
        },
        Audit: {
          findById: sinon.stub().resolves({
            getId: sinon.stub().returns('audit-123'),
            getAuditType: sinon.stub().returns('readability'),
          }),
        },
        Opportunity: {
          allBySiteId: sinon.stub().resolves([mockOpportunity]),
        },
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Site not found', () => {
    it('should return notFound when site is not found', async () => {
      mockContext.dataAccess.Site.findById.resolves(null);

      const message = {
        auditId: 'audit-123',
        siteId: 'missing-site',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ notFound: true });
    });
  });

  describe('Audit not found', () => {
    it('should return notFound when audit is not found', async () => {
      mockContext.dataAccess.Audit.findById.resolves(null);

      const message = {
        auditId: 'missing-audit',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ notFound: true });
    });
  });

  describe('Opportunity not found', () => {
    it('should return notFound when no matching opportunity is found', async () => {
      mockOpportunity.getAuditId.returns('different-audit');

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ notFound: true });
    });
  });

  describe('S3 batch flow', () => {
    it('should fetch results from S3, call syncSuggestions, and delete the response file', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'readability/batch-results/site-1/audit-123.json' },
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // S3 should be called twice: GetObject + DeleteObject
      expect(mockS3Client.send).to.have.been.calledTwice;

      // syncSuggestions should be called with mapped data
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      expect(syncArgs.context).to.equal(mockContext);
      expect(syncArgs.opportunity).to.equal(mockOpportunity);
      expect(syncArgs.newData).to.have.length(1);

      // Verify mapped suggestion data uses camelCase internally
      const mappedData = syncArgs.newData[0];
      expect(mappedData.pageUrl).to.equal('https://example.com/page1');
      expect(mappedData.selector).to.equal('#content p:nth-child(1)');
      expect(mappedData.originalText).to.equal('Original complex text with many words.');
      expect(mappedData.improvedText).to.equal('Simple clear text.');
      expect(mappedData.originalFleschScore).to.equal(25.3);
      expect(mappedData.improvedFleschScore).to.equal(75.5);
      expect(mappedData.readabilityImprovement).to.equal(50.2);
      expect(mappedData.seoRecommendation).to.equal('Simplify language');
      expect(mappedData.aiRationale).to.equal('Use shorter sentences');
      expect(mappedData.suggestionStatus).to.equal('completed');
    });

    it('should return badRequest when s3ResultsPath is missing', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: {},
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ badRequest: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No s3ResultsPath in message data');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should return badRequest when data is null', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: null,
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ badRequest: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No s3ResultsPath in message data');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should return internalServerError when S3_MYSTIQUE_BUCKET_NAME is missing', async () => {
      mockContext.env.S3_MYSTIQUE_BUCKET_NAME = null;

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ internalServerError: true });
      expect(logStub.error).to.have.been.calledWithMatch('Missing S3_MYSTIQUE_BUCKET_NAME');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should return badRequest for non-array batch results', async () => {
      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify({ not: 'an array' })),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ badRequest: true });
      expect(logStub.error).to.have.been.calledWithMatch('Expected batch results to be an array');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should return notFound when S3 fetch fails', async () => {
      mockS3Client.send.rejects(new Error('S3 read error'));

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ notFound: true });
      expect(logStub.error).to.have.been.calledWithMatch('Failed to fetch batch results from S3');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should handle S3 delete failure gracefully', async () => {
      let callCount = 0;
      mockS3Client.send.callsFake(() => {
        callCount += 1;
        if (callCount === 1) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(S3_RESULTS)),
            },
          });
        }
        // Second call is delete - should fail
        return Promise.reject(new Error('Delete failed'));
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('Failed to delete S3 response file');
      // syncSuggestions is called before delete, so it succeeds regardless
      expect(syncSuggestionsStub).to.have.been.calledOnce;
    });
  });

  describe('batch result processing', () => {
    it('should skip failed items and log warning', async () => {
      const mixedResults = [
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            page_url: 'https://example.com/page1',
            original_paragraph: 'Original complex text with many words.',
            current_flesch_score: 25.3,
            improved_paragraph: 'Simple text.',
            improved_flesch_score: 75.5,
            seo_recommendation: 'Simplify',
            ai_rationale: 'Shorter sentences',
          },
        },
        {
          status: 'failed',
          selector: '#content p:nth-child(2)',
          data: { error: 'timeout' },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(mixedResults)),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('1 items failed in batch results');

      // syncSuggestions should only receive the successful item
      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      expect(syncArgs.newData).to.have.length(1);
      expect(syncArgs.newData[0].selector).to.equal('#content p:nth-child(1)');
    });

    it('should handle all items failed', async () => {
      const allFailedResults = [
        {
          status: 'failed',
          selector: '#p1',
          data: { error: 'timeout' },
        },
        {
          status: 'failed',
          selector: '#p2',
          data: { error: 'internal error' },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(allFailedResults)),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ noContent: true });
      expect(logStub.info).to.have.been.calledWithMatch('No valid suggestions to process');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });

    it('should filter out items with empty improved_paragraph', async () => {
      const results = [
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            page_url: 'https://example.com/page1',
            original_paragraph: 'Original complex text with many words.',
            current_flesch_score: 25.3,
            improved_paragraph: '',
            improved_flesch_score: 0,
            seo_recommendation: '',
            ai_rationale: '',
          },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(results)),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ noContent: true });
      expect(logStub.info).to.have.been.calledWithMatch('No valid suggestions to process');
      expect(syncSuggestionsStub).to.not.have.been.called;
    });
  });

  describe('buildKey function', () => {
    it('should use pageUrl and selector as key', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      await handler.default(message, mockContext);

      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      const { buildKey } = syncArgs;

      const key = buildKey({
        pageUrl: 'https://example.com/page1',
        selector: '#content p:nth-child(1)',
      });
      expect(key).to.equal('https://example.com/page1-#content p:nth-child(1)');
    });

    it('should produce different keys for different selectors on the same page', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      await handler.default(message, mockContext);

      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      const { buildKey } = syncArgs;

      const key1 = buildKey({ pageUrl: 'https://example.com/page1', selector: '#content p:nth-child(1)' });
      const key2 = buildKey({ pageUrl: 'https://example.com/page1', selector: '#content p:nth-child(2)' });
      expect(key1).to.not.equal(key2);
    });
  });

  describe('null selector filtering', () => {
    it('should filter out suggestions with null selector', async () => {
      const resultsWithNullSelector = [
        {
          status: 'success',
          selector: null,
          data: {
            page_url: 'https://example.com/page1',
            original_paragraph: 'Text without selector.',
            current_flesch_score: 30,
            improved_paragraph: 'Improved text.',
            improved_flesch_score: 70,
            seo_recommendation: 'Simplify',
            ai_rationale: 'Shorter sentences',
          },
        },
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            page_url: 'https://example.com/page1',
            original_paragraph: 'Original text.',
            current_flesch_score: 25,
            improved_paragraph: 'Simple text.',
            improved_flesch_score: 75,
            seo_recommendation: 'Simplify',
            ai_rationale: 'Shorter sentences',
          },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(resultsWithNullSelector)),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });

      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      expect(syncArgs.newData).to.have.length(1);
      expect(syncArgs.newData[0].selector).to.equal('#content p:nth-child(1)');
    });

    it('should return noContent when all suggestions have null selector', async () => {
      const allNullSelectors = [
        {
          status: 'success',
          selector: null,
          data: {
            page_url: 'https://example.com/page1',
            original_paragraph: 'Text.',
            current_flesch_score: 30,
            improved_paragraph: 'Better text.',
            improved_flesch_score: 70,
            seo_recommendation: 'Simplify',
            ai_rationale: 'Reason',
          },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(allNullSelectors)),
            },
          });
        }
        return Promise.resolve();
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ noContent: true });
      expect(syncSuggestionsStub).to.not.have.been.called;
    });
  });

  describe('mapNewSuggestion function', () => {
    it('should create suggestion with correct structure and auto-optimize enrichment', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      await handler.default(message, mockContext);

      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      const { mapNewSuggestion, newData } = syncArgs;
      const suggestion = mapNewSuggestion(newData[0]);

      expect(suggestion.opportunityId).to.equal('opp-1');
      expect(suggestion.type).to.equal('CONTENT_UPDATE');
      expect(suggestion.rank).to.equal(10);
      expect(suggestion.data.improvedText).to.equal('Simple clear text.');
      expect(suggestion.data.pageUrl).to.equal('https://example.com/page1');
      expect(suggestion.data.url).to.equal('https://example.com/page1');
      expect(suggestion.data.transformRules).to.deep.include({
        value: 'Simple clear text.',
        op: 'replace',
        selector: '#content p:nth-child(1)',
        target: 'ai-bots',
        prerenderRequired: true,
      });
      expect(suggestion.data.mystiqueProcessingCompleted).to.be.a('string');
    });
  });

  describe('mergeDataFunction', () => {
    it('should merge AI improvements into existing suggestion data with auto-optimize enrichment', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      await handler.default(message, mockContext);

      const syncArgs = syncSuggestionsStub.getCall(0).args[0];
      const { mergeDataFunction, newData } = syncArgs;

      const existingData = {
        pageUrl: 'https://example.com/page1',
        selector: '#content p:nth-child(1)',
        scrapedAt: '2025-01-01T00:00:00.000Z',
        textPreview: 'Original complex text with many words.',
        fleschScore: 25.3,
      };

      const merged = mergeDataFunction(existingData, newData[0]);

      // Preserves existing data
      expect(merged.textPreview).to.equal('Original complex text with many words.');
      expect(merged.fleschScore).to.equal(25.3);
      expect(merged.scrapedAt).to.equal('2025-01-01T00:00:00.000Z');

      // Adds AI improvement data
      expect(merged.improvedText).to.equal('Simple clear text.');
      expect(merged.improvedFleschScore).to.equal(75.5);
      expect(merged.readabilityImprovement).to.equal(50.2);
      expect(merged.aiSuggestion).to.equal('Simplify language');
      expect(merged.aiRationale).to.equal('Use shorter sentences');
      expect(merged.suggestionStatus).to.equal('completed');
      expect(merged.mystiqueProcessingCompleted).to.be.a('string');

      // Auto-optimize enrichment
      expect(merged.url).to.equal('https://example.com/page1');
      expect(merged.transformRules).to.deep.include({
        value: 'Simple clear text.',
        op: 'replace',
        selector: '#content p:nth-child(1)',
        target: 'ai-bots',
        prerenderRequired: true,
      });
    });
  });
});
