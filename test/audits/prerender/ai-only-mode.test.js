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
import {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
  handleAiOnlyMode,
} from '../../../src/prerender/handler.js';

use(sinonChai);

describe('Prerender AI-Only Mode', () => {
  let context;
  let mockS3Client;
  let mockDataAccess;
  let mockOpportunity;
  let mockSuggestions;
  let mockSqs;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockS3Client = {
      send: sandbox.stub(),
    };

    mockSuggestions = [
      {
        getId: sandbox.stub().returns('suggestion-1'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page1',
          isDomainWide: false,
          scrapeJobId: 'test-scrape-job',
        }),
        getStatus: sandbox.stub().returns('NEW'),
      },
      {
        getId: sandbox.stub().returns('suggestion-2'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page2',
          isDomainWide: false,
          scrapeJobId: 'test-scrape-job',
        }),
        getStatus: sandbox.stub().returns('PENDING_VALIDATION'),
      },
    ];

    mockOpportunity = {
      getId: sandbox.stub().returns('opportunity-123'),
      getAuditId: sandbox.stub().returns('audit-123'),
      getSiteId: sandbox.stub().returns('site-123'),
      getType: sandbox.stub().returns('prerender'),
      getSuggestions: sandbox.stub().resolves(mockSuggestions),
      getData: sandbox.stub().returns({}),
      setData: sandbox.stub(),
      save: sandbox.stub().resolves(),
    };

    mockDataAccess = {
      Opportunity: {
        findById: sandbox.stub().resolves(mockOpportunity),
        allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
      },
    };

    mockSqs = {
      sendMessage: sandbox.stub().resolves(),
    };

    context = {
      log: {
        debug: sandbox.stub(),
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      site: {
        getId: sandbox.stub().returns('site-123'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
        getRegion: sandbox.stub().returns(''),
      },
      dataAccess: mockDataAccess,
      env: {
        S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        QUEUE_SPACECAT_TO_MYSTIQUE: 'https://sqs.us-east-1.amazonaws.com/test-queue',
      },
      s3Client: mockS3Client,
      sqs: mockSqs,
      data: JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
      }),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('importTopPages - AI-only mode', () => {
    it('should successfully trigger AI summary for existing opportunity', async () => {
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(result.opportunityId).to.equal('opportunity-123');
      expect(result.fullAuditRef).to.equal('ai-only/opportunity-123');
      expect(mockSqs.sendMessage).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Successfully queued AI summary request for 2 suggestion/),
      );
    });

    it('should fetch latest opportunity if opportunityId not provided', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
        // opportunityId not provided
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(mockDataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith('site-123', 'NEW');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Found latest NEW opportunity: opportunity-123/),
      );
    });

    it('should fetch scrapeJobId from status.json if not provided', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        opportunityId: 'opportunity-123',
        // scrapeJobId not provided
      });

      const statusData = {
        scrapeJobId: 'fetched-scrape-job',
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(statusData)),
        },
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(mockS3Client.send).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/scrapeJobId not provided, fetching from status.json/),
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Found scrapeJobId: fetched-scrape-job/),
      );
    });

    it('should handle NoSuchKey error when status.json not found', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        // scrapeJobId not provided
      });

      const noSuchKeyError = new Error('The specified key does not exist');
      noSuchKeyError.name = 'NoSuchKey';
      mockS3Client.send.rejects(noSuchKeyError);

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/scrapeJobId not found/);
      expect(result.fullAuditRef).to.match(/ai-only\/failed-/);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No scrapeJobId found in status\.json/),
      );
    });

    it('should handle generic S3 errors when fetching status.json', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        // scrapeJobId not provided
      });

      mockS3Client.send.rejects(new Error('S3 connection timeout'));

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/scrapeJobId not found/);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/Could not read status\.json.*S3 connection timeout/),
      );
    });

    it('should handle status.json without scrapeJobId field', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        // scrapeJobId not provided
      });

      const statusData = {
        // scrapeJobId missing
        lastUpdated: '2025-01-01T00:00:00Z',
      };

      mockS3Client.send.resolves({
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(statusData)),
        },
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No scrapeJobId found in status.json/),
      );
    });

    it('should return error if opportunity not found by ID', async () => {
      // Provide an explicit opportunityId so it takes the findById path
      context.data = JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
        opportunityId: 'non-existent-opportunity-id',
      });

      mockDataAccess.Opportunity.findById.resolves(null);

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/Opportunity not found: non-existent-opportunity-id/);
      expect(result.fullAuditRef).to.match(/ai-only\/failed-/);
    });

    it('should return error if no NEW opportunity found for site', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
        // opportunityId not provided
      });

      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/No NEW prerender opportunity found/);
      expect(result.fullAuditRef).to.match(/ai-only\/failed-/);
    });

    it('should return error if opportunity does not belong to site', async () => {
      mockOpportunity.getSiteId.returns('different-site-id');

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/does not belong to site/);
      expect(result.fullAuditRef).to.match(/ai-only\/failed-/);
    });

    it('should handle data as object (not string)', async () => {
      context.data = {
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
      };

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
    });
  });

  describe('submitForScraping - AI-only mode', () => {
    it('should skip scraping in ai-only mode', async () => {
      const result = await submitForScraping(context);

      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Detected ai-only mode in step 2, skipping scraping/),
      );
    });

    it('should proceed normally if not in ai-only mode', async () => {
      context.data = undefined;
      context.dataAccess = {
        SiteTopPage: {
          allBySiteId: sandbox.stub().resolves([]),
        },
      };

      const result = await submitForScraping(context);

      expect(result.status).to.not.equal('skipped');
      expect(result.urls).to.exist;
    });
  });

  describe('processContentAndGenerateOpportunities - AI-only mode', () => {
    it('should skip processing in ai-only mode', async () => {
      context.audit = {
        getId: sandbox.stub().returns('audit-123'),
      };
      context.scrapeResultPaths = new Map();

      const result = await processContentAndGenerateOpportunities(context);

      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Detected ai-only mode in step 3, skipping processing/),
      );
    });
  });

  describe('sendPrerenderGuidanceRequestToMystique - edge cases', () => {
    it('should return 0 if SQS not configured', async () => {
      context.sqs = null;

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(mockSqs.sendMessage).to.not.have.been.called;
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured/),
      );
    });

    it('should return 0 if QUEUE_SPACECAT_TO_MYSTIQUE not configured', async () => {
      context.env.QUEUE_SPACECAT_TO_MYSTIQUE = null;

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/SQS or Mystique queue not configured/),
      );
    });

    it('should return 0 if opportunity is null', async () => {
      mockDataAccess.Opportunity.findById.resolves(null);
      mockDataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.fullAuditRef).to.match(/ai-only\/failed-/);
    });

    it('should return 0 if no suggestions exist', async () => {
      mockOpportunity.getSuggestions.resolves([]);

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions match mode=ai-only/),
      );
    });

    it('should return 0 if getSuggestions returns null', async () => {
      mockOpportunity.getSuggestions.resolves(null);

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
    });

    it('should skip domain-wide suggestions', async () => {
      mockSuggestions[0].getData.returns({
        url: 'https://example.com',
        isDomainWide: true, // Domain-wide
      });

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(1); // Only 1 non-domain-wide
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page2');
    });

    it('should skip suggestions without URL', async () => {
      mockSuggestions[0].getData.returns({
        url: null, // No URL
        isDomainWide: false,
      });

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(1); // Only 1 with URL
    });

    it('should skip OUTDATED suggestions', async () => {
      mockSuggestions[0].getStatus.returns('OUTDATED');

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(1); // Only 1 non-OUTDATED
    });

    it('should skip SKIPPED suggestions', async () => {
      mockSuggestions[0].getStatus.returns('SKIPPED');

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(1); // Only 1 non-SKIPPED
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page2');
    });

    it('should return 0 if all suggestions are SKIPPED', async () => {
      mockSuggestions[0].getStatus.returns('SKIPPED');
      mockSuggestions[1].getStatus.returns('SKIPPED');

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions match mode=ai-only/),
      );
    });

    it('should return 0 if all suggestions are filtered out', async () => {
      mockSuggestions[0].getStatus.returns('OUTDATED');
      mockSuggestions[1].getData.returns({ url: null });

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions match mode=ai-only/),
      );
    });


    it('should handle missing getDeliveryType method', async () => {
      context.site.getDeliveryType = undefined;

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.deliveryType).to.equal('unknown');
    });

    it('should include the site base URL as top-level url in the SQS message', async () => {
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.url).to.equal('https://example.com');
    });

    it('should handle missing getId method on suggestion', async () => {
      mockSuggestions[0].getId = undefined;

      const result = await importTopPages(context);

      // Should still process suggestion
      expect(result.status).to.equal('complete');
    });

    it('should use per-suggestion scrapeJobId when building Mystique S3 keys', async () => {
      // Suggestions with their own scrapeJobId must use that id for key construction,
      // not the audit-level scrapeJobId passed in via ai-only data.
      const perSuggestionJobId = 'per-suggestion-job-id';
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        scrapeJobId: perSuggestionJobId,
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      const suggestion = uploadedSuggestions.find((s) => s.url === 'https://example.com/page1');
      expect(suggestion).to.exist;
      expect(suggestion.markdownDiffKey).to.include(`prerender/scrapes/${perSuggestionJobId}`);
      expect(suggestion.originalHtmlMarkdownKey).to.include(`prerender/scrapes/${perSuggestionJobId}`);
    });

    it('should derive scrapeJobId from originalHtmlKey when scrapeJobId is missing', async () => {
      const derivedJobId = 'derived-job-id';
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        // scrapeJobId absent but originalHtmlKey present — job id is the 3rd path segment
        originalHtmlKey: `prerender/scrapes/${derivedJobId}/page1/server-side.html`,
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/derived from originalHtmlKey/),
      );
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      const suggestion = uploadedSuggestions.find((s) => s.url === 'https://example.com/page1');
      expect(suggestion).to.exist;
      expect(suggestion.markdownDiffKey).to.include(`prerender/scrapes/${derivedJobId}`);
      expect(suggestion.originalHtmlMarkdownKey).to.include(`prerender/scrapes/${derivedJobId}`);
    });

    it('should skip suggestion when both scrapeJobId and originalHtmlKey are missing', async () => {
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        // neither scrapeJobId nor originalHtmlKey
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/skipped: no scrapeJobId and no originalHtmlKey/),
      );
      // suggestion-1 is skipped; only suggestion-2 (which has scrapeJobId) is sent
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page2');
    });

    it('should skip suggestion when originalHtmlKey has fewer than 3 path segments', async () => {
      // parts[2] will be undefined → effectiveScrapeJobId = null → suggestion skipped
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        originalHtmlKey: 'prerender/scrapes', // only 2 segments, no job id at index 2
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/skipped: no scrapeJobId and no originalHtmlKey/),
      );
      // suggestion-1 is skipped; only suggestion-2 is sent
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page2');
    });
  });

  describe('Suggestion scoping — ai-only vs normal audit run', () => {
    it('ai-only mode sends ALL opportunity suggestions to Mystique, not just a batch', async () => {
      // Simulate an opportunity with 3 suggestions from different past audit runs.
      // In ai-only mode every eligible suggestion should be queued regardless of which
      // audit run produced it.
      const staleSuggestion = {
        getId: sandbox.stub().returns('suggestion-stale'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/old-page',
          isDomainWide: false,
          scrapeJobId: 'old-job-id',
        }),
        getStatus: sandbox.stub().returns('NEW'),
      };
      mockOpportunity.getSuggestions.resolves([...mockSuggestions, staleSuggestion]);

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      // All 3 suggestions (2 from current run + 1 stale) must be sent
      expect(result.auditResult.suggestionCount).to.equal(3);
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      const sentUrls = uploadedSuggestions.map((s) => s.url);
      expect(sentUrls).to.include('https://example.com/page1');
      expect(sentUrls).to.include('https://example.com/page2');
      expect(sentUrls).to.include('https://example.com/old-page');
    });

    it('normal audit run builds auditRunCandidates with suggestionId from saved suggestions', async () => {
      // auditRunCandidates is built from preRenderSuggestions (the URL list produced by the
      // current audit run). getSuggestions() is called once by findPreservableDomainWideSuggestion
      // and once after syncSuggestions to resolve suggestionId for each candidate URL.
      const savedSuggestion = {
        getId: sinon.stub().returns('page1-suggestion-id'),
        getData: sinon.stub().returns({ url: 'https://example.com/page1' }),
        getStatus: sinon.stub().returns('NEW'),
      };
      const getSuggestionsStub = sinon.stub().resolves([savedSuggestion]);
      const mockOpportunityNormal = {
        getId: () => 'opp-normal',
        getSuggestions: getSuggestionsStub,
      };

      const syncSuggestionsStub = sinon.stub().resolves();

      const mockHandler = await (await import('esmock')).default('../../../src/prerender/handler.js', {
        '../../../src/common/opportunity.js': {
          convertToOpportunity: sinon.stub().resolves(mockOpportunityNormal),
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
        '../../../src/prerender/utils/utils.js': {
          isPaidLLMOCustomer: sinon.stub().resolves(true),
          mergeAndGetUniqueHtmlUrls: sinon.stub().returns({ urls: [], filteredCount: 0 }),
        },
      });

      const auditData = {
        siteId: 'test-site',
        auditId: 'audit-current',
        scrapeJobId: 'current-job-id',
        auditResult: {
          urlsNeedingPrerender: 1,
          results: [
            {
              url: 'https://example.com/page1',
              needsPrerender: true,
              contentGainRatio: 2.0,
              wordCountBefore: 100,
              wordCountAfter: 200,
            },
          ],
        },
      };

      const sqsContext = {
        log: { info: sinon.stub(), debug: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
        dataAccess: {
          Suggestion: {
            STATUSES: {
              NEW: 'NEW', FIXED: 'FIXED', PENDING_VALIDATION: 'PENDING_VALIDATION', SKIPPED: 'SKIPPED',
            },
          },
        },
        site: { getId: () => 'test-site-id', getBaseURL: () => 'https://example.com' },
      };

      const { opportunity, auditRunCandidates } = await mockHandler.processOpportunityAndSuggestions(
        'https://example.com',
        auditData,
        sqsContext,
      );

      expect(opportunity).to.equal(mockOpportunityNormal);
      // getSuggestions is called once by findPreservableDomainWideSuggestion.
      expect(getSuggestionsStub).to.have.been.calledOnce;
      // One candidate per URL in the current batch — plain objects with S3 keys and suggestionId
      expect(auditRunCandidates).to.have.lengthOf(1);
      expect(auditRunCandidates[0].suggestionId).to.equal('https://example.com/page1');
      expect(auditRunCandidates[0].url).to.equal('https://example.com/page1');
      expect(auditRunCandidates[0].originalHtmlMarkdownKey).to.include('current-job-id');
      expect(auditRunCandidates[0].markdownDiffKey).to.include('current-job-id');
      expect(auditRunCandidates[0]).to.not.have.property('getId');
      expect(auditRunCandidates[0]).to.not.have.property('getStatus');
    });
  });

  describe('getModeFromData - coverage', () => {
    it('should return mode from string data', async () => {
      context.data = JSON.stringify({ mode: 'ai-only', scrapeJobId: 'test' });

      const result = await importTopPages(context);

      expect(result.mode).to.equal('ai-only');
      expect(result.status).to.equal('complete');
    });

    it('should return mode from object data', async () => {
      context.data = { mode: 'ai-only', scrapeJobId: 'test' };

      const result = await importTopPages(context);

      expect(result.mode).to.equal('ai-only');
      expect(result.status).to.equal('complete');
    });

    it('should handle JSON parse errors gracefully in getModeFromData', async () => {
      // This tests the catch block in getModeFromData
      // Since the JSON is malformed, mode will be null and it won't enter AI-only mode
      context.data = '{invalid json}';
      
      // Mock for normal flow
      context.dataAccess.SiteTopPage = {
        allBySiteId: sandbox.stub().resolves([]),
      };

      const result = await importTopPages(context);

      // Should not crash - getModeFromData returns null on parse error
      // Will proceed to normal import flow
      expect(result).to.exist;
    });

    it('should return null when mode is missing from valid JSON', async () => {
      // This tests the || null branch in getModeFromData (line 312)
      // JSON is valid but mode field is missing
      context.data = JSON.stringify({ scrapeJobId: 'test', opportunityId: 'opp-123' });
      
      // Mock for normal flow
      context.dataAccess.SiteTopPage = {
        allBySiteId: sandbox.stub().resolves([]),
      };

      const result = await importTopPages(context);

      // Should proceed to normal import flow (not ai-only mode)
      expect(result).to.exist;
      // Verify it didn't enter ai-only mode
      expect(result.mode).to.be.undefined;
    });

    it('should return null when mode is explicitly null in valid JSON', async () => {
      // This tests the || null branch when mode is explicitly null
      context.data = JSON.stringify({ mode: null, scrapeJobId: 'test' });
      
      // Mock for normal flow
      context.dataAccess.SiteTopPage = {
        allBySiteId: sandbox.stub().resolves([]),
      };

      const result = await importTopPages(context);

      // Should proceed to normal import flow (not ai-only mode)
      expect(result).to.exist;
      expect(result.mode).to.be.undefined;
    });
  });

  describe('CSV URL scoping in ai-only mode', () => {
    it('should scope suggestions to auditContext.urls when provided', async () => {
      context.auditContext = {
        urls: ['https://example.com/page1'],
      };

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page1');
    });

    it('should filter out suggestions not in auditContext.urls', async () => {
      context.auditContext = {
        urls: ['https://example.com/page2'],
      };

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(1);
      expect(uploadedSuggestions[0].url).to.equal('https://example.com/page2');
    });

    it('should send all suggestions when auditContext.urls is not set', async () => {
      // Default context has no auditContext.urls
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(result.auditResult.suggestionCount).to.equal(2);
    });

    it('should return 0 when no suggestions match auditContext.urls', async () => {
      context.auditContext = {
        urls: ['https://example.com/no-match'],
      };

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
    });
  });

  describe('generatePrompts flag in SQS payload', () => {
    it('should include generatePrompts:false in SQS message by default', async () => {
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.generatePrompts).to.equal(false);
    });

    it('should include generatePrompts:true in SQS message when flag is set', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
        generatePrompts: true,
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.generatePrompts).to.equal(true);
    });

    it('should treat generatePrompts as truthy when provided as string "true"', async () => {
      // The Slack keyword parser passes values as strings (generatePrompts:true → "true")
      context.data = JSON.stringify({
        mode: 'ai-only',
        scrapeJobId: 'test-scrape-job',
        generatePrompts: 'true',
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      // !!parsedData.generatePrompts → !!'true' → true
      expect(message.data.generatePrompts).to.equal(true);
    });
  });

  describe('hasPrompts flag per suggestion in SQS payload', () => {
    it('should set hasPrompts:false for suggestions without existing prompts', async () => {
      // Default mock suggestions have no prompts field
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      uploadedSuggestions.forEach((s) => {
        expect(s.hasPrompts).to.equal(false);
      });
    });

    it('should set hasPrompts:true for suggestions that already have prompts', async () => {
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        scrapeJobId: 'test-scrape-job',
        prompts: [{
          id: 'prompt-uuid-1', origin: 'ai', source: 'audit',
          prompt: 'What is prerendering?', type: 'Branded',
          topic: 'Performance', category: 'SEO', intent: 'Informational', regions: ['US'],
        }],
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      const s1 = uploadedSuggestions.find((s) => s.url === 'https://example.com/page1');
      const s2 = uploadedSuggestions.find((s) => s.url === 'https://example.com/page2');
      expect(s1.hasPrompts).to.equal(true);
      expect(s2.hasPrompts).to.equal(false);
    });

    it('should set hasPrompts:false for suggestions with empty prompts array', async () => {
      mockSuggestions[0].getData.returns({
        url: 'https://example.com/page1',
        isDomainWide: false,
        scrapeJobId: 'test-scrape-job',
        prompts: [], // Empty — no prompts yet
      });

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      const s1 = uploadedSuggestions.find((s) => s.url === 'https://example.com/page1');
      expect(s1.hasPrompts).to.equal(false);
    });
  });

  describe('siteRegion in SQS payload', () => {
    it('should include empty siteRegion when site has no region configured', async () => {
      // Default mock site returns '' from getRegion
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.siteRegion).to.equal('');
    });

    it('should include siteRegion from site config when available', async () => {
      context.site.getRegion = sandbox.stub().returns('US');

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.siteRegion).to.equal('US');
    });

    it('should default to empty string when site.getRegion returns null', async () => {
      context.site.getRegion = sandbox.stub().returns(null);

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.siteRegion).to.equal('');
    });
  });

  describe('suggestionsS3Key and suggestionsS3Bucket in SQS payload', () => {
    it('should include suggestionsS3Key and suggestionsS3Bucket instead of inline suggestions', async () => {
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.suggestionsS3Key).to.equal('prerender/mystique-suggestions/opportunity-123.json');
      expect(message.data.suggestionsS3Bucket).to.equal('test-bucket');
      expect(message.data).to.not.have.property('suggestions');
      expect(message.data).to.not.have.property('batchIndex');
      expect(message.data).to.not.have.property('totalBatches');
    });
  });

  describe('sendPrerenderGuidanceRequestToMystique error handling', () => {
    it('should return failed when SQS sendMessage fails', async () => {
      mockSqs.sendMessage.rejects(new Error('SQS network error'));

      const result = await importTopPages(context);

      expect(result.status).to.equal('failed');
      expect(result.error).to.match(/Mystique dispatch failed/);
      expect(result.fullAuditRef).to.match(/failed-/);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to send guidance:prerender message/),
        sinon.match.instanceOf(Error),
      );
    });
  });

  describe('S3 upload and mystiqueSession behavior', () => {
    it('should always upload suggestions to S3 at the correct key', async () => {
      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');

      // S3 PutObjectCommand is always called for the suggestions upload
      expect(mockS3Client.send).to.have.been.calledOnce;
      const s3Call = mockS3Client.send.firstCall.args[0];
      expect(s3Call.input.Key).to.equal('prerender/mystique-suggestions/opportunity-123.json');
      expect(s3Call.input.Bucket).to.equal('test-bucket');
      expect(s3Call.input.ContentType).to.equal('application/json');

      const uploadedSuggestions = JSON.parse(s3Call.input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(2);
    });

    it('should upload all suggestions to S3 for large suggestion counts', async () => {
      const manySuggestions = Array.from({ length: 400 }, (_, i) => ({
        getId: sandbox.stub().returns(`suggestion-${i}`),
        getData: sandbox.stub().returns({
          url: `https://example.com/page${i}`,
          isDomainWide: false,
          scrapeJobId: 'test-scrape-job',
        }),
        getStatus: sandbox.stub().returns('NEW'),
      }));
      mockOpportunity.getSuggestions.resolves(manySuggestions);

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      expect(result.auditResult.suggestionCount).to.equal(400);

      // S3 upload contains all 400 suggestions in a single call
      expect(mockS3Client.send).to.have.been.calledOnce;
      const uploadedSuggestions = JSON.parse(mockS3Client.send.firstCall.args[0].input.Body);
      expect(uploadedSuggestions).to.have.lengthOf(400);

      // Single SQS message with S3 key reference (no inline suggestions)
      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      const sqsMsg = mockSqs.sendMessage.firstCall.args[1];
      expect(sqsMsg.data.suggestionsS3Key).to.equal('prerender/mystique-suggestions/opportunity-123.json');
      expect(sqsMsg.data.suggestionsS3Bucket).to.equal('test-bucket');
      expect(sqsMsg.data).to.not.have.property('suggestions');
    });

  });

  describe('handleAiOnlyMode - malformed JSON handling', () => {
    it('should handle malformed JSON in data field gracefully', async () => {
      // This test covers the catch block at lines 501-504 in handleAiOnlyMode
      // We pass malformed JSON directly to handleAiOnlyMode (bypassing getModeFromData)
      context.data = '{invalid json}';

      // Mock S3 to return valid status.json (since scrapeJobId will be null from malformed data)
      const statusJsonBuffer = Buffer.from(JSON.stringify({ scrapeJobId: 'test-scrape-job' }));
      mockS3Client.send.resolves({
        Body: {
          transformToString: sandbox.stub().resolves(statusJsonBuffer.toString()),
        },
      });

      const result = await handleAiOnlyMode(context);

      // Should complete successfully despite malformed JSON
      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(result.opportunityId).to.equal('opportunity-123');

      // Verify that opportunityId and scrapeJobId were null after parse error
      // and scrapeJobId was fetched from S3
      expect(mockS3Client.send).to.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/scrapeJobId not provided, fetching from status.json/),
      );
    });

    it('should handle malformed JSON with provided scrapeJobId in object form', async () => {
      // Edge case: data is an object but opportunityId parsing would fail
      // (though this is unlikely in practice)
      context.data = { scrapeJobId: 'test-scrape-job' }; // No opportunityId

      const result = await handleAiOnlyMode(context);

      // Should find latest opportunity since opportunityId is undefined
      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(mockDataAccess.Opportunity.allBySiteIdAndStatus).to.have.been.calledWith(
        'site-123',
        'NEW',
      );
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Found latest NEW opportunity/),
      );
    });

    it('should use fallback auditId when opportunity has no auditId', async () => {
      // Test the fallback: opportunity.getAuditId() || `prerender-ai-only-${siteId}`
      // This covers old opportunities or test data without auditId
      mockOpportunity.getAuditId.returns(null); // No auditId

      const result = await handleAiOnlyMode(context);

      // Should complete successfully using the fallback auditId
      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only');
      expect(result.opportunityId).to.equal('opportunity-123');

      // Verify the SQS message was sent (the fallback auditId was used internally)
      expect(mockSqs.sendMessage).to.have.been.calledOnce;
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Successfully queued AI summary request for 2 suggestion/),
      );
    });
  });

  describe('mode:ai-only-current — scopes to current-tab suggestions', () => {
    beforeEach(() => {
      context.data = JSON.stringify({
        mode: 'ai-only-current',
        scrapeJobId: 'test-scrape-job',
      });

      const suggestions = [
        {
          getId: sandbox.stub().returns('s-current'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/current', scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-covered'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/covered', coveredByDomainWide: true, scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-deployed'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/deployed', edgeDeployed: true, scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-pattern'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/pattern', coveredByPattern: true, scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-fixed'),
          getStatus: sandbox.stub().returns('FIXED'),
          getData: sandbox.stub().returns({ url: 'https://example.com/fixed', scrapeJobId: 'test-scrape-job' }),
        },
      ];
      mockOpportunity.getSuggestions.resolves(suggestions);
    });

    it('should trigger ai-only-current via importTopPages', async () => {
      const result = await importTopPages(context);
      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only-current');
      expect(result.fullAuditRef).to.equal('ai-only-current/opportunity-123');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Scoping to 1 URLs from DB suggestions \(mode=ai-only-current\)/),
      );
    });

    it('should skip step 2 for ai-only-current', async () => {
      const result = await submitForScraping(context);
      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only-current');
    });

    it('should skip step 3 for ai-only-current', async () => {
      const result = await processContentAndGenerateOpportunities(context);
      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only-current');
    });
  });

  describe('mode:ai-only-missing — scopes to suggestions without AI summary', () => {
    beforeEach(() => {
      context.data = JSON.stringify({
        mode: 'ai-only-missing',
        scrapeJobId: 'test-scrape-job',
      });

      const suggestions = [
        {
          getId: sandbox.stub().returns('s-no-summary'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/no-summary', scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-has-summary'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/has-summary', aiSummary: 'some text', scrapeJobId: 'test-scrape-job' }),
        },
        {
          getId: sandbox.stub().returns('s-fixed-missing'),
          getStatus: sandbox.stub().returns('FIXED'),
          getData: sandbox.stub().returns({ url: 'https://example.com/fixed-missing', scrapeJobId: 'test-scrape-job' }),
        },
      ];
      mockOpportunity.getSuggestions.resolves(suggestions);
    });

    it('should trigger ai-only-missing via importTopPages', async () => {
      const result = await importTopPages(context);
      expect(result.status).to.equal('complete');
      expect(result.mode).to.equal('ai-only-missing');
      expect(result.fullAuditRef).to.equal('ai-only-missing/opportunity-123');
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/Scoping to 2 URLs from DB suggestions \(mode=ai-only-missing\)/),
      );
    });

    it('should skip step 2 for ai-only-missing', async () => {
      const result = await submitForScraping(context);
      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only-missing');
    });

    it('should skip step 3 for ai-only-missing', async () => {
      const result = await processContentAndGenerateOpportunities(context);
      expect(result.status).to.equal('skipped');
      expect(result.mode).to.equal('ai-only-missing');
    });
  });

  describe('mode:ai-only-current — returns early when no suggestions match', () => {
    it('should return complete with 0 suggestions when all are filtered out', async () => {
      context.data = JSON.stringify({
        mode: 'ai-only-current',
        scrapeJobId: 'test-scrape-job',
      });

      const suggestions = [
        {
          getId: sandbox.stub().returns('s-covered'),
          getStatus: sandbox.stub().returns('NEW'),
          getData: sandbox.stub().returns({ url: 'https://example.com/covered', coveredByDomainWide: true }),
        },
      ];
      mockOpportunity.getSuggestions.resolves(suggestions);

      const result = await handleAiOnlyMode(context);
      expect(result.status).to.equal('complete');
      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No suggestions match mode=ai-only-current/),
      );
    });
  });
});

