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
import { checkOversizedImage } from '../../../../src/image-optimization/checkers/oversized-checker.js';

describe('Oversized Checker', () => {
  describe('checkOversizedImage', () => {
    it('should return null when image is not oversized', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: false,
        oversizeRatio: '1.0',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 100000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.be.null;
    });

    it('should return null when oversize ratio is small (<1.5)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '1.3',
        naturalWidth: 800,
        naturalHeight: 600,
        renderedWidth: 615,
        renderedHeight: 461,
        suggestedWidth: 615,
        suggestedHeight: 461,
        fileSize: 100000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.be.null;
    });

    it('should detect moderately oversized image', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '1.8',
        naturalWidth: 1440,
        naturalHeight: 1080,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 200000,
        position: { isAboveFold: true },
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('oversized-image');
      expect(result.severity).to.equal('medium');
      expect(result.oversizeRatio).to.equal(1.8);
      expect(result.naturalDimensions).to.equal('1440x1080');
      expect(result.renderedDimensions).to.equal('800x600');
      expect(result.suggestedDimensions).to.equal('800x600');
    });

    it('should detect highly oversized image with high severity', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '3.0',
        naturalWidth: 2400,
        naturalHeight: 1800,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 400000,
        position: { isAboveFold: false },
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('high');
      expect(result.oversizeRatio).to.equal(3.0);
    });

    it('should calculate estimated savings based on pixel reduction', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '2.0',
        naturalWidth: 1600,
        naturalHeight: 1200,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 300000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.estimatedSavings).to.be.greaterThan(0);
      expect(result.savingsPercent).to.be.greaterThan(0);
    });

    it('should mark high impact for large savings', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '2.0',
        naturalWidth: 3200,
        naturalHeight: 2400,
        renderedWidth: 1600,
        renderedHeight: 1200,
        suggestedWidth: 1600,
        suggestedHeight: 1200,
        fileSize: 500000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
    });

    it('should mark medium impact for moderate savings', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '1.8',
        naturalWidth: 1440,
        naturalHeight: 1080,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 40000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should include position information', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '2.0',
        naturalWidth: 1600,
        naturalHeight: 1200,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 200000,
        position: { isAboveFold: true },
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.true;
    });

    it('should handle missing position data', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '2.0',
        naturalWidth: 1600,
        naturalHeight: 1200,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 200000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.false;
    });

    it('should provide actionable recommendation', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isOversized: true,
        oversizeRatio: '2.0',
        naturalWidth: 1600,
        naturalHeight: 1200,
        renderedWidth: 800,
        renderedHeight: 600,
        suggestedWidth: 800,
        suggestedHeight: 600,
        fileSize: 200000,
      };

      const result = checkOversizedImage(imageData);
      expect(result).to.not.be.null;
      expect(result.recommendation).to.include('800x600');
      expect(result.recommendation).to.include('srcset');
    });
  });
});

