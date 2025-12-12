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
import ExaClient from '../../src/utils/exa-client.js';

describe('ExaClient', () => {
  let log;
  let context;

  beforeEach(() => {
    log = {
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    context = {
      env: {
        EXA_API_KEY: 'test-api-key',
      },
      log,
    };
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('createFrom', () => {
    it('should create client from context', () => {
      const client = ExaClient.createFrom(context);
      expect(client).to.be.instanceOf(ExaClient);
      expect(client.config.apiKey).to.equal('test-api-key');
    });

    it('should throw error if API key is missing', () => {
      context.env.EXA_API_KEY = '';
      expect(() => ExaClient.createFrom(context)).to.throw('Missing Exa API key');
    });

    it('should use console as default logger', () => {
      delete context.log;
      const client = ExaClient.createFrom(context);
      expect(client.log).to.equal(console);
    });
  });

  describe('constructor', () => {
    it('should create client with config and logger', () => {
      const config = { apiKey: 'test-key' };
      const client = new ExaClient(config, log);
      expect(client.config).to.deep.equal(config);
      expect(client.log).to.equal(log);
    });
  });

  describe('findSimilar', () => {
    let client;

    beforeEach(() => {
      client = new ExaClient({ apiKey: 'test-api-key' }, log);
    });

    it('should find similar links successfully', async () => {
      const mockResponse = {
        requestId: 'test-request-id',
        results: [
          {
            title: 'Similar Page',
            url: 'https://example.com/similar',
            publishedDate: '2023-01-01',
            author: 'Test Author',
            id: 'page-1',
          },
        ],
        costDollars: { total: 0.005 },
      };

      nock('https://api.exa.ai')
        .post('/findSimilar', {
          url: 'https://example.com/test',
          numResults: 10,
        })
        .reply(200, mockResponse);

      const result = await client.findSimilar('https://example.com/test');

      expect(result).to.deep.equal(mockResponse);
      expect(result.results).to.have.lengthOf(1);
      expect(result.requestId).to.equal('test-request-id');
    });

    it('should include content options when requested', async () => {
      const mockResponse = {
        requestId: 'test-request-id',
        results: [
          {
            title: 'Similar Page',
            url: 'https://example.com/similar',
            text: 'Page content here...',
            highlights: ['highlight 1'],
            summary: 'Page summary',
          },
        ],
      };

      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.text).to.be.true;
          expect(body.highlights).to.be.true;
          expect(body.summary).to.be.true;
          return true;
        })
        .reply(200, mockResponse);

      const result = await client.findSimilar('https://example.com/test', {
        text: true,
        highlights: true,
        summary: true,
      });

      expect(result.results[0].text).to.exist;
      expect(result.results[0].highlights).to.exist;
      expect(result.results[0].summary).to.exist;
    });

    it('should handle custom numResults', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.numResults).to.equal(25);
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilar('https://example.com/test', { numResults: 25 });
    });

    it('should include filtering options', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.excludeDomains).to.equal('example.org,test.com');
          expect(body.includeDomains).to.equal('example.com');
          expect(body.startPublishedDate).to.equal('2023-01-01');
          expect(body.excludeSourceDomain).to.be.true;
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilar('https://example.com/test', {
        excludeDomains: 'example.org,test.com',
        includeDomains: 'example.com',
        startPublishedDate: '2023-01-01',
        excludeSourceDomain: true,
      });
    });

    it('should include contents options', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.contents).to.deep.equal({
            maxCharacters: 5000,
            subpages: true,
          });
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilar('https://example.com/test', {
        contents: {
          maxCharacters: 5000,
          subpages: true,
        },
      });
    });
  });

  describe('findSimilarWithContent', () => {
    let client;

    beforeEach(() => {
      client = new ExaClient({ apiKey: 'test-api-key' }, log);
    });

    it('should automatically include all content options', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.text).to.be.true;
          expect(body.highlights).to.be.true;
          expect(body.summary).to.be.true;
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilarWithContent('https://example.com/test');
    });

    it('should allow additional options', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.text).to.be.true;
          expect(body.numResults).to.equal(20);
          expect(body.excludeSourceDomain).to.be.true;
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilarWithContent('https://example.com/test', {
        numResults: 20,
        excludeSourceDomain: true,
      });
    });
  });

  describe('findSimilarForContentOptimization', () => {
    let client;

    beforeEach(() => {
      client = new ExaClient({ apiKey: 'test-api-key' }, log);
    });

    it('should use optimized settings for content analysis', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.numResults).to.equal(5);
          expect(body.text).to.be.true;
          expect(body.summary).to.be.true;
          expect(body.highlights).to.be.true;
          expect(body.excludeSourceDomain).to.be.true;
          expect(body.contents).to.deep.equal({ maxCharacters: 5000 });
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilarForContentOptimization('https://example.com/test');
    });

    it('should allow custom numResults', async () => {
      nock('https://api.exa.ai')
        .post('/findSimilar', (body) => {
          expect(body.numResults).to.equal(10);
          return true;
        })
        .reply(200, { requestId: 'test', results: [] });

      await client.findSimilarForContentOptimization('https://example.com/test', 10);
    });
  });
});
