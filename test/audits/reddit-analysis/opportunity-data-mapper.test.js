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
import { createOpportunityData } from '../../../src/reddit-analysis/opportunity-data-mapper.js';

describe('Reddit Analysis Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const guidance = {
        insight: 'Test insight',
        rationale: 'Test rationale',
        recommendation: 'Test recommendation',
        type: 'CONTENT_UPDATE',
      };

      const result = createOpportunityData({ guidance });

      expect(result.guidance).to.deep.equal(guidance);
      expect(result.origin).to.equal('AUTOMATION');
      expect(result.type).to.equal('reddit-analysis');
      expect(result.status).to.equal('NEW');
    });

    it('should include correct title and description', () => {
      const result = createOpportunityData({ guidance: {} });

      expect(result.title).to.equal('Reddit presence: Improve brand sentiment and visibility');
      expect(result.description).to.include('Reddit');
      expect(result.description).to.include('brand sentiment');
    });

    it('should include correct tags', () => {
      const result = createOpportunityData({ guidance: {} });

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('reddit');
      expect(result.tags).to.include('earned');
    });

    it('should include empty runbook', () => {
      const result = createOpportunityData({ guidance: {} });

      expect(result.runbook).to.equal('');
    });

    it('should include data sources', () => {
      const result = createOpportunityData({ guidance: {} });

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.dataSources).to.have.lengthOf(2);
    });

    it('should handle guidance object', () => {
      const guidance = { insight: 'Insight', rationale: 'Rationale', recommendation: 'Rec', type: 'CONTENT_UPDATE' };
      const result = createOpportunityData({ guidance });

      expect(result.guidance).to.deep.equal(guidance);
    });
  });
});
