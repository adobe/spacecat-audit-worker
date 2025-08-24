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
            startDate: new Date('2025-01-06'),
            endDate: new Date('2025-01-12'),
            weekLabel: 'Week 2 2025',
          },
        ],
      },
      databaseName: 'test_db',
      tableName: 'test_table',
      siteFilters: [],
      site: {
        getBaseURL: () => 'https://example.com',
        getConfig: () => ({
          getGroupedURLs: () => null,
        }),
      },
    };
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
    mockOptions.siteFilters = "url LIKE '%test%'";

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include("url LIKE '%test%'");
  });

  it('includes date filtering for the specified week', async () => {
    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
  });

  it('handles site with extract-only patterns', async () => {
    mockOptions.site.getConfig = () => ({
      getGroupedURLs: () => [
        { regex: '/(products)/' },
      ],
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include('REGEXP_EXTRACT');
    expect(query).to.include('NULLIF');
  });

  it('handles site with mixed named and extract patterns', async () => {
    mockOptions.site.getConfig = () => ({
      getGroupedURLs: () => [
        { regex: '/(products)/', name: 'Products' },
        { regex: '/(blog)/' },
      ],
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include('Products');
    expect(query).to.include('REGEXP_EXTRACT');
  });

  it('handles site with null URL patterns', async () => {
    mockOptions.site.getConfig = () => ({
      getGroupedURLs: () => null,
    });

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.be.a('string');
  });

  it('handles topic patterns with mixed named and extract patterns', async () => {
    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.be.a('string');
    expect(query).to.include('CASE');
  });

  it('handles cross-month date filtering', async () => {
    mockOptions.periods.weeks[0] = {
      startDate: new Date('2024-12-30'),
      endDate: new Date('2025-01-05'),
      weekLabel: 'Week 1 2025',
    };

    const query = await weeklyBreakdownQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include("year = '2024'");
    expect(query).to.include("month = '12'");
    expect(query).to.include("year = '2025'");
    expect(query).to.include("month = '01'");
    expect(query).to.include('OR');
  });

  it('handles empty conditions in where clause', async () => {
    const { weeklyBreakdownQueries: localQueries } = await import('../../../src/cdn-logs-report/utils/query-builder.js');

    mockOptions.siteFilters = [];

    const query = await localQueries.createAgenticReportQuery(mockOptions);

    expect(query).to.include('WHERE');
    expect(query).to.include('ChatGPT|GPTBot|OAI-SearchBot');
  });
});
