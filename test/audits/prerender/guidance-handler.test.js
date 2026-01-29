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

  // Helper to mock successful fetch response
  const mockFetchSuccess = (data) => {
    fetchStub.resolves({
      ok: true,
      json: sinon.stub().resolves(data),
    });
  };

  // Helper to mock failed fetch response
  const mockFetchFailure = (statusCode = 500, statusText = 'Internal Server Error') => {
    fetchStub.resolves({
      ok: false,
      status: statusCode,
      statusText,
    });
  };

  beforeEach(async () => {
    log = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };

    mockSite = {
      getId: sinon.stub().returns('site-123'),
      getBaseURL: sinon.stub().returns('https://example.com'),
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
    };

    Site = {
      findById: sinon.stub().resolves(mockSite),
    };

    Opportunity = {
      findById: sinon.stub().resolves(mockOpportunity),
    };

    Suggestion = {
      _saveMany: sinon.stub().resolves(),
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

    // Mock global fetch for presigned URL downloads
    // Using sinon.stub(global, 'fetch') properly saves and restores the original
    fetchStub = sinon.stub(global, 'fetch');

    // Mock isPaidLLMOCustomer utility
    mockIsPaidLLMOCustomer = sinon.stub().resolves(true);

    // Import handler with mocked isPaidLLMOCustomer
    handler = await esmock('../../../src/prerender/guidance-handler.js', {
      '../../../src/prerender/utils/utils.js': {
        isPaidLLMOCustomer: mockIsPaidLLMOCustomer,
      },
    });

    context = {
      log,
      site: mockSite,
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

      // Verify fetch was called with presigned URL
      expect(fetchStub).to.have.been.calledWith(presignedUrl);

      expect(Site.findById).to.have.been.calledWith('site-123');
      expect(Opportunity.findById).to.have.been.calledWith('opportunity-123');
      expect(mockOpportunity.getSuggestions).to.have.been.called;

      // Should update only non-OUTDATED suggestions (2 out of 3)
      expect(mockSuggestions[0].setData).to.have.been.called;
      expect(mockSuggestions[1].setData).to.have.been.called;
      expect(mockSuggestions[2].setData).to.not.have.been.called; // OUTDATED, skipped

      // Verify batch save was called
      expect(Suggestion._saveMany).to.have.been.called;
      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
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
      // Should log the fetch error
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to download from presigned URL: 404 Not Found/),
      );
      // Should also log the catch block error with opportunityId
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
      expect(log.warn).to.have.been.calledWith(sinon.match(/No existing suggestions found/));
    });

    it('should handle batch save errors gracefully', async () => {
      Suggestion._saveMany.rejects(new Error('DynamoDB batch write failed'));
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
      expect(Suggestion._saveMany).to.not.have.been.called;
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
      expect(Suggestion._saveMany).to.not.have.been.called;
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

      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
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
      expect(Suggestion._saveMany).to.not.have.been.called;
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
      expect(Suggestion._saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
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
      expect(Suggestion._saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
      expect(savedSuggestions).to.have.lengthOf(2);
      
      // Verify aiSummary is set to empty string
      expect(savedSuggestions[0].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
      );
      expect(savedSuggestions[1].setData).to.have.been.calledWith(
        sinon.match({ aiSummary: '' }),
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
      expect(Suggestion._saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
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
      expect(Suggestion._saveMany).to.have.been.calledOnce;
      const savedSuggestions = Suggestion._saveMany.getCall(0).args[0];
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

      // Verify log includes paid customer flag and correct counts (structured logging)
      expect(log.info).to.have.been.calledWith(
        'prerender_ai_summary_metrics',
        sinon.match({
          isPaidLLMOCustomer: true,
          totalSuggestions: 2,
          valuableSuggestions: 1,
          validAiSummaryCount: 2,
        }),
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
        'prerender_ai_summary_metrics',
        sinon.match({
          isPaidLLMOCustomer: false,
          totalSuggestions: 2,
          valuableSuggestions: 1,
          validAiSummaryCount: 1,
        }),
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
      });
      expect(Suggestion._saveMany).to.have.been.calledOnce;
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
      expect(Suggestion._saveMany).to.not.have.been.called;
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
        'prerender_ai_summary_metrics',
        sinon.match.has('isPaidLLMOCustomer', true)
          .and(sinon.match.has('totalSuggestions'))
          .and(sinon.match.has('valuableSuggestions'))
          .and(sinon.match.has('validAiSummaryCount')),
      );
    });
  });
});
