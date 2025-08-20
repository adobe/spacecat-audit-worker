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

describe('CDN Logs Sheet Configs', () => {
  let SHEET_CONFIGS;

  before(async () => {
    ({ SHEET_CONFIGS } = await import('../../../src/cdn-logs-report/constants/sheet-configs.js'));
  });

  describe('agentic sheet config', () => {
    it('generates correct headers', () => {
      const headers = SHEET_CONFIGS.agentic.getHeaders();
      expect(headers).to.deep.equal([
        'Agent Type',
        'User Agent',
        'Status',
        'Number of Hits',
        'Avg TTFB (ms)',
        'Country Code',
        'URL',
        'Product',
        'Category',
      ]);
    });

    it('processes agentic flat data correctly', () => {
      const testData = [
        {
          agent_type: 'Chatbots',
          user_agent_display: 'ChatGPT-User',
          status: 200,
          number_of_hits: 100,
          avg_ttfb_ms: 250.5,
          country_code: 'US',
          url: 'https://example.com/test',
          product: 'firefly',
          category: 'Products',
        },
        {
          agent_type: 'Crawlers',
          user_agent_display: 'GPTBot',
          status: 404,
          number_of_hits: 50,
          avg_ttfb_ms: 100.0,
          country_code: 'invalid',
          url: 'https://example.com/missing',
          product: null,
          category: null,
        },
      ];

      const result = SHEET_CONFIGS.agentic.processData(testData);

      expect(result).to.have.length(2);
      expect(result[0]).to.deep.equal([
        'Chatbots',
        'ChatGPT-User',
        200,
        100,
        250.5,
        'US',
        'https://example.com/test',
        'Firefly',
        'Products',
      ]);
      expect(result[1]).to.deep.equal([
        'Crawlers',
        'GPTBot',
        404,
        50,
        100.0,
        'GLOBAL',
        'https://example.com/missing',
        'Other',
        'Uncategorized',
      ]);
    });

    it('handles null data gracefully', () => {
      const result = SHEET_CONFIGS.agentic.processData(null);
      expect(result).to.deep.equal([]);
    });

    it('handles data with missing fields', () => {
      const testData = [
        {
          // Missing agent_type, user_agent_display, etc.
          status: null,
          number_of_hits: 'invalid',
          avg_ttfb_ms: null,
          country_code: null,
          url: null,
          product: null,
          category: null,
        },
      ];

      const result = SHEET_CONFIGS.agentic.processData(testData);

      expect(result).to.have.length(1);
      expect(result[0]).to.deep.equal([
        'Other',
        'Unknown',
        'N/A',
        0,
        0,
        'GLOBAL',
        '',
        'Other',
        'Uncategorized',
      ]);
    });

    it('handles empty array data', () => {
      const result = SHEET_CONFIGS.agentic.processData([]);
      expect(result).to.deep.equal([]);
    });

    it('has required properties', () => {
      const config = SHEET_CONFIGS.agentic;
      expect(config).to.have.property('getHeaders').that.is.a('function');
      expect(config).to.have.property('processData').that.is.a('function');
      expect(config).to.have.property('headerColor').that.is.a('string');
      expect(config).to.have.property('numberColumns').that.is.an('array');
    });
  });
});
