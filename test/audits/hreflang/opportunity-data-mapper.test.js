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
import { createOpportunityData, createOpportunityDataForElmo } from '../../../src/hreflang/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Hreflang Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result.title).to.include('hreflang');
      expect(result).to.have.property('description');
      expect(result.description).to.include('hreflang');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct guidance steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(6);
      expect(result.guidance.steps[0]).to.include('Review each URL');
      expect(result.guidance.steps[5]).to.include('x-default');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include tags array', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.greaterThan(0);
    });

    it('should use OPPORTUNITY_TYPES.HREFLANG constant for tags with tech-seo', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include.members(['Hreflang', 'SEO']);
      expect(result.tags).to.include('tech-seo');
    });
  });

  describe('createOpportunityDataForElmo', () => {
    it('should create Elmo opportunity data with all required fields', () => {
      const result = createOpportunityDataForElmo();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include recommendations in guidance for Elmo', () => {
      const result = createOpportunityDataForElmo();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.recommendations).to.be.an('array');
      expect(result.guidance.recommendations).to.have.length(1);
      expect(result.guidance.recommendations[0]).to.have.property('insight');
      expect(result.guidance.recommendations[0]).to.have.property('recommendation');
      expect(result.guidance.recommendations[0]).to.have.property('type');
      expect(result.guidance.recommendations[0]).to.have.property('rationale');
    });

    it('should include correct data sources for Elmo', () => {
      const result = createOpportunityDataForElmo();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include additionalMetrics for Elmo', () => {
      const result = createOpportunityDataForElmo();

      expect(result.data.additionalMetrics).to.be.an('array');
      expect(result.data.additionalMetrics).to.have.length(1);
      expect(result.data.additionalMetrics[0]).to.have.property('key', 'subtype');
      expect(result.data.additionalMetrics[0]).to.have.property('value', 'hreflang');
    });

    it('should include tags array for Elmo', () => {
      const result = createOpportunityDataForElmo();

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.greaterThan(0);
    });

    it('should use OPPORTUNITY_TYPES.HREFLANG constant for tags with llm for Elmo', () => {
      const result = createOpportunityDataForElmo();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include.members(['Hreflang', 'SEO']);
      expect(result.tags).to.include('llm');
    });
  });
});

