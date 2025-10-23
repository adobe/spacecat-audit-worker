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
import { weeklyBreakdownQueries } from '../../../src/cdn-logs-report/utils/query-builder.js';

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
    expect(query).to.include('ChatGPT|GPTBot|OAI-SearchBot');
  });
});
