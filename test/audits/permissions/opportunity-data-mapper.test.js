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
import {
  createTooStrongMetrics,
  createTooStrongOpportunityData,
  createAdminMetrics,
  createAdminOpportunityData,
} from '../../../src/permissions/opportunity-data-mapper.js';
import { DATA_SOURCES } from '../../../src/common/constants.js';

describe('Permissions Opportunity Data Mapper', () => {
  describe('createTooStrongMetrics', () => {
    it('should create metrics with correct structure', () => {
      const permissions = [
        { path: '/content/test1', principal: 'user1' },
        { path: '/content/test2', principal: 'user2' },
      ];

      const result = createTooStrongMetrics(permissions);

      expect(result).to.be.an('object');
      expect(result).to.have.property('mainMetric');
      expect(result).to.have.property('metrics');
    });

    it('should calculate total count correctly', () => {
      const permissions = [
        { path: '/content/test1', principal: 'user1' },
        { path: '/content/test2', principal: 'user2' },
        { path: '/content/test3', principal: 'user3' },
      ];

      const result = createTooStrongMetrics(permissions);

      expect(result.mainMetric.name).to.equal('Issues');
      expect(result.mainMetric.value).to.equal(3);
      expect(result.metrics.insecure_permissions).to.equal(3);
      expect(result.metrics.redundant_permissions).to.equal(0);
    });

    it('should handle empty permissions array', () => {
      const result = createTooStrongMetrics([]);

      expect(result.mainMetric.value).to.equal(0);
      expect(result.metrics.insecure_permissions).to.equal(0);
    });
  });

  describe('createTooStrongOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const props = {
        customField: 'customValue',
      };

      const result = createTooStrongOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('wiki.corp.adobe.com');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result.title).to.include('Protect sensitive data');
      expect(result).to.have.property('description');
      expect(result.description).to.include('permissions');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct data fields', () => {
      const props = {
        testField: 'testValue',
      };

      const result = createTooStrongOpportunityData(props);

      expect(result.data).to.have.property('howToFix');
      expect(result.data.howToFix).to.be.a('string');
      expect(result.data.howToFix.length).to.be.greaterThan(0);
      expect(result.data).to.have.property('dataSources');
      expect(result.data).to.have.property('securityType', 'CS-ACL-ALL');
      expect(result.data).to.have.property('securityScoreImpact', 4);
      expect(result.data.testField).to.equal('testValue');
    });

    it('should include correct data sources', () => {
      const result = createTooStrongOpportunityData({});

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should merge props into data object', () => {
      const props = {
        customProp: 'customValue',
        anotherProp: 123,
      };

      const result = createTooStrongOpportunityData(props);

      expect(result.data.customProp).to.equal('customValue');
      expect(result.data.anotherProp).to.equal(123);
    });

    it('should include tags array', () => {
      const result = createTooStrongOpportunityData({});

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.greaterThan(0);
    });
  });

  describe('createAdminMetrics', () => {
    it('should create metrics with correct structure', () => {
      const permissions = [
        { path: '/content/admin1', principal: 'admin' },
        { path: '/content/admin2', principal: 'administrators' },
      ];

      const result = createAdminMetrics(permissions);

      expect(result).to.be.an('object');
      expect(result).to.have.property('mainMetric');
      expect(result).to.have.property('metrics');
    });

    it('should calculate total count correctly', () => {
      const permissions = [
        { path: '/content/admin1', principal: 'admin' },
        { path: '/content/admin2', principal: 'administrators' },
        { path: '/content/admin3', principal: 'admin' },
      ];

      const result = createAdminMetrics(permissions);

      expect(result.mainMetric.name).to.equal('Issues');
      expect(result.mainMetric.value).to.equal(3);
      expect(result.metrics.insecure_permissions).to.equal(0);
      expect(result.metrics.redundant_permissions).to.equal(3);
    });

    it('should handle empty permissions array', () => {
      const result = createAdminMetrics([]);

      expect(result.mainMetric.value).to.equal(0);
      expect(result.metrics.redundant_permissions).to.equal(0);
    });
  });

  describe('createAdminOpportunityData', () => {
    it('should create opportunity data with all required fields', () => {
      const props = {
        customField: 'customValue',
      };

      const result = createAdminOpportunityData(props);

      expect(result).to.be.an('object');
      expect(result).to.have.property('runbook');
      expect(result.runbook).to.include('wiki.corp.adobe.com');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result.title).to.include('admin');
      expect(result).to.have.property('description');
      expect(result.description).to.include('permissions');
      expect(result).to.have.property('tags');
      expect(result).to.have.property('data');
    });

    it('should include correct data fields', () => {
      const props = {
        testField: 'testValue',
      };

      const result = createAdminOpportunityData(props);

      expect(result.data).to.have.property('howToFix');
      expect(result.data.howToFix).to.be.a('string');
      expect(result.data.howToFix.length).to.be.greaterThan(0);
      expect(result.data).to.have.property('dataSources');
      expect(result.data).to.have.property('securityType', 'CS-ACL-ADMIN');
      expect(result.data).to.have.property('securityScoreImpact', 2);
      expect(result.data.testField).to.equal('testValue');
    });

    it('should include correct data sources', () => {
      const result = createAdminOpportunityData({});

      expect(result.data.dataSources).to.be.an('array').with.lengthOf(1);
      expect(result.data.dataSources).to.include(DATA_SOURCES.SITE);
    });

    it('should merge props into data object', () => {
      const props = {
        customProp: 'customValue',
        anotherProp: 456,
      };

      const result = createAdminOpportunityData(props);

      expect(result.data.customProp).to.equal('customValue');
      expect(result.data.anotherProp).to.equal(456);
    });

    it('should include tags array', () => {
      const result = createAdminOpportunityData({});

      expect(result.tags).to.be.an('array');
      expect(result.tags.length).to.be.greaterThan(0);
    });

    it('should have description mentioning OWASP', () => {
      const result = createAdminOpportunityData({});

      expect(result.description).to.include('OWASP');
    });
  });
});

