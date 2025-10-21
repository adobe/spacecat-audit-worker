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
import { getFaqMarkdown } from '../../../src/faqs/utils.js';

use(sinonChai);

describe('FAQ Utils', () => {
  describe('getFaqMarkdown', () => {
    let log;

    beforeEach(() => {
      log = {
        info: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      };
    });

    it('should generate markdown for FAQ with URL and topic', () => {
      const faqs = [
        {
          url: 'https://www.bulk.com/uk/sports-nutrition/creatine',
          topic: 'creatine',
          prompts: ['Is Bulk Creatine a good brand?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Is Bulk Creatine a good brand?',
              answer: 'Bulk Creatine is recognized for its high quality.',
              sources: [
                { url: 'https://www.bulk.com/uk/products/creapure' },
              ],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('## 1. Target URL: [/uk/sports-nutrition/creatine](https://www.bulk.com/uk/sports-nutrition/creatine)');
      expect(markdown).to.include('**Topic:** creatine');
      expect(markdown).to.include('**Related Search Queries:**');
      expect(markdown).to.include('- Is Bulk Creatine a good brand?');
      expect(markdown).to.include('### Suggested FAQs');
      expect(markdown).to.include('#### Is Bulk Creatine a good brand?');
      expect(markdown).to.include('*AI suggested answer:* Bulk Creatine is recognized for its high quality.');
      expect(markdown).to.include('**Sources:**');
      expect(markdown).to.include('- https://www.bulk.com/uk/products/creapure');
    });

    it('should generate markdown with topic as heading when no URL', () => {
      const faqs = [
        {
          topic: 'general nutrition',
          prompts: ['What is protein?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'What is protein?',
              answer: 'Protein is an essential macronutrient.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('## 1. Topic: general nutrition');
      expect(markdown).to.include('#### What is protein?');
      expect(markdown).to.include('*AI suggested answer:* Protein is an essential macronutrient.');
    });

    it('should skip heading when no URL and no topic', () => {
      const faqs = [
        {
          prompts: ['Generic question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Generic question?',
              answer: 'Generic answer.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).not.to.include('## 1.');
      expect(markdown).to.include('**Related Search Queries:**');
      expect(markdown).to.include('#### Generic question?');
    });

    it('should not show topic subtitle if URL exists but topic is empty', () => {
      const faqs = [
        {
          url: 'https://www.bulk.com/uk/test',
          prompts: ['Test question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Test question?',
              answer: 'Test answer.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('## 1. Target URL: [/uk/test](https://www.bulk.com/uk/test)');
      expect(markdown).not.to.include('**Topic:**');
    });

    it('should filter out unsuitable suggestions', () => {
      const faqs = [
        {
          url: 'https://www.bulk.com/uk/test',
          topic: 'test',
          prompts: ['Question 1', 'Question 2'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Good question?',
              answer: 'Good answer.',
            },
            {
              is_answer_suitable: false,
              is_question_relevant: true,
              question: 'Bad answer question?',
              answer: 'Bad answer.',
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('Good question?');
      expect(markdown).not.to.include('Bad answer question?');
      expect(markdown).to.include('Good answer.');
      expect(markdown).not.to.include('Bad answer.');
    });

    it('should filter out irrelevant suggestions', () => {
      const faqs = [
        {
          url: 'https://www.bulk.com/uk/test',
          topic: 'test',
          prompts: ['Question 1'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: false,
              question: 'Irrelevant question?',
              answer: 'Good answer.',
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).not.to.include('Irrelevant question?');
      expect(log.info).to.have.been.calledWith(sinon.match(/Skipping FAQ topic "test" - no suitable suggestions/));
    });

    it('should handle sources with title and URL', () => {
      const faqs = [
        {
          topic: 'test',
          prompts: ['Question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { title: 'Source Title', url: 'https://example.com/source' },
              ],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('**Sources:**');
      expect(markdown).to.include('- [Source Title](https://example.com/source)');
    });

    it('should handle sources with only URL', () => {
      const faqs = [
        {
          topic: 'test',
          prompts: ['Question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [
                { url: 'https://example.com/source' },
              ],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('**Sources:**');
      expect(markdown).to.include('- https://example.com/source');
    });

    it('should include AI analysis in collapsible section', () => {
      const faqs = [
        {
          topic: 'test',
          prompts: ['Question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question?',
              answer: 'Answer.',
              answer_suitability_reason: 'The answer is well-structured.',
              question_relevance_reason: 'The question is directly related.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('<details>');
      expect(markdown).to.include('<summary>AI Analysis</summary>');
      expect(markdown).to.include('**Answer Suitability:** The answer is well-structured.');
      expect(markdown).to.include('**Question Relevance:** The question is directly related.');
      expect(markdown).to.include('</details>');
    });

    it('should not include AI analysis section if no reasons provided', () => {
      const faqs = [
        {
          topic: 'test',
          prompts: ['Question?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).not.to.include('<details>');
      expect(markdown).not.to.include('AI Analysis');
    });

    it('should handle multiple FAQs with incrementing numbers', () => {
      const faqs = [
        {
          url: 'https://www.bulk.com/uk/page1',
          topic: 'topic1',
          prompts: ['Question 1?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question 1?',
              answer: 'Answer 1.',
              sources: [],
            },
          ],
        },
        {
          url: 'https://www.bulk.com/uk/page2',
          topic: 'topic2',
          prompts: ['Question 2?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question 2?',
              answer: 'Answer 2.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('## 1. Target URL: [/uk/page1]');
      expect(markdown).to.include('## 2. Target URL: [/uk/page2]');
      expect(markdown).to.include('**Topic:** topic1');
      expect(markdown).to.include('**Topic:** topic2');
    });

    it('should handle multiple suggestions per FAQ', () => {
      const faqs = [
        {
          topic: 'test',
          prompts: ['Q1?', 'Q2?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question 1?',
              answer: 'Answer 1.',
              sources: [],
            },
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question 2?',
              answer: 'Answer 2.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.include('#### Question 1?');
      expect(markdown).to.include('*AI suggested answer:* Answer 1.');
      expect(markdown).to.include('#### Question 2?');
      expect(markdown).to.include('*AI suggested answer:* Answer 2.');
    });

    it('should skip prompts section if no prompts provided', () => {
      const faqs = [
        {
          topic: 'test',
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Question?',
              answer: 'Answer.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).not.to.include('**Related Search Queries:**');
    });

    it('should return empty string for empty FAQ array', () => {
      const faqs = [];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.equal('');
    });

    it('should skip FAQ topics with no suitable suggestions', () => {
      const faqs = [
        {
          topic: 'skipped topic',
          prompts: ['Question?'],
          suggestions: [
            {
              is_answer_suitable: false,
              is_question_relevant: false,
              question: 'Bad question?',
              answer: 'Bad answer.',
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      expect(markdown).to.equal('');
      expect(log.info).to.have.been.calledWith('Skipping FAQ topic "skipped topic" - no suitable suggestions');
    });

    it('should add separators between FAQ sections', () => {
      const faqs = [
        {
          topic: 'topic1',
          prompts: ['Q1?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Q1?',
              answer: 'A1.',
              sources: [],
            },
          ],
        },
        {
          topic: 'topic2',
          prompts: ['Q2?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Q2?',
              answer: 'A2.',
              sources: [],
            },
          ],
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      const sections = markdown.split('---\n\n');
      // Should have 2 sections plus empty string after final separator
      expect(sections.length).to.equal(3);
    });

    it('should handle FAQs with undefined suggestions', async () => {
      const faqs = [
        {
          url: 'https://bulk.com/test1',
          topic: 'test1',
          prompts: ['Q1?'],
          suggestions: [
            {
              is_answer_suitable: true,
              is_question_relevant: true,
              question: 'Q1?',
              answer: 'A1.',
            },
          ],
        },
        {
          url: 'https://bulk.com/test2',
          topic: 'test2',
          prompts: ['Q2?'],
          // No suggestions property - this tests the || [] fallback
        },
      ];

      const markdown = getFaqMarkdown(faqs, log);

      // Should only include test1, not test2 (which has no suggestions)
      expect(markdown).to.include('test1');
      expect(markdown).to.not.include('test2');
      expect(markdown).to.include('Q1?');
      expect(markdown).to.include('A1.');
    });
  });
});

