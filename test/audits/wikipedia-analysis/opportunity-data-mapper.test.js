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
import { OPPORTUNITY_TYPES } from '@adobe/spacecat-shared-utils';
import { createOpportunityData } from '../../../src/wikipedia-analysis/opportunity-data-mapper.js';

describe('Wikipedia Analysis Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const guidance = [
        {
          insight: 'Test insight',
          rationale: 'Test rationale',
          recommendation: 'Test recommendation',
          type: 'CONTENT_UPDATE',
        },
      ];

      const result = createOpportunityData({ guidance });

      expect(result.guidance).to.deep.equal(guidance);
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal(OPPORTUNITY_TYPES.WIKIPEDIA_ANALYSIS);
      expect(result.status).to.equal('NEW');
    });

    it('should use OPPORTUNITY_TYPES.WIKIPEDIA_ANALYSIS constant for tags', () => {
      const result = createOpportunityData({ guidance: [] });

      // Verify tags are generated using OPPORTUNITY_TYPES.WIKIPEDIA_ANALYSIS
      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('llmo');
      expect(result.tags).to.include('wikipedia');
      expect(result.tags).to.include('Off-Site');
    });

    it('should include correct title and description', () => {
      const result = createOpportunityData({ guidance: [] });

      expect(result.title).to.equal('LLM discoverability: Improve Wikipedia presence');
      expect(result.description).to.include('Wikipedia');
      expect(result.description).to.include('LLM');
    });

    it('should include correct tags including Off-Site', () => {
      const result = createOpportunityData({ guidance: [] });

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('llmo');
      expect(result.tags).to.include('wikipedia');
      expect(result.tags).to.include('Off-Site');
    });

    it('should include runbook URL', () => {
      const result = createOpportunityData({ guidance: [] });

      expect(result.runbook).to.be.a('string');
      expect(result.runbook).to.include('sharepoint');
      expect(result.runbook).to.include('Wikipedia');
    });

    it('should include data sources', () => {
      const result = createOpportunityData({ guidance: [] });

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.dataSources).to.have.lengthOf(2);
    });

    it('should handle empty guidance array', () => {
      const result = createOpportunityData({ guidance: [] });

      expect(result.guidance).to.deep.equal([]);
    });

    it('should handle multiple guidance items', () => {
      const guidance = [
        { insight: 'Insight 1', rationale: 'Rationale 1', recommendation: 'Rec 1', type: 'TYPE1' },
        { insight: 'Insight 2', rationale: 'Rationale 2', recommendation: 'Rec 2', type: 'TYPE2' },
        { insight: 'Insight 3', rationale: 'Rationale 3', recommendation: 'Rec 3', type: 'TYPE3' },
      ];

      const result = createOpportunityData({ guidance });

      expect(result.guidance).to.have.lengthOf(3);
      expect(result.guidance[0].insight).to.equal('Insight 1');
      expect(result.guidance[2].insight).to.equal('Insight 3');
    });
  });
});

