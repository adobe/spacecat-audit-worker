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
  getId: () => 'test-site-id',
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
  pagePatterns: [{ name: 'Product Page', regex: '.*product.*', sort_order: 0 }],
  topicPatterns: [
    { regex: '/products/', name: 'Products', sort_order: 0 },
    { regex: '/category/([^/]+)', sort_order: 1 },
  ],
});

const createMockPostgrestClient = ({
  categoryRules = [],
  pageTypeRules = [],
} = {}) => ({
  from: (table) => {
    const data = table === 'agentic_url_category_rules' ? categoryRules : pageTypeRules;
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve) => Promise.resolve({ data, error: null }).then(resolve),
    };
    return query;
  },
});

describe('CDN Logs Query Builder', () => {
  let mockOptions;

  beforeEach(() => {
    mockOptions = createMockOptions();
  });

  // Pattern/classification helpers are shared by the agentic daily query and the
  // (retired) weekly report query; exercise them via the live daily query.
  const dailyArgs = (overrides = {}) => ({
    trafficDate: new Date('2025-01-07T00:00:00Z'),
    databaseName: 'test_db',
    tableName: 'test_table',
    site: createMockSite(),
    ...overrides,
  });

  it('creates a daily agentic query with ChatGPT and Perplexity filtering', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs());

    expect(query).to.be.a('string');
    expect(query).to.include('ChatGPT|GPTBot|OAI-SearchBot|OAI-AdsBot');
    expect(query).to.include('Perplexity');
    expect(query).to.include('test_db.test_table');
    expect(query).to.include('agent_type');
    expect(query).to.include('user_agent_display');
    expect(query).to.include('avg_ttfb_ms');
  });

  it('creates a daily agentic export query for a single UTC day', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs());

    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
    expect(query).to.include("day = '07'");
    expect(query).to.include('test_db.test_table');
    expect(query).to.include('user_agent_display');
    expect(query).to.include('avg_ttfb_ms');
    expect(query).to.include("WHERE agent_type != 'Other'");
    expect(query).to.not.include('cdn_provider');
  });

  it('handles a site with no patterns (default Other classification)', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      site: createMockSite({ getBaseURL: () => 'https://unknown.com' }),
    }));

    expect(query).to.be.a('string');
    expect(query).to.include('Other');
  });

  it('builds topic + page-type classification from DB rules', async () => {
    const patterns = createMockPatterns();
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({ getLlmoDataFolder: () => 'test-folder' }),
      }),
      context: {
        dataAccess: {
          services: {
            postgrestClient: createMockPostgrestClient({
              categoryRules: patterns.topicPatterns,
              pageTypeRules: patterns.pagePatterns,
            }),
          },
        },
      },
    }));

    expect(query).to.be.a('string');
    expect(query).to.include('CASE');
  });

  it('uses pre-fetched patterns for daily agentic report queries', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      remotePatterns: createMockPatterns(),
    }));

    expect(query).to.include("THEN 'Product Page'");
    expect(query).to.include("THEN 'Products'");
  });

  it('escapes single quotes in pattern regex and name to prevent SQL injection', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      remotePatterns: {
        pagePatterns: [{ name: "O'Brien Page", regex: "/o'brien/.*", sort_order: 0 }],
        topicPatterns: [{ name: "Can't Stop", regex: "/can't/", sort_order: 0 }],
      },
    }));

    expect(query).to.include("THEN 'O''Brien Page'");
    expect(query).to.include("/o''brien/.*");
    expect(query).to.include("THEN 'Can''t Stop'");
    expect(query).to.include("/can''t/");
  });

  it('falls back to default classification when remotePatterns has an error', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      remotePatterns: { error: true, source: 'postgres' },
    }));

    expect(query).to.include("'Other'");
    expect(query).to.not.include("REGEXP_LIKE(url, 'undefined')");
  });

  it('handles topic patterns with extract-only patterns', async () => {
    const query = await weeklyBreakdownQueries.createAgenticDailyReportQuery(dailyArgs({
      context: {
        dataAccess: {
          services: {
            postgrestClient: createMockPostgrestClient({
              categoryRules: [{ regex: '/category/([^/]+)', sort_order: 0 }],
              pageTypeRules: [],
            }),
          },
        },
      },
    }));

    expect(query).to.include("COALESCE(\n    NULLIF(REGEXP_EXTRACT(url, '/category/([^/]+)', 1), ''),");
  });

  // Date-filter + where-clause + site-filter helpers are shared with the live
  // top-urls query; exercise them there.
  it('includes date filtering for the specified week', async () => {
    const query = await weeklyBreakdownQueries.createTopUrlsQuery(mockOptions);

    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
  });

  it('handles cross-month date filtering', async () => {
    const query = await weeklyBreakdownQueries.createTopUrlsQuery(createMockOptions({
      periods: {
        weeks: [{
          startDate: new Date('2024-12-30'),
          endDate: new Date('2025-01-05'),
          weekLabel: 'Week 1 2025',
        }],
      },
    }));

    expect(query).to.include("year = '2024'");
    expect(query).to.include("month = '12'");
    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
    expect(query).to.include('OR');
  });

  it('handles empty site-filter conditions in the where clause', async () => {
    const query = await weeklyBreakdownQueries.createTopUrlsQuery(createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [],
        }),
      }),
    }));

    expect(query).to.include('WHERE');
    expect(query).to.include('(?i)(ChatGPT|GPTBot|OAI-SearchBot|OAI-AdsBot)(?!.*(Tokowaka|Spacecat))');
    expect(query).to.include('(?i)Claude(?!-web)');
  });

  it('handles site filters correctly', async () => {
    const query = await weeklyBreakdownQueries.createTopUrlsQuery(createMockOptions({
      site: createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [{ value: ['test'], key: 'url' }],
        }),
      }),
    }));

    expect(query).to.include("(REGEXP_LIKE(url, '(?i)(test)'))");
  });

  describe('createTopUrlsQueryWithLimit', () => {
    it('creates top URLs query without a limit', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsQuery(mockOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('test_db.test_table');
      expect(query).to.include("year = '2025'");
      expect(query).to.include("month = '01'");
    });

    it('creates query with limit parameter', async () => {
      const customOptions = createMockOptions({
        limit: 100,
      });

      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(customOptions);

      expect(query).to.be.a('string');
      expect(query).to.include('LIMIT 100');
      expect(query).to.include('test_db.test_table');
    });

    it('creates query without status filter when statuses is not provided', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
        createMockOptions({ limit: 100 }),
      );

      expect(query).to.not.include('AND status IN');
      expect(query).to.not.include('status');
    });

    it('creates query without status filter when statuses is empty array', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
        createMockOptions({ limit: 100, statuses: [] }),
      );

      expect(query).to.not.include('AND status IN');
    });

    it('creates live variant query with AND status IN (200) when statuses=[200]', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
        createMockOptions({ limit: 100, statuses: [200] }),
      );

      expect(query).to.include('AND status IN (200)');
      expect(query).to.include('LIMIT 100');
    });

    it('createTopUrlsQueryWithLimit with statuses respects limit parameter', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
        createMockOptions({ limit: 50, statuses: [200] }),
      );

      expect(query).to.include('LIMIT 50');
    });

    it('throws on invalid HTTP status code in statuses filter', async () => {
      let err;
      try {
        await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
          createMockOptions({ limit: 10, statuses: ['injection; DROP TABLE'] }),
        );
      } catch (e) { err = e; }
      expect(err).to.be.instanceOf(Error);
      expect(err.message).to.match(/Invalid HTTP status code/);
    });

    it('throws on out-of-range status code in statuses filter', async () => {
      for (const bad of [99, 600]) {
        // eslint-disable-next-line no-await-in-loop
        let err;
        try {
          // eslint-disable-next-line no-await-in-loop
          await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(
            createMockOptions({ limit: 10, statuses: [bad] }),
          );
        } catch (e) { err = e; }
        expect(err).to.be.instanceOf(Error);
        expect(err.message).to.match(/Invalid HTTP status code/);
      }
    });

    it('throws when neither periods nor startDate/endDate is provided', async () => {
      const options = createMockOptions({ periods: undefined, limit: 10 });
      let err;
      try {
        await weeklyBreakdownQueries.createTopUrlsQueryWithLimit(options);
      } catch (e) { err = e; }
      expect(err).to.be.instanceOf(Error);
      expect(err.message).to.match(/either periods or startDate\/endDate is required/);
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

  describe('createTopUrlsWithHitsQuery', () => {
    it('generates a query that returns url and total_hits columns', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsWithHitsQuery({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-28'),
        databaseName: 'test_db',
        tableName: 'test_table',
        site: createMockSite(),
        limit: 200,
        excludedUrlSuffixes: ['.pdf', '/robots.txt'],
      });

      expect(query).to.be.a('string');
      expect(query).to.include('test_db.test_table');
      expect(query).to.include('total_hits');
      expect(query).to.include('url');
      expect(query).to.include('200');
    });

    it('includes site filters in the WHERE clause', async () => {
      const siteWithFilter = createMockSite({
        getConfig: () => createMockSiteConfig({
          getLlmoCdnlogsFilter: () => [{ value: ['www.custom.com'], key: 'host' }],
        }),
      });

      const query = await weeklyBreakdownQueries.createTopUrlsWithHitsQuery({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-28'),
        databaseName: 'test_db',
        tableName: 'test_table',
        site: siteWithFilter,
        limit: 100,
        excludedUrlSuffixes: [],
      });

      expect(query).to.include('www.custom.com');
    });

    it('excludes configured URL suffixes', async () => {
      const query = await weeklyBreakdownQueries.createTopUrlsWithHitsQuery({
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-28'),
        databaseName: 'test_db',
        tableName: 'test_table',
        site: createMockSite(),
        limit: 100,
        excludedUrlSuffixes: ['.pdf', '.xlsx'],
      });

      expect(query).to.include('AND NOT regexp_like');
      expect(query).to.include('\\.pdf');
      expect(query).to.include('\\.xlsx');
    });
  });
});
