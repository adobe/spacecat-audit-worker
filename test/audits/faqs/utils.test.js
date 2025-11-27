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
import esmock from 'esmock';
import { getJsonFaqSuggestion } from '../../../src/faqs/utils.js';

use(sinonChai);

describe('FAQ Utils', () => {
  describe('getJsonFaqSuggestion', () => {
    it('should generate one suggestion per question with url and topic', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'How to use Photoshop?',
              answer: 'Photoshop is a powerful image editing tool.',
              sources: [{ url: 'https://www.adobe.com/guides' }],
              questionRelevanceReason: 'Relevant to photoshop',
              answerSuitabilityReason: 'Good answer quality',
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(1);
      expect(suggestions[0].headingText).to.equal('FAQs');
      expect(suggestions[0].shouldOptimize).to.equal(true);
      expect(suggestions[0].url).to.equal('https://www.adobe.com/products/photoshop');
      expect(suggestions[0].topic).to.equal('photoshop');
      expect(suggestions[0].item.question).to.equal('How to use Photoshop?');
      expect(suggestions[0].item.answer).to.equal('Photoshop is a powerful image editing tool.');
      expect(suggestions[0].item.sources).to.deep.equal(['https://www.adobe.com/guides']);
      expect(suggestions[0].item.questionRelevanceReason).to.equal('Relevant to photoshop');
      expect(suggestions[0].item.answerSuitabilityReason).to.equal('Good answer quality');
      expect(suggestions[0].transformRules).to.deep.equal({
        selector: 'body',
        action: 'appendChild',
      });
    });

    it('should create separate suggestions for multiple FAQs per URL', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question 1?',
              answer: 'Answer 1.',
              sources: [],
            },
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question 2?',
              answer: 'Answer 2.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.have.lengthOf(2);
      expect(suggestions[0].item.question).to.equal('Question 1?');
      expect(suggestions[0].item.answer).to.equal('Answer 1.');
      expect(suggestions[1].item.question).to.equal('Question 2?');
      expect(suggestions[1].item.answer).to.equal('Answer 2.');
    });

    it('should filter out unsuitable suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Good question?',
              answer: 'Good answer.',
              sources: [],
            },
            {
              isAnswerSuitable: false,
              isQuestionRelevant: true,
              question: 'Bad answer question?',
              answer: 'Bad answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.have.lengthOf(1);
      expect(suggestions[0].item.question).to.equal('Good question?');
    });

    it('should filter out irrelevant suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: false,
              question: 'Irrelevant question?',
              answer: 'Good answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(0);
    });

    it('should handle FAQs with no URL (empty string)', () => {
      const faqs = [
        {
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(1);
      expect(suggestions[0].url).to.equal('');
      expect(suggestions[0].topic).to.equal('test');
    });

    it('should handle FAQs with no topic (empty string)', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(1);
      expect(suggestions[0].url).to.equal('https://www.adobe.com/products/test');
      expect(suggestions[0].topic).to.equal('');
    });

    it('should handle multiple FAQs with different URLs', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Photoshop question?',
              answer: 'Photoshop answer.',
              sources: [],
            },
          ],
        },
        {
          url: 'https://www.adobe.com/products/illustrator',
          topic: 'illustrator',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Illustrator question?',
              answer: 'Illustrator answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(2);
      expect(suggestions[0].url).to.equal('https://www.adobe.com/products/photoshop');
      expect(suggestions[1].url).to.equal('https://www.adobe.com/products/illustrator');
    });

    it('should handle empty FAQ array', () => {
      const faqs = [];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(0);
    });

    it('should handle FAQs with undefined suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test1',
          topic: 'test1',
          // No faqs property
        },
        {
          url: 'https://www.adobe.com/products/test2',
          topic: 'test2',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Q2?',
              answer: 'A2.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(1);
      expect(suggestions[0].url).to.equal('https://www.adobe.com/products/test2');
    });

    it('should normalize sources to array of URL strings', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { title: 'Source 1', url: 'https://example.com/1' },
                { url: 'https://example.com/2' },
                { link: 'https://example.com/3' },
                'https://example.com/4',
              ],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions[0].item.sources).to.deep.equal([
        'https://example.com/1',
        'https://example.com/2',
        'https://example.com/3',
        'https://example.com/4',
      ]);
    });

    it('should handle suggestions with missing sources', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              // No sources property
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions[0].item.sources).to.deep.equal([]);
    });

    it('should handle sources with only link key', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { link: 'https://example.com/1' },
                { link: 'https://example.com/2' },
              ],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions[0].item.sources).to.deep.equal([
        'https://example.com/1',
        'https://example.com/2',
      ]);
    });

    it('should filter out invalid source entries', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { url: 'https://example.com/1' },
                null,
                undefined,
                {},
                { title: 'No URL' },
                'https://example.com/2',
              ],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions[0].item.sources).to.deep.equal([
        'https://example.com/1',
        'https://example.com/2',
      ]);
    });

    it('should use provided scrapedAt timestamp when available', () => {
      const testTimestamp = '2025-11-17T18:53:21.143931';
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
              scrapedAt: testTimestamp,
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.have.length(1);
      expect(suggestions[0].item.scrapedAt).to.equal(testTimestamp);
    });

    it('should generate current timestamp when scrapedAt is missing', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          faqs: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
              // No scrapedAt property
            },
          ],
        },
      ];

      const beforeTime = new Date().toISOString();
      const suggestions = getJsonFaqSuggestion(faqs);
      const afterTime = new Date().toISOString();

      expect(suggestions).to.have.length(1);
      expect(suggestions[0].item.scrapedAt).to.be.a('string');
      expect(suggestions[0].item.scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // Timestamp should be between before and after
      expect(suggestions[0].item.scrapedAt >= beforeTime).to.be.true;
      expect(suggestions[0].item.scrapedAt <= afterTime).to.be.true;
    });
  });

  describe('validateContentAI', () => {
    let sandbox;
    let mockContentAIClient;
    let validateContentAI;
    let context;
    let site;

    beforeEach(async () => {
      sandbox = sinon.createSandbox();

      context = {
        log: {
          info: sandbox.stub(),
          warn: sandbox.stub(),
          error: sandbox.stub(),
        },
        env: {
          CONTENTAI_ENDPOINT: 'https://contentai-api.adobe.io',
          CONTENTAI_IMS_HOST: 'ims-na1.adobelogin.com',
          CONTENTAI_IMS_CLIENT_ID: 'test-client-id',
          CONTENTAI_IMS_CLIENT_SECRET: 'test-client-secret',
          CONTENTAI_IMS_TECHNICAL_ACCOUNT_ID: 'test-technical-account-id',
        },
      };

      site = {
        getBaseURL: sandbox.stub().returns('https://example.com'),
        getId: sandbox.stub().returns('site-123'),
        getConfig: sandbox.stub().returns(null),
      };

      mockContentAIClient = {
        initialize: sandbox.stub().resolves(),
        getConfigurationForSite: sandbox.stub(),
        runSemanticSearch: sandbox.stub(),
      };

      const utils = await esmock('../../../src/faqs/utils.js', {
        '../../../src/utils/content-ai.js': {
          ContentAIClient: sandbox.stub().returns(mockContentAIClient),
        },
      });

      validateContentAI = utils.validateContentAI;
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should return valid result when configuration exists and search works', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'index', name: 'test-index' },
          { type: 'generative', prompt: 'test-prompt' },
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: true, status: 200 });

      const result = await validateContentAI(site, context);

      expect(result).to.deep.equal({
        uid: 'config-uid-123',
        indexName: 'test-index',
        genSearchEnabled: true,
        isWorking: true,
      });
      expect(context.log.info).to.have.been.calledWith('[ContentAI] Found configuration with UID: config-uid-123, index name: test-index');
      expect(context.log.info).to.have.been.calledWith('[ContentAI] Search endpoint validation: 200 (working)');
    });

    it('should return false for genSearchEnabled when generative step is empty', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'index', name: 'test-index' },
          { type: 'generative' }, // Empty generative step
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: true, status: 200 });

      const result = await validateContentAI(site, context);

      expect(result.genSearchEnabled).to.be.false;
    });

    it('should return false for genSearchEnabled when no generative step exists', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'index', name: 'test-index' },
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: true, status: 200 });

      const result = await validateContentAI(site, context);

      expect(result.genSearchEnabled).to.be.false;
    });

    it('should return false for isWorking when search fails', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'index', name: 'test-index' },
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: false, status: 500 });

      const result = await validateContentAI(site, context);

      expect(result.isWorking).to.be.false;
      expect(context.log.info).to.have.been.calledWith('[ContentAI] Search endpoint validation: 500 (not working)');
    });

    it('should return null values when no configuration exists', async () => {
      mockContentAIClient.getConfigurationForSite.resolves(null);

      const result = await validateContentAI(site, context);

      expect(result).to.deep.equal({
        uid: null,
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      });
      expect(context.log.warn).to.have.been.calledWith('[ContentAI] No configuration found for site https://example.com');
    });

    it('should return null indexName when no index step exists', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'generative', prompt: 'test-prompt' },
        ],
      });

      const result = await validateContentAI(site, context);

      expect(result).to.deep.equal({
        uid: 'config-uid-123',
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      });
      expect(context.log.warn).to.have.been.calledWith('[ContentAI] No index name found in configuration for site https://example.com');
    });

    it('should handle configuration with no steps array', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        // No steps
      });

      const result = await validateContentAI(site, context);

      expect(result).to.deep.equal({
        uid: 'config-uid-123',
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      });
    });

    it('should handle errors and return null values', async () => {
      mockContentAIClient.initialize.rejects(new Error('Initialization failed'));

      const result = await validateContentAI(site, context);

      expect(result).to.deep.equal({
        uid: null,
        indexName: null,
        genSearchEnabled: false,
        isWorking: false,
      });
      expect(context.log.error).to.have.been.calledWith('[ContentAI] Validation failed: Initialization failed');
    });

    it('should handle configuration with no uid', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        // No uid
        steps: [
          { type: 'index', name: 'test-index' },
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: true, status: 200 });

      const result = await validateContentAI(site, context);

      expect(result.uid).to.be.null;
      expect(result.indexName).to.equal('test-index');
    });

    it('should call runSemanticSearch with correct parameters', async () => {
      mockContentAIClient.getConfigurationForSite.resolves({
        uid: 'config-uid-123',
        steps: [
          { type: 'index', name: 'test-index' },
        ],
      });
      mockContentAIClient.runSemanticSearch.resolves({ ok: true, status: 200 });

      await validateContentAI(site, context);

      expect(mockContentAIClient.runSemanticSearch).to.have.been.calledWith(
        'website',
        'vector',
        'test-index',
        {
          numCandidates: 3,
          boost: 1,
        },
        1,
      );
    });
  });
});

