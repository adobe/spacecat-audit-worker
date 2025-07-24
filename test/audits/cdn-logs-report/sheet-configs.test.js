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
      expect(SHEET_CONFIGS.referralCountryTopic.getHeaders()).to.deep.equal(['Country', 'Topic', 'Hits']);
      expect(SHEET_CONFIGS.referralUrlTopic.getHeaders()).to.deep.equal(['URL', 'Topic', 'Hits']);
      expect(SHEET_CONFIGS.country.getHeaders(mockPeriods)).to.deep.equal(['Country Code', 'Agent Type', 'Week 1', 'Week 2']);
      expect(SHEET_CONFIGS.userAgents.getHeaders(mockPeriods)).to.deep.equal([
        'Request User Agent', 'Agent Type', 'Status', 'Number of Hits',
        'Interval: Last Week (2024-01-08 - 2024-01-14)',
      ]);
      expect(SHEET_CONFIGS.error404.getHeaders()).to.deep.equal(['URL', 'Agent Type', 'Number of 404s']);
      expect(SHEET_CONFIGS.error503.getHeaders()).to.deep.equal(['URL', 'Agent Type', 'Number of 503s']);
      expect(SHEET_CONFIGS.category.getHeaders()).to.deep.equal(['Category', 'Agent Type', 'Number of Hits']);
      expect(SHEET_CONFIGS.topUrls.getHeaders()).to.deep.equal(['URL', 'Total Hits', 'Unique Agents', 'Top Agent', 'Top Agent Type', 'Success Rate', 'Product']);
    });

    it('should return correct number columns for dynamic configs', () => {
      expect(SHEET_CONFIGS.country.getNumberColumns(mockPeriods)).to.deep.equal([2]);
    });
  });

  describe('Data Processing', () => {
    describe('Referral Data Processing', () => {
      it('processes referralCountryTopic with country validation and aggregation', () => {
        const mockData = [
          { country: 'US', topic: 'photoshop', hits: 100 },
          { country: 'invalid', topic: 'photoshop', hits: 50 },
          { country: 'US', topic: 'photoshop', hits: 75 },
          { country: 'CA', topic: null, hits: 25 },
        ];

        const result = SHEET_CONFIGS.referralCountryTopic.processData(mockData);

        expect(result).to.have.length(3);
        expect(result[0]).to.deep.equal(['US', 'Photoshop', 175]);
        expect(result[1]).to.deep.equal(['GLOBAL', 'Photoshop', 50]);
        expect(result[2]).to.deep.equal(['CA', 'Other', 25]);
      });

      it('processes referralUrlTopic data', () => {
        const mockData = [
          { url: '/products/photoshop.html', topic: 'photoshop', hits: 100 },
          { url: null, topic: null, hits: null },
        ];

        const result = SHEET_CONFIGS.referralUrlTopic.processData(mockData);

        expect(result).to.deep.equal([
          ['/products/photoshop.html', 'Photoshop', 100],
          ['', 'Other', 0],
        ]);
      });
    });

    describe('Weekly Data Processing', () => {
      it('processes country data with weekly aggregation', () => {
        const mockData = [
          {
            country_code: 'US', agent_type: 'Other', week: 1, total_requests: 100,
          },
          {
            country_code: 'US', agent_type: 'Other', week: 2, total_requests: 150,
          },
          {
            country_code: 'CA', agent_type: 'Other', week: 1, total_requests: 50,
          },
        ];

        const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);
        // The processWeekData function groups data and may include an "Other" category
        expect(result).to.have.lengthOf(3);
        // Find the US row in the results
        const usRow = result.find((row) => row[0] === 'US');
        expect(usRow).to.exist;
        expect(usRow[1]).to.equal('Other'); // agent_type
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
          ['Chrome', 'Other', 200, 100, ''],
          ['Unknown', 'Other', 'All', 0, ''],
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
          ['/page1', 100, 0, 'N/A', 'Other', 0, 'Other'],
          ['', 0, 0, 'N/A', 'Other', 0, 'Other'],
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
  });
});
