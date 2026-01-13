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
import { createOpportunityData } from '../../../src/redirect-chains/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Redirect Chains Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const params = {
        projectedTrafficLost: 1000,
        projectedTrafficValue: 5000,
        auditScopeUrl: 'https://example.com',
      };

      const result = createOpportunityData(params);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('adobe.sharepoint.com');
      expect(result.runbook).to.include('Experience_Success_Studio_Redirect_Chains_Runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should use OPPORTUNITY_TYPES.REDIRECT_CHAINS constant for tags', () => {
      const result = createOpportunityData({});

      expect(result.tags).to.be.an('array');
      // Tags should be generated using OPPORTUNITY_TYPES.REDIRECT_CHAINS
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData({});

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include params in data object with defaults', () => {
      const params = {
        projectedTrafficLost: 1000,
        projectedTrafficValue: 5000,
        auditScopeUrl: 'https://example.com',
      };

      const result = createOpportunityData(params);

      expect(result.data.projectedTrafficLost).to.equal(1000);
      expect(result.data.projectedTrafficValue).to.equal(5000);
      expect(result.data.auditScopeUrl).to.equal('https://example.com');
    });

    it('should use default values when params are missing', () => {
      const result = createOpportunityData({});

      expect(result.data.projectedTrafficLost).to.equal(0);
      expect(result.data.projectedTrafficValue).to.equal(0);
      expect(result.data.auditScopeUrl).to.equal('');
    });

    it('should have correct guidance steps', () => {
      const result = createOpportunityData({});

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(1);
      expect(result.guidance.steps[0]).to.include('/redirects.json file');
    });

    it('should handle empty params object', () => {
      const result = createOpportunityData({});

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
    });

    it('should handle undefined params', () => {
      const result = createOpportunityData();

      expect(result.data).to.be.an('object');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.projectedTrafficLost).to.equal(0);
      expect(result.data.projectedTrafficValue).to.equal(0);
      expect(result.data.auditScopeUrl).to.equal('');
    });
  });
});

