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
import esmock from 'esmock';
import {
  getLlmProviderPattern,
  getAllLlmProviders,
  buildLlmUserAgentFilter,
  normalizeUserAgentToProvider,
  extractCustomerDomain,
  getAnalysisBucket,
  getS3Config,
  formatDateString,
  getWeekRange,
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
  buildSiteFilters,
  processErrorPagesResults,
  categorizeErrorsByStatusCode,
  consolidateErrorsByUrl,
  sortErrorsByTrafficVolume,
  toPathOnly,
} from '../../../src/llm-error-pages/utils.js';

use(sinonChai);

describe('LLM Error Pages Utils', () => {
  let mockGetStaticContent;
  let utils;

  beforeEach(async () => {
    // Setup for future tests that need mocking
  });

  afterEach(() => {
    sinon.restore();
  });

  // ============================================================================
  // CONSTANTS TESTS
  // ============================================================================

  // describe('Constants', () => {
  //   it('should export LLM_USER_AGENT_PATTERNS', () => {
  //     expect(LLM_USER_AGENT_PATTERNS).to.be.an('object');
  //     expect(LLM_USER_AGENT_PATTERNS.chatgpt).to.include('ChatGPT');
  //     expect(LLM_USER_AGENT_PATTERNS.perplexity).to.include('Perplexity');
  //   });

  //   it('should have correct pattern structure', () => {
  //     const patterns = LLM_USER_AGENT_PATTERNS;
  //     expect(patterns.chatgpt).to.match(/\(\?i\)/);
  //     expect(patterns.perplexity).to.match(/\(\?i\)/);
  //     expect(patterns.claude).to.match(/\(\?i\)/);
  //     expect(patterns.gemini).to.match(/\(\?i\)/);
  //     expect(patterns.copilot).to.match(/\(\?i\)/);
  //   });
  // });

  // ============================================================================
  // LLM USER AGENT UTILITIES TESTS
  // ============================================================================

  describe('getLlmProviderPattern', () => {
    it('should return correct pattern for valid provider', () => {
      const result = getLlmProviderPattern('chatgpt');
      expect(result).to.equal('(?i)ChatGPT|GPTBot|OAI-SearchBot');
    });

    it('should return null for invalid provider', () => {
      const result = getLlmProviderPattern('invalid');
      expect(result).to.be.null;
    });

    it('should return null for empty string', () => {
      const result = getLlmProviderPattern('');
      expect(result).to.be.null;
    });

    it('should return null for non-string input', () => {
      const result = getLlmProviderPattern(123);
      expect(result).to.be.null;
    });

    it('should be case insensitive', () => {
      const result = getLlmProviderPattern('CHATGPT');
      expect(result).to.equal('(?i)ChatGPT|GPTBot|OAI-SearchBot');
    });
  });

  describe('getAllLlmProviders', () => {
    it('should return array of all provider names', () => {
      const providers = getAllLlmProviders();
      expect(providers).to.be.an('array');
      expect(providers).to.include('chatgpt');
      expect(providers).to.include('perplexity');
      expect(providers).to.include('claude');
      expect(providers).to.include('gemini');
      expect(providers).to.include('copilot');
    });
  });

  describe('buildLlmUserAgentFilter', () => {
    it('should build filter for specific providers', () => {
      const result = buildLlmUserAgentFilter(['chatgpt', 'perplexity']);
      expect(result).to.include('REGEXP_LIKE(user_agent,');
      expect(result).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(result).to.include('Perplexity');
    });

    it('should build filter for all providers when none specified', () => {
      const result = buildLlmUserAgentFilter();
      expect(result).to.include('REGEXP_LIKE(user_agent,');
      expect(result).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(result).to.include('Perplexity');
      expect(result).to.include('Claude|Anthropic');
      expect(result).to.include('Gemini');
      expect(result).to.include('Copilot');
    });

    it('should return null for empty providers array', () => {
      const result = buildLlmUserAgentFilter([]);
      expect(result).to.be.null;
    });

    it('should return null for invalid providers', () => {
      const result = buildLlmUserAgentFilter(['invalid']);
      expect(result).to.be.null;
    });
  });

  describe('normalizeUserAgentToProvider', () => {
    it('should normalize ChatGPT user agents', () => {
      expect(normalizeUserAgentToProvider('ChatGPT-User/1.0')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('GPTBot/1.0')).to.equal('ChatGPT');
      expect(normalizeUserAgentToProvider('OAI-SearchBot/1.0')).to.equal('ChatGPT');
    });

    it('should normalize Perplexity user agents', () => {
      expect(normalizeUserAgentToProvider('PerplexityBot/1.0')).to.equal('Perplexity');
      expect(normalizeUserAgentToProvider('perplexity-crawler')).to.equal('Perplexity');
    });

    it('should normalize Claude user agents', () => {
      expect(normalizeUserAgentToProvider('Claude-Web/1.0')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('Anthropic-ai/1.0')).to.equal('Claude');
    });

    it('should normalize Gemini user agents', () => {
      expect(normalizeUserAgentToProvider('GeminiBot/1.0')).to.equal('Gemini');
      expect(normalizeUserAgentToProvider('google-gemini')).to.equal('Gemini');
    });

    it('should normalize Copilot user agents', () => {
      expect(normalizeUserAgentToProvider('CopilotBot/1.0')).to.equal('Copilot');
      expect(normalizeUserAgentToProvider('microsoft-copilot')).to.equal('Copilot');
    });

    it('should return original user agent for unknown patterns', () => {
      const unknownAgent = 'Mozilla/5.0 (compatible; UnknownBot/1.0)';
      expect(normalizeUserAgentToProvider(unknownAgent)).to.equal(unknownAgent);
    });

    it('should handle edge cases', () => {
      expect(normalizeUserAgentToProvider('')).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(null)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(undefined)).to.equal('Unknown');
      expect(normalizeUserAgentToProvider(123)).to.equal('Unknown');
    });
  });

  // ============================================================================
  // QUERY BUILDING UTILITIES TESTS
  // ============================================================================

  describe('buildLlmErrorPagesQuery', () => {
    const mockOptions = {
      databaseName: 'test_db',
      tableName: 'test_table',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-07'),
      llmProviders: ['chatgpt'],
      siteFilters: ['(REGEXP_LIKE(url, \'(?i)(test)\'))'],
    };

    beforeEach(async () => {
      // Create a mock stub for getStaticContent
      mockGetStaticContent = sinon.stub().returns('SELECT * FROM test_table WHERE test_condition');

      // Mock the entire module using esmock
      utils = await esmock('../../../src/llm-error-pages/utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: mockGetStaticContent,
          tracingFetch: () => Promise.resolve({ status: 200 }),
        },
      });
    });

    it('should build query with all options', async () => {
      await utils.buildLlmErrorPagesQuery(mockOptions);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    it('should build query without date range', async () => {
      const optionsWithoutDates = { ...mockOptions };
      delete optionsWithoutDates.startDate;
      delete optionsWithoutDates.endDate;

      await utils.buildLlmErrorPagesQuery(optionsWithoutDates);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    it('should build query without LLM providers', async () => {
      const optionsWithoutProviders = { ...mockOptions };
      delete optionsWithoutProviders.llmProviders;

      await utils.buildLlmErrorPagesQuery(optionsWithoutProviders);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    it('should build query without site filters', async () => {
      const optionsWithoutFilters = { ...mockOptions };
      delete optionsWithoutFilters.siteFilters;

      await utils.buildLlmErrorPagesQuery(optionsWithoutFilters);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    it('should handle template with only static content', async () => {
      const minimalOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
      };

      await utils.buildLlmErrorPagesQuery(minimalOptions);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    // Test for missing coverage: buildWhereClause with no conditions
    it('should handle query with no conditions', async () => {
      const minimalOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
        startDate: null,
        endDate: null,
        llmProviders: null,
        siteFilters: [],
      };

      await utils.buildLlmErrorPagesQuery(minimalOptions);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });

    it('should handle cross-month/year date range', async () => {
      const crossMonthOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
        startDate: new Date('2024-12-25'), // December 25
        endDate: new Date('2025-01-05'), // January 5 (next year)
        llmProviders: null,
        siteFilters: [],
      };

      await utils.buildLlmErrorPagesQuery(crossMonthOptions);

      expect(mockGetStaticContent).to.have.been.calledWith({
        databaseName: 'test_db',
        tableName: 'test_table',
        whereClause: 'WHERE ((year = \'2024\' AND month = \'12\' AND day >= \'25\')\n       OR (year = \'2025\' AND month = \'01\' AND day <= \'05\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
      }, './src/llm-error-pages/sql/llm-error-pages.sql');
    });
  });

  // ============================================================================
  // SITE AND CONFIGURATION UTILITIES TESTS
  // ============================================================================

  describe('extractCustomerDomain', () => {
    it('should extract domain from base URL', () => {
      const mockSite = {
        getBaseURL: () => 'https://www.example.com',
      };

      const result = extractCustomerDomain(mockSite);
      expect(result).to.equal('www_example_com');
    });

    it('should handle special characters in domain', () => {
      const mockSite = {
        getBaseURL: () => 'https://test-site.example.co.uk',
      };

      const result = extractCustomerDomain(mockSite);
      expect(result).to.equal('test_site_example_co_uk');
    });
  });

  describe('getAnalysisBucket', () => {
    it('should create bucket name with CDN logs prefix', () => {
      const result = getAnalysisBucket('test_example_com');
      expect(result).to.equal('cdn-logs-test-example-com');
    });

    it('should replace dots and underscores with hyphens', () => {
      const result = getAnalysisBucket('test.example.com');
      expect(result).to.equal('cdn-logs-test-example-com');
    });
  });

  describe('getS3Config', () => {
    it('should return config with custom bucket when CDN logs config exists', () => {
      const mockSite = {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            bucketName: 'custom-bucket',
          }),
        }),
        getBaseURL: () => 'https://www.example.com',
      };

      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('custom-bucket');
      expect(result.customerName).to.equal('www');
      expect(result.customerDomain).to.equal('www_example_com');
      expect(result.aggregatedLocation).to.equal('s3://custom-bucket/aggregated/');
      expect(result.databaseName).to.equal('cdn_logs_www_example_com');
      expect(result.tableName).to.equal('aggregated_logs_www_example_com');
    });

    it('should return config with default bucket when no CDN logs config', () => {
      const mockSite = {
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
        getBaseURL: () => 'https://www.example.com',
      };

      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('cdn-logs-www-example-com');
      expect(result.customerName).to.equal('www');
      expect(result.customerDomain).to.equal('www_example_com');
    });

    it('should handle site with null config', () => {
      const mockSite = {
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
        getBaseURL: () => 'https://www.example.com',
      };

      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('cdn-logs-www-example-com');
    });

    it('should return config with callable getAthenaTempLocation function', () => {
      const mockSite = {
        getBaseURL: () => 'https://test.example.com',
        getConfig: () => ({
          getCdnLogsConfig: () => ({ bucketName: 'custom-bucket' }),
        }),
      };

      const result = getS3Config(mockSite);

      expect(result.getAthenaTempLocation).to.be.a('function');
      expect(result.getAthenaTempLocation()).to.equal('s3://custom-bucket/temp/athena-results/');
    });
  });

  // ============================================================================
  // DATE AND TIME UTILITIES TESTS
  // ============================================================================

  describe('formatDateString', () => {
    it('should format date to YYYY-MM-DD', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDateString(date);
      expect(result).to.equal('2024-01-15');
    });
  });

  describe('getWeekRange', () => {
    it('should return current week range when no offset', () => {
      const referenceDate = new Date('2024-01-15'); // Monday
      const result = getWeekRange(0, referenceDate);

      expect(result.weekStart).to.be.instanceOf(Date);
      expect(result.weekEnd).to.be.instanceOf(Date);
      expect(result.weekStart.getUTCDay()).to.equal(1); // Monday
      expect(result.weekEnd.getUTCDay()).to.equal(0); // Sunday
    });

    it('should return previous week range with offset', () => {
      const referenceDate = new Date('2024-01-15'); // Monday
      const result = getWeekRange(-1, referenceDate);

      expect(result.weekStart).to.be.instanceOf(Date);
      expect(result.weekEnd).to.be.instanceOf(Date);
      // Previous week should be 7 days before
      const expectedStart = new Date(referenceDate);
      expectedStart.setUTCDate(referenceDate.getUTCDate() - 7);
      expect(result.weekStart.getTime()).to.equal(expectedStart.getTime());
    });

    it('should handle different offset scenarios', () => {
      const referenceDate = new Date('2024-01-15'); // Monday

      // Test positive offset (future weeks)
      const futureWeek = getWeekRange(2, referenceDate);
      expect(futureWeek.weekStart).to.be.instanceOf(Date);
      expect(futureWeek.weekEnd).to.be.instanceOf(Date);

      // Test Sunday reference date
      const sundayDate = new Date('2024-01-14'); // Sunday
      const sundayWeek = getWeekRange(0, sundayDate);
      expect(sundayWeek.weekStart).to.be.instanceOf(Date);
      expect(sundayWeek.weekEnd).to.be.instanceOf(Date);
      expect(sundayWeek.weekStart.getUTCDay()).to.equal(1); // Should start on Monday
      expect(sundayWeek.weekEnd.getUTCDay()).to.equal(0); // Should end on Sunday
    });
  });

  describe('createDateRange', () => {
    it('should create valid date range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-07');
      const result = createDateRange(startDate, endDate);

      expect(result.startDate).to.be.instanceOf(Date);
      expect(result.endDate).to.be.instanceOf(Date);
      expect(result.startDate.getUTCHours()).to.equal(0);
      expect(result.endDate.getUTCHours()).to.equal(23);
    });

    it('should throw error for invalid date format', () => {
      expect(() => createDateRange('invalid', '2024-01-07')).to.throw('Invalid date format provided');
    });

    it('should throw error when start date is after end date', () => {
      const startDate = new Date('2024-01-07');
      const endDate = new Date('2024-01-01');
      expect(() => createDateRange(startDate, endDate)).to.throw('Start date must be before end date');
    });
  });

  describe('generatePeriodIdentifier', () => {
    it('should generate week identifier for 7-day range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-08'); // 8 days to get 7-day difference
      const result = generatePeriodIdentifier(startDate, endDate);

      expect(result).to.match(/^w\d{2}-\d{4}$/);
    });

    it('should generate date range identifier for non-week range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-10');
      const result = generatePeriodIdentifier(startDate, endDate);

      expect(result).to.equal('2024-01-01_to_2024-01-10');
    });
  });

  describe('generateReportingPeriods', () => {
    it('should generate reporting periods for reference date', () => {
      const referenceDate = new Date('2024-01-15');
      const result = generateReportingPeriods(referenceDate);

      expect(result.weeks).to.be.an('array');
      expect(result.weeks).to.have.length(1);
      expect(result.weeks[0]).to.have.property('weekNumber');
      expect(result.weeks[0]).to.have.property('year');
      expect(result.weeks[0]).to.have.property('weekLabel');
      expect(result.weeks[0]).to.have.property('startDate');
      expect(result.weeks[0]).to.have.property('endDate');
      expect(result.weeks[0]).to.have.property('dateRange');
      expect(result.referenceDate).to.equal(referenceDate.toISOString());
      expect(result.columns).to.be.an('array');
    });
  });

  // ============================================================================
  // FILTERING TESTS
  // ============================================================================

  describe('buildSiteFilters', () => {
    it('should build include filter', () => {
      const filters = [{
        key: 'url',
        value: ['test', 'example'],
        type: 'include',
      }];

      const result = buildSiteFilters(filters);
      expect(result).to.equal('(REGEXP_LIKE(url, \'(?i)(test|example)\'))');
    });

    it('should build exclude filter', () => {
      const filters = [{
        key: 'url',
        value: ['test', 'example'],
        type: 'exclude',
      }];

      const result = buildSiteFilters(filters);
      expect(result).to.equal('(NOT REGEXP_LIKE(url, \'(?i)(test|example)\'))');
    });

    it('should build multiple filters', () => {
      const filters = [
        {
          key: 'url',
          value: ['test'],
          type: 'include',
        },
        {
          key: 'domain',
          value: ['example'],
          type: 'exclude',
        },
      ];

      const result = buildSiteFilters(filters);
      expect(result).to.equal('(REGEXP_LIKE(url, \'(?i)(test)\') AND NOT REGEXP_LIKE(domain, \'(?i)(example)\'))');
    });

    it('should return empty string for empty filters', () => {
      expect(buildSiteFilters([])).to.equal('');
      expect(buildSiteFilters(null)).to.equal('');
      expect(buildSiteFilters(undefined)).to.equal('');
    });
  });

  // ============================================================================
  // PROCESSING RESULTS TESTS
  // ============================================================================

  describe('processErrorPagesResults', () => {
    it('should process valid results', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: '404', total_requests: '100', user_agent: 'ChatGPT',
        },
        {
          url: 'https://example.com/2', status: '403', total_requests: '50', user_agent: 'Perplexity',
        },
        {
          url: 'https://example.com/1', status: '404', total_requests: '25', user_agent: 'Claude',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.totalErrors).to.equal(175);
      expect(result.errorPages).to.have.length(3);
      expect(result.summary.uniqueUrls).to.equal(2);
      expect(result.summary.uniqueUserAgents).to.equal(3);
      expect(result.summary.statusCodes['404']).to.equal(125);
      expect(result.summary.statusCodes['403']).to.equal(50);
    });

    it('should handle empty results', () => {
      const result = processErrorPagesResults([]);

      expect(result.totalErrors).to.equal(0);
      expect(result.errorPages).to.have.length(0);
      expect(result.summary.uniqueUrls).to.equal(0);
      expect(result.summary.uniqueUserAgents).to.equal(0);
      expect(result.summary.statusCodes).to.deep.equal({});
    });

    it('should handle null/undefined results', () => {
      const result = processErrorPagesResults(null);

      expect(result.totalErrors).to.equal(0);
      expect(result.errorPages).to.have.length(0);
    });

    it('should handle invalid total_requests values', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: '404', total_requests: 'invalid', user_agent: 'ChatGPT',
        },
        {
          url: 'https://example.com/2', status: '403', total_requests: undefined, user_agent: 'Perplexity',
        },
        {
          url: 'https://example.com/3', status: '500', total_requests: null, user_agent: 'Claude',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.totalErrors).to.equal(0);
      expect(result.errorPages[0].total_requests).to.equal(0);
      expect(result.errorPages[1].total_requests).to.equal(0);
      expect(result.errorPages[2].total_requests).to.equal(0);
    });

    it('should ensure total_requests is an integer in original object', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: '404', total_requests: '100', user_agent: 'ChatGPT',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.errorPages[0].total_requests).to.equal(100);
      expect(typeof result.errorPages[0].total_requests).to.equal('number');
    });

    it('should handle missing or falsy status values', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: null, total_requests: '100', user_agent: 'ChatGPT',
        },
        {
          url: 'https://example.com/2', status: undefined, total_requests: '50', user_agent: 'Perplexity',
        },
        { url: 'https://example.com/3', total_requests: '75', user_agent: 'Claude' }, // No status property
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.summary.statusCodes.Unknown).to.equal(225); // 100 + 50 + 75
      // The function doesn't modify the original status values, it just uses them for the summary
      expect(result.errorPages[0].status).to.equal(null);
      expect(result.errorPages[1].status).to.equal(undefined);
      expect(result.errorPages[2].status).to.equal(undefined); // No status property
    });
  });

  describe('categorizeErrorsByStatusCode', () => {
    it('should categorize errors correctly', () => {
      const mockErrors = [
        { status: '404', url: 'https://example.com/1' },
        { status: '403', url: 'https://example.com/2' },
        { status: '500', url: 'https://example.com/3' },
        { status: '502', url: 'https://example.com/4' },
        { status: '400', url: 'https://example.com/5' },
      ];

      const result = categorizeErrorsByStatusCode(mockErrors);

      expect(result['404']).to.have.length(1);
      expect(result['403']).to.have.length(1);
      expect(result['5xx']).to.have.length(2);
      expect(result['404'][0].url).to.equal('https://example.com/1');
      expect(result['403'][0].url).to.equal('https://example.com/2');
      expect(result['5xx'][0].url).to.equal('https://example.com/3');
      expect(result['5xx'][1].url).to.equal('https://example.com/4');
    });

    it('should handle string and number status codes', () => {
      const mockErrors = [
        { status: 404, url: 'https://example.com/1' },
        { status: '403', url: 'https://example.com/2' },
      ];

      const result = categorizeErrorsByStatusCode(mockErrors);

      expect(result['404']).to.have.length(1);
      expect(result['403']).to.have.length(1);
    });

    it('should handle missing status codes', () => {
      const mockErrors = [
        { status: null, url: 'https://example.com/1' },
        { status: undefined, url: 'https://example.com/2' },
        { url: 'https://example.com/3' },
      ];

      const result = categorizeErrorsByStatusCode(mockErrors);

      // Since there are no valid status codes, no keys should be created
      expect(result['404']).to.be.undefined;
      expect(result['403']).to.be.undefined;
      expect(result['5xx']).to.be.undefined;
      expect(Object.keys(result)).to.have.length(0);
    });
  });

  describe('consolidateErrorsByUrl', () => {
    it('should consolidate errors by URL and normalized user agent', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1', status: '404', user_agent: 'ChatGPT-User/1.0', total_requests: 100,
        },
        {
          url: 'https://example.com/1', status: '404', user_agent: 'GPTBot/1.0', total_requests: 50,
        },
        {
          url: 'https://example.com/2', status: '403', user_agent: 'PerplexityBot/1.0', total_requests: 75,
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(2);

      const firstResult = result.find((r) => r.url === 'https://example.com/1');
      expect(firstResult.status).to.equal('404');
      expect(firstResult.userAgent).to.equal('ChatGPT');
      expect(firstResult.totalRequests).to.equal(150);
      expect(firstResult.rawUserAgents).to.include('ChatGPT-User/1.0');
      expect(firstResult.rawUserAgents).to.include('GPTBot/1.0');

      const secondResult = result.find((r) => r.url === 'https://example.com/2');
      expect(secondResult.status).to.equal('403');
      expect(secondResult.userAgent).to.equal('Perplexity');
      expect(secondResult.totalRequests).to.equal(75);
      expect(secondResult.rawUserAgents).to.include('PerplexityBot/1.0');
    });

    it('should handle single error per URL', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1', status: '404', user_agent: 'ChatGPT-User/1.0', total_requests: 100,
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com/1');
      expect(result[0].totalRequests).to.equal(100);
      expect(result[0].rawUserAgents).to.have.length(1);
    });
  });

  describe('sortErrorsByTrafficVolume', () => {
    it('should sort errors by total requests in descending order', () => {
      const mockErrors = [
        { url: 'https://example.com/1', totalRequests: 50 },
        { url: 'https://example.com/2', totalRequests: 100 },
        { url: 'https://example.com/3', totalRequests: 25 },
      ];

      const result = sortErrorsByTrafficVolume(mockErrors);

      expect(result[0].totalRequests).to.equal(100);
      expect(result[1].totalRequests).to.equal(50);
      expect(result[2].totalRequests).to.equal(25);
    });

    it('should handle empty array', () => {
      const result = sortErrorsByTrafficVolume([]);
      expect(result).to.have.length(0);
    });
  });

  // ============================================================================
  // URL HELPERS TESTS
  // ============================================================================

  describe('toPathOnly', () => {
    it('returns path + query from absolute URL', () => {
      const result = toPathOnly('https://example.com/path/to/page?x=1&y=2');
      expect(result).to.equal('/path/to/page?x=1&y=2');
    });

    it('returns same string when already a path', () => {
      const result = toPathOnly('/just/a/path');
      expect(result).to.equal('/just/a/path');
    });

    it('resolves relative path against provided baseUrl', () => {
      const result = toPathOnly('relative/page?foo=bar', 'https://base.example');
      expect(result).to.equal('/relative/page?foo=bar');
    });

    it('handles invalid URL-like strings safely', () => {
      const invalid = '://not-a-valid-url';
      const result = toPathOnly(invalid);
      // With base fallback, this is treated as a path
      expect(result).to.equal('/://not-a-valid-url');
    });
  });
});
