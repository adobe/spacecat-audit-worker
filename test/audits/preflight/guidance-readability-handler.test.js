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

import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';

describe('Guidance Readability Handler Tests', () => {
  let handler;
  let mockContext;
  let mockSite;
  let mockAsyncJob;
  let mockAsyncJobEntity;
  let mockDataAccess;
  let logStub;

  before(async function setupMocks() {
    this.timeout(5000);

    // Mock the handler with dependencies
    handler = await esmock('../../../src/readability/guidance-readability-handler.js', {
      '@adobe/spacecat-shared-http-utils': {
        ok: sinon.stub().returns({ ok: true }),
        notFound: sinon.stub().returns({ notFound: true }),
      },
      '@adobe/spacecat-shared-data-access': {
        AsyncJob: {
          Status: {
            COMPLETED: 'COMPLETED',
            IN_PROGRESS: 'IN_PROGRESS',
          },
        },
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

    mockSite = {
      getId: sinon.stub().returns('test-site-id'),
      getBaseURL: sinon.stub().returns('https://example.com'),
    };

    mockAsyncJob = {
      getId: sinon.stub().returns('test-job-id'),
      getStatus: sinon.stub().returns('IN_PROGRESS'),
      getMetadata: sinon.stub(),
      setMetadata: sinon.stub(),
      getResult: sinon.stub(),
      setResult: sinon.stub(),
      setStatus: sinon.stub(),
      setEndedAt: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    mockAsyncJobEntity = {
      findById: sinon.stub().resolves(mockAsyncJob),
    };

    mockDataAccess = {
      Site: {
        findById: sinon.stub().resolves(mockSite),
      },
      AsyncJob: mockAsyncJobEntity,
    };

    mockContext = {
      log: logStub,
      dataAccess: mockDataAccess,
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Input Validation', () => {
    it('should return notFound when site is not found', async () => {
      mockDataAccess.Site.findById.resolves(null);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'non-existent-site',
        data: {},
        id: 'message-id',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ notFound: true });
      expect(logStub.error).to.have.been.calledWithMatch('Site not found for siteId');
    });

    it('should return notFound when AsyncJob is not found', async () => {
      mockAsyncJobEntity.findById.resolves(null);

      const message = {
        auditId: 'non-existent-job',
        siteId: 'test-site-id',
        data: {},
        id: 'message-id',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ notFound: true });
      expect(logStub.error).to.have.been.calledWithMatch('AsyncJob not found for auditId');
    });

    it('should throw error when no readability metadata is found', async () => {
      mockAsyncJob.getMetadata.returns({});

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {},
        id: 'message-id',
      };

      try {
        await handler.default(message, mockContext);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No readability metadata found in job');
      }
    });

    it('should throw error when readability metadata has no originalOrderMapping', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            mystiqueResponsesExpected: 2,
          },
        },
      });

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {},
        id: 'message-id',
      };

      try {
        await handler.default(message, mockContext);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No readability metadata found in job');
      }
    });
  });

  describe('Duplicate Processing Prevention', () => {
    it('should skip processing when message ID is already processed', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'test' }],
            processedSuggestionIds: ['duplicate-message-id'],
          },
        },
      });

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {},
        id: 'duplicate-message-id',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('already processed. Skipping processing');
    });
  });

  describe('Mystique Response Format Processing', () => {
    beforeEach(() => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
          },
        },
      });
    });

    it('should process direct improved paragraph data format', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text here.',
          improved_flesch_score: 85.5,
          original_paragraph: 'Original complex text.',
          current_flesch_score: 25.3,
          seo_recommendation: 'Simplify language',
          ai_rationale: 'Use shorter sentences',
          target_flesch_score: 60,
          pageUrl: 'https://example.com/page1',
        },
        id: 'message-id-1',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(mockAsyncJob.setMetadata).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch('Successfully processed 1 suggestions');
    });

    it('should process suggestions array format', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          suggestions: [
            {
              pageUrl: 'https://example.com/page1',
              original_paragraph: 'Original text 1',
              improved_paragraph: 'Improved text 1',
              current_flesch_score: 20,
              improved_flesch_score: 80,
              seo_recommendation: 'Simplify',
              ai_rationale: 'Use simpler words',
              target_flesch_score: 60,
            },
            {
              pageUrl: 'https://example.com/page2',
              original_paragraph: 'Original text 2',
              improved_paragraph: 'Improved text 2',
              current_flesch_score: 15,
              improved_flesch_score: 75,
              seo_recommendation: 'Shorten sentences',
              ai_rationale: 'Break up long sentences',
              target_flesch_score: 60,
            },
          ],
        },
        id: 'message-id-2',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('Successfully processed 2 suggestions');
    });

    it('should process guidance array format', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          guidance: [
            {
              pageUrl: 'https://example.com/page1',
              original_paragraph: 'Guidance text',
              improved_paragraph: 'Improved guidance',
              current_flesch_score: 30,
              improved_flesch_score: 70,
              seo_recommendation: 'Use clearer language',
              ai_rationale: 'Make more accessible',
              target_flesch_score: 60,
            },
          ],
        },
        id: 'message-id-3',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('Successfully processed 1 suggestions');
    });

    it('should handle empty or invalid suggestions gracefully', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          invalid_field: 'no valid suggestions here',
        },
        id: 'message-id-4',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No valid readability improvements found');
    });
  });

  describe('Job Metadata Updates', () => {
    beforeEach(() => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'test' }],
            mystiqueResponsesExpected: 2,
            mystiqueResponsesReceived: 0,
            suggestions: [],
            processedSuggestionIds: [],
          },
        },
      });
    });

    it('should update job metadata successfully', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
          original_paragraph: 'Original text',
          current_flesch_score: 20,
        },
        id: 'message-id-5',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(mockAsyncJob.setMetadata).to.have.been.called;
      expect(mockAsyncJob.save).to.have.been.called;

      const setMetadataCall = mockAsyncJob.setMetadata.getCall(0);
      const updatedMetadata = setMetadataCall.args[0];
      expect(updatedMetadata.payload.readabilityMetadata.mystiqueResponsesReceived).to.equal(1);
      expect(updatedMetadata.payload.readabilityMetadata.processedSuggestionIds).to.include('message-id-5');
      expect(updatedMetadata.payload.readabilityMetadata.suggestions).to.have.lengthOf(1);
    });

    it('should handle job metadata update failures', async () => {
      mockAsyncJob.save.rejects(new Error('Database error'));

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'message-id-6',
      };

      try {
        await handler.default(message, mockContext);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Failed to update job metadata');
        expect(logStub.error).to.have.been.calledWithMatch('Updating job metadata for job');
      }
    });
  });

  describe('All Responses Received Logic', () => {
    it('should complete AsyncJob when all responses are received', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [
              { originalIndex: 0, textContent: 'Text 1' },
              { originalIndex: 1, textContent: 'Text 2' },
            ],
            mystiqueResponsesExpected: 2,
            mystiqueResponsesReceived: 1, // This will become 2 after processing
            suggestions: [
              {
                id: 'suggestion-1',
                originalText: 'Text 1',
                improvedText: 'Improved Text 1',
                originalFleschScore: 20,
                improvedFleschScore: 80,
                aiRationale: 'Simplified language',
              },
            ],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  textContent: 'Text 1',
                  fleschReadingEase: 20,
                  check: 'poor-readability',
                },
                {
                  textContent: 'Text 2',
                  fleschReadingEase: 15,
                  check: 'poor-readability',
                },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      // Mock fresh job reload
      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved Text 2',
          improved_flesch_score: 85,
          original_paragraph: 'Text 2',
          current_flesch_score: 15,
          ai_rationale: 'Made clearer',
        },
        id: 'final-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(mockAsyncJob.setResult).to.have.been.called;
      expect(mockAsyncJob.setStatus).to.have.been.calledWith('COMPLETED');
      expect(mockAsyncJob.setEndedAt).to.have.been.called;
      expect(logStub.info).to.have.been.calledWithMatch('All 2 Mystique responses received');
    });

    it('should handle race condition when job is already completed', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Text 1' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0, // This will become 1 after processing
            suggestions: [],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  textContent: 'Text 1',
                  fleschReadingEase: 20,
                },
              ],
            },
          ],
        },
      ]);

      // Simulate race condition - job is already COMPLETED
      mockAsyncJob.getStatus.returns('COMPLETED');

      // Fresh job is also COMPLETED
      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('COMPLETED');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved Text',
          improved_flesch_score: 80,
          original_paragraph: 'Text 1',
          current_flesch_score: 20,
        },
        id: 'race-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(mockAsyncJob.setResult).to.have.been.called;
      // Status should not be set again since it's already COMPLETED
      expect(mockAsyncJob.setStatus).to.not.have.been.called;
      expect(mockAsyncJob.setEndedAt).to.not.have.been.called;
    });
  });

  describe('Opportunity Reconstruction', () => {
    it('should reconstruct opportunities from stored suggestions when AsyncJob has none', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [
              { originalIndex: 0, textContent: 'Original Text 1' },
              { originalIndex: 1, textContent: 'Original Text 2' },
            ],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0, // Will become 1
            suggestions: [
              {
                id: 'suggestion-1',
                originalText: 'Original Text 1',
                improvedText: 'Improved Text 1',
                originalFleschScore: 25,
                improvedFleschScore: 75,
              },
              {
                id: 'suggestion-2',
                originalText: 'Original Text 2',
                improvedText: 'Improved Text 2',
                originalFleschScore: 30,
                improvedFleschScore: 80,
              },
            ],
          },
        },
      });

      // AsyncJob has no opportunities (cleared during async processing)
      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [], // Empty - need to reconstruct
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Additional improved text',
          improved_flesch_score: 85,
        },
        id: 'reconstruct-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('Reconstructing opportunities from 3 stored suggestions');
      expect(logStub.info).to.have.been.calledWithMatch('Reconstructed 3 opportunities from suggestions');
    });

    it('should handle null suggestions during reconstruction', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Text 1' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [null, undefined, { originalText: 'Valid suggestion' }], // Mixed valid/invalid
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'null-suggestions-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No valid suggestion found at index');
    });
  });

  describe('Original Order Mapping', () => {
    it('should use stored original order mapping when available', async () => {
      const storedOrderMapping = [
        { originalIndex: 1, textContent: 'Second text' },
        { originalIndex: 0, textContent: 'First text' },
      ];

      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: storedOrderMapping,
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [
              {
                originalText: 'First text',
                improvedText: 'Improved first',
                originalFleschScore: 20,
                improvedFleschScore: 80,
              },
              {
                originalText: 'Second text',
                improvedText: 'Improved second',
                originalFleschScore: 25,
                improvedFleschScore: 75,
              },
            ],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                { textContent: 'Second text', fleschReadingEase: 25 },
                { textContent: 'First text', fleschReadingEase: 20 },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Final improvement',
          improved_flesch_score: 85,
        },
        id: 'order-mapping-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('Using stored original order mapping with 2 items');
      expect(logStub.info).to.have.been.calledWithMatch('Sorted 2 opportunities back to original order');
    });

    it('should create fallback order mapping when none is stored', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: 'invalid-mapping', // Non-array value to trigger fallback
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                { textContent: 'Text 1', fleschReadingEase: 20 },
                { textContent: 'Text 2', fleschReadingEase: 25 },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Fallback improved text',
          improved_flesch_score: 80,
        },
        id: 'fallback-order-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No stored order mapping found, using current order as fallback');
    });
  });

  describe('Suggestion Matching and Math Calculations', () => {
    it('should match suggestions correctly and calculate scores with proper rounding', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test content' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [
              {
                originalText: 'Test content',
                improvedText: 'Improved test content',
                originalFleschScore: 23.456, // Should be rounded
                improvedFleschScore: 78.789, // Should be rounded
                aiRationale: 'Made it simpler',
              },
            ],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  textContent: 'Test content',
                  fleschReadingEase: 23.456,
                  check: 'poor-readability',
                },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Final improvement',
          improved_flesch_score: 85,
        },
        id: 'math-calculation-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Verify setResult was called with properly rounded values
      const setResultCall = mockAsyncJob.setResult.getCall(0);
      const updatedResult = setResultCall.args[0];
      const opportunity = updatedResult[0].audits[0].opportunities[0];

      expect(opportunity.improvedFleschScore).to.equal(78.79); // Rounded to 2 decimal places
      expect(opportunity.readabilityImprovement).to.equal(55.33); // 78.789 - 23.456 rounded
      expect(opportunity.suggestionStatus).to.equal('completed');
      expect(opportunity.aiSuggestion).to.equal('Improved test content');
      expect(opportunity.aiRationale).to.equal('Made it simpler');
    });

    it('should handle missing original score by using opportunity flesch reading ease', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test content' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [
              {
                originalText: 'Test content',
                improvedText: 'Improved content',
                originalFleschScore: null, // Missing original score
                improvedFleschScore: 80,
              },
            ],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  textContent: 'Test content',
                  fleschReadingEase: 25, // Should be used as fallback
                },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Final improvement',
          improved_flesch_score: 85,
        },
        id: 'fallback-score-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      const setResultCall = mockAsyncJob.setResult.getCall(0);
      const updatedResult = setResultCall.args[0];
      const opportunity = updatedResult[0].audits[0].opportunities[0];

      expect(opportunity.readabilityImprovement).to.equal(55); // 80 - 25
    });

    it('should warn when no matching suggestion is found', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Unmatched content' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [
              {
                originalText: 'Different content', // Does not match opportunity
                improvedText: 'Improved different content',
                originalFleschScore: 20,
                improvedFleschScore: 80,
              },
            ],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  textContent: 'Unmatched content', // No matching suggestion
                  fleschReadingEase: 25,
                },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Final improvement',
          improved_flesch_score: 85,
        },
        id: 'no-match-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No matching suggestion found for opportunity');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [{ textContent: 'Test', fleschReadingEase: 25 }],
            },
          ],
        },
      ]);
    });

    it('should handle AsyncJob completion errors gracefully', async () => {
      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      // Simulate error during job completion
      const freshJob = { ...mockAsyncJob };
      freshJob.save = sinon.stub().rejects(new Error('Save failed'));
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'error-handling-message',
      };

      const result = await handler.default(message, mockContext);

      // Should still return ok() even though completion failed
      expect(result).to.deep.equal({ ok: true });
      expect(logStub.error).to.have.been.calledWithMatch('Error updating AsyncJob');
    });

    it('should handle fresh job reload failure', async () => {
      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      // Simulate error during fresh job reload
      mockAsyncJobEntity.findById.onSecondCall().rejects(new Error('Job not found'));

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'reload-error-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.error).to.have.been.calledWithMatch('Error updating AsyncJob');
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle empty getResult() gracefully', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      mockAsyncJob.getResult.returns([]); // Empty result
      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'empty-result-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
    });

    it('should handle zero mystiqueResponsesExpected', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 0, // Zero expected responses
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'zero-expected-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      // Should not trigger completion logic since expected is 0
      expect(logStub.info).to.not.have.been.calledWithMatch('All 0 Mystique responses received');
    });

    it('should handle missing pageUrl in suggestion data', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
          original_paragraph: 'Original text',
          current_flesch_score: 20,
          // pageUrl is missing
        },
        id: 'missing-pageurl-message',
      };

      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Should use auditUrl as fallback
      const setMetadataCall = mockAsyncJob.setMetadata.getCall(0);
      const updatedMetadata = setMetadataCall.args[0];
      const suggestion = updatedMetadata.payload.readabilityMetadata.suggestions[0];
      expect(suggestion.pageUrl).to.equal('https://example.com'); // Site's base URL
    });

    it('should handle sort with identical originalIndex values', async () => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [
              { originalIndex: 0, textContent: 'Text A' },
              { originalIndex: 0, textContent: 'Text B' }, // Duplicate index
            ],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                { textContent: 'Text B', fleschReadingEase: 25 },
                { textContent: 'Text A', fleschReadingEase: 20 },
              ],
            },
          ],
        },
      ]);

      mockAsyncJob.getStatus.returns('IN_PROGRESS');

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'duplicate-index-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.info).to.have.been.calledWithMatch('Sorted 2 opportunities back to original order');
    });
  });

  describe('Helper Function Tests', () => {
    it('should map Mystique suggestions correctly', async () => {
      // Test the mapMystiqueSuggestionsToOpportunityFormat function indirectly
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          suggestions: [
            {
              pageUrl: 'https://example.com/page1',
              original_paragraph: 'Original complex text here.',
              improved_paragraph: 'Improved simple text here.',
              current_flesch_score: 15.5,
              improved_flesch_score: 75.8,
              seo_recommendation: 'Use shorter sentences and simpler words.',
              ai_rationale: 'The text was too complex for average readers.',
              target_flesch_score: 60,
            },
          ],
        },
        id: 'mapping-test-message',
      };

      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Verify the mapped suggestion structure
      const setMetadataCall = mockAsyncJob.setMetadata.getCall(0);
      const updatedMetadata = setMetadataCall.args[0];
      const mappedSuggestion = updatedMetadata.payload.readabilityMetadata.suggestions[0];

      expect(mappedSuggestion.id).to.include('readability-https://example.com/page1-0');
      expect(mappedSuggestion.pageUrl).to.equal('https://example.com/page1');
      expect(mappedSuggestion.originalText).to.equal('Original complex text here.');
      expect(mappedSuggestion.improvedText).to.equal('Improved simple text here.');
      expect(mappedSuggestion.originalFleschScore).to.equal(15.5);
      expect(mappedSuggestion.improvedFleschScore).to.equal(75.8);
      expect(mappedSuggestion.seoRecommendation).to.equal('Use shorter sentences and simpler words.');
      expect(mappedSuggestion.aiRationale).to.equal('The text was too complex for average readers.');
      expect(mappedSuggestion.targetFleschScore).to.equal(60);
    });
  });

  describe('Coverage for uncovered lines', () => {
    beforeEach(() => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });
      mockAsyncJob.getStatus.returns('IN_PROGRESS');
    });

    it('should cover line 302: return auditItem unchanged when name is not readability', async () => {
      mockAsyncJob.getResult.returns([
        {
          audits: [
            {
              name: 'other-audit', // Not 'readability' - should trigger line 302
              opportunities: [{ someData: 'unchanged' }],
            },
            {
              name: 'readability',
              opportunities: [{ textContent: 'Test content', fleschReadingEase: 25 }],
            },
          ],
        },
      ]);

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'line-302-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Verify that non-readability audit items are returned unchanged
      const setResultCall = mockAsyncJob.setResult.getCall(0);
      const updatedResult = setResultCall.args[0];
      const otherAuditItem = updatedResult[0].audits.find((audit) => audit.name === 'other-audit');
      expect(otherAuditItem).to.deep.equal({
        name: 'other-audit',
        opportunities: [{ someData: 'unchanged' }],
      });
    });

    it('should cover line 307: return pageResult unchanged when audits property is missing', async () => {
      mockAsyncJob.getResult.returns([
        {
          // Page result without 'audits' property - should trigger line 307
          url: 'https://example.com/page1',
          status: 'completed',
          someOtherData: 'unchanged',
        },
        {
          audits: [
            {
              name: 'readability',
              opportunities: [{ textContent: 'Test content', fleschReadingEase: 25 }],
            },
          ],
        },
      ]);

      const freshJob = { ...mockAsyncJob };
      freshJob.getStatus = sinon.stub().returns('IN_PROGRESS');
      mockAsyncJobEntity.findById.onSecondCall().resolves(freshJob);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'line-307-message',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Verify that page results without audits are returned unchanged
      const setResultCall = mockAsyncJob.setResult.getCall(0);
      const updatedResult = setResultCall.args[0];
      const pageWithoutAudits = updatedResult[0];
      expect(pageWithoutAudits).to.deep.equal({
        url: 'https://example.com/page1',
        status: 'completed',
        someOtherData: 'unchanged',
      });
    });
  });

  describe('Branch Coverage for || fallback operators', () => {
    beforeEach(() => {
      mockAsyncJob.getMetadata.returns({
        payload: {
          readabilityMetadata: {
            originalOrderMapping: [{ originalIndex: 0, textContent: 'Test' }],
            mystiqueResponsesExpected: 1,
            mystiqueResponsesReceived: 0,
            suggestions: [],
          },
        },
      });
      mockAsyncJob.getStatus.returns('IN_PROGRESS');
    });

    it('should cover line 23: pageUrl || "unknown" when pageUrl is falsy', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          suggestions: [
            {
              pageUrl: null, // Falsy pageUrl to trigger || 'unknown'
              original_paragraph: 'Original text',
              improved_paragraph: 'Improved text',
              current_flesch_score: 20,
              improved_flesch_score: 80,
            },
            {
              pageUrl: '', // Empty string pageUrl to trigger || 'unknown'
              original_paragraph: 'Original text 2',
              improved_paragraph: 'Improved text 2',
              current_flesch_score: 25,
              improved_flesch_score: 75,
            },
          ],
        },
        id: 'pageurl-fallback-test',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });

      // Verify suggestions with 'unknown' pageUrl fallback were created
      const setMetadataCall = mockAsyncJob.setMetadata.getCall(0);
      const updatedMetadata = setMetadataCall.args[0];
      const { suggestions } = updatedMetadata.payload.readabilityMetadata;

      expect(suggestions[0].id).to.include('readability-unknown-0');
      expect(suggestions[1].id).to.include('readability-unknown-1');
    });

    it('should cover line 48: data || {} when message.data is falsy', async () => {
      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: null, // Falsy data to trigger || {} fallback
        id: 'data-fallback-test',
      };

      const result = await handler.default(message, mockContext);

      expect(result).to.deep.equal({ ok: true });
      expect(logStub.warn).to.have.been.calledWithMatch('No valid readability improvements found');
    });

    it('should cover line 74: getMetadata() || {} when getMetadata returns null', async () => {
      // Make getMetadata return null to trigger || {} fallback
      mockAsyncJob.getMetadata.returns(null);

      const message = {
        auditId: 'test-audit-id',
        siteId: 'test-site-id',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 80,
        },
        id: 'metadata-fallback-test',
      };

      try {
        await handler.default(message, mockContext);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('No readability metadata found in job');
      }
    });
  });
});
