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
    it('should return null when srcset and sizes are present', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        srcset: 'image-320.jpg 320w, image-640.jpg 640w',
        sizes: '(max-width: 640px) 100vw, 50vw',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should flag missing sizes when srcset exists', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        srcset: 'image-320.jpg 320w, image-640.jpg 640w',
        sizes: null,
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
        position: { isAboveFold: true },
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-sizes-attribute');
      expect(result.hasSrcset).to.be.true;
      expect(result.hasSizes).to.be.false;
      expect(result.recommendation).to.include('sizes');
    });

    it('should return null for small images (<200px)', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/icon',
        naturalWidth: 150,
        naturalHeight: 150,
        fileSize: 50000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should return null for tiny images (<10KB)', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/small',
        naturalWidth: 800,
        naturalHeight: 600,
        fileSize: 5000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.be.null;
    });

    it('should detect missing srcset for large DM images', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 300000,
        position: { isAboveFold: true },
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-responsive-images');
      expect(result.hasSrcset).to.be.false;
      expect(result.recommendation).to.include('srcset');
      expect(result.recommendation).to.include('wid');
    });

    it('should include DM URLs with wid parameter', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.dmUrls).to.exist;
      expect(result.dmUrls).to.have.length(4);
      expect(result.dmUrls[0].width).to.equal(320);
      expect(result.dmUrls[0].url).to.include('wid=320');
    });

    it('should include example with DM wid parameters', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.example).to.include('srcset');
      expect(result.example).to.include('sizes');
      expect(result.example).to.include('wid=320');
      expect(result.example).to.include('wid=1920');
    });

    it('should mark high severity for large above-fold images', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
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
        src: 'https://example.scene7.com/is/image/company/content',
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

    it('should handle missing position data', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.isAboveFold).to.be.false;
    });

    it('should handle URLs with existing query parameters', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero?fmt=jpeg',
        naturalWidth: 1920,
        naturalHeight: 1080,
        fileSize: 200000,
      };

      const result = checkResponsiveImages(imageData);
      expect(result).to.not.be.null;
      expect(result.dmUrls[0].url).to.include('fmt=jpeg');
      expect(result.dmUrls[0].url).to.include('wid=320');
    });
  });
});

