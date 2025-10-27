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
import { createOpportunityData } from '../../../src/content-fragment-broken-links/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should return the correct opportunity data structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should have a valid runbook URL', () => {
      const result = createOpportunityData();

      expect(result.runbook).to.be.a('string');
      expect(result.runbook).to.include('https://');
      expect(result.runbook).to.include('adobe.sharepoint.com');
    });

    it('should have appropriate title for Content Fragment broken links', () => {
      const result = createOpportunityData();

      expect(result.title).to.be.a('string');
      expect(result.title).to.include('Content Fragment');
      expect(result.title).to.include('failing');
      expect(result.title).to.include('breaking');
    });

    it('should have a description explaining the issue and solution', () => {
      const result = createOpportunityData();

      expect(result.description).to.be.a('string');
      expect(result.description).to.include('Content Fragment');
      expect(result.description).to.include('redirect');
    });

    it('should include guidance with steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance).to.have.property('steps');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps.length).to.be.greaterThan(0);
    });

    it('should have guidance steps that are actionable', () => {
      const result = createOpportunityData();

      result.guidance.steps.forEach((step) => {
        expect(step).to.be.a('string');
        expect(step.length).to.be.greaterThan(0);
      });
    });

    it('should include "Headless" in tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('Headless');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data).to.be.an('object');
      expect(result.data).to.have.property('dataSources');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should return a consistent structure on multiple calls', () => {
      const result1 = createOpportunityData();
      const result2 = createOpportunityData();

      expect(result1).to.deep.equal(result2);
    });
  });
});

