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
import handler from '../../../src/prerender/guidance-handler.js';

use(sinonChai);

describe('Prerender Guidance Handler', () => {
  let context;
  let log;
  let Site;
  let Opportunity;
  let Suggestion;
  let mockSite;
  let mockOpportunity;
  let mockSuggestions;

  beforeEach(() => {
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

    context = {
      log,
      dataAccess: {
        Site,
        Opportunity,
        Suggestion,
      },
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Successful AI Summary Update', () => {
    it('should successfully update suggestions with AI summaries', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'AI generated summary for page 1',
              valuable: true,
            },
            {
              url: 'https://example.com/page2',
              aiSummary: 'AI generated summary for page 2',
              valuable: false,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
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
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Summary without valuable flag',
              // valuable: undefined (not provided)
            },
          ],
        },
      };

      await handler(message, context);

      expect(mockSuggestions[0].setData).to.have.been.called;
      const updatedData = mockSuggestions[0].setData.getCall(0).args[0];
      expect(updatedData.valuable).to.equal(true); // Default to true
    });

    it('should respect explicit false for valuable flag', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Not valuable content',
              valuable: false,
            },
          ],
        },
      };

      await handler(message, context);

      expect(mockSuggestions[0].setData).to.have.been.called;
      const updatedData = mockSuggestions[0].setData.getCall(0).args[0];
      expect(updatedData.valuable).to.equal(false);
    });
  });

  describe('Error Handling', () => {
    it('should return 400 if data is missing', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        // data field is missing
      };

      const result = await handler(message, context);

      expect(result.status).to.equal(400);
      expect(log.error).to.have.been.calledWith(sinon.match(/Missing data in Mystique response/));
    });

    it('should return 404 if site not found', async () => {
      Site.findById.resolves(null);

      const message = {
        siteId: 'non-existent-site',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.error).to.have.been.calledWith(sinon.match(/Site not found/));
    });

    it('should return 400 if opportunityId is missing', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          // opportunityId: missing
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Some summary',
              valuable: true,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.error).to.have.been.calledWith(sinon.match(/Missing opportunityId in Mystique response/));
    });

    it('should return 404 if opportunity not found', async () => {
      Opportunity.findById.resolves(null);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'non-existent-opportunity',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Some summary',
              valuable: true,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.error).to.have.been.calledWith(sinon.match(/Opportunity not found for opportunityId=/));
    });

    it('should return OK if no suggestions provided', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.warn).to.have.been.calledWith(sinon.match(/No suggestions provided/));
    });

    it('should return OK if no existing suggestions found', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Some summary',
              valuable: true,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.warn).to.have.been.calledWith(sinon.match(/No existing suggestions found/));
    });

    it('should handle batch save errors gracefully', async () => {
      Suggestion._saveMany.rejects(new Error('DynamoDB batch write failed'));

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Summary',
              valuable: true,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
      expect(log.error).to.have.been.calledWith(sinon.match(/Error batch saving suggestions/));
    });
  });

  describe('Suggestion Filtering', () => {
    it('should skip OUTDATED suggestions', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page3', // OUTDATED
              aiSummary: 'This should not be updated',
              valuable: true,
            },
          ],
        },
      };

      await handler(message, context);

      // OUTDATED suggestion should be filtered out
      expect(Suggestion._saveMany).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(sinon.match(/No valid suggestions to update/));
    });

    it('should return OK if all suggestions are OUTDATED', async () => {
      // All suggestions are OUTDATED
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

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Summary 1',
              valuable: true,
            },
            {
              url: 'https://example.com/page2',
              aiSummary: 'Summary 2',
              valuable: true,
            },
          ],
        },
      };

      const result = await handler(message, context);

      expect(result).to.exist;
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

      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            { url: 'https://example.com/new', aiSummary: 'Summary 1', valuable: true },
            { url: 'https://example.com/pending', aiSummary: 'Summary 2', valuable: true },
            { url: 'https://example.com/approved', aiSummary: 'Summary 3', valuable: true },
            { url: 'https://example.com/outdated', aiSummary: 'Should not update', valuable: true },
          ],
        },
      };

      await handler(message, context);

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
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              // url: missing
              aiSummary: 'Summary without URL',
              valuable: true,
            },
          ],
        },
      };

      await handler(message, context);

      expect(log.warn).to.have.been.calledWith(sinon.match(/Skipping Mystique suggestion without URL/));
      expect(Suggestion._saveMany).to.not.have.been.called;
    });

    it('should skip suggestions that do not match existing URLs', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/non-existent-page',
              aiSummary: 'Summary for non-existent page',
              valuable: true,
            },
          ],
        },
      };

      await handler(message, context);

      expect(log.warn).to.have.been.calledWith(sinon.match(/No existing suggestion found for URL/));
      expect(Suggestion._saveMany).to.not.have.been.called;
    });
  });

  describe('Logging', () => {
    it('should log the incoming message', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [],
        },
      };

      await handler(message, context);

      expect(log.info).to.have.been.calledWith(sinon.match(/Received Mystique guidance for prerender/));
    });

    it('should log processing info', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [],
        },
      };

      await handler(message, context);

      expect(log.info).to.have.been.calledWith(sinon.match(/Processing AI guidance for siteId=site-123/));
    });

    it('should log successful batch update', async () => {
      const message = {
        siteId: 'site-123',
        auditId: 'audit-123',
        data: {
          opportunityId: 'opportunity-123',
          suggestions: [
            {
              url: 'https://example.com/page1',
              aiSummary: 'Summary',
              valuable: true,
            },
          ],
        },
      };

      await handler(message, context);

      expect(log.info).to.have.been.calledWith(
        sinon.match(/Successfully batch updated.*suggestions with AI summaries/),
      );
    });
  });
});

