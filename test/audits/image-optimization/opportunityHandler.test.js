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
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import {
  isDynamicMedia,
  getImageFormat,
  calculateSavings,
  chunkArray,
  sendImageOptimizationToAnalyzer,
  addImageOptimizationSuggestions,
  cleanupOutdatedSuggestions,
} from '../../../src/image-optimization/opportunityHandler.js';
import { IMAGE_FORMATS } from '../../../src/image-optimization/constants.js';

use(sinonChai);
use(chaiAsPromised);

describe('isDynamicMedia', () => {
  it('should detect scene7.com URLs', () => {
    expect(isDynamicMedia('https://example.scene7.com/is/image/test.jpg')).to.be.true;
  });

  it('should detect images.adobe.com URLs', () => {
    expect(isDynamicMedia('https://images.adobe.com/is/image/test.jpg')).to.be.true;
  });

  it('should detect /is/image/ paths', () => {
    expect(isDynamicMedia('https://example.com/is/image/test.jpg')).to.be.true;
  });

  it('should detect /is/content/ paths', () => {
    expect(isDynamicMedia('https://example.com/is/content/test.jpg')).to.be.true;
  });

  it('should return false for non-Dynamic Media URLs', () => {
    expect(isDynamicMedia('https://example.com/images/test.jpg')).to.be.false;
  });

  it('should handle null/undefined gracefully', () => {
    expect(isDynamicMedia(null)).to.be.false;
    expect(isDynamicMedia(undefined)).to.be.false;
  });

  it('should be case-insensitive', () => {
    expect(isDynamicMedia('https://example.SCENE7.COM/is/image/test.jpg')).to.be.true;
  });
});

describe('getImageFormat', () => {
  it('should detect AVIF from content-type header', () => {
    const headers = { 'content-type': 'image/avif' };
    expect(getImageFormat('https://example.com/image.jpg', headers)).to.equal(IMAGE_FORMATS.AVIF);
  });

  it('should detect WebP from content-type header', () => {
    const headers = { 'content-type': 'image/webp' };
    expect(getImageFormat('https://example.com/image.jpg', headers)).to.equal(IMAGE_FORMATS.WEBP);
  });

  it('should detect JPEG from content-type header', () => {
    const headers = { 'content-type': 'image/jpeg' };
    expect(getImageFormat('https://example.com/image.png', headers)).to.equal(IMAGE_FORMATS.JPEG);
  });

  it('should detect PNG from content-type header', () => {
    const headers = { 'content-type': 'image/png' };
    expect(getImageFormat('https://example.com/image.jpg', headers)).to.equal(IMAGE_FORMATS.PNG);
  });

  it('should detect GIF from content-type header', () => {
    const headers = { 'content-type': 'image/gif' };
    expect(getImageFormat('https://example.com/image.jpg', headers)).to.equal(IMAGE_FORMATS.GIF);
  });

  it('should detect format from URL extension when no headers', () => {
    expect(getImageFormat('https://example.com/image.avif')).to.equal(IMAGE_FORMATS.AVIF);
    expect(getImageFormat('https://example.com/image.webp')).to.equal(IMAGE_FORMATS.WEBP);
    expect(getImageFormat('https://example.com/image.jpg')).to.equal(IMAGE_FORMATS.JPEG);
    expect(getImageFormat('https://example.com/image.png')).to.equal(IMAGE_FORMATS.PNG);
    expect(getImageFormat('https://example.com/image.gif')).to.equal(IMAGE_FORMATS.GIF);
  });

  it('should detect format from URL parameters', () => {
    expect(getImageFormat('https://example.com/image?fmt=avif')).to.equal(IMAGE_FORMATS.AVIF);
    expect(getImageFormat('https://example.com/image?fmt=webp')).to.equal(IMAGE_FORMATS.WEBP);
  });

  it('should return "unknown" for unrecognized formats', () => {
    expect(getImageFormat('https://example.com/image.svg')).to.equal('unknown');
  });

  it('should prioritize content-type over URL', () => {
    const headers = { 'content-type': 'image/avif' };
    expect(getImageFormat('https://example.com/image.jpg', headers)).to.equal(IMAGE_FORMATS.AVIF);
  });
});

