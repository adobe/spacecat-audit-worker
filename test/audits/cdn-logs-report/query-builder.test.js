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
import {
  weeklyBreakdownQueries,
  buildExcludedUrlSuffixesFilter,
} from '../../../src/cdn-logs-report/utils/query-builder.js';

use(sinonChai);

// Mock data factories
const createMockSiteConfig = (overrides = {}) => ({
  getLlmoDataFolder: () => null,
  getLlmoCdnlogsFilter: () => [{
    value: ['www.another.com'],
    key: 'host',
  }],
  getLlmoCdnBucketConfig: () => ({ orgId: 'test-org-id' }),
  ...overrides,
});

const createMockSite = (overrides = {}) => ({
  getBaseURL: () => 'https://adobe.com',
  getConfig: () => createMockSiteConfig(),
  ...overrides,
});

const createMockOptions = (overrides = {}) => ({
  periods: {
    weeks: [{
      startDate: new Date('2025-01-06'),
      endDate: new Date('2025-01-12'),
      weekLabel: 'Week 2 2025',
    }],
  },
  databaseName: 'test_db',
  tableName: 'test_table',
  siteFilters: [],
  site: createMockSite(),
  ...overrides,
});

const createMockPatterns = () => ({
  pagetype: {
    data: [{ name: 'Product Page', regex: '.*product.*' }],
  },
  products: {
    data: [
      { regex: '/products/', name: 'Products' },
      { regex: '/category/([^/]+)' },
    ],
  },
});

