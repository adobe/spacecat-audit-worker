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
import { checkPictureElement } from '../../../../src/image-optimization/checkers/picture-element-checker.js';

describe('Picture Element Checker', () => {
  describe('checkPictureElement', () => {
    it('should return null when picture element is already used', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        format: 'jpeg',
        hasPictureElement: true,
        fileSize: 200000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should flag DM image without picture element', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero?fmt=jpeg',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 300000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-picture-element');
      expect(result.currentFormat).to.equal('jpeg');
      expect(result.severity).to.equal('medium');
    });

    it('should include DM URLs for AVIF, WebP, and fallback', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.dmUrls).to.exist;
      expect(result.dmUrls.avif).to.include('fmt=avif');
      expect(result.dmUrls.webp).to.include('fmt=webp-alpha');
      expect(result.dmUrls.fallback).to.include('fmt=jpeg');
    });

    it('should include picture element example with DM URLs', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.example).to.include('<picture>');
      expect(result.example).to.include('type="image/avif"');
      expect(result.example).to.include('type="image/webp"');
      expect(result.example).to.include('fmt=avif');
      expect(result.example).to.include('fmt=webp-alpha');
    });

    it('should mark high impact for large files (>200KB)', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 500000,
        naturalWidth: 2048,
        naturalHeight: 1536,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('high');
    });

    it('should mark medium impact for smaller files (<=200KB)', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/icon',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 100000,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should include dimensions in result', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.dimensions).to.equal('1920x1080');
    });

    it('should handle URLs with existing query parameters', () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/company/hero?wid=1920&hei=1080',
        format: 'jpeg',
        hasPictureElement: false,
        fileSize: 200000,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.dmUrls.avif).to.include('wid=1920');
      expect(result.dmUrls.avif).to.include('fmt=avif');
    });
  });
});

