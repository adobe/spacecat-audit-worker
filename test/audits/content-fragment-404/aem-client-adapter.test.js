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
  MAX_PAGES_VALUE,
  PAGINATION_DELAY_MS_VALUE,
  DELAY_MS_TEST,
  DELAY_TOLERANCE_MS,
  DELAY_ZERO,
  DELAY_THRESHOLD_MS,
} from './test-constants.js';

const EXPECTED_SUGGESTIONS_COUNT_1 = 1;

describe('AemClientAdapter', () => {
  let sandbox;
  let context;
  let mockRequest;
  let mockPathIndex;
  let mockCache;
  let mockManagement;
  let mockBuiltClient;
  let mockAemClientBuilder;
  let mockPathUtils;
  let AemClientAdapter;

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
          IMS_HOST: 'ims.example.com',
          IMS_CLIENT_ID: 'test-client-id',
          IMS_CLIENT_CODE: 'test-client-code',
          IMS_CLIENT_SECRET: 'test-client-secret',
          IMS_SCOPE: 'test-scope',
        },
        site: mockSite,
      })
      .build();

    mockRequest = sandbox.stub();

    mockPathIndex = {
      insertContentPath: sandbox.stub(),
      findChildren: sandbox.stub().returns([]),
    };

    mockCache = {
      cacheItems: sandbox.stub(),
      findChildren: sandbox.stub().returns([]),
      isAvailable: sandbox.stub().returns(true),
    };

    mockManagement = {
      resolveFragmentId: sandbox.stub(),
      getFragment: sandbox.stub(),
      getFragmentById: sandbox.stub(),
      createFragment: sandbox.stub(),
      patchFragment: sandbox.stub(),
      deleteFragment: sandbox.stub(),
    };

    mockBuiltClient = {
      client: {
        request: mockRequest,
        log: context.log,
      },
      management: mockManagement,
      versioning: null,
      tagging: null,
    };

    mockAemClientBuilder = {
      create: sandbox.stub().returns({
        withManagement: sandbox.stub().returns({
          build: sandbox.stub().returns(mockBuiltClient),
        }),
      }),
    };

    mockPathUtils = {
      getParentPath: sandbox.stub().returns(TEST_PATH_PARENT),
    };

    const module = await esmock('../../../src/content-fragment-404/clients/aem-client-adapter.js', {
      '@adobe/spacecat-shared-aem-client': {
        AemClientBuilder: mockAemClientBuilder,
        API_SITES_CF_FRAGMENTS: '/adobe/sites/cf/fragments',
      },
      '../../../src/content-fragment-404/utils/path-utils.js': {
        PathUtils: mockPathUtils,
      },
    });

    AemClientAdapter = module.AemClientAdapter;
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('static constants', () => {
    it('should have pagination constants', () => {
      expect(AemClientAdapter.MAX_PAGES).to.equal(MAX_PAGES_VALUE);
      expect(AemClientAdapter.PAGINATION_DELAY_MS).to.equal(PAGINATION_DELAY_MS_VALUE);
    });
  });

  describe('constructor', () => {
    it('should create adapter with cache strategy', () => {
      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);

      expect(adapter.management).to.equal(mockManagement);
    });

    it('should create adapter with NoOpCache by default', () => {
      const adapter = new AemClientAdapter(context, mockBuiltClient);

      expect(adapter.management).to.equal(mockManagement);
    });

    it('should create adapter with PathIndexCache', () => {
      const cache = new PathIndexCache(mockPathIndex);
      const adapter = new AemClientAdapter(context, mockBuiltClient, cache);

      expect(adapter.management).to.equal(mockManagement);
    });
  });

  describe('createFrom static factory method', () => {
    it('should create adapter from context with cache strategy', () => {
      const adapter = AemClientAdapter.createFrom(context, mockCache);

      expect(mockAemClientBuilder.create).to.have.been.calledOnce;
      expect(adapter.management).to.equal(mockManagement);
    });

    it('should create adapter with NoOpCache by default', () => {
      const adapter = AemClientAdapter.createFrom(context);

      expect(mockAemClientBuilder.create).to.have.been.calledOnce;
      expect(adapter.management).to.equal(mockManagement);
    });
  });

  describe('management getter', () => {
    it('should expose fragment management capability', () => {
      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);

      expect(adapter.management).to.equal(mockManagement);
    });
  });

  describe('isBreakingPoint static method', () => {
    it('should return true for null path', () => {
      expect(AemClientAdapter.isBreakingPoint(null)).to.be.true;
    });

    it('should return true for undefined path', () => {
      expect(AemClientAdapter.isBreakingPoint(undefined)).to.be.true;
    });

    it('should return true for empty string path', () => {
      expect(AemClientAdapter.isBreakingPoint('')).to.be.true;
    });

    it('should return true for paths not starting with /content/dam/', () => {
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_CONTENT)).to.be.true;
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_OTHER)).to.be.true;
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_RELATIVE)).to.be.true;
    });

    it('should return true for exact /content/dam path', () => {
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_CONTENT_DAM)).to.be.true;
    });

    it('should return false for valid content dam paths', () => {
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_TEST)).to.be.false;
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_EN_US_IMAGES)).to.be.false;
      expect(AemClientAdapter.isBreakingPoint(TEST_PATH_FOLDER_FILE)).to.be.false;
    });
  });

  describe('parseContentStatus static method', () => {
    it('should return UNKNOWN for null status', () => {
      expect(AemClientAdapter.parseContentStatus(null)).to.equal(STATUS_UNKNOWN);
    });

    it('should return UNKNOWN for undefined status', () => {
      expect(AemClientAdapter.parseContentStatus(undefined)).to.equal(STATUS_UNKNOWN);
    });

    it('should return UNKNOWN for empty string status', () => {
      expect(AemClientAdapter.parseContentStatus('')).to.equal(STATUS_UNKNOWN);
    });

    it('should parse valid statuses case-insensitively', () => {
      expect(AemClientAdapter.parseContentStatus('published')).to.equal(STATUS_PUBLISHED);
      expect(AemClientAdapter.parseContentStatus('PUBLISHED')).to.equal(STATUS_PUBLISHED);
      expect(AemClientAdapter.parseContentStatus('Published')).to.equal(STATUS_PUBLISHED);

      expect(AemClientAdapter.parseContentStatus('modified')).to.equal('MODIFIED');
      expect(AemClientAdapter.parseContentStatus('MODIFIED')).to.equal('MODIFIED');

      expect(AemClientAdapter.parseContentStatus('draft')).to.equal(STATUS_DRAFT);
      expect(AemClientAdapter.parseContentStatus('DRAFT')).to.equal(STATUS_DRAFT);

      expect(AemClientAdapter.parseContentStatus('archived')).to.equal('ARCHIVED');
      expect(AemClientAdapter.parseContentStatus('ARCHIVED')).to.equal('ARCHIVED');

      expect(AemClientAdapter.parseContentStatus('deleted')).to.equal('DELETED');
      expect(AemClientAdapter.parseContentStatus('DELETED')).to.equal('DELETED');
    });

    it('should return UNKNOWN for invalid statuses', () => {
      expect(AemClientAdapter.parseContentStatus('invalid')).to.equal(STATUS_UNKNOWN);
      expect(AemClientAdapter.parseContentStatus('pending')).to.equal(STATUS_UNKNOWN);
      expect(AemClientAdapter.parseContentStatus('123')).to.equal(STATUS_UNKNOWN);
    });
  });

  describe('delay static method', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await AemClientAdapter.delay(DELAY_MS_TEST);
      const end = Date.now();

      expect(end - start).to.be.at.least(DELAY_TOLERANCE_MS); // Allow some tolerance
    });

    it('should handle zero delay', async () => {
      const start = Date.now();
      await AemClientAdapter.delay(DELAY_ZERO);
      const end = Date.now();

      expect(end - start).to.be.lessThan(DELAY_THRESHOLD_MS);
    });
  });

  describe('isAvailable method', () => {
    it('should return true when content is available', async () => {
      mockRequest.resolves({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.true;
      expect(mockRequest).to.have.been.calledOnce;
    });

    it('should return false when request fails', async () => {
      mockRequest.rejects(new Error('Network error'));

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.false;
    });

    it('should return false when no items found', async () => {
      mockRequest.resolves({ items: [] });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.isAvailable(TEST_PATH_IMAGE);

      expect(result).to.be.false;
    });

    it('should return true when multiple items found (folder access)', async () => {
      mockRequest.resolves({
        items: [
          { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
          { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
        ],
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.isAvailable(TEST_PATH_TEST);

      expect(result).to.be.true;
    });

    it('should cache content when cache strategy is provided', async () => {
      mockRequest.resolves({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      await adapter.isAvailable(TEST_PATH_IMAGE);

      expect(mockCache.cacheItems).to.have.been.calledOnce;
      expect(mockCache.cacheItems).to.have.been.calledWith(
        [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        AemClientAdapter.parseContentStatus,
      );
    });
  });

  describe('fetchContent method', () => {
    it('should fetch all pages and return combined results', async () => {
      mockRequest.onCall(0).resolves({
        items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
        cursor: 'cursor-2',
      });
      mockRequest.onCall(1).resolves({
        items: [{ path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT }],
        cursor: null,
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.fetchContent(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(2);
      expect(result[0].path).to.equal(TEST_PATH_IMAGE_1);
      expect(result[1].path).to.equal(TEST_PATH_IMAGE_2);
      expect(mockRequest).to.have.been.calledTwice;
    });

    it('should stop at maximum page limit', async () => {
      mockRequest.resolves({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
        cursor: 'always-has-cursor',
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.fetchContent(TEST_PATH_TEST);

      expect(mockRequest.callCount).to.equal(AemClientAdapter.MAX_PAGES);
      expect(result).to.have.lengthOf(AemClientAdapter.MAX_PAGES);
    });

    it('should handle errors gracefully and return partial results', async () => {
      mockRequest.onCall(0).resolves({
        items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
        cursor: 'cursor-2',
      });
      mockRequest.onCall(1).rejects(new Error('Network error'));

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.fetchContent(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(1);
      expect(result[0].path).to.equal(TEST_PATH_IMAGE_1);
    });

    it('should cache all fetched items when cache strategy is provided', async () => {
      mockRequest.resolves({
        items: [
          { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
          { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
        ],
        cursor: null,
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      await adapter.fetchContent(TEST_PATH_TEST);

      expect(mockCache.cacheItems).to.have.been.calledOnce;
      expect(mockCache.cacheItems).to.have.been.calledWith(
        [
          { path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED },
          { path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT },
        ],
        AemClientAdapter.parseContentStatus,
      );
    });
  });

  describe('getChildrenFromPath method', () => {
    it('should return empty array when cache is not available', async () => {
      const noOpCache = new NoOpCache();
      const adapter = new AemClientAdapter(context, mockBuiltClient, noOpCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should return empty array for breaking point paths', async () => {
      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_CONTENT_DAM);

      expect(result).to.deep.equal([]);
    });

    it('should return cached children when available', async () => {
      const cachedChildren = [{ path: TEST_PATH_CHILD_1 }];
      mockCache.findChildren.returns(cachedChildren);

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.equal(cachedChildren);
      expect(mockCache.findChildren).to.have.been.calledWith(TEST_PATH_TEST);
    });

    it('should fetch content when parent is available but not cached', async () => {
      mockCache.findChildren.onCall(0).returns([]); // No cached children initially
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_CHILD_1 }]); // After fetching

      mockRequest.resolves({
        items: [{ path: TEST_PATH_CHILD_1, status: STATUS_PUBLISHED }],
      });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([{ path: TEST_PATH_CHILD_1 }]);
    });

    it('should traverse up hierarchy when parent is not available', async () => {
      // Setup: first path has no children, second path (parent) has children
      mockCache.findChildren.onCall(0).returns([]); // /content/dam/test/child
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_PARENT_CHILD }]); // /content/dam/parent

      mockPathUtils.getParentPath.returns(TEST_PATH_PARENT);

      // First isAvailable returns false, second returns true
      mockRequest.onCall(0).resolves({ items: [] }); // First isAvailable call
      mockRequest.onCall(1).resolves({
        items: [{ path: TEST_PATH_PARENT_CHILD, status: STATUS_PUBLISHED }],
      }); // Second isAvailable call for parent

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_CHILD);

      expect(mockPathUtils.getParentPath).to.have.been.calledWith(TEST_PATH_CHILD);
      expect(result).to.deep.equal([{ path: TEST_PATH_PARENT_CHILD }]);
    });

    it('should return empty array when no parent path found', async () => {
      mockCache.findChildren.returns([]);
      mockPathUtils.getParentPath.returns(null);

      mockRequest.resolves({ items: [] });

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should handle errors during availability check', async () => {
      mockCache.findChildren.returns([]);
      mockRequest.rejects(new Error('Network error'));

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([]);
    });

    it('should continue with cached data when fetchContent fails', async () => {
      mockCache.findChildren.onCall(0).returns([]); // No cached children initially
      mockCache.findChildren.onCall(EXPECTED_SUGGESTIONS_COUNT_1).returns([{ path: TEST_PATH_CHILD_1 }]); // After failed fetch

      // First request (isAvailable check) succeeds
      mockRequest.onCall(0).resolves({
        items: [{ path: TEST_PATH_CHILD_1, status: STATUS_PUBLISHED }],
      });
      // Second request (fetchContent) fails
      mockRequest.onCall(1).rejects(new Error('Fetch failed'));

      const adapter = new AemClientAdapter(context, mockBuiltClient, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.deep.equal([{ path: TEST_PATH_CHILD_1 }]);
    });
  });

  describe('integration scenarios', () => {
    it('should work end-to-end for available content', async () => {
      mockRequest.resolves({
        items: [{ path: TEST_PATH_IMAGE, status: STATUS_PUBLISHED }],
      });

      const adapter = AemClientAdapter.createFrom(context, mockCache);
      const isAvailable = await adapter.isAvailable(TEST_PATH_IMAGE);

      expect(isAvailable).to.be.true;
      expect(mockRequest).to.have.been.calledWith(
        'GET',
        `/adobe/sites/cf/fragments?path=${encodeURIComponent(TEST_PATH_IMAGE)}&projection=minimal`,
      );
    });

    it('should handle complete pagination workflow', async () => {
      mockRequest.onCall(0).resolves({
        items: [{ path: TEST_PATH_IMAGE_1, status: STATUS_PUBLISHED }],
        cursor: 'cursor-2',
      });
      mockRequest.onCall(1).resolves({
        items: [{ path: TEST_PATH_IMAGE_2, status: STATUS_DRAFT }],
        cursor: null,
      });

      const adapter = AemClientAdapter.createFrom(context, mockCache);
      const result = await adapter.fetchContent(TEST_PATH_TEST);

      expect(result).to.have.lengthOf(2);
      expect(mockRequest).to.have.been.calledTwice;
      expect(mockCache.cacheItems).to.have.been.calledOnce;
    });

    it('should handle complete getChildrenFromPath workflow', async () => {
      const cachedChildren = [{ path: TEST_PATH_CHILD_1 }];
      mockCache.findChildren.returns(cachedChildren);

      const adapter = AemClientAdapter.createFrom(context, mockCache);
      const result = await adapter.getChildrenFromPath(TEST_PATH_TEST);

      expect(result).to.equal(cachedChildren);
    });
  });
});

