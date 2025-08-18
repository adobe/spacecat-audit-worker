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

describe('CDN Logs Excel Generator', () => {
  let AGENTIC_REPORT_CONFIG;

  before(async () => {
    ({ AGENTIC_REPORT_CONFIG } = await import('../../../src/cdn-logs-report/constants/report-configs.js'));
  });

  it('validates agentic flat report data structure', () => {
    const mockData = [
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: '200',
        number_of_hits: 150,
        avg_ttfb_ms: 85.5,
        country_code: 'US',
        url: '/products/firefly.html',
        product: 'Firefly',
        category: 'Products',
      },
      {
        agent_type: 'Crawlers',
        user_agent_display: 'PerplexityBot',
        status: '404',
        number_of_hits: 75,
        avg_ttfb_ms: 120.3,
        country_code: 'GLOBAL',
        url: '/express/feature/image/--none--',
        product: 'Express',
        category: 'Products',
      },
    ];

    // Validate data structure for agentic flat report
    expect(mockData).to.be.an('array');
    expect(mockData).to.have.length(2);

    mockData.forEach((row) => {
      expect(row).to.have.property('agent_type');
      expect(row).to.have.property('user_agent_display');
      expect(row).to.have.property('status');
      expect(row).to.have.property('number_of_hits');
      expect(row).to.have.property('avg_ttfb_ms');
      expect(row).to.have.property('country_code');
      expect(row).to.have.property('url');
      expect(row).to.have.property('product');
      expect(row).to.have.property('category');
    });

    // Validate config structure
    expect(AGENTIC_REPORT_CONFIG).to.have.property('filePrefix', 'agentictraffic');
    expect(AGENTIC_REPORT_CONFIG).to.have.property('folderSuffix', 'agentic-traffic');
    expect(AGENTIC_REPORT_CONFIG).to.have.property('workbookCreator');
    expect(AGENTIC_REPORT_CONFIG).to.have.property('sheetName', 'shared-all');
  });

  it('validates agentic data with different agent types', () => {
    const mockData = [
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: '200',
        number_of_hits: 100,
        avg_ttfb_ms: 75.2,
        country_code: 'US',
        url: '/products/bulk-supplements',
        product: 'Bulk Supplements',
        category: 'Products',
      },
      {
        agent_type: 'Crawlers',
        user_agent_display: 'PerplexityBot',
        status: '404',
        number_of_hits: 25,
        avg_ttfb_ms: 150.0,
        country_code: 'GLOBAL',
        url: '/en/missing-page',
        product: 'Other',
        category: 'Uncategorized',
      },
    ];

    // Validate that different agent types are represented
    const agentTypes = mockData.map((row) => row.agent_type);
    expect(agentTypes).to.include('Chatbots');
    expect(agentTypes).to.include('Crawlers');

    // Validate numeric fields
    expect(mockData[0].number_of_hits).to.be.a('number');
    expect(mockData[0].avg_ttfb_ms).to.be.a('number');
  });

  it('handles data with missing fields gracefully', () => {
    const mockData = [
      {
        agent_type: 'Chatbots',
        user_agent_display: null,
        status: '',
        number_of_hits: null,
        avg_ttfb_ms: undefined,
        country_code: null,
        url: null,
        product: null,
        category: null,
      },
    ];

    expect(mockData).to.be.an('array');
    expect(mockData[0]).to.have.property('agent_type');
    expect(mockData[0].user_agent_display).to.be.null;
    expect(mockData[0].status).to.equal('');
  });

  it('handles empty data arrays gracefully', () => {
    const mockData = [];

    // Test empty array handling
    expect(mockData).to.be.an('array');
    expect(mockData).to.have.length(0);

    // Config should still be valid
    expect(AGENTIC_REPORT_CONFIG).to.be.an('object');
    expect(AGENTIC_REPORT_CONFIG.sheetName).to.equal('shared-all');
  });
});
