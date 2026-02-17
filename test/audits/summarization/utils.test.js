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
import { getJsonSummarySuggestion } from '../../../src/summarization/utils.js';

describe('summarization utils', () => {
  describe('getJsonSummarySuggestion', () => {
    it('should use default values when heading_selector and insertion_method are not provided for page summary', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            // heading_selector is missing
            // insertion_method is missing
          },
          keyPoints: {
            formatted_items: ['Key point 1', 'Key point 2'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(2); // page summary + key points
      
      // Verify default values are used for page summary
      expect(result[0].transformRules.selector).to.equal('body');
      expect(result[0].transformRules.action).to.equal('appendChild');
      expect(result[0].summarizationText).to.equal('Test summary');
      expect(result[0].fullPage).to.be.true;
      expect(result[0].keyPoints).to.be.false;
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[0].title).to.equal('Test Page');
      
      // Verify key points suggestion
      expect(result[1].transformRules.selector).to.equal('body');
      expect(result[1].transformRules.action).to.equal('appendChild');
      expect(result[1].summarizationText).to.equal('  * Key point 1\n  * Key point 2');
      expect(result[1].fullPage).to.be.true;
      expect(result[1].keyPoints).to.be.true;
      expect(result[1].url).to.equal('https://example.com/page1');
      expect(result[1].title).to.equal('Test Page');
    });

    it('should use default value when insertion_method is not provided', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: ['Key point 1', 'Key point 2'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(2); // page summary + key points (section summaries not used)
      
      // Check page-level suggestion
      expect(result[0].transformRules.selector).to.equal('h1');
      expect(result[0].transformRules.action).to.equal('insertAfter');
      expect(result[0].keyPoints).to.be.false;
      
      // Check key points suggestion
      expect(result[1].transformRules.selector).to.equal('h1');
      expect(result[1].transformRules.action).to.equal('insertAfter');
      expect(result[1].keyPoints).to.be.true;
      expect(result[1].summarizationText).to.equal('  * Key point 1\n  * Key point 2');
    });

    it('should handle suggestions with all properties provided (page + key points only)', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertBefore',
          },
          keyPoints: {
            formatted_items: ['Key point A', 'Key point B', 'Key point C'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(2); // page summary + key points
      
      // Check all values are used as provided for page summary
      expect(result[0].transformRules.selector).to.equal('h1');
      expect(result[0].transformRules.action).to.equal('insertBefore');
      expect(result[0].keyPoints).to.be.false;
      
      // Check key points suggestion
      expect(result[1].transformRules.selector).to.equal('h1');
      expect(result[1].transformRules.action).to.equal('insertBefore');
      expect(result[1].keyPoints).to.be.true;
      expect(result[1].summarizationText).to.equal('  * Key point A\n  * Key point B\n  * Key point C');
    });

    it('should handle empty suggestions array', () => {
      const result = getJsonSummarySuggestion([]);
      
      expect(result).to.be.an('array');
      expect(result).to.have.length(0);
    });

    it('should handle multiple suggestions with mixed defaults', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Page 1',
            formatted_summary: 'Summary 1',
            // No heading_selector or insertion_method
          },
          keyPoints: {
            formatted_items: ['Point 1'],
          },
        },
        {
          pageUrl: 'https://example.com/page2',
          pageSummary: {
            title: 'Page 2',
            formatted_summary: 'Summary 2',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: ['Point A', 'Point B'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(4); // page1 summary + page1 keypoints + page2 summary + page2 keypoints
      
      // First page summary uses defaults
      expect(result[0].transformRules.selector).to.equal('body');
      expect(result[0].transformRules.action).to.equal('appendChild');
      expect(result[0].keyPoints).to.be.false;
      
      // First page key points uses defaults
      expect(result[1].transformRules.selector).to.equal('body');
      expect(result[1].transformRules.action).to.equal('appendChild');
      expect(result[1].keyPoints).to.be.true;
      expect(result[1].summarizationText).to.equal('  * Point 1');
      
      // Second page summary uses provided values
      expect(result[2].transformRules.selector).to.equal('h1');
      expect(result[2].transformRules.action).to.equal('insertAfter');
      expect(result[2].keyPoints).to.be.false;
      
      // Second page key points uses provided values
      expect(result[3].transformRules.selector).to.equal('h1');
      expect(result[3].transformRules.action).to.equal('insertAfter');
      expect(result[3].keyPoints).to.be.true;
      expect(result[3].summarizationText).to.equal('  * Point A\n  * Point B');
    });

    it('should use provided scrapedAt timestamp when available', () => {
      const testTimestamp = '2025-11-17T18:53:21.143931';
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          scrapedAt: testTimestamp,
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: ['Key 1', 'Key 2'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(2); // page summary + key points
      expect(result[0].scrapedAt).to.equal(testTimestamp);
      expect(result[1].scrapedAt).to.equal(testTimestamp);
    });

    it('should generate current timestamp when scrapedAt is missing', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: ['Key 1', 'Key 2'],
          },
        },
      ];

      const beforeTime = new Date().toISOString();
      const result = getJsonSummarySuggestion(suggestions);
      const afterTime = new Date().toISOString();

      expect(result).to.have.length(2); // page summary + key points

      expect(result[0].scrapedAt).to.be.a('string');
      expect(result[0].scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result[1].scrapedAt).to.be.a('string');
      expect(result[1].scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result[0].scrapedAt).to.equal(result[1].scrapedAt);
      expect(result[0].scrapedAt >= beforeTime).to.be.true;
      expect(result[0].scrapedAt <= afterTime).to.be.true;
    });

    it('should correctly format key points with bullet points', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: [
              'First important point',
              'Second important point',
              'Third important point',
            ],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(2); // page summary + key points
      
      // Verify key points formatting
      const keyPointsSuggestion = result[1];
      expect(keyPointsSuggestion.keyPoints).to.be.true;
      expect(keyPointsSuggestion.summarizationText).to.equal(
        '  * First important point\n  * Second important point\n  * Third important point'
      );
    });

    it('should handle empty key points array (exclude from result)', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: [],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      // Only page summary is included; key points with empty text are excluded
      expect(result).to.have.length(1);
      expect(result[0].keyPoints).to.be.false;
      expect(result[0].summarizationText).to.equal('Test summary');
    });

    it('should handle single key point', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: ['Single key point'],
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(2); // page summary + key points
      
      // Verify single key point formatting
      const keyPointsSuggestion = result[1];
      expect(keyPointsSuggestion.keyPoints).to.be.true;
      expect(keyPointsSuggestion.summarizationText).to.equal('  * Single key point');
    });

    it('should handle keyPoints.formatted_items as non-array (exclude key points)', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          keyPoints: {
            formatted_items: null, // not an array
          },
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      // Only page summary; key points skipped when formatted_items is not an array
      expect(result).to.have.length(1);
      expect(result[0].summarizationText).to.equal('Test summary');
      expect(result[0].keyPoints).to.be.false;
    });
  });
});

