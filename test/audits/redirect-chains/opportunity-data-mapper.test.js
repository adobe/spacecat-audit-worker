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
import { createOpportunityData } from '../../../src/redirect-chains/opportunity-data-mapper.js';

describe('Redirect Chains Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const params = {
        projectedTrafficLost: 1000,
        projectedTrafficValue: 500,
        auditScopeUrl: 'https://example.com',
      };

      const result = createOpportunityData(params);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Redirect chains slowing navigation — cleanup ready to speed up navigation and crawling');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags.length).to.be.above(0);
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data.projectedTrafficLost).to.equal(1000);
      expect(result.data.projectedTrafficValue).to.equal(500);
      expect(result.data.auditScopeUrl).to.equal('https://example.com');
    });

    it('should merge hardcoded tags', () => {
      const result = createOpportunityData({});

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });

    it('should handle default values for optional params', () => {
      const result = createOpportunityData();

      expect(result.data.projectedTrafficLost).to.equal(0);
      expect(result.data.projectedTrafficValue).to.equal(0);
      expect(result.data.auditScopeUrl).to.equal('');
    });
  });
});

