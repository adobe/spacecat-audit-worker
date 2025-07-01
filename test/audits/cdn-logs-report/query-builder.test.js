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
        getBaseURL: () => 'https://test.com',
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
      weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(mockOptions),
      weeklyBreakdownQueries.createTopBottomUrlsByStatus(mockOptions),
      weeklyBreakdownQueries.createError404Urls(mockOptions),
      weeklyBreakdownQueries.createError503Urls(mockOptions),
      weeklyBreakdownQueries.createTopUrls(mockOptions),
    ]);

    queries.forEach((query) => {
      expect(query).to.be.a('string');
      expect(query.length).to.be.greaterThan(50);
      expect(query.toUpperCase()).to.include('SELECT');
      expect(query).to.include('test_db');
      expect(query).to.include('test_table');
    });

    const countryQuery = queries[0];
    expect(countryQuery).to.include("REGEXP_LIKE(user_agent, '(?i)ChatGPT|GPTBot|OAI-SearchBot')");

    expect(countryQuery).to.include("year = '2025'");
    expect(countryQuery).to.include("month = '01'");
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

  it('falls back to default patterns when site config returns null', async () => {
    const nullConfigOptions = {
      ...mockOptions,
      site: {
        getBaseURL: () => 'https://test.com',
        getConfig: () => ({ getGroupedURLs: () => null }),
      },
    };

    const query = await weeklyBreakdownQueries.createUrlStatusWeeklyBreakdown(nullConfigOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('test_db');
    expect(query).to.include('test_table');
    expect(query.toUpperCase()).to.include('CASE');
  });
});
