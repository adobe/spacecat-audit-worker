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

use(sinonChai);
use(chaiAsPromised);

describe('AemClient', () => {
  let sandbox;
  let context;
  let mockFetch;
  let mockPathIndex;
  let mockContentPath;
  let mockLocale;
  let mockPathUtils;
  let AemClient;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

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
          AEM_AUTHOR_URL: 'https://author.example.com',
          AEM_AUTHOR_TOKEN: 'test-token-123',
        },
      })
      .build();

    mockFetch = sandbox.stub();

    mockPathIndex = {
      insertContentPath: sandbox.stub(),
      findChildren: sandbox.stub().returns([]),
    };

    mockContentPath = sandbox.stub();
    mockLocale = {
      fromPath: sandbox.stub().returns({ code: 'en-us' }),
    };

    mockPathUtils = {
      getParentPath: sandbox.stub().returns('/content/dam/parent'),
    };

    const module = await esmock('../../../src/content-fragment-broken-links/clients/aem-client.js', {
      '@adobe/spacecat-shared-utils': {
        tracingFetch: mockFetch,
      },
      '../../../src/content-fragment-broken-links/domain/content/content-path.js': {
        ContentPath: mockContentPath,
      },
      '../../../src/content-fragment-broken-links/domain/language/locale.js': {
        Locale: mockLocale,
      },
      '../../../src/content-fragment-broken-links/utils/path-utils.js': {
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
      expect(AemClient.MAX_PAGES).to.equal(10);
      expect(AemClient.PAGINATION_DELAY_MS).to.equal(100);
    });
  });

  describe('constructor', () => {
    it('should create client with all parameters', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);

      expect(client.authorUrl).to.equal('https://author.example.com');
      expect(client.authToken).to.equal('token-123');
      expect(client.context).to.equal(context);
      expect(client.pathIndex).to.equal(mockPathIndex);
    });

    it('should create client without pathIndex', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');

      expect(client.authorUrl).to.equal('https://author.example.com');
      expect(client.authToken).to.equal('token-123');
      expect(client.context).to.equal(context);
      expect(client.pathIndex).to.be.null;
    });

    it('should handle null pathIndex explicitly', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123', null);

      expect(client.context).to.equal(context);
      expect(client.pathIndex).to.be.null;
    });
  });

  describe('createFrom static factory method', () => {
    it('should create client from context with environment variables', () => {
      const client = AemClient.createFrom(context, mockPathIndex);

      expect(client.authorUrl).to.equal('https://author.example.com');
      expect(client.authToken).to.equal('test-token-123');
      expect(client.context).to.equal(context);
      expect(client.pathIndex).to.equal(mockPathIndex);
    });

    it('should create client without pathIndex', () => {
      const client = AemClient.createFrom(context);

      expect(client.authorUrl).to.equal('https://author.example.com');
      expect(client.authToken).to.equal('test-token-123');
      expect(client.context).to.equal(context);
      expect(client.pathIndex).to.be.null;
    });

    it('should throw error when AEM_AUTHOR_URL is missing', () => {
      const contextWithoutUrl = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_TOKEN: 'test-token-123',
          },
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutUrl))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when AEM_AUTHOR_TOKEN is missing', () => {
      const contextWithoutToken = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {
            AEM_AUTHOR_URL: 'https://author.example.com',
          },
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutToken))
        .to.throw('AEM Author configuration missing: AEM_AUTHOR_URL and AEM_AUTHOR_TOKEN required');
    });

    it('should throw error when both environment variables are missing', () => {
      const contextWithoutConfig = new MockContextBuilder()
        .withSandbox(sandbox)
        .withOverrides({
          env: {},
        })
        .build();

      expect(() => AemClient.createFrom(contextWithoutConfig))
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
      expect(AemClient.isBreakingPoint('/content')).to.be.true;
      expect(AemClient.isBreakingPoint('/other/path')).to.be.true;
      expect(AemClient.isBreakingPoint('content/dam/test')).to.be.true;
    });

    it('should return true for exact /content/dam path', () => {
      expect(AemClient.isBreakingPoint('/content/dam')).to.be.true;
    });

    it('should return false for valid content dam paths', () => {
      expect(AemClient.isBreakingPoint('/content/dam/test')).to.be.false;
      expect(AemClient.isBreakingPoint('/content/dam/en-us/images')).to.be.false;
      expect(AemClient.isBreakingPoint('/content/dam/folder/subfolder/file.jpg')).to.be.false;
    });
  });

  describe('parseContentStatus static method', () => {
    it('should return UNKNOWN for null status', () => {
      expect(AemClient.parseContentStatus(null)).to.equal('UNKNOWN');
    });

    it('should return UNKNOWN for undefined status', () => {
      expect(AemClient.parseContentStatus(undefined)).to.equal('UNKNOWN');
    });

    it('should return UNKNOWN for empty string status', () => {
      expect(AemClient.parseContentStatus('')).to.equal('UNKNOWN');
    });

    it('should parse valid statuses case-insensitively', () => {
      expect(AemClient.parseContentStatus('published')).to.equal('PUBLISHED');
      expect(AemClient.parseContentStatus('PUBLISHED')).to.equal('PUBLISHED');
      expect(AemClient.parseContentStatus('Published')).to.equal('PUBLISHED');

      expect(AemClient.parseContentStatus('modified')).to.equal('MODIFIED');
      expect(AemClient.parseContentStatus('MODIFIED')).to.equal('MODIFIED');

      expect(AemClient.parseContentStatus('draft')).to.equal('DRAFT');
      expect(AemClient.parseContentStatus('DRAFT')).to.equal('DRAFT');

      expect(AemClient.parseContentStatus('archived')).to.equal('ARCHIVED');
      expect(AemClient.parseContentStatus('ARCHIVED')).to.equal('ARCHIVED');

      expect(AemClient.parseContentStatus('deleted')).to.equal('DELETED');
      expect(AemClient.parseContentStatus('DELETED')).to.equal('DELETED');
    });

    it('should return UNKNOWN for invalid statuses', () => {
      expect(AemClient.parseContentStatus('invalid')).to.equal('UNKNOWN');
      expect(AemClient.parseContentStatus('pending')).to.equal('UNKNOWN');
      expect(AemClient.parseContentStatus('123')).to.equal('UNKNOWN');
    });
  });

  describe('delay static method', () => {
    it('should delay for specified milliseconds', async () => {
      const start = Date.now();
      await AemClient.delay(50);
      const end = Date.now();

      expect(end - start).to.be.at.least(45); // Allow some tolerance
    });

    it('should handle zero delay', async () => {
      const start = Date.now();
      await AemClient.delay(0);
      const end = Date.now();

      expect(end - start).to.be.lessThan(10);
    });
  });

  describe('createUrl method', () => {
    it('should create correct URL with path and projection', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const url = client.createUrl('/content/dam/test/image.jpg');

      expect(url.toString()).to.equal('https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest%2Fimage.jpg&projection=minimal');
    });

    it('should handle paths with special characters', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const url = client.createUrl('/content/dam/test/image with spaces.jpg');

      expect(url.toString()).to.include('image+with+spaces');
    });

    it('should handle authorUrl with trailing slash', () => {
      const client = new AemClient(context, 'https://author.example.com/', 'token-123');
      const url = client.createUrl('/content/dam/test');

      expect(url.toString()).to.equal('https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest&projection=minimal');
    });
  });

  describe('createUrlWithPagination method', () => {
    it('should create URL without cursor when cursor is null', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const url = client.createUrlWithPagination('/content/dam/test', null);

      expect(url.toString()).to.equal('https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest&projection=minimal');
    });

    it('should create URL with cursor when cursor is provided', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const url = client.createUrlWithPagination('/content/dam/test', 'cursor-123');

      expect(url.toString()).to.equal('https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest&projection=minimal&cursor=cursor-123');
    });

    it('should handle empty string cursor', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const url = client.createUrlWithPagination('/content/dam/test', '');

      // Empty string cursor is falsy, so it doesn't get added
      expect(url.toString()).to.equal('https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest&projection=minimal');
    });
  });

  describe('createAuthHeaders method', () => {
    it('should create correct authorization headers', () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const headers = client.createAuthHeaders();

      expect(headers).to.deep.equal({
        Authorization: 'Bearer token-123',
        Accept: 'application/json',
      });
    });

    it('should handle empty token', () => {
      const client = new AemClient(context, 'https://author.example.com', '');
      const headers = client.createAuthHeaders();

      expect(headers).to.deep.equal({
        Authorization: 'Bearer ',
        Accept: 'application/json',
      });
    });
  });

  describe('isAvailable method', () => {
    it('should return true when content is available', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.isAvailable('/content/dam/test/image.jpg');

      expect(result).to.be.true;
      expect(mockFetch).to.have.been.calledOnce;
    });

    it('should return false when response is not ok', async () => {
      const mockResponse = { ok: false };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.isAvailable('/content/dam/test/image.jpg');

      expect(result).to.be.false;
    });

    it('should return false when no items found', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({ items: [] }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.isAvailable('/content/dam/test/image.jpg');

      expect(result).to.be.false;
    });

    // TODO: Need to investigate the wanted behavior: should we return true or false?
    it('should return true when multiple items found (folder access)', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { path: '/content/dam/test/image1.jpg', status: 'PUBLISHED' },
            { path: '/content/dam/test/image2.jpg', status: 'DRAFT' },
          ],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.isAvailable('/content/dam/test');

      expect(result).to.be.true;
    });

    it('should cache content when pathIndex is available', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      await client.isAvailable('/content/dam/test/image.jpg');

      expect(mockContentPath).to.have.been.calledWith(
        '/content/dam/test/image.jpg',
        'PUBLISHED',
        { code: 'en-us' },
      );
      expect(mockPathIndex.insertContentPath).to.have.been.calledOnce;
    });

    it('should not cache when pathIndex is not available', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      await client.isAvailable('/content/dam/test/image.jpg');

      expect(mockContentPath).to.not.have.been.called;
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, 'https://author.example.com', 'token-123');

      await expect(client.isAvailable('/content/dam/test/image.jpg'))
        .to.be.rejectedWith('Failed to check AEM Author availability for /content/dam/test/image.jpg: Network error');
    });

    it('should throw error when JSON parsing fails', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().rejects(new Error('Invalid JSON')),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');

      await expect(client.isAvailable('/content/dam/test/image.jpg'))
        .to.be.rejectedWith('Failed to check AEM Author availability for /content/dam/test/image.jpg: Invalid JSON');
    });
  });

  describe('fetchWithPagination method', () => {
    it('should fetch single page successfully', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
          cursor: null,
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.fetchWithPagination('/content/dam/test');

      expect(result).to.deep.equal({
        items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        cursor: null,
      });
    });

    it('should fetch page with cursor', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
          cursor: 'next-cursor',
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.fetchWithPagination('/content/dam/test', 'current-cursor');

      expect(result).to.deep.equal({
        items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        cursor: 'next-cursor',
      });
    });

    it('should handle empty response', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({}),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.fetchWithPagination('/content/dam/test');

      expect(result).to.deep.equal({
        items: [],
        cursor: null,
      });
    });

    it('should throw error for non-ok response', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');

      await expect(client.fetchWithPagination('/content/dam/test'))
        .to.be.rejectedWith('HTTP 404: Not Found');
    });

    it('should throw error when fetch fails', async () => {
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, 'https://author.example.com', 'token-123');

      await expect(client.fetchWithPagination('/content/dam/test'))
        .to.be.rejectedWith('Network error');
    });
  });

  describe('fetchContentWithPagination method', () => {
    it('should fetch all pages and return combined results', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: '/content/dam/test/image1.jpg', status: 'PUBLISHED' }],
            cursor: 'cursor-2',
          }),
        },
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: '/content/dam/test/image2.jpg', status: 'DRAFT' }],
            cursor: null,
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).resolves(mockResponses[1]);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.fetchContentWithPagination('/content/dam/test');

      expect(result).to.have.lengthOf(2);
      expect(result[0].path).to.equal('/content/dam/test/image1.jpg');
      expect(result[1].path).to.equal('/content/dam/test/image2.jpg');
      expect(mockFetch).to.have.been.calledTwice;
    });

    it('should stop at maximum page limit', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
          cursor: 'always-has-cursor',
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.fetchContentWithPagination('/content/dam/test');

      expect(mockFetch.callCount).to.equal(AemClient.MAX_PAGES);
      expect(result).to.have.lengthOf(AemClient.MAX_PAGES);
    });

    it('should handle errors gracefully and return partial results', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: '/content/dam/test/image1.jpg', status: 'PUBLISHED' }],
            cursor: 'cursor-2',
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).rejects(new Error('Network error'));

      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.fetchContentWithPagination('/content/dam/test');

      expect(result).to.have.lengthOf(1);
      expect(result[0].path).to.equal('/content/dam/test/image1.jpg');
    });

    it('should cache all fetched items when pathIndex is available', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [
            { path: '/content/dam/test/image1.jpg', status: 'PUBLISHED' },
            { path: '/content/dam/test/image2.jpg', status: 'DRAFT' },
          ],
          cursor: null,
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      await client.fetchContentWithPagination('/content/dam/test');

      expect(mockContentPath).to.have.been.calledTwice;
      expect(mockPathIndex.insertContentPath).to.have.been.calledTwice;
    });
  });

  describe('fetchContent method', () => {
    it('should delegate to fetchContentWithPagination', async () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const fetchContentWithPaginationStub = sandbox.stub(client, 'fetchContentWithPagination').resolves([]);

      await client.fetchContent('/content/dam/test');

      expect(fetchContentWithPaginationStub).to.have.been.calledWith('/content/dam/test');
    });

    it('should wrap errors with descriptive message', async () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      sandbox.stub(client, 'fetchContentWithPagination').rejects(new Error('Original error'));

      await expect(client.fetchContent('/content/dam/test'))
        .to.be.rejectedWith('Failed to fetch AEM Author content for /content/dam/test: Original error');
    });
  });

  describe('getChildrenFromPath method', () => {
    it('should return empty array when pathIndex is not available', async () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123');
      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(result).to.deep.equal([]);
    });

    it('should return empty array for breaking point paths', async () => {
      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam');

      expect(result).to.deep.equal([]);
    });

    it('should return cached children when available', async () => {
      const cachedChildren = [{ path: '/content/dam/test/child1.jpg' }];
      mockPathIndex.findChildren.returns(cachedChildren);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(result).to.equal(cachedChildren);
      expect(mockPathIndex.findChildren).to.have.been.calledWith('/content/dam/test');
    });

    it('should fetch content when parent is available but not cached', async () => {
      mockPathIndex.findChildren.onCall(0).returns([]); // No cached children initially
      mockPathIndex.findChildren.onCall(1).returns([{ path: '/content/dam/test/child1.jpg' }]); // After fetching

      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/child1.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const fetchContentStub = sandbox.stub(client, 'fetchContent').resolves();

      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(fetchContentStub).to.have.been.calledWith('/content/dam/test');
      expect(result).to.deep.equal([{ path: '/content/dam/test/child1.jpg' }]);
    });

    it('should traverse up hierarchy when parent is not available', async () => {
      // Setup: first path has no children, second path (parent) has children
      mockPathIndex.findChildren.onCall(0).returns([]); // /content/dam/test/child
      mockPathIndex.findChildren.onCall(1).returns([{ path: '/content/dam/parent/child.jpg' }]); // /content/dam/parent

      mockPathUtils.getParentPath.returns('/content/dam/parent');

      // First fetch fails (path not available), second succeeds (parent available)
      const mockResponse1 = { ok: false };
      const mockResponse2 = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/parent/child.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.onCall(0).resolves(mockResponse1); // First isAvailable call
      mockFetch.onCall(1).resolves(mockResponse2); // Second isAvailable call for parent

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam/test/child');

      expect(mockPathUtils.getParentPath).to.have.been.calledWith('/content/dam/test/child');
      expect(result).to.deep.equal([{ path: '/content/dam/parent/child.jpg' }]);
    });

    it('should return empty array when no parent path found', async () => {
      mockPathIndex.findChildren.returns([]);
      mockPathUtils.getParentPath.returns(null);

      const mockResponse = { ok: false };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(result).to.deep.equal([]);
    });

    it('should handle errors during availability check', async () => {
      mockPathIndex.findChildren.returns([]);
      mockFetch.rejects(new Error('Network error'));

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(result).to.deep.equal([]);
    });

    it('should continue with cached data when fetchContent fails', async () => {
      mockPathIndex.findChildren.onCall(0).returns([]); // No cached children initially
      mockPathIndex.findChildren.onCall(1).returns([{ path: '/content/dam/test/child1.jpg' }]); // After failed fetch

      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/child1.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = new AemClient(context, 'https://author.example.com', 'token-123', mockPathIndex);
      const fetchContentStub = sandbox.stub(client, 'fetchContent').rejects(new Error('Fetch failed'));

      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(fetchContentStub).to.have.been.calledWith('/content/dam/test');
      expect(result).to.deep.equal([{ path: '/content/dam/test/child1.jpg' }]);
    });
  });

  describe('integration scenarios', () => {
    it('should work end-to-end for available content', async () => {
      const mockResponse = {
        ok: true,
        json: sandbox.stub().resolves({
          items: [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }],
        }),
      };
      mockFetch.resolves(mockResponse);

      const client = AemClient.createFrom(context, mockPathIndex);
      const isAvailable = await client.isAvailable('/content/dam/test/image.jpg');

      expect(isAvailable).to.be.true;
      expect(mockFetch).to.have.been.calledWith(
        'https://author.example.com/adobe/sites/cf/fragments?path=%2Fcontent%2Fdam%2Ftest%2Fimage.jpg&projection=minimal',
        {
          headers: {
            Authorization: 'Bearer test-token-123',
            Accept: 'application/json',
          },
        },
      );
    });

    it('should handle complete pagination workflow', async () => {
      const mockResponses = [
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: '/content/dam/test/image1.jpg', status: 'PUBLISHED' }],
            cursor: 'cursor-2',
          }),
        },
        {
          ok: true,
          json: sandbox.stub().resolves({
            items: [{ path: '/content/dam/test/image2.jpg', status: 'DRAFT' }],
            cursor: null,
          }),
        },
      ];
      mockFetch.onCall(0).resolves(mockResponses[0]);
      mockFetch.onCall(1).resolves(mockResponses[1]);

      const client = AemClient.createFrom(context, mockPathIndex);
      const result = await client.fetchContent('/content/dam/test');

      expect(result).to.have.lengthOf(2);
      expect(mockFetch).to.have.been.calledTwice;
      expect(mockContentPath).to.have.been.calledTwice;
      expect(mockPathIndex.insertContentPath).to.have.been.calledTwice;
    });

    it('should handle complete getChildrenFromPath workflow', async () => {
      const cachedChildren = [{ path: '/content/dam/test/child1.jpg' }];
      mockPathIndex.findChildren.returns(cachedChildren);

      const client = AemClient.createFrom(context, mockPathIndex);
      const result = await client.getChildrenFromPath('/content/dam/test');

      expect(result).to.equal(cachedChildren);
      expect(context.log.debug).to.have.been.calledWith('Getting children paths from parent: /content/dam/test');
      expect(context.log.debug).to.have.been.calledWith('Found 1 children in cache for parent: /content/dam/test');
    });
  });
});
