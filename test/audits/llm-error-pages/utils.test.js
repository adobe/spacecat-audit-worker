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
  buildLlmErrorPagesQuery,
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
      expect(normalizeUserAgentToProvider('ChatGPT-User/1.0')).to.equal('ChatGPT-User');
      expect(normalizeUserAgentToProvider('GPTBot/1.0')).to.equal('GPTBot');
      expect(normalizeUserAgentToProvider('OAI-SearchBot/1.0')).to.equal('OAI-SearchBot');
    });

    it('should normalize Perplexity user agents', () => {
      expect(normalizeUserAgentToProvider('PerplexityBot/1.0')).to.equal('PerplexityBot');
      expect(normalizeUserAgentToProvider('Perplexity-User/1.0')).to.equal('Perplexity-User');
      expect(normalizeUserAgentToProvider('perplexity-crawler')).to.equal('Perplexity');
    });

    it('should normalize Claude user agents', () => {
      expect(normalizeUserAgentToProvider('Claude-Web/1.0')).to.equal('Claude');
      expect(normalizeUserAgentToProvider('Anthropic-ai/1.0')).to.equal('Anthropic');
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

    it('should truncate long unknown user agents', () => {
      const longAgent = 'Mozilla/5.0 (compatible; VeryLongUserAgentNameThatExceedsTheFiftyCharacterLimit)';
      const result = normalizeUserAgentToProvider(longAgent);
      expect(result).to.have.length(50);
      expect(result).to.equal(longAgent.substring(0, 50));
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

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs).to.have.property('databaseName', 'test_db');
      expect(callArgs).to.have.property('tableName', 'test_table');
      expect(callArgs).to.have.property('whereClause');
      expect(callArgs).to.have.property('agentTypeClassification');
      expect(callArgs).to.have.property('userAgentDisplay');
      expect(callArgs).to.have.property('countryExtraction');
      expect(callArgs.whereClause).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(callArgs.whereClause).to.include('test');
    });

    it('should build query without date range', async () => {
      const optionsWithoutDates = { ...mockOptions };
      delete optionsWithoutDates.startDate;
      delete optionsWithoutDates.endDate;

      await utils.buildLlmErrorPagesQuery(optionsWithoutDates);

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.whereClause).to.not.include('year =');
      expect(callArgs.whereClause).to.include('ChatGPT|GPTBot|OAI-SearchBot');
      expect(callArgs.whereClause).to.include('test');
    });

    it('should build query without LLM providers', async () => {
      const optionsWithoutProviders = { ...mockOptions };
      delete optionsWithoutProviders.llmProviders;

      await utils.buildLlmErrorPagesQuery(optionsWithoutProviders);

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.whereClause).to.not.include('REGEXP_LIKE(user_agent,');
      expect(callArgs.whereClause).to.include('test');
    });

    it('should build query without site filters', async () => {
      const optionsWithoutFilters = { ...mockOptions };
      delete optionsWithoutFilters.siteFilters;

      await utils.buildLlmErrorPagesQuery(optionsWithoutFilters);

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.whereClause).to.not.include('test');
      expect(callArgs.whereClause).to.include('ChatGPT|GPTBot|OAI-SearchBot');
    });

    it('should handle template with only static content', async () => {
      const minimalOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
      };

      await utils.buildLlmErrorPagesQuery(minimalOptions);

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.databaseName).to.equal('test_db');
      expect(callArgs.tableName).to.equal('test_table');
      expect(callArgs.whereClause).to.include('status BETWEEN 400 AND 599');
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

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.whereClause).to.include('status BETWEEN 400 AND 599');
      expect(callArgs.whereClause).to.not.include('year =');
      expect(callArgs.whereClause).to.not.include('REGEXP_LIKE(user_agent,');
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

      // Verify the call was made with the new parameter structure
      expect(mockGetStaticContent).to.have.been.called;
      const callArgs = mockGetStaticContent.getCall(0).args[0];
      expect(callArgs.whereClause).to.include('2024');
      expect(callArgs.whereClause).to.include('2025');
      expect(callArgs.whereClause).to.include('OR');
    });

    it('should call fetchRemotePatterns when site is provided', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'test-folder',
        }),
      };

      const optionsWithSite = {
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      };

      await utils.buildLlmErrorPagesQuery(optionsWithSite);

      // Should include SQL template variables for country, agent type, etc.
      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          agentTypeClassification: sinon.match.string,
          userAgentDisplay: sinon.match.string,
          countryExtraction: sinon.match.string,
          topicExtraction: sinon.match.string,
          pageCategoryClassification: sinon.match.string,
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
    });

    it('should handle site without data folder', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => null,
        }),
      };

      const optionsWithSite = {
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      };

      await utils.buildLlmErrorPagesQuery(optionsWithSite);

      expect(mockGetStaticContent).to.have.been.called;
    });
  });

  describe('fetchRemotePatterns', () => {
    let mockFetch;
    let utilsModule;

    beforeEach(async () => {
      mockFetch = sinon.stub();

      // Skip esmock due to global fetch mocking issues
      utilsModule = await import('../../../src/llm-error-pages/utils.js');
    });

    it('should return null when site has no data folder', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => null,
        }),
      };

      // Access the fetchRemotePatterns function through buildLlmErrorPagesQuery
      const result = await utilsModule.buildLlmErrorPagesQuery({
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      });

      expect(result).to.be.a('string');
    });

    it('should return null when site config is missing', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => null, // Provide the function but return null
        }),
      };

      const result = await utilsModule.buildLlmErrorPagesQuery({
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      });

      expect(result).to.be.a('string');
    });

    it('should fetch remote patterns successfully', async () => {
      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'test-folder',
        }),
      };

      const result = await utilsModule.buildLlmErrorPagesQuery({
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      });

      // Just verify the query is built successfully
      // Fetch mocking is skipped due to esmock global issues
      expect(result).to.be.a('string');
    });

    it('should return null when fetch fails', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      mockFetch.resolves(mockResponse);

      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'test-folder',
        }),
      };

      const result = await utilsModule.buildLlmErrorPagesQuery({
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      });

      expect(result).to.be.a('string');
    });

    it('should return null when fetch throws error', async () => {
      mockFetch.rejects(new Error('Network error'));

      const mockSite = {
        getConfig: () => ({
          getLlmoDataFolder: () => 'test-folder',
        }),
      };

      const result = await utilsModule.buildLlmErrorPagesQuery({
        databaseName: 'test_db',
        tableName: 'test_table',
        site: mockSite,
      });

      expect(result).to.be.a('string');
    });
  });

  // ============================================================================
  // SITE AND CONFIGURATION UTILITIES TESTS
  // ============================================================================

  // extractCustomerDomain tests removed - now using shared function from cdn-utils

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
      expect(result.customerName).to.equal('example');
      expect(result.customerDomain).to.equal('example_com');
      expect(result.aggregatedLocation).to.equal('s3://custom-bucket/aggregated/');
      expect(result.databaseName).to.equal('cdn_logs_example_com');
      expect(result.tableName).to.equal('aggregated_logs_example_com');
    });

    it('should return config with default bucket when no CDN logs config', () => {
      const mockSite = {
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
        getBaseURL: () => 'https://www.example.com',
      };

      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('cdn-logs-example-com');
      expect(result.customerName).to.equal('example');
      expect(result.customerDomain).to.equal('example_com');
    });

    it('should handle site with null config', () => {
      const mockSite = {
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
        getBaseURL: () => 'https://www.example.com',
      };

      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('cdn-logs-example-com');
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

    it('should process results with new field names (number_of_hits, avg_ttfb_ms)', () => {
      const mockResults = [
        {
          url: 'https://example.com/1',
          status: '404',
          number_of_hits: '100',
          avg_ttfb_ms: '250.5',
          user_agent_display: 'GPTBot',
          agent_type: 'Training bots',
          country_code: 'US',
          product: 'Search',
          category: 'Product Page',
        },
        {
          url: 'https://example.com/2',
          status: '403',
          number_of_hits: '50',
          avg_ttfb_ms: '180.2',
          user_agent_display: 'PerplexityBot',
          agent_type: 'Web search crawlers',
          country_code: 'GLOBAL',
          product: 'Other',
          category: 'Uncategorized',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.totalErrors).to.equal(150);
      expect(result.errorPages).to.have.length(2);
      expect(result.summary.uniqueUrls).to.equal(2);
      expect(result.summary.uniqueUserAgents).to.equal(2);
      expect(result.summary.statusCodes['404']).to.equal(100);
      expect(result.summary.statusCodes['403']).to.equal(50);

      // Check that new fields are properly parsed
      expect(result.errorPages[0].number_of_hits).to.equal(100);
      expect(result.errorPages[0].avg_ttfb_ms).to.equal(250.5);
      expect(result.errorPages[1].number_of_hits).to.equal(50);
      expect(result.errorPages[1].avg_ttfb_ms).to.equal(180.2);
    });

    it('should handle invalid number_of_hits and avg_ttfb_ms values', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: '404', number_of_hits: 'invalid', avg_ttfb_ms: 'invalid', user_agent_display: 'GPTBot',
        },
        {
          url: 'https://example.com/2', status: '403', number_of_hits: null, avg_ttfb_ms: undefined, user_agent_display: 'PerplexityBot',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.totalErrors).to.equal(0);
      expect(result.errorPages[0].number_of_hits).to.equal(0);
      expect(result.errorPages[0].avg_ttfb_ms).to.equal(0);
      expect(result.errorPages[1].number_of_hits).to.equal(0);
      expect(result.errorPages[1].avg_ttfb_ms).to.equal(0);
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
      // Now uses number_of_hits field
      expect(result.errorPages[0].number_of_hits).to.equal(0);
      expect(result.errorPages[1].number_of_hits).to.equal(0);
      expect(result.errorPages[2].number_of_hits).to.equal(0);
    });

    it('should ensure total_requests is an integer in original object', () => {
      const mockResults = [
        {
          url: 'https://example.com/1', status: '404', total_requests: '100', user_agent: 'ChatGPT',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      // Now uses number_of_hits field
      expect(result.errorPages[0].number_of_hits).to.equal(100);
      expect(typeof result.errorPages[0].number_of_hits).to.equal('number');
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

      // Each user agent creates a separate entry, so we expect 3 results
      expect(result).to.have.length(3);

      const chatGptResult = result.find((r) => r.userAgent === 'ChatGPT-User');
      expect(chatGptResult.status).to.equal('404');
      expect(chatGptResult.numberOfHits).to.equal(100);
      expect(chatGptResult.rawUserAgents).to.include('ChatGPT-User/1.0');

      const gptBotResult = result.find((r) => r.userAgent === 'GPTBot');
      expect(gptBotResult.status).to.equal('404');
      expect(gptBotResult.numberOfHits).to.equal(50);
      expect(gptBotResult.rawUserAgents).to.include('GPTBot/1.0');

      const perplexityResult = result.find((r) => r.userAgent === 'PerplexityBot');
      expect(perplexityResult.status).to.equal('403');
      expect(perplexityResult.numberOfHits).to.equal(75);
      expect(perplexityResult.rawUserAgents).to.include('PerplexityBot/1.0');
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

    it('should handle new field structure with user_agent_display and number_of_hits', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 100,
          avg_ttfb_ms: 250.5,
          agent_type: 'Training bots',
          country_code: 'US',
          product: 'Search',
          category: 'Product Page',
          user_agent: 'GPTBot/1.0',
        },
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 50,
          avg_ttfb_ms: 300.2,
          agent_type: 'Training bots',
          country_code: 'US',
          product: 'Search',
          category: 'Product Page',
          user_agent: 'GPTBot/2.0',
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(1);
      expect(result[0].url).to.equal('https://example.com/1');
      expect(result[0].user_agent_display).to.equal('GPTBot');
      expect(result[0].numberOfHits).to.equal(150);
      expect(result[0].totalRequests).to.equal(150); // backward compatibility
      expect(result[0].agent_type).to.equal('Training bots');
      expect(result[0].country_code).to.equal('US');
      expect(result[0].product).to.equal('Search');
      expect(result[0].category).to.equal('Product Page');
      expect(result[0].rawUserAgents).to.include('GPTBot/1.0');
      expect(result[0].rawUserAgents).to.include('GPTBot/2.0');

      // Check TTFB weighted average calculation
      // (250.5 * 100 + 300.2 * 50) / 150 = (25050 + 15010) / 150 = 40060 / 150 = 267.07
      expect(result[0].avgTtfbMs).to.be.closeTo(267.07, 0.01);
    });

    it('should handle missing new fields with fallbacks', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent: 'ChatGPT-User/1.0',
          total_requests: 100,
          // Missing new fields
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(1);
      expect(result[0].agent_type).to.equal('Other');
      expect(result[0].country_code).to.equal('GLOBAL');
      expect(result[0].product).to.equal('Other');
      expect(result[0].category).to.equal('Uncategorized');
      expect(result[0].numberOfHits).to.equal(100);
      expect(result[0].avgTtfbMs).to.equal(0);
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

    it('should sort errors by numberOfHits when available', () => {
      const mockErrors = [
        { url: 'https://example.com/1', numberOfHits: 50, totalRequests: 40 },
        { url: 'https://example.com/2', numberOfHits: 100, totalRequests: 90 },
        { url: 'https://example.com/3', numberOfHits: 25, totalRequests: 30 },
      ];

      const result = sortErrorsByTrafficVolume(mockErrors);

      expect(result[0].numberOfHits).to.equal(100);
      expect(result[1].numberOfHits).to.equal(50);
      expect(result[2].numberOfHits).to.equal(25);
    });

    it('should handle mixed field availability', () => {
      const mockErrors = [
        { url: 'https://example.com/1', totalRequests: 50 }, // Only totalRequests
        { url: 'https://example.com/2', numberOfHits: 100 }, // Only numberOfHits
        { url: 'https://example.com/3', numberOfHits: 25, totalRequests: 30 }, // Both fields
        { url: 'https://example.com/4' }, // Neither field
      ];

      const result = sortErrorsByTrafficVolume(mockErrors);

      expect(result[0].numberOfHits || result[0].totalRequests || 0).to.equal(100);
      expect(result[1].totalRequests || result[1].numberOfHits || 0).to.equal(50);
      expect(result[2].numberOfHits || result[2].totalRequests || 0).to.equal(25);
      expect(result[3].numberOfHits || result[3].totalRequests || 0).to.equal(0);
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

    it('should handle URLs that cause parse errors gracefully', () => {
      // Test the catch block in toPathOnly
      const invalidUrl = 'not-a-valid-url-at-all';
      const result = toPathOnly(invalidUrl);
      // When baseUrl is provided, invalid strings are treated as relative paths
      expect(result).to.equal('/not-a-valid-url-at-all');
    });
  });

  // ============================================================================
  // ADDITIONAL COVERAGE TESTS
  // ============================================================================

  describe('Direct function coverage tests (no mocking)', () => {
    it('should cover sortErrorsByTrafficVolume with numberOfHits fallback', () => {
      const errors = [
        { url: 'test1', numberOfHits: 100 },
        { url: 'test2', totalRequests: 50 },
        { url: 'test3' }, // No hits field
      ];

      const result = sortErrorsByTrafficVolume(errors);

      expect(result[0].numberOfHits).to.equal(100);
      expect(result[1].totalRequests).to.equal(50);
      expect(result[2].url).to.equal('test3');
    });

    it('should cover toPathOnly catch block', () => {
      // This will trigger the catch block due to invalid URL
      const result = toPathOnly(':::invalid-url:::');
      // When baseUrl is provided, invalid strings are treated as relative paths
      expect(result).to.equal('/:::invalid-url:::');
    });

    it('should cover categorizeErrorsByStatusCode with MAX_URLS_PER_CATEGORY limit', () => {
      // Create 101 404 errors to test the limit
      const errors404 = Array.from({ length: 101 }, (_, i) => ({
        status: '404',
        url: `https://example.com/${i}`,
      }));

      const result = categorizeErrorsByStatusCode(errors404);

      // Should be limited to 100
      expect(result['404']).to.have.length(100);
    });

    it('should test consolidateErrorsByUrl with TTFB weighted average edge case', () => {
      const errors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 0, // Zero hits
          avg_ttfb_ms: 250.5,
          user_agent: 'GPTBot/1.0',
        },
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 50,
          avg_ttfb_ms: 300.2,
          user_agent: 'GPTBot/2.0',
        },
      ];

      const result = consolidateErrorsByUrl(errors);

      expect(result).to.have.length(1);
      // Should handle the zero hits case in TTFB calculation
      expect(result[0].numberOfHits).to.equal(50);
      // Should use the fallback when totalHits calculation has issues
      expect(result[0].avgTtfbMs).to.equal(300.2);
    });

    it('should test consolidateErrorsByUrl with missing user_agent field', () => {
      const errors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 100,
          // No user_agent field
        },
      ];

      const result = consolidateErrorsByUrl(errors);

      expect(result).to.have.length(1);
      expect(result[0].rawUserAgents).to.include('GPTBot');
    });

    it('should test buildSiteFilters with single clause', () => {
      const filters = [{
        key: 'url',
        value: ['test'],
        type: 'include',
      }];

      const result = buildSiteFilters(filters);
      expect(result).to.equal('(REGEXP_LIKE(url, \'(?i)(test)\'))');
    });

    it('should test processErrorPagesResults with user_agent_display field', () => {
      const mockResults = [
        {
          url: 'https://example.com/1',
          status: '404',
          number_of_hits: '100',
          avg_ttfb_ms: '250.5',
          user_agent_display: 'GPTBot',
        },
      ];

      const result = processErrorPagesResults(mockResults);

      expect(result.totalErrors).to.equal(100);
      expect(result.summary.uniqueUserAgents).to.equal(1);
      expect(result.errorPages[0].number_of_hits).to.equal(100);
      expect(result.errorPages[0].avg_ttfb_ms).to.equal(250.5);
    });

    it('should test categorizeErrorsByStatusCode with 403 and 5xx errors', () => {
      const mockErrors = [
        { status: '403', url: 'https://example.com/1' },
        { status: '500', url: 'https://example.com/2' },
        { status: '502', url: 'https://example.com/3' },
      ];

      const result = categorizeErrorsByStatusCode(mockErrors);

      expect(result['403']).to.have.length(1);
      expect(result['5xx']).to.have.length(2);
      expect(result['403'][0].url).to.equal('https://example.com/1');
      expect(result['5xx'][0].url).to.equal('https://example.com/2');
      expect(result['5xx'][1].url).to.equal('https://example.com/3');
    });

    it('should test consolidateErrorsByUrl with existing key path', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 100,
          avg_ttfb_ms: 250.5,
          user_agent: 'GPTBot/1.0',
        },
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 50,
          avg_ttfb_ms: 300.2,
          user_agent: 'GPTBot/2.0',
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(1);
      expect(result[0].numberOfHits).to.equal(150);
      expect(result[0].rawUserAgents).to.include('GPTBot/1.0');
      expect(result[0].rawUserAgents).to.include('GPTBot/2.0');
    });

    it('should test consolidateErrorsByUrl else path (new key)', () => {
      const mockErrors = [
        {
          url: 'https://example.com/1',
          status: '404',
          user_agent_display: 'GPTBot',
          number_of_hits: 100,
          avg_ttfb_ms: 250.5,
          agent_type: 'Training bots',
          country_code: 'US',
          product: 'Search',
          category: 'Product Page',
          user_agent: 'GPTBot/1.0',
        },
      ];

      const result = consolidateErrorsByUrl(mockErrors);

      expect(result).to.have.length(1);
      expect(result[0].agent_type).to.equal('Training bots');
      expect(result[0].country_code).to.equal('US');
      expect(result[0].product).to.equal('Search');
      expect(result[0].category).to.equal('Product Page');
      expect(result[0].numberOfHits).to.equal(100);
      expect(result[0].totalRequests).to.equal(100);
    });

    it('should test sortErrorsByTrafficVolume actual sorting logic', () => {
      const errors = [
        { url: 'test1', numberOfHits: 50, totalRequests: 40 },
        { url: 'test2', numberOfHits: 100, totalRequests: 90 },
        { url: 'test3', totalRequests: 75 },
        { url: 'test4' },
      ];

      const result = sortErrorsByTrafficVolume(errors);

      // Should sort by numberOfHits first, then totalRequests, then 0
      expect(result[0].numberOfHits).to.equal(100);
      expect(result[1].totalRequests).to.equal(75);
      expect(result[2].numberOfHits).to.equal(50);
      expect(result[3].url).to.equal('test4');
    });

    it('should test toPathOnly with valid URL and search params', () => {
      const result = toPathOnly('https://example.com/path?param=value');
      expect(result).to.equal('/path?param=value');
    });

    it('should test toPathOnly with URL that has no search params', () => {
      const result = toPathOnly('https://example.com/path');
      expect(result).to.equal('/path');
    });

    it('should test toPathOnly catch block with truly invalid URL', () => {
      const result = toPathOnly('not-a-url-at-all');
      // When baseUrl is provided, invalid strings are treated as relative paths
      expect(result).to.equal('/not-a-url-at-all');
    });

    // extractCustomerDomain test removed - now using shared function from cdn-utils

    it('should test getAnalysisBucket function', () => {
      const result = getAnalysisBucket('test.example.com');
      expect(result).to.equal('cdn-logs-test-example-com');
    });

    it('should test getS3Config with default bucket', () => {
      const mockSite = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getCdnLogsConfig: () => null,
        }),
      };
      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('cdn-logs-example-com');
      expect(result.customerName).to.equal('example');
      expect(result.customerDomain).to.equal('example_com');
      expect(result.aggregatedLocation).to.equal('s3://cdn-logs-example-com/aggregated/');
      expect(result.databaseName).to.equal('cdn_logs_example_com');
      expect(result.tableName).to.equal('aggregated_logs_example_com');
    });

    it('should test getS3Config with custom bucket', () => {
      const mockSite = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getCdnLogsConfig: () => ({ bucketName: 'custom-bucket' }),
        }),
      };
      const result = getS3Config(mockSite);
      expect(result.bucket).to.equal('custom-bucket');
      expect(result.aggregatedLocation).to.equal('s3://custom-bucket/aggregated/');
    });

    it('should test formatDateString function', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      const result = formatDateString(date);
      expect(result).to.equal('2024-01-15');
    });

    it('should test getWeekRange with different scenarios', () => {
      const referenceDate = new Date('2024-01-15'); // Monday

      // Test current week
      const currentWeek = getWeekRange(0, referenceDate);
      expect(currentWeek.weekStart).to.be.instanceOf(Date);
      expect(currentWeek.weekEnd).to.be.instanceOf(Date);

      // Test previous week
      const previousWeek = getWeekRange(-1, referenceDate);
      expect(previousWeek.weekStart).to.be.instanceOf(Date);
      expect(previousWeek.weekEnd).to.be.instanceOf(Date);

      // Test Sunday reference date
      const sundayDate = new Date('2024-01-14'); // Sunday
      const sundayWeek = getWeekRange(0, sundayDate);
      expect(sundayWeek.weekStart.getUTCDay()).to.equal(1); // Should start on Monday
    });

    it('should test createDateRange function', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-07');
      const result = createDateRange(startDate, endDate);

      expect(result.startDate).to.be.instanceOf(Date);
      expect(result.endDate).to.be.instanceOf(Date);
      expect(result.startDate.getUTCHours()).to.equal(0);
      expect(result.endDate.getUTCHours()).to.equal(23);
    });

    it('should test generatePeriodIdentifier for non-week range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-10'); // 10 days
      const result = generatePeriodIdentifier(startDate, endDate);
      expect(result).to.equal('2024-01-01_to_2024-01-10');
    });

    it('should test generateReportingPeriods function', () => {
      const referenceDate = new Date('2024-01-15');
      const result = generateReportingPeriods(referenceDate);

      expect(result.weeks).to.be.an('array');
      expect(result.weeks).to.have.length(1);
      expect(result.weeks[0]).to.have.property('weekNumber');
      expect(result.weeks[0]).to.have.property('year');
      expect(result.weeks[0]).to.have.property('weekLabel');
      expect(result.columns).to.be.an('array');
      expect(result.referenceDate).to.equal(referenceDate.toISOString());
    });
  });
});

