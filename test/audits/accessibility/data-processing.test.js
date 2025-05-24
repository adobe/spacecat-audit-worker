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
import { MockContextBuilder } from '../../shared.js';

import {
  aggregateAccessibilityData,
  getUrlsForAudit,
  generateReportOpportunities,
} from '../../../src/accessibility/utils/data-processing.js';
import * as s3Utils from '../../../src/utils/s3-utils.js';

use(sinonChai);
use(chaiAsPromised);

describe('Accessibility Data Processing', () => {
  let sandbox;
  let mockS3Client;
  let mockLog;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockS3Client = {
      send: sandbox.stub(),
    };
    mockLog = {
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
      debug: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('aggregateAccessibilityData', () => {
    const bucketName = 'test-bucket';
    const siteId = 'test-site-id';
    const outputKey = 'accessibility/test-site-id/2024-01-15-final-result.json';
    const version = '2024-01-15';

    it('should return error when required parameters are missing', async () => {
      const result = await aggregateAccessibilityData(
        null,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      );

      expect(result).to.deep.equal({
        success: false,
        aggregatedData: null,
        message: 'Missing required parameters for aggregateAccessibilityData',
      });
      expect(mockLog.error).to.have.been.calledWith('Missing required parameters for aggregateAccessibilityData');
    });

    it('should return error when no subfolders are found', async () => {
      // Mock the S3 ListObjectsV2 command to return no common prefixes
      mockS3Client.send.resolves({
        CommonPrefixes: [],
      });

      const result = await aggregateAccessibilityData(
        mockS3Client,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      );

      expect(result.success).to.be.false;
      expect(result.message).to.include('No accessibility data found in bucket');
      expect(mockLog.info).to.have.been.called;
    });

    it('should return error when no current date subfolders are found', async () => {
      // Mock the S3 ListObjectsV2 command to return subfolders with different dates
      mockS3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: 'accessibility/test-site-id/1234567890/' }, // Different timestamp
        ],
      });

      const result = await aggregateAccessibilityData(
        mockS3Client,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      );

      expect(result.success).to.be.false;
      expect(result.message).to.include('No accessibility data found for today\'s date');
    });

    it('should successfully aggregate accessibility data', async () => {
      const mockTimestamp = new Date('2024-01-15').getTime();
      const mockAccessibilityData = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            description: 'Elements must have sufficient color contrast',
            nodes: [{ target: ['#header'] }],
          },
          {
            id: 'alt-text',
            impact: 'critical',
            description: 'Images must have alternative text',
            nodes: [{ target: ['img'] }],
          },
        ],
      };

      // Mock S3 operations
      mockS3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: `accessibility/test-site-id/${mockTimestamp}/` },
        ],
      });

      sandbox.stub(s3Utils, 'getObjectKeysUsingPrefix').resolves([
        `accessibility/test-site-id/${mockTimestamp}/page1.json`,
        `accessibility/test-site-id/${mockTimestamp}/page2.json`,
      ]);

      sandbox.stub(s3Utils, 'getObjectFromKey')
        .onFirstCall()
        .resolves(mockAccessibilityData)
        .onSecondCall()
        .resolves(mockAccessibilityData);

      const result = await aggregateAccessibilityData(
        mockS3Client,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      );

      expect(result.success).to.be.true;
      expect(result.aggregatedData).to.exist;
      // 2 violations per file * 2 files
      expect(result.aggregatedData.overall.violations.total).to.equal(4);
      expect(result.aggregatedData.overall.violations.critical.count).to.equal(2);
      expect(result.aggregatedData.overall.violations.serious.count).to.equal(2);
    });

    it('should handle S3 errors gracefully', async () => {
      const s3Error = new Error('S3 connection failed');
      mockS3Client.send.rejects(s3Error);

      await expect(aggregateAccessibilityData(
        mockS3Client,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      )).to.be.rejectedWith('S3 connection failed');
    });

    it('should skip invalid JSON files and continue processing', async () => {
      const mockTimestamp = new Date('2024-01-15').getTime();
      const validData = {
        violations: [
          {
            id: 'color-contrast',
            impact: 'serious',
            description: 'Elements must have sufficient color contrast',
            nodes: [{ target: ['#header'] }],
          },
        ],
      };

      mockS3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: `accessibility/test-site-id/${mockTimestamp}/` },
        ],
      });

      sandbox.stub(s3Utils, 'getObjectKeysUsingPrefix').resolves([
        `accessibility/test-site-id/${mockTimestamp}/valid.json`,
        `accessibility/test-site-id/${mockTimestamp}/invalid.json`,
      ]);

      sandbox.stub(s3Utils, 'getObjectFromKey')
        .onFirstCall()
        .resolves(validData)
        .onSecondCall()
        .resolves(null); // Simulate failed file read

      const result = await aggregateAccessibilityData(
        mockS3Client,
        bucketName,
        siteId,
        mockLog,
        outputKey,
        version,
      );

      expect(result.success).to.be.true;
      expect(result.aggregatedData.overall.violations.total).to.equal(1);
      expect(mockLog.warn).to.have.been.calledWith(sinon.match(/Failed to get data from/));
    });
  });

  describe('getUrlsForAudit', () => {
    const bucketName = 'test-bucket';
    const siteId = 'test-site-id';

    it('should return default URLs when no sitemap data is found', async () => {
      sandbox.stub(s3Utils, 'getObjectFromKey').resolves(null);

      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      expect(result).to.deep.equal(['https://main--site--hlxsites.hlx.page/']);
      expect(mockLog.info).to.have.been.calledWith(sinon.match(/No sitemap data found/));
    });

    it('should return sitemap URLs when data is available', async () => {
      const mockSitemapData = {
        paths: [
          { url: 'https://example.com/' },
          { url: 'https://example.com/page1' },
          { url: 'https://example.com/page2' },
        ],
      };

      sandbox.stub(s3Utils, 'getObjectFromKey').resolves(mockSitemapData);

      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      expect(result).to.deep.equal([
        'https://example.com/',
        'https://example.com/page1',
        'https://example.com/page2',
      ]);
      expect(mockLog.info).to.have.been.calledWith(sinon.match(/Found 3 URLs from sitemap/));
    });

    it('should limit returned URLs to maximum of 20', async () => {
      const mockSitemapData = {
        paths: Array.from({ length: 30 }, (_, i) => ({
          url: `https://example.com/page${i}`,
        })),
      };

      sandbox.stub(s3Utils, 'getObjectFromKey').resolves(mockSitemapData);

      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      expect(result).to.have.length(20);
      expect(mockLog.info).to.have.been.calledWith(sinon.match(/Limiting to 20 URLs/));
    });

    it('should handle S3 errors and return default URLs', async () => {
      const s3Error = new Error('S3 access denied');
      sandbox.stub(s3Utils, 'getObjectFromKey').rejects(s3Error);

      const result = await getUrlsForAudit(mockS3Client, bucketName, siteId, mockLog);

      expect(result).to.deep.equal(['https://main--site--hlxsites.hlx.page/']);
      expect(mockLog.error).to.have.been.calledWith(sinon.match(/Error getting URLs for audit/), s3Error);
    });
  });

  describe('generateReportOpportunities', () => {
    let mockSite;
    let mockContext;
    let mockAggregationResult;

    beforeEach(() => {
      mockSite = {
        getId: sandbox.stub().returns('test-site-id'),
        getOrganizationId: sandbox.stub().returns('test-org-id'),
      };

      mockContext = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          dataAccess: {
            Opportunity: {
              create: sandbox.stub().resolves({
                getId: () => 'test-opportunity-id',
                save: sandbox.stub().resolves(),
                setData: sandbox.stub(),
                addSuggestions: sandbox.stub().resolves(),
              }),
            },
            Site: {
              findById: sandbox.stub().resolves(mockSite),
            },
          },
          env: {
            ASO_DOMAIN: 'example-aso.com',
          },
        })
        .build();

      mockAggregationResult = {
        finalResultFiles: {
          current: {
            overall: {
              violations: {
                total: 10,
                critical: { count: 3, items: {} },
                serious: { count: 7, items: {} },
              },
            },
          },
          lastWeek: {
            overall: {
              violations: {
                total: 8,
                critical: { count: 2, items: {} },
                serious: { count: 6, items: {} },
              },
            },
          },
        },
      };
    });

    it('should generate report opportunities successfully', async () => {
      await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        false,
        mockContext,
      );

      expect(mockContext.dataAccess.Opportunity.create).to.have.been.called;
      expect(mockLog.info).to.have.been.calledWith(sinon.match(/Generated accessibility report opportunities/));
    });

    it('should handle missing organization ID', async () => {
      mockSite.getOrganizationId.returns(null);

      await generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        false,
        mockContext,
      );

      expect(mockLog.warn).to.have.been.calledWith(sinon.match(/Organization ID not found/));
    });

    it('should handle opportunity creation errors', async () => {
      const createError = new Error('Database connection failed');
      mockContext.dataAccess.Opportunity.create.rejects(createError);

      await expect(generateReportOpportunities(
        mockSite,
        mockLog,
        mockAggregationResult,
        false,
        mockContext,
      )).to.be.rejectedWith('Database connection failed');
    });

    it('should generate different reports based on data availability', async () => {
      // Test with data that would generate different report types
      const fullDataResult = {
        finalResultFiles: {
          current: {
            overall: { violations: { total: 15 } },
          },
          lastWeek: {
            overall: { violations: { total: 10 } },
          },
        },
      };

      await generateReportOpportunities(
        mockSite,
        mockLog,
        fullDataResult,
        true, // isProd = true
        mockContext,
      );

      expect(mockContext.dataAccess.Opportunity.create).to.have.been.called;
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle malformed accessibility data gracefully', async () => {
      const mockTimestamp = new Date('2024-01-15').getTime();
      const malformedData = {
        // Missing violations property
        someOtherProperty: 'value',
      };

      mockS3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: `accessibility/test-site-id/${mockTimestamp}/` },
        ],
      });

      sandbox.stub(s3Utils, 'getObjectKeysUsingPrefix').resolves([
        `accessibility/test-site-id/${mockTimestamp}/malformed.json`,
      ]);

      sandbox.stub(s3Utils, 'getObjectFromKey').resolves(malformedData);

      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'output-key',
        '2024-01-15',
      );

      expect(result.success).to.be.true;
      expect(result.aggregatedData.overall.violations.total).to.equal(0);
    });

    it('should handle empty violations array', async () => {
      const mockTimestamp = new Date('2024-01-15').getTime();
      const emptyViolationsData = {
        violations: [],
      };

      mockS3Client.send.resolves({
        CommonPrefixes: [
          { Prefix: `accessibility/test-site-id/${mockTimestamp}/` },
        ],
      });

      sandbox.stub(s3Utils, 'getObjectKeysUsingPrefix').resolves([
        `accessibility/test-site-id/${mockTimestamp}/empty.json`,
      ]);

      sandbox.stub(s3Utils, 'getObjectFromKey').resolves(emptyViolationsData);

      const result = await aggregateAccessibilityData(
        mockS3Client,
        'test-bucket',
        'test-site-id',
        mockLog,
        'output-key',
        '2024-01-15',
      );

      expect(result.success).to.be.true;
      expect(result.aggregatedData.overall.violations.total).to.equal(0);
    });
  });
});