describe('calculateSavings', () => {
  it('should calculate 50% savings for JPEG to AVIF', () => {
    const result = calculateSavings(100000, IMAGE_FORMATS.JPEG);
    expect(result.potentialSavingsBytes).to.equal(50000);
    expect(result.potentialSavingsPercent).to.equal(50);
    expect(result.newSize).to.equal(50000);
  });

  it('should calculate 50% savings for PNG to AVIF', () => {
    const result = calculateSavings(200000, IMAGE_FORMATS.PNG);
    expect(result.potentialSavingsBytes).to.equal(100000);
    expect(result.potentialSavingsPercent).to.equal(50);
    expect(result.newSize).to.equal(100000);
  });

  it('should return zero savings for AVIF images', () => {
    const result = calculateSavings(100000, IMAGE_FORMATS.AVIF);
    expect(result.potentialSavingsBytes).to.equal(0);
    expect(result.potentialSavingsPercent).to.equal(0);
    expect(result.newSize).to.equal(100000);
  });

  it('should handle small file sizes', () => {
    const result = calculateSavings(1000, IMAGE_FORMATS.JPEG);
    expect(result.potentialSavingsBytes).to.equal(500);
    expect(result.potentialSavingsPercent).to.equal(50);
    expect(result.newSize).to.equal(500);
  });

  it('should round projectedSize correctly', () => {
    const result = calculateSavings(1001, IMAGE_FORMATS.JPEG);
    expect(result.newSize).to.equal(501);
  });
});

describe('chunkArray', () => {
  it('should split array into chunks of specified size', () => {
    const array = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = chunkArray(array, 3);
    expect(result).to.deep.equal([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10]]);
  });

  it('should handle array smaller than chunk size', () => {
    const array = [1, 2];
    const result = chunkArray(array, 5);
    expect(result).to.deep.equal([[1, 2]]);
  });

  it('should handle empty array', () => {
    const result = chunkArray([], 5);
    expect(result).to.deep.equal([]);
  });

  it('should handle chunk size of 1', () => {
    const array = [1, 2, 3];
    const result = chunkArray(array, 1);
    expect(result).to.deep.equal([[1], [2], [3]]);
  });

  it('should handle exact multiples', () => {
    const array = [1, 2, 3, 4, 5, 6];
    const result = chunkArray(array, 2);
    expect(result).to.deep.equal([[1, 2], [3, 4], [5, 6]]);
  });
});

describe('sendImageOptimizationToAnalyzer', () => {
  let context;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = {
      sqs: {
        sendMessage: sandbox.stub().resolves(),
      },
      env: {
        QUEUE_SPACECAT_TO_MYSTIQUE: 'test-queue',
      },
      log: {
        debug: sandbox.stub(),
        error: sandbox.stub(),
      },
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves({
            getDeliveryType: () => 'aem_edge',
          }),
        },
      },
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should send URLs to analyzer in batches', async () => {
    const pageUrls = ['url1', 'url2', 'url3'];
    await sendImageOptimizationToAnalyzer(
      'https://example.com',
      pageUrls,
      'site-id',
      'audit-id',
      context,
    );

    expect(context.sqs.sendMessage.callCount).to.equal(1);
    expect(context.log.debug).to.have.been.calledWith(
      sinon.match(/Sending 3 URLs to analyzer/),
    );
  });

  it('should split large URL lists into multiple batches', async () => {
    const pageUrls = Array.from({ length: 25 }, (_, i) => `url${i}`);
    await sendImageOptimizationToAnalyzer(
      'https://example.com',
      pageUrls,
      'site-id',
      'audit-id',
      context,
    );

    expect(context.sqs.sendMessage.callCount).to.equal(3);
  });

  it('should include correct message structure', async () => {
    const pageUrls = ['url1'];
    await sendImageOptimizationToAnalyzer(
      'https://example.com',
      pageUrls,
      'site-id',
      'audit-id',
      context,
    );

    const message = context.sqs.sendMessage.firstCall.args[1];
    expect(message).to.have.property('type', 'guidance:image-optimization');
    expect(message).to.have.property('siteId', 'site-id');
    expect(message).to.have.property('auditId', 'audit-id');
    expect(message).to.have.property('deliveryType', 'aem_edge');
    expect(message.data).to.have.property('pageUrls');
    expect(message.data).to.have.property('analysisType', 'image-optimization');
    expect(message.data).to.have.property('checkDynamicMedia', true);
    expect(message.data).to.have.property('checkAvif', true);
  });

  it('should handle errors properly', async () => {
    context.sqs.sendMessage.rejects(new Error('SQS Error'));

    await expect(
      sendImageOptimizationToAnalyzer(
        'https://example.com',
        ['url1'],
        'site-id',
        'audit-id',
        context,
      ),
    ).to.be.rejectedWith('SQS Error');

    expect(context.log.error).to.have.been.calledWith(
      sinon.match(/Failed to send to analyzer/),
    );
  });
});

