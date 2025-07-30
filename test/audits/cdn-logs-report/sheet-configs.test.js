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

describe('Sheet Configs', () => {
  let SHEET_CONFIGS;

  before(async () => {
    ({ SHEET_CONFIGS } = await import('../../../src/cdn-logs-report/constants/sheet-configs.js'));
  });

  const mockPeriods = {
    weeks: [
      { weekLabel: 'Week 1', dateRange: { start: '2024-01-01', end: '2024-01-07' } },
      { weekLabel: 'Week 2', dateRange: { start: '2024-01-08', end: '2024-01-14' } },
    ],
    columns: ['Week 1', 'Week 2'],
  };

  describe('Configuration Properties', () => {
    it('should have required properties for all configs', () => {
      Object.entries(SHEET_CONFIGS).forEach(([name, config]) => {
        expect(config).to.have.property('getHeaders').that.is.a('function', `${name} missing getHeaders function`);
        expect(config).to.have.property('processData').that.is.a('function', `${name} missing processData function`);
        expect(config).to.have.property('headerColor').that.is.a('string', `${name} missing headerColor string`);

        if (['country', 'pageType'].includes(name)) {
          expect(config).to.have.property('getNumberColumns').that.is.a('function', `${name} missing getNumberColumns function`);
        } else {
          expect(config).to.have.property('numberColumns').that.is.an('array', `${name} missing numberColumns array`);
        }
      });
    });

    it('should return correct headers', () => {
      expect(SHEET_CONFIGS.country.getHeaders(mockPeriods)).to.deep.equal(['Country Code', 'Agent Type', 'Week 1', 'Week 2']);
      expect(SHEET_CONFIGS.userAgents.getHeaders(mockPeriods)).to.deep.equal([
        'Request User Agent', 'Agent Type', 'Status', 'Number of Hits', 'Avg TTFB (ms)',
        'Interval: Last Week (2024-01-08 - 2024-01-14)',
      ]);
      expect(SHEET_CONFIGS.error404.getHeaders()).to.deep.equal(['URL', 'Agent Type', 'Number of 404s']);
      expect(SHEET_CONFIGS.error503.getHeaders()).to.deep.equal(['URL', 'Agent Type', 'Number of 503s']);
      expect(SHEET_CONFIGS.category.getHeaders()).to.deep.equal(['Category', 'Agent Type', 'Number of Hits']);
      expect(SHEET_CONFIGS.topUrls.getHeaders()).to.deep.equal(['URL', 'Total Hits', 'Unique Agents', 'Top Agent', 'Top Agent Type', 'Success Rate', 'Avg TTFB (ms)', 'Product']);
      expect(SHEET_CONFIGS.pageType.getHeaders(mockPeriods)).to.deep.equal(['Page Type', 'Agent Type', 'Week 1', 'Week 2']);
      expect(SHEET_CONFIGS.hitsByProductAgentType.getHeaders()).to.deep.equal(['Product', 'Agent Type', 'Hits']);
      expect(SHEET_CONFIGS.hitsByPageCategoryAgentType.getHeaders()).to.deep.equal(['Category', 'Agent Type', 'Hits']);
    });

    it('should return correct number columns for dynamic configs', () => {
      expect(SHEET_CONFIGS.country.getNumberColumns(mockPeriods)).to.deep.equal([2]);
      expect(SHEET_CONFIGS.pageType.getNumberColumns(mockPeriods)).to.deep.equal([2]);
    });
  });

  describe('Data Processing', () => {
    describe('Weekly Data Processing', () => {
      it('processes country data with weekly aggregation', () => {
        const mockData = [
          {
            country_code: 'US', agent_type: 'Other', week_1: 100, week_2: 0,
          },
          {
            country_code: 'US', agent_type: 'Other', week_1: 0, week_2: 150,
          },
          {
            country_code: 'CA', agent_type: 'Other', week_1: 50, week_2: 0,
          },
        ];

        const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);
        expect(result).to.have.lengthOf(2);
        const usRow = result.find((row) => row[0] === 'US');
        expect(usRow).to.exist;
        expect(usRow[1]).to.equal('Other');
        expect(usRow[2]).to.equal(100);
        expect(usRow[3]).to.equal(150);
      });
    });

    describe('Standard Data Processing', () => {
      it('processes userAgents data', () => {
        const mockData = [
          {
            user_agent: 'Chrome', agent_type: 'Other', status: 200, total_requests: 100,
          },
          {
            user_agent: 'Unknown', agent_type: 'Other', status: 'All', total_requests: 0,
          },
        ];

        const result = SHEET_CONFIGS.userAgents.processData(mockData);
        expect(result).to.deep.equal([
          ['Chrome', 'Other', 200, 100, 0, ''],
          ['Unknown', 'Other', 'All', 0, 0, ''],
        ]);
      });

      it('processes hitsByProductAgentType data', () => {
        const mockData = [
          { product: 'adobe-commerce', agent_type: 'Other', hits: 100 },
          { product: '', agent_type: 'Other', hits: 50 },
        ];

        const result = SHEET_CONFIGS.hitsByProductAgentType.processData(mockData);
        expect(result).to.deep.equal([
          ['Adobe-commerce', 'Other', 100],
          ['Other', 'Other', 50],
        ]);
      });

      it('covers capitalizeFirstLetter function directly', () => {
        // Access the capitalizeFirstLetter function from sheet-configs.js
        const mockData = [{ product: null, agent_type: 'Other', hits: 100 }];
        const result = SHEET_CONFIGS.hitsByProductAgentType.processData(mockData);
        expect(result).to.have.lengthOf(1);
        expect(result[0][0]).to.equal('Other'); // covers capitalizeFirstLetter(null) -> null case
      });

      it('processes hitsByProductAgentType data with empty product', () => {
        const mockData = [
          { product: '', agent_type: 'Other', hits: 50 },
        ];

        const result = SHEET_CONFIGS.hitsByProductAgentType.processData(mockData);
        expect(result).to.have.lengthOf(1);
        expect(result[0][0]).to.equal('Other'); // covers the empty product fallback
      });

      it('processes hitsByPageCategoryAgentType data with empty input', () => {
        const mockData = [
          { category: '', agent_type: 'Other', hits: 25 },
        ];

        const result = SHEET_CONFIGS.hitsByPageCategoryAgentType.processData(mockData);
        expect(result).to.have.lengthOf(1);
        expect(result[0][0]).to.equal('Other');
      });

      it('processes hitsByPageCategoryAgentType data', () => {
        const mockData = [
          { category: 'product', agent_type: 'Other', hits: 75 },
          { category: '', agent_type: 'Other', hits: 25 },
        ];

        const result = SHEET_CONFIGS.hitsByPageCategoryAgentType.processData(mockData);
        expect(result).to.deep.equal([
          ['product', 'Other', 75],
          ['Other', 'Other', 25],
        ]);
      });

      it('processes topUrls data', () => {
        const mockData = [
          {
            url: '/page1', total_hits: 100, unique_agents: 0, top_agent: 'N/A', top_agent_type: 'Other', success_rate: 0, product: 'Other',
          },
          {
            url: '', total_hits: 0, unique_agents: 0, top_agent: 'N/A', top_agent_type: 'Other', success_rate: 0, product: 'Other',
          },
        ];

        const result = SHEET_CONFIGS.topUrls.processData(mockData);
        expect(result).to.deep.equal([
          ['/page1', 100, 0, 'N/A', 'Other', 0, 0, 'Other'],
          ['', 0, 0, 'N/A', 'Other', 0, 0, 'Other'],
        ]);
      });

      it('processes error pages data', () => {
        const mockData = [
          { url: '/missing-page', agent_type: 'Other', total_requests: 10 },
          { url: '/server-error', agent_type: 'Other', total_requests: 3 },
        ];

        const result = SHEET_CONFIGS.error404.processData(mockData);
        expect(result).to.deep.equal([
          ['/missing-page', 'Other', 10],
          ['/server-error', 'Other', 3],
        ]);
      });

      it('processes category data with URL pattern matching', () => {
        const mockData = [
          { url: '/en/products/photoshop/features', total_requests: 100 },
          { url: '/es/products/illustrator/pricing', total_requests: 50 },
          { url: '/other-page', total_requests: 25 },
        ];

        const result = SHEET_CONFIGS.category.processData(mockData);

        expect(result).to.be.an('array');
        expect(result.length).to.be.greaterThan(0);
        expect(result.some(([category]) => category.includes('photoshop'))).to.be.true;
        expect(result.some(([category]) => category.includes('illustrator'))).to.be.true;
        expect(result.some(([category]) => category === 'Other')).to.be.true;
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('handles null/undefined data gracefully', () => {
      const configs = ['category'];

      configs.forEach((configName) => {
        const config = SHEET_CONFIGS[configName];
        if (config && config.processData) {
          const result = config.processData(null);
          expect(result).to.be.an('array', `${configName} should handle null data`);
        }
      });

      // Test configs that require reportPeriods separately
      const periodConfigs = ['country'];
      periodConfigs.forEach((configName) => {
        const config = SHEET_CONFIGS[configName];
        if (config && config.processData) {
          const result = config.processData(null, mockPeriods);
          expect(result).to.be.an('array', `${configName} should handle null data`);
        }
      });
    });

    it('handles weekly data edge cases', () => {
      const emptyPeriods = { weeks: [], columns: ['Country Code'] };

      expect(() => SHEET_CONFIGS.country.processData([], emptyPeriods)).to.not.throw();
      expect(() => SHEET_CONFIGS.pageType.processData([], emptyPeriods)).to.not.throw();
    });

    it('processes pageType data with valid input', () => {
      const mockData = [
        {
          page_type: 'product', agent_type: 'Desktop', week_label: 'Week 1', hits: 100,
        },
        {
          page_type: 'home', agent_type: 'Mobile', week_label: 'Week 2', hits: 50,
        },
      ];
      const mockPeriodsLocal = {
        weeks: [
          { weekLabel: 'Week 1', dateRange: { start: '2024-01-01', end: '2024-01-07' } },
          { weekLabel: 'Week 2', dateRange: { start: '2024-01-08', end: '2024-01-14' } },
        ],
        columns: ['Week 1', 'Week 2'],
      };

      const result = SHEET_CONFIGS.pageType.processData(mockData, mockPeriodsLocal);
      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
    });

    it('processes pageType data with no data fallback', () => {
      const mockPeriodsNoData = {
        weeks: [
          { weekLabel: 'Week 1', dateRange: { start: '2024-01-01', end: '2024-01-07' } },
        ],
        columns: ['Week 1'],
      };

      const result = SHEET_CONFIGS.pageType.processData([], mockPeriodsNoData);
      expect(result).to.deep.equal([['No data', 'Other', 0]]);
    });

    it('covers all edge cases and fallbacks in processData functions', () => {
      // Test hitsByProductAgentType with null product fallback
      const productData = [{ product: null, agent_type: 'Desktop', hits: 50 }];
      const productResult = SHEET_CONFIGS.hitsByProductAgentType.processData(productData);
      expect(productResult[0][0]).to.equal('Other');

      // Test hitsByPageCategoryAgentType with null category fallback
      const categoryData = [{ category: null, agent_type: 'Mobile', hits: 25 }];
      const categoryResult = SHEET_CONFIGS.hitsByPageCategoryAgentType.processData(categoryData);
      expect(categoryResult[0][0]).to.equal('Other');

      // Test capitalizeFirstLetter with empty product fallback
      const emptyProductData = [{ product: '', agent_type: 'Desktop', hits: 50 }];
      const emptyProductResult = SHEET_CONFIGS.hitsByProductAgentType.processData(emptyProductData);
      expect(emptyProductResult[0][0]).to.equal('Other');

      // Test empty category fallback
      const emptyCategoryData = [{ category: '', agent_type: 'Mobile', hits: 25 }];
      const emptyCategoryResult = SHEET_CONFIGS.hitsByPageCategoryAgentType
        .processData(emptyCategoryData);
      expect(emptyCategoryResult[0][0]).to.equal('Other');

      // Test null data fallbacks for data?.map operations
      expect(SHEET_CONFIGS.hitsByProductAgentType.processData(null)).to.deep.equal([]);
      expect(SHEET_CONFIGS.hitsByPageCategoryAgentType.processData(null)).to.deep.equal([]);

      // Test capitalizeFirstLetter with non-string types
      const numberProductData = [{ product: 123, agent_type: 'Desktop', hits: 50 }];
      const numberProductResult = SHEET_CONFIGS.hitsByProductAgentType
        .processData(numberProductData);
      expect(numberProductResult[0][0]).to.equal(123);

      const missingAgentData = [{ product: 'test', hits: 50 }];
      const missingAgentResult = SHEET_CONFIGS.hitsByProductAgentType.processData(missingAgentData);
      expect(missingAgentResult[0][1]).to.equal('Other');

      const stringHitsData = [{ product: 'test', agent_type: 'Desktop', hits: 'abc' }];
      const stringHitsResult = SHEET_CONFIGS.hitsByProductAgentType.processData(stringHitsData);
      expect(stringHitsResult[0][2]).to.equal(0);
    });

    it('covers all uncovered branches in sheet-configs', () => {
      const arrayValueData = [{ country_code: 'US', agent_type: 'Desktop', week_1: 100 }];
      const mockPeriodsForArray = {
        weeks: [{ weekLabel: 'Week 1', dateRange: { start: '2024-01-01', end: '2024-01-07' } }],
        columns: ['Week 1'],
      };

      const result = SHEET_CONFIGS.country.processData(arrayValueData, mockPeriodsForArray);
      expect(result).to.be.an('array');

      const missingCountryData = [{ agent_type: 'Desktop', week_1: 100 }];
      const missingCountryResult = SHEET_CONFIGS.country
        .processData(missingCountryData, mockPeriodsForArray);
      expect(missingCountryResult).to.be.an('array');

      const missingPageTypeData = [{ agent_type: 'Desktop', week_1: 100 }];
      const pageTypeResult = SHEET_CONFIGS.pageType
        .processData(missingPageTypeData, mockPeriodsForArray);
      expect(pageTypeResult).to.be.an('array');
      if (pageTypeResult.length > 0) {
        expect(pageTypeResult[0][0]).to.equal('Other');
      }

      const missingAgentTypePageData = [{ page_type: 'home', week_1: 100 }];
      const agentTypePageResult = SHEET_CONFIGS.pageType
        .processData(missingAgentTypePageData, mockPeriodsForArray);
      expect(agentTypePageResult).to.be.an('array');
      if (agentTypePageResult.length > 0) {
        expect(agentTypePageResult[0][1]).to.equal('Other');
      }
    });

    it('covers processCountryWithFields edge cases', () => {
      const mockDataForCountry = [
        { country: 'US', hits: 100 },
        { country: 'UK', hits: 50 },
      ];

      const countryResult = SHEET_CONFIGS.country.processData(mockDataForCountry, mockPeriods);
      expect(countryResult).to.be.an('array');

      const missingFieldData = [{ country: 'US', hits: 100, week_1: 50 }];
      const fieldResult = SHEET_CONFIGS.country.processData(missingFieldData, mockPeriods);
      expect(fieldResult).to.be.an('array');
    });

    it('covers processWeekData with different value types', () => {
      const mockData = [
        { country_code: 'US', agent_type: 'Desktop', week_1: 100 },
      ];
      const mockPeriodsWeekData = {
        weeks: [{ weekLabel: 'Week 1', dateRange: { start: '2024-01-01', end: '2024-01-07' } }],
        columns: ['Week 1'],
      };

      const result = SHEET_CONFIGS.country.processData(mockData, mockPeriodsWeekData);
      expect(result).to.be.an('array');
      expect(result.length).to.be.greaterThan(0);
    });

    it('covers processCountryWithFields edge cases', () => {
      const emptyResult = SHEET_CONFIGS.country.processData([], mockPeriods);
      expect(emptyResult).to.deep.equal([]);

      const nullResult = SHEET_CONFIGS.country.processData(null, mockPeriods);
      expect(nullResult).to.deep.equal([]);
    });

    it('aggregates data by validated country code and agent type', () => {
      const data = [
        {
          country_code: 'US', agent_type: 'Desktop', week_1: 100, week_2: 150,
        },
        {
          country_code: 'InvalidCode', agent_type: 'Desktop', week_1: 50, week_2: 75,
        },
        {
          country_code: '', agent_type: 'Desktop', week_1: 25, week_2: 30,
        },
        {
          country_code: 'US', agent_type: 'Mobile', week_1: 200, week_2: 250,
        },
      ];

      const result = SHEET_CONFIGS.country.processData(data, mockPeriods);

      expect(result).to.have.length(3);

      const globalDesktopRow = result.find((row) => row[0] === 'GLOBAL' && row[1] === 'Desktop');
      expect(globalDesktopRow).to.exist;
      expect(globalDesktopRow[2]).to.equal(75);
      expect(globalDesktopRow[3]).to.equal(105);

      // US+Desktop should remain separate
      const usDesktopRow = result.find((row) => row[0] === 'US' && row[1] === 'Desktop');
      expect(usDesktopRow).to.exist;
      expect(usDesktopRow[2]).to.equal(100);
      expect(usDesktopRow[3]).to.equal(150);
    });
  });
});
