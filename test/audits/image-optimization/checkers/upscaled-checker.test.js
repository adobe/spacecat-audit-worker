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
import { checkBlurryOrUpscaled } from '../../../../src/image-optimization/checkers/upscaled-checker.js';

describe('Upscaled Checker', () => {
  describe('checkBlurryOrUpscaled', () => {
    it('should return null when image is not upscaled', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 800,
        renderedHeight: 600,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.be.null;
    });

    it('should return null for slight upscaling (<=20%)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 900,
        renderedHeight: 675,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.be.null;
    });

    it('should detect moderate upscaling', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1200,
        renderedHeight: 900,
        position: { isAboveFold: false },
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('upscaled-image');
      expect(result.severity).to.equal('medium');
      expect(result.upscaleRatio).to.equal(1.5);
      expect(result.naturalDimensions).to.equal('800x600');
      expect(result.renderedDimensions).to.equal('1200x900');
    });

    it('should detect severe upscaling with high severity', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 400,
        naturalHeight: 300,
        renderedWidth: 1200,
        renderedHeight: 900,
        position: { isAboveFold: true },
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
      expect(result.upscaleRatio).to.equal(3);
    });

    it('should calculate recommended dimensions (1.5x for high-DPI)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1000,
        renderedHeight: 750,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.recommendedDimensions).to.equal('1500x1125');
    });

    it('should mark high impact for above-fold images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1600,
        renderedHeight: 1200,
        position: { isAboveFold: true },
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
      expect(result.isAboveFold).to.be.true;
    });

    it('should mark medium impact for below-fold images', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1200,
        renderedHeight: 900,
        position: { isAboveFold: false },
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should handle asymmetric upscaling (use max ratio)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 2000,  // 2.5x width
        renderedHeight: 1050, // 1.75x height
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.upscaleRatio).to.equal(2.5); // Uses max ratio
    });

    it('should provide actionable recommendation', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 600,
        naturalHeight: 400,
        renderedWidth: 900,
        renderedHeight: 600,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.recommendation).to.include('1350x900'); // 1.5x rendered for high-DPI
      expect(result.recommendation).to.include('high-DPI');
    });

    it('should describe blurriness issue', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1200,
        renderedHeight: 900,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.description).to.include('blurr');
      expect(result.description).to.include('50%'); // (1.5-1)*100
    });

    it('should handle missing position data', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 1200,
        renderedHeight: 900,
      };

      const result = checkBlurryOrUpscaled(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.false;
    });
  });
});

