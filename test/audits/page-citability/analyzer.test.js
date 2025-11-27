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
import { calculateCitabilityScore } from '../../../src/page-citability/analyzer.js';

describe('Page Citability Analyzer', () => {
  describe('calculateCitabilityScore', () => {
    it('should calculate citability score from bot and human HTML', async () => {
      const botHtml = '<html><body><p>Bot content with some text</p></body></html>';
      const humanHtml = '<html><body><p>Human content with different text</p></body></html>';

      const result = await calculateCitabilityScore(botHtml, humanHtml);

      expect(result).to.be.an('object');
      expect(result).to.have.property('citabilityScore');
      expect(result).to.have.property('contentRatio');
      expect(result).to.have.property('wordDifference');
      expect(result).to.have.property('botWords');
      expect(result).to.have.property('normalWords');

      expect(result.citabilityScore).to.be.a('number');
      expect(result.contentRatio).to.be.a('number');
      expect(result.wordDifference).to.be.a('number');
      expect(result.botWords).to.be.a('number');
      expect(result.normalWords).to.be.a('number');
    });

    it('should handle empty HTML content', async () => {
      const result = await calculateCitabilityScore('', '');

      expect(result).to.be.an('object');
      expect(result.botWords).to.equal(0);
      expect(result.normalWords).to.equal(0);
    });

    it('should handle HTML with no text content', async () => {
      const botHtml = '<html><head></head><body></body></html>';
      const humanHtml = '<html><head></head><body></body></html>';

      const result = await calculateCitabilityScore(botHtml, humanHtml);

      expect(result).to.be.an('object');
      expect(result.botWords).to.equal(0);
      expect(result.normalWords).to.equal(0);
    });
  });
});
