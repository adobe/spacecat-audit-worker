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
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        hasPictureElement: true,
        fileSize: 200000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for AVIF images', () => {
      const imageData = {
        src: 'https://example.com/image.avif',
        format: 'avif',
        isAvif: true,
        fileSize: 100000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for WebP images', () => {
      const imageData = {
        src: 'https://example.com/image.webp',
        format: 'webp',
        isWebp: true,
        fileSize: 150000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for Dynamic Media images', () => {
      const imageData = {
        src: 'https://example.scene7.com/image.jpg',
        format: 'jpeg',
        isDynamicMedia: true,
        fileSize: 200000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for small images (<50KB)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        fileSize: 40000,
        naturalWidth: 600,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for narrow images (<400px)', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        fileSize: 100000,
        naturalWidth: 300,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should return null for non-JPEG/PNG formats', () => {
      const imageData = {
        src: 'https://example.com/image.gif',
        format: 'gif',
        fileSize: 200000,
        naturalWidth: 800,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.be.null;
    });

    it('should suggest picture element for large JPEG images', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        format: 'jpeg',
        isAvif: false,
        isWebp: false,
        fileSize: 300000,
        naturalWidth: 1920,
        isDynamicMedia: false,
        hasPictureElement: false,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.type).to.equal('missing-picture-element');
      expect(result.currentFormat).to.equal('jpeg');
      expect(result.example).to.include('<picture>');
      expect(result.example).to.include('avif');
      expect(result.example).to.include('webp');
    });

    it('should suggest picture element for large PNG images', () => {
      const imageData = {
        src: 'https://example.com/image.png',
        format: 'png',
        isAvif: false,
        isWebp: false,
        fileSize: 400000,
        naturalWidth: 1920,
        isDynamicMedia: false,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.currentFormat).to.equal('png');
    });

    it('should mark medium impact for very large files', () => {
      const imageData = {
        src: 'https://example.com/hero.jpg',
        format: 'jpeg',
        fileSize: 500000,
        naturalWidth: 2048,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('medium');
    });

    it('should mark low impact for moderate files', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        fileSize: 100000,
        naturalWidth: 800,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.impact).to.equal('low');
    });

    it('should have low severity', () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        format: 'jpeg',
        fileSize: 300000,
        naturalWidth: 1920,
      };

      const result = checkPictureElement(imageData);
      expect(result).to.not.be.null;
      expect(result.severity).to.equal('low');
    });
  });
});

