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
import { createOpportunityData } from '../../../src/content-fragment-unused/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const result = createOpportunityData();

      expect(result).to.be.an('object');
      expect(result).to.have.all.keys([
        'runbook',
        'origin',
        'title',
        'description',
        'tags',
        'data',
      ]);
    });

    it('should have correct runbook URL', () => {
      const result = createOpportunityData();

      expect(result.runbook).to.equal(
        'https://adobe.sharepoint.com/sites/aemsites-engineering/Shared%20Documents/3%20-%20Experience%20Success/SpaceCat/Runbooks/',
      );
    });

    it('should have AUTOMATION origin', () => {
      const result = createOpportunityData();

      expect(result.origin).to.equal('AUTOMATION');
    });

    it('should have correct title', () => {
      const result = createOpportunityData();

      expect(result.title).to.equal(
        'Remove unused Content Fragment to optimize content governance',
      );
    });

    it('should have correct description', () => {
      const result = createOpportunityData();

      expect(result.description).to.equal(
        'Identifying and removing unused content fragments reduces system overhead, optimizes storage, and helps teams focus on active content governance.',
      );
    });

    it('should have Headless tag', () => {
      const result = createOpportunityData();

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.deep.equal(['Headless']);
    });

    it('should have data with SITE data source', () => {
      const result = createOpportunityData();

      expect(result.data).to.be.an('object');
      expect(result.data).to.have.property('dataSources');
      expect(result.data.dataSources).to.be.an('array');
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should have exactly one data source', () => {
      const result = createOpportunityData();

      expect(result.data.dataSources).to.have.lengthOf(1);
    });

    it('should return same structure on multiple calls', () => {
      const result1 = createOpportunityData();
      const result2 = createOpportunityData();

      expect(result1).to.deep.equal(result2);
    });

    it('should not mutate returned object between calls', () => {
      const result1 = createOpportunityData();
      result1.tags.push('NewTag');

      const result2 = createOpportunityData();

      expect(result2.tags).to.deep.equal(['Headless']);
    });
  });
});

