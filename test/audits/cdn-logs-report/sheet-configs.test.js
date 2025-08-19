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

describe('CDN Logs Sheet Configs', () => {
  let SHEET_CONFIGS;

  before(async () => {
    ({ SHEET_CONFIGS } = await import('../../../src/cdn-logs-report/constants/sheet-configs.js'));
  });

  const mockPeriods = {
    weeks: [
      {
        weekLabel: 'Week 1',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-01-07'),
      },
      {
        weekLabel: 'Week 2',
        startDate: new Date('2025-01-08'),
        endDate: new Date('2025-01-14'),
      },
    ],
    columns: ['Week 1', 'Week 2'],
  };

  describe('userAgents sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.userAgents.getHeaders();
      expect(headers).to.deep.equal([
        'Request User Agent',
        'Agent Type',
        'Status',
        'Number of Hits',
        'Avg TTFB (ms)',
      ]);
    });

    it('processes data correctly', () => {
      const mockData = [
        {
          user_agent: 'chrome/100',
          agent_type: 'browser',
          status: 200,
          total_requests: 150,
          avg_ttfb_ms: 250,
        },
        {
          user_agent: null,
          agent_type: null,
          status: null,
          total_requests: null,
          avg_ttfb_ms: null,
        },
      ];

      const result = SHEET_CONFIGS.userAgents.processData(mockData);
      expect(result).to.deep.equal([
        ['chrome/100', 'browser', 200, 150, 250],
        ['Unknown', 'Other', 'All', 0, 0],
      ]);
    });

    it('handles null data', () => {
      const result = SHEET_CONFIGS.userAgents.processData(null);
      expect(result).to.deep.equal([]);
    });
  });

  describe('country sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.country.getHeaders(mockPeriods);
      expect(headers).to.deep.equal(['Country Code', 'Agent Type', 'Week 1', 'Week 2']);
    });

    it('processes and aggregates country data correctly', () => {
      const mockData = [
        {
          country_code: 'US',
          agent_type: 'browser',
          week_1: 100,
          week_2: 150,
        },
        {
          country_code: 'US',
          agent_type: 'browser',
          week_1: 50,
          week_2: 75,
        },
        {
          country_code: 'CA',
          agent_type: 'bot',
          week_1: 25,
          week_2: 30,
        },
      ];

      const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);
      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal(['US', 'browser', 150, 225]);
      expect(result[1]).to.deep.equal(['CA', 'bot', 25, 30]);
    });

    it('handles invalid country codes', () => {
      const mockData = [
        {
          country_code: 'INVALID',
          agent_type: 'browser',
          week_1: 100,
          week_2: 150,
        },
      ];

      const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);
      expect(result[0][0]).to.equal('GLOBAL');
    });

    it('handles empty data', () => {
      const result = SHEET_CONFIGS.country.processData([], mockPeriods);
      expect(result).to.deep.equal([]);
    });
  });

  describe('error404 sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.error404.getHeaders();
      expect(headers).to.deep.equal(['URL', 'Agent Type', 'Number of 404s']);
    });

    it('processes 404 error data correctly', () => {
      const mockData = [
        {
          url: '/missing-page',
          agent_type: 'browser',
          total_requests: 10,
        },
        {
          url: null,
          agent_type: null,
          total_requests: null,
        },
      ];

      const result = SHEET_CONFIGS.error404.processData(mockData);
      expect(result).to.deep.equal([
        ['/missing-page', 'browser', 10],
        ['', 'Other', 0],
      ]);
    });
  });

  describe('error503 sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.error503.getHeaders();
      expect(headers).to.deep.equal(['URL', 'Agent Type', 'Number of 503s']);
    });

    it('processes 503 error data correctly', () => {
      const mockData = [
        {
          url: '/server-error',
          agent_type: 'bot',
          total_requests: 5,
        },
      ];

      const result = SHEET_CONFIGS.error503.processData(mockData);
      expect(result).to.deep.equal([
        ['/server-error', 'bot', 5],
      ]);
    });
  });

  describe('category sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.category.getHeaders();
      expect(headers).to.deep.equal(['Category', 'Agent Type', 'Number of Hits']);
    });

    it('extracts and aggregates product categories', () => {
      const mockData = [
        {
          url: '/en/products/protein-powder',
          agent_type: 'browser',
          total_requests: 40,
        },
        {
          url: '/en/products/protein-powder',
          agent_type: 'browser',
          total_requests: 20,
        },
        {
          url: '/en/products/vitamins',
          agent_type: 'bot',
          total_requests: 30,
        },
        {
          url: '/en/other-page',
          agent_type: 'browser',
          total_requests: 15,
        },
        {
          url: null,
          agent_type: null,
          total_requests: null,
        },
      ];

      const result = SHEET_CONFIGS.category.processData(mockData);
      expect(result).to.deep.equal([
        ['products/protein-powder', 'browser', 60],
        ['products/vitamins', 'bot', 30],
        ['Other', 'browser', 15],
        ['Other', 'Other', 0],
      ]);
    });

    it('handles null data', () => {
      const result = SHEET_CONFIGS.category.processData(null);
      expect(result).to.deep.equal([]);
    });
  });

  describe('topUrls sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.topUrls.getHeaders();
      expect(headers).to.deep.equal([
        'URL',
        'Total Hits',
        'Unique Agents',
        'Top Agent',
        'Top Agent Type',
        'Success Rate',
        'Avg TTFB (ms)',
        'Product',
      ]);
    });

    it('processes top URLs data correctly', () => {
      const mockData = [
        {
          url: '/popular-page',
          total_hits: 1000,
          unique_agents: 50,
          top_agent: 'chrome',
          top_agent_type: 'browser',
          success_rate: 0.95,
          avg_ttfb_ms: 200,
          product: 'web',
        },
        {
          url: null,
          total_hits: null,
          unique_agents: null,
          top_agent: null,
          top_agent_type: null,
          success_rate: null,
          avg_ttfb_ms: null,
          product: null,
        },
      ];

      const result = SHEET_CONFIGS.topUrls.processData(mockData);
      expect(result).to.deep.equal([
        ['/popular-page', 1000, 50, 'chrome', 'browser', 0.95, 200, 'web'],
        ['', 0, 0, 'N/A', 'Other', 0, 0, 'Other'],
      ]);
    });
  });

  describe('hitsByProductAgentType sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.hitsByProductAgentType.getHeaders();
      expect(headers).to.deep.equal(['Product', 'Agent Type', 'Hits']);
    });

    it('processes hits by product and agent type correctly', () => {
      const mockData = [
        {
          product: 'PHOTOSHOP',
          agent_type: 'browser',
          hits: 500,
        },
        {
          product: null,
          agent_type: null,
          hits: null,
        },
      ];

      const result = SHEET_CONFIGS.hitsByProductAgentType.processData(mockData);
      expect(result).to.deep.equal([
        ['Photoshop', 'browser', 500],
        ['Other', 'Other', 0],
      ]);
    });
  });

  describe('hitsByPageCategoryAgentType sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.hitsByPageCategoryAgentType.getHeaders();
      expect(headers).to.deep.equal(['Category', 'Agent Type', 'Hits']);
    });

    it('processes hits by page category and agent type correctly', () => {
      const mockData = [
        {
          category: 'product',
          agent_type: 'bot',
          hits: 250,
        },
        {
          category: null,
          agent_type: null,
          hits: null,
        },
      ];

      const result = SHEET_CONFIGS.hitsByPageCategoryAgentType.processData(mockData);
      expect(result).to.deep.equal([
        ['product', 'bot', 250],
        ['Other', 'Other', 0],
      ]);
    });
  });

  describe('sheet configuration properties', () => {
    it('all configs have required properties', () => {
      Object.entries(SHEET_CONFIGS).forEach(([, config]) => {
        expect(config).to.have.property('getHeaders');
        expect(config).to.have.property('processData');
        expect(config.getHeaders).to.be.a('function');
        expect(config.processData).to.be.a('function');
      });
    });

    it('all configs have headerColor property', () => {
      Object.values(SHEET_CONFIGS).forEach((config) => {
        expect(config).to.have.property('headerColor');
        expect(config.headerColor).to.be.a('string');
      });
    });
  });
});
