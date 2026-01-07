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
import {
  importTopPages,
  submitForScraping,
  processContentAndGenerateOpportunities,
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
        }),
        getStatus: sandbox.stub().returns('NEW'),
      },
      {
        getId: sandbox.stub().returns('suggestion-2'),
        getData: sandbox.stub().returns({
          url: 'https://example.com/page2',
          isDomainWide: false,
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
        info: sandbox.stub(),
        warn: sandbox.stub(),
        error: sandbox.stub(),
      },
      site: {
        getId: sandbox.stub().returns('site-123'),
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getDeliveryType: sandbox.stub().returns('aem_edge'),
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
        sinon.match(/status.json not found/),
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
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Error fetching status.json: S3 connection timeout/),
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
      expect(context.log.warn).to.have.been.calledWith(
        sinon.match(/No existing suggestions found/),
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
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.data.suggestions).to.have.lengthOf(1);
      expect(message.data.suggestions[0].url).to.equal('https://example.com/page2');
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

    it('should return 0 if all suggestions are filtered out', async () => {
      mockSuggestions[0].getStatus.returns('OUTDATED');
      mockSuggestions[1].getData.returns({ url: null });

      const result = await importTopPages(context);

      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.info).to.have.been.calledWith(
        sinon.match(/No eligible suggestions to send to Mystique/),
      );
    });


    it('should handle missing getDeliveryType method', async () => {
      context.site.getDeliveryType = undefined;

      const result = await importTopPages(context);

      expect(result.status).to.equal('complete');
      const message = mockSqs.sendMessage.getCall(0).args[1];
      expect(message.deliveryType).to.equal('unknown');
    });

    it('should handle missing getData method on suggestion', async () => {
      mockSuggestions[0].getData = undefined;

      const result = await importTopPages(context);

      // Should skip suggestion without getData
      expect(result.auditResult.suggestionCount).to.equal(1);
    });

    it('should handle missing getStatus method on suggestion', async () => {
      mockSuggestions[0].getStatus = undefined;

      const result = await importTopPages(context);

      // Should include suggestion if getStatus is missing (defaults to not OUTDATED)
      expect(result.auditResult.suggestionCount).to.equal(2);
    });

    it('should handle missing getId method on suggestion', async () => {
      mockSuggestions[0].getId = undefined;

      const result = await importTopPages(context);

      // Should still process suggestion
      expect(result.status).to.equal('complete');
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
  });

  describe('sendPrerenderGuidanceRequestToMystique error handling', () => {
    it('should return success with 0 suggestions when SQS sendMessage fails', async () => {
      // sendPrerenderGuidanceRequestToMystique catches errors and returns 0
      // So the overall flow succeeds but with 0 suggestions sent
      mockSqs.sendMessage.rejects(new Error('SQS network error'));

      const result = await importTopPages(context);

      // SQS error is caught internally, returns 0 suggestions
      expect(result.status).to.equal('complete');
      expect(result.auditResult.suggestionCount).to.equal(0);
      expect(context.log.error).to.have.been.calledWith(
        sinon.match(/Failed to send guidance:prerender message/),
      );
    });
  });
});

