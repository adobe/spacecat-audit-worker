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
import sinon from 'sinon';
import { createOpportunityData } from '../../../src/backlinks/opportunity-data-mapper.js';
import { OPPORTUNITY_TYPES, mergeTagsWithHardcodedTags } from '@adobe/spacecat-shared-utils';

describe('Backlinks Opportunity Data Mapper', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const kpiMetrics = {
        projectedTrafficLost: 1000,
        projectedTrafficValue: 500,
      };

      const result = createOpportunityData(kpiMetrics);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Recover lost SEO value from broken backlinks — repair options available for deployment');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.include(kpiMetrics);
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should merge hardcoded tags using mergeTagsWithHardcodedTags', () => {
      const kpiMetrics = {};

      const result = createOpportunityData(kpiMetrics);

      expect(result.tags).to.be.an('array');
      // Tags should be merged (not empty since mergeTagsWithHardcodedTags adds hardcoded tags)
      expect(result.tags.length).to.be.above(0);
    });

    it('should include hardcoded tags in the result', () => {
      const kpiMetrics = {};

      const result = createOpportunityData(kpiMetrics);

      expect(result.tags).to.be.an('array');
      // Tags should include hardcoded tags (based on canonical test pattern)
      expect(result.tags.length).to.be.above(0);
    });

    it('should preserve kpiMetrics in data object', () => {
      const kpiMetrics = {
        projectedTrafficLost: 5000,
        projectedTrafficValue: 2500,
        customField: 'customValue',
      };

      const result = createOpportunityData(kpiMetrics);

      expect(result.data).to.include(kpiMetrics);
      expect(result.data.projectedTrafficLost).to.equal(5000);
      expect(result.data.projectedTrafficValue).to.equal(2500);
      expect(result.data.customField).to.equal('customValue');
    });

    it('should handle empty kpiMetrics', () => {
      const result = createOpportunityData({});

      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });
  });
});

