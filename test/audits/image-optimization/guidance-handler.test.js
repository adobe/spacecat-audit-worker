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
import esmock from 'esmock';

use(sinonChai);
use(chaiAsPromised);

describe('Image Optimization Guidance Handler', () => {
  let sandbox;
  let context;
  let mockOpportunity;
  let mockSite;
  let mockMessage;
  let guidanceHandler;
  let addImageOptimizationSuggestionsStub;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    mockOpportunity = {
      getId: () => 'opportunity-id',
      setAuditId: sandbox.stub(),
      setData: sandbox.stub(),
      getData: sandbox.stub().returns({
        totalImages: 0,
        dynamicMediaImages: 0,
        nonDynamicMediaImages: 0,
        avifImages: 0,
        potentialSavingsBytes: 0,
        potentialSavingsPercent: 0,
        analyzerResponsesReceived: 0,
        processedAnalysisIds: [],
      }),
      save: sandbox.stub().resolves(),
      getType: () => 'image-optimization',
      getSiteId: () => 'site-id',
      setUpdatedBy: sandbox.stub(),
    };

    mockSite = {
      getId: () => 'test-site-id',
      getBaseURL: () => 'https://example.com',
    };

    context = {
      log: {
        info: sandbox.stub(),
        debug: sandbox.stub(),
        error: sandbox.stub(),
        warn: sandbox.stub(),
      },
      dataAccess: {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([mockOpportunity]),
        },
        Site: {
          findById: sandbox.stub().resolves(mockSite),
        },
        Audit: {
          findById: sandbox.stub().resolves({ getId: () => 'test-audit-id' }),
        },
      },
    };

    mockMessage = {
      type: 'guidance:image-optimization',
      siteId: 'test-site-id',
      auditId: 'test-audit-id',
      url: 'https://example.com',
      id: 'message-id-123',
      data: {
        imageAnalysisResults: [
          {
            pageUrl: 'https://example.com/page1',
            imageUrl: 'https://example.com/image1.jpg',
            currentFormat: 'jpeg',
            currentSize: 100000,
            xpath: '/html/body/img[1]',
            dimensions: { width: 1920, height: 1080 },
          },
        ],
      },
    };

    addImageOptimizationSuggestionsStub = sandbox.stub().resolves();

    guidanceHandler = await esmock('../../../src/image-optimization/guidance-handler.js', {
      '../../../src/image-optimization/opportunityHandler.js': {
        addImageOptimizationSuggestions: addImageOptimizationSuggestionsStub,
        calculateSavings: (size, format) => {
          if (format === 'avif') {
            return { potentialSavingsBytes: 0, potentialSavingsPercent: 0, newSize: size };
          }
          return {
            potentialSavingsBytes: Math.round(size * 0.5),
            potentialSavingsPercent: 50,
            newSize: Math.round(size * 0.5),
          };
        },
        isDynamicMedia: (url) => url.includes('scene7.com'),
      },
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Processing image analysis results', () => {
    it('should process results and create suggestions', async () => {
      const response = await guidanceHandler.default(mockMessage, context);

      expect(response.status).to.equal(200);
      expect(addImageOptimizationSuggestionsStub).to.have.been.called;
      expect(mockOpportunity.save).to.have.been.called;
    });

    it('should return notFound when audit does not exist', async () => {
      context.dataAccess.Audit.findById.resolves(null);

      const response = await guidanceHandler.default(mockMessage, context);

      expect(response.status).to.equal(404);
      expect(context.log.warn).to.have.been.calledWith(
        '[image-optimization]: No audit found for auditId: test-audit-id',
      );
    });

    it('should throw error when opportunity does not exist', async () => {
      context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);

      await expect(
        guidanceHandler.default(mockMessage, context),
      ).to.be.rejectedWith('No existing opportunity found');
    });

    it('should skip processing for duplicate message IDs', async () => {
      mockOpportunity.getData.returns({
        processedAnalysisIds: ['message-id-123'],
      });

      const response = await guidanceHandler.default(mockMessage, context);

      expect(response.status).to.equal(200);
      expect(addImageOptimizationSuggestionsStub).to.not.have.been.called;
      expect(context.log.info).to.have.been.calledWith(
        '[image-optimization]: Analysis message-id-123 already processed. Skipping.',
      );
    });

    it('should filter out AVIF images from suggestions', async () => {
      mockMessage.data.imageAnalysisResults = [
        {
          pageUrl: 'https://example.com/page1',
          imageUrl: 'https://example.com/image1.avif',
          currentFormat: 'avif',
          currentSize: 50000,
        },
        {
          pageUrl: 'https://example.com/page2',
          imageUrl: 'https://example.com/image2.jpg',
          currentFormat: 'jpeg',
          currentSize: 100000,
        },
      ];

      await guidanceHandler.default(mockMessage, context);

      const suggestions = addImageOptimizationSuggestionsStub.firstCall.args[0].newSuggestionDTOs;
      expect(suggestions).to.have.lengthOf(1);
      expect(suggestions[0].data.recommendations[0].imageUrl).to.include('image2.jpg');
    });

    it('should calculate aggregate metrics correctly', async () => {
      mockMessage.data.imageAnalysisResults = [
        {
          pageUrl: 'https://example.com/page1',
          imageUrl: 'https://example.com/image1.jpg',
          currentFormat: 'jpeg',
          currentSize: 100000,
        },
        {
          pageUrl: 'https://example.com/page2',
          imageUrl: 'https://example.scene7.com/image2.jpg',
          currentFormat: 'jpeg',
          currentSize: 200000,
        },
      ];

      await guidanceHandler.default(mockMessage, context);

      expect(mockOpportunity.setData).to.have.been.called;
      const updatedData = mockOpportunity.setData.firstCall.args[0];
      expect(updatedData.totalImages).to.equal(2);
      expect(updatedData.dynamicMediaImages).to.equal(1);
      expect(updatedData.nonDynamicMediaImages).to.equal(1);
      expect(updatedData.potentialSavingsBytes).to.equal(150000);
      expect(updatedData.potentialSavingsPercent).to.equal(50);
    });

    it('should increment analyzerResponsesReceived', async () => {
      await guidanceHandler.default(mockMessage, context);

      const updatedData = mockOpportunity.setData.firstCall.args[0];
      expect(updatedData.analyzerResponsesReceived).to.equal(1);
    });

    it('should add message ID to processedAnalysisIds', async () => {
      await guidanceHandler.default(mockMessage, context);

      const updatedData = mockOpportunity.setData.firstCall.args[0];
      expect(updatedData.processedAnalysisIds).to.include('message-id-123');
    });

    it('should set audit ID and updatedBy', async () => {
      await guidanceHandler.default(mockMessage, context);

      expect(mockOpportunity.setAuditId).to.have.been.calledWith('test-audit-id');
      expect(mockOpportunity.setUpdatedBy).to.have.been.calledWith('system');
    });

    it('should handle empty image analysis results', async () => {
      mockMessage.data.imageAnalysisResults = [];

      const response = await guidanceHandler.default(mockMessage, context);

      expect(response.status).to.equal(200);
      expect(context.log.info).to.have.been.calledWith(
        '[image-optimization]: No image analysis results to process for siteId: test-site-id',
      );
    });

    it('should handle missing data field', async () => {
      mockMessage.data = null;

      const response = await guidanceHandler.default(mockMessage, context);

      expect(response.status).to.equal(200);
      expect(addImageOptimizationSuggestionsStub).to.not.have.been.called;
    });

    it('should log processing summary', async () => {
      await guidanceHandler.default(mockMessage, context);

      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/Processed 1 images/),
      );
      expect(context.log.debug).to.have.been.calledWith(
        sinon.match(/Potential savings:/),
      );
    });

    it('should create suggestions with correct structure', async () => {
      await guidanceHandler.default(mockMessage, context);

      const suggestions = addImageOptimizationSuggestionsStub.firstCall.args[0].newSuggestionDTOs;
      expect(suggestions).to.have.lengthOf(1);

      const suggestion = suggestions[0];
      expect(suggestion).to.have.property('opportunityId', 'opportunity-id');
      expect(suggestion).to.have.property('type', 'CONTENT_UPDATE');
      expect(suggestion).to.have.property('rank', 50);

      const recommendation = suggestion.data.recommendations[0];
      expect(recommendation).to.have.property('pageUrl', 'https://example.com/page1');
      expect(recommendation).to.have.property('imageUrl', 'https://example.com/image1.jpg');
      expect(recommendation).to.have.property('currentFormat', 'jpeg');
      expect(recommendation).to.have.property('currentSize', 100000);
      expect(recommendation).to.have.property('recommendedFormat', 'avif');
      expect(recommendation).to.have.property('projectedSize', 50000);
      expect(recommendation).to.have.property('potentialSavingsBytes', 50000);
      expect(recommendation).to.have.property('potentialSavingsPercent', 50);
    });

    it('should handle opportunity with existing data', async () => {
      mockOpportunity.getData.returns({
        totalImages: 10,
        dynamicMediaImages: 5,
        nonDynamicMediaImages: 5,
        avifImages: 2,
        potentialSavingsBytes: 100000,
        potentialSavingsPercent: 40,
        analyzerResponsesReceived: 1,
        processedAnalysisIds: ['previous-id'],
      });

      await guidanceHandler.default(mockMessage, context);

      const updatedData = mockOpportunity.setData.firstCall.args[0];
      expect(updatedData.totalImages).to.equal(11);
      expect(updatedData.potentialSavingsBytes).to.equal(150000);
      expect(updatedData.analyzerResponsesReceived).to.equal(2);
      expect(updatedData.processedAnalysisIds).to.deep.equal(['previous-id', 'message-id-123']);
    });

    it('should detect Dynamic Media images correctly', async () => {
      mockMessage.data.imageAnalysisResults = [
        {
          pageUrl: 'https://example.com/page1',
          imageUrl: 'https://example.scene7.com/is/image/test.jpg',
          currentFormat: 'jpeg',
          currentSize: 100000,
        },
      ];

      await guidanceHandler.default(mockMessage, context);

      const suggestions = addImageOptimizationSuggestionsStub.firstCall.args[0].newSuggestionDTOs;
      expect(suggestions[0].data.recommendations[0].isDynamicMedia).to.be.true;
    });
  });
});

