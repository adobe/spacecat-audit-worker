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
import { formatMetrics, getSuggestionValue } from '../../../src/summarization/utils.js';

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

  describe('formatMetrics', () => {
    it('should format all metrics when all are present', () => {
      const metrics = {
        readability_score: 75.5,
        word_count: 150,
        brand_consistency_score: 85,
      };

      const result = formatMetrics(metrics);
      expect(result).to.equal('*Readability:* 75.5 | *Word Count:* 150 | *Brand Consistency:* 85/100');
    });

    it('should format partial metrics when only some are present', () => {
      const metrics = {
        readability_score: 60.2,
        word_count: 100,
      };

      const result = formatMetrics(metrics);
      expect(result).to.equal('*Readability:* 60.2 | *Word Count:* 100');
    });

    it('should format single metric when only one is present', () => {
      const metrics = {
        brand_consistency_score: 90,
      };

      const result = formatMetrics(metrics);
      expect(result).to.equal('*Brand Consistency:* 90/100');
    });

    it('should return empty string when no metrics are present', () => {
      const metrics = {};

      const result = formatMetrics(metrics);
      expect(result).to.equal('');
    });

    it('should handle undefined values gracefully', () => {
      const metrics = {
        readability_score: undefined,
        word_count: 50,
        brand_consistency_score: undefined,
      };

      const result = formatMetrics(metrics);
      expect(result).to.equal('*Word Count:* 50');
    });

    it('should handle null values gracefully', () => {
      const metrics = {
        readability_score: null,
        word_count: 75,
        brand_consistency_score: null,
      };

      const result = formatMetrics(metrics);
      expect(result).to.equal('*Word Count:* 75');
    });
  });

  describe('getSuggestionValue', () => {
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/page1');
      expect(result).to.include('### Page Title');
      expect(result).to.include('Page Title 1');
      expect(result).to.include('### Page Summary (AI generated)');
      expect(result).to.include('> This is a page summary');
      expect(result).to.include('*Readability:* 70.5 | *Word Count:* 25 | *Brand Consistency:* 85/100');
      expect(result).to.include('### Key Points (AI generated)');
      expect(result).to.include('> - Key point 1');
      expect(result).to.include('> - Key point 2');
      expect(result).to.include('*Brand Consistency:* 90/100');
      expect(result).to.include('### Section Summaries (AI generated)');
      expect(result).to.include('#### Section 1');
      expect(result).to.include('> Section summary 1');
      expect(result).to.include('*Readability:* 65.2 | *Word Count:* 15 | *Brand Consistency:* 88/100');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/valid');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/summary-only');
      expect(result).to.include('### Page Summary (AI generated)');
      expect(result).to.include('> This page has only a summary');
      expect(result).to.include('*Readability:* 80');
      expect(result).to.not.include('### Key Points');
      expect(result).to.not.include('### Section Summaries');
    });

    it('should handle suggestions with only key points', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/keypoints-only',
          keyPoints: {
            items: ['Point 1', 'Point 2', 'Point 3'],
            brand_consistency_score: 75,
          },
        },
      ];

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/keypoints-only');
      expect(result).to.include('### Key Points (AI generated)');
      expect(result).to.include('> - Point 1');
      expect(result).to.include('> - Point 2');
      expect(result).to.include('> - Point 3');
      expect(result).to.include('*Brand Consistency:* 75/100');
      expect(result).to.not.include('### Page Summary');
      expect(result).to.not.include('### Section Summaries');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/sections-only');
      expect(result).to.include('### Section Summaries (AI generated)');
      expect(result).to.include('#### Section A');
      expect(result).to.include('> Summary A');
      expect(result).to.include('*Readability:* 60');
      expect(result).to.include('#### Section B');
      expect(result).to.include('> Summary B');
      expect(result).to.include('*Word Count:* 20');
      expect(result).to.not.include('### Page Summary');
      expect(result).to.not.include('### Key Points');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/page1');
      expect(result).to.include('## 2. https://example.com/page2');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('## 1. https://example.com/valid');
      expect(result).to.not.include('No URL Page');
      expect(mockLog.warn).to.have.been.calledWith(sinon.match(/No pageUrl found for suggestion/));
    });

    it('should handle empty suggestions array', () => {
      const suggestions = [];

      const result = getSuggestionValue(suggestions, mockLog);

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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.include('> - Valid point');
      expect(result).to.include('> - Another valid point');
      expect(result).to.not.include('> - \n');
      expect(result).to.not.include('> -    \n');
      expect(result).to.include('#### Valid Section');
      expect(result).to.not.include('#### \n');
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

      const result = getSuggestionValue(suggestions, mockLog);

      expect(result).to.equal('');
      expect(mockLog.info).to.have.been.calledWith('Skipping suggestion with no meaningful content for URL: https://example.com/whitespace');
    });
  });
});
