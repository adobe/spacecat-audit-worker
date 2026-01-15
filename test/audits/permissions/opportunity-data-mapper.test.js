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
import {
  createTooStrongOpportunityData,
  createAdminOpportunityData,
  createTooStrongMetrics,
  createAdminMetrics,
} from '../../../src/permissions/opportunity-data-mapper.js';

describe('Permissions Opportunity Data Mapper', () => {
  describe('createTooStrongMetrics', () => {
    it('should create metrics with correct structure', () => {
      const permissions = [
        { path: '/content/test1', principal: 'user1' },
        { path: '/content/test2', principal: 'user2' },
      ];

      const result = createTooStrongMetrics(permissions);

      expect(result).to.be.an('object');
      expect(result.mainMetric).to.deep.equal({ name: 'Issues', value: 2 });
      expect(result.metrics.insecure_permissions).to.equal(2);
      expect(result.metrics.redundant_permissions).to.equal(0);
    });
  });

  describe('createTooStrongOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const props = {
        mainMetric: { name: 'Issues', value: 5 },
        metrics: {
          insecure_permissions: 5,
          redundant_permissions: 0,
        },
      };

      const result = createTooStrongOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Protect sensitive data and user trust — recommendations for optimized permission settings ready for review');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags.length).to.be.above(0);
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.include(props);
      expect(result.data).to.have.property('howToFix').that.is.a('string');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data).to.have.property('securityType', 'CS-ACL-ALL');
      expect(result.data).to.have.property('securityScoreImpact', 4);
    });

    it('should merge hardcoded tags', () => {
      const props = {};

      const result = createTooStrongOpportunityData(props);

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });
  });

  describe('createAdminMetrics', () => {
    it('should create metrics with correct structure', () => {
      const permissions = [
        { path: '/content/test1', principal: 'admin' },
        { path: '/content/test2', principal: 'administrators' },
      ];

      const result = createAdminMetrics(permissions);

      expect(result).to.be.an('object');
      expect(result.mainMetric).to.deep.equal({ name: 'Issues', value: 2 });
      expect(result.metrics.insecure_permissions).to.equal(0);
      expect(result.metrics.redundant_permissions).to.equal(2);
    });
  });

  describe('createAdminOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const props = {
        mainMetric: { name: 'Issues', value: 3 },
        metrics: {
          insecure_permissions: 0,
          redundant_permissions: 3,
        },
      };

      const result = createAdminOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook').that.is.a('string').and.is.not.empty;
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title', 'Your website defines unnecessary permissions for admin / administrators');
      expect(result).to.have.property('description').that.is.a('string');
      expect(result).to.have.property('tags').that.is.an('array');
      expect(result.tags.length).to.be.above(0);
      expect(result).to.have.property('data').that.is.an('object');
      expect(result.data).to.include(props);
      expect(result.data).to.have.property('howToFix').that.is.a('string');
      expect(result.data).to.have.property('dataSources').that.is.an('array');
      expect(result.data).to.have.property('securityType', 'CS-ACL-ADMIN');
      expect(result.data).to.have.property('securityScoreImpact', 2);
    });

    it('should merge hardcoded tags', () => {
      const props = {};

      const result = createAdminOpportunityData(props);

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.above(0);
    });
  });
});

