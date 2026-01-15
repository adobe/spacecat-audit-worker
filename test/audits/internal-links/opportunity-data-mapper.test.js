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
import { createOpportunityData } from '../../../src/internal-links/opportunity-data-mapper.js';

describe('Internal Links Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const kpiDeltas = {
        projectedTrafficLost: 1000,
        projectedTrafficValue: 500,
      };

      const result = createOpportunityData({ kpiDeltas });

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Guide visitors and search engines smoothly — repairs for broken internal links ready');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags.length).to.be.above(0);
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.include(kpiDeltas);
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should merge hardcoded tags', () => {
      const kpiDeltas = {};

      const result = createOpportunityData({ kpiDeltas });

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });

    it('should preserve kpiDeltas in data object', () => {
      const kpiDeltas = {
        projectedTrafficLost: 5000,
        projectedTrafficValue: 2500,
        customField: 'test',
      };

      const result = createOpportunityData({ kpiDeltas });

      expect(result.data).to.include(kpiDeltas);
      expect(result.data.projectedTrafficLost).to.equal(5000);
      expect(result.data.projectedTrafficValue).to.equal(2500);
      expect(result.data.customField).to.equal('test');
    });

    it('should handle empty kpiDeltas', () => {
      const result = createOpportunityData({ kpiDeltas: {} });

      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });
  });
});

