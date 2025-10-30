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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { getMarkdownSummarySuggestion } from '../../../src/summarization/utils.js';

use(sinonChai);

describe('Summarization Utils', () => {
  let mockLog;

  beforeEach(() => {
    mockLog = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    };
  });

  afterEach(() => {
    sinon.restore();
  });


  describe('getMarkdownSummarySuggestion', () => {
    it('should format suggestions with all content types', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Page Title 1',
            summary: 'This is a page summary',
            readability_score: 70.5,
            word_count: 25,
            brand_consistency_score: 85,
          },
          keyPoints: {
            items: ['Key point 1', 'Key point 2'],
            brand_consistency_score: 90,
          },
          sectionSummaries: [
            {
              title: 'Section 1',
              summary: 'Section summary 1',
              readability_score: 65.2,
              word_count: 15,
              brand_consistency_score: 88,
            },
          ],
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Page Title 1');
      expect(result).to.include('[/page1](https://example.com/page1)');
      expect(result).to.include('### Add summary ideally before the main content starts');
      expect(result).to.include('**Summary**');
      expect(result).to.include('This is a page summary');
      expect(result).to.include('**Key points**');
      expect(result).to.include('- Key point 1');
      expect(result).to.include('- Key point 2');
      expect(result).to.include('### Add section summaries above or below section content');
      expect(result).to.include('*Section:* **Section 1**\n\nSection summary 1');
    });

    it('should skip suggestions with no meaningful content', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/empty',
          pageSummary: { title: '', summary: '' },
          keyPoints: { items: [] },
          sectionSummaries: [],
        },
        {
          pageUrl: 'https://example.com/valid',
          pageSummary: {
            title: 'Valid Page',
            summary: 'Valid summary',
          },
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Valid Page');
      expect(result).to.include('[/valid](https://example.com/valid)');
      expect(result).to.not.include('https://example.com/empty');
      expect(mockLog.info).to.have.been.calledWith('Skipping suggestion with no meaningful content for URL: https://example.com/empty');
    });

    it('should handle suggestions with only page summary', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/summary-only',
          pageSummary: {
            title: 'Summary Only Page',
            summary: 'This page has only a summary',
            readability_score: 80,
          },
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Summary Only Page');
      expect(result).to.include('[/summary-only](https://example.com/summary-only)');
      expect(result).to.include('### Add summary ideally before the main content starts');
      expect(result).to.include('**Summary**');
      expect(result).to.include('This page has only a summary');
      expect(result).to.not.include('**Key points:**');
      expect(result).to.not.include('### Add section summaries above or below section content');
    });

    it('should handle suggestions with only key points', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/keypoints-only',
          keyPoints: {
            items: ['Point 1', 'Point 2', 'Point 3'],
            word_count: 20,
            readability_score: 60,
          },
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Page 1');
      expect(result).to.include('[/keypoints-only](https://example.com/keypoints-only)');
      expect(result).to.include('### Add summary ideally before the main content starts');
      expect(result).to.include('**Key points**');
      expect(result).to.include('- Point 1');
      expect(result).to.include('- Point 2');
      expect(result).to.include('- Point 3');
      expect(result).to.not.include('**Summary:**');
      expect(result).to.not.include('### Add section summaries above or below section content');
    });

    it('should handle suggestions with only section summaries', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/sections-only',
          sectionSummaries: [
            {
              title: 'Section A',
              summary: 'Summary A',
              readability_score: 60,
            },
            {
              title: 'Section B',
              summary: 'Summary B',
              word_count: 20,
            },
          ],
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Page 1');
      expect(result).to.include('[/sections-only](https://example.com/sections-only)');
      expect(result).to.include('### Add summary ideally before the main content starts');
      expect(result).to.include('### Add section summaries above or below section content');
      expect(result).to.include('*Section:* **Section A**\n\nSummary A');
      expect(result).to.include('*Section:* **Section B**\n\nSummary B');
      expect(result).to.not.include('**Summary:**');
      expect(result).to.not.include('**Key points:**');
    });

    it('should handle multiple suggestions with correct numbering', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: { title: 'Page 1', summary: 'Summary 1' },
        },
        {
          pageUrl: 'https://example.com/empty',
          pageSummary: { title: '', summary: '' },
          keyPoints: { items: [] },
          sectionSummaries: [],
        },
        {
          pageUrl: 'https://example.com/page2',
          pageSummary: { title: 'Page 2', summary: 'Summary 2' },
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Page 1');
      expect(result).to.include('[/page1](https://example.com/page1)');
      expect(result).to.include('## 2. Page 2');
      expect(result).to.include('[/page2](https://example.com/page2)');
      expect(result).to.not.include('https://example.com/empty');
    });

    it('should handle suggestions with missing pageUrl', () => {
      const suggestions = [
        {
          pageSummary: { title: 'No URL Page', summary: 'This has no URL' },
        },
        {
          pageUrl: 'https://example.com/valid',
          pageSummary: { title: 'Valid Page', summary: 'Valid summary' },
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Valid Page');
      expect(result).to.include('[/valid](https://example.com/valid)');
      expect(result).to.not.include('No URL Page');
      expect(mockLog.warn).to.have.been.calledWith(sinon.match(/No pageUrl found for suggestion/));
    });

    it('should handle empty suggestions array', () => {
      const suggestions = [];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.equal('');
    });

    it('should filter out empty key points and section summaries', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/mixed',
          keyPoints: {
            items: ['Valid point', '', '   ', 'Another valid point'],
          },
          sectionSummaries: [
            { title: 'Valid Section', summary: 'Valid summary' },
            { title: '', summary: 'Empty title' },
            { title: 'Empty Summary', summary: '' },
            { title: '   ', summary: '   ' },
          ],
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('- Valid point');
      expect(result).to.include('- Another valid point');
      expect(result).to.not.include('- \n');
      expect(result).to.not.include('-    \n');
      expect(result).to.include('*Section:* **Valid Section**\n\nValid summary');
      expect(result).to.not.include('*Section:* **:** Empty title');
      expect(result).to.not.include('####    \n');
    });

    it('should handle suggestions with whitespace-only content', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/whitespace',
          pageSummary: { title: '   ', summary: '   ' },
          keyPoints: { items: ['   ', '\t', '\n'] },
          sectionSummaries: [
            { title: '   ', summary: '   ' },
          ],
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.equal('');
      expect(mockLog.info).to.have.been.calledWith('Skipping suggestion with no meaningful content for URL: https://example.com/whitespace');
    });

    it('should use formatted content when available', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/formatted',
          pageSummary: {
            title: 'Formatted Test',
            summary: 'Plain text summary',
            formatted_summary: '**Bold** text summary with *emphasis*',
            readability_score: 70,
            word_count: 6,
          },
          keyPoints: {
            items: ['Plain key point'],
            formatted_items: ['**Bold** key point with *emphasis*'],
            readability_score: 65,
            word_count: 4,
          },
          sectionSummaries: [
            {
              title: 'Formatted Section',
              summary: 'Plain section summary',
              formatted_summary: '**Bold** section summary with *emphasis*',
              readability_score: 60,
              word_count: 5,
            },
          ],
        },
      ];

      const result = getMarkdownSummarySuggestion(suggestions, mockLog);

      expect(result).to.include('## 1. Formatted Test');
      expect(result).to.include('[/formatted](https://example.com/formatted)');
      expect(result).to.include('### Add summary ideally before the main content starts');
      expect(result).to.include('**Summary**');
      expect(result).to.include('**Bold** text summary with *emphasis*');
      expect(result).to.not.include('Plain text summary');
      expect(result).to.include('**Key points**');
      expect(result).to.include('- **Bold** key point with *emphasis*');
      expect(result).to.not.include('- Plain key point');
      expect(result).to.include('### Add section summaries above or below section content');
      expect(result).to.include('*Section:* **Formatted Section**\n\n**Bold** section summary with *emphasis*');
      expect(result).to.not.include('*Section:* **Formatted Section**\n\nPlain section summary');
    });
  });
});
