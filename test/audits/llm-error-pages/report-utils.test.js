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

describe('LLM Error Pages - Report Utils', () => {
  let reportUtils;
  let sandbox;

  const mockSite = (baseURL, config = null) => ({
    getBaseURL: () => baseURL,
    getConfig: () => ({ getCdnLogsConfig: () => config }),
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Direct Import Tests', () => {
    before(async () => {
      reportUtils = await import('../../../src/llm-error-pages/utils/report-utils.js');
    });

    describe('getS3Config', () => {
      it('should generate S3 config from site URL', () => {
        const config = reportUtils.getS3Config(mockSite('https://example.com'));
        expect(config.customerName).to.equal('example');
        expect(config.customerDomain).to.equal('example_com');
        expect(config.databaseName).to.equal('cdn_logs_example_com');
        expect(config.tableName).to.equal('aggregated_logs_example_com');
      });

      it('should handle custom bucket config', () => {
        const config = reportUtils.getS3Config(mockSite('https://test.com', { bucketName: 'custom-bucket' }));
        expect(config.bucket).to.equal('custom-bucket');
        expect(config.customerName).to.equal('test');
        expect(config.customerDomain).to.equal('test_com');
      });

      it('should handle null config fallback', () => {
        const config = reportUtils.getS3Config(mockSite('https://empty.com', null));
        expect(config.bucket).to.equal('cdn-logs-empty-com');
        expect(config.customerName).to.equal('empty');
        expect(config.customerDomain).to.equal('empty_com');
      });

      it('should handle empty object config', () => {
        const config = reportUtils.getS3Config(mockSite('https://empty.com', {}));
        expect(config.bucket).to.be.undefined;
        expect(config.customerName).to.equal('empty');
        expect(config.customerDomain).to.equal('empty_com');
      });

      it('should generate correct temp location', () => {
        const config = reportUtils.getS3Config(mockSite('https://test.example.com'));
        expect(config.getAthenaTempLocation()).to.equal('s3://cdn-logs-test-example-com/temp/athena-results/');
      });

      it('should handle complex domain names', () => {
        const config = reportUtils.getS3Config(mockSite('https://sub-domain.multi-word-site.example-test.co.uk'));
        expect(config.customerDomain).to.equal('sub_domain_multi_word_site_example_test_co_uk');
        expect(config.customerName).to.equal('sub');
      });
    });

    describe('Date and Time Operations', () => {
      it('should create and validate date ranges', () => {
        const { startDate, endDate } = reportUtils.createDateRange('2025-01-01', '2025-01-07');
        expect(startDate.getUTCHours()).to.equal(0);
        expect(startDate.getUTCMinutes()).to.equal(0);
        expect(startDate.getUTCSeconds()).to.equal(0);
        expect(endDate.getUTCHours()).to.equal(23);
        expect(endDate.getUTCMinutes()).to.equal(59);
        expect(endDate.getUTCSeconds()).to.equal(59);
      });

      it('should throw error for invalid date format', () => {
        expect(() => reportUtils.createDateRange('invalid', '2025-01-07')).to.throw('Invalid date format provided');
        expect(() => reportUtils.createDateRange('2025-01-01', 'invalid')).to.throw('Invalid date format provided');
      });

      it('should throw error when start date is after end date', () => {
        expect(() => reportUtils.createDateRange('2025-01-07', '2025-01-01')).to.throw('Start date must be before end date');
      });

      it('should handle same start and end date', () => {
        const { startDate, endDate } = reportUtils.createDateRange('2025-01-01', '2025-01-01');
        expect(startDate.getUTCDate()).to.equal(endDate.getUTCDate());
        expect(startDate.getUTCHours()).to.equal(0);
        expect(endDate.getUTCHours()).to.equal(23);
      });

      it('should generate valid week ranges', () => {
        [new Date('2025-01-15T10:00:00Z'), new Date('2025-01-07T10:00:00Z')].forEach((date) => {
          const periods = reportUtils.generateReportingPeriods(date);
          expect(periods.weeks).to.be.an('array').with.lengthOf(1);
          expect(periods.columns).to.be.an('array');
          expect(periods.referenceDate).to.be.a('string');
          expect(periods.weeks[0].weekNumber).to.be.a('number').greaterThan(0).lessThan(54);
        });
      });

      it('should generate reporting periods for various dates', () => {
        [
          new Date('2025-01-15T10:00:00Z'),
          new Date('2025-01-01'),
          new Date('2025-12-31'),
          new Date('2024-02-29'), // Leap year test
          new Date('2025-01-07T10:00:00Z'),
        ].forEach((date) => {
          const periods = reportUtils.generateReportingPeriods(date);
          expect(periods.weeks).to.be.an('array').with.lengthOf(1);
          expect(periods.columns).to.be.an('array');
          expect(periods.referenceDate).to.be.a('string');
          expect(periods.weeks[0].weekNumber).to.be.a('number').greaterThan(0).lessThan(54);
        });
      });

      it('should handle year boundaries correctly', () => {
        const newYearPeriods = reportUtils.generateReportingPeriods(new Date('2025-01-01T00:00:00Z'));
        const endYearPeriods = reportUtils.generateReportingPeriods(new Date('2024-12-31T23:59:59Z'));

        expect(newYearPeriods.weeks[0].year).to.equal(2025);
        expect(endYearPeriods.weeks[0].year).to.equal(2024);
      });
    });

    describe('Site Filters', () => {
      it('should build site filters from array', () => {
        expect(reportUtils.buildSiteFilters([])).to.equal('');
        expect(reportUtils.buildSiteFilters(null)).to.equal('');
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: ['example.com'] }]))
          .to.equal("(REGEXP_LIKE(domain, '(?i)(example.com)'))");
      });

      it('should handle multiple values in single filter', () => {
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: ['example.com', 'test.com'], type: 'include' }]))
          .to.equal("(REGEXP_LIKE(domain, '(?i)(example.com|test.com)'))");
      });

      it('should handle exclude type filters', () => {
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: ['example.com', 'test.com'], type: 'exclude' }]))
          .to.equal("(NOT REGEXP_LIKE(domain, '(?i)(example.com|test.com)'))");
      });

      it('should handle multiple filters', () => {
        expect(reportUtils.buildSiteFilters([
          { key: 'domain', value: ['example.com'] },
          { key: 'status', value: ['200'] },
        ])).to.equal("(REGEXP_LIKE(domain, '(?i)(example.com)') AND REGEXP_LIKE(status, '(?i)(200)'))");
      });

      it('should handle mixed include and exclude filters', () => {
        expect(reportUtils.buildSiteFilters([
          { key: 'domain', value: ['example.com', 'test.com'], type: 'exclude' },
          { key: 'status', value: ['200'], type: 'include' },
        ])).to.equal("(NOT REGEXP_LIKE(domain, '(?i)(example.com|test.com)') AND REGEXP_LIKE(status, '(?i)(200)'))");
      });

      it('should handle empty values gracefully', () => {
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: [] }])).to.equal('');
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: null }])).to.equal('');
        expect(reportUtils.buildSiteFilters([{ key: 'domain', value: undefined }])).to.equal('');
      });
    });

    describe('Data Processing', () => {
      it('should process LLM error pages results', () => {
        const mockResults = [
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'ChatGPT', total_requests: 3,
          },
          {
            url: 'https://example.com/page2', status: 500, user_agent: 'Claude', total_requests: 2,
          },
          {
            url: 'https://example.com/page1', status: 404, user_agent: 'Gemini', total_requests: 1,
          },
        ];

        const processed = reportUtils.processLlmErrorPagesResults(mockResults);

        expect(processed.totalErrors).to.equal(6);
        expect(processed.errorPages).to.have.length(3);
        expect(processed.summary.uniqueUrls).to.equal(2);
        expect(processed.summary.uniqueUserAgents).to.equal(3);
        expect(processed.summary.statusCodes).to.deep.equal({ 404: 4, 500: 2 });
      });

      it('should handle empty results', () => {
        const processed = reportUtils.processLlmErrorPagesResults([]);

        expect(processed.totalErrors).to.equal(0);
        expect(processed.errorPages).to.have.length(0);
        expect(processed.summary.uniqueUrls).to.equal(0);
        expect(processed.summary.uniqueUserAgents).to.equal(0);
        expect(processed.summary.statusCodes).to.deep.equal({});
      });

      it('should handle null results', () => {
        const processed = reportUtils.processLlmErrorPagesResults(null);

        expect(processed.totalErrors).to.equal(0);
        expect(processed.errorPages).to.have.length(0);
        expect(processed.summary.uniqueUrls).to.equal(0);
        expect(processed.summary.uniqueUserAgents).to.equal(0);
        expect(processed.summary.statusCodes).to.deep.equal({});
      });

      it('should handle malformed data gracefully', () => {
        const malformedResults = [
          {
            url: null, status: 404, user_agent: 'ChatGPT', total_requests: 'invalid',
          },
          {
            url: 'https://example.com/page1', status: null, user_agent: null, total_requests: 2,
          },
          {}, // Empty object
        ];

        const processed = reportUtils.processLlmErrorPagesResults(malformedResults);

        expect(processed.totalErrors).to.be.a('number');
        expect(processed.errorPages).to.be.an('array');
        expect(processed.summary).to.be.an('object');
      });
    });
  });

  describe('Database Operations with Mocking', () => {
    it('should load SQL successfully', async () => {
      const mockReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves('CREATE TABLE test_table...'),
        },
      });

      const result = await mockReportUtils.loadSql('test-query', { table: 'test_table' });
      expect(result).to.equal('CREATE TABLE test_table...');
    });

    it('should validate database and table successfully (line 62)', async () => {
      // Clean test focused on validateDatabaseAndTable using internal-links pattern
      const mockReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js');

      const mockAthenaClient = { query: sandbox.stub().resolves() };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_database',
        aggregatedLocation: 's3://test-bucket/aggregated/',
      };
      const mockLog = { info: sandbox.stub(), error: sandbox.stub() };

      await mockReportUtils.validateDatabaseAndTable(mockAthenaClient, mockS3Config, mockLog);

      expect(mockAthenaClient.query.calledOnce).to.be.true;
      expect(mockLog.info.calledWith('Validating database and table: test_database.test_table')).to.be.true;
      expect(mockLog.info.calledWith('Database and table validated successfully')).to.be.true;
    });

    it('should handle database operation errors', async () => {
      const errorReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().rejects(new Error('SQL load failed')),
        },
      });

      try {
        await errorReportUtils.loadSql('test-query', { table: 'test_table' });
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('SQL load failed');
      }
    });

    it('should handle Athena execution errors', async () => {
      const mockReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves('CREATE TABLE test_table...'),
        },
      });

      const mockAthenaClient = { execute: sandbox.stub().rejects(new Error('Athena failed')) };
      const mockS3Config = {
        tableName: 'test_table',
        databaseName: 'test_database',
        aggregatedLocation: 's3://test-bucket/aggregated/',
      };
      const mockLog = { info: sandbox.stub(), error: sandbox.stub() };

      try {
        await mockReportUtils.validateDatabaseAndTable(mockAthenaClient, mockS3Config, mockLog);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.equal('Athena failed');
        expect(mockLog.error.calledOnce).to.be.true;
      }
    });

    it('should handle SQL template replacement', async () => {
      const mockReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves('CREATE TABLE {{table}} (id INT)'),
        },
      });

      const result = await mockReportUtils.loadSql('test-query', { table: 'test_table' });
      expect(result).to.equal('CREATE TABLE test_table (id INT)');
    });

    it('should handle multiple template variables', async () => {
      const mockReportUtils = await esmock('../../../src/llm-error-pages/utils/report-utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: sandbox.stub().resolves('SELECT * FROM {{database}}.{{table}} WHERE {{condition}}'),
        },
      });

      const result = await mockReportUtils.loadSql('test-query', {
        database: 'test_database',
        table: 'test_table',
        condition: 'status = 404',
      });
      expect(result).to.equal('SELECT * FROM test_database.test_table WHERE status = 404');
    });
  });

  describe('Period Identifier Generation', () => {
    it('should generate weekly identifier for 7-day periods', () => {
      const startDate = new Date('2025-01-06T00:00:00Z'); // Monday
      const endDate = new Date('2025-01-13T00:00:00Z'); // Next Monday (7 days)

      const result = reportUtils.generatePeriodIdentifier(startDate, endDate);

      // Should be in format w01-2025 (week 1 of 2025)
      expect(result).to.match(/^w\d{2}-\d{4}$/);
    });

    it('should generate range identifier for non-weekly periods', () => {
      const startDate = new Date('2025-01-01T00:00:00Z');
      const endDate = new Date('2025-01-05T00:00:00Z'); // 4 days, not 7

      const result = reportUtils.generatePeriodIdentifier(startDate, endDate);

      expect(result).to.equal('2025-01-01_to_2025-01-05');
    });

    it('should generate range identifier for longer periods', () => {
      const startDate = new Date('2025-01-01T00:00:00Z');
      const endDate = new Date('2025-01-31T00:00:00Z'); // 30 days

      const result = reportUtils.generatePeriodIdentifier(startDate, endDate);

      expect(result).to.equal('2025-01-01_to_2025-01-31');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    before(async () => {
      reportUtils = await import('../../../src/llm-error-pages/utils/report-utils.js');
    });

    it('should handle malformed site objects', () => {
      const malformedSites = [
        null,
        undefined,
        {},
        { getBaseURL: null },
        { getBaseURL: () => null },
        { getBaseURL: () => '' },
      ];

      malformedSites.forEach((site) => {
        expect(() => reportUtils.getS3Config(site)).to.not.throw();
      });
    });

    it('should handle invalid date strings', () => {
      const invalidDates = [
        'not-a-date',
        '2025-13-01', // Invalid month
        '2025-01-32', // Invalid day
        '2025/01/01', // Wrong format
        '',
        null,
        undefined,
      ];

      invalidDates.forEach((date) => {
        expect(() => reportUtils.createDateRange(date, '2025-01-07')).to.throw();
        expect(() => reportUtils.createDateRange('2025-01-01', date)).to.throw();
      });
    });

    it('should handle extreme date ranges', () => {
      // Very old dates
      const { startDate: oldStart, endDate: oldEnd } = reportUtils.createDateRange('1900-01-01', '1900-01-02');
      expect(oldStart.getUTCFullYear()).to.equal(1900);
      expect(oldEnd.getUTCFullYear()).to.equal(1900);

      // Far future dates
      const { startDate: futureStart, endDate: futureEnd } = reportUtils.createDateRange('2100-01-01', '2100-01-02');
      expect(futureStart.getUTCFullYear()).to.equal(2100);
      expect(futureEnd.getUTCFullYear()).to.equal(2100);
    });

    it('should handle leap year edge cases', () => {
      // Leap year
      const { startDate: leapStart, endDate: leapEnd } = reportUtils.createDateRange('2024-02-29', '2024-02-29');
      expect(leapStart.getUTCMonth()).to.equal(1); // February (0-indexed)
      expect(leapStart.getUTCDate()).to.equal(29);
      expect(leapEnd.getUTCDate()).to.equal(29);

      // Non-leap year - should throw for invalid date
      expect(() => reportUtils.createDateRange('2023-02-29', '2023-02-29')).to.throw();
    });

    it('should handle very large datasets in processing', () => {
      const largeResults = Array.from({ length: 10000 }, (_, i) => ({
        url: `https://example.com/page${i}`,
        status: 404,
        user_agent: `Agent${i % 5}`,
        total_requests: i + 1,
      }));

      const processed = reportUtils.processLlmErrorPagesResults(largeResults);

      expect(processed.totalErrors).to.be.a('number');
      expect(processed.errorPages).to.have.length(10000);
      expect(processed.summary.uniqueUrls).to.equal(10000);
      expect(processed.summary.uniqueUserAgents).to.equal(5);
    });

    it('should handle mixed data types in processing', () => {
      const mixedResults = [
        {
          url: 'https://example.com/page1', status: '404', user_agent: 'ChatGPT', total_requests: '3',
        },
        {
          url: 'https://example.com/page2', status: 500, user_agent: 'Claude', total_requests: 2.5,
        },
        {
          url: 'https://example.com/page3', status: null, user_agent: '', total_requests: 0,
        },
      ];

      const processed = reportUtils.processLlmErrorPagesResults(mixedResults);

      expect(processed.totalErrors).to.be.a('number');
      expect(processed.errorPages).to.be.an('array');
      expect(processed.summary).to.be.an('object');
    });

    it('should handle special characters in URLs and user agents', () => {
      const specialResults = [
        {
          url: 'https://example.com/页面', status: 404, user_agent: 'ChatGPT/1.0 (Special)', total_requests: 1,
        },
        {
          url: 'https://example.com/page?param=value&other=test', status: 500, user_agent: 'Agent <test>', total_requests: 2,
        },
        {
          url: 'https://example.com/path with spaces', status: 403, user_agent: 'Agent & Co.', total_requests: 1,
        },
      ];

      const processed = reportUtils.processLlmErrorPagesResults(specialResults);

      expect(processed.totalErrors).to.equal(4);
      expect(processed.errorPages).to.have.length(3);
      expect(processed.summary.uniqueUrls).to.equal(3);
      expect(processed.summary.uniqueUserAgents).to.equal(3);
    });
  });
});
