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
import { DATA_SOURCES } from '../../../src/common/constants.js';
import { createOpportunityData } from '../../../src/readability/opportunities/opportunity-data-mapper.js';

describe('Readability Opportunities - Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should return opportunity data with all required properties (lines 16-36)', () => {
      const result = createOpportunityData();

      // Verify the complete structure (lines 16-36)
      expect(result).to.be.an('object');

      // Line 17
      expect(result.runbook).to.equal('');

      // Line 18
      expect(result.origin).to.equal('AUTOMATION');

      // Line 19
      expect(result.title).to.equal('Content readability issues affecting user experience and accessibility');

      // Line 20
      expect(result.description).to.equal('Poor readability makes content difficult for users to understand. Content with low readability scores may drive away visitors and reduce engagement metrics.');

      // Lines 21-30 (guidance)
      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(6);

      // Line 31
      expect(result.tags).to.deep.equal(['Engagement', 'isElmo']);

      // Lines 32-34
      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.deep.equal([DATA_SOURCES.AHREFS, DATA_SOURCES.SITE]);
    });

    it('should include all six guidance steps with correct content', () => {
      const result = createOpportunityData();

      // Lines 23-29
      expect(result.guidance.steps[0]).to.equal('Review content identified with poor readability scores on high-traffic pages.');
      expect(result.guidance.steps[1]).to.equal('Simplify complex sentences by breaking them into shorter, clearer statements.');
      expect(result.guidance.steps[2]).to.equal('Use common words instead of technical jargon when possible.');
      expect(result.guidance.steps[3]).to.equal('Improve paragraph structure with logical flow and clear topic sentences.');
      expect(result.guidance.steps[4]).to.equal('Consider your target audience reading level when revising content.');
      expect(result.guidance.steps[5]).to.equal('Use AI-generated suggestions as a starting point for improvements.');
    });

    it('should use correct DATA_SOURCES constants', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });
  });
});

