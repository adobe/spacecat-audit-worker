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
import { runAllChecks } from '../../../../src/image-optimization/checkers/index.js';

describe('Checkers Index (Orchestrator)', () => {
  describe('runAllChecks', () => {
    it('should run all checks and return multiple suggestions', () => {
      const imageData = {
        src: '/images/hero.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 500000,
        naturalWidth: 2400,
        naturalHeight: 1800,
        renderedWidth: 1200,
        renderedHeight: 900,
        hasLazyLoading: false,
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        isOversized: true,
        oversizeRatio: '2.0',
        suggestedWidth: 1200,
        suggestedHeight: 900,
        position: { isAboveFold: false },
        isDynamicMedia: false,
      };

      const results = runAllChecks(imageData);
      
      expect(results).to.be.an('array');
      expect(results.length).to.be.greaterThan(0);
      
      // Should detect format optimization
      const formatIssue = results.find((r) => r.type === 'format-optimization');
      expect(formatIssue).to.exist;
      
      // Should detect oversized image
      const oversizedIssue = results.find((r) => r.type === 'oversized-image');
      expect(oversizedIssue).to.exist;
      
      // Should detect missing lazy loading
      const lazyLoadingIssue = results.find((r) => r.type === 'missing-lazy-loading');
      expect(lazyLoadingIssue).to.exist;
      
      // Should detect missing dimensions
      const dimensionsIssue = results.find((r) => r.type === 'missing-dimensions');
      expect(dimensionsIssue).to.exist;
      
      // Should detect missing CDN
      const cdnIssue = results.find((r) => r.type === 'missing-cdn');
      expect(cdnIssue).to.exist;
    });

    it('should return empty array when no issues found', () => {
      const imageData = {
        src: 'https://cdn.example.com/image.avif',
        format: 'avif',
        isAvif: true,
        isWebp: false,
        fileSize: 50000,
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 800,
        renderedHeight: 600,
        hasLazyLoading: true,
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        isOversized: false,
        oversizeRatio: '1.0',
        position: { isAboveFold: true },
        isDynamicMedia: true,
        srcset: 'image-320.jpg 320w, image-640.jpg 640w',
        hasPictureElement: true,
      };

      const results = runAllChecks(imageData);
      expect(results).to.be.an('array');
      expect(results.length).to.equal(0);
    });

    it('should run only enabled checks when specified', () => {
      const imageData = {
        src: '/images/photo.jpg',
        format: 'jpeg',
        isAvif: false,
        fileSize: 300000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1920,
        renderedHeight: 1080,
        hasLazyLoading: false,
        hasWidthAttribute: false,
        position: { isAboveFold: false },
      };

      const results = runAllChecks(imageData, ['format', 'dimensions']);
      
      expect(results).to.be.an('array');
      
      // Should only have format and dimensions issues
      const types = results.map((r) => r.type);
      expect(types).to.include('format-optimization');
      expect(types).to.include('missing-dimensions');
      expect(types).to.not.include('missing-lazy-loading');
    });

    it('should handle checker errors gracefully', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        // Intentionally incomplete data that might cause some checkers to fail
        format: null,
        fileSize: undefined,
      };

      // Should not throw, just skip failed checkers
      expect(() => runAllChecks(imageData)).to.not.throw();
      
      const results = runAllChecks(imageData);
      expect(results).to.be.an('array');
    });

    it('should detect SVG opportunity for logos', () => {
      const imageData = {
        src: 'https://example.com/logo.png',
        format: 'png',
        isAvif: false,
        fileSize: 15000,
        naturalWidth: 200,
        naturalHeight: 100,
        renderedWidth: 200,
        renderedHeight: 100,
        alt: 'Company Logo',
        hasWidthAttribute: true,
        hasHeightAttribute: true,
      };

      const results = runAllChecks(imageData);
      const svgIssue = results.find((r) => r.type === 'svg-opportunity');
      expect(svgIssue).to.exist;
      expect(svgIssue.recommendedFormat).to.equal('svg');
    });

    it('should detect wrong file type (PNG for photo)', () => {
      const imageData = {
        src: 'https://example.com/landscape.png',
        format: 'png',
        isAvif: false,
        fileSize: 800000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1920,
        renderedHeight: 1080,
        alt: 'Beautiful landscape',
        hasWidthAttribute: true,
        hasHeightAttribute: true,
      };

      const results = runAllChecks(imageData);
      const fileTypeIssue = results.find((r) => r.type === 'wrong-file-type');
      expect(fileTypeIssue).to.exist;
      expect(fileTypeIssue.currentFormat).to.equal('png');
    });

    it('should detect missing responsive images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        format: 'jpeg',
        isAvif: false,
        fileSize: 300000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1200,
        renderedHeight: 675,
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        hasLazyLoading: true,
        isDynamicMedia: false,
      };

      const results = runAllChecks(imageData);
      const responsiveIssue = results.find((r) => r.type === 'missing-responsive-images');
      expect(responsiveIssue).to.exist;
    });

    it('should detect missing picture element', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 400000,
        naturalWidth: 2048,
        naturalHeight: 1536,
        renderedWidth: 2048,
        renderedHeight: 1536,
        hasPictureElement: false,
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        isDynamicMedia: false,
      };

      const results = runAllChecks(imageData);
      const pictureIssue = results.find((r) => r.type === 'missing-picture-element');
      expect(pictureIssue).to.exist;
    });

    it('should detect upscaled images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        fileSize: 200000,
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1600,
        renderedHeight: 1200,
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        position: { isAboveFold: true },
      };

      const results = runAllChecks(imageData);
      const upscaledIssue = results.find((r) => r.type === 'upscaled-image');
      expect(upscaledIssue).to.exist;
    });

    it('should detect poor caching', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        isAvif: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1920,
        renderedHeight: 1080,
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        responseHeaders: {
          'cache-control': 'no-cache',
        },
      };

      const results = runAllChecks(imageData);
      const cacheIssue = results.find((r) => r.type === 'insufficient-caching');
      expect(cacheIssue).to.exist;
    });

    it('should return results with consistent structure', () => {
      const imageData = {
        src: '/images/photo.jpg',
        format: 'jpeg',
        isAvif: false,
        fileSize: 300000,
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 1920,
        renderedHeight: 1080,
        hasWidthAttribute: false,
      };

      const results = runAllChecks(imageData);
      
      results.forEach((result) => {
        expect(result).to.have.property('type');
        expect(result).to.have.property('severity');
        expect(result).to.have.property('impact');
        expect(result).to.have.property('title');
        expect(result).to.have.property('description');
        expect(result).to.have.property('imageUrl');
        expect(result).to.have.property('recommendation');
      });
    });
  });
});

