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
              { image_url: 'http://example.com/image1.png', suggestion: 'Image 1 description' },
              { image_url: 'http://example.com/image2.png', suggestion: 'Image 2 description' },
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
    const images = [
      { url: 'https://example.com/image1.png' },
      { url: 'https://example.com/image2.png' },
    ];
    const expectedResults = {
      'http://example.com/image1.png': { image_url: 'http://example.com/image1.png', suggestion: 'Image 1 description' },
      'http://example.com/image2.png': { image_url: 'http://example.com/image2.png', suggestion: 'Image 2 description' },
    };

    const result = await suggestionsEngine.getImageSuggestions(images, context);

    expect(result).to.deep.equal(expectedResults);
    expect(context.log.info.called).to.be.true;
    expect(context.log.error.called).to.be.false;
  });

  it('should handle unsupported image formats', async () => {
    const images = [
      { url: 'http://example.com/image1.bmp', blob: {} },
      { url: 'http://example.com/image2.tiff', blob: {} },
    ];

    await suggestionsEngine.getImageSuggestions(images, context);

    expect(firefallClientStub.fetchChatCompletion).to.have.been.calledWith(
      sinon.match((value) => typeof value === 'string' && value.includes(JSON.stringify(images))),
    );
  });

  it('should handle errors from FirefallClient', async () => {
    firefallClientStub.fetchChatCompletion.rejects(new Error('Firefall error'));

    const images = [
      { url: 'http://example.com/image1.bmp', blob: 'some blob' },
      { url: 'http://example.com/image2.tiff', blob: 'some other blob' },
    ];

    const result = await suggestionsEngine.getImageSuggestions(images, context);

    expect(result).to.deep.equal({});
    expect(context.log.error.calledWith('[alt-text]: Error calling Firefall for alt-text suggestion generation for batch')).to.be.true;
  });

  it('should handle empty image list', async () => {
    const imageUrls = [];

    const result = await suggestionsEngine.getImageSuggestions(imageUrls, context);

    expect(result).to.deep.equal({});
  });

  it('should handle finish_reason not being a stop', async () => {
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
    const images = [
      { url: 'http://example.com/image1.bmp', blob: 'some blob' },
      { url: 'http://example.com/image2.tiff', blob: 'some other blob' },
    ];

    await suggestionsEngine.getImageSuggestions(images, context);

    expect(context.log.error.calledWith('[alt-text]: No final suggestions found for batch')).to.be.true;
  });
});
