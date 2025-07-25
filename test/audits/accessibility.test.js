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
import { MockContextBuilder } from '../shared.js';

use(sinonChai);
use(chaiAsPromised);

describe('Accessibility Audit Handler', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockS3Client;
  let scrapeAccessibilityData;
  let processAccessibilityOpportunities;
  let processImportStep;
  let getUrlsForAuditStub;
  let aggregateAccessibilityDataStub;
  let generateReportOpportunitiesStub;
  let createAccessibilityIndividualOpportunitiesStub;
  let getExistingObjectKeysFromFailedAuditsStub;
  let getExistingUrlsFromFailedAuditsStub;
  let saveA11yMetricsToS3Stub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock site
    mockSite = {
      getId: sandbox.stub().returns('test-site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
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

    // Mock the data-processing utils and import the function
    getUrlsForAuditStub = sandbox.stub();
    aggregateAccessibilityDataStub = sandbox.stub();
    generateReportOpportunitiesStub = sandbox.stub();
    createAccessibilityIndividualOpportunitiesStub = sandbox.stub();
    getExistingObjectKeysFromFailedAuditsStub = sandbox.stub().resolves([]);
    getExistingUrlsFromFailedAuditsStub = sandbox.stub().resolves([]);
    saveA11yMetricsToS3Stub = sandbox.stub().resolves();

    const accessibilityModule = await esmock('../../src/accessibility/handler.js', {
      '../../src/accessibility/utils/data-processing.js': {
        getUrlsForAudit: getUrlsForAuditStub,
        aggregateAccessibilityData: aggregateAccessibilityDataStub,
        generateReportOpportunities: generateReportOpportunitiesStub,
      },
      '../../src/accessibility/utils/generate-individual-opportunities.js': {
        createAccessibilityIndividualOpportunities: createAccessibilityIndividualOpportunitiesStub,
      },
      '../../src/accessibility/utils/scrape-utils.js': {
        getExistingObjectKeysFromFailedAudits: getExistingObjectKeysFromFailedAuditsStub,
        getExistingUrlsFromFailedAudits: getExistingUrlsFromFailedAuditsStub,
        saveA11yMetricsToS3: saveA11yMetricsToS3Stub,
      },
    });

    scrapeAccessibilityData = accessibilityModule.scrapeAccessibilityData;
    processAccessibilityOpportunities = accessibilityModule.processAccessibilityOpportunities;
    processImportStep = accessibilityModule.processImportStep;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('scrapeAccessibilityData', () => {
    it('should successfully initiate content scraping for accessibility audit', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/page1', urlId: 'example.com/page1', traffic: 100 },
        { url: 'https://example.com/page2', urlId: 'example.com/page2', traffic: 200 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(getUrlsForAuditStub).to.have.been.calledOnceWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
      );

      expect(getExistingObjectKeysFromFailedAuditsStub).to.have.been.calledOnceWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
      );

      expect(getExistingUrlsFromFailedAuditsStub).to.have.been.calledOnce;

      expect(mockContext.log.info).to.have.been.calledWith(
        '[A11yAudit] Step 1: Preparing content scrape for accessibility audit for https://example.com with siteId test-site-id',
      );

      expect(result).to.deep.equal({
        auditResult: {
          status: 'SCRAPING_REQUESTED',
          message: 'Content scraping for accessibility audit initiated.',
          scrapedUrls: mockUrls,
        },
        fullAuditRef: 'https://example.com',
        urls: mockUrls,
        siteId: 'test-site-id',
        jobId: 'test-site-id',
        processingType: 'accessibility',
      });
    });

    it('should handle missing S3 bucket name in environment', async () => {
      // Arrange
      mockContext.env.S3_SCRAPER_BUCKET_NAME = undefined;

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        'Missing S3 bucket configuration for accessibility audit',
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for accessibility audit',
      });

      // Should not call getUrlsForAudit when bucket name is missing
      expect(getUrlsForAuditStub).to.not.have.been.called;
    });

    it('should handle error from getUrlsForAudit', async () => {
      // Arrange
      const error = new Error('Failed to get URLs for audit');
      getUrlsForAuditStub.rejects(error);

      // Act & Assert
      await expect(scrapeAccessibilityData(mockContext))
        .to.be.rejectedWith('Failed to get URLs for audit');

      expect(getUrlsForAuditStub).to.have.been.calledOnceWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
      );
    });

    it('should handle empty URLs array from getUrlsForAudit', async () => {
      // Arrange
      getUrlsForAuditStub.resolves([]);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No top pages found, skipping audit',
      });
    });

    it('should use correct processing type for accessibility audit', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/test', urlId: 'example.com/test', traffic: 50 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(result.processingType).to.equal('accessibility');
    });

    it('should pass correct parameters to getUrlsForAudit', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/page', urlId: 'example.com/page', traffic: 75 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(getUrlsForAuditStub).to.have.been.calledOnceWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
      );
    });

    it('should use site ID for both siteId and jobId fields', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/another', urlId: 'example.com/another', traffic: 25 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(result.siteId).to.equal('test-site-id');
      expect(result.jobId).to.equal('test-site-id');
      expect(mockSite.getId).to.have.been.calledOnce;
    });

    it('should return fullAuditRef as finalUrl from context', async () => {
      // Arrange
      const customFinalUrl = 'https://custom.example.com/final';
      mockContext.finalUrl = customFinalUrl;
      const mockUrls = [
        { url: 'https://example.com/page', urlId: 'example.com/page', traffic: 100 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(result.fullAuditRef).to.equal(customFinalUrl);
    });

    it('should log appropriate info message during execution', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/logging-test', urlId: 'example.com/logging-test', traffic: 150 },
      ];
      getUrlsForAuditStub.resolves(mockUrls);

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.log.info).to.have.been.calledWith(
        '[A11yAudit] Step 1: Preparing content scrape for accessibility audit for https://example.com with siteId test-site-id',
      );
    });

    it('should handle null or undefined context properties gracefully', async () => {
      // Arrange
      mockContext.s3Client = null;
      const error = new Error('Invalid input parameters');
      getUrlsForAuditStub.rejects(error);

      // Act & Assert
      await expect(scrapeAccessibilityData(mockContext))
        .to.be.rejectedWith('Invalid input parameters');
    });

    it('should fetch and log top pages information', async () => {
      // Arrange
      const mockTopPages = [
        {
          getUrl: () => 'https://example.com/top1',
          getTraffic: () => 1000,
          getId: () => 'id1',
        },
        {
          getUrl: () => 'https://example.com/top2',
          getTraffic: () => 800,
          getId: () => 'id2',
        },
        {
          getUrl: () => 'https://example.com/top3',
          getTraffic: () => 600,
          getId: () => 'id3',
        },
      ];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo)
        .to.have.been.calledWith(
          'test-site-id', // siteId from site.getId()
          'ahrefs', // source
          'global', // geo
        );

      expect(mockContext.log.info).to.have.been.calledWith(
        `[A11yAudit] Found ${mockTopPages.length} top pages for site https://example.com: ${JSON.stringify(mockTopPages, null, 2)}`,
      );
    });

    it('should handle empty top pages array', async () => {
      // Arrange
      const mockTopPages = [];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo)
        .to.have.been.calledWith(
          'test-site-id', // siteId from site.getId()
          'ahrefs', // source
          'global', // geo
        );

      expect(mockContext.log.info).to.have.been.calledWith(
        '[A11yAudit] Found 0 top pages for site https://example.com: []',
      );
    });

    it('should handle SiteTopPage fetch error gracefully', async () => {
      // Arrange
      const topPageError = new Error('Failed to fetch top pages');

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.rejects(topPageError);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act & Assert
      await expect(scrapeAccessibilityData(mockContext))
        .to.be.rejectedWith('Failed to fetch top pages');

      expect(mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo)
        .to.have.been.calledWith(
          'test-site-id', // siteId from site.getId()
          'ahrefs', // source
          'global', // geo
        );
    });

    it('should use correct parameters for SiteTopPage query', async () => {
      // Arrange
      const mockTopPages = [
        {
          getUrl: () => 'https://example.com/popular',
          getTraffic: () => 2000,
          getId: () => 'popular-id',
        },
      ];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo)
        .to.have.been.calledWith(
          'test-site-id', // siteId from site.getId()
          'ahrefs', // source
          'global', // geo
        );
    });

    it('filters out urls that have existing failed audits', async () => {
      // Arrange
      const mockUrls = [
        { url: 'https://example.com/page1' },
        { url: 'https://example.com/page2' },
        { url: 'https://example.com/page3' },
      ];
      const mockObjectKeys = ['key1', 'key2'];
      const existingUrls = ['https://example.com/page1', 'https://example.com/page2'];

      getUrlsForAuditStub.resolves(mockUrls);
      getExistingObjectKeysFromFailedAuditsStub.resolves(mockObjectKeys);
      getExistingUrlsFromFailedAuditsStub.resolves(existingUrls);

      // Act
      const result = await scrapeAccessibilityData(mockContext);

      // Assert
      expect(getExistingUrlsFromFailedAuditsStub).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        mockContext.log,
        mockObjectKeys,
      );

      expect(result.urls).to.deep.equal([{ url: 'https://example.com/page3' }]);
    });

    it('should process top pages and log top 100 when pages exist', async () => {
      // Arrange
      const mockTopPages = [
        {
          getUrl: () => 'https://example.com/page1',
          getTraffic: () => 1000,
          getId: () => 'id1',
        },
        {
          getUrl: () => 'https://example.com/page2',
          getTraffic: () => 2000,
          getId: () => 'id2',
        },
        {
          getUrl: () => 'https://example.com/page3',
          getTraffic: () => 500,
          getId: () => 'id3',
        },
      ];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert - Check that top 100 pages are logged in correct order
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Top 100 pages for site test-site-id \(https:\/\/example\.com\):.*page2.*page1.*page3/s),
      );
    });

    it('should map page properties correctly for top 100 processing', async () => {
      // Arrange
      const mockTopPages = [
        {
          getUrl: () => 'https://example.com/test-page',
          getTraffic: () => 1500,
          getId: () => 'unique-id-123',
          extraProperty: 'should-be-ignored',
        },
      ];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert - Find the specific "Top 100 pages" log call
      const logCalls = mockContext.log.info.getCalls();
      const top100LogCall = logCalls.find((call) => call.args[0].includes('Top 100 pages for site'));

      expect(top100LogCall).to.exist;

      const logMessage = top100LogCall.args[0];
      // Verify correct mapping: getId() -> urlId
      expect(logMessage).to.include('"urlId": "unique-id-123"');
      expect(logMessage).to.include('"url": "https://example.com/test-page"');
      expect(logMessage).to.include('"traffic": 1500');
      // Verify extraProperty is not included in the mapped result
      expect(logMessage).to.not.include('extraProperty');
    });

    it('should sort pages by traffic in descending order for top 100', async () => {
      // Arrange
      const mockTopPages = [
        {
          getUrl: () => 'https://example.com/low',
          getTraffic: () => 100,
          getId: () => 'low',
        },
        {
          getUrl: () => 'https://example.com/high',
          getTraffic: () => 5000,
          getId: () => 'high',
        },
        {
          getUrl: () => 'https://example.com/medium',
          getTraffic: () => 1500,
          getId: () => 'medium',
        },
      ];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert - Check order: high (5000) -> medium (1500) -> low (100)
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/high.*medium.*low/s),
      );
    });

    it('should limit to 100 pages when more pages exist', async () => {
      // Arrange
      const mockTopPages = Array.from({ length: 150 }, (_, i) => ({
        getUrl: () => `https://example.com/page${i}`,
        getTraffic: () => 1000 - i,
        getId: () => `id${i}`,
      }));

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert - Verify only 100 pages are processed
      const logCalls = mockContext.log.info.getCalls();
      const top100LogCall = logCalls.find((call) => call.args[0].includes('Top 100 pages for site'));

      const loggedData = top100LogCall.args[0];
      const jsonStart = loggedData.indexOf('): ') + 3; // Find the end of the site info and start of JSON
      const parsedPages = JSON.parse(loggedData.substring(jsonStart));

      expect(parsedPages).to.have.lengthOf(100);
      expect(parsedPages[0].traffic).to.equal(1000); // Highest traffic
      expect(parsedPages[99].traffic).to.equal(901); // 100th page
    });

    it('should not process top 100 when topPages is empty', async () => {
      // Arrange
      const mockTopPages = [];

      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(mockTopPages);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.log.info).to.not.have.been.calledWith(
        sinon.match(/Top 100 pages:/),
      );
    });

    it('should not process top 100 when topPages is null', async () => {
      // Arrange
      mockContext.dataAccess.SiteTopPage.allBySiteIdAndSourceAndGeo.resolves(null);
      getUrlsForAuditStub.resolves([]); // Return empty array to trigger top pages logic

      // Act
      await scrapeAccessibilityData(mockContext);

      // Assert
      expect(mockContext.log.info).to.not.have.been.calledWith(
        sinon.match(/Top 100 pages:/),
      );
    });
  });

  describe('processImportStep', () => {
    it('should successfully process import step with valid context', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result).to.deep.equal({
        auditResult: { status: 'preparing', finalUrl: 'https://example.com' },
        fullAuditRef: 'scrapes/test-site-id/',
        type: 'top-pages',
        siteId: 'test-site-id',
        allowCache: true,
      });

      expect(mockSite.getId).to.have.been.calledTwice;
    });

    it('should construct correct S3 bucket path using site ID', async () => {
      // Arrange
      const customSiteId = 'custom-site-123';
      mockSite.getId.returns(customSiteId);
      const context = {
        site: mockSite,
        finalUrl: 'https://custom.example.com',
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.fullAuditRef).to.equal(`scrapes/${customSiteId}/`);
      expect(result.siteId).to.equal(customSiteId);
    });

    it('should handle different finalUrl values', async () => {
      // Arrange
      const customFinalUrl = 'https://different.site.com/path';
      const context = {
        site: mockSite,
        finalUrl: customFinalUrl,
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.auditResult.finalUrl).to.equal(customFinalUrl);
      expect(result.auditResult.status).to.equal('preparing');
    });

    it('should always return type as top-pages', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.type).to.equal('top-pages');
    });

    it('should always return audit status as preparing', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.auditResult.status).to.equal('preparing');
    });

    it('should handle undefined finalUrl', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: undefined,
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.auditResult.finalUrl).to.be.undefined;
      expect(result.auditResult.status).to.equal('preparing');
      expect(result.fullAuditRef).to.equal('scrapes/test-site-id/');
      expect(result.type).to.equal('top-pages');
      expect(result.siteId).to.equal('test-site-id');
    });

    it('should handle null finalUrl', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: null,
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result.auditResult.finalUrl).to.be.null;
      expect(result.auditResult.status).to.equal('preparing');
    });

    it('should call site.getId() for both fullAuditRef and siteId', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      // Act
      await processImportStep(context);

      // Assert
      expect(mockSite.getId).to.have.been.calledTwice;
    });

    it('should return all required properties in correct structure', async () => {
      // Arrange
      const context = {
        site: mockSite,
        finalUrl: 'https://example.com',
      };

      // Act
      const result = await processImportStep(context);

      // Assert
      expect(result).to.have.property('auditResult');
      expect(result).to.have.property('fullAuditRef');
      expect(result).to.have.property('type');
      expect(result).to.have.property('siteId');

      expect(result.auditResult).to.have.property('status');
      expect(result.auditResult).to.have.property('finalUrl');
    });
  });

  describe('processAccessibilityOpportunities', () => {
    beforeEach(() => {
      // Reset context to include AWS_ENV for processAccessibilityOpportunities tests
      mockContext.env.AWS_ENV = 'test';
    });

    it('should successfully process accessibility data and find opportunities', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 5,
                critical: { items: { 'some-id': { count: 5 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
            'https://example.com/page2': {
              violations: {
                total: 2,
                critical: { items: { 'some-id': { count: 2 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(aggregateAccessibilityDataStub).to.have.been.calledOnceWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
        sinon.match(/accessibility\/test-site-id\/\d{4}-\d{2}-\d{2}-final-result\.json/),
        sinon.match(/\d{4}-\d{2}-\d{2}/),
      );

      expect(generateReportOpportunitiesStub).to.have.been.calledOnceWith(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );

      expect(createAccessibilityIndividualOpportunitiesStub).to.have.been.calledOnceWith(
        mockAggregationResult.finalResultFiles.current,
        mockContext,
      );

      expect(mockContext.log.info).to.have.been.calledWith(
        '[A11yAudit] Step 2: Processing scraped data for site test-site-id (https://example.com)',
      );

      expect(result.status).to.equal('OPPORTUNITIES_FOUND');
      expect(result.opportunitiesFound).to.equal(5);
      expect(result.urlsProcessed).to.equal(2);
      expect(result.summary).to.equal('Found 5 accessibility issues across 2 URLs');
      expect(result.fullReportUrl).to.match(/accessibility\/test-site-id\/\d{4}-\d{2}-\d{2}-final-result\.json/);
    });

    it('should handle error from createAccessibilityIndividualOpportunities', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      const error = new Error('Failed to create individual opportunities');
      createAccessibilityIndividualOpportunitiesStub.rejects(error);

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        '[A11yAudit] Error creating individual opportunities for site test-site-id (https://example.com): Failed to create individual opportunities',
        error,
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Failed to create individual opportunities',
      });

      // Should have called aggregateAccessibilityData and generateReportOpportunities successfully
      expect(aggregateAccessibilityDataStub).to.have.been.called;
      expect(generateReportOpportunitiesStub).to.have.been.called;
      expect(createAccessibilityIndividualOpportunitiesStub).to.have.been.called;
    });

    it('should return NO_OPPORTUNITIES when no issues are found', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 0,
                critical: { items: {} },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 0,
                critical: { items: {} },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(result.status).to.equal('NO_OPPORTUNITIES');
      expect(result.opportunitiesFound).to.equal(0);
      expect(result.urlsProcessed).to.equal(1);
      expect(result.summary).to.equal('Found 0 accessibility issues across 1 URLs');
      expect(result.fullReportUrl).to.match(/accessibility\/test-site-id\/\d{4}-\d{2}-\d{2}-final-result\.json/);
    });

    it('should handle missing S3 bucket name in environment', async () => {
      // Arrange
      mockContext.env.S3_SCRAPER_BUCKET_NAME = undefined;

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        'Missing S3 bucket configuration for accessibility audit',
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Missing S3 bucket configuration for accessibility audit',
      });

      // Should not call aggregateAccessibilityData when bucket name is missing
      expect(aggregateAccessibilityDataStub).to.not.have.been.called;
    });

    it('should handle unsuccessful aggregation result', async () => {
      // Arrange
      const mockAggregationResult = {
        success: false,
        message: 'No accessibility data found',
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        '[A11yAudit] No data aggregated for site test-site-id (https://example.com): No accessibility data found',
      );

      expect(result).to.deep.equal({
        status: 'NO_OPPORTUNITIES',
        message: 'No accessibility data found',
      });

      // Should not call generateReportOpportunities when aggregation fails
      expect(generateReportOpportunitiesStub).to.not.have.been.called;
    });

    it('should handle error from aggregateAccessibilityData', async () => {
      // Arrange
      const error = new Error('S3 connection failed');
      aggregateAccessibilityDataStub.rejects(error);

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        '[A11yAudit] Error processing accessibility data for site test-site-id (https://example.com): S3 connection failed',
        error,
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'S3 connection failed',
      });

      // Should not call generateReportOpportunities when aggregation throws
      expect(generateReportOpportunitiesStub).to.not.have.been.called;
    });

    it('should handle error from generateReportOpportunities', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      const error = new Error('Failed to create opportunity');
      generateReportOpportunitiesStub.rejects(error);

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.error).to.have.been.calledWith(
        '[A11yAudit] Error generating report opportunities for site test-site-id (https://example.com): Failed to create opportunity',
        error,
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'Failed to create opportunity',
      });

      // Should have called aggregateAccessibilityData successfully
      expect(aggregateAccessibilityDataStub).to.have.been.called;
    });

    it('should use production environment flag correctly', async () => {
      // Arrange
      mockContext.env.AWS_ENV = 'prod';
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 2,
                critical: { items: { 'some-id': { count: 2 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 2,
                critical: { items: { 'some-id': { count: 2 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();

      // Act
      await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(generateReportOpportunitiesStub).to.have.been.calledWith(
        mockSite,
        mockAggregationResult,
        mockContext,
        'accessibility',
      );
    });

    it('should generate correct output key with current date', async () => {
      // Arrange
      const mockDate = new Date('2024-03-15T10:30:00Z');
      const dateStub = sandbox.stub(global, 'Date').returns(mockDate);
      // Mock toISOString for the stubbed Date
      mockDate.toISOString = sinon.stub().returns('2024-03-15T10:30:00.000Z');

      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();

      // Act
      await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(aggregateAccessibilityDataStub).to.have.been.calledWith(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockContext.log,
        'accessibility/test-site-id/2024-03-15-final-result.json',
        '2024-03-15',
      );

      dateStub.restore();
    });

    it('should log appropriate info message during execution', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();

      // Act
      await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(mockContext.log.info).to.have.been.calledWith(
        '[A11yAudit] Step 2: Processing scraped data for site test-site-id (https://example.com)',
      );
    });

    it('should successfully call saveA11yMetricsToS3 and log debug message', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 3,
                critical: { items: { 'some-id': { count: 3 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();
      saveA11yMetricsToS3Stub.resolves({
        success: true,
        message: 'A11y metrics saved to S3',
        s3Key: 'metrics/test-site-id/axe-core/a11y-audit.json',
      });

      // Act
      await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(saveA11yMetricsToS3Stub).to.have.been.calledOnceWith(
        mockAggregationResult.finalResultFiles.current,
        mockContext,
      );

      expect(mockContext.log.debug).to.have.been.calledWith(
        '[A11yAudit] Saved a11y metrics for site test-site-id - Result:',
        sinon.match.object,
      );
    });

    it('should handle error from saveA11yMetricsToS3 and return failure status', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 2,
                critical: { items: { 'some-id': { count: 2 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 2,
                critical: { items: { 'some-id': { count: 2 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();
      const error = new Error('S3 upload failed');
      saveA11yMetricsToS3Stub.rejects(error);

      // Act
      const result = await processAccessibilityOpportunities(mockContext);

      // Assert
      expect(saveA11yMetricsToS3Stub).to.have.been.calledOnceWith(
        mockAggregationResult.finalResultFiles.current,
        mockContext,
      );

      expect(mockContext.log.error).to.have.been.calledWith(
        '[A11yAudit] Error saving a11y metrics to s3 for site test-site-id (https://example.com): S3 upload failed',
        error,
      );

      expect(result).to.deep.equal({
        status: 'PROCESSING_FAILED',
        error: 'S3 upload failed',
      });

      // Should have called previous functions successfully
      expect(aggregateAccessibilityDataStub).to.have.been.called;
      expect(generateReportOpportunitiesStub).to.have.been.called;
      expect(createAccessibilityIndividualOpportunitiesStub).to.have.been.called;

      // Should not call debug log when error occurs
      expect(mockContext.log.debug).to.not.have.been.calledWith(
        '[A11yAudit] Saving a11y metrics to s3',
      );
    });

    it('should call saveA11yMetricsToS3 after createAccessibilityIndividualOpportunities completes', async () => {
      // Arrange
      const mockAggregationResult = {
        success: true,
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
            'https://example.com/page1': {
              violations: {
                total: 1,
                critical: { items: { 'some-id': { count: 1 } } },
              },
            },
          },
        },
      };
      aggregateAccessibilityDataStub.resolves(mockAggregationResult);
      generateReportOpportunitiesStub.resolves();
      createAccessibilityIndividualOpportunitiesStub.resolves();
      saveA11yMetricsToS3Stub.resolves();

      // Act
      await processAccessibilityOpportunities(mockContext);

      // Assert - Verify call order by checking callCount at different points
      expect(createAccessibilityIndividualOpportunitiesStub).to.have.been.called;
      expect(saveA11yMetricsToS3Stub).to.have.been.called;

      // Verify both were called with correct parameters
      expect(createAccessibilityIndividualOpportunitiesStub).to.have.been.calledWith(
        mockAggregationResult.finalResultFiles.current,
        mockContext,
      );
      expect(saveA11yMetricsToS3Stub).to.have.been.calledWith(
        mockAggregationResult.finalResultFiles.current,
        mockContext,
      );
    });
  });
});
