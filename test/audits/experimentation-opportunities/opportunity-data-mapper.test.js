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
import { convertToOpportunityEntity } from '../../../src/experimentation-opportunities/opportunity-data-mapper.js';

describe('Experimentation Opportunities Opportunity Data Mapper', () => {
  describe('convertToOpportunityEntity', () => {
    it('should create opportunity entity with correct structure', () => {
      const siteId = 'test-site-id';
      const auditId = 'test-audit-id';
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 100,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [
          {
            type: 'traffic',
            vendor: '*',
            value: { earned: 5000 },
          },
        ],
      };
      const guidance = [
        {
          insight: 'Test insight',
          recommendation: 'Test recommendation',
        },
      ];

      const result = convertToOpportunityEntity(siteId, auditId, rawOppty, guidance);

      expect(result).to.be.an('object');
      expect(result).to.have.property('siteId', siteId);
      expect(result).to.have.property('auditId', auditId);
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('type', 'high-organic-low-ctr');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'A high-traffic page isn\'t engaging visitors — suggestions for optimization ready for review');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('status', 'NEW');
      expect(result).to.have.property('guidance').that.is.an('object');
      expect(result.guidance).to.have.property('recommendations').that.is.an('array');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags.length).to.be.above(0);
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.have.property('page', rawOppty.page);
      expect(result.data).to.have.property('pageViews', rawOppty.pageViews);
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should merge hardcoded tags', () => {
      const siteId = 'test-site-id';
      const auditId = 'test-audit-id';
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 100,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [],
      };

      const result = convertToOpportunityEntity(siteId, auditId, rawOppty, []);

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });

    it('should calculate opportunity impact correctly', () => {
      const siteId = 'test-site-id';
      const auditId = 'test-audit-id';
      const rawOppty = {
        page: 'https://example.com/page',
        pageViews: 1000,
        samples: 100,
        trackedKPISiteAverage: 0.05,
        trackedPageKPIName: 'CTR',
        trackedPageKPIValue: 0.03,
        metrics: [
          {
            type: 'traffic',
            vendor: '*',
            value: { earned: 10000 },
          },
        ],
      };

      const result = convertToOpportunityEntity(siteId, auditId, rawOppty, []);

      // Expected impact: (0.05 - 0.03) * 10000 = 200
      // Use approximate equality due to floating point precision
      expect(result.data).to.have.property('opportunityImpact');
      expect(result.data.opportunityImpact).to.be.closeTo(200, 0.0001);
    });

    it('should handle empty rawOppty', () => {
      const siteId = 'test-site-id';
      const auditId = 'test-audit-id';

      const result = convertToOpportunityEntity(siteId, auditId, {}, []);

      expect(result).to.have.property('data');
      expect(result.data.page).to.equal('');
      expect(result.data.pageViews).to.equal(0);
    });
  });
});

