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
    it('should generate JSON suggestions with markdown text and data items', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          suggestions: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'How to use Photoshop?',
              answer: 'Photoshop is a powerful image editing tool.',
              sources: [{ url: 'https://www.adobe.com/guides' }],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(1);
      expect(suggestions[0].text).to.equal('## FAQs\n\n### How to use Photoshop?\n\nPhotoshop is a powerful image editing tool.');
      expect(suggestions[0].url).to.equal('https://www.adobe.com/products/photoshop');
      expect(suggestions[0].data.items).to.deep.equal([
        {
          question: 'How to use Photoshop?',
          answer: 'Photoshop is a powerful image editing tool.',
          sources: [{ url: 'https://www.adobe.com/guides' }],
        },
      ]);
      expect(suggestions[0].transformRules).to.deep.equal({
        selector: 'body',
        action: 'appendChild',
      });
    });

    it('should generate markdown with multiple FAQs', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
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

      expect(suggestions[0].text).to.equal('## FAQs\n\n### Question 1?\n\nAnswer 1.\n\n### Question 2?\n\nAnswer 2.');
      expect(suggestions[0].data.items).to.have.lengthOf(2);
    });

    it('should filter out unsuitable suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
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

      expect(suggestions[0].data.items).to.have.lengthOf(1);
      expect(suggestions[0].text).to.include('Good question?');
      expect(suggestions[0].text).not.to.include('Bad answer question?');
    });

    it('should filter out irrelevant suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
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

    it('should skip FAQs with no URL', () => {
      const faqs = [
        {
          topic: 'test',
          suggestions: [
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

      expect(suggestions).to.be.an('array').with.lengthOf(0);
    });

    it('should skip FAQs with no suitable suggestions', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
            {
              isAnswerSuitable: false,
              isQuestionRelevant: false,
              question: 'Bad question?',
              answer: 'Bad answer.',
              sources: [],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions).to.be.an('array').with.lengthOf(0);
    });

    it('should handle multiple FAQs with different URLs', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/photoshop',
          topic: 'photoshop',
          suggestions: [
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
          suggestions: [
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
          // No suggestions property
        },
        {
          url: 'https://www.adobe.com/products/test2',
          topic: 'test2',
          suggestions: [
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

    it('should preserve sources in data.items', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
            {
              isAnswerSuitable: true,
              isQuestionRelevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { title: 'Source 1', url: 'https://example.com/1' },
                { url: 'https://example.com/2' },
              ],
            },
          ],
        },
      ];

      const suggestions = getJsonFaqSuggestion(faqs);

      expect(suggestions[0].data.items[0].sources).to.deep.equal([
        { title: 'Source 1', url: 'https://example.com/1' },
        { url: 'https://example.com/2' },
      ]);
    });

    it('should handle suggestions with missing sources', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
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

      expect(suggestions[0].data.items[0].sources).to.deep.equal([]);
    });

    it('should trim markdown text correctly', () => {
      const faqs = [
        {
          url: 'https://www.adobe.com/products/test',
          topic: 'test',
          suggestions: [
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

      // Check that there's no trailing whitespace
      expect(suggestions[0].text).to.equal('## FAQs\n\n### Question?\n\nAnswer.');
      expect(suggestions[0].text.endsWith('\n\n')).to.be.false;
    });
  });
});

