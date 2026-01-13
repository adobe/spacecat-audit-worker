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
import { createOpportunityData } from '../../../src/headings/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Headings Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook', '');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Optimize Headings for LLMs');
      expect(result).to.have.property('description');
      expect(result.description).to.include('heading');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct guidance steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(5);
      expect(result.guidance.steps[0]).to.include('Review pages flagged');
      expect(result.guidance.steps[1]).to.include('AI-generated suggestions');
      expect(result.guidance.steps[2]).to.include('levels increase');
      expect(result.guidance.steps[3]).to.include('empty heading');
      expect(result.guidance.steps[4]).to.include('brand guidelines');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include correct tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.greaterThan(0);
    });

    it('should use OPPORTUNITY_TYPES.HEADINGS constant for tags with isElmo, isASO, and tech-seo', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include.members(['Headings', 'SEO', 'Engagement']);
      expect(result.tags).to.include('isElmo');
      expect(result.tags).to.include('isASO');
      expect(result.tags).to.include('tech-seo');
    });

    it('should have description mentioning headings and LLMs', () => {
      const result = createOpportunityData();

      expect(result.description).to.include('heading');
      expect(result.description).to.include('LLM');
    });

    it('should have title mentioning LLMs', () => {
      const result = createOpportunityData();

      expect(result.title).to.include('LLMs');
    });
  });
});

