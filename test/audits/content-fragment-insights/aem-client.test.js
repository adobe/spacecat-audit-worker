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
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import nock from 'nock';
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('AemClient', () => {
  let AemClient;
  let log;
  let mockImsClient;
  const baseUrl = 'https://author.example.com';
  const accessToken = 'test-token-123';

  beforeEach(async () => {
    log = {
      debug: sinon.spy(),
      info: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };

    mockImsClient = {
      getServiceAccessToken: sinon.stub().resolves({
        access_token: accessToken,
        expires_in: 3600,
      }),
    };

    // Import with esmock to control ImsClient.createFrom
    const AemClientModule = await esmock(
      '../../../src/content-fragment-insights/clients/aem-client.js',
      {
        '@adobe/spacecat-shared-ims-client': {
          ImsClient: {
            createFrom: sinon.stub().returns(mockImsClient),
          },
        },
      },
    );

    AemClient = AemClientModule.AemClient;
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  describe('constructor', () => {
    it('should create client with valid parameters', () => {
      const client = new AemClient(baseUrl, mockImsClient, log);
      expect(client.baseUrl).to.equal(baseUrl);
      expect(client.imsClient).to.equal(mockImsClient);
      expect(client.log).to.equal(log);
    });

    it('should use console as default logger', () => {
      const client = new AemClient(baseUrl, mockImsClient);
      expect(client.log).to.equal(console);
    });

    it('should throw error when baseUrl is missing', () => {
      expect(() => new AemClient(null, mockImsClient)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when baseUrl is undefined', () => {
      expect(() => new AemClient(undefined, mockImsClient)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when baseUrl is empty string', () => {
      expect(() => new AemClient('', mockImsClient)).to.throw(
        'baseUrl is required for AEM client',
      );
    });

    it('should throw error when imsClient is missing', () => {
      expect(() => new AemClient(baseUrl, null)).to.throw(
        'imsClient is required for AEM client',
      );
    });

    it('should throw error when imsClient is undefined', () => {
      expect(() => new AemClient(baseUrl, undefined)).to.throw(
        'imsClient is required for AEM client',
      );
    });
  });

  describe('createFrom', () => {
    it('should create client from context', async () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: baseUrl,
          }),
        },
        env: {
          IMS_HOST: 'ims.example.com',
          IMS_CLIENT_ID: 'client-id',
          IMS_CLIENT_CODE: 'client-code',
          IMS_CLIENT_SECRET: 'client-secret',
          IMS_SCOPE: 'scope',
        },
        log,
      };

      const client = await AemClient.createFrom(context);

      expect(client).to.be.instanceOf(AemClient);
      expect(client.baseUrl).to.equal(baseUrl);
      expect(client.imsClient).to.equal(mockImsClient);
      expect(client.log).to.equal(log);
    });

    it('should throw error when authorURL is missing', async () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({}),
        },
        env: {
          IMS_HOST: 'ims.example.com',
        },
        log,
      };

      await expect(AemClient.createFrom(context)).to.be.rejectedWith(
        'AEM Author configuration missing: AEM Author URL required',
      );
    });

    it('should throw error when authorURL is null', async () => {
      const context = {
        site: {
          getDeliveryConfig: () => ({
            authorURL: null,
          }),
        },
        env: {
          IMS_HOST: 'ims.example.com',
        },
        log,
      };

      await expect(AemClient.createFrom(context)).to.be.rejectedWith(
        'AEM Author configuration missing: AEM Author URL required',
      );
    });
  });

  describe('isTokenExpired', () => {
    let client;

    beforeEach(() => {
      client = new AemClient(baseUrl, mockImsClient, log);
    });

    it('should return true when accessToken is null', () => {
      client.accessToken = null;
      client.tokenObtainedAt = Date.now();

      expect(client.isTokenExpired()).to.be.true;
    });

    it('should return true when tokenObtainedAt is null', () => {
      client.accessToken = { access_token: 'token', expires_in: 3600 };
      client.tokenObtainedAt = null;

      expect(client.isTokenExpired()).to.be.true;
    });

    it('should return false when token is valid and not expired', () => {
      client.accessToken = { access_token: 'token', expires_in: 3600 };
      client.tokenObtainedAt = Date.now();

      expect(client.isTokenExpired()).to.be.false;
    });

    it('should return true when token has expired', () => {
      client.accessToken = { access_token: 'token', expires_in: 3600 };
      // Set tokenObtainedAt to 2 hours ago (token expires in 1 hour)
      client.tokenObtainedAt = Date.now() - (2 * 60 * 60 * 1000);

      expect(client.isTokenExpired()).to.be.true;
    });

    it('should invalidate token when expired', () => {
      client.accessToken = { access_token: 'token', expires_in: 3600 };
      // Set tokenObtainedAt to 2 hours ago (token expires in 1 hour)
      client.tokenObtainedAt = Date.now() - (2 * 60 * 60 * 1000);

      client.isTokenExpired();

      expect(client.accessToken).to.be.null;
      expect(client.tokenObtainedAt).to.be.null;
    });

    it('should not invalidate token when not expired', () => {
      const originalToken = { access_token: 'token', expires_in: 3600 };
      const originalObtainedAt = Date.now();
      client.accessToken = originalToken;
      client.tokenObtainedAt = originalObtainedAt;

      client.isTokenExpired();

      expect(client.accessToken).to.equal(originalToken);
      expect(client.tokenObtainedAt).to.equal(originalObtainedAt);
    });

    it('should return true when token expires exactly at current time', () => {
      client.accessToken = { access_token: 'token', expires_in: 3600 };
      // Set tokenObtainedAt to exactly 1 hour ago
      client.tokenObtainedAt = Date.now() - (3600 * 1000);

      expect(client.isTokenExpired()).to.be.true;
    });
  });

  describe('request', () => {
    let client;

    beforeEach(() => {
      client = new AemClient(baseUrl, mockImsClient, log);
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
        .matchHeader('Authorization', `Bearer ${accessToken}`)
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

      await expect(client.request('GET', '/test/path')).to.be.rejected;
    });

    it('should throw error on 500 response', async () => {
      nock(baseUrl).get('/test/path').reply(500, 'Internal Server Error');

      await expect(client.request('GET', '/test/path')).to.be.rejected;
    });

    it('should throw error on 401 response', async () => {
      nock(baseUrl).get('/test/path').reply(401, 'Unauthorized');

      await expect(client.request('GET', '/test/path')).to.be.rejected;
    });

    it('should include error text in error message', async () => {
      nock(baseUrl).get('/test/path').reply(400, 'Bad Request Details');

      await expect(client.request('GET', '/test/path')).to.be.rejectedWith(/Bad Request Details/);
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

    it('should call imsClient.getServiceAccessToken to get token', async () => {
      nock(baseUrl)
        .get('/test/path')
        .reply(200, {}, { 'content-type': 'application/json' });

      await client.request('GET', '/test/path');

      expect(mockImsClient.getServiceAccessToken).to.have.been.calledOnce;
    });
  });

  describe('getFragments', () => {
    let client;

    beforeEach(() => {
      client = new AemClient(baseUrl, mockImsClient, log);
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

      await expect(client.getFragments('/content/dam/')).to.be.rejected;
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

