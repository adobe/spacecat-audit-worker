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
import sinon from 'sinon';
import esmock from 'esmock';

describe('Format Checker', () => {
  describe('checkFormatDetection', () => {
    let checkFormatDetection;
    let verifyDmFormatsStub;
    let mockLog;

    beforeEach(async () => {
      verifyDmFormatsStub = sinon.stub();
      mockLog = {
        info: sinon.stub(),
        warn: sinon.stub(),
        debug: sinon.stub(),
      };

      const formatCheckerModule = await esmock(
        '../../../../src/image-optimization/checkers/format-checker.js',
        {
          '../../../../src/image-optimization/dm-format-verifier.js': {
            verifyDmFormats: verifyDmFormatsStub,
          },
        },
      );
      checkFormatDetection = formatCheckerModule.checkFormatDetection;
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return null for non-DM images', async () => {
      const imageData = {
        src: 'https://example.com/image.jpg',
        isDynamicMedia: false,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = await checkFormatDetection(imageData, mockLog);
      expect(result).to.be.null;
      expect(verifyDmFormatsStub.called).to.be.false;
    });

    it('should return null when log is not provided', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      const result = await checkFormatDetection(imageData, null);
      expect(result).to.be.null;
      expect(verifyDmFormatsStub.called).to.be.false;
    });

    it('should return suggestion for DM images with optimization opportunity', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test?fmt=jpeg',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      verifyDmFormatsStub.resolves({
        recommendations: [{
          savingsPercent: 40,
          savingsBytes: 150000,
          recommendedFormat: 'avif',
          currentFormat: 'jpeg',
          currentSize: 250000,
          recommendedSize: 100000,
          message: 'Switch from JPEG to AVIF to save 40% (146 KB)',
        }],
        formats: {
          avif: { size: 100000, success: true },
          jpeg: { size: 250000, success: true },
        },
      });

      const result = await checkFormatDetection(imageData, mockLog);

      expect(result).to.not.be.null;
      expect(result.type).to.equal('format-detection');
      expect(result.severity).to.equal('high');
      expect(result.impact).to.equal('high');
      expect(result.recommendedFormat).to.equal('avif');
      expect(result.currentFormat).to.equal('jpeg');
      expect(result.verificationMethod).to.equal('real-dm-check');
      expect(result.smartImagingAlternative).to.include('bfc=on');
      expect(result.smartImagingAlternative).to.include('Smart Imaging');
    });

    it('should return null when no optimization opportunity exists', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test?fmt=avif',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      verifyDmFormatsStub.resolves({
        recommendations: [],
        formats: {
          avif: { size: 100000, success: true },
        },
      });

      const result = await checkFormatDetection(imageData, mockLog);
      expect(result).to.be.null;
    });

    it('should return null when DM verification fails', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      verifyDmFormatsStub.rejects(new Error('Network error'));

      const result = await checkFormatDetection(imageData, mockLog);

      expect(result).to.be.null;
      expect(mockLog.warn.calledOnce).to.be.true;
    });

    it('should mark medium severity for savings <= 30%', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test',
        isDynamicMedia: true,
        naturalWidth: 800,
        naturalHeight: 600,
      };

      verifyDmFormatsStub.resolves({
        recommendations: [{
          savingsPercent: 25,
          savingsBytes: 50000,
          recommendedFormat: 'avif',
          currentFormat: 'jpeg',
          currentSize: 200000,
          recommendedSize: 150000,
          message: 'Switch from JPEG to AVIF to save 25%',
        }],
        formats: {},
      });

      const result = await checkFormatDetection(imageData, mockLog);

      expect(result).to.not.be.null;
      expect(result.severity).to.equal('medium');
      expect(result.impact).to.equal('medium');
    });

    it('should include dimensions in result', async () => {
      const imageData = {
        src: 'https://example.scene7.com/is/image/test',
        isDynamicMedia: true,
        naturalWidth: 1920,
        naturalHeight: 1080,
      };

      verifyDmFormatsStub.resolves({
        recommendations: [{
          savingsPercent: 35,
          savingsBytes: 80000,
          recommendedFormat: 'avif',
          currentFormat: 'jpeg',
          currentSize: 200000,
          recommendedSize: 120000,
          message: 'Switch from JPEG to AVIF',
        }],
        formats: {},
      });

      const result = await checkFormatDetection(imageData, mockLog);

      expect(result).to.not.be.null;
      expect(result.dimensions).to.equal('1920x1080');
    });
  });
});

