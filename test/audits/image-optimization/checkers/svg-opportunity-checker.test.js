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
import { checkSvgOpportunity } from '../../../../src/image-optimization/checkers/svg-opportunity-checker.js';

describe('SVG Opportunity Checker', () => {
  describe('checkSvgOpportunity', () => {
    it('should return null for SVG images', () => {
      const imageData = {
        src: 'https://example.com/logo.svg',
        format: 'svg',
        naturalWidth: 200,
        naturalHeight: 100,
        alt: 'Company Logo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.be.null;
    });

    it('should detect logo opportunity based on alt text', () => {
      const imageData = {
        src: 'https://example.com/company.png',
        format: 'png',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Company Logo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('svg-opportunity');
      expect(result.currentFormat).to.equal('png');
      expect(result.recommendedFormat).to.equal('svg');
      expect(result.title).to.include('Logo');
    });

    it('should detect logo opportunity based on URL', () => {
      const imageData = {
        src: 'https://example.com/assets/logo-company.png',
        format: 'png',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Home',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.title).to.include('Logo');
    });

    it('should detect brand images', () => {
      const imageData = {
        src: 'https://example.com/brand-mark.png',
        format: 'png',
        naturalWidth: 150,
        naturalHeight: 150,
        fileSize: 12000,
        alt: 'Brand Mark',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
    });

    it('should detect icon opportunity based on size', () => {
      const imageData = {
        src: 'https://example.com/menu.png',
        format: 'png',
        naturalWidth: 64,
        naturalHeight: 64,
        fileSize: 3000,
        alt: 'Menu',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.title).to.include('Icon');
    });

    it('should detect icon opportunity based on alt text', () => {
      const imageData = {
        src: 'https://example.com/image.png',
        format: 'png',
        naturalWidth: 100,
        naturalHeight: 100,
        fileSize: 5000,
        alt: 'Settings icon',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
    });

    it('should detect icon opportunity based on URL', () => {
      const imageData = {
        src: 'https://example.com/icons/search.png',
        format: 'png',
        naturalWidth: 80,
        naturalHeight: 80,
        fileSize: 4000,
        alt: 'Search',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
    });

    it('should detect badge opportunity', () => {
      const imageData = {
        src: 'https://example.com/verified-badge.png',
        format: 'png',
        naturalWidth: 100,
        naturalHeight: 100,
        fileSize: 6000,
        alt: 'Verified Badge',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
    });

    it('should detect button opportunity', () => {
      const imageData = {
        src: 'https://example.com/cta-button.png',
        format: 'png',
        naturalWidth: 150,
        naturalHeight: 50,
        fileSize: 8000,
        alt: 'Call to action button',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
    });

    it('should return null for large photos', () => {
      const imageData = {
        src: 'https://example.com/photo.jpg',
        format: 'jpeg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 300000,
        alt: 'Landscape photo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.be.null;
    });

    it('should mark medium impact for logos', () => {
      const imageData = {
        src: 'https://example.com/logo.png',
        format: 'png',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Logo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should mark low impact for icons', () => {
      const imageData = {
        src: 'https://example.com/icon.png',
        format: 'png',
        naturalWidth: 48,
        naturalHeight: 48,
        fileSize: 3000,
        alt: 'Icon',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('low');
    });

    it('should have low severity', () => {
      const imageData = {
        src: 'https://example.com/logo.png',
        format: 'png',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Logo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('low');
    });

    it('should include benefits in result', () => {
      const imageData = {
        src: 'https://example.com/logo.png',
        format: 'png',
        naturalWidth: 200,
        naturalHeight: 100,
        fileSize: 15000,
        alt: 'Logo',
      };

      const result = checkSvgOpportunity(imageData);
      expect(result).to.not.be.null;
      expect(result.benefits).to.be.an('array');
      expect(result.benefits.length).to.be.greaterThan(0);
    });
  });
});

