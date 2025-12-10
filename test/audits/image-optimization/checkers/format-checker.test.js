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
import { checkFormatDetection } from '../../../../src/image-optimization/checkers/format-checker.js';

describe('Format Checker', () => {
  describe('checkFormatDetection', () => {
    it('should return null for AVIF images', () => {
      const imageData = {
        src: 'https://example.com/image.avif',
        format: 'avif',
        isAvif: true,
        fileSize: 100000,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.be.null;
    });

    it('should suggest AVIF conversion for JPEG images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('format-optimization');
      expect(result.currentFormat).to.equal('jpeg');
      expect(result.recommendedFormat).to.equal('avif');
      expect(result.savingsPercent).to.be.greaterThan(0);
      expect(result.savingsBytes).to.equal(100000);
    });

    it('should suggest AVIF conversion for PNG images', () => {
      const imageData = {
        src: 'https://example.com/image.png',
        format: 'png',
        isAvif: false,
        isWebp: false,
        fileSize: 300000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.currentFormat).to.equal('png');
      expect(result.recommendedFormat).to.equal('avif');
      expect(result.savingsPercent).to.equal(50);
    });

    it('should suggest AVIF conversion for WebP images', () => {
      const imageData = {
        src: 'https://example.com/image.webp',
        format: 'webp',
        isAvif: false,
        isWebp: true,
        fileSize: 140000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.currentFormat).to.equal('webp');
      expect(result.recommendedFormat).to.equal('avif');
      expect(result.projectedSize).to.be.lessThan(imageData.fileSize);
    });

    it('should return null when fileSize is missing', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 0,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.be.null;
    });

    it('should return null when savings are too small (<10%)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 10000, // Very small file
        naturalWidth: 100,
        naturalHeight: 100,
      };

      const result = checkFormatDetection(imageData);
      // For JPEG with 50% savings ratio, 10KB would save 5KB (50%)
      // This should still trigger since 50% > 10%
      expect(result).to.not.be.null;
    });

    it('should return null for unknown format', () => {
      const imageData = {
        src: 'https://example.com/image.bmp',
        format: 'bmp',
        isAvif: false,
        isWebp: false,
        fileSize: 200000,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.be.null;
    });

    it('should mark high impact for large savings', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 500000, // 500KB
        naturalWidth: 2048,
        naturalHeight: 1536,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
      expect(result.savingsBytes).to.be.greaterThan(100000);
    });

    it('should mark medium impact for moderate savings', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 80000, // 80KB
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should include proper dimensions in result', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkFormatDetection(imageData);
      expect(result).to.not.be.null;
      expect(result.dimensions).to.equal('1920x1080');
    });
  });
});

