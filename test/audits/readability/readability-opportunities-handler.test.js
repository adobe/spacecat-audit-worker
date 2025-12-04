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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Readability Opportunities Handler Tests', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockS3Client;
  let mockAudit;
  let processImportStep;
  let scrapeReadabilityData;
  let processReadabilityOpportunities;
  let analyzePageReadabilityStub;
  let sendReadabilityToMystiqueStub;
  let convertToOpportunityStub;
  let syncSuggestionsStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock site
    mockSite = {
      getId: sandbox.stub().returns('test-site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().resolves(null),
    };

    // Mock audit
    mockAudit = {
      getId: sandbox.stub().returns('test-audit-id'),
    };

    // Mock S3 client
    mockS3Client = {};

    // Create mock context
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        finalUrl: 'https://example.com',
        s3Client: mockS3Client,
        audit: mockAudit,
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
          },
          SiteTopPage: {
            allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]),
          },
        },
      })
      .build();

    // Mock the dependencies
    analyzePageReadabilityStub = sandbox.stub();
    sendReadabilityToMystiqueStub = sandbox.stub();
    convertToOpportunityStub = sandbox.stub();
    syncSuggestionsStub = sandbox.stub();

    const handlerModule = await esmock(
      '../../../src/readability/opportunities/handler.js',
      {
        '../../../src/readability/shared/analysis-utils.js': {
          analyzePageReadability: analyzePageReadabilityStub,
          sendReadabilityToMystique: sendReadabilityToMystiqueStub,
        },
        '../../../src/common/opportunity.js': {
          convertToOpportunity: convertToOpportunityStub,
        },
        '../../../src/utils/data-access.js': {
          syncSuggestions: syncSuggestionsStub,
        },
      },
    );

    processImportStep = handlerModule.processImportStep;
    scrapeReadabilityData = handlerModule.scrapeReadabilityData;
    processReadabilityOpportunities = handlerModule.processReadabilityOpportunities;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('processImportStep', () => {
    it('should return correct import step configuration', async () => {
      const result = await processImportStep(mockContext);

      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: 'scrapes/test-site-id/',
        type: 'top-pages',
        siteId: 'test-site-id',
        allowCache: true,
      });
    });
  });

  describe('scrapeReadabilityData', () => {
    it('should return error when S3 bucket configuration is missing', async () => {
      mockContext.env.S3_SCRAPER_BUCKET_NAME = undefined;

      const result = await scrapeReadabilityData(mockContext);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for readability audit',
      });
      expect(mockContext.log.error).to.have.been.calledWith(
        '[ReadabilityProcessingError] Missing S3 bucket configuration for readability audit',
      );
    });

    it('should return NO_OPPORTUNITIES when no top pages found', async () => {
      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves([]);

      const result = await scrapeReadabilityData(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      });
      expect(mockContext.log.info).to.have.been.calledWith(
        '[ReadabilityAudit] No top pages found for site test-site-id (https://example.com), skipping audit',
      );
    });

    it('should return NO_OPPORTUNITIES when top pages is null', async () => {
      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(null);

      const result = await scrapeReadabilityData(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      });
    });

    it('should successfully initiate scraping for top pages', async () => {
      const mockTopPages = [
        { getUrl: () => 'https://example.com/page1', getTraffic: () => 500, getId: () => 'page1-id' },
        { getUrl: () => 'https://example.com/page2', getTraffic: () => 1000, getId: () => 'page2-id' },
        { getUrl: () => 'https://example.com/page3', getTraffic: () => 200, getId: () => 'page3-id' },
      ];
      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);

      const result = await scrapeReadabilityData(mockContext);

      expect(result.auditResult.status).to.equal('SCRAPING_REQUESTED');
      expect(result.auditResult.message).to.equal('Content scraping for readability audit initiated.');
      expect(result.siteId).to.equal('test-site-id');
      expect(result.jobId).to.equal('test-site-id');
      expect(result.processingType).to.equal('default');

      // Verify URLs are sorted by traffic descending
      expect(result.urls[0].traffic).to.equal(1000);
      expect(result.urls[1].traffic).to.equal(500);
      expect(result.urls[2].traffic).to.equal(200);
    });

    it('should limit top pages to TOP_PAGES_LIMIT', async () => {
      // Create more than TOP_PAGES_LIMIT pages
      const mockTopPages = Array.from({ length: 100 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i}`,
        getTraffic: () => 1000 - i,
        getId: () => `page${i}-id`,
      }));
      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);

      const result = await scrapeReadabilityData(mockContext);

      // Should be limited to TOP_PAGES_LIMIT (typically 25)
      expect(result.urls.length).to.be.at.most(25);
    });
  });

  describe('processReadabilityOpportunities', () => {
    beforeEach(() => {
      mockContext.scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
      ]);
    });

    it('should return error when S3 bucket configuration is missing', async () => {
      mockContext.env.S3_SCRAPER_BUCKET_NAME = undefined;

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for readability audit',
      });
    });

    it('should return NO_OPPORTUNITIES when scrapeResultPaths is empty Map', async () => {
      mockContext.scrapeResultPaths = new Map();

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No scrape result paths available',
      });
    });

    it('should return NO_OPPORTUNITIES when scrapeResultPaths is undefined', async () => {
      mockContext.scrapeResultPaths = undefined;

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No scrape result paths available',
      });
    });

    it('should return NO_OPPORTUNITIES when scrapeResultPaths has size 0', async () => {
      mockContext.scrapeResultPaths = { size: 0 };

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No scrape result paths available',
      });
    });

    it('should return NO_OPPORTUNITIES when analysis finds no issues', async () => {
      analyzePageReadabilityStub.resolves({
        success: false,
        message: 'No readability issues found',
        readabilityIssues: [],
        urlsProcessed: 1,
      });

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No readability issues found',
      });
    });

    it('should successfully process readability opportunities', async () => {
      const mockReadabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: '2025-01-01T00:00:00Z',
          selector: 'p.content',
          textContent: 'Complex epistemological ramifications necessitate comprehensive analysis.',
          fleschReadingEase: 15.5,
          language: 'english',
          traffic: 1000,
          rank: 25.5,
          category: 'Critical',
          seoImpact: 'High',
        },
      ];

      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 1 readability issues',
        readabilityIssues: mockReadabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();
      sendReadabilityToMystiqueStub.resolves();

      const result = await processReadabilityOpportunities(mockContext);

      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(result.opportunitiesFound).to.equal(1);
      expect(result.urlsProcessed).to.equal(1);
      expect(result.summary).to.equal('Found 1 readability issues across 1 URLs');

      expect(convertToOpportunityStub).to.have.been.calledOnce;
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      expect(sendReadabilityToMystiqueStub).to.have.been.calledOnce;
    });

    it('should continue without failing when Mystique call fails', async () => {
      const mockReadabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: '2025-01-01T00:00:00Z',
          selector: 'p.content',
          textContent: 'Complex text here.',
          fleschReadingEase: 15.5,
          language: 'english',
          traffic: 1000,
          rank: 25.5,
          category: 'Critical',
          seoImpact: 'High',
        },
      ];

      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 1 readability issues',
        readabilityIssues: mockReadabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();
      sendReadabilityToMystiqueStub.rejects(new Error('Mystique connection failed'));

      const result = await processReadabilityOpportunities(mockContext);

      // Should still succeed despite Mystique error
      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error sending readability issues to Mystique/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should return NO_OPPORTUNITIES when no issues found after successful analysis', async () => {
      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 0 readability issues',
        readabilityIssues: [],
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();

      const result = await processReadabilityOpportunities(mockContext);

      expect(result.status).to.equal('NO_OPPORTUNITIES');
      expect(result.opportunitiesFound).to.equal(0);
    });

    it('should handle errors during processing and return PROCESSING_FAILED', async () => {
      analyzePageReadabilityStub.rejects(new Error('Processing error'));

      const result = await processReadabilityOpportunities(mockContext);

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Processing error',
      });
      expect(mockContext.log.error).to.have.been.calledWith(
        sinon.match(/Error processing readability data/),
        sinon.match.instanceOf(Error),
      );
    });

    it('should correctly map suggestion data with textPreview truncation', async () => {
      const longTextContent = 'A'.repeat(600); // More than 500 characters
      const mockReadabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: '2025-01-01T00:00:00Z',
          selector: 'p.content',
          textContent: longTextContent,
          fleschReadingEase: 15.5,
          language: 'english',
          traffic: 1000,
          rank: 25.5,
          category: 'Critical',
          seoImpact: 'High',
        },
      ];

      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 1 readability issues',
        readabilityIssues: mockReadabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();
      sendReadabilityToMystiqueStub.resolves();

      await processReadabilityOpportunities(mockContext);

      // Verify syncSuggestions was called with correct data
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncCall = syncSuggestionsStub.getCall(0);
      const { newData } = syncCall.args[0];

      // textPreview should be truncated to 500 characters
      expect(newData[0].textPreview.length).to.equal(500);
      // textContent should be removed from suggestion data
      expect(newData[0].textContent).to.be.undefined;
    });

    it('should correctly call mapNewSuggestion callback', async () => {
      const mockReadabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: '2025-01-01T00:00:00Z',
          selector: 'p.content',
          textContent: 'Complex text here.',
          fleschReadingEase: 15.5,
          language: 'english',
          traffic: 1000,
          rank: 25.5,
          category: 'Critical',
          seoImpact: 'High',
        },
      ];

      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 1 readability issues',
        readabilityIssues: mockReadabilityIssues,
        urlsProcessed: 1,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('test-opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();
      sendReadabilityToMystiqueStub.resolves();

      await processReadabilityOpportunities(mockContext);

      // Verify syncSuggestions was called and test mapNewSuggestion callback
      expect(syncSuggestionsStub).to.have.been.calledOnce;
      const syncCall = syncSuggestionsStub.getCall(0);
      const { mapNewSuggestion } = syncCall.args[0];

      // Call the mapNewSuggestion callback to test coverage
      const testData = { rank: 10.5, pageUrl: 'https://test.com' };
      const result = mapNewSuggestion(testData);

      expect(result).to.deep.equal({
        opportunityId: 'test-opp-id',
        type: 'CONTENT_UPDATE',
        rank: 10.5,
        data: testData,
      });
    });

    it('should process multiple readability issues correctly', async () => {
      const mockReadabilityIssues = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: '2025-01-01T00:00:00Z',
          selector: 'p.content1',
          textContent: 'First complex text.',
          fleschReadingEase: 15.5,
          language: 'english',
          traffic: 1000,
          rank: 25.5,
          category: 'Critical',
          seoImpact: 'High',
        },
        {
          pageUrl: 'https://example.com/page2',
          scrapedAt: '2025-01-02T00:00:00Z',
          selector: 'p.content2',
          textContent: 'Second complex text.',
          fleschReadingEase: 20.0,
          language: 'english',
          traffic: 500,
          rank: 20.0,
          category: 'Important',
          seoImpact: 'Moderate',
        },
      ];

      analyzePageReadabilityStub.resolves({
        success: true,
        message: 'Found 2 readability issues',
        readabilityIssues: mockReadabilityIssues,
        urlsProcessed: 2,
      });

      const mockOpportunity = {
        getId: sandbox.stub().returns('opp-id'),
      };
      convertToOpportunityStub.resolves(mockOpportunity);
      syncSuggestionsStub.resolves();
      sendReadabilityToMystiqueStub.resolves();

      const result = await processReadabilityOpportunities(mockContext);

      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(result.opportunitiesFound).to.equal(2);
      expect(result.urlsProcessed).to.equal(2);
    });

    it('should pass scrapeResultPaths to analyzePageReadability', async () => {
      const scrapeResultPaths = new Map([
        ['https://example.com/page1', 'scraped/page1.json'],
        ['https://example.com/page2', 'scraped/page2.json'],
      ]);
      mockContext.scrapeResultPaths = scrapeResultPaths;

      analyzePageReadabilityStub.resolves({
        success: false,
        message: 'No readability issues found',
        readabilityIssues: [],
        urlsProcessed: 2,
      });

      await processReadabilityOpportunities(mockContext);

      expect(analyzePageReadabilityStub).to.have.been.calledOnce;
      expect(analyzePageReadabilityStub).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        scrapeResultPaths,
        mockContext.log,
      );
    });
  });
});

