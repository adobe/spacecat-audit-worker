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
import { CacheStrategy } from '../../../src/content-fragment-broken-links/cache/cache-strategy.js';
import { NoOpCache } from '../../../src/content-fragment-broken-links/cache/noop-cache.js';
import { PathIndexCache } from '../../../src/content-fragment-broken-links/cache/path-index-cache.js';

describe('Cache Strategy', () => {
  describe('CacheStrategy (Base Class)', () => {
    it('should throw error when findChildren is not implemented', () => {
      const strategy = new CacheStrategy();
      expect(() => strategy.findChildren('/some/path')).to.throw('findChildren() must be implemented by subclass');
    });

    it('should throw error when cacheItems is not implemented', () => {
      const strategy = new CacheStrategy();
      expect(() => strategy.cacheItems([], () => {})).to.throw('cacheItems() must be implemented by subclass');
    });

    it('should throw error when isAvailable is not implemented', () => {
      const strategy = new CacheStrategy();
      expect(() => strategy.isAvailable()).to.throw('isAvailable() must be implemented by subclass');
    });
  });

  describe('NoOpCache', () => {
    let cache;

    beforeEach(() => {
      cache = new NoOpCache();
    });

    it('should return empty array for findChildren', () => {
      const result = cache.findChildren('/content/dam/test');
      expect(result).to.deep.equal([]);
    });

    it('should not throw when cacheItems is called', () => {
      const items = [{ path: '/content/dam/test/image.jpg', status: 'PUBLISHED' }];
      const statusParser = sinon.stub().returns('PUBLISHED');
      
      expect(() => cache.cacheItems(items, statusParser)).to.not.throw();
    });

    it('should return false for isAvailable', () => {
      expect(cache.isAvailable()).to.be.false;
    });
  });

  describe('PathIndexCache', () => {
    let mockPathIndex;
    let cache;

    beforeEach(() => {
      mockPathIndex = {
        insertContentPath: sinon.stub(),
        findChildren: sinon.stub(),
      };
      cache = new PathIndexCache(mockPathIndex);
    });

    describe('findChildren', () => {
      it('should delegate to pathIndex.findChildren', () => {
        const expectedChildren = [{ path: '/content/dam/test/child1.jpg' }];
        mockPathIndex.findChildren.returns(expectedChildren);

        const result = cache.findChildren('/content/dam/test');

        expect(result).to.equal(expectedChildren);
        expect(mockPathIndex.findChildren).to.have.been.calledWith('/content/dam/test');
      });

      it('should handle empty children array', () => {
        mockPathIndex.findChildren.returns([]);

        const result = cache.findChildren('/content/dam/test');

        expect(result).to.deep.equal([]);
      });
    });

    describe('cacheItems', () => {
      it('should cache items by creating ContentPath and inserting into pathIndex', () => {
        const items = [
          { path: '/content/dam/en-us/test/image1.jpg', status: 'PUBLISHED' },
          { path: '/content/dam/en-us/test/image2.jpg', status: 'DRAFT' },
        ];
        const statusParser = (status) => status.toUpperCase();

        cache.cacheItems(items, statusParser);

        expect(mockPathIndex.insertContentPath).to.have.been.calledTwice;
      });

      it('should handle empty items array', () => {
        cache.cacheItems([], (status) => status);

        expect(mockPathIndex.insertContentPath).to.not.have.been.called;
      });

      it('should handle null items', () => {
        cache.cacheItems(null, (status) => status);

        expect(mockPathIndex.insertContentPath).to.not.have.been.called;
      });

      it('should handle undefined items', () => {
        cache.cacheItems(undefined, (status) => status);

        expect(mockPathIndex.insertContentPath).to.not.have.been.called;
      });

      it('should parse status using provided statusParser', () => {
        const items = [
          { path: '/content/dam/test/image.jpg', status: 'published' },
        ];
        const statusParser = sinon.stub().returns('PUBLISHED');

        cache.cacheItems(items, statusParser);

        expect(statusParser).to.have.been.calledWith('published');
        expect(mockPathIndex.insertContentPath).to.have.been.calledOnce;
      });
    });

    describe('isAvailable', () => {
      it('should return true', () => {
        expect(cache.isAvailable()).to.be.true;
      });
    });
  });
});

