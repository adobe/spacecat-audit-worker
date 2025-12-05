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
import esmock from 'esmock';
import { MockContextBuilder } from '../../shared.js';
import { NoOpCache } from '../../../src/content-fragment-404/cache/noop-cache.js';
import { PathIndexCache } from '../../../src/content-fragment-404/cache/path-index-cache.js';

use(sinonChai);
use(chaiAsPromised);

import {
  TEST_AEM_AUTHOR_URL,
  TEST_AEM_AUTHOR_TOKEN,
  TEST_AEM_AUTHOR_TOKEN_ALT,
  TEST_PATH_PARENT,
  TEST_PATH_TEST,
  TEST_PATH_CONTENT_DAM,
  TEST_PATH_CONTENT,
  TEST_PATH_OTHER,
  TEST_PATH_RELATIVE,
  TEST_PATH_EN_US_IMAGES,
  TEST_PATH_FOLDER_FILE,
  TEST_PATH_IMAGE,
  TEST_PATH_IMAGE_1,
  TEST_PATH_IMAGE_2,
  TEST_PATH_CHILD_1,
  TEST_PATH_CHILD,
  TEST_PATH_PARENT_CHILD,
  STATUS_UNKNOWN,
  STATUS_PUBLISHED,
  STATUS_DRAFT,
  LOCALE_CODE_EN_US,
  MAX_PAGES_VALUE,
  PAGINATION_DELAY_MS_VALUE,
  DELAY_MS_TEST,
  DELAY_TOLERANCE_MS,
  DELAY_ZERO,
  DELAY_THRESHOLD_MS,
  TEST_PATH_IMAGE_WITH_SPACES,
  HTTP_STATUS_NOT_FOUND,
  HTTP_STATUS_TEXT_NOT_FOUND,
  BEARER_PREFIX,
  ACCEPT_JSON,
  API_SITES_FRAGMENTS,
  PROJECTION_MINIMAL,
  TEST_CURSOR,
} from './test-constants.js';

const EXPECTED_SUGGESTIONS_COUNT_1 = 1;

