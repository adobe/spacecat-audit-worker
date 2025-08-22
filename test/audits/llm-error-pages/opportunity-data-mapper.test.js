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
import {
  ERROR_CATEGORY_TYPE,
  SUGGESTION_TEMPLATES,
  createOpportunityData,
} from '../../../src/llm-error-pages/opportunity-data-mapper.js';

describe('LLM Error Pages Opportunity Data Mapper', () => {
  describe('ERROR_CATEGORY_TYPE', () => {
    it('should have correct error category mappings', () => {
      expect(ERROR_CATEGORY_TYPE).to.deep.equal({
        404: 'Not Found Errors',
        403: 'Forbidden Errors',
        '5xx': 'Server Errors',
      });
    });
  });

  describe('SUGGESTION_TEMPLATES', () => {
    it('should have correct suggestion templates', () => {
      expect(SUGGESTION_TEMPLATES).to.deep.equal({
        FORBIDDEN: 'Review access permissions for {url} - {userAgent} crawler is blocked',
        SERVER_ERROR: 'Fix server error for {url} - returning {statusCode} to {userAgent} crawler',
      });
    });
  });

  describe('buildOpportunityDataForErrorType', () => {
    it('should build opportunity data for 404 errors', () => {
      const aggregatedData = [
        { url: 'https://example.com/page1', userAgent: 'ChatGPT', totalRequests: 5 },
        { url: 'https://example.com/page2', userAgent: 'Claude', totalRequests: 3 },
        { url: 'https://example.com/page1', userAgent: 'Claude', totalRequests: 2 },
      ];

      const result = createOpportunityData('404', aggregatedData);

      expect(result).to.deep.equal({
        runbook: 'https://wiki.corp.adobe.com/pages/editpage.action?pageId=3564012596',
        origin: 'AUTOMATION',
        title: 'LLM Not Found Errors',
        description: 'URLs returning 404 errors to LLM crawlers',
        guidance: {
          steps: [
            'Review the list of URLs with errors reported by LLM crawlers',
            'Identify and fix broken links, server issues, or access restrictions',
            'Test the fixes by monitoring LLM crawler access',
            'Verify error resolution in subsequent audit runs',
          ],
        },
        tags: ['seo', 'llm', 'errors', 'crawlers', 'isElmo'],
        data: {
          errorType: '404',
          totalErrors: 10,
          uniqueUrls: 2,
          uniqueUserAgents: 2,
          dataSources: ['CDN_LOGS'],
        },
      });
    });

    it('should build opportunity data for 403 errors', () => {
      const aggregatedData = [
        { url: 'https://example.com/admin', userAgent: 'Perplexity', totalRequests: 1 },
      ];

      const result = createOpportunityData('403', aggregatedData);

      expect(result.title).to.equal('LLM Forbidden Errors');
      expect(result.description).to.equal('URLs returning 403 errors to LLM crawlers');
      expect(result.data.errorType).to.equal('403');
      expect(result.data.totalErrors).to.equal(1);
      expect(result.data.uniqueUrls).to.equal(1);
      expect(result.data.uniqueUserAgents).to.equal(1);
    });

    it('should build opportunity data for 5xx errors', () => {
      const aggregatedData = [
        { url: 'https://example.com/api', userAgent: 'Gemini', totalRequests: 7 },
        { url: 'https://example.com/service', userAgent: 'Copilot', totalRequests: 3 },
      ];

      const result = createOpportunityData('5xx', aggregatedData);

      expect(result.title).to.equal('LLM Server Errors');
      expect(result.description).to.equal('URLs returning 5xx errors to LLM crawlers');
      expect(result.data.errorType).to.equal('5xx');
      expect(result.data.totalErrors).to.equal(10);
      expect(result.data.uniqueUrls).to.equal(2);
      expect(result.data.uniqueUserAgents).to.equal(2);
    });

    it('should handle empty aggregated data', () => {
      const result = createOpportunityData('404', []);

      expect(result.data.totalErrors).to.equal(0);
      expect(result.data.uniqueUrls).to.equal(0);
      expect(result.data.uniqueUserAgents).to.equal(0);
    });

    it('should handle single item aggregated data', () => {
      const aggregatedData = [
        { url: 'https://example.com/single', userAgent: 'ChatGPT', totalRequests: 1 },
      ];

      const result = createOpportunityData('404', aggregatedData);

      expect(result.data.totalErrors).to.equal(1);
      expect(result.data.uniqueUrls).to.equal(1);
      expect(result.data.uniqueUserAgents).to.equal(1);
    });

    it('should deduplicate URLs and user agents correctly', () => {
      const aggregatedData = [
        { url: 'https://example.com/page1', userAgent: 'ChatGPT', totalRequests: 1 },
        { url: 'https://example.com/page1', userAgent: 'ChatGPT', totalRequests: 2 },
        { url: 'https://example.com/page1', userAgent: 'Claude', totalRequests: 1 },
        { url: 'https://example.com/page2', userAgent: 'ChatGPT', totalRequests: 1 },
      ];

      const result = createOpportunityData('404', aggregatedData);

      expect(result.data.totalErrors).to.equal(5);
      expect(result.data.uniqueUrls).to.equal(2);
      expect(result.data.uniqueUserAgents).to.equal(2);
    });

    it('should have consistent structure for all error types', () => {
      const aggregatedData = [
        { url: 'https://example.com/test', userAgent: 'TestBot', totalRequests: 1 },
      ];

      const result404 = createOpportunityData('404', aggregatedData);
      const result403 = createOpportunityData('403', aggregatedData);
      const result5xx = createOpportunityData('5xx', aggregatedData);

      // Check that all results have the same structure
      const expectedKeys = ['runbook', 'origin', 'title', 'description', 'guidance', 'tags', 'data'];
      expect(Object.keys(result404)).to.deep.equal(expectedKeys);
      expect(Object.keys(result403)).to.deep.equal(expectedKeys);
      expect(Object.keys(result5xx)).to.deep.equal(expectedKeys);

      // Check guidance structure
      expect(result404.guidance).to.have.property('steps');
      expect(result403.guidance).to.have.property('steps');
      expect(result5xx.guidance).to.have.property('steps');

      // Check data structure
      const expectedDataKeys = ['errorType', 'totalErrors', 'uniqueUrls', 'uniqueUserAgents', 'dataSources'];
      expect(Object.keys(result404.data)).to.deep.equal(expectedDataKeys);
      expect(Object.keys(result403.data)).to.deep.equal(expectedDataKeys);
      expect(Object.keys(result5xx.data)).to.deep.equal(expectedDataKeys);
    });
  });
});