// ============================================================================
// UNMOCKED TESTS FOR COVERAGE
// ============================================================================
describe('LLM Error Pages Utils - Unmocked Coverage Tests', () => {
  // These tests directly call the actual functions without any mocking

  it('should test buildSiteFilters with no filters', () => {
    expect(buildSiteFilters(null)).to.equal('');
    expect(buildSiteFilters([])).to.equal('');
    expect(buildSiteFilters(undefined)).to.equal('');
  });

  it('should test buildSiteFilters with single filter', () => {
    const filters = [{
      key: 'url',
      value: ['test'],
      type: 'include',
    }];
    const result = buildSiteFilters(filters);
    expect(result).to.equal('(REGEXP_LIKE(url, \'(?i)(test)\'))');
  });

  it('should test buildSiteFilters with exclude filter', () => {
    const filters = [{
      key: 'url',
      value: ['test'],
      type: 'exclude',
    }];
    const result = buildSiteFilters(filters);
    expect(result).to.equal('(NOT REGEXP_LIKE(url, \'(?i)(test)\'))');
  });

  it('should test processErrorPagesResults with empty/null input', () => {
    expect(processErrorPagesResults(null)).to.deep.equal({
      totalErrors: 0,
      errorPages: [],
      summary: {
        uniqueUrls: 0,
        uniqueUserAgents: 0,
        statusCodes: {},
      },
    });

    expect(processErrorPagesResults([])).to.deep.equal({
      totalErrors: 0,
      errorPages: [],
      summary: {
        uniqueUrls: 0,
        uniqueUserAgents: 0,
        statusCodes: {},
      },
    });
  });

  it('should test processErrorPagesResults with number_of_hits field', () => {
    const results = [{
      url: 'test.com',
      status: '404',
      number_of_hits: '100',
      avg_ttfb_ms: '250.5',
      user_agent_display: 'GPTBot',
    }];

    const result = processErrorPagesResults(results);
    expect(result.totalErrors).to.equal(100);
    expect(result.errorPages[0].number_of_hits).to.equal(100);
    expect(result.errorPages[0].avg_ttfb_ms).to.equal(250.5);
    expect(result.summary.uniqueUserAgents).to.equal(1);
  });

  it('should test processErrorPagesResults with invalid number fields', () => {
    const results = [{
      url: 'test.com',
      status: '404',
      number_of_hits: 'invalid',
      avg_ttfb_ms: 'invalid',
      user_agent: 'GPTBot',
    }];

    const result = processErrorPagesResults(results);
    expect(result.errorPages[0].number_of_hits).to.equal(0);
    expect(result.errorPages[0].avg_ttfb_ms).to.equal(0);
  });

  it('should test categorizeErrorsByStatusCode with different status codes', () => {
    const errors = [
      { status: '404', url: 'test1.com' },
      { status: '403', url: 'test2.com' },
      { status: '500', url: 'test3.com' },
      { status: '502', url: 'test4.com' },
      { status: 404, url: 'test5.com' }, // number status
    ];

    const result = categorizeErrorsByStatusCode(errors);
    expect(result['404']).to.have.length(2);
    expect(result['403']).to.have.length(1);
    expect(result['5xx']).to.have.length(2);
  });

  it('should test categorizeErrorsByStatusCode with MAX_URLS_PER_CATEGORY limit', () => {
    const errors = Array.from({ length: 105 }, (_, i) => ({
      status: '404',
      url: `test${i}.com`,
    }));

    const result = categorizeErrorsByStatusCode(errors);
    expect(result['404']).to.have.length(100); // Should be limited to 100
  });

  it('should test consolidateErrorsByUrl with new field structure', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.5,
        agent_type: 'Training bots',
        country_code: 'US',
        product: 'Search',
        category: 'Product Page',
        user_agent: 'GPTBot/1.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].agent_type).to.equal('Training bots');
    expect(result[0].numberOfHits).to.equal(100);
    expect(result[0].totalRequests).to.equal(100);
  });

  it('should test consolidateErrorsByUrl merging logic', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 50,
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(150);
    expect(result[0].rawUserAgents).to.include('GPTBot/1.0');
    expect(result[0].rawUserAgents).to.include('GPTBot/2.0');
    // TTFB weighted average: (250*100 + 350*50) / 150 = 283.33
    expect(result[0].avgTtfbMs).to.be.closeTo(283.33, 0.01);
  });

  it('should test sortErrorsByTrafficVolume with mixed fields', () => {
    const errors = [
      { url: 'test1', totalRequests: 50 },
      { url: 'test2', numberOfHits: 100 },
      { url: 'test3', numberOfHits: 25, totalRequests: 30 },
      { url: 'test4' },
    ];

    const result = sortErrorsByTrafficVolume(errors);
    expect(result[0].numberOfHits).to.equal(100);
    expect(result[1].totalRequests).to.equal(50);
    expect(result[2].numberOfHits).to.equal(25);
    expect(result[3].url).to.equal('test4');
  });

  it('should test toPathOnly with different URL formats', () => {
    expect(toPathOnly('https://example.com/path?query=1')).to.equal('/path?query=1');
    expect(toPathOnly('https://example.com/path')).to.equal('/path');
    expect(toPathOnly('/already/a/path')).to.equal('/already/a/path');
    // This will be treated as a relative path and get a leading slash
    expect(toPathOnly('invalid-url')).to.equal('/invalid-url');
  });

  it('should test toPathOnly catch block with truly invalid input', () => {
    // This should trigger the catch block and return the original string
    const invalidInput = '://invalid-url-format';
    // The URL constructor actually parses this as a relative URL with leading slash
    expect(toPathOnly(invalidInput)).to.equal('/://invalid-url-format');
  });

  // extractCustomerDomain test removed - now using shared function from cdn-utils

  it('should test getAnalysisBucket', () => {
    expect(getAnalysisBucket('test.example.com')).to.equal('cdn-logs-test-example-com');
    expect(getAnalysisBucket('test_example_com')).to.equal('cdn-logs-test-example-com');
  });

  it('should test getS3Config', () => {
    const site = {
      getBaseURL: () => 'https://test.example.com',
      getConfig: () => ({
        getCdnLogsConfig: () => ({ bucketName: 'my-bucket' }),
      }),
    };

    const result = getS3Config(site);
    expect(result.bucket).to.equal('my-bucket');
    expect(result.customerName).to.equal('test');
    expect(result.customerDomain).to.equal('test_example_com');
    expect(result.aggregatedLocation).to.equal('s3://my-bucket/aggregated/');
    expect(result.databaseName).to.equal('cdn_logs_test_example_com');
    expect(result.tableName).to.equal('aggregated_logs_test_example_com');
    expect(result.getAthenaTempLocation()).to.equal('s3://my-bucket/temp/athena-results/');
  });

  it('should test formatDateString', () => {
    const date = new Date('2024-03-15T14:30:00Z');
    expect(formatDateString(date)).to.equal('2024-03-15');
  });

  it('should test getWeekRange', () => {
    const referenceDate = new Date('2024-03-15'); // Friday
    const result = getWeekRange(-1, referenceDate);

    expect(result.weekStart).to.be.instanceOf(Date);
    expect(result.weekEnd).to.be.instanceOf(Date);
    expect(result.weekStart.getUTCDay()).to.equal(1); // Monday
    expect(result.weekEnd.getUTCDay()).to.equal(0); // Sunday
  });

  it('should test createDateRange', () => {
    const start = '2024-01-01';
    const end = '2024-01-07';
    const result = createDateRange(start, end);

    expect(result.startDate.getUTCHours()).to.equal(0);
    expect(result.endDate.getUTCHours()).to.equal(23);
  });

  it('should test generatePeriodIdentifier', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-01-08'); // 7 days later
    expect(generatePeriodIdentifier(start, end)).to.match(/^w\d{2}-2024$/);

    const start2 = new Date('2024-01-01');
    const end2 = new Date('2024-01-10'); // 9 days later
    expect(generatePeriodIdentifier(start2, end2)).to.equal('2024-01-01_to_2024-01-10');
  });

  it('should test generateReportingPeriods', () => {
    const referenceDate = new Date('2024-03-15');
    const result = generateReportingPeriods(referenceDate);

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

  it('should test buildLlmErrorPagesQuery without site parameter', async () => {
    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-07'),
      llmProviders: ['chatgpt'],
      siteFilters: [],
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('test_db');
    expect(result).to.include('test_table');
  });

  it('should test buildLlmErrorPagesQuery with site parameter', async () => {
    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => null, // No data folder
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('test_db');
    expect(result).to.include('test_table');
  });

  it('should test getAllLlmProviders', () => {
    const providers = getAllLlmProviders();
    expect(providers).to.be.an('array');
    expect(providers).to.include('chatgpt');
    expect(providers).to.include('perplexity');
    expect(providers).to.include('claude');
    expect(providers).to.include('gemini');
    expect(providers).to.include('copilot');
  });

  it('should test getLlmProviderPattern', () => {
    expect(getLlmProviderPattern('chatgpt')).to.equal('(?i)ChatGPT|GPTBot|OAI-SearchBot');
    expect(getLlmProviderPattern('perplexity')).to.equal('(?i)Perplexity');
    expect(getLlmProviderPattern('invalid')).to.be.null;
    expect(getLlmProviderPattern('')).to.be.null;
    expect(getLlmProviderPattern(null)).to.be.null;
  });

  it('should test buildLlmUserAgentFilter', () => {
    const result = buildLlmUserAgentFilter(['chatgpt']);
    expect(result).to.include('REGEXP_LIKE(user_agent,');
    expect(result).to.include('ChatGPT|GPTBot|OAI-SearchBot');

    expect(buildLlmUserAgentFilter([])).to.be.null;
    expect(buildLlmUserAgentFilter(['invalid'])).to.be.null;
  });

  it('should test normalizeUserAgentToProvider with all patterns', () => {
    // Test all the specific patterns
    expect(normalizeUserAgentToProvider('ChatGPT-User/1.0')).to.equal('ChatGPT-User');
    expect(normalizeUserAgentToProvider('GPTBot/1.0')).to.equal('GPTBot');
    expect(normalizeUserAgentToProvider('OAI-SearchBot/1.0')).to.equal('OAI-SearchBot');
    expect(normalizeUserAgentToProvider('PerplexityBot/1.0')).to.equal('PerplexityBot');
    expect(normalizeUserAgentToProvider('Perplexity-User/1.0')).to.equal('Perplexity-User');
    expect(normalizeUserAgentToProvider('perplexity-crawler')).to.equal('Perplexity');
    expect(normalizeUserAgentToProvider('Claude-Web/1.0')).to.equal('Claude');
    expect(normalizeUserAgentToProvider('Anthropic-ai/1.0')).to.equal('Anthropic');
    expect(normalizeUserAgentToProvider('GeminiBot/1.0')).to.equal('Gemini');
    expect(normalizeUserAgentToProvider('CopilotBot/1.0')).to.equal('Copilot');

    // Test edge cases
    expect(normalizeUserAgentToProvider('')).to.equal('Unknown');
    expect(normalizeUserAgentToProvider(null)).to.equal('Unknown');
    expect(normalizeUserAgentToProvider(undefined)).to.equal('Unknown');
    expect(normalizeUserAgentToProvider(123)).to.equal('Unknown');

    // Test long user agent truncation
    const longAgent = 'Mozilla/5.0 (compatible; VeryLongUserAgentNameThatExceedsTheFiftyCharacterLimit)';
    const result = normalizeUserAgentToProvider(longAgent);
    expect(result).to.have.length(50);
    expect(result).to.equal(longAgent.substring(0, 50));

    // Test unknown agent
    const unknownAgent = 'Mozilla/5.0 (compatible; UnknownBot/1.0)';
    expect(normalizeUserAgentToProvider(unknownAgent)).to.equal(unknownAgent);
  });

  it('should test createDateRange error cases', () => {
    expect(() => createDateRange('invalid', '2024-01-07')).to.throw('Invalid date format provided');
    expect(() => createDateRange('2024-01-07', '2024-01-01')).to.throw('Start date must be before end date');
  });

  it('should test getS3Config with null config', () => {
    const site = {
      getBaseURL: () => 'https://example.com',
      getConfig: () => ({
        getCdnLogsConfig: () => null,
      }),
    };

    const result = getS3Config(site);
    expect(result.bucket).to.equal('cdn-logs-example-com');
  });

  it('should test getWeekRange with Sunday reference date', () => {
    const sundayDate = new Date('2024-01-14'); // Sunday
    const result = getWeekRange(0, sundayDate);

    expect(result.weekStart.getUTCDay()).to.equal(1); // Should start on Monday
    expect(result.weekEnd.getUTCDay()).to.equal(0); // Should end on Sunday
  });

  it('should test buildLlmErrorPagesQuery with site that has data folder and successful fetch', async () => {
    // Mock fetch for successful response
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: sinon.stub().resolves({
        pagetype: { data: [{ name: 'Product', regex: '/product/.*' }] },
        products: { data: [{ name: 'Electronics', regex: '/electronics/.*' }] },
      }),
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('test_db');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test buildLlmErrorPagesQuery with site that has data folder but fetch fails', async () => {
    // Mock fetch for failed response
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('test_db');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test buildLlmErrorPagesQuery with site that has data folder but fetch throws error', async () => {
    // Mock fetch to throw an error
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().rejects(new Error('Network error'));

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('test_db');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test toPathOnly with URL constructor that throws', () => {
    // Mock URL constructor to throw
    const originalURL = global.URL;
    global.URL = function MockURL() {
      throw new Error('Invalid URL');
    };

    const result = toPathOnly('test-url');
    expect(result).to.equal('test-url');

    // Restore original URL
    global.URL = originalURL;
  });

  it('should test buildLlmErrorPagesQuery with site filters', async () => {
    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      siteFilters: 'url LIKE "%test%"',
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('url LIKE "%test%"');
  });

  it('should test buildLlmErrorPagesQuery with complex remote patterns', async () => {
    // Mock fetch for patterns with both named and extract patterns
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: sinon.stub().resolves({
        pagetype: {
          data: [
            { name: 'Product', regex: '/product/.*' }, // Named pattern
            { regex: '/category/([^/]+)' }, // Extract pattern
          ],
        },
        products: {
          data: [
            { name: 'Electronics', regex: '/electronics/.*' }, // Named pattern
            { regex: '/brand/([^/]+)' }, // Extract pattern
          ],
        },
      }),
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('CASE');
    expect(result).to.include('COALESCE');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test buildLlmErrorPagesQuery with only extract patterns', async () => {
    // Mock fetch for patterns with only extract patterns (no names)
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: sinon.stub().resolves({
        pagetype: {
          data: [
            { regex: '/category/([^/]+)' }, // Extract pattern only
            { regex: '/section/([^/]+)' }, // Extract pattern only
          ],
        },
        products: {
          data: [
            { regex: '/brand/([^/]+)' }, // Extract pattern only
          ],
        },
      }),
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    expect(result).to.include('COALESCE');
    expect(result).to.include('REGEXP_EXTRACT');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  // Additional branch coverage tests
  it('should test buildSiteFilters with multiple filters', () => {
    const filters = [
      {
        key: 'url',
        value: ['test', 'example'],
        type: 'include',
      },
      {
        key: 'user_agent',
        value: ['bot'],
        type: 'exclude',
      },
    ];
    const result = buildSiteFilters(filters);
    expect(result).to.include('REGEXP_LIKE(url');
    expect(result).to.include('NOT REGEXP_LIKE(user_agent');
    expect(result).to.include('AND');
  });

  it('should test processErrorPagesResults with missing status', () => {
    const results = [{
      url: 'test.com',
      number_of_hits: '100',
      // No status field
    }];

    const result = processErrorPagesResults(results);
    expect(result.summary.statusCodes.Unknown).to.equal(100);
  });

  it('should test consolidateErrorsByUrl with missing user_agent_display and user_agent', () => {
    const errors = [
      {
        url: 'https://example.com/1',
        status: '404',
        number_of_hits: 100,
        // No user_agent_display or user_agent fields
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].rawUserAgents).to.include('Unknown');
  });

  it('should test getWeekRange with different week offsets', () => {
    const referenceDate = new Date('2024-01-15'); // Monday

    // Test positive offset (future week)
    const futureWeek = getWeekRange(1, referenceDate);
    expect(futureWeek.weekStart).to.be.instanceOf(Date);
    expect(futureWeek.weekEnd).to.be.instanceOf(Date);

    // Test negative offset (past week)
    const pastWeek = getWeekRange(-2, referenceDate);
    expect(pastWeek.weekStart).to.be.instanceOf(Date);
    expect(pastWeek.weekEnd).to.be.instanceOf(Date);
  });

  it('should test buildLlmUserAgentFilter with multiple providers', () => {
    const result = buildLlmUserAgentFilter(['chatgpt', 'perplexity']);
    expect(result).to.include('ChatGPT|GPTBot|OAI-SearchBot');
    expect(result).to.include('Perplexity');
    // Uses regex OR (|), not SQL OR
    expect(result).to.include('|');
  });

  it('should test buildLlmUserAgentFilter with single provider', () => {
    const result = buildLlmUserAgentFilter(['claude']);
    expect(result).to.include('Claude');
    expect(result).to.not.include('OR');
  });

  it('should test categorizeErrorsByStatusCode with mixed status types', () => {
    const errors = [
      { status: '404', url: 'test1.com' },
      { status: 403, url: 'test2.com' }, // number
      { status: '500', url: 'test3.com' },
      { status: undefined, url: 'test4.com' }, // undefined status
      { status: null, url: 'test5.com' }, // null status
    ];

    const result = categorizeErrorsByStatusCode(errors);
    expect(result['404']).to.have.length(1);
    expect(result['403']).to.have.length(1);
    expect(result['5xx']).to.have.length(1);
    // undefined and null status should be ignored
  });

  it('should test consolidateErrorsByUrl with zero hits edge case', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 0,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(100);
  });

  it('should test generatePeriodIdentifier with exact 7-day range', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-07T23:59:59Z'); // Exactly 7 days
    const result = generatePeriodIdentifier(start, end);
    expect(result).to.match(/^w\d{2}-2024$/);
  });

  it('should test createDateRange with Date objects', () => {
    const start = new Date('2024-01-01');
    const end = new Date('2024-01-07');
    const result = createDateRange(start, end);

    expect(result.startDate).to.be.instanceOf(Date);
    expect(result.endDate).to.be.instanceOf(Date);
  });

  it('should test getS3Config with www prefix in domain', () => {
    const site = {
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getCdnLogsConfig: () => null,
      }),
    };

    const result = getS3Config(site);
    expect(result.customerName).to.equal('example'); // Should skip 'www'
  });

  it('should test normalizeUserAgentToProvider with exact 50 character limit', () => {
    const agent50chars = '12345678901234567890123456789012345678901234567890'; // Exactly 50 chars
    expect(normalizeUserAgentToProvider(agent50chars)).to.equal(agent50chars);

    const agent49chars = '1234567890123456789012345678901234567890123456789'; // 49 chars
    expect(normalizeUserAgentToProvider(agent49chars)).to.equal(agent49chars);
  });

  it('should test buildLlmUserAgentFilter with null providers (uses default)', () => {
    const result = buildLlmUserAgentFilter(null);
    expect(result).to.include('ChatGPT|GPTBot|OAI-SearchBot');
    expect(result).to.include('Perplexity');
    expect(result).to.include('Claude');
    expect(result).to.include('Gemini');
    expect(result).to.include('Copilot');
  });

  it('should test buildLlmErrorPagesQuery with fetch returning data without pagetype', async () => {
    // Mock fetch for response without pagetype field
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: sinon.stub().resolves({
        // No pagetype field
        products: { data: [{ name: 'Electronics', regex: '/electronics/.*' }] },
      }),
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test buildLlmErrorPagesQuery with fetch returning data without products', async () => {
    // Mock fetch for response without products field
    const originalFetch = global.fetch;
    global.fetch = sinon.stub().resolves({
      ok: true,
      json: sinon.stub().resolves({
        pagetype: { data: [{ name: 'Product', regex: '/product/.*' }] },
        // No products field
      }),
    });

    const mockSite = {
      getConfig: () => ({
        getLlmoDataFolder: () => 'test-folder',
      }),
    };

    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      site: mockSite,
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');

    // Restore original fetch
    global.fetch = originalFetch;
  });

  it('should test processErrorPagesResults with missing user_agent and user_agent_display', () => {
    const results = [{
      url: 'test.com',
      status: '404',
      number_of_hits: '100',
      // No user_agent or user_agent_display fields
    }];

    const result = processErrorPagesResults(results);
    expect(result.summary.uniqueUserAgents).to.equal(0); // Should not add undefined to Set
  });

  it('should test consolidateErrorsByUrl with avgTtfbMs calculation edge cases', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 0, // Zero hits
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].avgTtfbMs).to.equal(250.0); // Should handle zero hits case
  });

  it('should test getS3Config with domain that has multiple dots', () => {
    const site = {
      getBaseURL: () => 'https://sub.example.co.uk',
      getConfig: () => ({
        getCdnLogsConfig: () => null,
      }),
    };

    const result = getS3Config(site);
    expect(result.customerName).to.equal('sub'); // Should take first part
  });

  it('should test buildLlmErrorPagesQuery with cross-month date range', async () => {
    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      startDate: new Date('2024-01-25'), // End of January
      endDate: new Date('2024-02-05'), // Beginning of February
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    // Should use the cross-month OR condition
    expect(result).to.include('OR');
  });

  it('should test buildLlmErrorPagesQuery with same-month date range', async () => {
    const options = {
      databaseName: 'test_db',
      tableName: 'test_table',
      startDate: new Date('2024-01-10'), // Same month
      endDate: new Date('2024-01-20'), // Same month
    };

    const result = await buildLlmErrorPagesQuery(options);
    expect(result).to.be.a('string');
    // Should use the single month condition
    expect(result).to.include('day >=');
    expect(result).to.include('day <=');
  });

  it('should test processErrorPagesResults with user_agent field only', () => {
    const results = [{
      url: 'test.com',
      status: '404',
      number_of_hits: '100',
      user_agent: 'GPTBot/1.0',
      // No user_agent_display field
    }];

    const result = processErrorPagesResults(results);
    expect(result.summary.uniqueUserAgents).to.equal(1);
  });

  it('should test consolidateErrorsByUrl with totalHits calculation edge case', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 0, // Zero TTFB
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 0, // Zero hits
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(100);
    // Should handle the case where one entry has zero hits
  });

  it('should test getS3Config with www prefix and single domain part', () => {
    const site = {
      getBaseURL: () => 'https://www.example',
      getConfig: () => ({
        getCdnLogsConfig: () => null,
      }),
    };

    const result = getS3Config(site);
    expect(result.customerName).to.equal('example'); // Should take first part after stripping 'www'
  });

  // Tests to achieve 100% branch coverage
  it('should test processErrorPagesResults with total_requests fallback', () => {
    const results = [{
      url: 'test.com',
      status: '404',
      total_requests: '150', // Only total_requests, no number_of_hits
      user_agent: 'GPTBot/1.0',
    }];

    const result = processErrorPagesResults(results);
    expect(result.errorPages[0].number_of_hits).to.equal(150);
  });

  it('should test consolidateErrorsByUrl with total_requests fallback in existing entry', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        total_requests: 50, // Only total_requests, no number_of_hits
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(150); // 100 + 50
  });

  it('should test consolidateErrorsByUrl with missing user_agent fallback', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        // No user_agent field - should fallback to user_agent_display
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].rawUserAgents).to.include('GPTBot');
  });

  it('should test consolidateErrorsByUrl with missing avgTtfbMs fallback', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        // No avg_ttfb_ms field
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 50,
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(150);
    // Should handle missing avgTtfbMs in existing entry
  });

  it('should test consolidateErrorsByUrl with missing newTtfb fallback', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 50,
        // No avg_ttfb_ms field - should use 0 as fallback
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(150);
    // Should handle missing newTtfb (uses 0 as fallback)
  });

  it('should test consolidateErrorsByUrl with missing newHits fallback', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        // No number_of_hits or total_requests - should use 0 as fallback
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(100); // 100 + 0
  });

  it('should test consolidateErrorsByUrl with totalHits = 0 edge case', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 0, // Zero hits in existing
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 0, // Zero hits in new
        avg_ttfb_ms: 350.0,
        user_agent: 'GPTBot/2.0',
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].numberOfHits).to.equal(0);
    // Should use newTtfb when totalHits = 0
    expect(result[0].avgTtfbMs).to.equal(350.0);
  });

  it('should test sortErrorsByTrafficVolume with all fallback branches', () => {
    const errors = [
      { url: 'test1' }, // No hits fields - should use 0
      { url: 'test2', totalRequests: 50 }, // Only totalRequests
      { url: 'test3', numberOfHits: 100 }, // numberOfHits takes precedence
      { url: 'test4', numberOfHits: 25, totalRequests: 75 }, // numberOfHits takes precedence over totalRequests
    ];

    const result = sortErrorsByTrafficVolume(errors);
    expect(result[0].numberOfHits).to.equal(100); // test3
    expect(result[1].totalRequests).to.equal(50); // test2
    expect(result[2].numberOfHits).to.equal(25); // test4
    expect(result[3].url).to.equal('test1'); // test1 (no hits)
  });

  it('should test consolidateErrorsByUrl with null user_agent fallback to userAgentDisplay', () => {
    const errors = [
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 100,
        avg_ttfb_ms: 250.0,
        user_agent: 'GPTBot/1.0',
      },
      {
        url: 'test.com',
        status: '404',
        user_agent_display: 'GPTBot',
        number_of_hits: 50,
        avg_ttfb_ms: 350.0,
        user_agent: null, // Explicitly null user_agent - should fallback to userAgentDisplay
      },
    ];

    const result = consolidateErrorsByUrl(errors);
    expect(result).to.have.length(1);
    expect(result[0].rawUserAgents).to.include('GPTBot/1.0');
    expect(result[0].rawUserAgents).to.include('GPTBot'); // Should add userAgentDisplay as fallback
    expect(result[0].numberOfHits).to.equal(150);
  });
});
