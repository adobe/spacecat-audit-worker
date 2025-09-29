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
import { PathUtils } from '../../../src/content-fragment-broken-links/utils/path-utils.js';

describe('PathUtils', () => {
  describe('removeLocaleFromPath', () => {
    it('should return original path for null or empty input', () => {
      expect(PathUtils.removeLocaleFromPath(null)).to.equal(null);
      expect(PathUtils.removeLocaleFromPath('')).to.equal('');
      expect(PathUtils.removeLocaleFromPath(undefined)).to.equal(undefined);
    });

    it('should remove 2-letter locale from path', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/US/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeLocaleFromPath('/content/dam/fr/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
    });

    it('should remove 5-letter locale from path', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/en-US/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeLocaleFromPath('/content/dam/fr_FR/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
    });

    it('should remove multiple locales from path', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/en-US/US/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
    });

    it('should not remove non-locale segments', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeLocaleFromPath('/content/dam/123/images/photo.jpg'))
        .to.equal('/content/dam/123/images/photo.jpg');
    });

    it('should handle paths with no locales', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeLocaleFromPath('/content/dam/'))
        .to.equal('/content/dam/');
    });

    it('should return null for paths not starting with /content/dam/', () => {
      expect(PathUtils.removeLocaleFromPath('/')).to.equal('/');
      expect(PathUtils.removeLocaleFromPath('/en-US')).to.equal('/en-US');
    });
  });

  describe('getParentPath', () => {
    it('should return null for root paths', () => {
      expect(PathUtils.getParentPath('/')).to.be.null;
      expect(PathUtils.getParentPath('/content')).to.be.null;
      expect(PathUtils.getParentPath('/content/dam')).to.be.null;
    });

    it('should return parent path for valid paths', () => {
      expect(PathUtils.getParentPath('/content/dam/en-US'))
        .to.equal('/content/dam');
      expect(PathUtils.getParentPath('/content/dam/en-US/images'))
        .to.equal('/content/dam/en-US');
      expect(PathUtils.getParentPath('/content/dam/en-US/images/photo.jpg'))
        .to.equal('/content/dam/en-US/images');
    });

    it('should return null for segment not starting with /content/dam/', () => {
      expect(PathUtils.getParentPath('en-US')).to.be.null;
      expect(PathUtils.getParentPath('/en-US')).to.be.null;
    });

    it('should handle null or empty input', () => {
      expect(PathUtils.getParentPath(null)).to.be.null;
      expect(PathUtils.getParentPath('')).to.be.null;
      expect(PathUtils.getParentPath(undefined)).to.be.null;
    });

    it('should handle paths with trailing slash', () => {
      expect(PathUtils.getParentPath('/content/dam/en-US/'))
        .to.equal('/content/dam');
    });
  });

  describe('hasDoubleSlashes', () => {
    it('should return false for null or empty input', () => {
      expect(PathUtils.hasDoubleSlashes(null)).to.be.false;
      expect(PathUtils.hasDoubleSlashes('')).to.be.false;
      expect(PathUtils.hasDoubleSlashes(undefined)).to.be.false;
    });

    it('should return true for paths with double slashes', () => {
      expect(PathUtils.hasDoubleSlashes('/content/dam//images/photo.jpg')).to.be.true;
      expect(PathUtils.hasDoubleSlashes('/content//dam/images/photo.jpg')).to.be.true;
      expect(PathUtils.hasDoubleSlashes('/content/dam/images//photo.jpg')).to.be.true;
    });

    it('should return true for paths with multiple consecutive slashes', () => {
      expect(PathUtils.hasDoubleSlashes('/content/dam///images/photo.jpg')).to.be.true;
      expect(PathUtils.hasDoubleSlashes('/content////dam/images/photo.jpg')).to.be.true;
    });

    it('should return false for paths without double slashes', () => {
      expect(PathUtils.hasDoubleSlashes('/content/dam/images/photo.jpg')).to.be.false;
      expect(PathUtils.hasDoubleSlashes('/content/dam/')).to.be.false;
      expect(PathUtils.hasDoubleSlashes('/')).to.be.false;
    });

    it('should ignore protocol slashes (http://, https://)', () => {
      expect(PathUtils.hasDoubleSlashes('http://example.com/path')).to.be.false;
      expect(PathUtils.hasDoubleSlashes('https://example.com/path')).to.be.false;
      expect(PathUtils.hasDoubleSlashes('ftp://example.com/path')).to.be.false;
    });

    it('should detect double slashes after protocol', () => {
      expect(PathUtils.hasDoubleSlashes('http://example.com//path')).to.be.true;
      expect(PathUtils.hasDoubleSlashes('https://example.com/path//file')).to.be.true;
    });
  });

  describe('removeDoubleSlashes', () => {
    it('should return original input for null or empty', () => {
      expect(PathUtils.removeDoubleSlashes(null)).to.equal(null);
      expect(PathUtils.removeDoubleSlashes('')).to.equal('');
      expect(PathUtils.removeDoubleSlashes(undefined)).to.equal(undefined);
    });

    it('should remove double slashes from paths', () => {
      expect(PathUtils.removeDoubleSlashes('/content/dam//images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeDoubleSlashes('/content//dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeDoubleSlashes('/content/dam/images//photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
    });

    it('should remove multiple consecutive slashes', () => {
      expect(PathUtils.removeDoubleSlashes('/content/dam///images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeDoubleSlashes('/content////dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeDoubleSlashes('//////content/dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
    });

    it('should preserve protocol slashes', () => {
      expect(PathUtils.removeDoubleSlashes('http://example.com/path'))
        .to.equal('http://example.com/path');
      expect(PathUtils.removeDoubleSlashes('https://example.com/path'))
        .to.equal('https://example.com/path');
      expect(PathUtils.removeDoubleSlashes('ftp://example.com/path'))
        .to.equal('ftp://example.com/path');
    });

    it('should fix double slashes after protocol while preserving protocol', () => {
      expect(PathUtils.removeDoubleSlashes('http://example.com//path'))
        .to.equal('http://example.com/path');
      expect(PathUtils.removeDoubleSlashes('https://example.com///path//file'))
        .to.equal('https://example.com/path/file');
    });

    it('should handle paths without double slashes', () => {
      expect(PathUtils.removeDoubleSlashes('/content/dam/images/photo.jpg'))
        .to.equal('/content/dam/images/photo.jpg');
      expect(PathUtils.removeDoubleSlashes('/content/dam/'))
        .to.equal('/content/dam/');
      expect(PathUtils.removeDoubleSlashes('/'))
        .to.equal('/');
    });

    it('should handle complex mixed scenarios', () => {
      expect(PathUtils.removeDoubleSlashes('https://example.com///content//dam///images//photo.jpg'))
        .to.equal('https://example.com/content/dam/images/photo.jpg');
    });
  });

  describe('removeLocaleFromPath edge cases', () => {
    it('should preserve trailing slash when no locale is found', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/images/'))
        .to.equal('/content/dam/images/');
      expect(PathUtils.removeLocaleFromPath('/content/dam/123/'))
        .to.equal('/content/dam/123/');
    });

    it('should remove trailing slash when locale is found', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/en-US/'))
        .to.equal('/content/dam');
    });

    it('should handle edge case with just /content/dam/', () => {
      expect(PathUtils.removeLocaleFromPath('/content/dam/'))
        .to.equal('/content/dam/');
    });
  });
});
