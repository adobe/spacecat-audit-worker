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
import StoreClient, {
  StoreEmptyError,
  URL_TYPES,
  GUIDELINE_TYPES,
} from '../../src/utils/store-client.js';

use(sinonChai);
use(chaiAsPromised);

describe('StoreClient', () => {
  let sandbox;
  let mockFetch;
  let mockLog;
  let storeClient;

  const apiBaseUrl = 'https://spacecat-api.example.com';
  const apiKey = 'test-api-key';
  const siteId = 'test-site-id';

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockLog = {
      debug: sandbox.stub(),
      info: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    };

    mockFetch = sandbox.stub();

    storeClient = new StoreClient({ apiBaseUrl, apiKey }, mockFetch, mockLog);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Constants', () => {
    it('should export URL_TYPES', () => {
      expect(URL_TYPES).to.deep.equal({
        WIKIPEDIA: 'wikipedia-analysis',
        REDDIT: 'reddit-analysis',
        YOUTUBE: 'youtube-analysis',
      });
    });

    it('should export GUIDELINE_TYPES', () => {
      expect(GUIDELINE_TYPES).to.deep.equal({
        WIKIPEDIA_ANALYSIS: 'wikipedia-analysis',
        REDDIT_ANALYSIS: 'reddit-analysis',
        YOUTUBE_ANALYSIS: 'youtube-analysis',
      });
    });
  });

  describe('StoreEmptyError', () => {
    it('should create error with correct properties', () => {
      const error = new StoreEmptyError('urlStore', 'site-123', 'No URLs found');

      expect(error).to.be.instanceOf(Error);
      expect(error.name).to.equal('StoreEmptyError');
      expect(error.storeName).to.equal('urlStore');
      expect(error.siteId).to.equal('site-123');
      expect(error.message).to.equal('urlStore returned empty results for siteId: site-123. No URLs found');
    });

    it('should create error without details', () => {
      const error = new StoreEmptyError('contentStore', 'site-456');

      expect(error.message).to.equal('contentStore returned empty results for siteId: site-456');
    });
  });

  describe('createFrom', () => {
    it('should create StoreClient from context', () => {
      const context = {
        env: {
          SPACECAT_API_BASE_URL: 'https://api.example.com',
          SPACECAT_API_KEY: 'secret-key',
        },
        log: mockLog,
      };

      const client = StoreClient.createFrom(context);

      expect(client).to.be.instanceOf(StoreClient);
      expect(client.apiBaseUrl).to.equal('https://api.example.com');
      expect(client.apiKey).to.equal('secret-key');
    });

    it('should create StoreClient without API key', () => {
      const context = {
        env: {
          SPACECAT_API_BASE_URL: 'https://api.example.com',
        },
        log: mockLog,
      };

      const client = StoreClient.createFrom(context);

      expect(client).to.be.instanceOf(StoreClient);
      expect(client.apiKey).to.be.undefined;
    });
  });

  describe('getUrls', () => {
    it('should fetch URLs from store API with pagination', async () => {
      const mockUrls = [
        { url: 'https://en.wikipedia.org/wiki/Test', siteId },
        { url: 'https://en.wikipedia.org/wiki/Test2', siteId },
      ];

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: mockUrls, pagination: { cursor: null } }),
      });

      const result = await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(result).to.deep.equal(mockUrls);
      expect(mockFetch).to.have.been.calledOnce;
      expect(mockFetch.firstCall.args[0]).to.include(`/sites/${siteId}/url-store/by-audit/wikipedia-analysis`);
    });

    it('should fetch all pages when paginated', async () => {
      const page1 = [{ url: 'https://example.com/1' }];
      const page2 = [{ url: 'https://example.com/2' }];

      mockFetch.onFirstCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: page1, pagination: { cursor: 'next-cursor' } }),
      });
      mockFetch.onSecondCall().resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: page2, pagination: { cursor: null } }),
      });

      const result = await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(result).to.deep.equal([...page1, ...page2]);
      expect(mockFetch).to.have.been.calledTwice;
    });

    it('should include x-api-key header when API key is set', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: [{ url: 'test' }], pagination: {} }),
      });

      await storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(mockFetch.firstCall.args[1].headers).to.deep.include({
        'x-api-key': 'test-api-key',
      });
    });

    it('should not include x-api-key header when API key is not set', async () => {
      const clientNoKey = new StoreClient({ apiBaseUrl }, mockFetch, mockLog);

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: [{ url: 'test' }], pagination: {} }),
      });

      await clientNoKey.getUrls(siteId, URL_TYPES.WIKIPEDIA);

      expect(mockFetch.firstCall.args[1].headers).to.not.have.property('x-api-key');
    });

    it('should throw StoreEmptyError when no URLs returned', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ items: [], pagination: {} }),
      });

      await expect(storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should throw StoreEmptyError when items is undefined', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ pagination: {} }),
      });

      await expect(storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should throw error on API failure', async () => {
      mockFetch.resolves({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(storeClient.getUrls(siteId, URL_TYPES.WIKIPEDIA))
        .to.be.rejectedWith('Store API request failed: 500 Internal Server Error');
    });
  });

  describe('getGuidelines', () => {
    it('should fetch sentiment config from store API', async () => {
      const mockConfig = {
        topics: [{ topicId: '1', name: 'Topic 1' }],
        guidelines: [{ guidelineId: '1', name: 'Guideline 1', audits: ['wikipedia-analysis'] }],
      };

      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves(mockConfig),
      });

      const result = await storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS);

      expect(result).to.deep.equal(mockConfig);
      expect(mockFetch).to.have.been.calledOnce;
      expect(mockFetch.firstCall.args[0]).to.include(`/sites/${siteId}/sentiment/config`);
      expect(mockFetch.firstCall.args[0]).to.include('audit=wikipedia-analysis');
    });

    it('should throw StoreEmptyError when no guidelines returned', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({ topics: [], guidelines: [] }),
      });

      await expect(storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should throw StoreEmptyError when response is empty', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({}),
      });

      await expect(storeClient.getGuidelines(siteId, GUIDELINE_TYPES.WIKIPEDIA_ANALYSIS))
        .to.be.rejectedWith(StoreEmptyError);
    });

    it('should log topics and guidelines count', async () => {
      mockFetch.resolves({
        ok: true,
        json: sandbox.stub().resolves({
          topics: [{ topicId: '1' }, { topicId: '2' }],
          guidelines: [{ guidelineId: '1' }],
        }),
      });

      await storeClient.getGuidelines(siteId, 'test');

      expect(mockLog.info).to.have.been.calledWith(
        sinon.match(/2 topics and 1 guidelines/),
      );
    });
  });
});
