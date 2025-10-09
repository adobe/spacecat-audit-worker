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
import { mapVulnerabilityToSuggestion } from '../../../src/vulnerabilities/suggestion-data-mapper.js';

use(sinonChai);
use(chaiAsPromised);
describe('Vulnerabilities Suggestion Data Mapper', () => {
  let sandbox;
  let mockOpportunity;
  let mockVulnerability;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    mockOpportunity = {
      getId: () => 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    };

    mockVulnerability = {
      name: 'com.fasterxml.jackson.core:jackson-databind',
      version: '2.12.3',
      recommendedVersion: '2.12.6.1',
      vulnerabilities: [
        {
          id: 'CVE-2020-36518',
          score: 7.5,
          severity: 'High',
          description: 'Deeply nested json in jackson-databind',
          url: 'https://github.com/FasterXML/jackson-databind/issues/2816',
        },
      ],
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  const createVulnerability = (overrides = {}) => ({
    ...mockVulnerability,
    ...overrides,
  });

  const createVulnerabilities = (vulns) => vulns.map((vuln) => ({
    id: `CVE-${Math.random().toString(36).substr(2, 9)}`,
    score: vuln.score,
    severity: vuln.severity,
    description: vuln.description || 'Test vulnerability',
    url: vuln.url || 'https://example.com',
  }));

  describe('mapVulnerabilityToSuggestion', () => {
    it('should map vulnerability to suggestion with single vulnerability', () => {
      const vulnerability = createVulnerability();
      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

      expect(result).to.deep.equal({
        opportunityId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        type: 'CODE_CHANGE',
        rank: 7.5,
        data: {
          library: 'com.fasterxml.jackson.core:jackson-databind',
          current_version: '2.12.3',
          recommended_version: '2.12.6.1',
          cves: [
            {
              cve_id: 'CVE-2020-36518',
              score: 7.5,
              score_text: '7.5 High',
              summary: 'Deeply nested json in jackson-databind',
              url: 'https://github.com/FasterXML/jackson-databind/issues/2816',
            },
          ],
        },
      });
    });

    it('should map vulnerability to suggestion with multiple vulnerabilities', () => {
      const vulnerability = createVulnerability({
        vulnerabilities: createVulnerabilities([
          { score: 9.5, severity: 'Critical' },
          { score: 7.2, severity: 'High' },
          { score: 4.1, severity: 'Medium' },
        ]),
      });

      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

      expect(result.rank).to.equal(9.5);
      expect(result.data.cves).to.have.lengthOf(3);
      expect(result.data.cves[0].score).to.equal(9.5);
      expect(result.data.cves[0].score_text).to.equal('9.5 Critical');
      expect(result.data.cves[1].score).to.equal(7.2);
      expect(result.data.cves[1].score_text).to.equal('7.2 High');
      expect(result.data.cves[2].score).to.equal(4.1);
      expect(result.data.cves[2].score_text).to.equal('4.1 Medium');
    });

    it('should handle empty and null vulnerabilities arrays', () => {
      const testCases = [
        { name: 'empty array', vulnerabilities: [] },
        { name: 'null vulnerabilities', vulnerabilities: null },
        { name: 'undefined vulnerabilities', vulnerabilities: undefined },
      ];

      testCases.forEach(({ vulnerabilities }) => {
        const vulnerability = createVulnerability({ vulnerabilities });
        const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

        expect(result.rank).to.equal(0);
        expect(result.data.cves).to.deep.equal([]);
      });
    });

    it('should handle missing optional fields and various score formats', () => {
      const vulnerability = createVulnerability({
        name: 'test-library',
        version: '1.0.0',
        recommendedVersion: '2.0.0',
        vulnerabilities: createVulnerabilities([
          { score: 0, severity: 'Low' },
          { score: 5.7, severity: 'Medium' },
          { score: 8.0, severity: 'High' },
          { score: 9.9, severity: 'Critical' },
        ]),
      });

      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

      expect(result.data.library).to.equal('test-library');
      expect(result.data.current_version).to.equal('1.0.0');
      expect(result.data.recommended_version).to.equal('2.0.0');
      expect(result.rank).to.equal(9.9); // Highest score
      expect(result.data.cves).to.have.lengthOf(4);
      expect(result.data.cves[0].score_text).to.equal('9.9 Critical'); // Sorted by score desc
      expect(result.data.cves[1].score_text).to.equal('8.0 High');
      expect(result.data.cves[2].score_text).to.equal('5.7 Medium');
      expect(result.data.cves[3].score_text).to.equal('0 Low');
    });

    it('should handle different severity levels and same scores', () => {
      const vulnerability = createVulnerability({
        vulnerabilities: createVulnerabilities([
          { score: 7.5, severity: 'High' },
          { score: 7.5, severity: 'Critical' },
          { score: 7.5, severity: 'Medium' },
        ]),
      });

      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

      expect(result.rank).to.equal(7.5);
      expect(result.data.cves).to.have.lengthOf(3);
      expect(result.data.cves.every((cve) => cve.score === 7.5)).to.be.true;
      expect(result.data.cves[0].score_text).to.equal('7.5 High');
      expect(result.data.cves[1].score_text).to.equal('7.5 Critical');
      expect(result.data.cves[2].score_text).to.equal('7.5 Medium');
    });

    it('should handle missing or null URL in vulnerabilities', () => {
      const vulnerability = createVulnerability({
        vulnerabilities: [
          {
            id: 'CVE-2020-36518',
            score: 7.5,
            severity: 'High',
            description: 'Test vulnerability with URL',
            url: 'https://example.com/cve',
          },
          {
            id: 'CVE-2020-36519',
            score: 6.0,
            severity: 'Medium',
            description: 'Test vulnerability without URL',
            url: null,
          },
          {
            id: 'CVE-2020-36520',
            score: 5.0,
            severity: 'Low',
            description: 'Test vulnerability with undefined URL',
            // url is undefined
          },
        ],
      });

      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, true);

      expect(result.data.cves).to.have.lengthOf(3);
      expect(result.data.cves[0].url).to.equal('https://example.com/cve');
      expect(result.data.cves[1].url).to.equal(''); // null URL should become empty string
      expect(result.data.cves[2].url).to.equal(''); // undefined URL should become empty string
    });

    it('should handle generateSuggestions=false by setting empty recommended_version', () => {
      const vulnerability = createVulnerability({
        name: 'test-library',
        version: '1.0.0',
        recommendedVersion: '2.0.0',
        vulnerabilities: createVulnerabilities([
          { score: 7.5, severity: 'High' },
        ]),
      });

      const result = mapVulnerabilityToSuggestion(mockOpportunity, vulnerability, false);

      expect(result.data.library).to.equal('test-library');
      expect(result.data.current_version).to.equal('1.0.0');
      expect(result.data.recommended_version).to.equal(''); // Should be empty when generateSuggestions=false
      expect(result.rank).to.equal(7.5);
      expect(result.data.cves).to.have.lengthOf(1);
    });
  });
});