describe('addImageOptimizationSuggestions', () => {
  let sandbox;
  let opportunity;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    opportunity = {
      addSuggestions: sandbox.stub(),
      getSiteId: () => 'test-site-id',
    };
    log = {
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should add suggestions successfully', async () => {
    const suggestions = [{ opportunityId: 'test-id', data: {} }];
    opportunity.addSuggestions.resolves({
      createdItems: suggestions,
      errorItems: [],
    });

    await addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs: suggestions, log });

    expect(opportunity.addSuggestions).to.have.been.calledWith(suggestions);
    expect(log.debug).to.have.been.calledWith('[image-optimization]: Added 1 new suggestions');
  });

  it('should handle empty suggestion array', async () => {
    await addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs: [], log });

    expect(opportunity.addSuggestions).to.not.have.been.called;
    expect(log.debug).to.have.been.calledWith('[image-optimization]: No new suggestions to add');
  });

  it('should handle null suggestions', async () => {
    await addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs: null, log });

    expect(opportunity.addSuggestions).to.not.have.been.called;
  });

  it('should handle partial failures', async () => {
    const suggestions = [{ opportunityId: 'test-id', data: {} }];
    opportunity.addSuggestions.resolves({
      createdItems: [suggestions[0]],
      errorItems: [{ item: {}, error: 'Test error' }],
    });

    await addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs: suggestions, log });

    expect(log.error).to.have.been.calledWith(
      sinon.match(/contains 1 items with errors/),
    );
  });

  it('should throw error when all items fail', async () => {
    const suggestions = [{ opportunityId: 'test-id', data: {} }];
    opportunity.addSuggestions.resolves({
      createdItems: [],
      errorItems: [{ item: suggestions[0], error: 'Test error' }],
    });

    await expect(
      addImageOptimizationSuggestions({ opportunity, newSuggestionDTOs: suggestions, log }),
    ).to.be.rejectedWith('[image-optimization]: Failed to create suggestions');
  });
});

describe('cleanupOutdatedSuggestions', () => {
  let sandbox;
  let opportunity;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      debug: sandbox.stub(),
      error: sandbox.stub(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should remove OUTDATED suggestions', async () => {
    const outdatedSuggestion = {
      getStatus: () => 'OUTDATED',
      remove: sandbox.stub().resolves(),
    };
    const newSuggestion = {
      getStatus: () => 'NEW',
      remove: sandbox.stub().resolves(),
    };

    opportunity = {
      getSuggestions: sandbox.stub().resolves([outdatedSuggestion, newSuggestion]),
    };

    await cleanupOutdatedSuggestions(opportunity, log);

    expect(outdatedSuggestion.remove).to.have.been.called;
    expect(newSuggestion.remove).to.not.have.been.called;
    expect(log.debug).to.have.been.calledWith(
      '[image-optimization]: Cleaned up 1 OUTDATED suggestions',
    );
  });

  it('should handle no OUTDATED suggestions', async () => {
    const newSuggestion = {
      getStatus: () => 'NEW',
      remove: sandbox.stub().resolves(),
    };

    opportunity = {
      getSuggestions: sandbox.stub().resolves([newSuggestion]),
    };

    await cleanupOutdatedSuggestions(opportunity, log);

    expect(newSuggestion.remove).to.not.have.been.called;
    expect(log.debug).to.have.been.calledWith(
      '[image-optimization]: No OUTDATED suggestions to clean up',
    );
  });

  it('should handle errors gracefully', async () => {
    opportunity = {
      getSuggestions: sandbox.stub().rejects(new Error('Database error')),
    };

    await cleanupOutdatedSuggestions(opportunity, log);

    expect(log.error).to.have.been.calledWith(
      sinon.match(/Failed to cleanup OUTDATED suggestions/),
    );
  });
});

