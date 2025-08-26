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
import nock from 'nock';
import * as reportUtils from '../../../src/cdn-logs-report/utils/report-utils.js';
import { getConfigs } from '../../../src/cdn-logs-report/constants/report-configs.js';

use(sinonChai);
use(chaiAsPromised);

describe('CDN Logs Report Utils', () => {
  let sandbox;
  let mockContext;
  const referralConfig = getConfigs('test-bucket', 'example_com')
    .find((c) => c.name === 'referral');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    nock.cleanAll();
    mockContext = {
      s3Client: {
        send: sandbox.stub().resolves(),
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
    nock.cleanAll();
  });

  const createSiteConfig = (overrides = {}) => {
    const defaultConfig = {
      getLlmoCdnBucketConfig: () => ({ bucketName: 'test-bucket' }),
    };
    return { ...defaultConfig, ...overrides };
  };

  describe('getS3Config', () => {
    it('generates correct S3 config from site', async () => {
      const mockSite = {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => createSiteConfig(),
      };

      const config = await reportUtils.getS3Config(mockSite, mockContext);

      expect(config).to.have.property('customerName', 'example');
      expect(config).to.have.property('customerDomain', 'example_com');
      expect(config).to.have.property('bucket', 'test-bucket');
      expect(config).to.have.property('databaseName', 'cdn_logs_example_com');
    });

    it('extracts customer name from domain parts correctly', async () => {
      const mockSite = {
        getBaseURL: () => 'https://sub.example.com',
        getConfig: () => createSiteConfig(),
      };

      const config = await reportUtils.getS3Config(mockSite, mockContext);

      expect(config).to.have.property('customerName', 'sub');
      expect(config).to.have.property('customerDomain', 'sub_example_com');
    });

    it('getAthenaTempLocation method works correctly', async () => {
      const mockSite = {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => createSiteConfig(),
      };

      const config = await reportUtils.getS3Config(mockSite, mockContext);
      const tempLocation = config.getAthenaTempLocation();

      expect(tempLocation).to.equal('s3://test-bucket/temp/athena-results/');
    });
  });
  describe('generateReportingPeriods', () => {
    it('generates week periods with offset', () => {
      const refDate = new Date('2025-01-15');

      const periods = reportUtils.generateReportingPeriods(refDate, -1);

      expect(periods).to.have.property('weeks').that.is.an('array');
      expect(periods.weeks[0].startDate.toISOString()).to.equal('2025-01-06T00:00:00.000Z');
      expect(periods.weeks[0].endDate.toISOString()).to.equal('2025-01-12T23:59:59.999Z');
      expect(periods.weeks[0].weekLabel).to.equal('Week 2');
      expect(periods.weeks[0].weekNumber).to.equal(2);
      expect(periods.weeks[0].year).to.equal(2025);
      expect(periods.periodIdentifier).to.equal('w02-2025');
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

    it('falls back to baseURL with www when filters are empty', () => {
      const mockSite = {
        getBaseURL: () => 'https://adobe.com',
      };

      const result = reportUtils.buildSiteFilters([], mockSite);

      expect(result).to.equal("REGEXP_LIKE(host, '(?i)(www.adobe.com)')");
    });

    it('keeps www prefix when already present', () => {
      const mockSite = {
        getBaseURL: () => 'https://www.adobe.com',
      };

      const result = reportUtils.buildSiteFilters([], mockSite);

      expect(result).to.equal("REGEXP_LIKE(host, '(?i)(www.adobe.com)')");
    });

    it('keeps subdomain as-is without adding www', () => {
      const mockSite = {
        getBaseURL: () => 'https://business.adobe.com',
      };

      const result = reportUtils.buildSiteFilters([], mockSite);

      expect(result).to.equal("REGEXP_LIKE(host, '(?i)(business.adobe.com)')");
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

      const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/bulk/agentic-traffic/patterns/patterns.json')
        .reply(200, mockResponseData);

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(patternNock.isDone()).to.be.true;
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
    });

    it('returns null when getConfig returns null', async () => {
      const mockSite = {
        getConfig: () => null,
      };

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
    });

    it('returns null when fetch fails', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/bulk/agentic-traffic/patterns/patterns.json')
        .reply(404, 'Not Found');

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(patternNock.isDone()).to.be.true;
    });

    it('returns null when fetch throws an error', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/bulk/agentic-traffic/patterns/patterns.json')
        .replyWithError('Network error');

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(patternNock.isDone()).to.be.true;
    });

    it('returns null when JSON parsing fails', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'bulk',
          getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
        }),
      };

      const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/bulk/agentic-traffic/patterns/patterns.json')
        .reply(200, 'invalid json content');

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.be.null;
      expect(patternNock.isDone()).to.be.true;
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
        products: null,
      };

      const patternNock = nock('https://main--project-elmo-ui-data--adobe.aem.live')
        .get('/bulk/agentic-traffic/patterns/patterns.json')
        .reply(200, mockResponseData);

      const result = await reportUtils.fetchRemotePatterns(mockSite);

      expect(result).to.deep.equal({
        pagePatterns: [],
        topicPatterns: [],
      });
      expect(patternNock.isDone()).to.be.true;
    });
  });
});
