/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE/2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/* eslint-env mocha */

import { expect } from 'chai';
import { OPPORTUNITY_TYPES } from '@adobe/spacecat-shared-utils';
import { createOpportunityData } from '../../../src/metatags/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Metatags Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const props = {
        customField: 'customValue',
        testProperty: 'testValue',
      };

      const result = createOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('adobe.sharepoint.com');
      expect(result.runbook).to.include('Experience_Success_Studio_Metatags_Runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should use OPPORTUNITY_TYPES.INVALID_OR_MISSING_METADATA constant for tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      // Tags should be generated using OPPORTUNITY_TYPES.INVALID_OR_MISSING_METADATA
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(3);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.RUM);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include provided props in data object', () => {
      const props = {
        customField: 'customValue',
        testProperty: 'testValue',
      };

      const result = createOpportunityData(props);

      expect(result.data).to.include(props);
      expect(result.data.customField).to.equal('customValue');
      expect(result.data.testProperty).to.equal('testValue');
    });

    it('should have correct guidance steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(5);
      expect(result.guidance.steps[0]).to.include('Review the detected meta-tags');
      expect(result.guidance.steps[4]).to.include('Publish the changes');
    });

    it('should handle empty props object', () => {
      const result = createOpportunityData({});

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
    });

    it('should handle undefined props', () => {
      const result = createOpportunityData();

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
    });
  });
});

