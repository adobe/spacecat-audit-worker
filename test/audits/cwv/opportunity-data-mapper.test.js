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
import { createOpportunityData } from '../../../src/cwv/opportunity-data-mapper.js';

describe('CWV Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const kpiDeltas = {
        lcpDelta: 0.5,
        inpDelta: 100,
        clsDelta: 0.1,
      };

      const result = createOpportunityData(kpiDeltas);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Opportunities to improve core web vitals — optimization available to improve user experience');
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

      const result = createOpportunityData(kpiDeltas);

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });

    it('should preserve kpiDeltas in data object', () => {
      const kpiDeltas = {
        lcpDelta: 1.0,
        inpDelta: 200,
        clsDelta: 0.2,
        customField: 'test',
      };

      const result = createOpportunityData(kpiDeltas);

      expect(result.data).to.include(kpiDeltas);
      expect(result.data.lcpDelta).to.equal(1.0);
      expect(result.data.inpDelta).to.equal(200);
      expect(result.data.clsDelta).to.equal(0.2);
      expect(result.data.customField).to.equal('test');
    });

    it('should handle empty kpiDeltas', () => {
      const result = createOpportunityData({});

      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });
  });
});

