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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';

use(sinonChai);

describe('Prerender Guidance Handler (Presigned URL)', () => {
  let context;
  let log;
  let Site;
  let Opportunity;
  let Suggestion;
  let mockSite;
  let mockOpportunity;
  let mockSuggestions;
  let fetchStub;
  let handler;
  let mockIsPaidLLMOCustomer;
  let mockPostMessageOptional;
  let mockS3Client;
  let mockSqs;

  // Helper to mock successful fetch response (resolves the parsed JSON directly).
  const mockFetchSuccess = (data) => {
    fetchStub.resolves(data);
  };

  // Helper to mock failed fetch response (mirrors fetchAnalysisFromPresignedUrl's
  // rejection shape on non-ok response).
  const mockFetchFailure = (statusCode = 500, statusText = 'Internal Server Error') => {
    fetchStub.rejects(new Error(`Prerender - analysis fetch failed: ${statusCode} ${statusText}`));
  };

  beforeEach(async () => {
    log = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    mockSite = {
      getId: sinon.stub().returns('site-123'),
      getBaseURL: sinon.stub().returns('https://example.com'),
      getDeliveryType: sinon.stub().returns('aem_edge'),
    };

    mockSuggestions = [
      {
        getId: sinon.stub().returns('suggestion-1'),
        getData: sinon.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
        }),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
      },
      {
        getId: sinon.stub().returns('suggestion-2'),
        getData: sinon.stub().returns({
          url: 'https://example.com/page2',
          isDomainWide: false,
        }),
        getStatus: sinon.stub().returns('PENDING_VALIDATION'),
        setData: sinon.stub(),
      },
      {
        getId: sinon.stub().returns('suggestion-3'),
        getData: sinon.stub().returns({
          url: 'https://example.com/page3',
          isDomainWide: false,
        }),
        getStatus: sinon.stub().returns('OUTDATED'),
        setData: sinon.stub(),
      },
    ];

    mockOpportunity = {
      getId: sinon.stub().returns('opportunity-123'),
      getSiteId: sinon.stub().returns('site-123'),
      getSuggestions: sinon.stub().resolves(mockSuggestions),
      getType: () => 'prerender',
      getData: sinon.stub().returns({}), // no mystiqueSession by default
      setData: sinon.stub(),
      save: sinon.stub().resolves(),
    };

    Site = {
      findById: sinon.stub().resolves(mockSite),
    };

    Opportunity = {
      findById: sinon.stub().resolves(mockOpportunity),
    };

    Suggestion = {
      saveMany: sinon.stub().resolves(),
      STATUSES: {
        NEW: 'NEW',
        PENDING_VALIDATION: 'PENDING_VALIDATION',
        APPROVED: 'APPROVED',
        SKIPPED: 'SKIPPED',
        FIXED: 'FIXED',
        IN_PROGRESS: 'IN_PROGRESS',
        OUTDATED: 'OUTDATED',
        ERROR: 'ERROR',
      },
    };

    mockS3Client = { send: sinon.stub().resolves() };
    mockSqs = { sendMessage: sinon.stub().resolves() };

    // Stub the shared analysis-fetch helper directly (no need to fake a Response).
    fetchStub = sinon.stub();

    // Mock isPaidLLMOCustomer utility
    mockIsPaidLLMOCustomer = sinon.stub().resolves(true);
    mockPostMessageOptional = sinon.stub().resolves({ success: true });

    // Import handler with mocked helpers
    handler = await esmock('../../../src/prerender/guidance-handler.js', {
      '../../../src/prerender/utils/utils.js': {
        isPaidLLMOCustomer: mockIsPaidLLMOCustomer,
      },
      '../../../src/utils/analysis-fetch.js': {
        fetchAnalysisFromPresignedUrl: fetchStub,
      },
      '../../../src/utils/slack-utils.js': {
        postMessageOptional: mockPostMessageOptional,
      },
    });

    context = {
      log,
      site: mockSite,
      s3Client: mockS3Client,
      sqs: mockSqs,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.us-east-1.amazonaws.com/test-mystique-queue',
      },
      dataAccess: {
        Site,
        Opportunity,
        Suggestion,
      },
    };
  });

  afterEach(() => {
    sinon.restore(); // Automatically restores global.fetch
  });

  describe('Successful AI Summary Update (Presigned URL)', () => {
    it('should successfully download from presigned URL and update suggestions with AI summaries', async () => {
      // Mock presigned URL response data
      const s3Data = {
        opportunityId: 'opportunity-123',
        siteId: 'site-123',
        auditId: 'audit-123',
        timestamp: '2025-01-15T12:00:00Z',
        suggestions: [
          {
            suggestionId: 'suggestion-1',
            url: 'https://example.com/page1',
            aiSummary: 'AI generated summary for page 1',
            valuable: true,
          },
          {
            suggestionId: 'suggestion-2',
            url: 'https://example.com/page2',
            aiSummary: 'AI generated summary for page 2',
            valuable: false,
          },
        ],
      };

      // Mock fetch response
      mockFetchSuccess(s3Data);

      const presignedUrl = 'https://s3.amazonaws.com/spacecat-dev-mystique-assets/prerender-results/site-123/opportunity-123/ai_summaries.json?X-Amz-Signature=...';
      
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl,
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result).to.exist;
      expect(result.status).to.equal(200);

      // Verify fetch helper was called with presigned URL (and options object).
      expect(fetchStub).to.have.been.calledWith(presignedUrl, sinon.match.object);

      expect(Site.findById).to.have.been.calledWith('site-123');
      expect(Opportunity.findById).to.have.been.calledWith('opportunity-123');
      expect(mockOpportunity.getSuggestions).to.have.been.called;

      // Should update only non-OUTDATED suggestions (2 out of 3)
      expect(mockSuggestions[0].setData).to.have.been.called;
      expect(mockSuggestions[1].setData).to.have.been.called;
      expect(mockSuggestions[2].setData).to.not.have.been.called; // OUTDATED, skipped

      // Verify batch save was called
      expect(Suggestion.saveMany).to.have.been.called;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2); // Only 2 non-OUTDATED suggestions
    });

    it('should handle valuable flag correctly (defaults to true if not provided)', async () => {
      const s3Data = {
        opportunityId: 'opportunity-123',
        siteId: 'site-123',
        auditId: 'audit-123',
        timestamp: '2025-01-15T12:00:00Z',
        suggestions: [
          {
            suggestionId: 'suggestion-1',
            url: 'https://example.com/page1',
            aiSummary: 'Summary without valuable flag',
            // valuable: undefined (not provided)
          },
        ],
      };

      mockFetchSuccess(s3Data);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.called;
      const updatedData = mockSuggestions[0].setData.getCall(0).args[0];
      expect(updatedData.valuable).to.equal(true); // Default to true
    });

    it('should respect explicit false for valuable flag', async () => {
      const s3Data = {
        opportunityId: 'opportunity-123',
        siteId: 'site-123',
        auditId: 'audit-123',
        timestamp: '2025-01-15T12:00:00Z',
        suggestions: [
          {
            suggestionId: 'suggestion-1',
            url: 'https://example.com/page1',
            aiSummary: 'Not valuable content',
            valuable: false,
          },
        ],
      };

      mockFetchSuccess(s3Data);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.called;
      const updatedData = mockSuggestions[0].setData.getCall(0).args[0];
      expect(updatedData.valuable).to.equal(false);
    });
  });

  describe('Error Handling (Presigned URL)', () => {
    it('should return 400 if data is missing', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        // data field is missing
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(sinon.match(/Missing data in Mystique response/));
    });

    it('should return 400 if presignedUrl is missing', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          // presignedUrl is missing
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Missing presignedUrl/),
      );
    });

    it('should return 400 if presigned URL returns non-OK HTTP status', async () => {
      // Simulate HTTP 404 response
      mockFetchFailure(404, 'Not Found');

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      // The new fetch helper throws `analysis fetch failed: 404 Not Found`; that
      // bubbles into the outer catch which logs the opportunityId-tagged message.
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error processing guidance for opportunityId=opportunity-123/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should return 400 if fetch throws an error (network failure)', async () => {
      // Simulate network error
      fetchStub.rejects(new Error('Network request failed'));

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      // Should log the catch block error with opportunityId
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error processing guidance for opportunityId=opportunity-123/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should return 400 if downloaded data has no suggestions array', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        // suggestions array is missing
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      // Should log the validation error from downloadFromPresignedUrl
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Downloaded data is missing required suggestions array/),
      );
      // Should also log the catch block error with opportunityId
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error processing guidance for opportunityId=opportunity-123/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should return 404 if site not found', async () => {
      Site.findById.resolves(null);
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [],
      });

      const message = {
        siteId: 'non-existent-site',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(sinon.match(/Site not found/));
    });

    it('should return 400 if opportunityId is missing', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          // opportunityId is missing - testing validation
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(sinon.match(/Missing opportunityId in Mystique response/));
    });

    it('should return 404 if opportunity not found', async () => {
      Opportunity.findById.resolves(null);
      mockFetchSuccess({
        opportunityId: 'non-existent-opportunity',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Some summary', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'non-existent-opportunity',
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(404);
      expect(log.error).to.have.been.calledWith(sinon.match(/Opportunity not found for opportunityId=/));
    });

    it('should return OK if no existing suggestions found', async () => {
      mockOpportunity.getSuggestions.resolves([]);
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Some summary', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(log.debug).to.have.been.calledWith(sinon.match(/No existing suggestions found/));
    });

    it('should handle batch save errors gracefully', async () => {
      Suggestion.saveMany.rejects(new Error('DynamoDB batch write failed'));
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Summary', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error batch saving suggestions|Error processing guidance/),
      );
    });

    it('should handle presigned URL download exceptions', async () => {
      fetchStub.rejects(new Error('S3 access denied'));

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(400);
      // Should log the catch block error with opportunityId
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Error processing guidance for opportunityId=opportunity-123/),
        sinon.match.instanceOf(Error),
      );
    });
  });

  describe('Suggestion Filtering (Presigned URL)', () => {
    it('should skip OUTDATED suggestions', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page3', // OUTDATED
            aiSummary: 'This should not be updated',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // OUTDATED suggestion should be filtered out
      expect(Suggestion.saveMany).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(sinon.match(/No valid suggestions to update/));
    });

    it('should return OK if all suggestions are OUTDATED', async () => {
      const allOutdatedSuggestions = [
        {
          getId: sinon.stub().returns('suggestion-1'),
          getData: sinon.stub().returns({
            url: 'https://example.com/page1',
            isDomainWide: false,
          }),
          getStatus: sinon.stub().returns('OUTDATED'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('suggestion-2'),
          getData: sinon.stub().returns({
            url: 'https://example.com/page2',
            isDomainWide: false,
          }),
          getStatus: sinon.stub().returns('OUTDATED'),
          setData: sinon.stub(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(allOutdatedSuggestions);
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Summary 1', valuable: true },
          { url: 'https://example.com/page2', aiSummary: 'Summary 2', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      const result = await handler.default(message, context);

      expect(result.status).to.equal(200);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/No updateable suggestions found \(all are OUTDATED\)/),
      );
      expect(Suggestion.saveMany).to.not.have.been.called;
    });

    it('should update suggestions with various statuses except OUTDATED', async () => {
      const allStatusSuggestions = [
        {
          getId: sinon.stub().returns('s1'),
          getData: sinon.stub().returns({ url: 'https://example.com/new' }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('s2'),
          getData: sinon.stub().returns({ url: 'https://example.com/pending' }),
          getStatus: sinon.stub().returns('PENDING_VALIDATION'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('s3'),
          getData: sinon.stub().returns({ url: 'https://example.com/approved' }),
          getStatus: sinon.stub().returns('APPROVED'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('s4'),
          getData: sinon.stub().returns({ url: 'https://example.com/outdated' }),
          getStatus: sinon.stub().returns('OUTDATED'),
          setData: sinon.stub(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(allStatusSuggestions);
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/new', aiSummary: 'Summary 1', valuable: true },
          { url: 'https://example.com/pending', aiSummary: 'Summary 2', valuable: true },
          { url: 'https://example.com/approved', aiSummary: 'Summary 3', valuable: true },
          { url: 'https://example.com/outdated', aiSummary: 'Should not update', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // First 3 should be updated (NEW, PENDING_VALIDATION, APPROVED)
      expect(allStatusSuggestions[0].setData).to.have.been.called;
      expect(allStatusSuggestions[1].setData).to.have.been.called;
      expect(allStatusSuggestions[2].setData).to.have.been.called;
      // OUTDATED should NOT be updated
      expect(allStatusSuggestions[3].setData).to.not.have.been.called;

      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(3);
    });

    it('should skip suggestions without URL', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            // url: missing
            aiSummary: 'Summary without URL',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(log.warn).to.have.been.calledWith(sinon.match(/Skipping Mystique suggestion without URL/));
      expect(Suggestion.saveMany).to.not.have.been.called;
    });

    it('should handle null elements in suggestions array gracefully', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Valid summary', valuable: true },
          null,  // Malformed element - tests the || {} defensive code
          { url: 'https://example.com/page2', aiSummary: 'Another valid', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Should handle gracefully and skip the null element
      expect(log.warn).to.have.been.calledWith(
        sinon.match(/Skipping Mystique suggestion without URL/),
      );
      // Should still update the valid suggestions
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2);
    });

    it('should handle null/undefined aiSummary by defaulting to empty string', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: null, valuable: true },
          { url: 'https://example.com/page2', valuable: false },  // aiSummary undefined
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Should update suggestions with empty string for aiSummary
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2);
      
      // Verify aiSummary is set to empty string
      expect(savedSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
      );
      expect(savedSuggestions[1].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
      );
    });

    it('should preserve existing valuable flag when aiSummary is invalid', async () => {
      // Suggestion already has valuable=false and a valid aiSummary from a previous run
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        aiSummary: 'Previous valid summary',
        valuable: false,
      });

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: null, // Invalid — should preserve existing
            valuable: true, // New value — should NOT overwrite
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({
          aiSummary: 'Previous valid summary', // Preserved
          valuable: false, // Preserved (not overwritten with true)
        }),
      );
    });

    it('should treat "Not available" aiSummary as empty string (case-insensitive)', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Not available', valuable: true },
          { url: 'https://example.com/page2', aiSummary: 'NOT AVAILABLE', valuable: true },
          { url: 'https://example.com/page3', aiSummary: 'not available', valuable: false },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Should treat "Not available" as empty string for better UX (case-insensitive)
      // Note: page3 is OUTDATED so will be skipped, only 2 suggestions will be saved
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2);
      
      // Verify all variations are converted to empty string
      expect(savedSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
      );
      expect(savedSuggestions[1].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
      );
    });

    it('should default valuable to true when field is missing and track paid customer status', async () => {
      // Test with missing 'valuable' field - should default to true
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Valid summary without valuable field' },
          { url: 'https://example.com/page2', aiSummary: 'Another summary', valuable: false },
        ],
      });

      mockIsPaidLLMOCustomer.resolves(true);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Verify isPaidLLMOCustomer was called
      expect(mockIsPaidLLMOCustomer).to.have.been.calledOnce;

      // Both suggestions should be saved
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion.saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2);
      
      // First suggestion should have valuable=true (defaulted)
      expect(savedSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ 
          aiSummary: 'Valid summary without valuable field',
          valuable: true,
        }),
      );
      
      // Second suggestion should have valuable=false (explicit)
      expect(savedSuggestions[1].setData).to.have.been.calledWith(
        sinon.match({ 
          aiSummary: 'Another summary',
          valuable: false,
        }),
      );

      // Verify log includes paid customer flag and correct counts
      expect(log.info).to.have.been.calledWith(
        sinon.match(/prerender_ai_summary_metrics/)
          .and(sinon.match(/isPaidLLMOCustomer=true/))
          .and(sinon.match(/totalSuggestions=2/))
          .and(sinon.match(/valuableSuggestions=1/))
          .and(sinon.match(/validAiSummaryCount=2/)),
      );
    });

    it('should track quality metrics correctly for non-paid customers', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Good summary', valuable: true },
          { url: 'https://example.com/page2', aiSummary: 'Not available', valuable: true },
        ],
      });

      mockIsPaidLLMOCustomer.resolves(false);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Verify isPaidLLMOCustomer was called
      expect(mockIsPaidLLMOCustomer).to.have.been.calledOnce;

      // Verify log includes paid customer flag and correct counts
      // Only 1 valid AI summary (the other is "Not available")
      // Only 1 valuable suggestion (with valid summary)
      expect(log.info).to.have.been.calledWith(
        sinon.match(/prerender_ai_summary_metrics/)
          .and(sinon.match(/isPaidLLMOCustomer=false/))
          .and(sinon.match(/totalSuggestions=2/))
          .and(sinon.match(/valuableSuggestions=1/))
          .and(sinon.match(/validAiSummaryCount=1/)),
      );
    });

    it('should handle suggestions with null getData() by defaulting to empty object', async () => {
      const getDataStub = sinon.stub();
      getDataStub.onFirstCall().returns({ url: 'https://example.com/page1' }); // For indexing
      getDataStub.onSecondCall().returns(null); // For merging - tests || {} fallback

      const setDataStub = sinon.stub();
      const mockOpp = {
        getId: () => 'opportunity-123',
        getSiteId: () => 'site-123',
        getType: () => 'prerender',
        getData: sinon.stub().returns({}),
        setData: sinon.stub(),
        save: sinon.stub().resolves(),
        getSuggestions: sinon.stub().resolves([
          {
            getId: () => 's1',
            getData: getDataStub,
            getStatus: () => 'NEW',
            setData: setDataStub,
          },
        ]),
      };
      Opportunity.findById.resolves(mockOpp);
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Summary 1', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Should handle null getData() gracefully and update with new data
      expect(getDataStub).to.have.been.calledTwice;
      expect(setDataStub).to.have.been.calledWith({
        aiSummary: 'Summary 1',
        valuable: true,
        prompts: [], // no prompts from Mystique, currentData null → default []
      });
      expect(Suggestion.saveMany).to.have.been.calledOnce;
    });

    it('should fall back to raw URL when suggestion URL is not parseable', async () => {
      // Use an invalid URL that will cause new URL() to throw
      const invalidUrlSuggestion = {
        getId: sinon.stub().returns('suggestion-invalid'),
        getData: sinon.stub().returns({
          url: 'not-a-valid-url',
          isDomainWide: false,
        }),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
      };

      mockOpportunity.getSuggestions.resolves([invalidUrlSuggestion]);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'not-a-valid-url',
            aiSummary: 'Summary for invalid URL',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // The invalid URL should still match via the catch fallback (raw string comparison)
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      expect(invalidUrlSuggestion.setData).to.have.been.calledOnce;
      const setDataArg = invalidUrlSuggestion.setData.firstCall.args[0];
      expect(setDataArg.aiSummary).to.equal('Summary for invalid URL');
    });

    it('should skip suggestions that do not match existing URLs', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/non-existent-page',
            aiSummary: 'Summary for non-existent page',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(log.warn).to.have.been.calledWith(sinon.match(/No existing suggestion found for URL/));
      expect(Suggestion.saveMany).to.not.have.been.called;
    });
  });

  describe('Prompts field — preserve-or-update logic', () => {
    it('should store new prompts when Mystique returns them', async () => {
      const newPrompts = [
        {
          id: 'prompt-uuid-1', origin: 'ai', source: 'audit',
          prompt: 'What is prerendering?', type: 'Branded',
          topic: 'Performance', category: 'SEO', intent: 'Informational', regions: ['US'],
        },
      ];
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'Good summary',
            valuable: true,
            prompts: newPrompts,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ prompts: newPrompts }),
      );
    });

    it('should preserve existing prompts when Mystique returns empty prompts array', async () => {
      const existingPrompts = [{
        id: 'prompt-uuid-old', origin: 'ai', source: 'audit',
        prompt: 'Old question?', type: 'Non-Branded',
        topic: 'Content', category: 'SEO', intent: 'Informational', regions: ['US'],
      }];
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        aiSummary: 'Previous summary',
        prompts: existingPrompts,
      });

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'Updated summary',
            valuable: true,
            prompts: [], // Empty — Mystique generated nothing new
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ prompts: existingPrompts }), // Existing preserved
      );
    });

    it('should preserve existing prompts when Mystique omits the prompts field', async () => {
      const existingPrompts = [{
        id: 'prompt-uuid-existing', origin: 'ai', source: 'audit',
        prompt: 'Existing?', type: 'Non-Branded',
        topic: 'Content', category: 'SEO', intent: 'Informational', regions: ['US'],
      }];
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        aiSummary: 'Previous summary',
        prompts: existingPrompts,
      });

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'Updated summary',
            valuable: true,
            // prompts field absent
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ prompts: existingPrompts }), // Still preserved
      );
    });

    it('should default prompts to [] when neither Mystique nor existing data has them', async () => {
      // Suggestion has no prompts in existing data
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        aiSummary: '',
        // no prompts field
      });

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'New summary',
            valuable: true,
            // no prompts field from Mystique either
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(mockSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ prompts: [] }),
      );
    });

    it('should log suggestionsWithPrompts and totalPromptCount in metrics', async () => {
      const prompts = [
        {
          id: 'prompt-uuid-1', origin: 'ai', source: 'audit',
          prompt: 'Q1?', type: 'Branded',
          topic: 'Content', category: 'SEO', intent: 'Informational', regions: ['US'],
        },
        {
          id: 'prompt-uuid-2', origin: 'ai', source: 'audit',
          prompt: 'Q2?', type: 'Non-Branded',
          topic: 'Content', category: 'SEO', intent: 'Informational', regions: ['US'],
        },
      ];

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'Summary with prompts',
            valuable: true,
            prompts,
          },
          {
            url: 'https://example.com/page2',
            aiSummary: 'Summary without prompts',
            valuable: true,
            // no prompts
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/prerender_ai_summary_metrics/)
          .and(sinon.match(/suggestionsWithPrompts=1/))
          .and(sinon.match(/totalPromptCount=2/)),
      );
    });

    it('should log zero prompt metrics when no suggestions have prompts', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page1', aiSummary: 'Summary', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        data: { presignedUrl: 'https://s3.amazonaws.com/bucket/path', opportunityId: 'opportunity-123' },
      };

      await handler.default(message, context);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/prerender_ai_summary_metrics/)
          .and(sinon.match(/suggestionsWithPrompts=0/))
          .and(sinon.match(/totalPromptCount=0/)),
      );
    });
  });

  describe('Query-param-aware keying and dedup guard', () => {
    it('should treat URLs with same pathname but different query params as distinct suggestions (casio.com scenario)', async () => {
      // Two filter/faceted URLs that share the same pathname but differ in query params.
      // Before the fix, toPathname() stripped query params causing these to collide.
      const casioSuggestions = [
        {
          getId: sinon.stub().returns('casio-metals'),
          getData: sinon.stub().returns({
            url: 'https://casio.com/us/watches/casio/standard.filter.metals-K84vKnGqtM1LLU8tLlFLSsxLsdXPTS1JzNEtBgA=/',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('casio-in-stock'),
          getData: sinon.stub().returns({
            url: 'https://casio.com/us/watches/casio.filter.IN_STOCK-MTP-K84vKnGqtM1LLU8tLlHTKi7JT84OLkksKS229fSLDw7xd@ZWKyjKTylNLvFLzE119Q0JAAA=/',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(casioSuggestions);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://casio.com/us/watches/casio/standard.filter.metals-K84vKnGqtM1LLU8tLlFLSsxLsdXPTS1JzNEtBgA=/',
            aiSummary: 'Summary for metals filter',
            valuable: true,
          },
          {
            url: 'https://casio.com/us/watches/casio.filter.IN_STOCK-MTP-K84vKnGqtM1LLU8tLlHTKi7JT84OLkksKS229fSLDw7xd@ZWKyjKTylNLvFLzE119Q0JAAA=/',
            aiSummary: 'Summary for in-stock filter',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Both suggestions should be updated independently
      expect(casioSuggestions[0].setData).to.have.been.calledOnce;
      expect(casioSuggestions[1].setData).to.have.been.calledOnce;

      // Verify each got the correct summary (no collision)
      expect(casioSuggestions[0].setData.firstCall.args[0].aiSummary).to.equal('Summary for metals filter');
      expect(casioSuggestions[1].setData.firstCall.args[0].aiSummary).to.equal('Summary for in-stock filter');

      // saveMany should be called with both suggestions — no duplicates dropped
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const saved = Suggestion.saveMany.firstCall.args[0];
      expect(saved).to.have.lengthOf(2);
    });

    it('should treat URLs with query params as different from the same pathname without query params', async () => {
      const mixedSuggestions = [
        {
          getId: sinon.stub().returns('plain'),
          getData: sinon.stub().returns({
            url: 'https://example.com/watches/casio',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('with-query'),
          getData: sinon.stub().returns({
            url: 'https://example.com/watches/casio?filter=in_stock',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(mixedSuggestions);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/watches/casio', aiSummary: 'Plain page', valuable: true },
          { url: 'https://example.com/watches/casio?filter=in_stock', aiSummary: 'Filtered page', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(mixedSuggestions[0].setData).to.have.been.calledOnce;
      expect(mixedSuggestions[1].setData).to.have.been.calledOnce;
      expect(mixedSuggestions[0].setData.firstCall.args[0].aiSummary).to.equal('Plain page');
      expect(mixedSuggestions[1].setData.firstCall.args[0].aiSummary).to.equal('Filtered page');

      expect(Suggestion.saveMany).to.have.been.calledOnce;
      expect(Suggestion.saveMany.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should handle www vs non-www domain variants with locale paths (aia.com.hk scenario)', async () => {
      // aia.com.hk had both www.aia.com.hk and aia.com.hk variants with locale paths.
      // normalizePathnameWithQuery strips the domain, so both resolve by pathname+query.
      const aiaSuggestions = [
        {
          getId: sinon.stub().returns('aia-www-zh'),
          getData: sinon.stub().returns({
            url: 'https://www.aia.com.hk/zh-hk/about-us',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
        {
          getId: sinon.stub().returns('aia-en'),
          getData: sinon.stub().returns({
            url: 'https://aia.com.hk/en/about-us',
          }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        },
      ];

      mockOpportunity.getSuggestions.resolves(aiaSuggestions);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          // Mystique may send with or without www — pathname matching handles it
          { url: 'https://aia.com.hk/zh-hk/about-us', aiSummary: 'Chinese version summary', valuable: true },
          { url: 'https://www.aia.com.hk/en/about-us', aiSummary: 'English version summary', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(aiaSuggestions[0].setData).to.have.been.calledOnce;
      expect(aiaSuggestions[1].setData).to.have.been.calledOnce;
      expect(aiaSuggestions[0].setData.firstCall.args[0].aiSummary).to.equal('Chinese version summary');
      expect(aiaSuggestions[1].setData.firstCall.args[0].aiSummary).to.equal('English version summary');

      expect(Suggestion.saveMany).to.have.been.calledOnce;
      expect(Suggestion.saveMany.firstCall.args[0]).to.have.lengthOf(2);
    });

    it('should dedup by suggestion ID when multiple incoming URLs resolve to the same existing suggestion', async () => {
      // Simulate a scenario where two incoming URLs both normalize to the same key
      // (e.g. trailing-slash difference) and hit the same existing suggestion.
      // The dedup guard should prevent ON CONFLICT errors from duplicate IDs in saveMany.
      const singleSuggestion = {
        getId: sinon.stub().returns('shared-id'),
        getData: sinon.stub().returns({
          url: 'https://example.com/page',
        }),
        getStatus: sinon.stub().returns('NEW'),
        setData: sinon.stub(),
      };

      mockOpportunity.getSuggestions.resolves([singleSuggestion]);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          { url: 'https://example.com/page', aiSummary: 'First match', valuable: true },
          { url: 'https://example.com/page/', aiSummary: 'Second match (trailing slash)', valuable: true },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // setData is called twice (once per incoming URL), but saveMany should
      // only receive ONE suggestion because the dedup guard drops the duplicate ID.
      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const saved = Suggestion.saveMany.firstCall.args[0];
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].getId()).to.equal('shared-id');
    });

    it('should send no duplicates to saveMany even with a large batch of filter URLs (320 suggestions scenario)', async () => {
      // Simulate the casio.com 320-suggestion scenario: many filter URLs that
      // share a pathname prefix but have different filter suffixes.
      const count = 50; // Representative subset
      const existingSuggestions = [];
      const incomingSuggestions = [];

      for (let i = 0; i < count; i += 1) {
        const filterUrl = `https://casio.com/us/watches/casio.filter.param${i}-value${i}=/`;
        existingSuggestions.push({
          getId: sinon.stub().returns(`sugg-${i}`),
          getData: sinon.stub().returns({ url: filterUrl }),
          getStatus: sinon.stub().returns('NEW'),
          setData: sinon.stub(),
        });
        incomingSuggestions.push({
          url: filterUrl,
          aiSummary: `Summary for filter ${i}`,
          valuable: true,
        });
      }

      mockOpportunity.getSuggestions.resolves(existingSuggestions);

      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: incomingSuggestions,
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      expect(Suggestion.saveMany).to.have.been.calledOnce;
      const saved = Suggestion.saveMany.firstCall.args[0];
      expect(saved).to.have.lengthOf(count);

      // Verify no duplicate IDs in the saved array
      const ids = saved.map((s) => s.getId());
      expect(new Set(ids).size).to.equal(ids.length);
    });
  });

  describe('Multi-batch chaining', () => {
    const baseMessage = {
      siteId: 'site-123',
      auditId: 'audit-123',
      data: {
        presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
        opportunityId: 'opportunity-123',
      },
    };

    const successPayload = {
      opportunityId: 'opportunity-123',
      suggestions: [
        { url: 'https://example.com/page1', aiSummary: 'Summary 1', valuable: true },
      ],
    };

    it('should not chain or post Slack when no mystiqueSession on opportunity', async () => {
      mockFetchSuccess(successPayload);
      mockOpportunity.getData.returns({});

      await handler.default(baseMessage, context);

      expect(mockSqs.sendMessage).to.not.have.been.called;
      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('should handle opportunity.getData() returning null without crashing', async () => {
      mockFetchSuccess(successPayload);
      mockOpportunity.getData.returns(null); // covers ?? {} fallback on line 106

      const result = await handler.default(baseMessage, context);

      expect(result.status).to.equal(200);
      expect(mockSqs.sendMessage).to.not.have.been.called;
      expect(mockPostMessageOptional).to.not.have.been.called;
    });

    it('should post "batch complete" Slack and send next batch when not on last batch', async () => {
      const nextBatch = [{ suggestionId: 's-3', url: 'https://example.com/page3' }];
      const allBatches = [
        [{ suggestionId: 's-1', url: 'https://example.com/page1' }],
        nextBatch,
      ];

      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 0,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: 'C123',
          slackThreadTs: '1234567890.123456',

        },
      });

      mockS3Client.send.resolves({
        Body: { transformToString: sinon.stub().resolves(JSON.stringify(allBatches)) },
      });

      mockFetchSuccess(successPayload);

      await handler.default(baseMessage, context);

      // Slack: "Batch 1/2 complete"
      expect(mockPostMessageOptional).to.have.been.calledWith(
        sinon.match.any,
        'C123',
        sinon.match(/Batch 1\/2 complete/),
        sinon.match({ threadTs: '1234567890.123456' }),
      );

      // SQS: next batch sent
      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sqsCall = mockSqs.sendMessage.getCall(0);
      expect(sqsCall.args[0]).to.equal('https://sqs.us-east-1.amazonaws.com/test-mystique-queue');
      expect(sqsCall.args[1].data.suggestions).to.deep.equal(nextBatch);
      expect(sqsCall.args[1].data.batchIndex).to.equal(1);
      expect(sqsCall.args[1].data.totalBatches).to.equal(2);

      // Session updated on opportunity
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ mystiqueSession: sinon.match({ currentBatchIndex: 1 }) }),
      );
      expect(mockOpportunity.save).to.have.been.calledOnce;

      // Slack: "Sending batch 2/2"
      expect(mockPostMessageOptional).to.have.been.calledWith(
        sinon.match.any,
        'C123',
        sinon.match(/Sending batch 2\/2/),
        sinon.match({ threadTs: '1234567890.123456' }),
      );
    });

    it('should post "all batches complete", clean up S3, and clear session on last batch', async () => {
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 1, // already on last batch
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: 'C123',
          slackThreadTs: '1234567890.123456',

        },
      });

      mockFetchSuccess(successPayload);

      await handler.default(baseMessage, context);

      // SQS: no next batch
      expect(mockSqs.sendMessage).to.not.have.been.called;

      // S3 delete called
      expect(mockS3Client.send).to.have.been.called;

      // Session cleared on opportunity
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ mystiqueSession: undefined }),
      );
      expect(mockOpportunity.save).to.have.been.calledOnce;

      // Slack: "All 2 batches complete"
      expect(mockPostMessageOptional).to.have.been.calledWith(
        sinon.match.any,
        'C123',
        sinon.match(/All 2 batches complete/),
        sinon.match({ threadTs: '1234567890.123456' }),
      );
    });

    it('should not post Slack when slackChannelId or slackThreadTs is absent', async () => {
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 1,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,
        },
      });

      mockFetchSuccess(successPayload);

      await handler.default(baseMessage, context);

      // postMessageOptional is still called but with null channel/thread — it no-ops internally
      const calls = mockPostMessageOptional.getCalls();
      calls.forEach((c) => {
        expect(c.args[1]).to.be.null;
      });
    });

    it('should warn but not throw when S3 batch file delete fails on last batch', async () => {
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 1,
          currentBatchIndex: 0,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,
        },
      });

      mockS3Client.send.rejects(new Error('S3 delete failed'));
      mockFetchSuccess(successPayload);

      const result = await handler.default(baseMessage, context);

      expect(result.status).to.equal(200);
      expect(log.warn).to.have.been.calledWith(sinon.match(/Failed to delete S3 batch file/));
    });

    it('should return ok() even when chainNextMystiqueBatch throws', async () => {
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 0,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,

        },
      });

      // S3 read fails — chainNextMystiqueBatch will throw
      mockS3Client.send.rejects(new Error('S3 read timeout'));
      mockFetchSuccess(successPayload);

      const result = await handler.default(baseMessage, context);

      // Current batch was saved successfully — should return ok, not badRequest
      expect(result.status).to.equal(200);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to chain next batch/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should abort chain and clean up when next batch is missing from S3 manifest', async () => {
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 3,
          currentBatchIndex: 0,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,

        },
      });

      // S3 manifest only has 1 batch instead of 3 — nextIndex=1 will be undefined
      const corruptManifest = [[{ suggestionId: 's-1', url: 'https://example.com/page1' }]];
      mockS3Client.send
        .onFirstCall().resolves({
          Body: { transformToString: sinon.stub().resolves(JSON.stringify(corruptManifest)) },
        })
        .onSecondCall().resolves(); // DeleteObjectCommand

      mockFetchSuccess(successPayload);

      const result = await handler.default(baseMessage, context);

      expect(result.status).to.equal(200);
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Batch 1 missing or empty in S3 manifest/),
      );
      // Session should be cleared
      expect(mockOpportunity.setData).to.have.been.calledWith(
        sinon.match({ mystiqueSession: undefined }),
      );
    });

    it('should default deliveryType to unknown when site.getDeliveryType is absent', async () => {
      mockSite.getDeliveryType = undefined; // no method on site
      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 1,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,
        },
      });

      mockFetchSuccess(successPayload);

      const result = await handler.default(baseMessage, context);

      // Should still complete — deliveryType defaults to 'unknown'
      expect(result.status).to.equal(200);
    });

    it('should forward generatePrompts and siteRegion in chained SQS messages', async () => {
      const nextBatch = [{ suggestionId: 's-2', url: 'https://example.com/page2' }];
      const allBatches = [
        [{ suggestionId: 's-1', url: 'https://example.com/page1' }],
        nextBatch,
      ];

      mockOpportunity.getData.returns({
        mystiqueSession: {
          totalBatches: 2,
          currentBatchIndex: 0,
          batchesS3Key: 'prerender/mystique-batches/opportunity-123.json',
          slackChannelId: null,
          slackThreadTs: null,

          generatePrompts: true,
          siteRegion: 'US',
        },
      });

      mockS3Client.send.resolves({
        Body: { transformToString: sinon.stub().resolves(JSON.stringify(allBatches)) },
      });

      mockFetchSuccess(successPayload);

      await handler.default(baseMessage, context);

      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sqsMsg = mockSqs.sendMessage.firstCall.args[1];
      expect(sqsMsg.data.generatePrompts).to.equal(true);
      expect(sqsMsg.data.siteRegion).to.equal('US');
    });
  });

  describe('Logging (Presigned URL)', () => {
    it('should log the incoming message with presigned URL indicator', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      // Set empty suggestions to avoid further processing
      mockOpportunity.getSuggestions.resolves([]);

      await handler.default(message, context);

      expect(log.info).to.have.been.calledWith(sinon.match(/Received Mystique guidance for prerender \(presigned URL\)/));
    });

    it('should log presigned URL download info', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      // Set empty suggestions to avoid further processing
      mockOpportunity.getSuggestions.resolves([]);

      await handler.default(message, context);

      expect(log.info).to.have.been.calledWith(sinon.match(/Downloading AI summaries from presigned URL/));
      expect(log.info).to.have.been.calledWith(sinon.match(/Successfully loaded.*suggestions from presigned URL/));
    });

    it('should log successful batch update', async () => {
      mockFetchSuccess({
        opportunityId: 'opportunity-123',
        suggestions: [
          {
            url: 'https://example.com/page1',
            aiSummary: 'Summary',
            valuable: true,
          },
        ],
      });

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          presignedUrl: 'https://s3.amazonaws.com/bucket/path?X-Amz-Signature=...',
          opportunityId: 'opportunity-123',
        },
      };

      await handler.default(message, context);

      // Verify comprehensive log with quality metrics and paid LLMO customer flag
      expect(log.info).to.have.been.calledWith(
        sinon.match(/prerender_ai_summary_metrics/)
          .and(sinon.match(/isPaidLLMOCustomer=true/))
          .and(sinon.match(/totalSuggestions=/))
          .and(sinon.match(/valuableSuggestions=/))
          .and(sinon.match(/validAiSummaryCount=/)),
      );
    });
  });
});
