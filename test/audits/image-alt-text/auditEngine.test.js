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
import AuditEngine from '../../../src/image-alt-text/auditEngine.js';

describe('Image Alt Text Audit Engine', () => {
  let logStub;
  let auditEngine;

  beforeEach(() => {
    sinon.restore();

    logStub = {
      info: sinon.stub(),
      debug: sinon.stub(),
      error: sinon.stub(),
    };

    auditEngine = new AuditEngine(logStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should skip presentational images when auditing for alt text', () => {
    // Setup test data with a mix of presentational and non-presentational images
    const pageUrl = '/test-page';
    const pageTags = {
      images: [
        // Image 1: Presentational image without alt text - should be skipped
        {
          isPresentational: true,
          src: '/image1.jpg',
          alt: null,
        },
        // Image 2: Presentational image with alt text - should still be skipped
        {
          isPresentational: true,
          src: '/image2.jpg',
          alt: 'This alt text is redundant for presentational images',
        },
        // Image 3: Non-presentational image without alt text - should be flagged
        {
          isPresentational: false,
          src: '/image3.jpg',
          alt: null,
        },
        // Image 4: Non-presentational image with alt text - should be fine
        {
          isPresentational: false,
          src: '/image4.jpg',
          alt: 'This is proper alt text',
        },
        // Image 5: Non-presentational image with empty alt text - should be flagged
        {
          isPresentational: false,
          src: '/image5.jpg',
          alt: '',
        },
      ],
    };

    // Perform the audit
    auditEngine.performPageAudit(pageUrl, pageTags);

    // Finalize audit to ensure logs are generated
    auditEngine.finalizeAudit();

    // Get audited tags
    const auditedTags = auditEngine.getAuditedTags();

    // Verify that only the non-presentational images without alt text were flagged
    expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(2);

    // Verify that Image 3 (non-presentational without alt) is in the results
    expect(auditedTags.imagesWithoutAltText.some((img) => img.src === '/image3.jpg')).to.be.true;

    // Verify that Image 5 (non-presentational with empty alt) is in the results
    expect(auditedTags.imagesWithoutAltText.some((img) => img.src === '/image5.jpg')).to.be.true;

    // Verify that Image 1 and Image 2 (presentational) are NOT in the results
    expect(auditedTags.imagesWithoutAltText.some((img) => img.src === '/image1.jpg')).to.be.false;
    expect(auditedTags.imagesWithoutAltText.some((img) => img.src === '/image2.jpg')).to.be.false;

    // Verify that Image 4 (with alt text) is NOT in the results
    expect(auditedTags.imagesWithoutAltText.some((img) => img.src === '/image4.jpg')).to.be.false;

    // Verify correct logging
    expect(logStub.info.calledWith(sinon.match(/Found 2 images without alt text/))).to.be.true;
  });

  it('should handle empty image arrays', () => {
    const pageUrl = '/empty-page';
    const pageTags = { images: [] };

    auditEngine.performPageAudit(pageUrl, pageTags);
    auditEngine.finalizeAudit();

    const auditedTags = auditEngine.getAuditedTags();
    expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(0);
    expect(logStub.debug.calledWith(sinon.match(/No images found for page/))).to.be.true;
  });

  it('should handle undefined images', () => {
    const pageUrl = '/no-images-page';
    const pageTags = { notImages: [] }; // No images key

    auditEngine.performPageAudit(pageUrl, pageTags);
    auditEngine.finalizeAudit();

    const auditedTags = auditEngine.getAuditedTags();
    expect(auditedTags.imagesWithoutAltText).to.have.lengthOf(0);
    expect(logStub.debug.calledWith(sinon.match(/No images found for page/))).to.be.true;
  });
});
