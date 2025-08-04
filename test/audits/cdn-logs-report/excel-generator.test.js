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
  let createExcelReport;
  let REPORT_CONFIGS;

  before(async () => {
    ({ createExcelReport } = await import('../../../src/cdn-logs-report/utils/excel-generator.js'));
    ({ REPORT_CONFIGS } = await import('../../../src/cdn-logs-report/constants/report-configs.js'));
  });

  it('creates comprehensive excel report with all data sheets', async () => {
    const mockData = {
      reqcountbycountry: [
        { country_code: 'US', week_1: 100, week_2: 150 },
        { country_code: 'CA', week_1: 50, week_2: 75 },
      ],
      reqcountbyurlstatus: [
        { page_type: 'home', week_1: 50, week_2: 60 },
        { page_type: 'product', week_1: 25, week_2: 30 },
      ],
      reqcountbyuseragent: [
        { user_agent: 'chrome', status: 200, total_requests: 75 },
        { user_agent: 'firefox', status: 404, total_requests: 25 },
      ],
      error_404_urls: [
        { url: '/not-found', total_requests: 15 },
        { url: '/missing-page', total_requests: 10 },
      ],
      error_503_urls: [
        { url: '/server-error', total_requests: 5 },
      ],
      top_urls: [
        { url: '/popular-page', total_requests: 200 },
        { url: '/trending-content', total_requests: 150 },
      ],
      top_bottom_urls_by_status: [
        { status: 200, url: '/success-page', total_requests: 100 },
        { status: 404, url: '/error-page', total_requests: 20 },
      ],
    };

    const site = {
      getBaseURL: () => 'https://test.com',
      getConfig: () => ({}),
    };

    const result = await createExcelReport(mockData, REPORT_CONFIGS.agentic, { site });
    const buffer = await result.xlsx.writeBuffer();

    expect(buffer).to.be.instanceOf(Buffer);
    expect(buffer.length).to.be.greaterThan(1000);

    expect(result.worksheets).to.have.length.greaterThan(5);
  });

  it('handles bulk.com site with special category processing', async () => {
    const mockData = {
      success_urls_by_category: [
        { url: '/en/products/protein-powder', total_requests: 40 },
        { url: '/en/products/vitamins', total_requests: 30 },
        { url: '/en/other-page', total_requests: 20 },
      ],
      reqcountbycountry: [{ country_code: 'US', week_1: 50 }],
      reqcountbyurlstatus: [{ page_type: 'product', week_1: 30 }],
      reqcountbyuseragent: [{ user_agent: 'chrome', status: 200, total_requests: 25 }],
      error_404_urls: [],
      error_503_urls: [],
      top_urls: [],
      top_bottom_urls_by_status: [],
    };

    const site = {
      getBaseURL: () => 'https://bulk.com',
      getConfig: () => ({}),
    };

    const result = await createExcelReport(mockData, REPORT_CONFIGS.agentic, { site });
    const buffer = await result.xlsx.writeBuffer();

    expect(buffer).to.be.instanceOf(Buffer);
    expect(result.worksheets.length).to.be.greaterThan(5);
  });

  it('processes null properties and empty status fallbacks', async () => {
    const mockData = {
      reqcountbyuseragent: null,
      reqcountbycountry: [
        { country_code: null, week_1: 100 },
      ],
      reqcountbyurlstatus: [
        { page_type: null, week_1: 50 },
      ],
      top_bottom_urls_by_status: [
        { status: '', url: null, total_requests: null },
      ],
      error_404_urls: null,
      error_503_urls: [],
      top_urls: null,
      success_urls_by_category: [
        { url: null, total_requests: null },
      ],
    };

    const site = {
      getBaseURL: () => 'https://bulk.com',
      getConfig: () => ({}),
    };

    const result = await createExcelReport(mockData, REPORT_CONFIGS.agentic, {
      site,
      customEndDate: '2024-01-01',
    });

    expect(result.worksheets.length).to.be.greaterThan(0);
  });

  it('handles empty data arrays gracefully', async () => {
    const mockData = {
      reqcountbycountry: [],
      reqcountbyurlstatus: [],
      reqcountbyuseragent: [],
      error_404_urls: [],
      error_503_urls: [],
      top_urls: [],
      top_bottom_urls_by_status: [],
    };

    const site = {
      getBaseURL: () => 'https://test.com',
      getConfig: () => ({}),
    };

    const result = await createExcelReport(mockData, REPORT_CONFIGS.agentic, { site });
    expect(result.worksheets.length).to.be.greaterThan(0);
  });
});
