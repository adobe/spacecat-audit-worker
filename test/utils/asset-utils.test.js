/*
 * Copyright 2024 Adobe. All rights reserved.
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
import {
  isAssetUrl,
  isAssetCategory,
  filterAssetUrls,
  getAllAssetExtensions,
  getAssetExtensionsByCategory,
} from '../../src/utils/asset-utils.js';

describe('asset-utils', () => {
  describe('isAssetUrl', () => {
    describe('image assets', () => {
      it('should return true for common image formats', () => {
        expect(isAssetUrl('/content/dam/image.jpg')).to.be.true;
        expect(isAssetUrl('/content/dam/image.jpeg')).to.be.true;
        expect(isAssetUrl('/content/dam/image.png')).to.be.true;
        expect(isAssetUrl('/content/dam/image.gif')).to.be.true;
        expect(isAssetUrl('/content/dam/image.svg')).to.be.true;
        expect(isAssetUrl('/content/dam/image.webp')).to.be.true;
        expect(isAssetUrl('/content/dam/image.ico')).to.be.true;
        expect(isAssetUrl('/content/dam/image.bmp')).to.be.true;
      });

      it('should be case insensitive', () => {
        expect(isAssetUrl('/content/dam/IMAGE.JPG')).to.be.true;
        expect(isAssetUrl('/content/dam/Image.PNG')).to.be.true;
        expect(isAssetUrl('/content/dam/photo.JpEg')).to.be.true;
      });
    });

    describe('document assets', () => {
      it('should return true for document formats', () => {
        expect(isAssetUrl('/content/dam/doc.pdf')).to.be.true;
        expect(isAssetUrl('/content/dam/doc.doc')).to.be.true;
        expect(isAssetUrl('/content/dam/doc.docx')).to.be.true;
        expect(isAssetUrl('/content/dam/spreadsheet.xls')).to.be.true;
        expect(isAssetUrl('/content/dam/spreadsheet.xlsx')).to.be.true;
        expect(isAssetUrl('/content/dam/presentation.ppt')).to.be.true;
        expect(isAssetUrl('/content/dam/presentation.pptx')).to.be.true;
      });
    });

    describe('media assets', () => {
      it('should return true for video formats', () => {
        expect(isAssetUrl('/content/dam/video.mp4')).to.be.true;
        expect(isAssetUrl('/content/dam/video.avi')).to.be.true;
        expect(isAssetUrl('/content/dam/video.mov')).to.be.true;
        expect(isAssetUrl('/content/dam/video.wmv')).to.be.true;
        expect(isAssetUrl('/content/dam/video.flv')).to.be.true;
        expect(isAssetUrl('/content/dam/video.webm')).to.be.true;
      });

      it('should return true for audio formats', () => {
        expect(isAssetUrl('/content/dam/audio.mp3')).to.be.true;
        expect(isAssetUrl('/content/dam/audio.wav')).to.be.true;
        expect(isAssetUrl('/content/dam/audio.ogg')).to.be.true;
        expect(isAssetUrl('/content/dam/audio.m4a')).to.be.true;
      });
    });

    describe('archive assets', () => {
      it('should return true for archive formats', () => {
        expect(isAssetUrl('/content/dam/file.zip')).to.be.true;
        expect(isAssetUrl('/content/dam/file.rar')).to.be.true;
        expect(isAssetUrl('/content/dam/file.tar')).to.be.true;
        expect(isAssetUrl('/content/dam/file.gz')).to.be.true;
        expect(isAssetUrl('/content/dam/file.7z')).to.be.true;
        expect(isAssetUrl('/content/dam/file.bz2')).to.be.true;
      });
    });

    describe('font assets', () => {
      it('should return true for font formats', () => {
        expect(isAssetUrl('/content/dam/font.woff')).to.be.true;
        expect(isAssetUrl('/content/dam/font.woff2')).to.be.true;
        expect(isAssetUrl('/content/dam/font.ttf')).to.be.true;
        expect(isAssetUrl('/content/dam/font.eot')).to.be.true;
        expect(isAssetUrl('/content/dam/font.otf')).to.be.true;
      });
    });

    describe('non-asset URLs', () => {
      it('should return false for content fragment paths', () => {
        expect(isAssetUrl('/content/dam/my-site/fragments/article')).to.be.false;
        expect(isAssetUrl('/content/dam/fragments/product-details')).to.be.false;
        expect(isAssetUrl('/content/experience-fragments/site/header')).to.be.false;
      });

      it('should return false for HTML pages', () => {
        expect(isAssetUrl('/content/site/en/page')).to.be.false;
        expect(isAssetUrl('/en/products/category')).to.be.false;
        expect(isAssetUrl('/about-us')).to.be.false;
      });

      it('should return false for paths with query parameters', () => {
        expect(isAssetUrl('/content/page?param=value')).to.be.false;
        expect(isAssetUrl('/api/endpoint')).to.be.false;
      });
    });

    describe('edge cases', () => {
      it('should handle null or undefined input', () => {
        expect(isAssetUrl(null)).to.be.false;
        expect(isAssetUrl(undefined)).to.be.false;
      });

      it('should handle empty string', () => {
        expect(isAssetUrl('')).to.be.false;
      });

      it('should handle non-string input', () => {
        expect(isAssetUrl(123)).to.be.false;
        expect(isAssetUrl({})).to.be.false;
        expect(isAssetUrl([])).to.be.false;
      });

      it('should handle URLs with extensions in path but not at end', () => {
        expect(isAssetUrl('/content/image.jpg/metadata')).to.be.false;
        expect(isAssetUrl('/content/pdf.viewer/document')).to.be.false;
      });

      it('should handle full URLs with protocol', () => {
        expect(isAssetUrl('https://example.com/assets/image.png')).to.be.true;
        expect(isAssetUrl('http://example.com/content/page')).to.be.false;
      });
    });

    describe('custom extensions', () => {
      it('should accept custom extension list', () => {
        const customExtensions = ['.custom', '.special'];
        expect(isAssetUrl('/file.custom', customExtensions)).to.be.true;
        expect(isAssetUrl('/file.special', customExtensions)).to.be.true;
        expect(isAssetUrl('/file.jpg', customExtensions)).to.be.false;
      });
    });
  });

  describe('isAssetCategory', () => {
    it('should correctly identify image category', () => {
      expect(isAssetCategory('/content/image.jpg', 'images')).to.be.true;
      expect(isAssetCategory('/content/image.png', 'images')).to.be.true;
      expect(isAssetCategory('/content/doc.pdf', 'images')).to.be.false;
    });

    it('should correctly identify documents category', () => {
      expect(isAssetCategory('/content/doc.pdf', 'documents')).to.be.true;
      expect(isAssetCategory('/content/doc.docx', 'documents')).to.be.true;
      expect(isAssetCategory('/content/image.jpg', 'documents')).to.be.false;
    });

    it('should correctly identify media category', () => {
      expect(isAssetCategory('/content/video.mp4', 'media')).to.be.true;
      expect(isAssetCategory('/content/audio.mp3', 'media')).to.be.true;
      expect(isAssetCategory('/content/image.jpg', 'media')).to.be.false;
    });

    it('should correctly identify archives category', () => {
      expect(isAssetCategory('/content/file.zip', 'archives')).to.be.true;
      expect(isAssetCategory('/content/file.tar', 'archives')).to.be.true;
      expect(isAssetCategory('/content/image.jpg', 'archives')).to.be.false;
    });

    it('should correctly identify fonts category', () => {
      expect(isAssetCategory('/content/font.woff', 'fonts')).to.be.true;
      expect(isAssetCategory('/content/font.ttf', 'fonts')).to.be.true;
      expect(isAssetCategory('/content/image.jpg', 'fonts')).to.be.false;
    });

    it('should throw error for unknown category', () => {
      expect(() => isAssetCategory('/content/file.jpg', 'unknown'))
        .to.throw('Unknown asset category: unknown');
    });

    it('should include valid categories in error message', () => {
      try {
        isAssetCategory('/content/file.jpg', 'invalid');
      } catch (error) {
        expect(error.message).to.include('images');
        expect(error.message).to.include('documents');
        expect(error.message).to.include('media');
        expect(error.message).to.include('archives');
        expect(error.message).to.include('fonts');
      }
    });
  });

  describe('filterAssetUrls', () => {
    it('should filter out asset URLs from array', () => {
      const urls = [
        '/content/page',
        '/content/image.jpg',
        '/content/fragment',
        '/content/doc.pdf',
        '/content/another-page',
      ];

      const filtered = filterAssetUrls(urls);

      expect(filtered).to.deep.equal([
        '/content/page',
        '/content/fragment',
        '/content/another-page',
      ]);
    });

    it('should handle empty array', () => {
      expect(filterAssetUrls([])).to.deep.equal([]);
    });

    it('should handle array with only assets', () => {
      const urls = [
        '/content/image.jpg',
        '/content/doc.pdf',
        '/content/video.mp4',
      ];

      expect(filterAssetUrls(urls)).to.deep.equal([]);
    });

    it('should handle array with no assets', () => {
      const urls = [
        '/content/page1',
        '/content/page2',
        '/content/fragment',
      ];

      expect(filterAssetUrls(urls)).to.deep.equal(urls);
    });

    it('should work with custom extension list', () => {
      const urls = [
        '/file.custom',
        '/file.txt',
        '/file.jpg',
      ];
      const customExtensions = ['.custom'];

      const filtered = filterAssetUrls(urls, customExtensions);

      expect(filtered).to.deep.equal([
        '/file.txt',
        '/file.jpg',
      ]);
    });
  });

  describe('getAllAssetExtensions', () => {
    it('should return array of all extensions', () => {
      const extensions = getAllAssetExtensions();

      expect(extensions).to.be.an('array');
      expect(extensions.length).to.be.greaterThan(0);
    });

    it('should include extensions from all categories', () => {
      const extensions = getAllAssetExtensions();

      expect(extensions).to.include('.jpg');
      expect(extensions).to.include('.pdf');
      expect(extensions).to.include('.mp4');
      expect(extensions).to.include('.zip');
      expect(extensions).to.include('.woff');
    });

    it('should return a copy of the array', () => {
      const extensions1 = getAllAssetExtensions();
      const extensions2 = getAllAssetExtensions();

      expect(extensions1).to.not.equal(extensions2);
      expect(extensions1).to.deep.equal(extensions2);
    });

    it('should not allow mutation of internal state', () => {
      const extensions = getAllAssetExtensions();
      extensions.push('.malicious');

      const newExtensions = getAllAssetExtensions();
      expect(newExtensions).to.not.include('.malicious');
    });
  });

  describe('getAssetExtensionsByCategory', () => {
    it('should return object with all categories', () => {
      const categories = getAssetExtensionsByCategory();

      expect(categories).to.be.an('object');
      expect(categories).to.have.property('images');
      expect(categories).to.have.property('documents');
      expect(categories).to.have.property('media');
      expect(categories).to.have.property('archives');
      expect(categories).to.have.property('fonts');
    });

    it('should have arrays for each category', () => {
      const categories = getAssetExtensionsByCategory();

      expect(categories.images).to.be.an('array');
      expect(categories.documents).to.be.an('array');
      expect(categories.media).to.be.an('array');
      expect(categories.archives).to.be.an('array');
      expect(categories.fonts).to.be.an('array');
    });

    it('should return a copy of the object', () => {
      const categories1 = getAssetExtensionsByCategory();
      const categories2 = getAssetExtensionsByCategory();

      expect(categories1).to.not.equal(categories2);
      expect(categories1).to.deep.equal(categories2);
    });

    it('should not allow mutation of internal state', () => {
      const categories = getAssetExtensionsByCategory();
      categories.malicious = ['.bad'];

      const newCategories = getAssetExtensionsByCategory();
      expect(newCategories).to.not.have.property('malicious');
    });

    it('should include expected extensions in each category', () => {
      const categories = getAssetExtensionsByCategory();

      expect(categories.images).to.include('.jpg');
      expect(categories.images).to.include('.png');
      expect(categories.documents).to.include('.pdf');
      expect(categories.documents).to.include('.docx');
      expect(categories.media).to.include('.mp4');
      expect(categories.media).to.include('.mp3');
      expect(categories.archives).to.include('.zip');
      expect(categories.fonts).to.include('.woff');
    });
  });
});
