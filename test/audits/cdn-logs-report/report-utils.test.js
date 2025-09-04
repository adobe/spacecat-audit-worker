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
import esmock from 'esmock';
import { getConfigs } from '../../../src/cdn-logs-report/constants/report-configs.js';

use(sinonChai);
use(chaiAsPromised);

describe('CDN Logs Report Utils', () => {
  let reportUtils;
  let sandbox;
  let mockResolveCdnBucketName;
  const referralConfig = getConfigs('test-bucket', 'example_com')
    .find((c) => c.name === 'referral');

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    mockResolveCdnBucketName = sandbox.stub().resolves('test-bucket');

    reportUtils = await esmock('../../../src/cdn-logs-report/utils/report-utils.js', {
      '../../../src/utils/cdn-utils.js': {
        extractCustomerDomain: (site) => site.getBaseURL().replace(/https?:\/\/(www\.)?/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
        resolveCdnBucketName: mockResolveCdnBucketName,
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getS3Config', () => {
    it('generates correct S3 config from site', async () => {
      const mockSite = { getBaseURL: () => 'https://www.example.com' };
      const mockContext = {};

      const config = await reportUtils.getS3Config(mockSite, mockContext);

      expect(config).to.have.property('customerName', 'example');
      expect(config).to.have.property('customerDomain', 'example_com');
      expect(config).to.have.property('bucket', 'test-bucket');
      expect(config).to.have.property('databaseName', 'cdn_logs_example_com');
      // expect(config).to.have.property('tableName', 'aggregated_logs_example_com');
      // expect(config).to.have.property('aggregatedLocation', 's3://test-bucket/aggregated/');
    });

    it('extracts customer name from domain parts correctly', async () => {
      const mockSite = { getBaseURL: () => 'https://sub.example.com' };
      const mockContext = {};

      const config = await reportUtils.getS3Config(mockSite, mockContext);

      expect(config).to.have.property('customerName', 'sub');
      expect(config).to.have.property('customerDomain', 'sub_example_com');
    });

    it('getAthenaTempLocation method works correctly', async () => {
      const mockSite = { getBaseURL: () => 'https://www.example.com' };
      const mockContext = {};

      const config = await reportUtils.getS3Config(mockSite, mockContext);
      const tempLocation = config.getAthenaTempLocation();

      expect(tempLocation).to.equal('s3://test-bucket/temp/athena-results/');
    });
  });

  describe('generatePeriodIdentifier', () => {
    it('generates week format for 7-day periods', () => {
      const startDate = new Date('2025-01-06');
      const endDate = new Date('2025-01-12');

      const identifier = reportUtils.generatePeriodIdentifier(startDate, endDate);
      expect(identifier).to.equal('w02-2025');
    });

    it('generates date range format for non-7-day periods', () => {
      const startDate = new Date('2025-01-06');
      const endDate = new Date('2025-01-20');

      const identifier = reportUtils.generatePeriodIdentifier(startDate, endDate);
      expect(identifier).to.equal('2025-01-06_to_2025-01-20');
    });
  });

  describe('generateReportingPeriods', () => {
    it('generates week periods with offset', () => {
      const refDate = new Date('2025-01-15');

      const periods = reportUtils.generateReportingPeriods(refDate, -1);

      expect(periods).to.have.property('weeks').that.is.an('array');
      expect(periods.weeks).to.have.length(1);
      expect(periods.weeks[0]).to.have.property('startDate');
      expect(periods.weeks[0]).to.have.property('endDate');
      expect(periods.weeks[0]).to.have.property('weekLabel');
      expect(periods).to.have.property('columns').that.is.an('array');
    });

    it('handles Sunday reference date correctly', () => {
      const sundayDate = new Date('2025-01-12');

      const periods = reportUtils.generateReportingPeriods(sundayDate, -1);

      expect(periods.weeks).to.have.length(1);
      expect(periods.weeks[0].startDate.getUTCDay()).to.equal(1); // Monday
    });
  });

  describe('validateCountryCode', () => {
    it('validates valid country codes', () => {
      expect(reportUtils.validateCountryCode('US')).to.equal('US');
      expect(reportUtils.validateCountryCode('us')).to.equal('US');
    });

    it('returns GLOBAL for invalid codes', () => {
      expect(reportUtils.validateCountryCode('ABC')).to.equal('GLOBAL');
      expect(reportUtils.validateCountryCode(null)).to.equal('GLOBAL');
      expect(reportUtils.validateCountryCode('')).to.equal('GLOBAL');
    });

    it('handles GLOBAL country code correctly', () => {
      expect(reportUtils.validateCountryCode('GLOBAL')).to.equal('GLOBAL');
      expect(reportUtils.validateCountryCode('global')).to.equal('GLOBAL');
    });
  });

  describe('buildSiteFilters', () => {
    it('returns empty string for empty filters', () => {
      expect(reportUtils.buildSiteFilters([])).to.equal('');
      expect(reportUtils.buildSiteFilters(null)).to.equal('');
    });

    it('builds include filters correctly', () => {
      const result = reportUtils.buildSiteFilters([
        { key: 'url', value: ['test'], type: 'include' },
      ]);
      expect(result).to.include("REGEXP_LIKE(url, '(?i)(test)')");
    });

    it('builds exclude filters correctly', () => {
      const result = reportUtils.buildSiteFilters([
        { key: 'url', value: ['admin'], type: 'exclude' },
      ]);
      expect(result).to.include("NOT REGEXP_LIKE(url, '(?i)(admin)')");
    });

    it('combines multiple filters with AND', () => {
      const result = reportUtils.buildSiteFilters([
        { key: 'url', value: ['test'], type: 'include' },
        { key: 'url', value: ['admin'], type: 'exclude' },
      ]);
      expect(result).to.include('AND');
    });
  });

  describe('loadSql', () => {
    it('loads SQL templates with variables', async () => {
      const sql = await reportUtils.loadSql('create-database', { database: 'test_db' });

      expect(sql).to.be.a('string');
    });

    it('loads SQL without variables', async () => {
      const sql = await reportUtils.loadSql('create-database', {});

      expect(sql).to.be.a('string');
    });
  });

  describe('ensureTableExists', () => {
    it('creates table successfully', async () => {
      const mockAthenaClient = {
        execute: sandbox.stub().resolves(),
      };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_db',
        aggregatedLocation: 's3://test-bucket/data/',
      };
      const mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      await reportUtils.ensureTableExists(mockAthenaClient, mockS3Config, referralConfig, mockLog);

      expect(mockAthenaClient.execute).to.have.been.calledOnce;
      expect(mockLog.info).to.have.been.calledWith('Creating or checking table: aggregated_referral_logs_example_com');
      expect(mockLog.info).to.have.been.calledWith('Table aggregated_referral_logs_example_com is ready');
    });

    it('handles table creation errors', async () => {
      const mockAthenaClient = {
        execute: sandbox.stub().rejects(new Error('Table creation failed')),
      };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_db',
        aggregatedLocation: 's3://test-bucket/data/',
      };
      const mockLog = {
        info: sandbox.stub(),
        error: sandbox.stub(),
      };

      await expect(
        reportUtils.ensureTableExists(mockAthenaClient, mockS3Config, referralConfig, mockLog),
      ).to.be.rejectedWith('Table creation failed');

      expect(mockLog.error).to.have.been.calledWith(
        'Failed to ensure table exists: Table creation failed',
      );
    });
  });

  describe('fetchRemotePatterns', () => {
    let mockFetch;
    let originalFetch;

    beforeEach(() => {
      originalFetch = global.fetch;
      mockFetch = sandbox.stub();
      global.fetch = mockFetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fetches remote patterns successfully', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const mockResponseData = {
        pagetype: {
          data: [
            { name: 'Homepage', regex: '.*/[a-z]{2}/$' },
            { name: 'Product Detail Page', regex: '.*/products/.*' },
          ],
        },
        products: {
          data: [
            { regex: '/products/([^/]+)/' },
          ],
        },
      };

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves(mockResponseData),
      });

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(mockFetch).to.have.been.calledOnce;

      expect(result).to.deep.equal({
        pagePatterns: [
          { name: 'Homepage', regex: '.*/[a-z]{2}/$' },
          { name: 'Product Detail Page', regex: '.*/products/.*' },
        ],
        topicPatterns: [
          { regex: '/products/([^/]+)/' },
        ],
      });
    });

    it('returns null when no data folder is configured', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => null,
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(mockFetch).to.not.have.been.called;
    });

    it('returns null when getConfig returns null', async () => {
      const mockSite = {
        getConfig: () => null,
      };

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(mockFetch).to.not.have.been.called;
    });

    it('returns null when fetch fails', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      mockFetch.resolves({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(mockFetch).to.have.been.calledOnce;
    });

    it('returns null when fetch throws an error', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      mockFetch.rejects(new Error('Network error'));

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(mockFetch).to.have.been.calledOnce;
    });

    it('returns null when JSON parsing fails', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().rejects(new Error('Invalid JSON')),
      });

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(mockFetch).to.have.been.calledOnce;
    });

    it('handles missing pagetype or products data gracefully', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const mockResponseData = {
        pagetype: null,
        products: {
          data: [{ regex: '/test/' }],
        },
      };

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves(mockResponseData),
      });

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.deep.equal({
        pagePatterns: [],
        topicPatterns: [{ regex: '/test/' }],
      });
    });

    it('uses environment variable for API key', async () => {
      const originalEnv = process.env.LLMO_HLX_API_KEY;
      process.env.LLMO_HLX_API_KEY = 'test-api-key';

      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ pagetype: { data: [] }, products: { data: [] } }),
      });

      await reportUtils.fetchRemotePatterns(mockSite);

      expect(mockFetch).to.have.been.calledWith(
        sinon.match.string,
        sinon.match({
          headers: sinon.match({
            Authorization: 'token test-api-key',
          }),
        }),
      );

      process.env.LLMO_HLX_API_KEY = originalEnv;
    });
  });
});
