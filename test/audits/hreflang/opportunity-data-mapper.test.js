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
import { createOpportunityData, createOpportunityDataForElmo } from '../../../src/hreflang/opportunity-data-mapper.js';

describe('Hreflang Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'hreflang tag fixes ready to help reach the right audiences in every region');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags).to.include('tech-seo');
      expect(result.tags.length).to.be.above(1); // Should have hardcoded tags plus tech-seo
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should merge hardcoded tags with tech-seo', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('tech-seo');
    });
  });

  describe('createOpportunityDataForElmo', () => {
    it('should create Elmo opportunity data with correct structure', () => {
      const result = createOpportunityDataForElmo();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'hreflang tag fixes ready to help reach the right audiences in every region');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('recommendations').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags).to.include('llm');
      expect(result.tags.length).to.be.above(1); // Should have hardcoded tags plus llm
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data).to.have.property('additionalMetrics').that.is.an('array');
    });

    it('should merge hardcoded tags with llm', () => {
      const result = createOpportunityDataForElmo();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('llm');
    });
  });
});

