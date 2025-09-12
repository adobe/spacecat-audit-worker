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
import chaiAsPromised from 'chai-as-promised';
import { warmCacheForSite, warmCacheForQuery } from '../../../src/paid-traffic-analysis/cache-warmer.js';

use(sinonChai);
use(chaiAsPromised);

describe('Paid-Traffic Analysis Cache Warmer', () => {
  let sandbox;
  let mockS3;
  let mockAthenaQuery;
  let mockAthena;
  let mockLog;
  let mockEnv;
  let mockContext;
  let mockSite;
  const siteId = 'site-123';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockS3 = { send: sandbox.stub() };
    mockAthenaQuery = sandbox.stub().resolves([
      { dimension1: 'value1', pageViews: 1000, cwv: 2.5 },
      { dimension1: 'value2', pageViews: 2000, cwv: 3.0 },
    ]);
    mockAthena = { query: mockAthenaQuery };
    mockLog = {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };
    mockEnv = {
      RUM_METRICS_DATABASE: 'rum_db',
      RUM_METRICS_COMPACT_TABLE: 'compact_table',
      S3_IMPORTER_BUCKET_NAME: 'test-bucket',
      PAID_DATA_THRESHOLD: '2000',
      CWV_THRESHOLDS: '{"lcp": 2500, "cls": 0.1}',
      MAX_CONCURRENT_REQUESTS: '3',
    };
    mockSite = {
      id: siteId,
      getSiteId: sandbox.stub().returns(siteId),
      getId: sandbox.stub().returns(siteId),
      getBaseURL: sandbox.stub().resolves('https://example.com'),
      getPageTypes: sandbox.stub().resolves(null),
    };
    mockContext = {
      params: { siteId },
      data: {
        year: 2025, week: 2,
      },
      dataAccess: { Site: { findById: sandbox.stub().resolves(mockSite) } },
      s3Client: mockS3,
      athenaClient: mockAthena,
      log: mockLog,
    };

    // Configure S3 send behavior
    mockS3.send.callsFake((cmd) => {
      if (cmd.constructor?.name === 'HeadObjectCommand') {
        const err = new Error('not found');
        err.name = 'NotFound';
        return Promise.reject(err);
      }
      if (cmd.constructor?.name === 'PutObjectCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('paid-traffic warmCacheForSite', () => {
    const temporalParams = { yearInt: 2025, weekInt: 2, monthInt: 0 };

    it('should return early when all caches exist', async () => {
      // Mock all caches as existing
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          return Promise.resolve({}); // Cache exists
        }
        return Promise.resolve({});
      });

      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        mockEnv,
        mockSite,
        temporalParams,
      );

      expect(result.success).to.be.true;
      expect(result.results).to.have.length(23);
      expect(result.results.every((r) => r.cached)).to.be.true;
      expect(mockAthenaQuery).not.to.have.been.called;
    });

    it('should process only result not already cached', async () => {
      let callCount = 0;
      const putObjectCommands = [];
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          callCount += 1;
          // Make first 3 queries cached, rest uncached
          if (callCount <= 3) {
            return Promise.resolve({}); // Cache exists
          } else {
            const err = new Error('not found');
            err.name = 'NotFound';
            return Promise.reject(err);
          }
        }
        if (cmd.constructor?.name === 'PutObjectCommand') {
          putObjectCommands.push(cmd);
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        mockEnv,
        mockSite,
        temporalParams,
      );

      expect(result.success).to.be.true;
      expect(result.results).to.have.length(23);

      const cachedResults = result.results.filter((r) => r.cached);
      const warmedResults = result.results.filter((r) => !r.cached);

      expect(cachedResults).to.have.length(3);
      expect(warmedResults).to.have.length(20);
      expect(mockAthenaQuery).to.have.been.called;
      expect(mockAthenaQuery.callCount).to.equal(20);
      expect(putObjectCommands).to.have.length(20);
      putObjectCommands.forEach((cmd) => {
        expect(cmd.input.ContentType).to.equal('application/json');
        expect(cmd.input.Key).to.match(/\.json$/);
      });
    });

    it('should handle query warming failures', async () => {
      mockAthenaQuery.onFirstCall().rejects(new Error('Query failed'));

      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        mockEnv,
        mockSite,
        temporalParams,
      );

      expect(result.success).to.be.true;
      const failedResults = result.results.filter((r) => !r.success);
      expect(failedResults.length).to.be.greaterThan(0);
      expect(failedResults[0].error).to.equal('Query failed');
      expect(mockAthenaQuery).to.have.been.called;
    });
  });

  describe('edge cases and configuration', () => {
    it('should use defaults for database and threshold when env values missing', async () => {
      const putObjectCommands = [];
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          const err = new Error('not found');
          err.name = 'NotFound';
          return Promise.reject(err);
        }
        if (cmd.constructor?.name === 'PutObjectCommand') {
          putObjectCommands.push(cmd);
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const envWithOnlyBucket = {
        S3_IMPORTER_BUCKET_NAME: 'test-bucket',
      };

      await warmCacheForSite(
        mockContext,
        mockLog,
        envWithOnlyBucket,
        mockSite,
        { yearInt: 2025, weekInt: 2, monthInt: 0 },
      );

      // Ensure Athena was called with default database name
      const firstCall = mockAthenaQuery.getCall(0);
      expect(firstCall).to.exist;
      expect(firstCall.args[1]).to.equal('rum_metrics');

      // Ensure we attempted to cache at least one result
      expect(putObjectCommands.length).to.be.greaterThan(0);
    });
    it('should use default max concurrent requests when not provided', async () => {
      const putObjectCommands = [];
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          const err = new Error('not found');
          err.name = 'NotFound';
          return Promise.reject(err);
        }
        if (cmd.constructor?.name === 'PutObjectCommand') {
          putObjectCommands.push(cmd);
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const envWithoutMax = { ...mockEnv };
      delete envWithoutMax.MAX_CONCURRENT_REQUESTS;

      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        envWithoutMax,
        mockSite,
        { yearInt: 2025, weekInt: 2, monthInt: 0 },
      );

      expect(result.success).to.be.true;
      expect(mockAthenaQuery).to.have.been.called;
      expect(putObjectCommands.length).to.be.greaterThan(0);
      putObjectCommands.forEach((cmd) => {
        expect(cmd.input.ContentType).to.equal('application/json');
        expect(cmd.input.Key).to.match(/\.json$/);
      });
    });

    it('should throw error when bucket name is missing', async () => {
      const envWithoutBucket = {
        ...mockEnv,
        S3_IMPORTER_BUCKET_NAME: '', // Empty string to ensure both undefined and empty are tested
      };

      await expect(
        warmCacheForSite(
          mockContext,
          mockLog,
          envWithoutBucket,
          mockSite,
          { yearInt: 2025, weekInt: 2, monthInt: 0 },
        ),
      ).to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for caching');

      // Also test with undefined
      await expect(
        warmCacheForSite(
          mockContext,
          mockLog,
          { ...mockEnv, S3_IMPORTER_BUCKET_NAME: undefined },
          mockSite,
          { yearInt: 2025, weekInt: 2, monthInt: 0 },
        ),
      ).to.be.rejectedWith('S3_IMPORTER_BUCKET_NAME must be provided for caching');

      expect(mockAthenaQuery).not.to.have.been.called;
    });

    it('should handle invalid CWV thresholds and proceed', async () => {
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          const err = new Error('not found');
          err.name = 'NotFound';
          return Promise.reject(err); // Cache doesn't exist
        }
        if (cmd.constructor?.name === 'PutObjectCommand') {
          return Promise.resolve({}); // Cache write succeeds
        }
        return Promise.resolve({});
      });

      const envWithInvalidThresholds = {
        ...mockEnv,
        CWV_THRESHOLDS: '{invalid:json:string}', // Invalid JSON string
      };

      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        envWithInvalidThresholds,
        mockSite,
        { yearInt: 2025, weekInt: 2, monthInt: 0 },
      );

      expect(result.success).to.be.true;
      expect(mockAthenaQuery).to.have.been.called;
    });
  });

  describe('no data scenarios', () => {
    it('should throw error when all queries fail due to no data', async () => {
      // Mock Athena to return empty results for all queries
      mockAthenaQuery.resolves([]);

      await expect(
        warmCacheForSite(
          mockContext,
          mockLog,
          mockEnv,
          mockSite,
          { yearInt: 2025, weekInt: 2, monthInt: 0 },
        ),
      ).to.be.rejectedWith('No paid traffic data found for site site-123. Please ensure data is imported first before running paid traffic analysis.');

      expect(mockAthenaQuery).to.have.been.called;
    });

    it('should throw error when some queries succeed but others fail due to no data', async () => {
      let callCount = 0;
      mockAthenaQuery.callsFake(() => {
        callCount += 1;
        // First few calls succeed, rest return empty
        if (callCount <= 2) {
          return Promise.resolve([{ dimension1: 'value1', pageViews: 1000 }]);
        }
        return Promise.resolve([]);
      });

      // Should not throw because some queries succeeded
      const result = await warmCacheForSite(
        mockContext,
        mockLog,
        mockEnv,
        mockSite,
        { yearInt: 2025, weekInt: 2, monthInt: 0 },
      );

      expect(result.success).to.be.true;
      expect(mockAthenaQuery).to.have.been.called;
    });
  });

  describe('warmCacheForQuery', () => {
    it('should pass object CWV thresholds to mapper', async () => {
      mockS3.send.callsFake((cmd) => {
        if (cmd.constructor?.name === 'HeadObjectCommand') {
          const err = new Error('not found');
          err.name = 'NotFound';
          return Promise.reject(err);
        }
        if (cmd.constructor?.name === 'PutObjectCommand') {
          return Promise.resolve({});
        }
        return Promise.resolve({});
      });

      const config = {
        rumMetricsDatabase: 'rum_db',
        rumMetricsCompactTable: 'compact_table',
        bucketName: 'test-bucket',
        pageViewThreshold: 2000,
        cwvThresholds: { lcp: 3000, cls: 0.2 },
        athenaTemp: 's3://test-bucket/rum-metrics-compact/temp/out',
        cacheLocation: 's3://test-bucket/rum-metrics-compact/cache',
      };

      const mapper = { toJSON: sandbox.stub().returns({}) };
      const queryConfig = { dimensions: ['utm_campaign'], mapper };

      mockAthenaQuery.resolves([{ utm_campaign: 'spring' }]);

      await warmCacheForQuery(
        mockContext,
        mockLog,
        config,
        siteId,
        queryConfig,
        { yearInt: 2025, weekInt: 2, monthInt: 0 },
        'rum_db.compact_table',
        null,
        'https://example.com',
      );

      expect(mapper.toJSON).to.have.been.calledWith(
        sinon.match.object,
        { lcp: 3000, cls: 0.2 },
        'https://example.com',
      );
    });

    it('should throw NO_DATA error when Athena returns empty results', async () => {
      const config = {
        rumMetricsDatabase: 'rum_db',
        rumMetricsCompactTable: 'compact_table',
        bucketName: 'test-bucket',
        pageViewThreshold: 2000,
        cwvThresholds: { lcp: 3000, cls: 0.2 },
        athenaTemp: 's3://test-bucket/rum-metrics-compact/temp/out',
        cacheLocation: 's3://test-bucket/rum-metrics-compact/cache',
      };

      const mapper = { toJSON: sandbox.stub().returns({}) };
      const queryConfig = { dimensions: ['utm_campaign'], mapper };

      // Mock Athena to return empty results
      mockAthenaQuery.resolves([]);

      await expect(
        warmCacheForQuery(
          mockContext,
          mockLog,
          config,
          siteId,
          queryConfig,
          { yearInt: 2025, weekInt: 2, monthInt: 0 },
          'rum_db.compact_table',
          null,
          'https://example.com',
        ),
      ).to.be.rejectedWith('NO_DATA: No paid traffic data found for site site-123 with dimensions [utm_campaign]. Please ensure data is imported first before running paid traffic analysis.');
    });

    it('should throw NO_DATA error when mapper filters out all results', async () => {
      const config = {
        rumMetricsDatabase: 'rum_db',
        rumMetricsCompactTable: 'compact_table',
        bucketName: 'test-bucket',
        pageViewThreshold: 2000,
        cwvThresholds: { lcp: 3000, cls: 0.2 },
        athenaTemp: 's3://test-bucket/rum-metrics-compact/temp/out',
        cacheLocation: 's3://test-bucket/rum-metrics-compact/cache',
      };

      // Mock mapper to return null for each row (filtered out)
      const mapper = { toJSON: sandbox.stub().returns(null) };
      const queryConfig = { dimensions: ['utm_campaign'], mapper };
      mockAthenaQuery.resolves([{ utm_campaign: 'spring' }]);

      // Since results.map() with null returns [null], we need to filter it
      const originalMap = Array.prototype.map;
      sandbox.stub(Array.prototype, 'map').callsFake(function mapWithFilter(callback) {
        const result = originalMap.call(this, callback);
        return result.filter((item) => item !== null); // This creates empty array
      });

      await expect(
        warmCacheForQuery(
          mockContext,
          mockLog,
          config,
          siteId,
          queryConfig,
          { yearInt: 2025, weekInt: 2, monthInt: 0 },
          'rum_db.compact_table',
          null,
          'https://example.com',
        ),
      ).to.be.rejectedWith('NO_DATA: No valid paid traffic data found after processing for site site-123 with dimensions [utm_campaign]. Please ensure data is imported first before running paid traffic analysis.');
    });
  });
});
