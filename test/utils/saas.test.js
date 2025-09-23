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
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  request,
  requestSpreadsheet,
  validateConfig,
  getConfig,
  requestSaaS,
} from '../../src/utils/saas.js';

use(sinonChai);
use(chaiAsPromised);

describe('saas utils', () => {
  let fetchStub;
  let mockLog;

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch');
    mockLog = {
      debug: sinon.spy(),
      warn: sinon.spy(),
      error: sinon.spy(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('request', () => {
    it('should make a successful request with JSON response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves({ data: 'test' }),
      };
      fetchStub.resolves(mockResponse);

      const result = await request('test', 'https://example.com');

      expect(fetchStub).to.have.been.calledOnce;
      expect(fetchStub.firstCall.args[0]).to.equal('https://example.com');
      expect(fetchStub.firstCall.args[1]).to.deep.include({
        headers: { 'User-Agent': 'Spacecat/1.0' },
      });
      expect(result).to.deep.equal({ data: 'test' });
    });

    it('should make a successful request with text response', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('text/plain'),
        },
        text: sinon.stub().resolves('plain text response'),
      };
      fetchStub.resolves(mockResponse);

      const result = await request('test', 'https://example.com');

      expect(result).to.equal('plain text response');
    });

    it('should return null for 204 status', async () => {
      const mockResponse = {
        ok: true,
        status: 204,
        headers: {
          get: sinon.stub(),
        },
      };
      fetchStub.resolves(mockResponse);

      const result = await request('test', 'https://example.com');

      expect(result).to.be.null;
    });

    it('should merge request headers with default User-Agent', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves({}),
      };
      fetchStub.resolves(mockResponse);

      const customReq = {
        headers: {
          'Custom-Header': 'value',
        },
      };

      await request('test', 'https://example.com', customReq);

      expect(fetchStub.firstCall.args[1].headers).to.deep.equal({
        'Custom-Header': 'value',
        'User-Agent': 'Spacecat/1.0',
      });
    });

    it('should handle custom timeout', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves({}),
      };
      fetchStub.resolves(mockResponse);

      await request('test', 'https://example.com', [], 30000);

      expect(fetchStub).to.have.been.calledOnce;
    });

    it('should throw error for invalid timeout (too low)', async () => {
      await expect(request('test', 'https://example.com', [], 0))
        .to.be.rejectedWith('Timeout must be between 1ms and 300000ms');
    });

    it('should throw error for invalid timeout (too high)', async () => {
      await expect(request('test', 'https://example.com', [], 400000))
        .to.be.rejectedWith('Timeout must be between 1ms and 300000ms');
    });

    it('should handle request failure with error response', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: sinon.stub().withArgs('x-error').returns('Custom error'),
        },
        text: sinon.stub().resolves('Error details'),
      };
      fetchStub.resolves(mockResponse);

      await expect(request('test-request', 'https://example.com'))
        .to.be.rejectedWith("Request 'test-request' to 'https://example.com' failed (500): Custom error responseText: Error details");
    });

    it('should handle request failure without error response text', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: sinon.stub().returns(null),
        },
        text: sinon.stub().rejects(new Error('No text available')),
      };
      fetchStub.resolves(mockResponse);

      await expect(request('test-request', 'https://example.com'))
        .to.be.rejectedWith("Request 'test-request' to 'https://example.com' failed (404): Not Found");
    });

    it('should handle abort timeout', async () => {
      fetchStub.rejects(new Error('The user aborted a request.'));

      await expect(request('test', 'https://example.com', [], 1))
        .to.be.rejectedWith('The user aborted a request.');
    });
  });

  describe('requestSpreadsheet', () => {
    beforeEach(() => {
      sinon.stub().resolves({ data: 'spreadsheet' });
      // Replace global fetch to mock internal request calls
      fetchStub.restore();
      fetchStub = sinon.stub(global, 'fetch');
      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves({ data: 'spreadsheet' }),
      };
      fetchStub.resolves(mockResponse);
    });

    it('should call request with correct parameters without sheet', async () => {
      await requestSpreadsheet('https://example.com/config.json');

      expect(fetchStub).to.have.been.calledOnce;
      expect(fetchStub.firstCall.args[0]).to.equal('https://example.com/config.json');
    });

    it('should call request with correct parameters with sheet', async () => {
      await requestSpreadsheet('https://example.com/config.json', 'Sheet1');

      expect(fetchStub).to.have.been.calledOnce;
      expect(fetchStub.firstCall.args[0]).to.equal('https://example.com/config.json?sheet=Sheet1');
    });
  });

  describe('validateConfig', () => {
    const requiredFields = [
      'commerce-customer-group',
      'commerce-environment-id',
      'commerce-store-code',
      'commerce-store-view-code',
      'commerce-website-code',
      'commerce-x-api-key',
    ];

    it('should return config when all required fields are present', () => {
      const config = {};
      requiredFields.forEach((field) => {
        config[field] = `test-${field}`;
      });

      const result = validateConfig(config, 'en_US');
      expect(result).to.deep.equal(config);
    });

    it('should throw error when required fields are missing', () => {
      const config = {
        'commerce-customer-group': 'test-group',
        // missing other required fields
      };

      expect(() => validateConfig(config, 'en_US'))
        .to.throw('Missing required config parameters for en_US locale: Missing required parameter: commerce-environment-id, Missing required parameter: commerce-store-code, Missing required parameter: commerce-store-view-code, Missing required parameter: commerce-website-code, Missing required parameter: commerce-x-api-key');
    });

    it('should throw error when all required fields are missing', () => {
      const config = {};

      expect(() => validateConfig(config, 'fr_FR'))
        .to.throw('Missing required config parameters for fr_FR locale');
    });
  });

  describe('getConfig', () => {
    beforeEach(() => {
      // Reset fetch stub for each test
      fetchStub.restore();
      fetchStub = sinon.stub(global, 'fetch');
    });

    it('should return existing config without fetching', async () => {
      const existingConfig = {
        'commerce-customer-group': 'test-group',
        'commerce-environment-id': 'test-env',
        'commerce-store-code': 'test-store',
        'commerce-store-view-code': 'test-view',
        'commerce-website-code': 'test-website',
        'commerce-x-api-key': 'test-key',
      };

      const params = {
        config: existingConfig,
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
      };

      const result = await getConfig(params, mockLog);

      expect(fetchStub).not.to.have.been.called;
      expect(result).to.equal(existingConfig);
    });

    it('should fetch config from spreadsheet with array data format', async () => {
      const configData = {
        data: [
          { key: 'commerce-customer-group', value: 'test-group' },
          { key: 'commerce-environment-id', value: 'test-env' },
          { key: 'commerce-store-code', value: 'test-store' },
          { key: 'commerce-store-view-code', value: 'test-view' },
          { key: 'commerce-website-code', value: 'test-website' },
          { key: 'commerce-x-api-key', value: 'test-key' },
        ],
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
        locale: 'en_US',
      };

      await getConfig(params, mockLog);

      expect(fetchStub).to.have.been.calledWith('https://example.com/en_US/configs.json');
      expect(params.config).to.deep.equal({
        'commerce-customer-group': 'test-group',
        'commerce-environment-id': 'test-env',
        'commerce-store-code': 'test-store',
        'commerce-store-view-code': 'test-view',
        'commerce-website-code': 'test-website',
        'commerce-x-api-key': 'test-key',
      });
    });

    it('should fetch config from spreadsheet with configSection', async () => {
      const configData = {
        commerce: {
          data: [
            { key: 'commerce-customer-group', value: 'test-group' },
            { key: 'commerce-environment-id', value: 'test-env' },
            { key: 'commerce-store-code', value: 'test-store' },
            { key: 'commerce-store-view-code', value: 'test-view' },
            { key: 'commerce-website-code', value: 'test-website' },
            { key: 'commerce-x-api-key', value: 'test-key' },
          ],
        },
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
        configSection: 'commerce',
      };

      await getConfig(params, mockLog);

      expect(fetchStub).to.have.been.calledWith('https://example.com/configs.json');
      expect(params.config).to.deep.equal({
        'commerce-customer-group': 'test-group',
        'commerce-environment-id': 'test-env',
        'commerce-store-code': 'test-store',
        'commerce-store-view-code': 'test-view',
        'commerce-website-code': 'test-website',
        'commerce-x-api-key': 'test-key',
      });
    });

    it('should fetch config from spreadsheet with public.default format', async () => {
      const configData = {
        public: {
          default: {
            'commerce-customer-group': 'test-group',
            'commerce-environment-id': 'test-env',
            'commerce-store-code': 'test-store',
            'commerce-store-view-code': 'test-view',
            'commerce-website-code': 'test-website',
            'commerce-x-api-key': 'test-key',
          },
        },
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
      };

      await getConfig(params, mockLog);

      expect(params.config).to.equal(configData.public.default);
    });

    it('should use custom configName and configSheet', async () => {
      const configData = {
        data: [
          { key: 'commerce-customer-group', value: 'test-group' },
          { key: 'commerce-environment-id', value: 'test-env' },
          { key: 'commerce-store-code', value: 'test-store' },
          { key: 'commerce-store-view-code', value: 'test-view' },
          { key: 'commerce-website-code', value: 'test-website' },
          { key: 'commerce-x-api-key', value: 'test-key' },
        ],
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
        configName: 'custom-config',
        configSheet: 'Sheet1',
      };

      await getConfig(params, mockLog);

      expect(fetchStub).to.have.been.calledWith('https://example.com/custom-config.json?sheet=Sheet1');
    });

    it('should throw error for invalid config format', async () => {
      const configData = {
        invalid: 'format',
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
        locale: 'en_US',
      };

      await expect(getConfig(params, mockLog))
        .to.be.rejectedWith('Invalid config file https://example.com/en_US/configs.json format for en_US locale');
    });

    it('should throw error for invalid config format with default locale when locale is undefined', async () => {
      const configData = {
        invalid: 'format',
      };

      const mockResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };
      fetchStub.resolves(mockResponse);

      const params = {
        storeUrl: 'https://example.com',
        contentUrl: 'https://example.com/page',
        // locale is undefined
      };

      await expect(getConfig(params, mockLog))
        .to.be.rejectedWith('Invalid config file https://example.com/configs.json format for default locale');
    });
  });

  describe('requestSaaS', () => {
    beforeEach(() => {
      // Reset fetch stub for each test
      fetchStub.restore();
      fetchStub = sinon.stub(global, 'fetch');
    });

    it('should make successful GraphQL request', async () => {
      const configData = {
        public: {
          default: {
            'commerce-customer-group': 'test-group',
            'commerce-environment-id': 'test-env',
            'commerce-store-code': 'test-store',
            'commerce-store-view-code': 'test-view',
            'commerce-website-code': 'test-website',
            'commerce-x-api-key': 'test-key',
            'commerce-endpoint': 'https://commerce.example.com/graphql',
          },
        },
      };

      const response = {
        data: {
          products: [{ name: 'Product 1' }],
        },
      };

      // Mock config fetch first
      const configResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };

      // Mock GraphQL response second
      const graphqlResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(response),
      };

      fetchStub.onCall(0).resolves(configResponse);
      fetchStub.onCall(1).resolves(graphqlResponse);

      const query = 'query GetProducts { products { name } }';
      const operationName = 'GetProducts';
      const variables = { limit: 10 };
      const params = {
        storeUrl: 'https://example.com',
      };

      const result = await requestSaaS(query, operationName, variables, params, mockLog);

      expect(fetchStub).to.have.been.calledTwice;
      expect(fetchStub.secondCall.args[0]).to.equal('https://commerce.example.com/graphql');
      expect(fetchStub.secondCall.args[1]).to.deep.include({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          origin: 'https://example.com',
          'magento-customer-group': 'test-group',
          'magento-environment-id': 'test-env',
          'magento-store-code': 'test-store',
          'magento-store-view-code': 'test-view',
          'magento-website-code': 'test-website',
          'x-api-key': 'test-key',
          'Magento-Is-Preview': true,
          'User-Agent': 'Spacecat/1.0',
        },
        body: JSON.stringify({
          operationName,
          query,
          variables,
        }),
      });
      expect(result).to.equal(response);
    });

    it('should handle GraphQL errors', async () => {
      const configData = {
        public: {
          default: {
            'commerce-customer-group': 'test-group',
            'commerce-environment-id': 'test-env',
            'commerce-store-code': 'test-store',
            'commerce-store-view-code': 'test-view',
            'commerce-website-code': 'test-website',
            'commerce-x-api-key': 'test-key',
            'commerce-endpoint': 'https://commerce.example.com/graphql',
          },
        },
      };

      const response = {
        errors: [
          { message: 'Field not found' },
          { message: 'Invalid query' },
        ],
      };

      // Mock config fetch first
      const configResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };

      // Mock GraphQL response second
      const graphqlResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(response),
      };

      fetchStub.onCall(0).resolves(configResponse);
      fetchStub.onCall(1).resolves(graphqlResponse);

      const query = 'query InvalidQuery { invalid }';
      const operationName = 'InvalidQuery';
      const variables = {};
      const params = {
        storeUrl: 'https://example.com',
      };

      await expect(requestSaaS(query, operationName, variables, params, mockLog))
        .to.be.rejectedWith("GraphQL operation 'InvalidQuery' failed: Field not found, Invalid query");
    });

    it('should parse string response as JSON', async () => {
      const configData = {
        public: {
          default: {
            'commerce-customer-group': 'test-group',
            'commerce-environment-id': 'test-env',
            'commerce-store-code': 'test-store',
            'commerce-store-view-code': 'test-view',
            'commerce-website-code': 'test-website',
            'commerce-x-api-key': 'test-key',
            'commerce-endpoint': 'https://commerce.example.com/graphql',
          },
        },
      };

      const stringResponse = '{"data":{"products":[{"name":"Product 1"}]}}';

      // Mock config fetch first
      const configResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('application/json'),
        },
        json: sinon.stub().resolves(configData),
      };

      // Mock GraphQL response as text
      const graphqlResponse = {
        ok: true,
        status: 200,
        headers: {
          get: sinon.stub().returns('text/plain'),
        },
        text: sinon.stub().resolves(stringResponse),
      };

      fetchStub.onCall(0).resolves(configResponse);
      fetchStub.onCall(1).resolves(graphqlResponse);

      const query = 'query GetProducts { products { name } }';
      const operationName = 'GetProducts';
      const variables = {};
      const params = {
        storeUrl: 'https://example.com',
      };

      const result = await requestSaaS(query, operationName, variables, params, mockLog);

      expect(result).to.deep.equal({
        data: {
          products: [{ name: 'Product 1' }],
        },
      });
    });
  });
});
