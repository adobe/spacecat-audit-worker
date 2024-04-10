/*
 * Copyright 2024 Adobe. All rights reserved.
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

import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import sinon from 'sinon';

import AhrefsAPIClient from '../../src/support/ahrefs-client.js';
import { fetch } from '../../src/support/utils.js';

chai.use(chaiAsPromised);
const { expect } = chai;
const sandbox = sinon.createSandbox();

const mockDate = '2023-03-12T15:24:51.231Z';

describe('AhrefsAPIClient', () => {
  let client;
  const config = {
    apiKey: 'testApiKey',
    apiBaseUrl: 'https://example.com',
  };

  const backlinksResponse = {
    backlinks: [
      {
        title: 'backlink title',
        url_from: 'url-from',
        url_to: 'url-to',
      },
      {
        title: 'backlink title 2',
        url_from: 'url-from-2',
        url_to: 'url-to-2',
      },
    ],
  };

  const topPagesResponse = [
    {
      url: 'page-url-1',
      sum_traffic: 100,
    },
    {
      url: 'page-url-2',
      sum_traffic: 300,
    },
  ];

  before('setup', function () {
    this.clock = sandbox.useFakeTimers({
      now: new Date(mockDate).getTime(),
    });
  });

  after('clean', function () {
    this.clock.uninstall();
  });

  beforeEach(() => {
    client = new AhrefsAPIClient(config, fetch);
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('constructor', () => {
    it('throws error when api base url is missing', () => {
      expect(() => new AhrefsAPIClient({})).to.throw('Invalid Ahrefs API Base URL: undefined');
    });

    it('throws error when fetch is not a function', () => {
      expect(() => new AhrefsAPIClient(config, 'fetch')).to.throw('"fetch" must be a function');
    });
  });

  describe('sendRequest', () => {
    it('returns data when API request was successful', async () => {
      nock(config.apiBaseUrl)
        .get(/.*/)
        .reply(200, backlinksResponse);

      const result = await client.sendRequest('/some-endpoint');
      expect(result).to.deep.equal({
        result: backlinksResponse,
        fullAuditRef: 'https://example.com/some-endpoint',
      });
    });

    it('throw error when API response is not ok', async () => {
      nock(config.apiBaseUrl)
        .get(/.*/)
        .reply(400, 'Bad Request');

      await expect(client.sendRequest('/some-endpoint')).to.be.rejectedWith('Ahrefs API request failed with status: 400');
    });

    it('throw error when API response body cannot be parsed as JSON', async () => {
      nock(config.apiBaseUrl)
        .get(/.*/)
        .reply(200, 'invalid-json');

      await expect(client.sendRequest('/some-endpoint')).to.be.rejectedWith('Error parsing Ahrefs API response:');
    });
  });

  describe('getBrokenBacklinks', () => {
    it('sends API request with appropriate endpoint query params', async () => {
      nock(config.apiBaseUrl)
        .get('/site-explorer/broken-backlinks')
        .query({
          select: [
            'title',
            'url_from',
            'url_to',
          ].join(','),
          limit: 50,
          mode: 'prefix',
          order_by: 'domain_rating_source:desc,traffic_domain:desc',
          target: 'test-site.com',
          output: 'json',
          where: JSON.stringify({
            and: [
              { field: 'is_dofollow', is: ['eq', 1] },
              { field: 'is_content', is: ['eq', 1] },
              { field: 'domain_rating_source', is: ['gte', 29.5] },
              { field: 'traffic_domain', is: ['gte', 500] },
              { field: 'links_external', is: ['lte', 300] },
            ],
          }),
        })
        .reply(200, backlinksResponse);

      const result = await client.getBrokenBacklinks('test-site.com');
      expect(result).to.deep.equal({
        result: backlinksResponse,
        fullAuditRef: 'https://example.com/site-explorer/broken-backlinks?select=title%2Curl_from%2Curl_to&limit=50&mode=prefix&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=test-site.com&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22is_dofollow%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22is_content%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D',
      });
    });
  });

  describe('getTopPages', () => {
    it('sends API request with appropriate endpoint query params', async () => {
      const specifiedLimit = 50;
      const target = 'test-site.com';

      const date = mockDate.split('T')[0];
      const filter = {
        and: [
          { field: 'sum_traffic', is: ['gt', 0] },
        ],
      };
      const queryParams = {
        select: [
          'url',
          'sum_traffic',
        ].join(','),
        where: JSON.stringify(filter),
        order_by: 'sum_traffic_merged',
        date,
        target,
        limit: specifiedLimit,
        mode: 'prefix',
        output: 'json',
      };

      nock(config.apiBaseUrl)
        .get('/site-explorer/top-pages')
        .query(queryParams)
        .reply(200, topPagesResponse);

      const result = await client.getTopPages(target, specifiedLimit);
      expect(result).to.deep.equal({
        result: topPagesResponse,
        fullAuditRef: `https://example.com/site-explorer/top-pages?select=url%2Csum_traffic&order_by=sum_traffic_merged&date=${date}&target=${target}&limit=${specifiedLimit}&mode=prefix&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22sum_traffic%22%2C%22is%22%3A%5B%22gt%22%2C0%5D%7D%5D%7D`,
      });
    });
  });

  describe('getBacklinks', () => {
    it('sends API request with appropriate endpoint query params', async () => {
      const upperLimit = 1000;

      nock(config.apiBaseUrl)
        .get('/site-explorer/all-backlinks')
        .query({
          select: [
            'title',
            'url_from',
            'url_to',
          ].join(','),
          limit: upperLimit,
          mode: 'prefix',
          order_by: 'domain_rating_source:desc,traffic_domain:desc',
          target: 'test-site.com',
          output: 'json',
          where: JSON.stringify({
            and: [
              { field: 'is_dofollow', is: ['eq', 1] },
              { field: 'is_content', is: ['eq', 1] },
              { field: 'domain_rating_source', is: ['gte', 29.5] },
              { field: 'traffic_domain', is: ['gte', 500] },
              { field: 'links_external', is: ['lte', 300] },
            ],
          }),
        })
        .reply(200, backlinksResponse);

      const result = await client.getBacklinks('test-site.com', upperLimit * 3);
      expect(result).to.deep.equal({
        result: backlinksResponse,
        fullAuditRef: `https://example.com/site-explorer/all-backlinks?select=title%2Curl_from%2Curl_to&order_by=domain_rating_source%3Adesc%2Ctraffic_domain%3Adesc&target=test-site.com&limit=${upperLimit}&mode=prefix&output=json&where=%7B%22and%22%3A%5B%7B%22field%22%3A%22is_dofollow%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22is_content%22%2C%22is%22%3A%5B%22eq%22%2C1%5D%7D%2C%7B%22field%22%3A%22domain_rating_source%22%2C%22is%22%3A%5B%22gte%22%2C29.5%5D%7D%2C%7B%22field%22%3A%22traffic_domain%22%2C%22is%22%3A%5B%22gte%22%2C500%5D%7D%2C%7B%22field%22%3A%22links_external%22%2C%22is%22%3A%5B%22lte%22%2C300%5D%7D%5D%7D`,
      });
    });
  });
});
