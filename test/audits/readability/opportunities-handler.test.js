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

describe('Readability Opportunities Handler', () => {
  let processImportStep;
  let scrapeReadabilityData;
  let processReadabilityOpportunities;
  let mockSite;
  let mockLog;
  let mockDataAccess;
  let mockS3Client;
  let mockAudit;
  let mockEnv;
  let mockConvertToOpportunity;
  let mockSyncSuggestions;
  let mockAnalyzePageReadability;
  let mockSendReadabilityToMystique;

  beforeEach(async () => {
    mockLog = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
      debug: sinon.stub(),
    };

    mockSite = {
      getId: sinon.stub().returns('site-123'),
      getBaseURL: sinon.stub().returns('https://example.com'),
    };

    mockAudit = {
      getId: sinon.stub().returns('audit-456'),
    };

    mockEnv = {
      S3_SCRAPER_BUCKET_NAME: 'test-bucket',
    };

    mockS3Client = {};

    mockDataAccess = {
      SiteTopPage: {
        allBySiteIdAndSourceAndGeo: sinon.stub(),
      },
    };

    mockConvertToOpportunity = sinon.stub();
    mockSyncSuggestions = sinon.stub();
    mockAnalyzePageReadability = sinon.stub();
    mockSendReadabilityToMystique = sinon.stub();

    const handler = await esmock(
      '../../../src/readability/opportunities/handler.js',
      {
        '../../../src/common/opportunity.js': {
          convertToOpportunity: mockConvertToOpportunity,
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: mockSyncSuggestions,
        },
        '../../../src/readability/shared/analysis-utils.js': {
          analyzePageReadability: mockAnalyzePageReadability,
          sendReadabilityToMystique: mockSendReadabilityToMystique,
        },
      },
    );

    processImportStep = handler.processImportStep;
    scrapeReadabilityData = handler.scrapeReadabilityData;
    processReadabilityOpportunities = handler.processReadabilityOpportunities;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('processImportStep (lines 30-41)', () => {
    it('should return import step data with correct structure', async () => {
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com/page',
      };

      const result = await processImportStep(context);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com/page' },
        fullAuditRef: 'scrapes/site-123/',
        type: 'top-pages',
        siteId: 'site-123',
        allowCache: true,
      });
    });

    it('should use site.getId() for s3BucketPath', async () => {
      mockSite.getId.returns('different-site-id');
      const context = {
        site: mockSite,
        finalUrl: 'https://test.com',
      };

      const result = await processImportStep(context);

      expect(result.fullAuditRef).to.equal('scrapes/different-site-id/');
      expect(result.siteId).to.equal('different-site-id');
    });
  });

  describe('scrapeReadabilityData (lines 45-97)', () => {
    it('should return error when S3 bucket is not configured (lines 51-58)', async () => {
      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: {}, // No bucket name
        dataAccess: mockDataAccess,
      };

      const result = await scrapeReadabilityData(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for readability audit',
      });
      expect(mockLog.error).to.have.been.calledWith(
        '[ReadabilityProcessingError] Missing S3 bucket configuration for readability audit',
      );
    });

    it('should return NO_OPPORTUNITIES when no top pages found (lines 68-74)', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: mockEnv,
        dataAccess: mockDataAccess,
      };

      const result = await scrapeReadabilityData(context);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      });
      expect(mockLog.info).to.have.been.calledWith(
        '[ReadabilityAudit] No top pages found for site site-123 (https://example.com), skipping audit',
      );
    });

    it('should return NO_OPPORTUNITIES when top pages is null (lines 68-74)', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(null);

      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: mockEnv,
        dataAccess: mockDataAccess,
      };

      const result = await scrapeReadabilityData(context);

      expect(result.status).to.equal('NO_OPPORTUNITIES');
    });

    it('should return scrape request with sorted top pages (lines 77-96)', async () => {
      const topPages = [
        { getUrl: () => 'https://example.com/page1', getTraffic: () => 100, getId: () => 'page-1' },
        { getUrl: () => 'https://example.com/page2', getTraffic: () => 500, getId: () => 'page-2' },
        { getUrl: () => 'https://example.com/page3', getTraffic: () => 200, getId: () => 'page-3' },
      ];
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: mockEnv,
        dataAccess: mockDataAccess,
      };

      const result = await scrapeReadabilityData(context);

      expect(result.auditResult.status).to.equal('SCRAPING_REQUESTED');
      expect(result.auditResult.message).to.equal('Content scraping for readability audit initiated.');
      // Verify sorted by traffic descending
      expect(result.urls[0].traffic).to.equal(500);
      expect(result.urls[0].url).to.equal('https://example.com/page2');
      expect(result.urls[1].traffic).to.equal(200);
      expect(result.urls[2].traffic).to.equal(100);
      expect(result.siteId).to.equal('site-123');
      expect(result.jobId).to.equal('site-123');
      expect(result.processingType).to.equal('default');
      expect(result.fullAuditRef).to.equal('https://example.com');
    });

    it('should call SiteTopPage with correct parameters (line 64)', async () => {
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: mockEnv,
        dataAccess: mockDataAccess,
      };

      await scrapeReadabilityData(context);

      expect(mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo).to.have.been.calledWith(
        'site-123',
        'ahrefs',
        'global',
      );
    });

    it('should log found top pages count (line 66)', async () => {
      const topPages = [
        { getUrl: () => 'https://example.com/page1', getTraffic: () => 100, getId: () => 'page-1' },
      ];
      mockDataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(topPages);

      const context = {
        site: mockSite,
        log: mockLog,
        finalUrl: 'https://example.com',
        env: mockEnv,
        dataAccess: mockDataAccess,
      };

      await scrapeReadabilityData(context);

      expect(mockLog.info).to.have.been.calledWith(
        '[ReadabilityAudit] Found 1 top pages for site https://example.com',
      );
    });
  });

  describe('processReadabilityOpportunities (lines 101-215)', () => {
    // Sample scrapeResultPaths to use in tests
    const mockScrapeResultPaths = new Map([
      ['https://example.com/page1', 'scrapes/site-123/page1.json'],
      ['https://example.com/page2', 'scrapes/site-123/page2.json'],
    ]);

    it('should return error when S3 bucket is not configured (lines 107-114)', async () => {
      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: {}, // No bucket name
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for readability audit',
      });
      expect(mockLog.error).to.have.been.calledWith(
        '[ReadabilityProcessingError] Missing S3 bucket configuration for readability audit',
      );
    });

    it('should return NO_OPPORTUNITIES when readability analysis fails (lines 127-133)', async () => {
      mockAnalyzePageReadability.resolves({
        success: false,
        message: 'No scraped content found',
      });

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No scraped content found',
      });
      expect(mockLog.error).to.have.been.calledWith(
        '[ReadabilityAudit][ReadabilityProcessingError] No readability issues found for site site-123 (https://example.com): No scraped content found',
      );
    });

    it('should process readability issues and create opportunity (lines 135-180)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'This is some long text content for testing purposes.',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
        {
          pageUrl: 'https://example.com/page2',
          textContent: 'Another text content block.',
          readabilityScore: 20,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 2,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 2,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(result.opportunitiesFound).to.equal(2);
      expect(result.urlsProcessed).to.equal(2);
      expect(mockConvertToOpportunity).to.have.been.called;
      expect(mockSyncSuggestions).to.have.been.called;

      // Verify syncSuggestions was called with correct data structure
      const syncCall = mockSyncSuggestions.firstCall.args[0];
      expect(syncCall.opportunity).to.equal(mockOpportunity);
      expect(syncCall.newData).to.have.length(2);
      expect(syncCall.newData[0].textPreview).to.equal('This is some long text content for testing purposes.');
    });

    it('should handle Mystique error gracefully and continue (lines 194-197)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Test content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.rejects(new Error('Mystique service unavailable'));

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      // Should succeed despite Mystique error
      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(mockLog.error).to.have.been.calledWith(
        sinon.match(/Error sending readability issues to Mystique/),
        sinon.match.any,
      );
    });

    it('should return NO_OPPORTUNITIES when no issues found (line 203)', async () => {
      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues: [],
        urlsProcessed: 5,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      expect(result.status).to.equal('NO_OPPORTUNITIES');
      expect(result.opportunitiesFound).to.equal(0);
      expect(result.urlsProcessed).to.equal(5);
      // Should not call Mystique when no issues
      expect(mockSendReadabilityToMystique).not.to.have.been.called;
    });

    it('should handle processing errors with catch block (lines 208-214)', async () => {
      mockAnalyzePageReadability.rejects(new Error('S3 connection failed'));

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      const result = await processReadabilityOpportunities(context);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'S3 connection failed',
      });
      expect(mockLog.error).to.have.been.calledWith(
        '[ReadabilityAudit][ReadabilityProcessingError] Error processing readability data for site site-123 (https://example.com): S3 connection failed',
        sinon.match.any,
      );
    });

    it('should truncate textContent in textPreview to 500 chars (line 162)', async () => {
      const longText = 'A'.repeat(600);
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: longText,
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      const syncCall = mockSyncSuggestions.firstCall.args[0];
      expect(syncCall.newData[0].textPreview).to.have.length(500);
      // textContent should not be in the data
      expect(syncCall.newData[0]).to.not.have.property('textContent');
    });

    it('should pass correct mode to sendReadabilityToMystique (line 191)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Test content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      expect(mockSendReadabilityToMystique).to.have.been.calledWith(
        'https://example.com',
        readabilityIssues,
        'site-123',
        'audit-456',
        context,
        'opportunity',
      );
    });

    it('should call analyzePageReadability with correct params (lines 120-125)', async () => {
      mockAnalyzePageReadability.resolves({
        success: false,
        message: 'No content',
      });

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      expect(mockAnalyzePageReadability).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        mockScrapeResultPaths,
        mockLog,
      );
    });

    it('should log success message after sending to Mystique (line 193)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Test content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
        {
          pageUrl: 'https://example.com/page2',
          textContent: 'More content',
          readabilityScore: 22,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 2,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 2,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
        ['https://example.com/page2', 'scraped/page2.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      expect(mockLog.info).to.have.been.calledWith(
        '[ReadabilityAudit] Successfully sent 2 readability issues to Mystique for AI processing',
      );
    });

    it('should generate correct suggestion IDs and buildKey (lines 161, 167)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Short text preview content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      const syncCall = mockSyncSuggestions.firstCall.args[0];
      expect(syncCall.newData[0].id).to.equal('readability-site-123-0');

      // Test buildKey function
      const buildKey = syncCall.buildKey;
      const testData = { pageUrl: 'https://test.com', textPreview: 'preview text' };
      expect(buildKey(testData)).to.equal('https://test.com|preview text');
    });

    it('should call convertToOpportunity with correct parameters (lines 138-148)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 3,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      expect(mockConvertToOpportunity).to.have.been.calledWith(
        'https://example.com',
        { siteId: 'site-123', id: 'audit-456' },
        context,
        sinon.match.func,
        sinon.match.string,
        { totalIssues: 1, urlsProcessed: 3 },
      );
    });

    it('should format scrapedAt as ISO string (line 160)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Content',
          readabilityScore: 25,
          scrapedAt: new Date('2025-06-15T10:30:00.000Z'),
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-789'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      const syncCall = mockSyncSuggestions.firstCall.args[0];
      expect(syncCall.newData[0].scrapedAt).to.equal('2025-06-15T10:30:00.000Z');
    });

    it('should pass mapNewSuggestion that returns correct suggestion DTO structure (lines 174-179)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Test content for suggestion mapping',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 5,
          selector: 'p.content',
          fleschReadingEase: 25,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opportunity-abc-123'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      // Capture the mapNewSuggestion function from syncSuggestions call
      const syncCall = mockSyncSuggestions.firstCall.args[0];
      const { mapNewSuggestion } = syncCall;

      // Test the mapNewSuggestion callback with sample data
      const testData = {
        pageUrl: 'https://example.com/test',
        textPreview: 'Sample text preview',
        rank: 3,
        selector: 'div.article p',
        fleschReadingEase: 28,
      };

      const result = mapNewSuggestion(testData);

      // Verify the structure matches lines 174-179
      expect(result).to.deep.equal({
        opportunityId: 'opportunity-abc-123',
        type: 'CONTENT_UPDATE',
        rank: 3,
        data: testData,
      });
    });

    it('should mapNewSuggestion use rank from data object (lines 175-178)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opp-id'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      const syncCall = mockSyncSuggestions.firstCall.args[0];
      const { mapNewSuggestion } = syncCall;

      // Test with different rank values
      const dataWithRank10 = { rank: 10, pageUrl: 'url1' };
      const dataWithRank1 = { rank: 1, pageUrl: 'url2' };
      const dataWithUndefinedRank = { pageUrl: 'url3' };

      expect(mapNewSuggestion(dataWithRank10).rank).to.equal(10);
      expect(mapNewSuggestion(dataWithRank1).rank).to.equal(1);
      expect(mapNewSuggestion(dataWithUndefinedRank).rank).to.be.undefined;
    });

    it('should mapNewSuggestion include entire data object in data field (line 178)', async () => {
      const readabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          textContent: 'Content',
          readabilityScore: 25,
          scrapedAt: '2025-01-01T00:00:00.000Z',
          rank: 1,
        },
      ];

      mockAnalyzePageReadability.resolves({
        success: true,
        readabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sinon.stub().returns('opp-id'),
      };
      mockConvertToOpportunity.resolves(mockOpportunity);
      mockSyncSuggestions.resolves();
      mockSendReadabilityToMystique.resolves();

      const mockScrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);

      const context = {
        site: mockSite,
        log: mockLog,
        s3Client: mockS3Client,
        env: mockEnv,
        audit: mockAudit,
        scrapeResultPaths: mockScrapeResultPaths,
      };

      await processReadabilityOpportunities(context);

      const syncCall = mockSyncSuggestions.firstCall.args[0];
      const { mapNewSuggestion } = syncCall;

      // Test that entire data object is passed through
      const complexData = {
        pageUrl: 'https://example.com/complex',
        textPreview: 'Complex text preview with lots of data',
        rank: 7,
        selector: 'article > p:nth-child(2)',
        fleschReadingEase: 22,
        scrapedAt: '2025-06-01T12:00:00.000Z',
        id: 'readability-site-123-5',
        customField: 'extra data',
      };

      const result = mapNewSuggestion(complexData);

      // Verify data field contains the entire input object
      expect(result.data).to.deep.equal(complexData);
      expect(result.data.pageUrl).to.equal('https://example.com/complex');
      expect(result.data.textPreview).to.equal('Complex text preview with lots of data');
      expect(result.data.selector).to.equal('article > p:nth-child(2)');
      expect(result.data.customField).to.equal('extra data');
    });
  });
});
