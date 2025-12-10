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
import { checkResponsiveImages } from '../../../../src/image-optimization/checkers/responsive-checker.js';

describe('Responsive Checker', () => {
  describe('checkResponsiveImages', () => {
    it('should return null when srcset is present', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        srcset: 'image-320.jpg 320w, image-640.jpg 640w',
        sizes: '(max-width: 640px) 100vw, 50vw',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should return null for small images (<200px)', () => {
      const imageData = {
        src: 'https://example.com/icon.jpg',
        naturalWidth: 150,
        naturalHeight: 150,
        fileSize: 50000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Dynamic Media images', () => {
      const imageData = {
        src: 'https://example.scene7.com/image.jpg',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should return null for tiny images (<10KB)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        fileSize: 5000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should detect missing srcset for large content images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1200,
        fileSize: 300000,
        position: { isAboveFold: true },
        isDynamicMedia: false,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-responsive-images');
      expect(result.hasSrcset).to.be.false;
      expect(result.recommendation).to.include('srcset');
    });

    it('should mark high severity for large above-fold images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 500000,
        position: { isAboveFold: true },
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
      expect(result.impact).to.equal('high');
    });

    it('should mark medium severity for smaller images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        fileSize: 80000,
        position: { isAboveFold: false },
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('medium');
      expect(result.impact).to.equal('medium');
    });

    it('should include example markup in recommendation', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.example).to.include('srcset');
      expect(result.example).to.include('sizes');
    });

    it('should track sizes attribute presence', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        sizes: '100vw',
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.hasSizes).to.be.true;
    });

    it('should handle missing position data', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.false;
    });
  });
});

