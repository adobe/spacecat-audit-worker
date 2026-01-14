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
import { createOpportunityData, createOpportunityDataForElmo } from '../../../src/canonical/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Canonical Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('adobe.sharepoint.com');
      expect(result.runbook).to.include('Experience_Success_Studio_Canonical_Runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should use OPPORTUNITY_TYPES.CANONICAL constant for tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('tech-seo');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(2);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should have correct guidance steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(3);
      expect(result.guidance.steps[0]).to.include('Review each URL');
      expect(result.guidance.steps[2]).to.include('Use lowercase');
    });

    it('should have correct title', () => {
      const result = createOpportunityData();

      expect(result.title).to.equal('Canonical URLs to clarify your SEO strategy to search engines are ready');
    });

    it('should have correct description', () => {
      const result = createOpportunityData();

      expect(result.description).to.equal('Canonical tags prevent duplicate content confusion — consolidating signals strengthens ranking authority.');
    });
  });

  describe('createOpportunityDataForElmo', () => {
    it('should create opportunity data for Elmo with all required fields', () => {
      const result = createOpportunityDataForElmo();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should use OPPORTUNITY_TYPES.CANONICAL constant for tags with llm tag', () => {
      const result = createOpportunityDataForElmo();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.include('Canonical URLs');
      expect(result.tags).to.include('SEO');
      expect(result.tags).to.include('llm');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityDataForElmo();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(2);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should have recommendations in guidance', () => {
      const result = createOpportunityDataForElmo();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.recommendations).to.be.an('array');
      expect(result.guidance.recommendations).to.have.length(1);
      expect(result.guidance.recommendations[0]).to.have.property('insight');
      expect(result.guidance.recommendations[0]).to.have.property('recommendation');
      expect(result.guidance.recommendations[0]).to.have.property('type', 'CONTENT');
      expect(result.guidance.recommendations[0]).to.have.property('rationale');
    });

    it('should include additionalMetrics in data', () => {
      const result = createOpportunityDataForElmo();

      expect(result.data.additionalMetrics).to.be.an('array');
      expect(result.data.additionalMetrics).to.have.length(1);
      expect(result.data.additionalMetrics[0]).to.have.property('key', 'subtype');
      expect(result.data.additionalMetrics[0]).to.have.property('value', 'canonical');
    });
  });
});

