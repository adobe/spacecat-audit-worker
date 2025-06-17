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
  let getUrlsForAuditStub;
  let aggregateAccessibilityDataStub;
  let generateReportOpportunitiesStub;
  let createAccessibilityIndividualOpportunitiesStub;
  let getExistingObjectKeysFromFailedAuditsStub;
  let getExistingUrlsFromFailedAuditsStub;

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
      },
    });

    scrapeAccessibilityData = accessibilityModule.scrapeAccessibilityData;
    processAccessibilityOpportunities = accessibilityModule.processAccessibilityOpportunities;
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
        auditResult: {
          status: 'SCRAPING_REQUESTED',
          message: 'Content scraping for accessibility audit initiated.',
          scrapedUrls: [],
        },
        fullAuditRef: 'https://example.com',
        urls: [],
        siteId: 'test-site-id',
        jobId: 'test-site-id',
        processingType: 'accessibility',
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
        '[A11yAudit] Step 2: Processing scraped data for https://example.com',
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
        '[A11yAudit] Error creating individual opportunities: Failed to create individual opportunities',
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
        '[A11yAudit] No data aggregated: No accessibility data found',
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
        '[A11yAudit] Error processing accessibility data: S3 connection failed',
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
        '[A11yAudit] Error generating report opportunities: Failed to create opportunity',
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
        '[A11yAudit] Step 2: Processing scraped data for https://example.com',
      );
    });
  });
});
