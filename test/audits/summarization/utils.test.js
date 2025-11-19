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
          sectionSummaries: [],
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(1);
      
      // Verify default values are used
      expect(result[0].transformRules.selector).to.equal('body');
      expect(result[0].transformRules.action).to.equal('appendChild');
      expect(result[0].summarizationText).to.equal('Test summary');
      expect(result[0].fullPage).to.be.true;
      expect(result[0].url).to.equal('https://example.com/page1');
      expect(result[0].title).to.equal('Test Page');
    });

    it('should use default value when insertion_method is not provided for section summary', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          sectionSummaries: [
            {
              title: 'Section 1',
              formatted_summary: 'Section summary',
              heading_selector: 'h2',
              // insertion_method is missing
            },
          ],
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(2);
      
      // Check page-level suggestion
      expect(result[0].transformRules.selector).to.equal('h1');
      expect(result[0].transformRules.action).to.equal('insertAfter');
      
      // Check section-level suggestion uses default
      expect(result[1].transformRules.selector).to.equal('h2');
      expect(result[1].transformRules.action).to.equal('insertAfter'); // default value
      expect(result[1].summarizationText).to.equal('Section summary');
      expect(result[1].fullPage).to.be.false;
      expect(result[1].url).to.equal('https://example.com/page1');
      expect(result[1].title).to.equal('Section 1');
    });

    it('should handle suggestions with all properties provided', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertBefore',
          },
          sectionSummaries: [
            {
              title: 'Section 1',
              formatted_summary: 'Section summary',
              heading_selector: 'h2',
              insertion_method: 'appendChild',
            },
          ],
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.be.an('array');
      expect(result).to.have.length(2);
      
      // Check all values are used as provided
      expect(result[0].transformRules.selector).to.equal('h1');
      expect(result[0].transformRules.action).to.equal('insertBefore');
      expect(result[1].transformRules.selector).to.equal('h2');
      expect(result[1].transformRules.action).to.equal('appendChild');
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
          sectionSummaries: [],
        },
        {
          pageUrl: 'https://example.com/page2',
          pageSummary: {
            title: 'Page 2',
            formatted_summary: 'Summary 2',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          sectionSummaries: [
            {
              title: 'Section A',
              formatted_summary: 'Section A summary',
              heading_selector: 'h3',
              // No insertion_method
            },
          ],
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(3);
      
      // First page uses defaults
      expect(result[0].transformRules.selector).to.equal('body');
      expect(result[0].transformRules.action).to.equal('appendChild');
      
      // Second page uses provided values
      expect(result[1].transformRules.selector).to.equal('h1');
      expect(result[1].transformRules.action).to.equal('insertAfter');
      
      // Section uses default for insertion_method
      expect(result[2].transformRules.selector).to.equal('h3');
      expect(result[2].transformRules.action).to.equal('insertAfter');
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
          sectionSummaries: [
            {
              title: 'Section 1',
              formatted_summary: 'Section summary',
              heading_selector: 'h2',
              insertion_method: 'insertAfter',
            },
          ],
        },
      ];

      const result = getJsonSummarySuggestion(suggestions);

      expect(result).to.have.length(2);
      // Both page-level and section-level should have the same scrapedAt
      expect(result[0].scrapedAt).to.equal(testTimestamp);
      expect(result[1].scrapedAt).to.equal(testTimestamp);
    });

    it('should generate current timestamp when scrapedAt is missing', () => {
      const suggestions = [
        {
          pageUrl: 'https://example.com/page1',
          // No scrapedAt property
          pageSummary: {
            title: 'Test Page',
            formatted_summary: 'Test summary',
            heading_selector: 'h1',
            insertion_method: 'insertAfter',
          },
          sectionSummaries: [
            {
              title: 'Section 1',
              formatted_summary: 'Section summary',
              heading_selector: 'h2',
              insertion_method: 'insertAfter',
            },
          ],
        },
      ];

      const beforeTime = new Date().toISOString();
      const result = getJsonSummarySuggestion(suggestions);
      const afterTime = new Date().toISOString();

      expect(result).to.have.length(2);

      // Both should have scrapedAt timestamps
      expect(result[0].scrapedAt).to.be.a('string');
      expect(result[0].scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result[1].scrapedAt).to.be.a('string');
      expect(result[1].scrapedAt).to.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // Both should have the same timestamp (captured once)
      expect(result[0].scrapedAt).to.equal(result[1].scrapedAt);

      // Timestamp should be within expected time range for page-level suggestion
      expect(result[0].scrapedAt >= beforeTime).to.be.true;
      expect(result[0].scrapedAt <= afterTime).to.be.true;

      // Timestamp should be within expected time range for section-level suggestion
      expect(result[1].scrapedAt >= beforeTime).to.be.true;
      expect(result[1].scrapedAt <= afterTime).to.be.true;
    });
  });
});

