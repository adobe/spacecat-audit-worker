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
import { JSDOM } from 'jsdom';
import { Audit as AuditModel } from '@adobe/spacecat-shared-data-access';
import AuditEngine, { getPageLanguage, detectLanguageFromText } from '../../../src/image-alt-text/auditEngine.js';

describe('AuditEngine', () => {
  let auditEngine;
  let logStub;
  let tracingFetchStub;

  beforeEach(() => {
    logStub = {
      debug: sinon.stub(),
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
    auditEngine = new AuditEngine(logStub);
    tracingFetchStub = sinon.stub();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('constructor', () => {
    it('should initialize with empty imagesWithoutAltText array', () => {
      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages).to.deep.equal({
        imagesWithoutAltText: [],
        presentationalImagesCount: 0,
      });
    });
  });

  describe('performPageAudit', () => {
    it('should identify images without alt text', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          {
            src: 'image1.jpg', alt: '', isPresentational: false, xpath: '/html/body/img[1]',
          },
          { src: 'image2.jpg', isPresentational: false, xpath: '/html/body/img[2]' },
          {
            src: 'image3.jpg', alt: null, isPresentational: false, xpath: '/html/body/img[3]',
          },
          {
            src: 'image4.jpg', alt: null, isPresentational: true, xpath: '/html/body/img[4]',
          },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedImages = auditEngine.getAuditedTags();

      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(4);
      expect(auditedImages.presentationalImagesCount).to.equal(1);
      expect(auditedImages.imagesWithoutAltText[0]).to.deep.equal({
        pageUrl,
        src: 'image1.jpg',
        xpath: '/html/body/img[1]',
        language: 'unknown',
      });
    });

    it('should not include images with valid alt text', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: 'Valid alt text', xpath: '/html/body/img[1]' },
          { src: 'image2.jpg', alt: '  Padded alt text  ', xpath: '/html/body/img[2]' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedImages = auditEngine.getAuditedTags();

      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
    });

    it('should handle whitespace-only alt text as missing', () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '   ', xpath: '/html/body/img[1]' },
          { src: 'image2.jpg', alt: '\n\t', xpath: '/html/body/img[2]' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      const auditedImages = auditEngine.getAuditedTags();

      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(2);
    });

    it('should handle pages with no images array', () => {
      const pageUrl = '/no-images';
      const pageTags = {};

      auditEngine.performPageAudit(pageUrl, pageTags);

      expect(logStub.debug).to.have.been.calledWith(
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: No images found for page /no-images`,
      );
      expect(
        auditEngine.getAuditedTags().imagesWithoutAltText,
      ).to.have.lengthOf(0);
    });

    it('should handle null pageTags', () => {
      const pageUrl = '/null-tags';

      auditEngine.performPageAudit(pageUrl, null);

      expect(logStub.debug).to.have.been.calledWith(
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: No images found for page /null-tags`,
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

      expect(logStub.debug).to.have.been.calledWith(
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: No images found for page /invalid-images`,
      );
      expect(
        auditEngine.getAuditedTags().imagesWithoutAltText,
      ).to.have.lengthOf(0);
    });

    it('should handle missing window.document in pageTags', () => {
      const pageUrl = '/invalid-images';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '   ', xpath: '/html/body/img[1]' },
          { src: 'image2.jpg', alt: '\n\t', xpath: '/html/body/img[2]' },
        ],
        dom: { window: { document: null } },
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
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
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: Found 2 images without alt text`,
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
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: Found 0 images without alt text`,
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

      const auditedImages = auditEngine.getAuditedTags();

      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(2);
      expect(auditedImages.imagesWithoutAltText[0].pageUrl).to.equal('/page1');
      expect(auditedImages.imagesWithoutAltText[1].pageUrl).to.equal('/page2');
    });

    it('should return empty results when no pages audited', () => {
      const auditedImages = auditEngine.getAuditedTags();

      expect(auditedImages.imagesWithoutAltText).to.be.an('array').that.is.empty;
    });
  });

  describe('filterImages', () => {
    beforeEach(() => {
      tracingFetchStub = sinon.stub(global, 'fetch');
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should retain images with supported formats', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.jpg', alt: '' },
          { src: 'image2.png', alt: '' },
          { src: 'image3.gif', alt: '' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages();

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(3);
    });

    it('should convert and retain unique blobs for supported blob formats', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.tiff', alt: '' },
          { src: 'image2.bmp', alt: '' },
          { src: 'image3.svg', alt: '' }],
      };

      function createRandomArrayBuffer(size) {
        const array = new Uint8Array(size);
        for (let i = 0; i < size; i += 1) {
          array[i] = Math.floor(Math.random() * 256); // Random value between 0 and 255
        }
        return array.buffer;
      }

      tracingFetchStub.resolves({
        ok: true,
        arrayBuffer: async () => createRandomArrayBuffer(256),
        headers: {
          get: sinon.stub().returns('256'),
        },
      });

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages('https://example.com', tracingFetchStub);

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(3);
      expect(auditedImages.imagesWithoutAltText[0].blob).to.exist;
    });

    it('should filter out duplicate blobs', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.svg', alt: '' },
          { src: 'image2.svg', alt: '' },
        ],
      };

      tracingFetchStub.resolves({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: {
          get: sinon.stub().returns('256'),
        },
      });

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages('https://example.com', tracingFetchStub);

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(1);
    });

    it('should filter out images that are too large', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.svg', alt: '' },
          { src: 'image2.svg', alt: '' },
        ],
      };

      tracingFetchStub.resolves({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
        headers: {
          get: sinon.stub().returns(130 * 1024),
        },
      });

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages('https://example.com', tracingFetchStub);

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
    });

    it('should filter out blobs that are too large', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.svg', alt: '' },
          { src: 'image2.svg', alt: '' },
        ],
      };

      tracingFetchStub.resolves({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(130000),
        headers: {
          get: sinon.stub().returns(1024),
        },
      });

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages('https://example.com', tracingFetchStub);

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
    });

    it('should handle bad response from tracingFetch', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.svg', alt: '' },
        ],
      };

      tracingFetchStub.resolves({
        ok: false,
        arrayBuffer: async () => new ArrayBuffer(8),
      });

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages('https://example.com', tracingFetchStub);

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
      expect(logStub.error).to.have.been.calledWithMatch(`[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: Error downloading blob for image1.svg:`);
    });

    it('should handle tracingFetch errors gracefully', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.svg', alt: '' },
        ],
      };

      tracingFetchStub.rejects(new Error('Network error'));

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages();

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
      expect(logStub.error).to.have.been.calledWithMatch(
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: Error downloading blob for image1.svg:`,
      );
    });

    it('should not retain images with unsupported formats', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { src: 'image1.unsupported', alt: '' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      await auditEngine.filterImages();

      const auditedImages = auditEngine.getAuditedTags();
      expect(auditedImages.imagesWithoutAltText).to.have.lengthOf(0);
    });

    it('should handle bad input', async () => {
      const pageUrl = '/test-page';
      const pageTags = {
        images: [
          { someparam: 'image1.svg', alt: '' },
          { src: 'image2.svg', alt: '' },
        ],
      };

      auditEngine.performPageAudit(pageUrl, pageTags);
      auditEngine.auditedImages.imagesWithoutAltText = {};
      await auditEngine.filterImages();

      expect(logStub.error).to.have.been.calledWithMatch(
        `[${AuditModel.AUDIT_TYPES.ALT_TEXT}]: Error processing images for base64 conversion`,
      );
    });
  });

  describe('Language Detection', () => {
    describe('getPageLanguage', () => {
      it('should return the language from the lang attribute', () => {
        const dom = new JSDOM('<html lang="en"><body></body></html>').window.document;
        const lang = getPageLanguage({ document: dom });
        expect(lang).to.equal('en');
      });

      it('should return the language from meta tags', () => {
        const dom = new JSDOM('<html><head><meta http-equiv="Content-Language" content="fr"></head><body></body></html>').window.document;
        const lang = getPageLanguage({ document: dom });
        expect(lang).to.equal('fr');
      });

      it('should return unknown if no language is detected', () => {
        const dom = new JSDOM('<html><body></body></html>').window.document;
        const lang = getPageLanguage({ document: dom });
        expect(lang).to.equal('unknown');
      });
    });

    describe('detectLanguageFromText', () => {
      it('should detect English text', () => {
        const text = 'This is a simple English sentence.';
        const lang = detectLanguageFromText(text);
        expect(lang).to.equal('eng');
      });

      it('should detect French text', () => {
        const text = 'Ceci est une phrase française simple.';
        const lang = detectLanguageFromText(text);
        expect(lang).to.equal('fra');
      });

      it('should return unknown for undetermined language', () => {
        const text = '1234567890';
        const lang = detectLanguageFromText(text);
        expect(lang).to.equal('unknown');
      });
    });
  });
});
