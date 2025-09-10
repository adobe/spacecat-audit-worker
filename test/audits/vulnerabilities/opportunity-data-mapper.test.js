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
import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import {
  VULNERABILITY_REPORT_WITH_VULNERABILITIES,
  VULNERABILITY_REPORT_NO_VULNERABILITIES,
  VULNERABILITY_REPORT_MIXED_SEVERITIES,
} from '../../fixtures/vulnerabilities/vulnerability-reports.js';
import { createOpportunityProps, createOpportunityData } from '../../../src/vulnerabilities/opportunity-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);

describe('Vulnerabilities Opportunity Data Mapper', () => {
  let sandbox;
  let mockVulnerabilityReport;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockVulnerabilityReport = VULNERABILITY_REPORT_WITH_VULNERABILITIES;
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createVulnerabilityReport = (overrides = {}) => ({
    ...mockVulnerabilityReport,
    ...overrides,
  });

  describe('createOpportunityProps', () => {
    it('should create opportunity props with correct metrics', () => {
      const vulnReport = createVulnerabilityReport();

      const result = createOpportunityProps(vulnReport);

      expect(result).to.deep.equal({
        mainMetric: {
          name: 'Vulnerabilities',
          value: 12,
        },
        metrics: {
          high_risk_vulnerabilities: 23, // 22 high + 1 critical
          medium_risk_vulnerabilities: 22,
          low_risk_vulnerabilities: 6,
        },
      });
    });

    it('should handle various vulnerability scenarios', () => {
      const testCases = [
        {
          name: 'no vulnerabilities',
          report: VULNERABILITY_REPORT_NO_VULNERABILITIES,
          expectedMainValue: 12,
          expectedHighRisk: 0,
        },
        {
          name: 'only critical vulnerabilities',
          report: createVulnerabilityReport({
            summary: {
              totalComponents: 3,
              totalVulnerabilities: 5,
              criticalVulnerabilities: 5,
              highVulnerabilities: 0,
              mediumVulnerabilities: 0,
              lowVulnerabilities: 0,
            },
          }),
          expectedMainValue: 3,
          expectedHighRisk: 5,
        },
        {
          name: 'mixed severity levels',
          report: VULNERABILITY_REPORT_MIXED_SEVERITIES,
          expectedMainValue: 8,
          expectedHighRisk: 7, // 2 critical + 5 high
        },
      ];

      testCases.forEach(({
        report,
        expectedMainValue,
        expectedHighRisk,
      }) => {
        const result = createOpportunityProps(report);

        expect(result.mainMetric.value).to.equal(expectedMainValue);
        expect(result.metrics.high_risk_vulnerabilities).to.equal(expectedHighRisk);
      });
    });
  });

  describe('createOpportunityData', () => {
    it('should create opportunity data with correct structure', () => {
      const props = {
        mainMetric: { name: 'Vulnerabilities', value: 12 },
        metrics: {
          high_risk_vulnerabilities: 23,
          medium_risk_vulnerabilities: 22,
          low_risk_vulnerabilities: 6,
        },
      };

      const result = createOpportunityData(props);

      expect(result).to.have.property('runbook');
      expect(result).to.have.property('origin', 'AUTOMATION');
      expect(result).to.have.property('title');
      expect(result).to.have.property('description');
      expect(result).to.have.property('tags');
      expect(result.data).to.include(props);
      expect(result.data).to.have.property('howToFix');
      expect(result.data).to.have.property('dataSources');
      expect(result.data).to.have.property('securityType', 'CS-VULN-SBOM');
    });

    it('should include provided props in data object', () => {
      const props = {
        customField: 'customValue',
        testProperty: 'testValue',
      };

      const result = createOpportunityData(props);

      expect(result.data).to.include(props);
      expect(result.data.customField).to.equal('customValue');
      expect(result.data.testProperty).to.equal('testValue');
    });

    it('should handle edge cases', () => {
      const edgeCases = [
        {
          name: 'zero values',
          props: { totalVulnerabilities: 0 },
        },
        {
          name: 'empty data object',
          props: {},
        },
        {
          name: 'null data values',
          props: { field: null },
        },
      ];

      edgeCases.forEach(({ props }) => {
        const result = createOpportunityData(props);

        expect(result.data).to.include(props);
        expect(result).to.have.property('runbook');
        expect(result).to.have.property('origin', 'AUTOMATION');
      });
    });
  });
});
