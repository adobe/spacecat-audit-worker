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
  formatDateString,
  getWeekRange,
  createDateRange,
  generatePeriodIdentifier,
  generateReportingPeriods,
  processErrorPagesResults,
  categorizeErrorsByStatusCode,
  consolidateErrorsByUrl,
  sortErrorsByTrafficVolume,
  toPathOnly,
  downloadExistingCdnSheet,
  matchErrorsWithCdnData,
} from '../../../src/llm-error-pages/utils.js';
import { extractCustomerDomain } from '../../../src/utils/cdn-utils.js';

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

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
      const callArg = mockGetStaticContent.firstCall.args[0];
      expect(callArg).to.have.property('countryExtraction');
      expect(callArg.countryExtraction).to.include('COALESCE(');
      expect(callArg.countryExtraction).to.include('REGEXP_EXTRACT(url');
      expect(callArg.countryExtraction).to.include('GLOBAL');
    });

    it('should build query without date range', async () => {
      const optionsWithoutDates = { ...mockOptions };
      delete optionsWithoutDates.startDate;
      delete optionsWithoutDates.endDate;

      await utils.buildLlmErrorPagesQuery(optionsWithoutDates);

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
    });

    it('should build query without LLM providers', async () => {
      const optionsWithoutProviders = { ...mockOptions };
      delete optionsWithoutProviders.llmProviders;

      await utils.buildLlmErrorPagesQuery(optionsWithoutProviders);

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND (REGEXP_LIKE(url, \'(?i)(test)\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
    });

    it('should build query without site filters', async () => {
      const optionsWithoutFilters = { ...mockOptions };
      delete optionsWithoutFilters.siteFilters;

      await utils.buildLlmErrorPagesQuery(optionsWithoutFilters);

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE (year = \'2024\' AND month = \'01\' AND day >= \'01\' AND day <= \'07\') AND REGEXP_LIKE(user_agent, \'(?i)ChatGPT|GPTBot|OAI-SearchBot\') AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
    });

    it('should handle template with only static content', async () => {
      const minimalOptions = {
        databaseName: 'test_db',
        tableName: 'test_table',
      };

      await utils.buildLlmErrorPagesQuery(minimalOptions);

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
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

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
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

      expect(mockGetStaticContent).to.have.been.calledWith(
        sinon.match({
          databaseName: 'test_db',
          tableName: 'test_table',
          whereClause: 'WHERE ((year = \'2024\' AND month = \'12\' AND day >= \'25\')\n       OR (year = \'2025\' AND month = \'01\' AND day <= \'05\')) AND status BETWEEN 400 AND 599 AND NOT (url LIKE \'%robots.txt\' OR url LIKE \'%sitemap%\')',
        }),
        './src/llm-error-pages/sql/llm-error-pages.sql',
      );
    });
  });

  describe('buildLlmErrorPagesQuery with site patterns', () => {
    it('injects classification SQL when site is provided', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({
          pagetype: { data: [{ name: 'Help', regex: '/help' }] },
          products: { data: [{ name: 'Adobe', regex: '/adobe' }] },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });

        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });

        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg).to.have.property('userAgentDisplay');
        expect(callArg).to.have.property('agentTypeClassification');
        expect(callArg).to.have.property('topicExtraction');
        expect(callArg).to.have.property('pageCategoryClassification');
        expect(callArg).to.have.property('countryExtraction');
        expect(callArg.countryExtraction).to.include('COALESCE(');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('classification fallbacks and variants', () => {
    it('uses fallback classification when dataFolder is missing', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => undefined }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: mockGetStaticContent,
        },
      });
      await mocked.buildLlmErrorPagesQuery({
        databaseName: 'db',
        tableName: 'tbl',
        site,
      });
      const callArg = mockGetStaticContent.firstCall.args[0];
      expect(callArg.pageCategoryClassification).to.equal("'Other'");
      expect(callArg.topicExtraction).to.include("CASE WHEN url IS NOT NULL THEN 'Other' END");
    });

    it('uses fallback classification when fetch throws', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().rejects(new Error('network error'));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });
        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });
        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg.pageCategoryClassification).to.equal("'Other'");
        expect(callArg.topicExtraction).to.include("CASE WHEN url IS NOT NULL THEN 'Other' END");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses fallback classification when fetch fails', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().resolves({ ok: false });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });
        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });
        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg.pageCategoryClassification).to.equal("'Other'");
        expect(callArg.topicExtraction).to.include("CASE WHEN url IS NOT NULL THEN 'Other' END");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('topicExtraction handles named-only patterns', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({
          pagetype: { data: [{ name: 'Help', regex: '/help' }] },
          products: { data: [{ name: 'Adobe', regex: '/adobe' }] }, // named only
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });
        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });
        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg.topicExtraction).to.include('CASE');
        expect(callArg.topicExtraction).to.include("ELSE 'Other'");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('topicExtraction handles extract-only patterns', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({
          pagetype: { data: [] },
          products: { data: [{ regex: '/product/([^/]+)' }] }, // extract-only
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });
        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });
        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg.topicExtraction.trim().startsWith('COALESCE(')).to.be.true;
        expect(callArg.topicExtraction).to.include("'Other'");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('topicExtraction handles mixed named and extract patterns', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      mockGetStaticContent = sinon.stub().returns('SELECT ...');
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({
          pagetype: { data: [] },
          products: { data: [{ name: 'Adobe', regex: '/adobe' }, { regex: '/product/([^/]+)' }] },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js', {
          '@adobe/spacecat-shared-utils': {
            getStaticContent: mockGetStaticContent,
          },
        });
        await mocked.buildLlmErrorPagesQuery({
          databaseName: 'db',
          tableName: 'tbl',
          site,
        });
        const callArg = mockGetStaticContent.firstCall.args[0];
        expect(callArg.topicExtraction).to.include('COALESCE(');
        expect(callArg.topicExtraction).to.include('CASE');
        expect(callArg.topicExtraction).to.include('NULLIF(');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('fetchRemotePatterns direct', () => {
    it('returns mapped pagePatterns/topicPatterns from JSON', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({
          pagetype: { data: [{ name: 'Help', regex: '/help' }] },
          products: { data: [{ name: 'Adobe', regex: '/adobe' }] },
        }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js');
        const patterns = await mocked.fetchRemotePatterns(site);
        expect(patterns.pagePatterns).to.deep.equal([{ name: 'Help', regex: '/help' }]);
        expect(patterns.topicPatterns).to.deep.equal([{ name: 'Adobe', regex: '/adobe' }]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('falls back to [] when JSON omits keys', async () => {
      const site = {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getLlmoDataFolder: () => 'folder' }),
      };
      const fetchStub = sinon.stub().resolves({
        ok: true,
        json: async () => ({}),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetchStub;
      try {
        const mocked = await esmock('../../../src/llm-error-pages/utils.js');
        const patterns = await mocked.fetchRemotePatterns(site);
        expect(patterns.pagePatterns).to.deep.equal([]);
        expect(patterns.topicPatterns).to.deep.equal([]);
      } finally {
        globalThis.fetch = originalFetch;
      }
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
      expect(result).to.equal('example_com');
    });

    it('should handle special characters in domain', () => {
      const mockSite = {
        getBaseURL: () => 'https://test-site.example.co.uk',
      };

      const result = extractCustomerDomain(mockSite);
      expect(result).to.equal('test_site_example_co_uk');
    });
  });

  describe('getS3Config', () => {
    it('should return config with resolved bucket name', async () => {
      const mockSite = {
        getConfig: () => ({}),
        getBaseURL: () => 'https://www.example.com',
        getId: () => 'test-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'resolved-bucket',
          extractCustomerDomain: () => 'example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});
      expect(result.bucket).to.equal('resolved-bucket');
      expect(result.customerName).to.equal('example');
      expect(result.customerDomain).to.equal('example_com');
      expect(result.aggregatedLocation).to.equal('s3://resolved-bucket/aggregated/test-site-id/');
      expect(result.databaseName).to.equal('cdn_logs_example_com');
      expect(result.tableName).to.equal('aggregated_logs_example_com_consolidated');
    });

    it('should use resolveConsolidatedBucketName by default', async () => {
      const mockSite = {
        getConfig: () => ({}),
        getBaseURL: () => 'https://www.example.com',
        getId: () => 'test-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'resolved-bucket-name',
          extractCustomerDomain: () => 'example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});
      expect(result.bucket).to.equal('resolved-bucket-name');
      expect(result.customerName).to.equal('example');
      expect(result.customerDomain).to.equal('example_com');
    });

    it('should return config with callable getAthenaTempLocation function', async () => {
      const mockSite = {
        getBaseURL: () => 'https://test.example.com',
        getConfig: () => ({}),
        getId: () => 'test-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'custom-bucket',
          extractCustomerDomain: () => 'test_example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});

      expect(result.getAthenaTempLocation).to.be.a('function');
      expect(result.getAthenaTempLocation()).to.equal('s3://custom-bucket/temp/athena-results/');
    });

    it('should throw error when resolver fails', async () => {
      const mockSite = {
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({}),
        getId: () => 'test-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => { throw new Error('boom'); },
          extractCustomerDomain: () => 'example_com',
        },
      });

      try {
        await mockedUtils.getS3Config(mockSite, {});
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.equal('boom');
      }
    });

    it('should include siteId in aggregatedLocation for consolidated bucket', async () => {
      const mockSite = {
        getConfig: () => ({}),
        getBaseURL: () => 'https://www.example.com',
        getId: () => 'test-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'spacecat-test-cdn-logs-aggregates-us-east-1',
          extractCustomerDomain: () => 'example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});
      expect(result.aggregatedLocation).to.equal('s3://spacecat-test-cdn-logs-aggregates-us-east-1/aggregated/test-site-id/');
    });

    it('should use siteId in aggregatedLocation regardless of config', async () => {
      const mockSite = {
        getConfig: () => ({}),
        getBaseURL: () => 'https://www.example.com',
        getId: () => 'another-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'spacecat-test-cdn-logs-aggregates-us-east-1',
          extractCustomerDomain: () => 'example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});
      expect(result.aggregatedLocation).to.equal('s3://spacecat-test-cdn-logs-aggregates-us-east-1/aggregated/another-site-id/');
    });

    it('should always use siteId in aggregatedLocation', async () => {
      const mockSite = {
        getConfig: () => ({}),
        getBaseURL: () => 'https://www.example.com',
        getId: () => 'final-site-id',
      };

      const mockedUtils = await esmock('../../../src/llm-error-pages/utils.js', {
        '../../../src/utils/cdn-utils.js': {
          resolveConsolidatedBucketName: () => 'spacecat-test-cdn-logs-aggregates-us-east-1',
          extractCustomerDomain: () => 'example_com',
        },
      });

      const result = await mockedUtils.getS3Config(mockSite, {});
      expect(result.aggregatedLocation).to.equal('s3://spacecat-test-cdn-logs-aggregates-us-east-1/aggregated/final-site-id/');
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

    it('returns original string when URL construction fails', () => {
      const result = toPathOnly('\\\\invalid\\\\url');
      expect(result).to.equal('//url');
    });

    it('handles URL with search params but no query', () => {
      const result = toPathOnly('https://example.com/path');
      expect(result).to.equal('/path');
    });

    it('returns original string when URL construction fails', () => {
      // Invalid baseUrl triggers catch block
      const result1 = toPathOnly('relative/path', 'not-a-valid-base-url');
      expect(result1).to.equal('relative/path');

      // Null input also triggers catch block
      const result2 = toPathOnly(null, 'invalid');
      expect(result2).to.equal(null);
    });
  });

  // ============================================================================
  // Additional coverage tests for missing functions
  // ============================================================================

  describe('buildLlmErrorPagesQuery', () => {
    beforeEach(async () => {
      mockGetStaticContent = sinon.stub().returns('SELECT * FROM table');
      utils = await esmock('../../../src/llm-error-pages/utils.js', {
        '@adobe/spacecat-shared-utils': {
          getStaticContent: mockGetStaticContent,
        },
      });
    });

    it('should build query with all parameters', async () => {
      const options = {
        databaseName: 'test_db',
        tableName: 'test_table',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-07'),
        llmProviders: ['chatgpt'],
        siteFilters: ['test'],
      };

      await utils.buildLlmErrorPagesQuery(options);

      expect(mockGetStaticContent).to.have.been.calledOnce;
      expect(mockGetStaticContent.firstCall.args[0]).to.have.property('databaseName', 'test_db');
      expect(mockGetStaticContent.firstCall.args[0]).to.have.property('tableName', 'test_table');
      expect(mockGetStaticContent.firstCall.args[0]).to.have.property('whereClause');
    });

    it('should handle null llmProviders', async () => {
      const options = {
        databaseName: 'test_db',
        tableName: 'test_table',
        llmProviders: null,
        siteFilters: [],
      };

      await utils.buildLlmErrorPagesQuery(options);

      expect(mockGetStaticContent).to.have.been.calledOnce;
    });

    it('should handle empty providers that return no filter', async () => {
      const options = {
        databaseName: 'test_db',
        tableName: 'test_table',
        llmProviders: ['invalid-provider'],
        siteFilters: [],
      };

      await utils.buildLlmErrorPagesQuery(options);

      expect(mockGetStaticContent).to.have.been.calledOnce;
    });
  });

  describe('buildLlmUserAgentFilter edge cases', () => {
    it('should return null for empty providers array', () => {
      const result = buildLlmUserAgentFilter([]);
      expect(result).to.be.null;
    });

    it('should filter out invalid providers', () => {
      const result = buildLlmUserAgentFilter(['invalid', 'chatgpt']);
      expect(result).to.contain('ChatGPT');
      expect(result).not.to.contain('invalid');
    });

    it('should handle null providers parameter', () => {
      const result = buildLlmUserAgentFilter(null);
      expect(result).to.contain('ChatGPT');
      expect(result).to.contain('Perplexity');
    });
  });

  describe('normalizeUserAgentToProvider edge cases', () => {
    it('should handle null user agent', () => {
      const result = normalizeUserAgentToProvider(null);
      expect(result).to.equal('Unknown');
    });

    it('should handle undefined user agent', () => {
      const result = normalizeUserAgentToProvider(undefined);
      expect(result).to.equal('Unknown');
    });

    it('should handle non-string user agent', () => {
      const result = normalizeUserAgentToProvider(123);
      expect(result).to.equal('Unknown');
    });

    it('should return original string for unrecognized user agents', () => {
      const result = normalizeUserAgentToProvider('Custom-Bot/1.0');
      expect(result).to.equal('Custom-Bot/1.0');
    });
  });

  describe('getLlmProviderPattern edge cases', () => {
    it('should return null for empty string', () => {
      const result = getLlmProviderPattern('');
      expect(result).to.be.null;
    });

    it('should return null for whitespace-only string', () => {
      const result = getLlmProviderPattern('   ');
      expect(result).to.be.null;
    });

    it('should return null for non-string input', () => {
      const result = getLlmProviderPattern(123);
      expect(result).to.be.null;
    });

    it('should return null for null input', () => {
      const result = getLlmProviderPattern(null);
      expect(result).to.be.null;
    });
  });

  describe('processErrorPagesResults', () => {
    it('should calculate summary from results and return object shape', () => {
      const results = [
        {
          url: '/page1', total_requests: '10', status: '404', user_agent: 'bot',
        },
        {
          url: '/page1', total_requests: '5', status: '404', user_agent: 'human',
        },
        {
          url: '/page2', total_requests: '3', status: '403', user_agent: 'bot',
        },
      ];

      const processed = processErrorPagesResults(results);
      expect(processed.totalErrors).to.equal(18);
      expect(processed.errorPages).to.equal(results);
      expect(processed.summary.uniqueUrls).to.equal(2);
      expect(processed.summary.uniqueUserAgents).to.equal(2);
      expect(processed.summary.statusCodes).to.deep.equal({ 404: 15, 403: 3 });
    });

    it('should handle empty results', () => {
      const processed = processErrorPagesResults([]);
      expect(processed).to.deep.equal({
        totalErrors: 0,
        errorPages: [],
        summary: {
          uniqueUrls: 0,
          uniqueUserAgents: 0,
          statusCodes: {},
        },
      });
    });

    it('should coerce non-numeric total_requests to 0 and compute counts', () => {
      const results = [{
        url: '/page1', total_requests: 'invalid', status: '404', user_agent: 'bot',
      }];
      const processed = processErrorPagesResults(results);
      expect(processed.totalErrors).to.equal(0);
      expect(processed.summary.statusCodes).to.deep.equal({ 404: 0 });
    });

    it('should not crash when user_agent/status missing and still produce summary', () => {
      const results = [
        { url: '/page1', total_requests: '2' },
      ];
      const processed = processErrorPagesResults(results);
      expect(processed.totalErrors).to.equal(2);
      expect(processed.summary.statusCodes).to.deep.equal({ Unknown: 2 });
    });
  });

  // ============================================================================
  // EXCEL/CDN DATA HELPERS TESTS
  // ============================================================================

  describe('downloadExistingCdnSheet', () => {
    let mockLog;
    let mockSharepointClient;
    let mockReadFromSharePoint;
    let mockExcelJS;
    let mockWorkbook;

    beforeEach(() => {
      mockLog = {
        debug: sinon.stub(),
        warn: sinon.stub(),
      };

      mockSharepointClient = {};

      mockReadFromSharePoint = sinon.stub();

      mockWorkbook = {
        xlsx: {
          load: sinon.stub().resolves(),
        },
        worksheets: [],
      };

      mockExcelJS = {
        Workbook: sinon.stub().returns(mockWorkbook),
      };
    });

    it('should download and parse existing CDN sheet successfully', async () => {
      const mockBuffer = Buffer.from('mock-excel-data');
      mockReadFromSharePoint.resolves(mockBuffer);

      const mockRow1 = {
        values: [
          null, // Excel arrays are 1-based, index 0 is always empty
          'Chatbot',
          'ChatGPT',
          '404',
          '100',
          '250',
          'US',
          '/page1',
          'Product A',
          'Category X',
        ],
      };

      const mockRow2 = {
        values: [
          null,
          'Search Engine',
          'Perplexity',
          '403',
          '50',
          '300',
          'UK',
          '/page2',
          'Product B',
          'Category Y',
        ],
      };

      const mockWorksheet = {
        eachRow: sinon.stub().callsFake((options, callback) => {
          callback(mockRow1, 1); // Header row (will be skipped)
          callback(mockRow2, 2); // Data row
        }),
      };

      mockWorkbook.worksheets = [mockWorksheet];

      const { downloadExistingCdnSheet } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = await downloadExistingCdnSheet(
        'w35-2025',
        'test-folder',
        mockSharepointClient,
        mockLog,
        mockReadFromSharePoint,
        mockExcelJS,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0]).to.deep.equal({
        agent_type: 'Search Engine',
        user_agent_display: 'Perplexity',
        status: '403',
        number_of_hits: 50,
        avg_ttfb_ms: 300,
        country_code: 'UK',
        url: '/page2',
        product: 'Product B',
        category: 'Category Y',
      });

      expect(mockLog.debug).to.have.been.calledWith(
        'Attempting to download existing CDN sheet: agentictraffic-w35-2025.xlsx',
      );
      expect(mockLog.debug).to.have.been.calledWith(
        'Successfully loaded 1 rows from existing CDN sheet',
      );
    });

    it('should handle errors gracefully and return null', async () => {
      mockReadFromSharePoint.rejects(new Error('File not found'));

      const { downloadExistingCdnSheet } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = await downloadExistingCdnSheet(
        'w35-2025',
        'test-folder',
        mockSharepointClient,
        mockLog,
        mockReadFromSharePoint,
        mockExcelJS,
      );

      expect(result).to.be.null;
      expect(mockLog.warn).to.have.been.calledWith(
        'Could not download existing CDN sheet: File not found',
      );
    });

    it('should handle empty worksheet', async () => {
      const mockBuffer = Buffer.from('mock-excel-data');
      mockReadFromSharePoint.resolves(mockBuffer);

      const mockWorksheet = {
        eachRow: sinon.stub().callsFake((options, callback) => {
          callback({ values: [] }, 1); // Only header row
        }),
      };

      mockWorkbook.worksheets = [mockWorksheet];

      const { downloadExistingCdnSheet } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = await downloadExistingCdnSheet(
        'w35-2025',
        'test-folder',
        mockSharepointClient,
        mockLog,
        mockReadFromSharePoint,
        mockExcelJS,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(0);
    });

    it('should handle missing or invalid numeric values', async () => {
      const mockBuffer = Buffer.from('mock-excel-data');
      mockReadFromSharePoint.resolves(mockBuffer);

      const mockRow = {
        values: [
          null,
          'Chatbot',
          'ChatGPT',
          '404',
          'invalid', // Invalid number_of_hits
          null, // Missing avg_ttfb_ms
          'US',
          '/page1',
          'Product A',
          'Category X',
        ],
      };

      const mockWorksheet = {
        eachRow: sinon.stub().callsFake((options, callback) => {
          callback({ values: [] }, 1); // Header
          callback(mockRow, 2); // Data row
        }),
      };

      mockWorkbook.worksheets = [mockWorksheet];

      const { downloadExistingCdnSheet } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = await downloadExistingCdnSheet(
        'w35-2025',
        'test-folder',
        mockSharepointClient,
        mockLog,
        mockReadFromSharePoint,
        mockExcelJS,
      );

      expect(result).to.be.an('array');
      expect(result).to.have.lengthOf(1);
      expect(result[0].number_of_hits).to.equal(0); // Invalid coerced to 0
      expect(result[0].avg_ttfb_ms).to.equal(0); // Null coerced to 0
    });
  });

  describe('matchErrorsWithCdnData', () => {
    it('should match errors with CDN data by URL and user agent', async () => {
      const errors = [
        {
          url: '/page1',
          user_agent: 'ChatGPT',
          total_requests: 100,
        },
        {
          url: '/page2',
          user_agent: 'Perplexity',
          total_requests: 50,
        },
      ];

      const cdnData = [
        {
          url: '/page1',
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
        {
          url: '/page2',
          user_agent_display: 'Perplexity',
          agent_type: 'Search Engine',
          number_of_hits: 150,
          avg_ttfb_ms: 300,
          country_code: 'UK',
          product: 'Product B',
          category: 'Category Y',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      expect(result).to.have.lengthOf(2);
      expect(result[0]).to.deep.equal({
        agent_type: 'Chatbot',
        user_agent_display: 'ChatGPT',
        number_of_hits: 100, // Uses error's total_requests
        avg_ttfb_ms: 250,
        country_code: 'US',
        url: '/page1',
        product: 'Product A',
        category: 'Category X',
      });
      expect(result[1]).to.deep.equal({
        agent_type: 'Search Engine',
        user_agent_display: 'Perplexity',
        number_of_hits: 50,
        avg_ttfb_ms: 300,
        country_code: 'UK',
        url: '/page2',
        product: 'Product B',
        category: 'Category Y',
      });
    });

    it('should handle partial URL matches', async () => {
      const errors = [
        {
          url: '/page1/subpage',
          user_agent: 'ChatGPT',
          total_requests: 100,
        },
      ];

      const cdnData = [
        {
          url: '/page1',
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('/page1/subpage');
    });

    it('should handle partial user agent matches (case-insensitive)', async () => {
      const errors = [
        {
          url: '/page1',
          user_agent: 'chatgpt-user',
          total_requests: 100,
        },
      ];

      const cdnData = [
        {
          url: '/page1',
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      expect(result).to.have.lengthOf(1);
      expect(result[0].user_agent_display).to.equal('ChatGPT');
    });

    it('should handle root path specially', async () => {
      const errors = [
        {
          url: '/',
          user_agent: 'ChatGPT',
          total_requests: 100,
        },
      ];

      const cdnData = [
        {
          url: '/',
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      expect(result).to.have.lengthOf(1);
      expect(result[0].url).to.equal('/');
    });

    it('should handle no matches and empty arrays', async () => {
      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      // No matches found
      const noMatchResult = matchErrorsWithCdnData(
        [{ url: '/page1', user_agent: 'ChatGPT', total_requests: 100 }],
        [{ url: '/different-page', user_agent_display: 'DifferentBot', agent_type: 'Chatbot', number_of_hits: 200, avg_ttfb_ms: 250, country_code: 'US', product: 'A', category: 'X' }],
        'https://example.com',
      );
      expect(noMatchResult).to.have.lengthOf(0);

      // Empty errors array
      const emptyErrorsResult = matchErrorsWithCdnData(
        [],
        [{ url: '/page1', user_agent_display: 'ChatGPT', agent_type: 'Chatbot', number_of_hits: 200, avg_ttfb_ms: 250, country_code: 'US', product: 'A', category: 'X' }],
        'https://example.com',
      );
      expect(emptyErrorsResult).to.have.lengthOf(0);

      // Empty CDN data array
      const emptyCdnResult = matchErrorsWithCdnData(
        [{ url: '/page1', user_agent: 'ChatGPT', total_requests: 100 }],
        [],
        'https://example.com',
      );
      expect(emptyCdnResult).to.have.lengthOf(0);
    });

    it('should use error total_requests when available, CDN number_of_hits otherwise', async () => {
      const errors = [
        {
          url: '/page1',
          user_agent: 'ChatGPT',
          total_requests: 100,
        },
        {
          url: '/page2',
          user_agent: 'Perplexity',
          // No total_requests
        },
      ];

      const cdnData = [
        {
          url: '/page1',
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
        {
          url: '/page2',
          user_agent_display: 'Perplexity',
          agent_type: 'Search Engine',
          number_of_hits: 150,
          avg_ttfb_ms: 300,
          country_code: 'UK',
          product: 'Product B',
          category: 'Category Y',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      expect(result).to.have.lengthOf(2);
      expect(result[0].number_of_hits).to.equal(100); // From error
      expect(result[1].number_of_hits).to.equal(150); // From CDN
    });

    it('should handle CDN data with null or undefined URL', async () => {
      const errors = [
        {
          url: '',
          user_agent: 'ChatGPT',
          total_requests: 100,
        },
      ];

      const cdnData = [
        {
          url: null, // Null URL
          user_agent_display: 'ChatGPT',
          agent_type: 'Chatbot',
          number_of_hits: 200,
          avg_ttfb_ms: 250,
          country_code: 'US',
          product: 'Product A',
          category: 'Category X',
        },
      ];

      const { matchErrorsWithCdnData } = await esmock(
        '../../../src/llm-error-pages/utils.js',
      );

      const result = matchErrorsWithCdnData(errors, cdnData, 'https://example.com');

      // Should match because empty string matches empty string
      expect(result).to.have.lengthOf(1);
    });
  });
});
