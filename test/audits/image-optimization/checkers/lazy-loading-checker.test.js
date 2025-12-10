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
import { checkLazyLoading } from '../../../../src/image-optimization/checkers/lazy-loading-checker.js';

describe('Lazy Loading Checker', () => {
  describe('checkLazyLoading', () => {
    it('should return null when lazy loading is present', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: true,
        position: { isAboveFold: false },
        fileSize: 100000,
        naturalWidth: 800,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.be.null;
    });

    it('should return null for above-fold images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: true },
        fileSize: 200000,
        naturalWidth: 1920,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.be.null;
    });

    it('should return null when position is missing', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: false,
        fileSize: 100000,
        naturalWidth: 800,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.be.null;
    });

    it('should return null for small images (<10KB)', () => {
      const imageData = {
        src: 'https://example.com/icon.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 5000,
        naturalWidth: 800,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.be.null;
    });

    it('should return null for tiny images (<100px)', () => {
      const imageData = {
        src: 'https://example.com/icon.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 50000,
        naturalWidth: 64,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.be.null;
    });

    it('should detect missing lazy loading for below-fold images', () => {
      const imageData = {
        src: 'https://example.com/content.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false, isVisible: true },
        fileSize: 150000,
        naturalWidth: 1200,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-lazy-loading');
      expect(result.isAboveFold).to.be.false;
      expect(result.recommendation).to.include('loading="lazy"');
    });

    it('should mark medium severity for large images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 500000,
        naturalWidth: 1920,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('medium');
    });

    it('should mark low severity for moderate images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 80000,
        naturalWidth: 800,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('low');
    });

    it('should include example markup', () => {
      const imageData = {
        src: 'https://example.com/photo.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 200000,
        naturalWidth: 1200,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.example).to.include('loading="lazy"');
    });

    it('should have medium impact', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false },
        fileSize: 200000,
        naturalWidth: 1200,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should include visibility status', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasLazyLoading: false,
        position: { isAboveFold: false, isVisible: false },
        fileSize: 200000,
        naturalWidth: 1200,
      };

      const result = checkLazyLoading(imageData);
      expect(result).to.not.be.null;
      expect(result.isVisible).to.be.false;
    });
  });
});

