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
import { expect } from 'chai';
import sinon from 'sinon';
import esmock from 'esmock';
import * as utils from '../../../src/cdn-logs-report/utils/report-utils.js';
import { DEFAULT_COUNTRY_PATTERNS } from '../../../src/cdn-logs-report/constants/country-patterns.js';

function extractCC(url) {
  for (const { regex } of DEFAULT_COUNTRY_PATTERNS) {
    const pattern = new RegExp(regex, 'i');
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }
  return null;
}

describe('CDN Logs Report Utils', () => {
  let sandbox;

  const mockSite = (baseURL, cdnLogsConfig = null) => ({
    getBaseURL: () => baseURL,
    getConfig: () => ({ getCdnLogsConfig: () => cdnLogsConfig, getLlmoDataFolder: () => 'llmo' }),
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Domain and Bucket Operations', () => {
    it('should extract and sanitize customer domains', () => {
      expect(utils.extractCustomerDomain(mockSite('https://test.example-site.com')))
        .to.equal('test_example_site_com');
      expect(utils.extractCustomerDomain(mockSite('https://sub-domain.multi-word-site.example-test.co.uk')))
        .to.equal('sub_domain_multi_word_site_example_test_co_uk');
    });

    it('should generate analysis bucket names', () => {
      expect(utils.getAnalysisBucket('test.example.com')).to.equal('cdn-logs-test-example-com');
      expect(utils.getAnalysisBucket('Test.Example.COM')).to.equal('cdn-logs-Test-Example-COM');
    });
  });

  describe('S3 Configuration', () => {
    it('should handle custom bucket config', () => {
      const config = utils.getS3Config(mockSite('https://test.com', { bucketName: 'custom-bucket' }));
      expect(config.bucket).to.equal('custom-bucket');
      expect(config.customerName).to.equal('test');
      expect(config.customerDomain).to.equal('test_com');
    });

    it('should handle null config fallback', () => {
      const config = utils.getS3Config(mockSite('https://empty.com', null));
      expect(config.bucket).to.equal('cdn-logs-empty-com');
      expect(config.customerName).to.equal('empty');
      expect(config.customerDomain).to.equal('empty_com');
    });

    it('should handle empty object config', () => {
      const config = utils.getS3Config(mockSite('https://empty.com', {}));
      expect(config.bucket).to.be.undefined;
      expect(config.customerName).to.equal('empty');
      expect(config.customerDomain).to.equal('empty_com');
    });

    it('should generate correct temp location', () => {
      const config = utils.getS3Config(mockSite('https://test.example.com'));
      expect(config.getAthenaTempLocation()).to.equal('s3://cdn-logs-test-example-com/temp/athena-results/');
    });
  });

  describe('Date and Time Operations', () => {
    it('should generate period identifiers', () => {
      const weekStart = new Date('2025-01-08T00:00:00Z');
      const weekEnd = new Date('2025-01-14T23:59:59Z');
      expect(utils.generatePeriodIdentifier(weekStart, weekEnd)).to.match(/^w\d{2}-\d{4}$/);

      const start = new Date('2025-01-01');
      const end = new Date('2025-01-05');
      expect(utils.generatePeriodIdentifier(start, end)).to.equal('2025-01-01_to_2025-01-05');
    });

    it('should generate reporting periods for various dates', () => {
      [
        new Date('2025-01-15T10:00:00Z'),
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        new Date('2024-02-29'), // Keep leap year test
        new Date('2025-01-07T10:00:00Z'),
        new Date('2025-01-12T10:00:00Z'),
      ].forEach((date) => {
        const periods = utils.generateReportingPeriods(date, -1);
        expect(periods.weeks).to.be.an('array').with.lengthOf(1);
        expect(periods.columns).to.be.an('array');
        expect(periods.weeks[0].weekNumber).to.be.a('number').greaterThan(0).lessThan(54);
        expect(periods.weeks[0].startDate.getUTCDay()).to.equal(1); // Monday
        expect(periods.weeks[0].endDate.getUTCDay()).to.equal(0); // Sunday
        expect(periods.weeks[0].startDate.getUTCHours()).to.equal(0);
        expect(periods.weeks[0].endDate.getUTCHours()).to.equal(23);
      });
    });
  });

  describe('Validation and Filtering', () => {
    it('should validate basic country codes', () => {
      expect(utils.validateCountryCode('US')).to.equal('US');
      expect(utils.validateCountryCode('us')).to.equal('US');
      expect(utils.validateCountryCode('FR')).to.equal('FR');
      expect(utils.validateCountryCode('GLOBAL')).to.equal('GLOBAL');

      ['', null, undefined, 'INVALID', '   '].forEach((input) => {
        expect(utils.validateCountryCode(input)).to.equal('GLOBAL');
      });
    });

    it('should validate country codes from URL paths', () => {
      const testCases = [
        { url: 'genuine/ooc-dm-twp-row-cx6-nc.html', expected: 'GLOBAL' },
        { url: 'th_th/genuine/ooc-dm-ses-cx6-nc.html', expected: 'TH' },
        { url: '/', expected: 'GLOBAL' },
        { url: 'in/creativecloud.html', expected: 'IN' },
        { url: 'kr/genuine/ooc-dm-ses-cx6-nc.html', expected: 'KR' },
        { url: 'upload', expected: 'GLOBAL' },
        { url: 'id_id/genuine/ooc-dm-ses-cx6-nc.html', expected: 'ID' },
        { url: '/uk/', expected: 'UK' },
        { url: '/se/', expected: 'SE' },
        { url: '/nl/products/pure-whey-protein/bpb-wpc8-0000', expected: 'NL' },
        { url: '/fr/search', expected: 'FR' },
        { url: '/ie/products/creatine-monohydrate/bpb-cmon-0000', expected: 'IE' },
        { url: '/sendfriend/', expected: 'GLOBAL' },
        { url: '/en-us/', expected: 'US' },
        { url: '/en-us/sportswear/women/new-arrivals', expected: 'US' },
        { url: '/en-gb/', expected: 'GB' },
      ];

      testCases.forEach(({ url, expected }) => {
        expect(utils.validateCountryCode(extractCC(url))).to.equal(expected);
      });
    });

    it('should build site filters', () => {
      expect(utils.buildSiteFilters([])).to.equal('');
      expect(utils.buildSiteFilters(null)).to.equal('');
      expect(utils.buildSiteFilters([{ key: 'domain', value: ['example.com'] }]))
        .to.equal("(REGEXP_LIKE(domain, '(?i)(example.com)'))");
      expect(utils.buildSiteFilters([{ key: 'domain', value: ['example.com', 'test.com'], type: 'include' }]))
        .to.equal("(REGEXP_LIKE(domain, '(?i)(example.com|test.com)'))");
      expect(utils.buildSiteFilters([{ key: 'domain', value: ['example.com', 'test.com'], type: 'exclude' }]))
        .to.equal("(NOT REGEXP_LIKE(domain, '(?i)(example.com|test.com)'))");
      expect(utils.buildSiteFilters([
        { key: 'domain', value: ['example.com'] },
        { key: 'status', value: ['200'] },
      ])).to.equal("(REGEXP_LIKE(domain, '(?i)(example.com)') AND REGEXP_LIKE(status, '(?i)(200)'))");
      expect(utils.buildSiteFilters([
        { key: 'domain', value: ['example.com', 'test.com'], type: 'exclude' },
        { key: 'status', value: ['200'], type: 'include' },
      ])).to.equal("(NOT REGEXP_LIKE(domain, '(?i)(example.com|test.com)') AND REGEXP_LIKE(status, '(?i)(200)'))");
    });
  });

  describe('Database Operations', () => {
    it('should load SQL and ensure table exists successfully', async () => {
      const reportUtils = await esmock('../../../src/cdn-logs-report/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves('CREATE TABLE test_table...'),
        },
      });

      const result = await reportUtils.loadSql('test-query', { table: 'test_table' });
      expect(result).to.equal('CREATE TABLE test_table...');

      const mockAthenaClient = { execute: sandbox.stub().resolves() };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_database',
        aggregatedLocation: 's3://test-bucket/aggregated/',
      };
      const mockLog = { info: sandbox.stub(), error: sandbox.stub() };

      await reportUtils.ensureTableExists(mockAthenaClient, mockS3Config, mockLog);
      expect(mockAthenaClient.execute.calledOnce).to.be.true;
      expect(mockLog.info.calledWith('Creating or checking table: test_table')).to.be.true;
      expect(mockLog.info.calledWith('Table test_table is ready')).to.be.true;
    });

    it('should handle database operation errors', async () => {
      const errorReportUtils = await esmock('../../../src/cdn-logs-report/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().rejects(new Error('SQL load failed')),
        },
      });

      const mockAthenaClient = { execute: sandbox.stub().resolves() };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_database',
        aggregatedLocation: 's3://test-bucket/aggregated/',
      };
      const mockLog = { info: sandbox.stub(), error: sandbox.stub() };

      try {
        await errorReportUtils.ensureTableExists(mockAthenaClient, mockS3Config, mockLog);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('SQL load failed');
        expect(mockLog.error.calledOnce).to.be.true;
      }
    });
  });
});
