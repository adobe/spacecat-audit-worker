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
import { convertToOpportunityEntity } from '../../../src/experimentation-opportunities/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Experimentation Opportunities Opportunity Data Mapper', () => {
  describe('convertToOpportunityEntity', () => {
    it('should create opportunity entity with all required fields', () => {
      const siteId = 'site-123';
      const auditId = 'audit-456';
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [],
      };
      const guidance = [];

      const result = convertToOpportunityEntity(siteId, auditId, rawOppty, guidance);

      expect(result).to.be.an('object');
      expect(result).to.have.property('siteId', siteId);
      expect(result).to.have.property('auditId', auditId);
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('sharepoint.com');
      expect(result).to.have.property('type', 'high-organic-low-ctr');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('status', 'NEW');
      expect(result).to.have.property('guidance');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should use OPPORTUNITY_TYPES.HIGH_ORGANIC_LOW_CTR constant for tags', () => {
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.tags).to.be.an('array');
      expect(result.tags).to.deep.equal(['Low CTR', 'Engagement']);
    });

    it('should include correct data fields from rawOppty', () => {
      const rawOppty = {
        page: 'https://example.com/test',
        pageViews: 2000,
        samples: 1000,
        trackedKPISiteAverage: 0.06,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.02,
        metrics: [],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.data.page).to.equal('https://example.com/test');
      expect(result.data.pageViews).to.equal(2000);
      expect(result.data.samples).to.equal(1000);
      expect(result.data.trackedKPISiteAverage).to.equal(0.06);
      expect(result.data.trackedPageKPIName).to.equal('CTR');
      expect(result.data.trackedPageKPIValue).to.equal(0.02);
    });

    it('should calculate opportunity impact correctly when pageCTR is less than siteAverage', () => {
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [{ type: 'traffic', vendor: '*', value: { earned: 5000 } }],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.data.opportunityImpact).to.equal((0.05 - 0.03) * 5000);
      expect(result.data.opportunityImpact).to.equal(100);
    });

    it('should return 0 impact when pageCTR is greater than siteAverage', () => {
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.03,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.05,
        metrics: [{ type: 'traffic', vendor: '*', value: { earned: 5000 } }],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.data.opportunityImpact).to.equal(0);
    });

    it('should handle missing organic traffic in metrics', () => {
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.data.opportunityImpact).to.equal(0);
    });

    it('should include correct data sources', () => {
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 500,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [],
      };

      const result = convertToOpportunityEntity('site-1', 'audit-1', rawOppty, []);

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(3);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
      expect(result.data.dataSources).to.include(DATA_SOURCES.RUM);
      expect(result.data.dataSources).to.include(DATA_SOURCES.AHREFS);
    });

    it('should include guidance recommendations', () => {
      const guidance = [
        { insight: 'Test insight', recommendation: 'Test rec', type: 'TYPE1' },
      ];

      const result = convertToOpportunityEntity('site-1', 'audit-1', {}, guidance);

      expect(result.guidance.recommendations).to.deep.equal(guidance);
    });

    it('should handle empty guidance array', () => {
      const result = convertToOpportunityEntity('site-1', 'audit-1', {}, []);

      expect(result.guidance.recommendations).to.deep.equal([]);
    });

    it('should handle default values for missing rawOppty fields', () => {
      const result = convertToOpportunityEntity('site-1', 'audit-1', {}, []);

      expect(result.data.page).to.equal('');
      expect(result.data.pageViews).to.equal(0);
      expect(result.data.samples).to.equal(0);
      expect(result.data.trackedKPISiteAverage).to.equal(0);
      expect(result.data.trackedPageKPIName).to.equal('');
      expect(result.data.trackedPageKPIValue).to.equal(0);
    });

    it('should include metrics in data', () => {
      const metrics = [
        { type: 'traffic', vendor: '*', value: { earned: 1000 } },
        { type: 'other', vendor: 'test', value: { test: 123 } },
      ];

      const result = convertToOpportunityEntity('site-1', 'audit-1', { metrics }, []);

      expect(result.data.metrics).to.deep.equal(metrics);
    });
  });
});

