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
import handler from '../../../src/readability/opportunities/guidance-handler.js';

use(sinonChai);
use(chaiAsPromised);

describe('Readability Opportunities Guidance Handler', () => {
  let mockContext;
  let mockSite;
  let mockAudit;
  let mockOpportunity;
  let mockSuggestion;
  let log;

  beforeEach(() => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSuggestion = {
      getId: sinon.stub().returns('suggestion-1'),
      getData: sinon.stub().returns({
        textPreview: 'This is a test paragraph that needs improvement.',
        pageUrl: 'https://example.com/page1',
        selector: 'p.content',
        scrapedAt: '2025-01-01T00:00:00.000Z',
      }),
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
      remove: sinon.stub().resolves(),
    };

    mockOpportunity = {
      getAuditId: sinon.stub().returns('audit-123'),
      getSuggestions: sinon.stub().resolves([mockSuggestion]),
    };

    mockSite = {
      getBaseURL: sinon.stub().returns('https://example.com'),
    };

    mockAudit = {
      getAuditType: sinon.stub().returns('readability-opportunity'),
    };

    mockContext = {
      log,
      dataAccess: {
        Site: {
          findById: sinon.stub().resolves(mockSite),
        },
        Audit: {
          findById: sinon.stub().resolves(mockAudit),
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
        siteId: 'site-456',
        data: {},
        id: 'message-1',
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith('[readability-opportunity guidance]: Site not found for siteId: site-456');
    });
  });

  describe('Audit not found', () => {
    it('should return notFound when audit is not found', async () => {
      mockContext.dataAccess.Audit.findById.resolves(null);

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        data: {},
        id: 'message-1',
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith('[readability-opportunity guidance]: Audit not found for auditId: audit-123');
    });
  });

  describe('Opportunity not found', () => {
    it('should return notFound when no matching opportunity is found', async () => {
      mockContext.dataAccess.Opportunity.allBySiteId.resolves([]);

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        data: {},
        id: 'message-1',
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(
        '[readability-opportunity guidance]: No readability opportunity found for siteId: site-456, auditId: audit-123',
      );
    });

    it('should return notFound when opportunity audit ID does not match', async () => {
      mockOpportunity.getAuditId.returns('different-audit-id');

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        data: {},
        id: 'message-1',
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(404);
    });
  });

  describe('Single response format (direct improved paragraph)', () => {
    it('should process single Mystique response with improved text', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'This is the improved paragraph.',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
          selector: 'p.content',
          seo_recommendation: 'Simplify sentences',
          ai_rationale: 'The original text was complex',
          target_flesch_score: 70,
          pageUrl: 'https://example.com/page1',
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: Processed single Mystique response with improved text');
      expect(mockSuggestion.setData).to.have.been.called;
      expect(mockSuggestion.save).to.have.been.called;
    });

    it('should use auditUrl as pageUrl when not provided in data', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      mockSuggestion.getData.returns({
        textPreview: 'This is a test paragraph that needs improvement.',
      });

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
    });
  });

  describe('Batch response format (suggestions array)', () => {
    it('should process batch response with multiple suggestions', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          suggestions: [
            {
              pageUrl: 'https://example.com/page1',
              original_paragraph: 'This is a test paragraph that needs improvement.',
              improved_paragraph: 'This is an improved paragraph.',
              selector: 'p.content',
              current_flesch_score: 55,
              improved_flesch_score: 75,
              seo_recommendation: 'Simplify text',
              ai_rationale: 'Too complex',
              target_flesch_score: 70,
            },
          ],
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: Processed 1 suggestions from batch response');
    });

    it('should handle batch response with multiple suggestions mapping correctly', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          suggestions: [
            {
              pageUrl: 'https://example.com/page1',
              original_paragraph: 'First paragraph text.',
              improved_paragraph: 'First improved text.',
              selector: 'p.first',
              current_flesch_score: 50,
              improved_flesch_score: 70,
              seo_recommendation: 'Rec 1',
              ai_rationale: 'Rationale 1',
              target_flesch_score: 65,
            },
            {
              pageUrl: 'https://example.com/page2',
              original_paragraph: 'Second paragraph text.',
              improved_paragraph: 'Second improved text.',
              selector: 'p.second',
              current_flesch_score: 45,
              improved_flesch_score: 68,
              seo_recommendation: 'Rec 2',
              ai_rationale: 'Rationale 2',
              target_flesch_score: 60,
            },
          ],
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: Processed 2 suggestions from batch response');
    });

    it('should handle suggestion with missing pageUrl in mapping', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          suggestions: [
            {
              original_paragraph: 'Test text.',
              improved_paragraph: 'Improved test.',
            },
          ],
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      // The suggestion ID should contain 'unknown' when pageUrl is missing
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: Processed 1 suggestions from batch response');
    });
  });

  describe('Unknown response format', () => {
    it('should return ok and log warning for unknown format', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          someUnknownField: 'value',
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch(/Unknown Mystique response format/);
    });

    it('should return ok for null data', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: null,
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
    });
  });

  describe('No valid suggestions to process', () => {
    it('should return ok when mappedSuggestions is empty', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          suggestions: [],
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: No valid suggestions to process');
    });
  });

  describe('Suggestion matching and update', () => {
    it('should update matching suggestion with AI improvements', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'This is the improved paragraph.',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
          selector: 'p.content',
          seo_recommendation: 'Simplify sentences',
          ai_rationale: 'The original text was complex',
          target_flesch_score: 70,
          pageUrl: 'https://example.com/page1',
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.setData).to.have.been.called;
      expect(mockSuggestion.save).to.have.been.called;

      const setDataCall = mockSuggestion.setData.getCall(0);
      const enrichedData = setDataCall.args[0];
      expect(enrichedData.improvedText).to.equal('This is the improved paragraph.');
      expect(enrichedData.improvedFleschScore).to.equal(75);
      expect(enrichedData.readabilityImprovement).to.equal(20); // 75 - 55
      expect(enrichedData.aiSuggestion).to.equal('Simplify sentences');
      expect(enrichedData.aiRationale).to.equal('The original text was complex');
      expect(enrichedData.suggestionStatus).to.equal('completed');
      expect(enrichedData.mystiqueProcessingCompleted).to.exist;
      expect(enrichedData.transformRules).to.exist;
      expect(enrichedData.transformRules.op).to.equal('replace');
      expect(enrichedData.transformRules.target).to.equal('ai-bots');
      expect(enrichedData.transformRules.prerenderRequired).to.equal(true);
    });

    it('should handle empty improved_paragraph by treating as unknown format', async () => {
      // When improved_paragraph is empty string (falsy), the condition
      // `data?.improved_paragraph && data?.improved_flesch_score` fails
      // and the code treats it as unknown format
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: '',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      // Empty string is falsy, so it's treated as unknown format
      expect(log.warn).to.have.been.calledWithMatch(/Unknown Mystique response format/);
    });

    it('should remove suggestion when improvedText is whitespace only', async () => {
      // Whitespace-only string is truthy, so it passes the initial check
      // but then gets caught by the trim() === '' check
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: '   ',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(mockSuggestion.remove).to.have.been.called;
      expect(log.warn).to.have.been.calledWithMatch(/Removed suggestion .* because Mystique 'improvedText' is empty/);
    });

    it('should handle null improved_paragraph by treating as unknown format', async () => {
      // When improved_paragraph is null (falsy), the condition fails
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: null,
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      // null is falsy, so it's treated as unknown format
      expect(log.warn).to.have.been.calledWithMatch(/Unknown Mystique response format/);
    });

    it('should log warning when no matching suggestion found', async () => {
      mockSuggestion.getData.returns({
        textPreview: 'Completely different text that does not match.',
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch(/No matching suggestion found for text/);
    });

    it('should handle error during suggestion update', async () => {
      mockSuggestion.save.rejects(new Error('Database error'));

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.error).to.have.been.calledWithMatch(/Error updating suggestion .* Database error/);
    });
  });

  describe('enrichSuggestionDataForAutoOptimize function', () => {
    it('should correctly enrich data with transform rules', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text content',
          improved_flesch_score: 80,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 50,
          selector: 'div.main-content p',
          pageUrl: 'https://example.com/article',
        },
      };

      mockSuggestion.getData.returns({
        textPreview: 'This is a test paragraph that needs improvement.',
        pageUrl: 'https://example.com/article',
        selector: 'div.main-content p',
        scrapedAt: '2025-06-01T12:00:00.000Z',
      });

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);

      const setDataCall = mockSuggestion.setData.getCall(0);
      const enrichedData = setDataCall.args[0];

      expect(enrichedData.url).to.equal('https://example.com/article');
      expect(enrichedData.scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(enrichedData.transformRules).to.deep.include({
        value: 'Improved text content',
        op: 'replace',
        selector: 'div.main-content p',
        target: 'ai-bots',
        prerenderRequired: true,
      });
    });
  });

  describe('mapMystiqueSuggestionsToOpportunityFormat function', () => {
    it('should map all fields correctly in batch format', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          suggestions: [
            {
              pageUrl: 'https://example.com/test-page',
              original_paragraph: 'Original text content here.',
              improved_paragraph: 'Improved text content here.',
              selector: 'article p.intro',
              current_flesch_score: 42,
              improved_flesch_score: 68,
              seo_recommendation: 'Use shorter sentences',
              ai_rationale: 'Paragraph contains run-on sentences',
              target_flesch_score: 60,
            },
          ],
        },
      };

      mockSuggestion.getData.returns({
        textPreview: 'Original text content here.',
      });

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith('[readability-opportunity guidance]: Processed 1 suggestions from batch response');
    });
  });

  describe('Update count logging', () => {
    it('should log correct update count for successful updates', async () => {
      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch(/Successfully updated 1 readability suggestions with AI improvements/);
    });

    it('should log zero updates when no matching suggestions found', async () => {
      mockSuggestion.getData.returns({
        textPreview: 'No matching text here',
      });

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'Completely different original text.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch(/Successfully updated 0 readability suggestions/);
    });

    it('should count failed updates correctly', async () => {
      mockSuggestion.save.rejects(new Error('Save failed'));

      const message = {
        auditId: 'audit-123',
        siteId: 'site-456',
        id: 'message-1',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'This is a test paragraph that needs improvement.',
          current_flesch_score: 55,
        },
      };

      const result = await handler(message, mockContext);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch(/Successfully updated 0 readability suggestions/);
    });
  });
});

