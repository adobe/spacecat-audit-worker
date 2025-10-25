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
import { MockContextBuilder } from '../../shared.js';
import { PathIndex } from '../../../src/content-fragment-broken-links/domain/index/path-index.js';
import { ContentPath } from '../../../src/content-fragment-broken-links/domain/content/content-path.js';

use(sinonChai);

describe('PathIndex', () => {
  let sandbox;
  let mockContext;
  let pathIndex;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockContext = new MockContextBuilder()
      .withSandbox(sandbox)
      .build();

    pathIndex = new PathIndex(mockContext);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('constructor', () => {
    it('should create PathIndex with context', () => {
      expect(pathIndex.context).to.equal(mockContext);
      expect(pathIndex.root).to.not.be.null;
    });
  });

  describe('insert', () => {
    it('should insert content path with status and locale', () => {
      const insertSpy = sandbox.spy(pathIndex, 'insertContentPath');
      pathIndex.insert('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');

      expect(insertSpy).to.have.been.calledOnce;
      const callArgs = insertSpy.firstCall.args[0];
      expect(callArgs).to.be.instanceOf(ContentPath);
      expect(callArgs.path).to.equal('/content/dam/en-US/images/photo.jpg');
      expect(callArgs.status).to.equal('PUBLISHED');
      expect(callArgs.locale).to.equal('en-US');
    });
  });

  describe('insertContentPath', () => {
    it('should insert valid content path', () => {
      const contentPath = new ContentPath('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insertContentPath(contentPath);

      expect(pathIndex.contains('/content/dam/en-US/images/photo.jpg')).to.be.true;
    });

    it('should not insert invalid content path', () => {
      const invalidContentPath = new ContentPath('', 'PUBLISHED', 'en-US');
      pathIndex.insertContentPath(invalidContentPath);

      expect(pathIndex.contains('')).to.be.false;
    });

    it('should handle duplicate insertion gracefully', () => {
      const contentPath = new ContentPath('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insertContentPath(contentPath);
      pathIndex.insertContentPath(contentPath);

      expect(pathIndex.contains('/content/dam/en-US/images/photo.jpg')).to.be.true;
    });
  });

  describe('contains', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/fr-FR/images/photo.jpg', 'PUBLISHED', 'fr-FR');
    });

    it('should return false for null path', () => {
      expect(pathIndex.contains(null)).to.be.false;
    });

    it('should return false for empty path', () => {
      expect(pathIndex.contains('')).to.be.false;
    });

    it('should return true for existing path', () => {
      expect(pathIndex.contains('/content/dam/en-US/images/photo.jpg')).to.be.true;
      expect(pathIndex.contains('/content/dam/fr-FR/images/photo.jpg')).to.be.true;
    });

    it('should return false for non-existing path', () => {
      expect(pathIndex.contains('/content/dam/de-DE/images/photo.jpg')).to.be.false;
    });

    it('should return false for partial path', () => {
      expect(pathIndex.contains('/content/dam/en-US/images')).to.be.false;
    });
  });

  describe('find', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/fr-FR/images/photo.jpg', 'MODIFIED', 'fr-FR');
    });

    it('should return null for null path', () => {
      expect(pathIndex.find(null)).to.be.null;
    });

    it('should return null for empty path', () => {
      expect(pathIndex.find('')).to.be.null;
    });

    it('should return content path for existing path', () => {
      const result = pathIndex.find('/content/dam/en-US/images/photo.jpg');
      expect(result).to.be.instanceOf(ContentPath);
      expect(result.path).to.equal('/content/dam/en-US/images/photo.jpg');
      expect(result.status).to.equal('PUBLISHED');
      expect(result.locale).to.equal('en-US');
    });

    it('should return null for non-existing path', () => {
      expect(pathIndex.find('/content/dam/de-DE/images/photo.jpg')).to.be.null;
    });

    it('should return null for prefix that exists but is not an end node', () => {
      pathIndex.insert('/content/dam/test/image.jpg', 'PUBLISHED', 'en-US');

      // Try to find a prefix that exists in the trie but is not marked as an end node
      expect(pathIndex.find('/content/dam/test')).to.be.null;
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo.jpg', 'PUBLISHED', 'en-US');
    });

    it('should return false for null path', () => {
      expect(pathIndex.delete(null)).to.be.false;
    });

    it('should return false for empty path', () => {
      expect(pathIndex.delete('')).to.be.false;
    });

    it('should return false for non-existing path', () => {
      expect(pathIndex.delete('/content/dam/fr-FR/images/photo.jpg')).to.be.false;
    });

    it('should delete existing path and return true', () => {
      expect(pathIndex.contains('/content/dam/en-US/images/photo.jpg')).to.be.true;
      expect(pathIndex.delete('/content/dam/en-US/images/photo.jpg')).to.be.true;
      expect(pathIndex.contains('/content/dam/en-US/images/photo.jpg')).to.be.false;
    });

    it('should return false when trying to delete a prefix that exists but is not an end node', () => {
      pathIndex.insert('/content/dam/test/image.jpg', 'PUBLISHED', 'en-US');

      // Try to delete a prefix that exists in the trie but is not marked as an end node
      expect(pathIndex.delete('/content/dam/test')).to.be.false;
      // The original path should still exist
      expect(pathIndex.contains('/content/dam/test/image.jpg')).to.be.true;
    });
  });

  describe('findChildren', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo1.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/en-US/images/photo2.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/en-US/images/subfolder/photo3.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/fr-FR/images/photo1.jpg', 'PUBLISHED', 'fr-FR');
    });

    it('should find direct children of parent path', () => {
      const children = pathIndex.findChildren('/content/dam/en-US/images');
      expect(children).to.have.length(2);
      expect(children[0].path).to.equal('/content/dam/en-US/images/photo1.jpg');
      expect(children[1].path).to.equal('/content/dam/en-US/images/photo2.jpg');
    });

    it('should not include nested children', () => {
      const children = pathIndex.findChildren('/content/dam/en-US/images');
      const childPaths = children.map((child) => child.path);
      expect(childPaths).to.not.include('/content/dam/en-US/images/subfolder/photo3.jpg');
    });

    it('should return empty array for non-existing parent', () => {
      const children = pathIndex.findChildren('/content/dam/de-DE/images');
      expect(children).to.deep.equal([]);
    });
  });

  describe('findPathsWithPrefix', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo1.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/en-US/images/photo2.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/en-US/images/subfolder/photo3.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/fr-FR/images/photo1.jpg', 'PUBLISHED', 'fr-FR');
    });

    it('should find all paths with given prefix', () => {
      const paths = pathIndex.findPathsWithPrefix('/content/dam/en-US/images');
      expect(paths).to.have.length(3);
      const pathStrings = paths.map((p) => p.path);
      expect(pathStrings).to.include('/content/dam/en-US/images/photo1.jpg');
      expect(pathStrings).to.include('/content/dam/en-US/images/photo2.jpg');
      expect(pathStrings).to.include('/content/dam/en-US/images/subfolder/photo3.jpg');
    });

    it('should return empty array for non-existing prefix', () => {
      const paths = pathIndex.findPathsWithPrefix('/content/dam/de-DE');
      expect(paths).to.deep.equal([]);
    });

    it('should return all paths for empty prefix', () => {
      const paths = pathIndex.findPathsWithPrefix('');
      expect(paths).to.have.length(4);
    });

    it('should return all paths for null prefix', () => {
      const paths = pathIndex.findPathsWithPrefix(null);
      expect(paths).to.have.length(4);
    });
  });

  describe('getPaths', () => {
    beforeEach(() => {
      pathIndex.insert('/content/dam/en-US/images/photo1.jpg', 'PUBLISHED', 'en-US');
      pathIndex.insert('/content/dam/fr-FR/images/photo1.jpg', 'PUBLISHED', 'fr-FR');
    });

    it('should return all paths in the index', () => {
      const paths = pathIndex.getPaths();
      expect(paths).to.have.length(2);
      const pathStrings = paths.map((p) => p.path);
      expect(pathStrings).to.include('/content/dam/en-US/images/photo1.jpg');
      expect(pathStrings).to.include('/content/dam/fr-FR/images/photo1.jpg');
    });

    it('should return empty array for empty index', () => {
      const emptyIndex = new PathIndex(mockContext);
      const paths = emptyIndex.getPaths();
      expect(paths).to.deep.equal([]);
    });
  });
});
