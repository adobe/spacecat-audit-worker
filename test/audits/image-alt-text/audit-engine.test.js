/*
 * Copyright 2024 Adobe. All rights reserved.
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
import AuditEngine from '../../../src/image-alt-text/auditEngine.js';

describe('AuditEngine', () => {
  let auditEngine;
  let logStub;

  beforeEach(() => {
    logStub = {
      info: sinon.stub(),
      warn: sinon.stub(),
    };
    auditEngine = new AuditEngine(logStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with empty imagesWithoutAltText array', () => {
      expect(auditEngine.auditedTags).to.deep.equal({
        imagesWithoutAltText: [],
      });
    });
  });

  describe('performPageAudit', () => {
    it('should identify images without alt text', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '' },
          { src: 'image2.jpg' },
          { src: 'image3.jpg', alt: null },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedTags = auditEngine.getAuditedTags();

      expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(3);
      expect(auditedTags.imagesWithoutAltText[0]).to.deep.equal({
        url: pageUrl,
        src: 'image1.jpg',
      });
    });

    it('should not include images with valid alt text', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: 'Valid alt text' },
          { src: 'image2.jpg', alt: '  Padded alt text  ' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedTags = auditEngine.getAuditedTags();

      expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(0);
    });

    it('should handle whitespace-only alt text as missing', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '   ' },
          { src: 'image2.jpg', alt: '\n\t' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedTags = auditEngine.getAuditedTags();

      expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(2);
    });

    it('should handle pages with no images array', () => {
      const pageUrl = '/no-images';
      const pageTags = {};

      auditEngine.performPageAudit(pageUrl, pageTags);

      expect(logStub.warn).to.have.been.calledWith(
        'No images found for page /no-images',
      );
      expect(
        auditEngine.getAuditedTags().imagesWithoutAltText,
      ).to.have.lengthOf(0);
    });

    it('should handle null pageTags', () => {
      const pageUrl = '/null-tags';

      auditEngine.performPageAudit(pageUrl, null);

      expect(logStub.warn).to.have.been.calledWith(
        'No images found for page /null-tags',
      );
      expect(
        auditEngine.getAuditedTags().imagesWithoutAltText,
      ).to.have.lengthOf(0);
    });

    it('should handle non-array images property', () => {
      const pageUrl = '/invalid-images';
      const pageTags = {
        images: 'not an array',
      };

      auditEngine.performPageAudit(pageUrl, pageTags);

      expect(logStub.warn).to.have.been.calledWith(
        'No images found for page /invalid-images',
      );
      expect(
        auditEngine.getAuditedTags().imagesWithoutAltText,
      ).to.have.lengthOf(0);
    });
  });

  describe('finalizeAudit', () => {
    it('should log summary of images without alt text', () => {
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '' },
          { src: 'image2.jpg', alt: 'Valid alt' },
          { src: 'image3.jpg' },
        ],
      };

      auditEngine.performPageAudit('/test', pageTags);
      auditEngine.finalizeAudit();

      expect(logStub.info).to.have.been.calledWith(
        'Found 2 images without alt text',
      );
    });

    it('should log summary when no issues found', () => {
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: 'Valid alt 1' },
          { src: 'image2.jpg', alt: 'Valid alt 2' },
        ],
      };

      auditEngine.performPageAudit('/test', pageTags);
      auditEngine.finalizeAudit();

      expect(logStub.info).to.have.been.calledWith(
        'Found 0 images without alt text',
      );
    });
  });

  describe('getAuditedTags', () => {
    it('should return accumulated results from all audited pages', () => {
      auditEngine.performPageAudit('/page1', {
        images: [{ src: 'image1.jpg' }],
      });

      auditEngine.performPageAudit('/page2', {
        images: [{ src: 'image2.jpg', alt: '' }],
      });

      const auditedTags = auditEngine.getAuditedTags();

      expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(2);
      expect(auditedTags.imagesWithoutAltText[0].url).to.equal('/page1');
      expect(auditedTags.imagesWithoutAltText[1].url).to.equal('/page2');
    });

    it('should return empty results when no pages audited', () => {
      const auditedTags = auditEngine.getAuditedTags();

      expect(auditedTags.imagesWithoutAltText).to.be.an('array').that.is.empty;
    });
  });
});
