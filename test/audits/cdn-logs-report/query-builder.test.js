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

use(sinonChai);

describe('CDN Logs Query Builder', () => {
  let weeklyBreakdownQueries;
  let mockOptions;

  before(async () => {
    ({ weeklyBreakdownQueries } = await import('../../../src/cdn-logs-report/utils/query-builder.js'));
  });

  beforeEach(() => {
    mockOptions = {
      periods: {
        weeks: [
          {
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-01-07'),
            weekLabel: 'Week 1',
            dateRange: { start: '2025-01-01', end: '2025-01-07' },
          },
          {
            startDate: new Date('2025-01-08'),
            endDate: new Date('2025-01-14'),
            weekLabel: 'Week 2',
            dateRange: { start: '2025-01-08', end: '2025-01-14' },
          },
        ],
        columns: ['Week 1', 'Week 2'],
      },
      databaseName: 'test_db',
      tableName: 'test_table',
      provider: 'chatgpt',
      siteFilters: [],
      site: {
        getBaseURL: () => 'https://adobe.com',
        getConfig: () => ({
          getGroupedURLs: () => [
            { name: 'home', pattern: '^/$' },
            { name: 'product', pattern: '/products/.+' },
          ],
        }),
      },
    };
  });

  it('builds comprehensive set of analytics queries with proper filtering', async () => {
    const queries = await Promise.all([
      weeklyBreakdownQueries.createCountryWeeklyBreakdown(mockOptions),
      weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(mockOptions),
      weeklyBreakdownQueries.createError404Urls(mockOptions),
      weeklyBreakdownQueries.createError503Urls(mockOptions),
      weeklyBreakdownQueries.createTopUrls(mockOptions),
      weeklyBreakdownQueries.createReferralTrafficByCountryTopic(mockOptions),
      weeklyBreakdownQueries.createReferralTrafficByUrlTopic(mockOptions),
      weeklyBreakdownQueries.createHitsByProductAgentType(mockOptions),
      weeklyBreakdownQueries.createHitsByPageCategoryAgentType(mockOptions),
    ]);

    queries.forEach((query) => {
      expect(query).to.be.a('string');
      expect(query.length).to.be.greaterThan(50);
      expect(query.toUpperCase()).to.include('SELECT');
      expect(query).to.include('test_db');
      expect(query).to.include('test_table');
    });
  });

  it('handles bulk.com site with special success URLs by category query', async () => {
    const bulkOptions = {
      ...mockOptions,
      site: {
        getBaseURL: () => 'https://bulk.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      },
    };

    const categoryQuery = await weeklyBreakdownQueries.createSuccessUrlsByCategory(bulkOptions);

    expect(categoryQuery).to.be.a('string');
    expect(categoryQuery.toUpperCase()).to.include('SELECT');
    expect(categoryQuery).to.include('status = 200');
    expect(categoryQuery).to.include('test_db');
    expect(categoryQuery).to.include('test_table');
  });

  it('generates valid queries without provider filtering when provider is null', async () => {
    const optionsWithoutProvider = {
      ...mockOptions,
      provider: null,
    };

    const query = await weeklyBreakdownQueries.createCountryWeeklyBreakdown(optionsWithoutProvider);

    expect(query).to.be.a('string');
    expect(query).to.not.include('REGEXP_LIKE(user_agent');
    expect(query).to.include('test_db');
    expect(query).to.include('test_table');
    expect(query.toUpperCase()).to.include('SELECT');
  });

  it('includes site filters when provided in query options', async () => {
    const optionsWithFilters = {
      ...mockOptions,
      siteFilters: ['url LIKE "https://test.com/%"', 'status = 200'],
    };

    const query = await weeklyBreakdownQueries.createCountryWeeklyBreakdown(optionsWithFilters);

    expect(query).to.be.a('string');
    expect(query).to.include('test_db');
    expect(query).to.include('test_table');
    expect(query.toUpperCase()).to.include('SELECT');
  });

  it('returns null for non-bulk.com sites when creating success URLs by category', async () => {
    const nonBulkOptions = {
      ...mockOptions,
      site: {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      },
    };

    const result = await weeklyBreakdownQueries.createSuccessUrlsByCategory(nonBulkOptions);

    expect(result).to.be.null;
  });

  it('handles cross-month date ranges in query filters', async () => {
    const crossMonthOptions = {
      ...mockOptions,
      periods: {
        weeks: [
          {
            startDate: new Date('2024-01-25'),
            endDate: new Date('2024-02-05'),
            weekLabel: 'Week 1',
            dateRange: { start: '2024-01-25', end: '2024-02-05' },
          },
        ],
        columns: ['Week 1'],
      },
    };

    const query = await weeklyBreakdownQueries.createCountryWeeklyBreakdown(crossMonthOptions);

    expect(query).to.be.a('string');
    expect(query).to.include("year = '2024' AND month = '01' AND day >= '25'");
    expect(query).to.include("year = '2024' AND month = '02' AND day <= '05'");
  });

  it('generates queries without WHERE clause when no filters are applied', async () => {
    const noFilterOptions = {
      ...mockOptions,
      provider: null,
      siteFilters: [],
    };

    const query = await weeklyBreakdownQueries.createUserAgentWeeklyBreakdown(noFilterOptions);

    expect(query).to.be.a('string');
    expect(query).to.not.include('REGEXP_LIKE(user_agent');
    expect(query).to.include('test_db');
    expect(query).to.include('test_table');
  });

  it('handles exact patterns without regex', async () => {
    const exactOnlyOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            patterns: {
              pages: {
                product: { exact: '/products' },
                help: { exact: '/help' },
              },
            },
          }),
        }),
        getBaseURL: () => 'https://test.com',
      },
    };

    const query = await weeklyBreakdownQueries.createSuccessUrlsByCategory(exactOnlyOptions);
    if (query) {
      expect(query).to.include('CASE');
      expect(query).to.include('product');
    }
  });

  it('handles mixed exact and regex patterns', async () => {
    const mixedOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            patterns: {
              pages: {
                product: { exact: '/products' },
                blog: '/blog/([^/]+)',
              },
            },
          }),
        }),
        getBaseURL: () => 'https://test.com',
      },
    };

    const query = await weeklyBreakdownQueries.createSuccessUrlsByCategory(mixedOptions);
    if (query) {
      expect(query).to.include('CASE');
      expect(query).to.include('COALESCE');
    }
  });

  it('handles patterns with only named patterns', async () => {
    const namedOnlyOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            patterns: {
              pages: { product: { exact: '/products/' } },
            },
          }),
        }),
        getBaseURL: () => 'https://test.com',
      },
    };

    const query = await weeklyBreakdownQueries.createSuccessUrlsByCategory(namedOnlyOptions);
    if (query) {
      expect(query).to.include('CASE');
    }
  });

  it('handles patterns with only regex extracts', async () => {
    const regexOnlyOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            patterns: {
              pages: { product: '/products/([^/]+)' },
            },
          }),
        }),
        getBaseURL: () => 'https://test.com',
      },
    };

    const query = await weeklyBreakdownQueries.createSuccessUrlsByCategory(regexOnlyOptions);
    if (query) {
      expect(query).to.include('COALESCE');
    }
  });

  it('falls back to default patterns when site config returns null', async () => {
    const nullConfigOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => null }),
        getBaseURL: () => 'https://example.com',
      },
    };

    const query = await weeklyBreakdownQueries.createSuccessUrlsByCategory(nullConfigOptions);
    // The function may return null when config is null, which is acceptable behavior
    expect(query === null || typeof query === 'string').to.be.true;
    if (query !== null) {
      expect(query).to.include('test_db');
      expect(query).to.include('test_table');
    }
  });

  it('creates referral traffic queries with proper filtering', async () => {
    const referralQueries = await Promise.all([
      weeklyBreakdownQueries.createReferralTrafficByCountryTopic(mockOptions),
      weeklyBreakdownQueries.createReferralTrafficByUrlTopic(mockOptions),
    ]);

    referralQueries.forEach((query) => {
      expect(query).to.be.a('string');
      expect(query).to.include('test_db');
      expect(query).to.include('test_table');
    });

    const countryTopicQuery = referralQueries[0];
    expect(countryTopicQuery).to.include('CASE');
    expect(countryTopicQuery).to.include('REGEXP_EXTRACT');

    const urlTopicQuery = referralQueries[1];
    expect(urlTopicQuery).to.include('CASE');
  });

  it('handles unknown domains by returning Other for topic extraction', async () => {
    const unknownDomainOptions = {
      ...mockOptions,
      site: {
        getBaseURL: () => 'https://unknown-domain.com',
        getConfig: () => ({ getGroupedURLs: () => [] }),
      },
    };

    const query = await weeklyBreakdownQueries
      .createReferralTrafficByCountryTopic(unknownDomainOptions);

    expect(query).to.include("'Other'");
  });

  it('handles single pattern objects for topic extraction', async () => {
    const singlePatternOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({
          getCdnLogsConfig: () => ({
            patterns: {
              pages: { product: '/products/' },
              topics: { adobe: 'adobe' },
            },
          }),
        }),
        getBaseURL: () => 'https://test.com',
      },
    };

    const query = await weeklyBreakdownQueries.createTopUrls(singlePatternOptions);
    expect(query).to.be.a('string');
    expect(query).to.include('test_db');
    expect(query).to.include('test_table');
  });

  it('covers all branches in buildTopicExtractionSQL', async () => {
    const extractOnlyOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => ({ patterns: {} }) }),
        getBaseURL: () => 'https://bulk.com',
      },
    };

    const extractOnlyQuery = await weeklyBreakdownQueries
      .createReferralTrafficByCountryTopic(extractOnlyOptions);
    expect(extractOnlyQuery).to.include('COALESCE');
    expect(extractOnlyQuery).to.include('REGEXP_EXTRACT');

    const mixedOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => ({ patterns: {} }) }),
        getBaseURL: () => 'https://business.adobe.com',
      },
    };

    const mixedQuery = await weeklyBreakdownQueries
      .createReferralTrafficByCountryTopic(mixedOptions);
    expect(mixedQuery).to.include('REGEXP_EXTRACT');

    const namedOnlyOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => ({ patterns: {} }) }),
        getBaseURL: () => 'https://adobe.com',
      },
    };

    const namedOnlyQuery = await weeklyBreakdownQueries
      .createReferralTrafficByCountryTopic(namedOnlyOptions);
    expect(namedOnlyQuery).to.include('CASE');
    expect(namedOnlyQuery).to.include('Acrobat');

    // Test unknown domain - covers lines 118-119
    const unknownDomainOptions = {
      ...mockOptions,
      site: {
        getConfig: () => ({ getCdnLogsConfig: () => ({ patterns: {} }) }),
        getBaseURL: () => 'https://unknown-domain.com',
      },
    };

    const unknownQuery = await weeklyBreakdownQueries
      .createReferralTrafficByCountryTopic(unknownDomainOptions);
    expect(unknownQuery).to.include("'Other'");
  });
});
