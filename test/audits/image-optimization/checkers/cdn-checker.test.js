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
import { checkCdnDelivery } from '../../../../src/image-optimization/checkers/cdn-checker.js';

describe('CDN Checker', () => {
  describe('checkCdnDelivery', () => {
    it('should return null for Dynamic Media URLs', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/photo.jpg',
        isDynamicMedia: true,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Cloudflare CDN', () => {
      const imageData = {
        src: 'https://cdn.cloudflare.com/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for CloudFront CDN', () => {
      const imageData = {
        src: 'https://d123abc.cloudfront.net/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Akamai CDN', () => {
      const imageData = {
        src: 'https://example.akamaized.net/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Fastly CDN', () => {
      const imageData = {
        src: 'https://cdn.fastly.net/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for generic CDN URLs', () => {
      const imageData = {
        src: 'https://cdn.example.com/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Adobe images CDN', () => {
      const imageData = {
        src: 'https://images.adobe.com/content/photo.jpg',
        isDynamicMedia: true,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for imgix CDN', () => {
      const imageData = {
        src: 'https://example.imgix.net/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Cloudinary CDN', () => {
      const imageData = {
        src: 'https://res.cloudinary.com/company/image/photo.jpg',
        isDynamicMedia: false,
        fileSize: 200000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should return null for small images', () => {
      const imageData = {
        src: '/images/icon.jpg',
        isDynamicMedia: false,
        fileSize: 30000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should detect relative URL without CDN', () => {
      const imageData = {
        src: '/images/hero.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
        position: { isAboveFold: true },
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-cdn');
      expect(result.severity).to.equal('low');
    });

    it('should detect same-origin URL without CDN', () => {
      const imageData = {
        src: './assets/hero.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
    });

    it('should return null for external non-CDN URLs (cannot determine)', () => {
      const imageData = {
        src: 'https://thirdparty.com/photo.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.be.null;
    });

    it('should mark medium impact for above-fold images', () => {
      const imageData = {
        src: '/images/hero.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
        position: { isAboveFold: true },
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should mark low impact for below-fold images', () => {
      const imageData = {
        src: '/images/content.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
        position: { isAboveFold: false },
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('low');
    });

    it('should include benefits in result', () => {
      const imageData = {
        src: '/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
      expect(result.benefits).to.be.an('array');
      expect(result.benefits.length).to.be.greaterThan(0);
    });

    it('should have low severity', () => {
      const imageData = {
        src: '/images/photo.jpg',
        isDynamicMedia: false,
        fileSize: 300000,
      };

      const result = checkCdnDelivery(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('low');
    });
  });
});

