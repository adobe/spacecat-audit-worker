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
import esmock from 'esmock';

let utils;

before(async () => {
  // Dynamically import opportunity-handler with no mocks – we just need the pure functions
  utils = await esmock('../../src/llm-error-pages/opportunity-handler.js');
});

describe('LLM Error Pages – Opportunity Utils', () => {
  describe('categorizeErrorsByStatusCode()', () => {
    it('categorizes 404, 403 and 5xx correctly', () => {
      const input = [
        { url: '/a', status: '404' },
        { url: '/b', status: '403' },
        { url: '/c', status: '500' },
        { url: '/d', status: '404' },
      ];
      const result = utils.categorizeErrorsByStatusCode(input);
      expect(result[404]).to.have.lengthOf(2);
      expect(result[403]).to.have.lengthOf(1);
      expect(result['5xx']).to.have.lengthOf(1);
    });
  });

  describe('consolidateErrorsByUrl()', () => {
    it('merges duplicates by URL + normalized userAgent and aggregates requests', () => {
      const input = [
        {
          url: '/a',
          status: '404',
          user_agent: 'ChatGPTBot',
          total_requests: 5,
        },
        {
          url: '/a',
          status: '404',
          user_agent: 'chatgpt',
          total_requests: 3,
        },
      ];
      const consolidated = utils.consolidateErrorsByUrl(input);
      expect(consolidated).to.have.lengthOf(1);
      expect(consolidated[0].totalRequests).to.equal(8);
      expect(consolidated[0].rawUserAgents).to.include('ChatGPTBot');
      expect(consolidated[0].rawUserAgents).to.include('chatgpt');
    });
  });

  describe('sortErrorsByTrafficVolume()', () => {
    it('sorts errors by totalRequests desc', () => {
      const consolidated = [
        { url: '/a', totalRequests: 1 },
        { url: '/b', totalRequests: 10 },
        { url: '/c', totalRequests: 5 },
      ];
      const sorted = utils.sortErrorsByTrafficVolume([...consolidated]);
      expect(sorted.map((e) => e.url)).to.deep.equal(['/b', '/c', '/a']);
    });
  });
});
