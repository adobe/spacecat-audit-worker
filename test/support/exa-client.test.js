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
import nock from 'nock';
import ExaClient from '../../src/support/exa-client.js';

use(chaiAsPromised);
use(sinonChai);

describe('ExaClient', () => {
  let client;
  let log;
  const apiKey = 'test-exa-api-key';
  const apiEndpoint = 'https://api.exa.ai';

  before(() => {
    nock.disableNetConnect();
  });

  after(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    log = {
      debug: sinon.stub(),
      error: sinon.stub(),
      info: sinon.stub(),
    };

    client = new ExaClient({
      apiKey,
      apiEndpoint,
    }, log);
  });

  afterEach(() => {
    sinon.restore();
    nock.cleanAll();
  });

  describe('createFrom', () => {
    it('should create client from context', () => {
      const context = {
        env: {
          EXA_API_KEY: apiKey,
        },
        log,
      };

      const newClient = ExaClient.createFrom(context);
      expect(newClient).to.be.instanceOf(ExaClient);
      expect(newClient.config.apiKey).to.equal(apiKey);
      expect(newClient.config.apiEndpoint).to.equal('https://api.exa.ai');
    });

    it('should use custom endpoint if provided', () => {
      const customEndpoint = 'https://custom.exa.ai';
      const context = {
        env: {
          EXA_API_KEY: apiKey,
          EXA_API_ENDPOINT: customEndpoint,
        },
        log,
      };

      const newClient = ExaClient.createFrom(context);
      expect(newClient.config.apiEndpoint).to.equal(customEndpoint);
    });

    it('should throw error if API key is missing', () => {
      const context = {
        env: {},
        log,
      };

      expect(() => ExaClient.createFrom(context)).to.throw('Missing Exa API key');
    });

    it('should throw error if endpoint is invalid', () => {
      const context = {
        env: {
          EXA_API_KEY: apiKey,
          EXA_API_ENDPOINT: 'not-a-url',
        },
        log,
      };

      expect(() => ExaClient.createFrom(context)).to.throw('Invalid Exa API endpoint');
    });
  });

  describe('findSimilar', () => {
    const testUrl = 'https://example.com/test-page';
    const mockResponse = {
      requestId: 'test-request-123',
      results: [
        {
          title: 'Similar Page 1',
          url: 'https://example.com/similar-1',
          publishedDate: '2024-01-01T00:00:00.000Z',
          author: 'Test Author',
          id: 'similar-1',
        },
        {
          title: 'Similar Page 2',
          url: 'https://example.com/similar-2',
          publishedDate: '2024-01-02T00:00:00.000Z',
          author: 'Test Author 2',
          id: 'similar-2',
        },
      ],
      costDollars: {
        total: 0.005,
      },
    };

    it('should find similar links successfully', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
        })
        .reply(200, mockResponse);

      const result = await client.findSimilar(testUrl);

      expect(result).to.deep.equal(mockResponse);
      expect(result.results).to.have.lengthOf(2);
      expect(log.debug).to.have.been.called;
    });

    it('should throw error for invalid URL', async () => {
      await expect(client.findSimilar('not-a-valid-url'))
        .to.be.rejectedWith('Invalid URL provided');
    });

    it('should include text content when requested', async () => {
      const mockResponseWithText = {
        ...mockResponse,
        results: mockResponse.results.map((r) => ({
          ...r,
          text: 'Full page content here...',
        })),
      };

      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          text: true,
        })
        .reply(200, mockResponseWithText);

      const result = await client.findSimilar(testUrl, { text: true });

      expect(result.results[0].text).to.exist;
      expect(result.results[0].text).to.equal('Full page content here...');
    });

    it('should include summaries when requested', async () => {
      const mockResponseWithSummary = {
        ...mockResponse,
        results: mockResponse.results.map((r) => ({
          ...r,
          summary: 'AI-generated summary...',
        })),
      };

      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          summary: true,
        })
        .reply(200, mockResponseWithSummary);

      const result = await client.findSimilar(testUrl, { summary: true });

      expect(result.results[0].summary).to.exist;
    });

    it('should support custom number of results', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 25,
        })
        .reply(200, mockResponse);

      await client.findSimilar(testUrl, { numResults: 25 });

      expect(nock.isDone()).to.be.true;
    });

    it('should support domain filtering', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          excludeDomains: ['spam.com'],
          includeDomains: ['example.com', 'test.com'],
        })
        .reply(200, mockResponse);

      await client.findSimilar(testUrl, {
        excludeDomains: ['spam.com'],
        includeDomains: ['example.com', 'test.com'],
      });

      expect(nock.isDone()).to.be.true;
    });

    it('should support date filtering', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          startPublishedDate: '2024-01-01',
          endPublishedDate: '2024-12-31',
        })
        .reply(200, mockResponse);

      await client.findSimilar(testUrl, {
        startPublishedDate: '2024-01-01',
        endPublishedDate: '2024-12-31',
      });

      expect(nock.isDone()).to.be.true;
    });

    it('should support subpages crawling', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          subpages: 5,
        })
        .reply(200, mockResponse);

      await client.findSimilar(testUrl, { subpages: 5 });

      expect(nock.isDone()).to.be.true;
    });

    it('should support context mode for LLM', async () => {
      const mockResponseWithContext = {
        ...mockResponse,
        context: 'Combined context string for LLM...',
      };

      nock(apiEndpoint)
        .post('/findSimilar', {
          url: testUrl,
          numResults: 10,
          contents: {
            context: true,
          },
        })
        .reply(200, mockResponseWithContext);

      const result = await client.findSimilar(testUrl, { context: true });

      expect(result.context).to.equal('Combined context string for LLM...');
    });

    it('should handle API errors gracefully', async () => {
      nock(apiEndpoint)
        .post('/findSimilar')
        .reply(500, JSON.stringify({ error: 'Internal Server Error' }));

      await expect(client.findSimilar(testUrl))
        .to.be.rejectedWith('Exa API call failed with status code 500');

      expect(log.error).to.have.been.called;
    });

    it('should handle invalid response format', async () => {
      nock(apiEndpoint)
        .post('/findSimilar')
        .reply(200, { invalid: 'response' });

      await expect(client.findSimilar(testUrl))
        .to.be.rejectedWith('Invalid response format from Exa API');
    });

    it('should log cost information', async () => {
      nock(apiEndpoint)
        .post('/findSimilar')
        .reply(200, mockResponse);

      await client.findSimilar(testUrl);

      expect(log.debug).to.have.been.calledWith(
        sinon.match(/\$0.005/),
      );
    });
  });

  describe('convenience methods', () => {
    const testUrl = 'https://example.com/test-page';
    const mockResponse = {
      requestId: 'test-request-123',
      results: [
        {
          title: 'Similar Page',
          url: 'https://example.com/similar',
          text: 'Full content...',
          summary: 'Summary...',
        },
      ],
    };

    it('should find similar with content', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', (body) => body.text === true)
        .reply(200, mockResponse);

      const result = await client.findSimilarWithContent(testUrl);

      expect(result.results[0].text).to.exist;
    });

    it('should find similar with summary', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', (body) => body.summary === true)
        .reply(200, mockResponse);

      const result = await client.findSimilarWithSummary(testUrl);

      expect(result.results[0].summary).to.exist;
    });

    it('should find similar with full content', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', (body) => body.text === true && body.summary === true)
        .reply(200, mockResponse);

      const result = await client.findSimilarWithFullContent(testUrl);

      expect(result.results[0].text).to.exist;
      expect(result.results[0].summary).to.exist;
    });

    it('should merge options in convenience methods', async () => {
      nock(apiEndpoint)
        .post('/findSimilar', (body) => body.text === true && body.numResults === 25)
        .reply(200, mockResponse);

      await client.findSimilarWithContent(testUrl, { numResults: 25 });

      expect(nock.isDone()).to.be.true;
    });
  });
});
