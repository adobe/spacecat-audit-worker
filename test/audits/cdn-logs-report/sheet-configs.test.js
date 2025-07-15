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
      expect(SHEET_CONFIGS.country.getHeaders(mockPeriods)).to.deep.equal(['Country Code', 'Topic', 'Week 1', 'Week 2']);
      expect(SHEET_CONFIGS.userAgents.getHeaders(mockPeriods)).to.deep.equal([
        'Request User Agent', 'Status', 'Topic', 'Number of Hits',
        'Interval: Last Week (2024-01-08 - 2024-01-14)',
      ]);
      expect(SHEET_CONFIGS.category.getHeaders()).to.deep.equal(['Category', 'Topic', 'Number of Hits']);
      expect(SHEET_CONFIGS.topUrls.getHeaders()).to.deep.equal(['URL', 'Topic', 'Number of Hits']);
      expect(SHEET_CONFIGS.pageType.getHeaders(mockPeriods)).to.deep.equal(['Page Type', 'Week 1', 'Week 2']);
    });

    it('should return correct number columns for dynamic configs', () => {
      expect(SHEET_CONFIGS.country.getNumberColumns(mockPeriods)).to.deep.equal([2]);
      expect(SHEET_CONFIGS.pageType.getNumberColumns(mockPeriods)).to.deep.equal([1]);
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
            country_code: 'US', topic: 'Acrobat', week_1: 100, week_2: 150,
          },
          {
            country_code: 'invalid', topic: 'Firefly', week_1: 50, week_2: 75,
          },
          {
            country_code: 'US', topic: 'Acrobat', week_1: 25, week_2: 30,
          },
        ];

        const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);

        expect(result).to.have.length(2);
        expect(result[0]).to.deep.equal(['US', 'Acrobat', 125, 180]); // Aggregated US data
        expect(result[1]).to.deep.equal(['GLOBAL', 'Firefly', 50, 75]); // Invalid country -> GLOBAL
      });

      it('processes pageType data with fallback', () => {
        const mockData = [
          { page_type: 'product', week_1: 100, week_2: 150 },
        ];

        const result = SHEET_CONFIGS.pageType.processData(mockData, mockPeriods);
        expect(result).to.deep.equal([['product', 100, 150]]);

        // Test fallback for empty data
        const emptyResult = SHEET_CONFIGS.pageType.processData([], mockPeriods);
        expect(emptyResult).to.deep.equal([['No data', 0, 0]]);
      });
    });

    describe('Standard Data Processing', () => {
      it('processes userAgents data', () => {
        const mockData = [
          {
            user_agent: 'Chrome', status: 200, topic: 'Acrobat', total_requests: 100,
          },
          {
            user_agent: null, status: null, topic: null, total_requests: null,
          },
        ];

        const result = SHEET_CONFIGS.userAgents.processData(mockData);

        expect(result).to.deep.equal([
          ['Chrome', 200, 'Acrobat', 100, ''],
          ['Unknown', 'All', 'Other', 0, ''],
        ]);
      });

      it('processes topUrls data', () => {
        const mockData = [
          { url: '/page1', topic: 'Acrobat', total_requests: 100 },
          { url: null, topic: null, total_requests: null },
        ];

        const result = SHEET_CONFIGS.topUrls.processData(mockData);

        expect(result).to.deep.equal([
          ['/page1', 'Acrobat', 100],
          ['', 'Other', 0],
        ]);
      });

      it('processes error pages data', () => {
        const mockData = [
          { url: '/missing-page', topic: 'Acrobat', total_requests: 10 },
          { url: '/server-error', topic: 'Firefly', total_requests: 3 },
        ];

        const error404Result = SHEET_CONFIGS.error404.processData(mockData);
        expect(error404Result).to.deep.equal([
          ['/missing-page', 'Acrobat', 10],
          ['/server-error', 'Firefly', 3],
        ]);

        const error503Result = SHEET_CONFIGS.error503.processData(mockData);
        expect(error503Result).to.deep.equal([
          ['/missing-page', 'Acrobat', 10],
          ['/server-error', 'Firefly', 3],
        ]);
      });

      it('processes category data with URL pattern matching', () => {
        const mockData = [
          { url: '/en/products/photoshop/features', topic: 'Acrobat', total_requests: 100 },
          { url: '/es/products/illustrator/pricing', topic: 'Firefly', total_requests: 50 },
          { url: '/other-page', topic: 'Other', total_requests: 25 },
        ];

        const result = SHEET_CONFIGS.category.processData(mockData);

        expect(result).to.be.an('array');
        expect(result.length).to.be.greaterThan(0);
        expect(result.some(([category, topic]) => category.includes('photoshop') && topic === 'Acrobat')).to.be.true;
        expect(result.some(([category, topic]) => category.includes('illustrator') && topic === 'Firefly')).to.be.true;
        expect(result.some(([category, topic]) => category === 'Other' && topic === 'Other')).to.be.true;
      });

      it('processes pageType data with weekly aggregation', () => {
        const mockData = [
          { page_type: 'Product', week_1: 100, week_2: 150 },
          { page_type: 'Category', week_1: 50, week_2: 75 },
        ];

        const result = SHEET_CONFIGS.pageType.processData(mockData, mockPeriods);

        expect(result).to.be.an('array');
        expect(result.length).to.equal(2);
        expect(result[0]).to.deep.equal(['Product', 100, 150]);
        expect(result[1]).to.deep.equal(['Category', 50, 75]);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    const configsToTest = [
      'userAgents', 'topUrls', 'pageType',
      'category', 'referralCountryTopic', 'referralUrlTopic',
    ];

    it('handles null/undefined data gracefully', () => {
      configsToTest.forEach((configName) => {
        const config = SHEET_CONFIGS[configName];

        [null, undefined, []].forEach((testData) => {
          // Some configs require periods parameter
          const requiresPeriods = ['country', 'pageType'];
          const result = requiresPeriods.includes(configName)
            ? config.processData(testData, mockPeriods)
            : config.processData(testData);
          expect(result).to.be.an('array', `${configName} should return array for ${testData}`);
        });
      });
    });

    it('processes referral traffic data with null/missing fields', () => {
      const mockDataWithNulls = [
        { country: null, topic: null, hits: null },
        { country: 'US', topic: 'photoshop', hits: 100 },
        { country: '', topic: '', hits: undefined },
      ];

      const countryResult = SHEET_CONFIGS.referralCountryTopic.processData(mockDataWithNulls);
      expect(countryResult).to.be.an('array');
      expect(countryResult.some((row) => row[0] === 'GLOBAL')).to.be.true;
      expect(countryResult.some((row) => row[1] === 'Other')).to.be.true;

      const urlResult = SHEET_CONFIGS.referralUrlTopic.processData([
        { url: null, topic: null, hits: null },
        { url: '', topic: '', hits: undefined },
      ]);
      expect(urlResult).to.be.an('array');
      expect(urlResult.every((row) => row[1] === 'Other')).to.be.true;
    });

    it('handles empty country data in weekly breakdown', () => {
      const mockData = [
        {
          country_code: '', topic: '', week_1: null, week_2: undefined,
        },
        {
          country_code: null, topic: null, week_1: 0, week_2: 0,
        },
      ];

      const result = SHEET_CONFIGS.country.processData(mockData, mockPeriods);
      expect(result).to.be.an('array');
      expect(result.every((row) => row[0] === 'GLOBAL')).to.be.true;
      expect(result.every((row) => row[1] === 'Other')).to.be.true;
    });

    it('handles malformed data gracefully', () => {
      const malformedData = [
        { invalidField: 'test' },
        {},
        { hits: 'not-a-number' },
        { total_requests: 'invalid' },
      ];

      configsToTest.forEach((configName) => {
        const config = SHEET_CONFIGS[configName];
        const requiresPeriods = ['country', 'pageType'];
        const result = requiresPeriods.includes(configName)
          ? config.processData(malformedData, mockPeriods)
          : config.processData(malformedData);
        expect(result).to.be.an('array', `${configName} should handle malformed data`);
      });
    });

    it('handles weekly data edge cases', () => {
      const emptyPeriods = { weeks: [], columns: ['Country Code'] };

      expect(() => SHEET_CONFIGS.country.processData([], emptyPeriods)).to.not.throw();
      expect(() => SHEET_CONFIGS.pageType.processData([], emptyPeriods)).to.not.throw();
    });
  });
});