describe('CDN Logs Query Builder', () => {
  let mockOptions;

  beforeEach(() => {
    mockOptions = createMockOptions();
  });

  it('creates agentic report query with ChatGPT and Perplexity filtering', async () => {
    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('ChatGPT|GPTBot|OAI-SearchBot');
    expect(query).to.include('Perplexity');
    expect(query).to.include('test_db.test_table');
    expect(query).to.include('agent_type');
    expect(query).to.include('user_agent_display');
    expect(query).to.include('number_of_hits');
    expect(query).to.include('avg_ttfb_ms');
  });

  it('handles site filters correctly', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [{ value: ['test'], key: 'url' }],
        }),
      }),
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.include("(REGEXP_LIKE(url, '(?i)(test)'))");
  });

  it('handles llmo cdn logs site filters correctly', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [{ value: ['test'], key: 'url' }],
        }),
      }),
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.include("(REGEXP_LIKE(url, '(?i)(test)'))");
  });

  it('includes date filtering for the specified week', async () => {
    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
  });

  it('handles site with no page patterns', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getBaseURL: () => 'https://unknown.com',
      }),
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('Other');
  });

  it('handles topic patterns with mixed named and extract patterns', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoDataFolder: () => 'test-folder',
        }),
      }),
    });

    const nock = await import('nock');
    const patternNock = nock.default('https://main--project-elmo-ui-data--adobe.aem.live')
      .get('/test-folder/agentic-traffic/patterns/patterns.json')
      .reply(200, createMockPatterns());

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('CASE');
    expect(patternNock.isDone()).to.be.true;
  });

  it('handles topic patterns with named patterns', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoDataFolder: () => 'test-folder',
        }),
      }),
    });

    const nock = await import('nock');
    const namedPatternsOnly = {
      pagetype: { data: [{ name: 'Product Page', regex: '.*product.*' }] },
      products: {
        data: [
          { regex: '/products/', name: 'Products' },
        ],
      },
    };

    const patternNock = nock.default('https://main--project-elmo-ui-data--adobe.aem.live')
      .get('/test-folder/agentic-traffic/patterns/patterns.json')
      .reply(200, namedPatternsOnly);

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('CASE');
    expect(patternNock.isDone()).to.be.true;
  });

  it('handles cross-month date filtering', async () => {
    const customOptions = createMockOptions({
      periods: {
        weeks: [{
          startDate: new Date('2024-12-30'),
          endDate: new Date('2025-01-05'),
          weekLabel: 'Week 1 2025',
        }],
      },
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.include("year = '2024'");
    expect(query).to.include("month = '12'");
    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
    expect(query).to.include('OR');
  });

  it('handles empty conditions in where clause', async () => {
    const customOptions = createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [],
        }),
      }),
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(customOptions);

    expect(query).to.include('WHERE');
    expect(query).to.include('(?i)(ChatGPT|GPTBot|OAI-SearchBot)(?!.*(Tokowaka|Spacecat))');
    expect(query).to.include('(?i)Claude(?!-web)');
  });

  describe('createTopUrlsQueryWithLimit', () => {
    it('creates query with limit parameter', async () => {
      const customOptions = createMockOptions({
        limit: 100,
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('LIMIT 100');
      expect(query).to.include('test_db.test_table');
    });

    it('creates query without excluded URL suffixes filter when not provided', async () => {
      const customOptions = createMockOptions({
        limit: 50,
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('LIMIT 50');
      // Should not have any exclusion filter when excludedUrlSuffixes is not provided
      expect(query).to.not.include('AND NOT');
    });

    it('creates query with excluded URL suffixes filter using regexp_like', async () => {
      const customOptions = createMockOptions({
        limit: 100,
        excludedUrlSuffixes: ['.pdf', '/robots.txt', '.xlsx'],
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('LIMIT 100');
      expect(query).to.include('AND NOT regexp_like(url,');
      expect(query).to.include('(?i)');
      expect(query).to.include('\\.pdf');
      expect(query).to.include('/robots\\.txt');
      expect(query).to.include('\\.xlsx');
      expect(query).to.include(')$');
    });

    it('creates query with empty excluded URL suffixes array', async () => {
      const customOptions = createMockOptions({
        limit: 100,
        excludedUrlSuffixes: [],
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('LIMIT 100');
      // Should not have exclusion filter when array is empty
      expect(query).to.not.include('AND NOT');
    });

    it('escapes single quotes in excluded URL suffixes', async () => {
      const customOptions = createMockOptions({
        limit: 100,
        excludedUrlSuffixes: ["/file's.txt"],
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      // Single quotes should be escaped as double single quotes for SQL
      expect(query).to.include("AND NOT regexp_like(url,");
      expect(query).to.include("/file''s\\.txt");
    });

    it('includes date filtering for the specified week', async () => {
      const customOptions = createMockOptions({
        limit: 100,
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.include("year = '2025'");
      expect(query).to.include("month = '01'");
    });

    it('handles site filters correctly', async () => {
      const customOptions = createMockOptions({
        limit: 100,
        site: createMockSite({
          getConfig: () => createMockSiteConfig({
            getLlmoCdnlogsFilter: () => [{ value: ['test-path'], key: 'url' }],
          }),
        }),
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.include("(REGEXP_LIKE(url, '(?i)(test-path)'))");
    });
  });

  describe('buildExcludedUrlSuffixesFilter', () => {
    it('returns empty string for empty array', () => {
      const result = buildExcludedUrlSuffixesFilter([]);
      expect(result).to.equal('');
    });

    it('returns empty string for undefined input', () => {
      const result = buildExcludedUrlSuffixesFilter(undefined);
      expect(result).to.equal('');
    });

    it('returns empty string for null input', () => {
      const result = buildExcludedUrlSuffixesFilter(null);
      expect(result).to.equal('');
    });

    it('returns empty string for array with only falsy values', () => {
      const result = buildExcludedUrlSuffixesFilter(['', null, undefined]);
      expect(result).to.equal('');
    });

    it('builds correct filter for single suffix using regexp_like', () => {
      const result = buildExcludedUrlSuffixesFilter(['.pdf']);
      expect(result).to.equal("AND NOT regexp_like(url, '(?i)(\\.pdf)$')");
    });

    it('builds correct filter for multiple suffixes with alternation', () => {
      const result = buildExcludedUrlSuffixesFilter(['.pdf', '/robots.txt', '.xlsx']);

      expect(result).to.include('AND NOT regexp_like(url,');
      expect(result).to.include('(?i)');
      expect(result).to.include('\\.pdf');
      expect(result).to.include('/robots\\.txt');
      expect(result).to.include('\\.xlsx');
      expect(result).to.include('|');
      expect(result).to.include(')$');
    });

    it('escapes single quotes in suffixes to prevent SQL injection', () => {
      const result = buildExcludedUrlSuffixesFilter(["/file's.txt"]);
      expect(result).to.include("/file''s\\.txt");
    });

    it('escapes regex special characters in suffixes', () => {
      const result = buildExcludedUrlSuffixesFilter(['.pdf', '[test].doc']);
      expect(result).to.include('\\.pdf');
      expect(result).to.include('\\[test\\]\\.doc');
    });

    it('converts suffixes to lowercase for case-insensitive matching', () => {
      const result = buildExcludedUrlSuffixesFilter(['.PDF', '/ROBOTS.TXT']);
      expect(result).to.include('\\.pdf');
      expect(result).to.include('/robots\\.txt');
      expect(result).to.include('(?i)');
    });

    it('builds filter that matches URLs ending with suffix using $ anchor', () => {
      const result = buildExcludedUrlSuffixesFilter(['/robots.txt']);
      // The pattern should use $ to anchor match to end of string
      expect(result).to.equal("AND NOT regexp_like(url, '(?i)(/robots\\.txt)$')");
    });

    it('handles all common file type suffixes', () => {
      const suffixes = [
        '/sitemap.xml',
        '/robots.txt',
        '.ico',
        '.pdf',
        '.xlsx',
        '.docx',
        '.pptx',
      ];

      const result = buildExcludedUrlSuffixesFilter(suffixes);

      expect(result).to.include('AND NOT regexp_like(url,');
      expect(result).to.include('(?i)');
      expect(result).to.include(')$');
      // Check escaped versions of suffixes
      expect(result).to.include('/sitemap\\.xml');
      expect(result).to.include('/robots\\.txt');
      expect(result).to.include('\\.ico');
      expect(result).to.include('\\.pdf');
    });

    it('trims whitespace from suffixes', () => {
      const result = buildExcludedUrlSuffixesFilter(['  .pdf  ', '  /robots.txt  ']);
      expect(result).to.include('\\.pdf');
      expect(result).to.include('/robots\\.txt');
      expect(result).to.not.include('  ');
    });
  });
});
