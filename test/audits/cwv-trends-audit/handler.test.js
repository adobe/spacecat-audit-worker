/*
 * Copyright 2024 Adobe. All rights reserved.
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

describe('CWV Trends Audit Handler', () => {
  let sandbox;
  let mockContext;
  let mockSite;
  let mockS3Client;
  let mockAudit;
  let cwvTrendsAuditHandler;
  let syncOpportunitiesAndSuggestionsStub;

  const createMockS3Data = (deviceType = 'mobile') => [
    {
      url: 'https://example.com/page1',
      metrics: [
        {
          deviceType,
          pageviews: 5000,
          bounceRate: 0.25,
          engagement: 0.75,
          clickRate: 0.60,
          lcp: 2000,
          cls: 0.08,
          inp: 180,
          ttfb: 300,
        },
      ],
    },
    {
      url: 'https://example.com/page2',
      metrics: [
        {
          deviceType,
          pageviews: 3000,
          bounceRate: 0.30,
          engagement: 0.70,
          clickRate: 0.55,
          lcp: 3000,
          cls: 0.15,
          inp: 300,
          ttfb: 400,
        },
      ],
    },
    {
      url: 'https://example.com/page3',
      metrics: [
        {
          deviceType,
          pageviews: 1500,
          bounceRate: 0.40,
          engagement: 0.60,
          clickRate: 0.50,
          lcp: 5000,
          cls: 0.30,
          inp: 600,
          ttfb: 500,
        },
      ],
    },
    {
      url: 'https://example.com/page4',
      metrics: [
        {
          deviceType,
          pageviews: 500, // Below threshold
          bounceRate: 0.20,
          engagement: 0.80,
          clickRate: 0.70,
          lcp: 1800,
          cls: 0.05,
          inp: 150,
          ttfb: 250,
        },
      ],
    },
  ];

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    // Mock site
    mockSite = {
      getId: sandbox.stub().returns('test-site-id'),
      getBaseURL: sandbox.stub().returns('https://example.com'),
      getConfig: sandbox.stub().returns({}),
    };

    // Mock audit
    mockAudit = {
      getId: sandbox.stub().returns('audit-123'),
      getAuditResult: sandbox.stub().returns({
        deviceType: 'mobile',
        trendData: [],
        summary: {},
        urlDetails: [],
      }),
    };

    // Mock S3 client
    mockS3Client = {
      send: sandbox.stub(),
    };

    // Create mock context
    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        site: mockSite,
        audit: mockAudit,
        finalUrl: 'https://example.com',
        s3Client: mockS3Client,
        auditContext: {
          deviceType: 'mobile',
        },
        env: {
          S3_SCRAPER_BUCKET_NAME: 'test-bucket',
        },
      })
      .build();

    // Make Site.findById return mockSite
    mockContext.dataAccess.Site.findById.resolves(mockSite);

    // Mock syncOpportunitiesAndSuggestions
    syncOpportunitiesAndSuggestionsStub = sandbox.stub().resolves({
      getId: () => 'opportunity-123',
    });

    const handlerModule = await esmock('../../../src/cwv-trends-audit/handler.js', {
      '../../../src/cwv-trends-audit/opportunity-sync.js': {
        syncOpportunitiesAndSuggestions: syncOpportunitiesAndSuggestionsStub,
      },
    });

    cwvTrendsAuditHandler = handlerModule.default;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('cwvTrendsAuditHandler', () => {
    it('should successfully collect trend data for 28 days', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      expect(mockS3Client.send).to.have.callCount(28); // 28 days
      expect(result.status).to.equal(200);
      expect(mockContext.dataAccess.Audit.create).to.have.been.calledOnce;

      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData).to.have.property('auditResult');
      expect(auditData.auditResult).to.have.property('deviceType', 'mobile');
      expect(auditData.auditResult).to.have.property('trendData');
      expect(auditData.auditResult.trendData).to.have.lengthOf(28);
      expect(auditData.auditResult).to.have.property('summary');
      expect(auditData.auditResult).to.have.property('urlDetails');

      // Verify URL filtering (should exclude page4 with 500 pageviews)
      expect(auditData.auditResult.urlDetails).to.have.lengthOf(3);

      // Verify percentages are converted
      expect(auditData.auditResult.urlDetails[0].bounceRate).to.equal(25);
      expect(auditData.auditResult.urlDetails[0].engagement).to.equal(75);
      expect(auditData.auditResult.urlDetails[0].clickRate).to.equal(60);

      // Verify opportunities were synced
      expect(syncOpportunitiesAndSuggestionsStub).to.have.been.calledOnce;
    });

    it('should use desktop device type when specified', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data('desktop'))),
        },
      };

      mockS3Client.send.resolves(mockS3Response);
      mockContext.auditContext = { deviceType: 'desktop' };

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData.auditResult.deviceType).to.equal('desktop');
    });

    it('should default to mobile when device type not specified', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);
      mockContext.auditContext = {};

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData.auditResult.deviceType).to.equal('mobile');
    });

    it('should throw error when S3 files are missing', async () => {
      // Arrange
      mockS3Client.send.rejects(new Error('NoSuchKey'));

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act & Assert
      await expect(cwvTrendsAuditHandler.run(message, mockContext)).to.be.rejectedWith(/Missing S3 data for/);
    });

    it('should categorize CWV correctly', async () => {
      // Arrange
      const mixedData = [
        {
          url: 'https://example.com/good',
          metrics: [{
            deviceType: 'mobile',
            pageviews: 5000,
            bounceRate: 0.25,
            engagement: 0.75,
            clickRate: 0.60,
            lcp: 2000, // Good
            cls: 0.08, // Good
            inp: 180, // Good
            ttfb: 300,
          }],
        },
        {
          url: 'https://example.com/poor',
          metrics: [{
            deviceType: 'mobile',
            pageviews: 3000,
            bounceRate: 0.30,
            engagement: 0.70,
            clickRate: 0.55,
            lcp: 5000, // Poor
            cls: 0.30, // Poor
            inp: 600, // Poor
            ttfb: 400,
          }],
        },
        {
          url: 'https://example.com/ni',
          metrics: [{
            deviceType: 'mobile',
            pageviews: 2000,
            bounceRate: 0.35,
            engagement: 0.65,
            clickRate: 0.50,
            lcp: 3000, // Needs Improvement
            cls: 0.15, // Needs Improvement
            inp: 300, // Needs Improvement
            ttfb: 350,
          }],
        },
      ];

      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(mixedData)),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData.auditResult.trendData[0].good).to.be.closeTo(33.33, 1);
      expect(auditData.auditResult.trendData[0].needsImprovement).to.be.closeTo(33.33, 1);
      expect(auditData.auditResult.trendData[0].poor).to.be.closeTo(33.33, 1);
    });

    it('should handle null CWV metrics gracefully', async () => {
      // Arrange
      const dataWithNulls = [
        {
          url: 'https://example.com/page1',
          metrics: [{
            deviceType: 'mobile',
            pageviews: 5000,
            bounceRate: 0.25,
            engagement: 0.75,
            clickRate: 0.60,
            lcp: null,
            cls: null,
            inp: null,
            ttfb: 300,
          }],
        },
        {
          url: 'https://example.com/page2',
          metrics: [{
            deviceType: 'mobile',
            pageviews: 3000,
            bounceRate: 0.30,
            engagement: 0.70,
            clickRate: 0.55,
            lcp: 2000,
            cls: 0.08,
            inp: 180,
            ttfb: 400,
          }],
        },
      ];

      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(dataWithNulls)),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      // Should only count page2 (page1 has null metrics)
      expect(auditData.auditResult.trendData[0].good).to.equal(100);
      expect(auditData.auditResult.trendData[0].needsImprovement).to.equal(0);
      expect(auditData.auditResult.trendData[0].poor).to.equal(0);
    });

    it('should filter URLs below MIN_PAGEVIEWS threshold', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      // page4 has 500 pageviews (below 1000 threshold), should be filtered out
      expect(auditData.auditResult.urlDetails).to.have.lengthOf(3);
      expect(auditData.auditResult.urlDetails.map((u) => u.url)).to.not.include('https://example.com/page4');
    });

    it('should sort URLs by pageviews descending', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData.auditResult.urlDetails[0].pageviews).to.equal(5000);
      expect(auditData.auditResult.urlDetails[1].pageviews).to.equal(3000);
      expect(auditData.auditResult.urlDetails[2].pageviews).to.equal(1500);
    });

    it('should calculate summary statistics correctly', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      const result = await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      const auditData = mockContext.dataAccess.Audit.create.firstCall.args[0];
      expect(auditData.auditResult.summary).to.have.property('totalUrls');
      expect(auditData.auditResult.summary).to.have.property('avgGood');
      expect(auditData.auditResult.summary).to.have.property('avgNeedsImprovement');
      expect(auditData.auditResult.summary).to.have.property('avgPoor');
      expect(auditData.auditResult.summary.totalUrls).to.equal(3);
    });

    it('should log info messages during execution', async () => {
      // Arrange
      const mockS3Response = {
        Body: {
          transformToString: sandbox.stub().resolves(JSON.stringify(createMockS3Data())),
        },
      };

      mockS3Client.send.resolves(mockS3Response);

      const message = {
        type: 'cwv-trends-audit',
        siteId: 'test-site-id',
      };

      // Act
      await cwvTrendsAuditHandler.run(message, mockContext);

      // Assert
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Collecting trend data/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Processed \d+ URLs for device: mobile/),
      );
      expect(mockContext.log.info).to.have.been.calledWith(
        sinon.match(/Creating opportunities and suggestions/),
      );
    });
  });
});
