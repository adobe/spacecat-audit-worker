/*
 * Copyright 2026 Adobe. All rights reserved.
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
import sinon from 'sinon';
import { mapToAgenticTrafficBundle } from '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js';

describe('agentic traffic mapper', () => {
  it('maps Athena rows into traffic and classification bundle rows', async () => {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => ['AA'],
      }),
    };
    const context = {
      log: {
        warn: sinon.spy(),
      },
      dataAccess: {
        PageCitability: {
          allBySiteId: sinon.stub().resolves([{
            getUrl: () => 'https://www.example.com/docs/page',
            getCitabilityScore: () => 82,
            getIsDeployedAtEdge: () => true,
            getUpdatedAt: () => '2026-03-31T00:00:00.000Z',
          }]),
        },
      },
    };

    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 12,
        avg_ttfb_ms: 123.45,
        country_code: 'US',
        url: '/docs/page',
        host: 'docs.example.com',
        product: 'Docs',
        category: 'Documentation',
      },
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 5,
        avg_ttfb_ms: 110,
        country_code: 'AA',
        url: '/docs/page',
        host: 'docs.example.com',
        product: 'Docs',
        category: 'Documentation',
      },
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 0,
        avg_ttfb_ms: 99,
        country_code: 'US',
        url: '/skip-me',
        host: 'docs.example.com',
        product: 'Docs',
        category: 'Documentation',
      },
    ], site, context, '2026-03-31');

    expect(result.trafficRows).to.have.length(2);
    expect(result.classificationRows).to.have.length(1);

    expect(result.trafficRows[0]).to.include({
      traffic_date: '2026-03-31',
      host: 'docs.example.com',
      platform: 'ChatGPT',
      agent_type: 'Chatbots',
      user_agent: 'ChatGPT-User',
      http_status: 200,
      url_path: '/docs/page',
      hits: 12,
      updated_by: 'audit-worker:agentic-daily-export',
    });
    expect(result.trafficRows[0].dimensions).to.deep.equal({
      citability_score: 82,
      deployed_at_edge: true,
    });

    expect(result.classificationRows[0]).to.deep.equal({
      host: 'docs.example.com',
      url_path: '/docs/page',
      region: 'GLOBAL',
      category_name: 'Docs',
      page_type: 'Documentation',
      content_type: 'html',
      updated_by: 'audit-worker:agentic-daily-export',
    });
  });

  it('returns empty bundle arrays when required inputs are missing', async () => {
    const result = await mapToAgenticTrafficBundle(null, null, null, null);
    expect(result).to.deep.equal({
      trafficRows: [],
      classificationRows: [],
    });
  });
});
