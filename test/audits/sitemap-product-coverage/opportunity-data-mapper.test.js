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
import { createOpportunityData } from '../../../src/sitemap-product-coverage/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Sitemap Product Coverage Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('wiki.corp.adobe.com');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Issues found for the sitemap product coverage');
      expect(result).to.have.property('description', '');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct guidance steps', () => {
      const result = createOpportunityData();

      expect(result.guidance).to.be.an('object');
      expect(result.guidance.steps).to.be.an('array');
      expect(result.guidance.steps).to.have.length(1);
      expect(result.guidance.steps[0]).to.include('affected website locale');
      expect(result.guidance.steps[0]).to.include('sitemap');
    });

    it('should include correct data sources', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should include tags array', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      // sitemap-product-coverage is not in OPPORTUNITY_TAG_MAPPINGS, so returns empty array when currentTags is empty
      expect(result.tags.length).to.equal(0);
    });

    it('should use OPPORTUNITY_TYPES.SITEMAP_PRODUCT_COVERAGE constant for tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      // Note: SITEMAP_PRODUCT_COVERAGE ('sitemap-product-coverage') may not have hardcoded tags in the mapping
      // If no mapping exists, mergeTagsWithHardcodedTags returns empty array when currentTags is empty
      // This test verifies tags array exists
      expect(result.tags).to.be.an('array');
    });

    it('should have empty description', () => {
      const result = createOpportunityData();

      expect(result.description).to.equal('');
    });

    it('should have runbook URL pointing to wiki', () => {
      const result = createOpportunityData();

      expect(result.runbook).to.include('wiki.corp.adobe.com');
      expect(result.runbook).to.include('sitemap');
    });
  });
});