describe('AemClient', () => {
  let sandbox;
  let context;
  let mockFetch;
  let mockPathIndex;
  let mockCache;
  let mockContentPath;
  let mockLocale;
  let mockPathUtils;
  let AemClient;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    const mockSite = {
      getDeliveryConfig: sandbox.stub().returns({
        authorURL: TEST_AEM_AUTHOR_URL,
      }),
    };

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        log: {
          info: sandbox.spy(),
          debug: sandbox.spy(),
          warn: sandbox.spy(),
          error: sandbox.spy(),
        },
        env: {
          AEM_AUTHOR_TOKEN: TEST_AEM_AUTHOR_TOKEN,
        },
        site: mockSite,
      })
      .build();

    mockFetch = sandbox.stub();

    mockPathIndex = {
      insertContentPath: sandbox.stub(),
      findChildren: sandbox.stub().returns([]),
    };

    mockCache = {
      cacheItems: sandbox.stub(),
      findChildren: sandbox.stub().returns([]),
      isAvailable: sandbox.stub().returns(true),
    };

    mockContentPath = sandbox.stub();
    mockLocale = {
      fromPath: sandbox.stub().returns({ code: LOCALE_CODE_EN_US }),
    };

    mockPathUtils = {
      getParentPath: sandbox.stub().returns(TEST_PATH_PARENT),
    };

    const module = await esmock('../../../src/content-fragment-404/clients/aem-client.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockFetch,
      },
      '../../../src/content-fragment-404/utils/path-utils.js': {
        PathUtils: mockPathUtils,
      },
    });

    AemClient = module.AemClient;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('static constants', () => {
    it('should have correct API endpoints', () => {
      expect(AemClient.API_SITES_BASE).to.equal('/adobe/sites');
      expect(AemClient.API_SITES_FRAGMENTS).to.equal('/adobe/sites/cf/fragments');
    });

    it('should have pagination constants', () => {
      expect(AemClient.MAX_PAGES).to.equal(MAX_PAGES_VALUE);
      expect(AemClient.PAGINATION_DELAY_MS).to.equal(PAGINATION_DELAY_MS_VALUE);
    });
  });

  describe('constructor', () => {
    it('should create client with cache strategy', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);

      expect(client.authorUrl).to.equal(TEST_AEM_AUTHOR_URL);
      expect(client.authToken).to.equal(TEST_AEM_AUTHOR_TOKEN_ALT);
      expect(client.context).to.equal(context);
      expect(client.cache).to.equal(mockCache);
    });

    it('should create client with NoOpCache by default', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);

      expect(client.authorUrl).to.equal(TEST_AEM_AUTHOR_URL);
      expect(client.authToken).to.equal(TEST_AEM_AUTHOR_TOKEN_ALT);
      expect(client.context).to.equal(context);
      expect(client.cache).to.be.instanceOf(NoOpCache);
    });

    it('should create client with PathIndexCache', () => {
      const cache = new PathIndexCache(mockPathIndex);
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, cache);

      expect(client.context).to.equal(context);
      expect(client.cache).to.equal(cache);
      expect(client.cache).to.be.instanceOf(PathIndexCache);
    });
  });

  describe('createFrom static factory method', () => {
    it('should create client from context with cache strategy', () => {
      const client = AemClient.createFrom(context, mockCache);

      expect(client.authorUrl).to.equal(TEST_AEM_AUTHOR_URL);
      expect(client.authToken).to.equal(TEST_AEM_AUTHOR_TOKEN);
      expect(client.context).to.equal(context);
      expect(client.cache).to.equal(mockCache);
    });

    it('should create client with NoOpCache by default', () => {
      const client = AemClient.createFrom(context);

      expect(client.authorUrl).to.equal(TEST_AEM_AUTHOR_URL);
      expect(client.authToken).to.equal(TEST_AEM_AUTHOR_TOKEN);
      expect(client.context).to.equal(context);
      expect(client.cache).to.be.instanceOf(NoOpCache);
    });

    it('should throw error when AEM_AUTHOR_URL is missing', () => {
      const mockSiteWithoutUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: null,
        }),
      };

      const contextWithoutUrl = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: TEST_AEM_AUTHOR_TOKEN,
          },
          site: mockSiteWithoutUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutUrl))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when AEM_AUTHOR_TOKEN is missing', () => {
      const mockSiteWithUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: TEST_AEM_AUTHOR_URL,
        }),
      };

      const contextWithoutToken = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: null,
          },
          site: mockSiteWithUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutToken))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when both environment variables are missing', () => {
      const mockSiteWithoutUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: null,
        }),
      };

      const contextWithoutConfig = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {},
          site: mockSiteWithoutUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutConfig))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when authorURL is undefined', () => {
      const mockSiteWithUndefinedUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: undefined,
        }),
      };

      const contextWithUndefinedUrl = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: TEST_AEM_AUTHOR_TOKEN,
          },
          site: mockSiteWithUndefinedUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithUndefinedUrl))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when authorURL is empty string', () => {
      const mockSiteWithEmptyUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: '',
        }),
      };

      const contextWithEmptyUrl = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: TEST_AEM_AUTHOR_TOKEN,
          },
          site: mockSiteWithEmptyUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithEmptyUrl))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when authToken is undefined', () => {
      const mockSiteWithUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: TEST_AEM_AUTHOR_URL,
        }),
      };

      const contextWithUndefinedToken = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: undefined,
          },
          site: mockSiteWithUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithUndefinedToken))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when authToken is empty string', () => {
      const mockSiteWithUrl = {
        getDeliveryConfig: sandbox.stub().returns({
          authorURL: TEST_AEM_AUTHOR_URL,
        }),
      };

      const contextWithEmptyToken = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: '',
          },
          site: mockSiteWithUrl,
        })
        .build();

      expect(() => AemClient.createFrom(contextWithEmptyToken))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });
  });

  describe('isBreakingPoint static method', () => {
    it('should return true for null path', () => {
      expect(AemClient.isBreakingPoint(null)).to.be.true;
    });

    it('should return true for undefined path', () => {
      expect(AemClient.isBreakingPoint(undefined)).to.be.true;
    });

    it('should return true for empty string path', () => {
      expect(AemClient.isBreakingPoint('')).to.be.true;
    });

    it('should return true for paths not starting with /content/dam/', () => {
      expect(AemClient.isBreakingPoint(TEST_PATH_CONTENT)).to.be.true;
      expect(AemClient.isBreakingPoint(TEST_PATH_OTHER)).to.be.true;
      expect(AemClient.isBreakingPoint(TEST_PATH_RELATIVE)).to.be.true;
    });

    it('should return true for exact /content/dam path', () => {
      expect(AemClient.isBreakingPoint(TEST_PATH_CONTENT_DAM)).to.be.true;
    });

    it('should return false for valid content dam paths', () => {
      expect(AemClient.isBreakingPoint(TEST_PATH_TEST)).to.be.false;
      expect(AemClient.isBreakingPoint(TEST_PATH_EN_US_IMAGES)).to.be.false;
      expect(AemClient.isBreakingPoint(TEST_PATH_FOLDER_FILE)).to.be.false;
    });
  });

  describe('parseContentStatus static method', () => {
    it('should return UNKNOWN for null status', () => {
      expect(AemClient.parseContentStatus(null)).to.equal(STATUS_UNKNOWN);
    });

    it('should return UNKNOWN for undefined status', () => {
      expect(AemClient.parseContentStatus(undefined)).to.equal(STATUS_UNKNOWN);
    });

    it('should return UNKNOWN for empty string status', () => {
      expect(AemClient.parseContentStatus('')).to.equal(STATUS_UNKNOWN);
    });

    it('should parse valid statuses case-insensitively', () => {
      expect(AemClient.parseContentStatus('published')).to.equal(STATUS_PUBLISHED);
      expect(AemClient.parseContentStatus('PUBLISHED')).to.equal(STATUS_PUBLISHED);
      expect(AemClient.parseContentStatus('Published')).to.equal(STATUS_PUBLISHED);

      expect(AemClient.parseContentStatus('modified')).to.equal('MODIFIED');
      expect(AemClient.parseContentStatus('MODIFIED')).to.equal('MODIFIED');

      expect(AemClient.parseContentStatus('draft')).to.equal(STATUS_DRAFT);
      expect(AemClient.parseContentStatus('DRAFT')).to.equal(STATUS_DRAFT);

      expect(AemClient.parseContentStatus('archived')).to.equal('ARCHIVED');
      expect(AemClient.parseContentStatus('ARCHIVED')).to.equal('ARCHIVED');

      expect(AemClient.parseContentStatus('deleted')).to.equal('DELETED');
      expect(AemClient.parseContentStatus('DELETED')).to.equal('DELETED');
    });

    it('should return UNKNOWN for invalid statuses', () => {
      expect(AemClient.parseContentStatus('invalid')).to.equal(STATUS_UNKNOWN);
      expect(AemClient.parseContentStatus('pending')).to.equal(STATUS_UNKNOWN);
      expect(AemClient.parseContentStatus('123')).to.equal(STATUS_UNKNOWN);
    });
  });

  describe('delay static method', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await AemClient.delay(DELAY_MS_TEST);
      const end = Date.now();

      expect(end - start).to.be.at.least(DELAY_TOLERANCE_MS); // Allow some tolerance
    });

    it('should handle zero delay', async () => {
      const start = Date.now();
      await AemClient.delay(DELAY_ZERO);
      const end = Date.now();

      expect(end - start).to.be.lessThan(DELAY_THRESHOLD_MS);
    });
  });

  describe('createUrl method', () => {
    it('should create correct URL with path and projection', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrl(TEST_PATH_IMAGE);

      expect(url.toString()).to.equal(`${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_IMAGE)}&projection=${PROJECTION_MINIMAL}`);
    });

    it('should handle paths with special characters', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrl(TEST_PATH_IMAGE_WITH_SPACES);

      expect(url.toString()).to.include('image+with+spaces');
    });

    it('should handle authorUrl with trailing slash', () => {
      const client = new AemClient(context, `${TEST_AEM_AUTHOR_URL}/`, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrl(TEST_PATH_TEST);

      expect(url.toString()).to.equal(`${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_TEST)}&projection=${PROJECTION_MINIMAL}`);
    });
  });

  describe('createUrlWithPagination method', () => {
    it('should create URL without cursor when cursor is null', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrlWithPagination(TEST_PATH_TEST, null);

      expect(url.toString()).to.equal(`${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_TEST)}&projection=${PROJECTION_MINIMAL}`);
    });

    it('should create URL with cursor when cursor is provided', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrlWithPagination(TEST_PATH_TEST, TEST_CURSOR);

      expect(url.toString()).to.equal(`${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_TEST)}&projection=${PROJECTION_MINIMAL}&cursor=${TEST_CURSOR}`);
    });

    it('should handle empty string cursor', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const url = client.createUrlWithPagination(TEST_PATH_TEST, '');

      // Empty string cursor is falsy, so it doesn't get added
      expect(url.toString()).to.equal(`${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_TEST)}&projection=${PROJECTION_MINIMAL}`);
    });
  });

  describe('createAuthHeaders method', () => {
    it('should create correct authorization headers', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const headers = client.createAuthHeaders();

      expect(headers).to.deep.equal({
        Authorization: `${BEARER_PREFIX}${TEST_AEM_AUTHOR_TOKEN_ALT}`,
        Accept: ACCEPT_JSON,
      });
    });

    it('should handle empty token', () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, '');
      const headers = client.createAuthHeaders();

      expect(headers).to.deep.equal({
        Authorization: BEARER_PREFIX,
        Accept: ACCEPT_JSON,
      });
    });
  });

  describe('isAvailable method', () => {
    it('should return true when content is available', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.true;
      expect(mockFetch).to.have.been.calledOnce;
    });

    it('should return false when response is not ok', async () => {
      const mockResponse = { ok: false };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.false;
    });

    it('should return false when no items found', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({ items: [] }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.false;
    });

    // TODO: Need to investigate the wanted behavior: should we return true or false?
    it('should return true when multiple items found (folder access)', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
            { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
          ],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.isAvailable(TEST_PATH_TEST);

      expect(result).to.be.true;
    });

    it('should cache content when cache strategy is provided', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      await client.isAvailable(TEST_PATH_IMAGE);

      expect(mockCache.cacheItems).to.have.been.calledOnce;
      expect(mockCache.cacheItems).to.have.been.calledWith(
        [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        AemClient.parseContentStatus,
      );
    });

    it('should use NoOpCache when no cache is provided', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.isAvailable(TEST_PATH_IMAGE);

      // NoOpCache doesn't throw, it just doesn't cache
      expect(result).to.be.true;
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);

      await expect(client.isAvailable(TEST_PATH_IMAGE))
        .to.be.rejectedWith(`Failed to check AEM Author availability for ${TEST_PATH_IMAGE}: Network error`);
    });

    it('should throw error when JSON parsing fails', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().rejects(new Error('Invalid JSON')),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);

      await expect(client.isAvailable(TEST_PATH_IMAGE))
        .to.be.rejectedWith(`Failed to check AEM Author availability for ${TEST_PATH_IMAGE}: Invalid JSON`);
    });
  });

  describe('fetchWithPagination method', () => {
    it('should fetch single page successfully', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
          cursor: null,
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.fetchWithPagination(TEST_PATH_TEST);

      expect(result).to.deep.equal({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        cursor: null,
      });
    });

    it('should fetch page with cursor', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
          cursor: 'next-cursor',
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.fetchWithPagination(TEST_PATH_TEST, 'current-cursor');

      expect(result).to.deep.equal({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        cursor: 'next-cursor',
      });
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({}),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.fetchWithPagination(TEST_PATH_TEST);

      expect(result).to.deep.equal({
        items: [],
        cursor: null,
      });
    });

    it('should throw error for non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: HTTP_STATUS_NOT_FOUND,
        statusText: HTTP_STATUS_TEXT_NOT_FOUND,
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);

      await expect(client.fetchWithPagination(TEST_PATH_TEST))
        .to.be.rejectedWith(`HTTP ${HTTP_STATUS_NOT_FOUND}: ${HTTP_STATUS_TEXT_NOT_FOUND}`);
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);

      await expect(client.fetchWithPagination(TEST_PATH_TEST))
        .to.be.rejectedWith('Network error');
    });
  });

  describe('fetchContentWithPagination method', () => {
    it('should fetch all pages and return combined results', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
            cursor: 'cursor-2',
          }),
        },
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT }],
            cursor: null,
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).resolves(mockResponses[1]);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.fetchContentWithPagination(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(2);
      expect(result[0].path).to.equal(TEST_PATH_IMAGE_1);
      expect(result[1].path).to.equal(TEST_PATH_IMAGE_2);
      expect(mockFetch).to.have.been.calledTwice;
    });

    it('should stop at maximum page limit', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
          cursor: 'always-has-cursor',
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.fetchContentWithPagination(TEST_PATH_TEST);

      expect(mockFetch.callCount).to.equal(AemClient.MAX_PAGES);
      expect(result).to.have.lengthOf(AemClient.MAX_PAGES);
    });

    it('should handle errors gracefully and return partial results', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
            cursor: 'cursor-2',
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).rejects(new Error('Network error'));

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const result = await client.fetchContentWithPagination(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(1);
      expect(result[0].path).to.equal(TEST_PATH_IMAGE_1);
    });

    it('should cache all fetched items when cache strategy is provided', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
            { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
          ],
          cursor: null,
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      await client.fetchContentWithPagination(TEST_PATH_TEST);

      expect(mockCache.cacheItems).to.have.been.calledOnce;
      expect(mockCache.cacheItems).to.have.been.calledWith(
        [
          { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
          { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
        ],
        AemClient.parseContentStatus,
      );
    });
  });

  describe('fetchContent method', () => {
    it('should delegate to fetchContentWithPagination', async () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      const fetchContentWithPaginationStub = sandbox.stub(client, 'fetchContentWithPagination').resolves([]);

      await client.fetchContent(TEST_PATH_TEST);

      expect(fetchContentWithPaginationStub).to.have.been.calledWith(TEST_PATH_TEST);
    });

    it('should wrap errors with descriptive message', async () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT);
      sandbox.stub(client, 'fetchContentWithPagination').rejects(new Error('Original error'));

      await expect(client.fetchContent(TEST_PATH_TEST))
        .to.be.rejectedWith(`Failed to fetch AEM Author content for ${TEST_PATH_TEST}: Original error`);
    });
  });

  describe('getChildrenFromPath method', () => {
    it('should return empty array when cache is not available', async () => {
      const noOpCache = new NoOpCache();
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, noOpCache);
      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should return empty array for breaking point paths', async () => {
      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_CONTENT_DAM);

      expect(result).to.deep.equal([]);
    });

    it('should return cached children when available', async () => {
      const cachedChildren = [{ path: TEST_PATH_CHILD_1 }];
      mockCache.findChildren.returns(cachedChildren);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.equal(cachedChildren);
      expect(mockCache.findChildren).to.have.been.calledWith(TEST_PATH_TEST);
    });

    it('should fetch content when parent is available but not cached', async () => {
      mockCache.findChildren.onCall(0).returns([]); // No cached children initially
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_CHILD_1 }]); // After fetching

      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_CHILD_1, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const fetchContentStub = sandbox.stub(client, 'fetchContent').resolves();

      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(fetchContentStub).to.have.been.calledWith(TEST_PATH_TEST);
      expect(result).to.deep.equal([{ path: TEST_PATH_CHILD_1 }]);
    });

    it('should traverse up hierarchy when parent is not available', async () => {
      // Setup: first path has no children, second path (parent) has children
      mockCache.findChildren.onCall(0).returns([]); // /content/dam/test/child
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_PARENT_CHILD }]); // /content/dam/parent

      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);

      // First fetch fails (path not available), second succeeds (parent available)
      const mockResponse1 = { ok: false };
      const mockResponse2 = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_PARENT_CHILD, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.onCall(0).resolves(mockResponse1); // First isAvailable call
      mockFetch.onCall(1).resolves(mockResponse2); // Second isAvailable call for parent

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_CHILD);

      expect(mockPathUtils.getParentPath).to.have.been.calledWith(TEST_PATH_CHILD);
      expect(result).to.deep.equal([{ path: TEST_PATH_PARENT_CHILD }]);
    });

    it('should return empty array when no parent path found', async () => {
      mockCache.findChildren.returns([]);
      mockPathUtils.getParentPath.returns(null);

      const mockResponse = { ok: false };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should handle errors during availability check', async () => {
      mockCache.findChildren.returns([]);
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should continue with cached data when fetchContent fails', async () => {
      mockCache.findChildren.onCall(0).returns([]); // No cached children initially
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_CHILD_1 }]); // After failed fetch

      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_CHILD_1, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, TEST_AEM_AUTHOR_URL, TEST_AEM_AUTHOR_TOKEN_ALT, mockCache);
      const fetchContentStub = sandbox.stub(client, 'fetchContent').rejects(new Error('Fetch failed'));

      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(fetchContentStub).to.have.been.calledWith(TEST_PATH_TEST);
      expect(result).to.deep.equal([{ path: TEST_PATH_CHILD_1 }]);
    });
  });

  describe('integration scenarios', () => {
    it('should work end-to-end for available content', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = AemClient.createFrom(context, mockCache);
      const isAvailable = await client.isAvailable(TEST_PATH_IMAGE);

      expect(isAvailable).to.be.true;
      expect(mockFetch).to.have.been.calledWith(
        `${TEST_AEM_AUTHOR_URL}${API_SITES_FRAGMENTS}?path=${encodeURIComponent(TEST_PATH_IMAGE)}&projection=${PROJECTION_MINIMAL}`,
        {
          headers: {
            Authorization: `${BEARER_PREFIX}${TEST_AEM_AUTHOR_TOKEN}`,
            Accept: ACCEPT_JSON,
          },
        },
      );
    });

    it('should handle complete pagination workflow', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
            cursor: 'cursor-2',
          }),
        },
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT }],
            cursor: null,
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).resolves(mockResponses[1]);

      const client = AemClient.createFrom(context, mockCache);
      const result = await client.fetchContent(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(2);
      expect(mockFetch).to.have.been.calledTwice;
      expect(mockCache.cacheItems).to.have.been.calledOnce;
    });

    it('should handle complete getChildrenFromPath workflow', async () => {
      const cachedChildren = [{ path: TEST_PATH_CHILD_1 }];
      mockCache.findChildren.returns(cachedChildren);

      const client = AemClient.createFrom(context, mockCache);
      const result = await client.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.equal(cachedChildren);
    });
  });
});
