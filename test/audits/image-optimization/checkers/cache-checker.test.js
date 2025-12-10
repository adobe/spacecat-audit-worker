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
import { checkCacheControlHeaders } from '../../../../src/image-optimization/checkers/cache-checker.js';

describe('Cache Checker', () => {
  describe('checkCacheControlHeaders', () => {
    it('should return null when no headers available', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.be.null;
    });

    it('should return null for properly cached images (1 week+)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'public, max-age=604800',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.be.null;
    });

    it('should return null for very long cache durations', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'public, max-age=31536000, immutable',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.be.null;
    });

    it('should detect no-cache directive', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'no-cache',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('insufficient-caching');
      expect(result.severity).to.equal('high');
      expect(result.description).to.include('non-cacheable');
    });

    it('should detect no-store directive', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'no-store',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
    });

    it('should detect must-revalidate directive', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'must-revalidate, max-age=3600',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
    });

    it('should detect missing cache headers', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {},
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
      expect(result.description).to.include('No caching headers');
    });

    it('should detect short cache duration (<1 hour)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=1800',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('medium');
      expect(result.currentMaxAge).to.equal(1800);
    });

    it('should detect below-recommended cache duration', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=86400',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('low');
      expect(result.currentMaxAgeDays).to.equal(1);
    });

    it('should handle case-insensitive headers', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'Cache-Control': 'max-age=3600',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
    });

    it('should mark high impact for large images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'no-cache',
        },
        fileSize: 500000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
    });

    it('should mark medium impact for moderate images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=3600',
        },
        fileSize: 80000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should include recommended settings', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=3600',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.recommendation).to.include('Cache-Control');
      expect(result.recommendation).to.include('max-age');
      expect(result.recommendation).to.include('immutable');
    });

    it('should include benefits', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=3600',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.benefits).to.be.an('array');
      expect(result.benefits.length).to.be.greaterThan(0);
    });

    it('should parse max-age correctly', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'public, max-age=7200, immutable',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.currentMaxAge).to.equal(7200);
    });

    it('should handle zero max-age', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        responseHeaders: {
          'cache-control': 'max-age=0',
        },
        fileSize: 200000,
      };

      const result = checkCacheControlHeaders(imageData);
      expect(result).to.not.be.null;
      expect(result.currentMaxAge).to.equal(0);
    });
  });
});

