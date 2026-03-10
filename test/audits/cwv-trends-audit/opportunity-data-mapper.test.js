/*
 * Copyright 2024 Adobe. All rights reserved.
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
  createOpportunityData,
  compareOpportunityByDevice,
} from '../../../src/cwv-trends-audit/opportunity-data-mapper.js';

describe('CWV Trends Audit Opportunity Data Mapper', () => {
  describe('createOpportunityData', () => {
    it('should create opportunity data for mobile device', () => {
      // Arrange
      const auditResult = {
        deviceType: 'mobile',
        summary: {
          totalUrls: 100,
          avgGood: 65.5,
          avgNeedsImprovement: 25.0,
          avgPoor: 9.5,
        },
        trendData: [],
        urlDetails: [],
      };

      // Act
      const result = createOpportunityData(auditResult);

      // Assert
      expect(result).to.have.property('title', 'Mobile Web Performance Trends Report');
      expect(result).to.have.property('description').that.includes('mobile');
      expect(result).to.have.property('guidance').that.includes('65.5%');
      expect(result).to.have.property('runbook').that.includes('adobe.sharepoint.com');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('tags').that.includes('mobile');
      expect(result).to.have.property('data');
      expect(result.data).to.have.property('deviceType', 'mobile');
      expect(result.data).to.have.property('summary', auditResult.summary);
      expect(result.data).to.have.property('dataSources').that.is.an('array');
    });

    it('should create opportunity data for desktop device', () => {
      // Arrange
      const auditResult = {
        deviceType: 'desktop',
        summary: {
          totalUrls: 80,
          avgGood: 70.2,
          avgNeedsImprovement: 22.3,
          avgPoor: 7.5,
        },
        trendData: [],
        urlDetails: [],
      };

      // Act
      const result = createOpportunityData(auditResult);

      // Assert
      expect(result).to.have.property('title', 'Desktop Web Performance Trends Report');
      expect(result).to.have.property('description').that.includes('desktop');
      expect(result.data).to.have.property('deviceType', 'desktop');
      expect(result).to.have.property('tags').that.includes('desktop');
    });

    it('should format guidance with summary percentages', () => {
      // Arrange
      const auditResult = {
        deviceType: 'mobile',
        summary: {
          totalUrls: 50,
          avgGood: 68.123,
          avgNeedsImprovement: 23.456,
          avgPoor: 8.421,
        },
        trendData: [],
        urlDetails: [],
      };

      // Act
      const result = createOpportunityData(auditResult);

      // Assert
      expect(result.guidance).to.include('68.1%');
      expect(result.guidance).to.include('23.5%');
      expect(result.guidance).to.include('8.4%');
    });

    it('should include all required tags', () => {
      // Arrange
      const auditResult = {
        deviceType: 'mobile',
        summary: {
          totalUrls: 100,
          avgGood: 65.5,
          avgNeedsImprovement: 25.0,
          avgPoor: 9.5,
        },
        trendData: [],
        urlDetails: [],
      };

      // Act
      const result = createOpportunityData(auditResult);

      // Assert
      expect(result.tags).to.include('cwv');
      expect(result.tags).to.include('performance');
      expect(result.tags).to.include('trends');
      expect(result.tags).to.include('mobile');
    });
  });

  describe('compareOpportunityByDevice', () => {
    it('should return true when device types match', () => {
      // Arrange
      const existingOpportunity = {
        getData: () => ({ deviceType: 'mobile' }),
      };

      const opportunityInstance = {
        data: { deviceType: 'mobile' },
      };

      // Act
      const result = compareOpportunityByDevice(existingOpportunity, opportunityInstance);

      // Assert
      expect(result).to.be.true;
    });

    it('should return false when device types do not match', () => {
      // Arrange
      const existingOpportunity = {
        getData: () => ({ deviceType: 'mobile' }),
      };

      const opportunityInstance = {
        data: { deviceType: 'desktop' },
      };

      // Act
      const result = compareOpportunityByDevice(existingOpportunity, opportunityInstance);

      // Assert
      expect(result).to.be.false;
    });

    it('should handle missing device type in existing opportunity', () => {
      // Arrange
      const existingOpportunity = {
        getData: () => ({}),
      };

      const opportunityInstance = {
        data: { deviceType: 'mobile' },
      };

      // Act
      const result = compareOpportunityByDevice(existingOpportunity, opportunityInstance);

      // Assert
      expect(result).to.be.false;
    });

    it('should handle missing device type in new opportunity', () => {
      // Arrange
      const existingOpportunity = {
        getData: () => ({ deviceType: 'mobile' }),
      };

      const opportunityInstance = {
        data: {},
      };

      // Act
      const result = compareOpportunityByDevice(existingOpportunity, opportunityInstance);

      // Assert
      expect(result).to.be.false;
    });

    it('should handle null data', () => {
      // Arrange
      const existingOpportunity = {
        getData: () => null,
      };

      const opportunityInstance = {
        data: null,
      };

      // Act
      const result = compareOpportunityByDevice(existingOpportunity, opportunityInstance);

      // Assert
      expect(result).to.be.false;
    });
  });
});
