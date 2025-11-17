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
import { getJsonFaqSuggestion } from '../../../src/faqs/utils.js';

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

  });
});

