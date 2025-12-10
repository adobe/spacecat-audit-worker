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
import { checkWrongFileType } from '../../../../src/image-optimization/checkers/file-type-checker.js';

describe('File Type Checker', () => {
  describe('checkWrongFileType', () => {
    it('should return null for JPEG photos', () => {
      const imageData = {
        src: 'https://example.com/photo.jpg',
        format: 'jpeg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 300000,
        alt: 'Beautiful landscape photo',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.be.null;
    });

    it('should return null for PNG graphics with small size', () => {
      const imageData = {
        src: 'https://example.com/icon.png',
        format: 'png',
        naturalWidth: 64,
        naturalHeight: 64,
        fileSize: 5000,
        alt: 'icon',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.be.null;
    });

    it('should detect PNG used for large photo', () => {
      const imageData = {
        src: 'https://example.com/landscape.png',
        format: 'png',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 800000,
        alt: 'Mountain landscape',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('wrong-file-type');
      expect(result.currentFormat).to.equal('png');
      expect(result.recommendedFormat).to.include('jpeg');
      expect(result.severity).to.equal('medium');
    });

    it('should mark high impact for very large PNG photos', () => {
      const imageData = {
        src: 'https://example.com/photo.png',
        format: 'png',
        naturalWidth: 2048,
        naturalHeight: 1536,
        fileSize: 1500000,
        alt: 'Photo',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
      expect(result.estimatedSavings).to.be.greaterThan(0);
    });

    it('should detect JPEG used for icon based on size', () => {
      const imageData = {
        src: 'https://example.com/icon.jpg',
        format: 'jpeg',
        naturalWidth: 48,
        naturalHeight: 48,
        fileSize: 10000,
        alt: 'menu icon',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
      expect(result.currentFormat).to.equal('jpeg');
      expect(result.recommendedFormat).to.include('png');
      expect(result.severity).to.equal('low');
    });

    it('should detect JPEG used for logo based on alt text', () => {
      const imageData = {
        src: 'https://example.com/company.jpg',
        format: 'jpeg',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 20000,
        alt: 'Company Logo',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
      expect(result.recommendedFormat).to.include('svg');
    });

    it('should detect JPEG icon based on URL', () => {
      const imageData = {
        src: 'https://example.com/assets/icon-menu.jpg',
        format: 'jpeg',
        naturalWidth: 100,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Menu',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
    });

    it('should detect PNG photo based on URL', () => {
      const imageData = {
        src: 'https://example.com/photos/nature.png',
        format: 'png',
        naturalWidth: 1600,
        naturalHeight: 1200,
        fileSize: 500000,
        alt: 'Nature scene',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.not.be.null;
    });

    it('should return null for PNG with small file size even if large dimensions', () => {
      const imageData = {
        src: 'https://example.com/image.png',
        format: 'png',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 30000,
        alt: 'Image',
      };

      const result = checkWrongFileType(imageData);
      expect(result).to.be.null;
    });

    it('should return null for standard-sized JPEG photo', () => {
      const imageData = {
        src: 'https://example.com/portrait.jpg',
        format: 'jpeg',
        naturalWidth: 800,
        naturalHeight: 600,
        fileSize: 200000,
        alt: 'Portrait photo',
      };

      const result = checkWrongFileType(imageData);
      // Standard photo size should not be flagged
      expect(result).to.be.null;
    });
  });
});

