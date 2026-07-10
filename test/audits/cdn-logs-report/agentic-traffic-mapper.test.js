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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { mapToAgenticTrafficBundle } from '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js';

use(sinonChai);

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
          allBySiteId: sinon.stub().resolves([
            {
              getUrl: () => 'https://www.example.com/docs/page',
              getCitabilityScore: () => 82,
              getIsDeployedAtEdge: () => true,
              getUpdatedAt: () => '2026-03-31T00:00:00.000Z',
            },
            {
              getUrl: () => '/bad-url',
              getCitabilityScore: () => 12,
              getIsDeployedAtEdge: () => false,
              getUpdatedAt: () => '2026-03-30T00:00:00.000Z',
            },
          ]),
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
        agent_type: 'Other',
        user_agent_display: 'Mozilla/5.0',
        status: 200,
        number_of_hits: 8,
        avg_ttfb_ms: 80,
        country_code: 'DE',
        url: '/skip-me',
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
      region: 'US',
      category_name: 'Docs',
      page_type: 'Documentation',
      content_type: 'html',
      updated_by: 'audit-worker:agentic-daily-export',
    });
    expect(context.log.warn).to.have.been.calledOnce;
  });

  it('returns empty bundle arrays when required inputs are missing', async () => {
    const result = await mapToAgenticTrafficBundle(null, null, null, null);
    expect(result).to.deep.equal({
      trafficRows: [],
      classificationRows: [],
    });
  });

  it('classifies common image and icon asset content types', async () => {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    };

    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 12,
        avg_ttfb_ms: 50,
        country_code: 'US',
        url: '/assets/hero.png',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 6,
        avg_ttfb_ms: 40,
        country_code: 'US',
        url: '/favicon.ico',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
    ], site, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.classificationRows).to.deep.include({
      host: 'www.example.com',
      url_path: '/assets/hero.png',
      region: 'US',
      category_name: 'Docs',
      page_type: 'Asset',
      content_type: 'png',
      updated_by: 'audit-worker:agentic-daily-export',
    });
    expect(result.classificationRows).to.deep.include({
      host: 'www.example.com',
      url_path: '/favicon.ico',
      region: 'US',
      category_name: 'Docs',
      page_type: 'Asset',
      content_type: 'ico',
      updated_by: 'audit-worker:agentic-daily-export',
    });
  });

  it('uses the newest citability record for a path and supports missing PageCitability access', async () => {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    };
    const context = {
      log: {
        warn: sinon.spy(),
      },
      dataAccess: {
        PageCitability: {
          allBySiteId: sinon.stub().resolves([
            {
              getUrl: () => 'https://www.example.com/image.jpg',
              getCitabilityScore: () => 10,
              getIsDeployedAtEdge: () => false,
              getUpdatedAt: () => '2026-03-30T00:00:00.000Z',
            },
            {
              getUrl: () => 'https://www.example.com/image.jpg',
              getCitabilityScore: () => 55,
              getIsDeployedAtEdge: () => true,
              getUpdatedAt: () => '2026-03-31T00:00:00.000Z',
            },
          ]),
        },
      },
    };

    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 4,
        avg_ttfb_ms: 50,
        country_code: 'US',
        url: '/image.jpg',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
    ], site, context, '2026-03-31');

    expect(result.trafficRows[0].dimensions).to.deep.equal({
      citability_score: 55,
      deployed_at_edge: true,
    });
    expect(result.classificationRows[0].content_type).to.equal('jpg');

    const noCitabilityResult = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 4,
        avg_ttfb_ms: 50,
        country_code: 'US',
        url: '/brochure.gif',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
    ], site, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(noCitabilityResult.trafficRows[0].dimensions).to.deep.equal({});
    expect(noCitabilityResult.classificationRows[0].content_type).to.equal('gif');
  });

  it('returns other for unknown file extensions and logs citability fetch failures', async () => {
    const warn = sinon.spy();
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    };

    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 4,
        avg_ttfb_ms: 50,
        country_code: 'US',
        url: '/download/file.bin',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
    ], site, {
      log: { warn },
      dataAccess: {
        PageCitability: {
          allBySiteId: sinon.stub().rejects(new Error('citability unavailable')),
        },
      },
    }, '2026-03-31');

    expect(result.trafficRows[0].dimensions).to.deep.equal({});
    expect(result.classificationRows[0].content_type).to.equal('other');
    expect(warn).to.have.been.calledWith(
      'Failed to fetch citability scores for agentic mapping: citability unavailable',
    );
  });

  it('uses site and row fallbacks for host, base URL, status, and timing fields', async () => {
    const resultWithoutConfig = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 'bad-status',
        number_of_hits: 7,
        avg_ttfb_ms: 'not-a-number',
        country_code: 'US',
        url: '-',
        host: '',
        product: 'Docs',
        category: 'Landing',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://fallback.example.com/base',
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(resultWithoutConfig.trafficRows[0]).to.include({
      host: 'fallback.example.com',
      http_status: 0,
      url_path: '/base/',
      hits: 7,
    });
    expect(resultWithoutConfig.trafficRows[0].avg_ttfb_ms).to.equal(null);
    expect(resultWithoutConfig.classificationRows[0].host).to.equal('fallback.example.com');

    const resultWithOverride = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 201,
        number_of_hits: 3,
        avg_ttfb_ms: 15,
        country_code: 'US',
        url: '/docs/start',
        host: '',
        product: 'Docs',
        category: 'Documentation',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://ignored.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
        getFetchConfig: () => ({
          overrideBaseURL: 'https://override.example.com/base',
        }),
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(resultWithOverride.trafficRows[0]).to.include({
      host: 'override.example.com',
      http_status: 201,
      url_path: '/base/docs/start',
    });
    expect(resultWithOverride.classificationRows[0]).to.include({
      host: 'override.example.com',
      url_path: '/base/docs/start',
    });
  });

  it('classifies the remaining known file extensions and tolerates null citability payloads', async () => {
    const site = {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    };

    const result = await mapToAgenticTrafficBundle([
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/a.webp', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/a.svg', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/a.bmp', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/a.avif', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/feed.xml', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/guide.pdf', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/index.htm', host: 'www.example.com', product: 'Docs', category: 'Asset' },
      { agent_type: 'Chatbots', user_agent_display: 'ChatGPT-User', status: 200, number_of_hits: 1, avg_ttfb_ms: 10, country_code: 'US', url: '/notes.txt', host: 'www.example.com', product: 'Docs', category: 'Asset' },
    ], site, {
      log: { warn: sinon.spy() },
      dataAccess: {
        PageCitability: {
          allBySiteId: sinon.stub().resolves(null),
        },
      },
    }, '2026-03-31');

    expect(result.classificationRows.map((row) => row.content_type)).to.deep.equal([
      'webp',
      'svg',
      'bmp',
      'avif',
      'xml',
      'pdf',
      'html',
      'txt',
    ]);
  });

  it('normalizes empty and non-string values when building bundle rows', async () => {
    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 202,
        number_of_hits: 2,
        avg_ttfb_ms: 5,
        country_code: 'US',
        url: '',
        host: null,
        product: {},
        category: null,
      },
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 202,
        number_of_hits: 2,
        avg_ttfb_ms: 5,
        country_code: 'US',
        url: '/trimmed',
        host: null,
        product: '   ',
        category: 'Category',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://fallback.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows[0]).to.include({
      host: 'fallback.example.com',
      url_path: '/',
    });
    expect(result.classificationRows[0]).to.include({
      host: 'fallback.example.com',
      url_path: '/',
      category_name: '',
      page_type: '',
    });
    expect(result.classificationRows[1].category_name).to.equal('');
  });

  it('skips pseudo-urls while preserving normal path-only URLs', async () => {
    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 5,
        avg_ttfb_ms: 15,
        country_code: 'DE',
        url: '/data:image/x-icon;base64,abcd',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Asset',
      },
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 3,
        avg_ttfb_ms: 10,
        country_code: 'DE',
        url: 'de/docs/start',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Documentation',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://www.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows).to.have.length(1);
    expect(result.classificationRows).to.have.length(1);
    expect(result.trafficRows[0].url_path).to.equal('/de/docs/start');
    expect(result.classificationRows[0].url_path).to.equal('/de/docs/start');
  });

  it('strips null bytes from host and url path values', async () => {
    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 2,
        avg_ttfb_ms: 20,
        country_code: 'US',
        url: '/unsafe\0path/index.htm',
        host: 'WWW.EXAMPLE.COM\0',
        product: 'Docs',
        category: 'Documentation',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://fallback.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows[0]).to.include({
      host: 'WWW.EXAMPLE.COM',
      url_path: '/unsafepath/index.htm',
    });
    expect(result.classificationRows[0]).to.include({
      host: 'WWW.EXAMPLE.COM',
      url_path: '/unsafepath/index.htm',
    });
  });

  it('canonicalizes traversal-style paths after stripping null bytes', async () => {
    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 1,
        avg_ttfb_ms: 10,
        country_code: 'US',
        url: '/wlmdeu/../../../../../../../../../../../etc/passwd\0index.htm',
        host: 'corporate.walmart.com\0',
        product: 'Docs',
        category: 'Documentation',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://corporate.walmart.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows[0]).to.include({
      host: 'corporate.walmart.com',
      url_path: '/etc/passwdindex.htm',
    });
    expect(result.classificationRows[0]).to.include({
      host: 'corporate.walmart.com',
      url_path: '/etc/passwdindex.htm',
    });
  });

  it('logs and skips malformed URLs when canonicalization throws', async () => {
    const warn = sinon.spy();
    const OriginalURL = globalThis.URL;

    globalThis.URL = class URLStub extends OriginalURL {
      constructor(url, base) {
        if (String(url).includes('/will-throw')) {
          throw new TypeError('bad url');
        }
        super(url, base);
      }
    };

    try {
      const result = await mapToAgenticTrafficBundle([
        {
          agent_type: 'Chatbots',
          user_agent_display: 'ChatGPT-User',
          status: 200,
          number_of_hits: 1,
          avg_ttfb_ms: 10,
          country_code: 'US',
          url: '/will-throw',
          host: 'www.example.com',
          product: 'Docs',
          category: 'Documentation',
        },
      ], {
        getId: () => 'site-1',
        getBaseURL: () => 'https://www.example.com',
        getConfig: () => ({
          getLlmoCountryCodeIgnoreList: () => [],
        }),
      }, { log: { warn } }, '2026-03-31');

      expect(result).to.deep.equal({
        trafficRows: [],
        classificationRows: [],
      });
      expect(warn).to.have.been.calledWith(
        'Skipping malformed agentic URL during daily export mapping: bad url',
      );
    } finally {
      globalThis.URL = OriginalURL;
    }
  });

  it('nulls impossible avg_ttfb_ms values instead of exporting them', async () => {
    const result = await mapToAgenticTrafficBundle([
      {
        agent_type: 'Chatbots',
        user_agent_display: 'ChatGPT-User',
        status: 200,
        number_of_hits: 2,
        avg_ttfb_ms: 24412667,
        country_code: 'US',
        url: '/normal/path',
        host: 'www.example.com',
        product: 'Docs',
        category: 'Documentation',
      },
    ], {
      getId: () => 'site-1',
      getBaseURL: () => 'https://fallback.example.com',
      getConfig: () => ({
        getLlmoCountryCodeIgnoreList: () => [],
      }),
    }, { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows[0].avg_ttfb_ms).to.equal(null);
  });
});
