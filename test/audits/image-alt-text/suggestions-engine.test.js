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
import { FirefallClient } from '@adobe/spacecat-shared-gpt-client';
import suggestionsEngine from '../../../src/image-alt-text/suggestionsEngine.js';

describe('getImageSuggestions', () => {
  let context;
  let firefallClientStub;

  beforeEach(() => {
    context = {
      log: {
        info: sinon.stub(),
        error: sinon.stub(),
      },
    };

    firefallClientStub = sinon.createStubInstance(FirefallClient);
    firefallClientStub.fetchChatCompletion.resolves({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { image_url: 'http://example.com/image1.png', alt_text: 'Image 1 description' },
              { image_url: 'http://example.com/image2.png', alt_text: 'Image 2 description' },
            ]),
          },
          finish_reason: 'stop',
        },
      ],
    });

    sinon.stub(FirefallClient, 'createFrom').returns(firefallClientStub);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('should return expected finalResults for a happy path', async () => {
    const imageUrls = [
      'https://example.com/image1.png',
      'https://example.com/image2.png',
    ];
    const auditUrl = 'https://example.com';

    const expectedResults = {
      'http://example.com/image1.png': { image_url: 'http://example.com/image1.png', alt_text: 'Image 1 description' },
      'http://example.com/image2.png': { image_url: 'http://example.com/image2.png', alt_text: 'Image 2 description' },
    };

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(result).to.deep.equal(expectedResults);
    expect(context.log.info.called).to.be.true;
    expect(context.log.error.called).to.be.false;
  });

  it('should handle unsupported image formats', async () => {
    const imageUrls = [
      'http://example.com/image1.bmp',
      'http://example.com/image2.tiff',
    ];
    const auditUrl = 'http://example.com';

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(result).to.deep.equal({});
    expect(context.log.info.calledWith('[alt-text] Unsupported format images:', ['http://example.com/image1.bmp', 'http://example.com/image2.tiff'])).to.be.true;
  });

  it('should handle images not from host', async () => {
    const imageUrls = [
      'http://other.com/image1.png',
      'http://other.com/image2.png',
    ];
    const auditUrl = 'http://example.com';

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(result).to.deep.equal({});
    expect(context.log.info.calledWith('[alt-text] Other images:', ['http://other.com/image1.png', 'http://other.com/image2.png'])).to.be.true;
  });

  it('should handle errors from FirefallClient', async () => {
    firefallClientStub.fetchChatCompletion.rejects(new Error('Firefall error'));

    const imageUrls = [
      'http://example.com/image1.png',
    ];
    const auditUrl = 'http://example.com';

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(result).to.deep.equal({});
    expect(context.log.error.calledWith('[alt-text] Error calling Firefall for alt-text suggestion generation for batch')).to.be.true;
  });

  it('should handle empty image list', async () => {
    const imageUrls = [];
    const auditUrl = 'http://example.com';

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(result).to.deep.equal({});
    expect(context.log.info.calledWith('[alt-text] Total images from host:', 0)).to.be.true;
  });

  it('cristoiddio', async () => {
    firefallClientStub.fetchChatCompletion.resolves({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { image_url: 'http://example.com/image1.png', alt_text: 'Image 1 description' },
              { image_url: 'http://example.com/image2.png', alt_text: 'Image 2 description' },
            ]),
          },
          finish_reason: 'somethingelse',
        },
      ],
    });
    const imageUrls = [
      'http://example.com/special-case-image.png',
    ];
    const auditUrl = 'http://example.com';

    await suggestionsEngine.getImageSuggestions(imageUrls, auditUrl, context);

    expect(context.log.error.calledWith('[alt-text] No final suggestions found for batch')).to.be.true;
  });
});
