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
import { checkMissingDimensions } from '../../../../src/image-optimization/checkers/dimensions-checker.js';

describe('Dimensions Checker', () => {
  describe('checkMissingDimensions', () => {
    it('should return null when both width and height are present', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: true,
        hasHeightAttribute: true,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.be.null;
    });

    it('should return null for very small images', () => {
      const imageData = {
        src: 'https://example.com/icon.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 32,
        naturalHeight: 32,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.be.null;
    });

    it('should detect missing width attribute', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: true,
        naturalWidth: 800,
        naturalHeight: 600,
        position: { isAboveFold: false },
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-dimensions');
      expect(result.missingAttributes).to.deep.equal(['width']);
      expect(result.title).to.include('width');
    });

    it('should detect missing height attribute', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: true,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.missingAttributes).to.deep.equal(['height']);
      expect(result.title).to.include('height');
    });

    it('should detect missing both attributes', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.missingAttributes).to.deep.equal(['width', 'height']);
      expect(result.title).to.include('width and height');
      expect(result.title).to.include('attributes');
    });

    it('should mark high severity for above-fold images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 1920,
        naturalHeight: 1080,
        position: { isAboveFold: true },
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
      expect(result.isAboveFold).to.be.true;
    });

    it('should mark medium severity for below-fold images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
        position: { isAboveFold: false },
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('medium');
    });

    it('should include natural dimensions', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.naturalDimensions).to.equal('1920x1080');
    });

    it('should provide example markup', () => {
      const imageData = {
        src: 'https://example.com/photo.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.example).to.include('width="800"');
      expect(result.example).to.include('height="600"');
    });

    it('should mention CLS in description', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.description).to.include('CLS');
      expect(result.description).to.include('Core Web Vitals');
    });

    it('should handle missing position data', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        hasWidthAttribute: false,
        hasHeightAttribute: false,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkMissingDimensions(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.false;
    });
  });
});

