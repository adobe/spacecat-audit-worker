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
import sinon from 'sinon';
import esmock from 'esmock';

use(sinonChai);

describe('Guidance Readability Handler Tests', () => {
  let guidanceHandler;
  let mockDataAccess;
  let mockSite;
  let mockAsyncJob;
  let mockOpportunity;
  let mockSuggestion;
  let mockAddReadabilitySuggestions;
  let log;
  let context;

  beforeEach(async () => {
    // Setup mocks
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSite = {
      getId: () => 'test-site-id',
      getBaseURL: () => 'https://test-site.com',
    };

    mockAsyncJob = {
      getId: () => 'test-job-id',
      getStatus: () => 'running',
      getResult: sinon.stub(),
      setResult: sinon.stub(),
      setStatus: sinon.stub(),
      setEndedAt: sinon.stub(),
      save: sinon.stub(),
    };

    mockOpportunity = {
      getId: () => 'test-opportunity-id',
      getAuditId: () => 'test-job-id',
      getData: sinon.stub(),
      setAuditId: sinon.stub(),
      setData: sinon.stub(),
      setUpdatedBy: sinon.stub(),
      save: sinon.stub(),
      getSuggestions: sinon.stub(),
    };

    mockSuggestion = {
      getData: sinon.stub(),
    };

    mockDataAccess = {
      Site: {
        findById: sinon.stub(),
      },
      AsyncJob: {
        findById: sinon.stub(),
      },
      Opportunity: {
        allBySiteId: sinon.stub(),
      },
    };

    context = {
      log,
      dataAccess: mockDataAccess,
    };

    // Mock the addReadabilitySuggestions function
    mockAddReadabilitySuggestions = sinon.stub();

    // Mock the module
    guidanceHandler = await esmock(
      '../../../src/readability/guidance-readability-handler.js',
      {},
      {
        '../../../src/readability/opportunity-handler.js': {
          addReadabilitySuggestions: mockAddReadabilitySuggestions,
        },
      },
    );

    guidanceHandler = guidanceHandler.default;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Handler function', () => {
    const baseMessage = {
      auditId: 'test-job-id',
      siteId: 'test-site-id',
      id: 'message-123',
      data: {},
    };

    it('should return 404 when site is not found', async () => {
      mockDataAccess.Site.findById.resolves(null);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(404);
      expect(result.body).to.contain('Site not found');
      expect(log.error).to.have.been.calledWithMatch('Site not found for siteId: test-site-id');
    });

    it('should return 404 when AsyncJob is not found', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(null);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(404);
      expect(result.body).to.contain('AsyncJob not found');
      expect(log.error).to.have.been.calledWithMatch('AsyncJob not found for auditId: test-job-id');
    });

    it('should throw error when opportunity fetch fails', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);
      mockDataAccess.Opportunity.allBySiteId.rejects(new Error('Database error'));

      await expect(guidanceHandler(baseMessage, context))
        .to.be.rejectedWith('Failed to fetch opportunities for siteId test-site-id: Database error');

      expect(log.error).to.have.been.calledWithMatch('Fetching opportunities for siteId test-site-id failed');
    });

    it('should throw error when no readability opportunity exists', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);
      mockDataAccess.Opportunity.allBySiteId.resolves([]);

      await expect(guidanceHandler(baseMessage, context))
        .to.be.rejectedWith('No existing opportunity found for siteId test-site-id');

      expect(log.error).to.have.been.calledWithMatch('No existing opportunity found for siteId test-site-id');
    });

    it('should skip processing if suggestion already processed', async () => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: ['message-123'],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('Suggestions with id message-123 already processed');
      expect(mockAddReadabilitySuggestions).not.to.have.been.called;
    });

    it('should process direct improved paragraph data format', async () => {
      const messageWithDirectData = {
        ...baseMessage,
        data: {
          improved_paragraph: 'Improved text here',
          improved_flesch_score: 75,
          original_paragraph: 'Original complex text',
          current_flesch_score: 25,
          pageUrl: 'https://test-site.com/page1',
          seo_recommendation: 'Use simpler words',
          ai_rationale: 'Text was too complex',
          target_flesch_score: 70,
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 1,
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      const result = await guidanceHandler(messageWithDirectData, context);

      expect(result.statusCode).to.equal(200);
      expect(mockOpportunity.setData).to.have.been.calledOnce;
      expect(mockOpportunity.save).to.have.been.calledOnce;
      expect(mockAddReadabilitySuggestions).to.have.been.calledOnce;

      // Verify the mapped suggestion structure
      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      expect(addSuggestionsCall.newSuggestionDTOs).to.have.lengthOf(1);
      expect(addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0]).to.deep.include({
        id: 'readability-test-job-id-message-123',
        pageUrl: 'https://test-site.com/page1',
        originalText: 'Original complex text',
        improvedText: 'Improved text here',
        originalFleschScore: 25,
        improvedFleschScore: 75,
        seoRecommendation: 'Use simpler words',
        aiRationale: 'Text was too complex',
        targetFleschScore: 70,
      });
    });

    it('should process suggestions array format', async () => {
      const messageWithSuggestions = {
        ...baseMessage,
        data: {
          suggestions: [
            {
              pageUrl: 'https://test-site.com/page1',
              original_paragraph: 'First complex text',
              improved_paragraph: 'First improved text',
              current_flesch_score: 20,
              improved_flesch_score: 80,
              seo_recommendation: 'Simplify',
              ai_rationale: 'Too complex',
              target_flesch_score: 70,
            },
            {
              pageUrl: 'https://test-site.com/page2',
              original_paragraph: 'Second complex text',
              improved_paragraph: 'Second improved text',
              current_flesch_score: 15,
              improved_flesch_score: 85,
              seo_recommendation: 'Use shorter sentences',
              ai_rationale: 'Sentences too long',
              target_flesch_score: 70,
            },
          ],
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 1,
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      const result = await guidanceHandler(messageWithSuggestions, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAddReadabilitySuggestions).to.have.been.calledOnce;

      // Verify mapped suggestions
      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      expect(addSuggestionsCall.newSuggestionDTOs).to.have.lengthOf(2);
      expect(addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0]).to.deep.include({
        pageUrl: 'https://test-site.com/page1',
        originalText: 'First complex text',
        improvedText: 'First improved text',
      });
      expect(addSuggestionsCall.newSuggestionDTOs[1].data.recommendations[0]).to.deep.include({
        pageUrl: 'https://test-site.com/page2',
        originalText: 'Second complex text',
        improvedText: 'Second improved text',
      });
    });

    it('should process guidance array format', async () => {
      const messageWithGuidance = {
        ...baseMessage,
        data: {
          guidance: [
            {
              pageUrl: 'https://test-site.com/page1',
              original_paragraph: 'Guidance text',
              improved_paragraph: 'Improved guidance text',
              current_flesch_score: 30,
              improved_flesch_score: 70,
              seo_recommendation: 'Improve readability',
              ai_rationale: 'Text needs improvement',
              target_flesch_score: 65,
            },
          ],
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 1,
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      const result = await guidanceHandler(messageWithGuidance, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAddReadabilitySuggestions).to.have.been.calledOnce;

      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      expect(addSuggestionsCall.newSuggestionDTOs).to.have.lengthOf(1);
      expect(addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0]).to.deep.include({
        originalText: 'Guidance text',
        improvedText: 'Improved guidance text',
      });
    });

    it('should return ok when no valid suggestions found', async () => {
      const messageWithNoSuggestions = {
        ...baseMessage,
        data: {
          // No valid suggestion format
          someOtherData: 'value',
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);

      const result = await guidanceHandler(messageWithNoSuggestions, context);

      expect(result.statusCode).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('No valid readability improvements found');
      expect(mockAddReadabilitySuggestions).not.to.have.been.called;
    });

    it('should handle opportunity update errors', async () => {
      const messageWithDirectData = {
        ...baseMessage,
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'Original text',
          current_flesch_score: 25,
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockOpportunity.save.rejects(new Error('Save failed'));

      await expect(guidanceHandler(messageWithDirectData, context))
        .to.be.rejectedWith('Failed to update opportunity for siteId test-site-id: Save failed');

      expect(log.error).to.have.been.calledWithMatch('Updating opportunity for siteId test-site-id failed');
    });

    it('should handle opportunity with null getData()', async () => {
      const messageWithDirectData = {
        ...baseMessage,
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'Original text',
          current_flesch_score: 25,
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns(null); // Trigger || {} fallback
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      const result = await guidanceHandler(messageWithDirectData, context);

      expect(result.statusCode).to.equal(200);

      // Verify opportunity data was set with default values
      const updatedData = mockOpportunity.setData.firstCall.args[0];
      expect(updatedData).to.include({
        mystiqueResponsesReceived: 1, // 0 + 1
        mystiqueResponsesExpected: 0, // Default from || 0
        totalReadabilityIssues: 1,
      });
      expect(updatedData.processedSuggestionIds).to.include('message-123');
    });
  });

  describe('mapMystiqueSuggestionsToOpportunityFormat function', () => {
    it('should correctly map Mystique suggestions to opportunity format', async () => {
      const messageWithSuggestions = {
        auditId: 'test-job-id',
        siteId: 'test-site-id',
        id: 'message-123',
        data: {
          suggestions: [
            {
              pageUrl: 'https://test-site.com/page1',
              original_paragraph: 'Complex text here',
              improved_paragraph: 'Simple text here',
              current_flesch_score: 25,
              improved_flesch_score: 75,
              seo_recommendation: 'Use shorter sentences',
              ai_rationale: 'Original text was too complex',
              target_flesch_score: 70,
            },
          ],
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      await guidanceHandler(messageWithSuggestions, context);

      expect(mockAddReadabilitySuggestions).to.have.been.calledOnce;
      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      const mappedSuggestion = addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0];

      // Verify mapping creates correct ID
      expect(mappedSuggestion.id).to.equal('readability-https://test-site.com/page1-0');
      expect(mappedSuggestion.pageUrl).to.equal('https://test-site.com/page1');
      expect(mappedSuggestion.originalText).to.equal('Complex text here');
      expect(mappedSuggestion.improvedText).to.equal('Simple text here');
      expect(mappedSuggestion.originalFleschScore).to.equal(25);
      expect(mappedSuggestion.improvedFleschScore).to.equal(75);
      expect(mappedSuggestion.seoRecommendation).to.equal('Use shorter sentences');
      expect(mappedSuggestion.aiRationale).to.equal('Original text was too complex');
      expect(mappedSuggestion.targetFleschScore).to.equal(70);
    });

    it('should handle suggestions with missing pageUrl', async () => {
      const messageWithSuggestions = {
        auditId: 'test-job-id',
        siteId: 'test-site-id',
        id: 'message-123',
        data: {
          suggestions: [
            {
              // No pageUrl provided
              original_paragraph: 'Text without URL',
              improved_paragraph: 'Improved text without URL',
              current_flesch_score: 30,
              improved_flesch_score: 80,
            },
          ],
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      await guidanceHandler(messageWithSuggestions, context);

      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      const mappedSuggestion = addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0];

      // Should use 'unknown' when pageUrl is missing
      expect(mappedSuggestion.id).to.equal('readability-unknown-0');
      expect(mappedSuggestion.pageUrl).to.be.undefined;
    });

    it('should handle multiple suggestions with correct indexing', async () => {
      const messageWithMultipleSuggestions = {
        auditId: 'test-job-id',
        siteId: 'test-site-id',
        id: 'message-123',
        data: {
          suggestions: [
            { pageUrl: 'https://test-site.com/page1', original_paragraph: 'Text 1' },
            { pageUrl: 'https://test-site.com/page2', original_paragraph: 'Text 2' },
            { pageUrl: 'https://test-site.com/page3', original_paragraph: 'Text 3' },
          ],
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      await guidanceHandler(messageWithMultipleSuggestions, context);

      const addSuggestionsCall = mockAddReadabilitySuggestions.firstCall.args[0];
      expect(addSuggestionsCall.newSuggestionDTOs).to.have.lengthOf(3);

      // Verify correct indexing in IDs
      expect(addSuggestionsCall.newSuggestionDTOs[0].data.recommendations[0].id)
        .to.equal('readability-https://test-site.com/page1-0');
      expect(addSuggestionsCall.newSuggestionDTOs[1].data.recommendations[0].id)
        .to.equal('readability-https://test-site.com/page2-1');
      expect(addSuggestionsCall.newSuggestionDTOs[2].data.recommendations[0].id)
        .to.equal('readability-https://test-site.com/page3-2');
    });
  });

  describe('AsyncJob completion logic', () => {
    const baseMessage = {
      auditId: 'test-job-id',
      siteId: 'test-site-id',
      id: 'message-123',
      data: {
        improved_paragraph: 'Improved text',
        improved_flesch_score: 75,
        original_paragraph: 'Original text',
        current_flesch_score: 25,
      },
    };

    beforeEach(() => {
      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();
    });

    it('should complete AsyncJob when all Mystique responses received', async () => {
      // Setup: This is the final response (2/2)
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1, // Will become 2 after increment
        mystiqueResponsesExpected: 2,
      });

      // Mock AsyncJob result with readability audit
      const mockJobResult = [
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  check: 'poor-readability',
                  textContent: 'Original text',
                  fleschReadingEase: 25,
                },
              ],
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      // Mock suggestion data
      mockSuggestion.getData.returns({
        recommendations: [
          {
            originalText: 'Original text',
            improvedText: 'Improved text',
            originalFleschScore: 25,
            improvedFleschScore: 75,
            aiRationale: 'Much better readability',
          },
        ],
      });
      mockOpportunity.getSuggestions.resolves([mockSuggestion]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('All 2 Mystique responses received');
      expect(mockAsyncJob.setStatus).to.have.been.calledWith('completed');
      expect(mockAsyncJob.setEndedAt).to.have.been.called;
      expect(mockAsyncJob.setResult).to.have.been.called;
      expect(mockAsyncJob.save).to.have.been.called;

      // Verify the opportunity was updated with suggestion data
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const readabilityAudit = updatedResult[0].audits.find((audit) => audit.name === 'readability');
      expect(readabilityAudit.opportunities[0]).to.include({
        suggestionStatus: 'completed',
        improvedFleschScore: 75,
        aiSuggestion: 'Improved text',
        aiRationale: 'Much better readability',
      });
    });

    it('should handle AsyncJob with empty opportunities (reconstruction scenario)', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1, // Will become 2 after increment
        mystiqueResponsesExpected: 2,
      });

      // Mock AsyncJob result with empty opportunities (cleared during async processing)
      const mockJobResult = [
        {
          audits: [
            {
              name: 'readability',
              opportunities: [], // Empty - needs reconstruction
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      // Mock suggestion data for reconstruction
      mockSuggestion.getData.returns({
        recommendations: [
          {
            originalText: 'Original text from suggestion',
            improvedText: 'Improved text from suggestion',
            originalFleschScore: 30,
            improvedFleschScore: 80,
            aiRationale: 'Reconstructed rationale',
          },
        ],
      });
      mockOpportunity.getSuggestions.resolves([mockSuggestion]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('Reconstructing opportunities from 1 stored suggestions');
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Verify opportunities were reconstructed from suggestions
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const readabilityAudit = updatedResult[0].audits.find((audit) => audit.name === 'readability');
      expect(readabilityAudit.opportunities).to.have.lengthOf(1);
      expect(readabilityAudit.opportunities[0]).to.include({
        check: 'poor-readability',
        textContent: 'Original text from suggestion',
        fleschReadingEase: 30,
        suggestionStatus: 'completed',
      });
    });

    it('should handle suggestions with no recommendations', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      const mockJobResult = [
        {
          audits: [
            {
              name: 'readability',
              opportunities: [],
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      // Mock suggestion with no recommendations
      mockSuggestion.getData.returns({
        someOtherData: 'value',
        // No recommendations array
      });
      mockOpportunity.getSuggestions.resolves([mockSuggestion]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('No recommendation found in suggestion 0');
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Verify no opportunities were reconstructed
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const readabilityAudit = updatedResult[0].audits.find((audit) => audit.name === 'readability');
      expect(readabilityAudit.opportunities).to.have.lengthOf(0);
    });

    it('should handle AsyncJob update errors gracefully', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      mockAsyncJob.save.rejects(new Error('AsyncJob save failed'));

      const result = await guidanceHandler(baseMessage, context);

      // Should still return success - AsyncJob errors don't fail the whole process
      expect(result.statusCode).to.equal(200);
      expect(log.error).to.have.been.calledWithMatch('Error updating AsyncJob test-job-id');
      expect(log.info).to.have.been.calledWithMatch('Successfully processed Mystique guidance');
    });

    it('should not complete AsyncJob when not all responses received', async () => {
      // Only 1 out of 3 responses received
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 0, // Will become 1 after increment
        mystiqueResponsesExpected: 3,
      });

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setStatus).not.to.have.been.called;
      expect(log.info).not.to.have.been.calledWithMatch('All 3 Mystique responses received');
    });

    it('should not complete AsyncJob when no responses expected', async () => {
      // Edge case: 0 responses expected
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 0,
        mystiqueResponsesExpected: 0,
      });

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setStatus).not.to.have.been.called;
    });

    it('should handle missing AsyncJob in completion logic', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      // Reset the AsyncJob mock to null to test the guard clause
      mockDataAccess.AsyncJob.findById.resolves(null);

      const result = await guidanceHandler(baseMessage, context);

      // Should return 404 for missing AsyncJob
      expect(result.statusCode).to.equal(404);
      expect(result.body).to.contain('AsyncJob not found');
    });

    it('should handle no matching suggestions during AsyncJob completion', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      const mockJobResult = [
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  check: 'poor-readability',
                  textContent: 'Different text that will not match',
                  fleschReadingEase: 25,
                },
              ],
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      // Mock suggestion with different text
      mockSuggestion.getData.returns({
        recommendations: [
          {
            originalText: 'Completely different text',
            improvedText: 'Improved different text',
            originalFleschScore: 30,
            improvedFleschScore: 80,
          },
        ],
      });
      mockOpportunity.getSuggestions.resolves([mockSuggestion]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(log.warn).to.have.been.calledWithMatch('No matching suggestion found for opportunity');
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Verify opportunity remained unchanged (no suggestion applied)
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const readabilityAudit = updatedResult[0].audits.find((audit) => audit.name === 'readability');
      expect(readabilityAudit.opportunities[0]).to.not.have.property('suggestionStatus');
    });

    it('should handle AsyncJob with no audits array', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      // Mock AsyncJob result with no audits
      const mockJobResult = [
        {
          // No audits array
          someOtherProperty: 'value',
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Should pass through unchanged
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      expect(updatedResult[0]).to.deep.equal({
        someOtherProperty: 'value',
      });
    });

    it('should handle AsyncJob with null result', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      // Mock AsyncJob with null result (triggers || [] fallback)
      mockAsyncJob.getResult.returns(null);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Should set empty array
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      expect(updatedResult).to.deep.equal([]);
    });

    it('should handle suggestion with no recommendation data', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      const mockJobResult = [
        {
          audits: [
            {
              name: 'readability',
              opportunities: [
                {
                  check: 'poor-readability',
                  textContent: 'Some text',
                  fleschReadingEase: 25,
                },
              ],
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      // Mock suggestion with no recommendations property (triggers return false at line 249)
      mockSuggestion.getData.returns({
        someOtherData: 'value',
        // No recommendations property
      });
      mockOpportunity.getSuggestions.resolves([mockSuggestion]);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Verify no matching suggestion was found (because return false was triggered)
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const readabilityAudit = updatedResult[0].audits.find((audit) => audit.name === 'readability');
      expect(readabilityAudit.opportunities[0]).to.not.have.property('suggestionStatus');
    });

    it('should handle non-readability audit items during completion', async () => {
      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
        mystiqueResponsesReceived: 1,
        mystiqueResponsesExpected: 2,
      });

      // Mock AsyncJob with non-readability audit (triggers return auditItem at line 284)
      const mockJobResult = [
        {
          audits: [
            {
              name: 'canonical', // Not 'readability'
              opportunities: [
                {
                  check: 'missing-canonical',
                  issue: 'No canonical tag found',
                },
              ],
            },
          ],
        },
      ];
      mockAsyncJob.getResult.returns(mockJobResult);

      const result = await guidanceHandler(baseMessage, context);

      expect(result.statusCode).to.equal(200);
      expect(mockAsyncJob.setResult).to.have.been.called;

      // Verify non-readability audit passed through unchanged
      const updatedResult = mockAsyncJob.setResult.firstCall.args[0];
      const canonicalAudit = updatedResult[0].audits.find((audit) => audit.name === 'canonical');
      expect(canonicalAudit).to.deep.equal({
        name: 'canonical',
        opportunities: [
          {
            check: 'missing-canonical',
            issue: 'No canonical tag found',
          },
        ],
      });
    });
  });

  describe('Edge cases and unreachable code', () => {
    it('should handle edge case for unreachable else branch (lines 167-168)', async () => {
      // Note: Lines 167-168 appear to be unreachable due to early return at line 125
      // when mappedSuggestions.length === 0. This test documents the potential dead code.

      const messageWithDirectData = {
        auditId: 'test-job-id',
        siteId: 'test-site-id',
        id: 'message-123',
        data: {
          improved_paragraph: 'Improved text',
          improved_flesch_score: 75,
          original_paragraph: 'Original text',
          current_flesch_score: 25,
        },
      };

      mockDataAccess.Site.findById.resolves(mockSite);
      mockDataAccess.AsyncJob.findById.resolves(mockAsyncJob);

      mockOpportunity.getData.returns({
        subType: 'readability',
        processedSuggestionIds: [],
      });
      mockDataAccess.Opportunity.allBySiteId.resolves([mockOpportunity]);
      mockAddReadabilitySuggestions.resolves();

      const result = await guidanceHandler(messageWithDirectData, context);

      expect(result.statusCode).to.equal(200);
      expect(log.info).to.have.been.calledWithMatch('Successfully processed 1 suggestions from Mystique');

      // Lines 167-168 would only be reachable if mappedSuggestions.length becomes 0
      // after being > 0, which seems impossible in the current code structure
    });
  });
});
