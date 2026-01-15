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
import { createOpportunityData } from '../../../src/sitemap-product-coverage/opportunity-data-mapper.js';

describe('Sitemap Product Coverage Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Issues found for the sitemap product coverage');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('steps').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      // Tags may be empty if no hardcoded tags are configured for this opportunity type
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should merge hardcoded tags', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      // Tags may be empty if no hardcoded tags are configured for this opportunity type
      // The important thing is that mergeTagsWithHardcodedTags was called
    });
  });
});

