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
import sinon from 'sinon';
import nock from 'nock';
import { AemClient } from '../../../src/content-fragment-insights/clients/aem-client.js';

describe('AemClient', () => {
  let log;
  const baseUrl = 'https://author.example.com';
  const authToken = 'test-token-123';

  beforeEach(() => {
    log = {
      debug: sinon.spy(),
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create client with valid parameters', () => {
      const client = new AemClient(baseUrl, authToken, log);
      expect(client.baseUrl).to.equal(baseUrl);
      expect(client.authToken).to.equal(authToken);
      expect(client.log).to.equal(log);
    });

    it('should use console as default logger', () => {
      const client = new AemClient(baseUrl, authToken);
      expect(client.log).to.equal(console);
    });

    it('should throw error when baseUrl is missing', () => {
      expect(() => new AemClient(null, authToken)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when baseUrl is undefined', () => {
      expect(() => new AemClient(undefined, authToken)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when baseUrl is empty string', () => {
      expect(() => new AemClient('', authToken)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when authToken is missing', () => {
      expect(() => new AemClient(baseUrl, null)).to.throw(
        'authToken is required for AEM client',
      );
    });

    it('should throw error when authToken is undefined', () => {
      expect(() => new AemClient(baseUrl, undefined)).to.throw(
        'authToken is required for AEM client',
      );
    });

    it('should throw error when authToken is empty string', () => {
      expect(() => new AemClient(baseUrl, '')).to.throw(
        'authToken is required for AEM client',
      );
    });
  });

  describe('createFrom', () => {
    it('should create client from context', () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: baseUrl,
          }),
        },
        env: {
          AEM_AUTHOR_TOKEN: authToken,
        },
        log,
      };

      const client = AemClient.createFrom(context);

      expect(client).to.be.instanceOf(AemClient);
      expect(client.baseUrl).to.equal(baseUrl);
      expect(client.authToken).to.equal(authToken);
      expect(client.log).to.equal(log);
    });

    it('should throw error when authorURL is missing', () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({}),
        },
        env: {
          AEM_AUTHOR_TOKEN: authToken,
        },
        log,
      };

      expect(() => AemClient.createFrom(context)).to.throw(
        'AEM Author configuration missing: AEM Author URL required',
      );
    });

    it('should throw error when authorURL is null', () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: null,
          }),
        },
        env: {
          AEM_AUTHOR_TOKEN: authToken,
        },
        log,
      };

      expect(() => AemClient.createFrom(context)).to.throw(
        'AEM Author configuration missing: AEM Author URL required',
      );
    });

    it('should throw error when AEM_AUTHOR_TOKEN is missing', () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: baseUrl,
          }),
        },
        env: {},
        log,
      };

      expect(() => AemClient.createFrom(context)).to.throw(
        'AEM Author configuration missing: AEM_AUTHOR_TOKEN required',
      );
    });

    it('should throw error when AEM_AUTHOR_TOKEN is null', () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: baseUrl,
          }),
        },
        env: {
          AEM_AUTHOR_TOKEN: null,
        },
        log,
      };

      expect(() => AemClient.createFrom(context)).to.throw(
        'AEM Author configuration missing: AEM_AUTHOR_TOKEN required',
      );
    });
  });

  describe('request', () => {
    let client;

    beforeEach(() => {
      client = new AemClient(baseUrl, authToken, log);
    });

    it('should make successful GET request', async () => {
      const responseData = { items: [], cursor: null };
      nock(baseUrl)
        .get('/test/path')
        .reply(200, responseData, { 'content-type': 'application/json' });

      const result = await client.request('GET', '/test/path');

      expect(result).to.deep.equal(responseData);
    });

    it('should include authorization header', async () => {
      nock(baseUrl)
        .get('/test/path')
        .matchHeader('Authorization', `Bearer ${authToken}`)
        .reply(200, {}, { 'content-type': 'application/json' });

      await client.request('GET', '/test/path');
    });

    it('should include accept header', async () => {
      nock(baseUrl)
        .get('/test/path')
        .matchHeader('Accept', 'application/json')
        .reply(200, {}, { 'content-type': 'application/json' });

      await client.request('GET', '/test/path');
    });

    it('should handle additional headers', async () => {
      nock(baseUrl)
        .get('/test/path')
        .matchHeader('X-Custom-Header', 'custom-value')
        .reply(200, {}, { 'content-type': 'application/json' });

      await client.request('GET', '/test/path', {
        headers: { 'X-Custom-Header': 'custom-value' },
      });
    });

    it('should return null for non-JSON response', async () => {
      nock(baseUrl)
        .get('/test/path')
        .reply(200, 'OK', { 'content-type': 'text/plain' });

      const result = await client.request('GET', '/test/path');
      expect(result).to.be.null;
    });

    it('should throw error on 404 response', async () => {
      nock(baseUrl).get('/test/path').reply(404, 'Not Found');

      await expect(client.request('GET', '/test/path')).to.be.rejectedWith(
        'AEM API request failed with status 404',
      );
    });

    it('should throw error on 500 response', async () => {
      nock(baseUrl).get('/test/path').reply(500, 'Internal Server Error');

      await expect(client.request('GET', '/test/path')).to.be.rejectedWith(
        'AEM API request failed with status 500',
      );
    });

    it('should throw error on 401 response', async () => {
      nock(baseUrl).get('/test/path').reply(401, 'Unauthorized');

      await expect(client.request('GET', '/test/path')).to.be.rejectedWith(
        'AEM API request failed with status 401',
      );
    });

    it('should include error text in error message', async () => {
      nock(baseUrl).get('/test/path').reply(400, 'Bad Request Details');

      await expect(client.request('GET', '/test/path')).to.be.rejectedWith(
        'Bad Request Details',
      );
    });

    it('should handle POST request', async () => {
      nock(baseUrl)
        .post('/test/path')
        .reply(201, { success: true }, { 'content-type': 'application/json' });

      const result = await client.request('POST', '/test/path');
      expect(result).to.deep.equal({ success: true });
    });

    it('should pass additional options to fetch', async () => {
      nock(baseUrl)
        .post('/test/path', { data: 'test' })
        .reply(200, {}, { 'content-type': 'application/json' });

      await client.request('POST', '/test/path', {
        body: JSON.stringify({ data: 'test' }),
      });
    });
  });

  describe('getFragments', () => {
    let client;

    beforeEach(() => {
      client = new AemClient(baseUrl, authToken, log);
    });

    it('should fetch fragments successfully', async () => {
      const responseData = {
        items: [
          { path: '/content/dam/fragment1', status: 'NEW' },
          { path: '/content/dam/fragment2', status: 'DRAFT' },
        ],
        cursor: null,
      };

      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal' })
        .reply(200, responseData, { 'content-type': 'application/json' });

      const result = await client.getFragments('/content/dam/');

      expect(result.items).to.have.lengthOf(2);
      expect(result.cursor).to.be.null;
    });

    it('should return empty array when no items', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal' })
        .reply(200, {}, { 'content-type': 'application/json' });

      const result = await client.getFragments('/content/dam/');

      expect(result.items).to.be.an('array').that.is.empty;
      expect(result.cursor).to.be.null;
    });

    it('should include cursor in query when provided', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal', cursor: 'abc123' })
        .reply(200, { items: [], cursor: null }, { 'content-type': 'application/json' });

      await client.getFragments('/content/dam/', { cursor: 'abc123' });
    });

    it('should include limit in query when provided', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal', limit: '50' })
        .reply(200, { items: [], cursor: null }, { 'content-type': 'application/json' });

      await client.getFragments('/content/dam/', { limit: 50 });
    });

    it('should use custom projection when provided', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'full' })
        .reply(200, { items: [], cursor: null }, { 'content-type': 'application/json' });

      await client.getFragments('/content/dam/', { projection: 'full' });
    });

    it('should return cursor for pagination', async () => {
      const responseData = {
        items: [{ path: '/content/dam/fragment1', status: 'NEW' }],
        cursor: 'next-page-cursor',
      };

      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal' })
        .reply(200, responseData, { 'content-type': 'application/json' });

      const result = await client.getFragments('/content/dam/');

      expect(result.cursor).to.equal('next-page-cursor');
    });

    it('should handle API error and rethrow', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({ path: '/content/dam/', projection: 'minimal' })
        .reply(500, 'Internal Server Error');

      await expect(
        client.getFragments('/content/dam/'),
      ).to.be.rejectedWith('AEM API request failed with status 500');
    });

    it('should include all query parameters together', async () => {
      nock(baseUrl)
        .get(AemClient.API_SITES_FRAGMENTS)
        .query({
          path: '/content/dam/',
          projection: 'full',
          cursor: 'page2',
          limit: '100',
        })
        .reply(200, { items: [], cursor: null }, { 'content-type': 'application/json' });

      await client.getFragments('/content/dam/', {
        projection: 'full',
        cursor: 'page2',
        limit: 100,
      });
    });
  });

  describe('API constants', () => {
    it('should have correct API_SITES_BASE constant', () => {
      expect(AemClient.API_SITES_BASE).to.equal('/adobe/sites');
    });

    it('should have correct API_SITES_FRAGMENTS constant', () => {
      expect(AemClient.API_SITES_FRAGMENTS).to.equal('/adobe/sites/cf/fragments');
    });
  });
});

