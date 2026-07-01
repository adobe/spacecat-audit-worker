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
import {
  mapToAgenticTrafficBundle,
} from '../../../src/cdn-logs-report/utils/agentic-traffic-mapper.js';

use(sinonChai);

const baseSite = (overrides = {}) => ({
  getId: () => 'site-1',
  getBaseURL: () => 'https://www.example.com',
  getConfig: () => ({
    getLlmoCountryCodeIgnoreList: () => [],
  }),
  ...overrides,
});

const chatbotRow = (url, overrides = {}) => ({
  agent_type: 'Chatbots',
  user_agent_display: 'ChatGPT-User',
  status: 200,
  number_of_hits: 4,
  avg_ttfb_ms: 50,
  country_code: 'US',
  url,
  host: 'www.example.com',
  product: 'Docs',
  category: 'Documentation',
  ...overrides,
});

describe('agentic traffic mapper', () => {
  it('maps Athena rows into traffic and classification bundle rows', async () => {
    const result = await mapToAgenticTrafficBundle([
      chatbotRow('/docs/page', {
        number_of_hits: 12, avg_ttfb_ms: 123.45, host: 'docs.example.com',
      }),
      chatbotRow('/docs/page', {
        number_of_hits: 5, avg_ttfb_ms: 110, country_code: 'AA', host: 'docs.example.com',
      }),
      chatbotRow('/skip-me', { agent_type: 'Other', host: 'docs.example.com' }),
      chatbotRow('/skip-me', { number_of_hits: 0, host: 'docs.example.com' }),
    ], baseSite({
      getConfig: () => ({ getLlmoCountryCodeIgnoreList: () => ['AA'] }),
    }), { log: { warn: sinon.spy() } }, '2026-03-31');

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
    // Citability is computed UI-side now; the mapper emits an empty dimensions object.
    expect(result.trafficRows[0].dimensions).to.deep.equal({});

    expect(result.classificationRows[0]).to.deep.equal({
      host: 'docs.example.com',
      url_path: '/docs/page',
      region: 'US',
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

  it('classifies common image and icon asset content types', async () => {
    const result = await mapToAgenticTrafficBundle([
      chatbotRow('/assets/hero.png', { number_of_hits: 12, category: 'Asset' }),
      chatbotRow('/favicon.ico', { number_of_hits: 6, category: 'Asset' }),
      chatbotRow('/photo.jpg', { number_of_hits: 3, category: 'Asset' }),
      chatbotRow('/brochure.gif', { number_of_hits: 2, category: 'Asset' }),
    ], baseSite(), { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.classificationRows.map((r) => r.content_type)).to.include('jpg');
    expect(result.classificationRows.map((r) => r.content_type)).to.include('gif');

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

  it('always emits an empty dimensions object', async () => {
    const result = await mapToAgenticTrafficBundle(
      [chatbotRow('/guide')],
      baseSite(),
      { log: { warn: sinon.spy() } },
      '2026-03-31',
    );
    expect(result.trafficRows[0].dimensions).to.deep.equal({});
  });

  it('uses site and row fallbacks for host, base URL, status, and timing fields', async () => {
    const resultWithoutConfig = await mapToAgenticTrafficBundle([
      chatbotRow('-', {
        status: 'bad-status', number_of_hits: 7, avg_ttfb_ms: 'not-a-number', host: '', category: 'Landing',
      }),
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
      chatbotRow('/docs/start', {
        status: 201, number_of_hits: 3, avg_ttfb_ms: 15, host: '',
      }),
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

  it('classifies the remaining known file extensions', async () => {
    const result = await mapToAgenticTrafficBundle([
      chatbotRow('/a.webp', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/a.svg', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/a.bmp', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/a.avif', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/feed.xml', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/guide.pdf', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/index.htm', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/notes.txt', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
      chatbotRow('/download/file.bin', { number_of_hits: 1, avg_ttfb_ms: 10, category: 'Asset' }),
    ], baseSite(), { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.classificationRows.map((row) => row.content_type)).to.deep.equal([
      'webp',
      'svg',
      'bmp',
      'avif',
      'xml',
      'pdf',
      'html',
      'txt',
      'other',
    ]);
  });

  it('normalizes empty and non-string values when building bundle rows', async () => {
    const result = await mapToAgenticTrafficBundle([
      chatbotRow('', {
        status: 202, number_of_hits: 2, avg_ttfb_ms: 5, host: null, product: {}, category: null,
      }),
      chatbotRow('/trimmed', {
        status: 202, number_of_hits: 2, avg_ttfb_ms: 5, host: null, product: '   ', category: 'Category',
      }),
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
      chatbotRow('/data:image/x-icon;base64,abcd', {
        number_of_hits: 5, avg_ttfb_ms: 15, country_code: 'DE', category: 'Asset',
      }),
      chatbotRow('de/docs/start', {
        number_of_hits: 3, avg_ttfb_ms: 10, country_code: 'DE',
      }),
    ], baseSite(), { log: { warn: sinon.spy() } }, '2026-03-31');

    expect(result.trafficRows).to.have.length(1);
    expect(result.classificationRows).to.have.length(1);
    expect(result.trafficRows[0].url_path).to.equal('/de/docs/start');
    expect(result.classificationRows[0].url_path).to.equal('/de/docs/start');
  });

  it('strips null bytes from host and url path values', async () => {
    const result = await mapToAgenticTrafficBundle([
      chatbotRow('/unsafe\0path/index.htm', {
        number_of_hits: 2, avg_ttfb_ms: 20, host: 'WWW.EXAMPLE.COM\0',
      }),
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
      chatbotRow('/wlmdeu/../../../../../../../../../../../etc/passwd\0index.htm', {
        number_of_hits: 1, avg_ttfb_ms: 10, host: 'corporate.walmart.com\0',
      }),
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
        chatbotRow('/will-throw', { number_of_hits: 1, avg_ttfb_ms: 10 }),
      ], baseSite(), { log: { warn } }, '2026-03-31');

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
      chatbotRow('/normal/path', { number_of_hits: 2, avg_ttfb_ms: 24412667 }),
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
