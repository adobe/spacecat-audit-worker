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
  let mockSuggestion;
  let mockOpportunity;
  let mockContext;
  let mockS3Client;

  const S3_RESULTS = [
    {
      status: 'success',
      selector: '#content p:nth-child(1)',
      data: {
        success: true,
        originalParagraph: 'Original complex text with many words.',
        currentFleschScore: 25.3,
        improvedParagraph: 'Simple clear text.',
        improvedFleschScore: 75.5,
        seoRecommendation: 'Simplify language',
        aiRationale: 'Use shorter sentences',
        pageUrl: 'https://example.com/page1',
      },
    },
  ];

  before(async function setupMocks() {
    this.timeout(5000);

    handler = await esmock('../../../src/readability/opportunities/guidance-handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        ok: sinon.stub().returns({ ok: true }),
        notFound: sinon.stub().returns({ notFound: true }),
      },
    });
  });

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      error: sinon.stub(),
      warn: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSuggestion = {
      getId: sinon.stub().returns('suggestion-1'),
      getData: sinon.stub().returns({
        textPreview: 'Original complex text with many words.',
        selector: '#content p:nth-child(1)',
        pageUrl: 'https://example.com/page1',
        scrapedAt: '2025-01-01T00:00:00.000Z',
      }),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
      remove: sinon.stub().resolves(),
    };

    mockOpportunity = {
      getId: sinon.stub().returns('opp-1'),
      getAuditId: sinon.stub().returns('audit-123'),
      getSuggestions: sinon.stub().resolves([mockSuggestion]),
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
    it('should fetch results from S3, process, and delete the response file', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'readability/batch-results/site-1/audit-123.json' },
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // S3 should be called twice: GetObject + DeleteObject
      expect(mockS3Client.send).to.have.been.calledTwice;

      // Should update the suggestion with AI improvements
      expect(mockSuggestion.setData).to.have.been.called;
      expect(mockSuggestion.save).to.have.been.called;

      const updatedData = mockSuggestion.setData.getCall(0).args[0];
      expect(updatedData.improvedText).to.equal('Simple clear text.');
      expect(updatedData.improvedFleschScore).to.equal(75.5);
      expect(updatedData.aiSuggestion).to.equal('Simplify language');
      expect(updatedData.aiRationale).to.equal('Use shorter sentences');
      expect(updatedData.suggestionStatus).to.equal('completed');
    });

    it('should handle missing s3ResultsPath gracefully', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: {},
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No s3ResultsPath in message data');
    });

    it('should handle null data gracefully', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: null,
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No s3ResultsPath in message data');
    });

    it('should handle missing S3_MYSTIQUE_BUCKET_NAME', async () => {
      mockContext.env.S3_MYSTIQUE_BUCKET_NAME = null;

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.error).to.have.been.calledWithMatch('Missing S3_MYSTIQUE_BUCKET_NAME');
    });

    it('should handle S3 fetch error gracefully', async () => {
      mockS3Client.send.rejects(new Error('S3 read error'));

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.error).to.have.been.calledWithMatch('Failed to fetch batch results from S3');
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
      // Should still process suggestions even if delete fails
      expect(mockSuggestion.setData).to.have.been.called;
    });

  });

  describe('batch result processing', () => {
    it('should skip failed items and log warning', async () => {
      const mixedResults = [
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            originalParagraph: 'Original complex text with many words.',
            currentFleschScore: 25.3,
            improvedParagraph: 'Simple text.',
            improvedFleschScore: 75.5,
            seoRecommendation: 'Simplify',
            aiRationale: 'Shorter sentences',
            pageUrl: 'https://example.com/page1',
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
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('No valid suggestions to process');
    });

    it('should match by text preview when selector does not match', async () => {
      const results = [
        {
          status: 'success',
          selector: 'different-selector',
          data: {
            originalParagraph: 'Original complex text with many words.',
            currentFleschScore: 25.3,
            improvedParagraph: 'Improved text.',
            improvedFleschScore: 70,
            seoRecommendation: 'Simplify',
            aiRationale: 'Shorten',
            pageUrl: 'https://example.com/page1',
          },
        },
      ];

      mockSuggestion.getData.returns({
        textPreview: 'Original complex text with many words.',
        selector: 'some-other-selector',
        pageUrl: 'https://example.com/page1',
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

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
      expect(result).to.deep.equal({ ok: true });
      expect(mockSuggestion.setData).to.have.been.called;
    });

    it('should log warning when no matching suggestion found', async () => {
      const results = [
        {
          status: 'success',
          selector: 'unmatched-selector',
          data: {
            originalParagraph: 'Text that does not match anything.',
            currentFleschScore: 20,
            improvedParagraph: 'Better text.',
            improvedFleschScore: 70,
            seoRecommendation: 'Simplify',
            aiRationale: 'Shorten',
            pageUrl: 'https://example.com/page1',
          },
        },
      ];

      mockSuggestion.getData.returns({
        textPreview: 'Completely different text.',
        selector: 'different-selector',
        pageUrl: 'https://example.com/page1',
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

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
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No matching suggestion found');
    });

    it('should remove suggestion when improvedText is empty', async () => {
      const results = [
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            originalParagraph: 'Original complex text with many words.',
            currentFleschScore: 25.3,
            improvedParagraph: '',
            improvedFleschScore: 0,
            seoRecommendation: '',
            aiRationale: '',
            pageUrl: 'https://example.com/page1',
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
      expect(result).to.deep.equal({ ok: true });
      expect(mockSuggestion.remove).to.have.been.called;
    });

    it('should handle suggestion update error gracefully', async () => {
      mockSuggestion.save.rejects(new Error('Database error'));

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.error).to.have.been.calledWithMatch('Error updating suggestion');
    });

    it('should enrich suggestion data with auto-optimize transform rules', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      await handler.default(message, mockContext);

      const updatedData = mockSuggestion.setData.getCall(0).args[0];
      expect(updatedData.url).to.equal('https://example.com/page1');
      expect(updatedData.transformRules).to.exist;
      expect(updatedData.transformRules.value).to.equal('Simple clear text.');
      expect(updatedData.transformRules.op).to.equal('replace');
      expect(updatedData.transformRules.selector).to.equal('#content p:nth-child(1)');
      expect(updatedData.transformRules.target).to.equal('ai-bots');
      expect(updatedData.transformRules.prerenderRequired).to.equal(true);
    });

    it('should use "unknown" fallback when pageUrl is missing in batch result', async () => {
      const resultsNoPageUrl = [
        {
          status: 'success',
          selector: '#content p:nth-child(1)',
          data: {
            originalParagraph: 'Original complex text with many words.',
            currentFleschScore: 25.3,
            improvedParagraph: 'Simple clear text.',
            improvedFleschScore: 75.5,
            seoRecommendation: 'Simplify language',
            aiRationale: 'Use shorter sentences',
            // pageUrl deliberately omitted
          },
        },
      ];

      mockS3Client.send.callsFake((command) => {
        if (command.input?.Key) {
          return Promise.resolve({
            Body: {
              transformToString: sinon.stub().resolves(JSON.stringify(resultsNoPageUrl)),
            },
          });
        }
        return Promise.resolve();
      });

      // Update suggestion to match by text preview since pageUrl-based selector won't match
      mockSuggestion.getData.returns({
        textPreview: 'Original complex text with many words.',
        selector: '#content p:nth-child(1)',
        scrapedAt: '2025-01-01T00:00:00.000Z',
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-1',
        data: { s3ResultsPath: 'results/path.json' },
      };

      const result = await handler.default(message, mockContext);
      expect(result).to.deep.equal({ ok: true });
    });
  });
});
