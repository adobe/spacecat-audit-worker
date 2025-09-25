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

/**
 * @typedef {import('./vulnerability-report.d.ts').VulnerableComponent} VulnerableComponent
 * @typedef {import('./vulnerability-report.d.ts').Vulnerability} Vulnerability
 */

/**
 * Calculates and returns the highest score from a list of vulnerabilities.
 *
 * @param {Array<Vulnerability>} vulnerabilities - An array of vulnerability objects.
 * @return {number} The highest score found among the vulnerabilities.
 */
function highestScore(vulnerabilities) {
  if (!vulnerabilities || vulnerabilities.length === 0) {
    return 0;
  }

  return Math.max(...vulnerabilities.map((vuln) => vuln.score));
}

/**
 * Maps a given vulnerability to a suggestion object that provides details
 * on updating vulnerable libraries to recommended versions and includes CVE information.
 *
 * @param {Object} opportunity - The opportunity object
 * @param {VulnerableComponent} vulnerability - The vulnerability object
 * @return {Object} A suggestion object providing a structured representation of the vulnerability
 */
export function mapTooStrongSuggestion(opportunity, vulnerability) {
  const {
    name, version, recommendedVersion, vulnerabilities,
  } = vulnerability;

  // Handle null/undefined vulnerabilities
  const safeVulnerabilities = vulnerabilities || [];

  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: highestScore(safeVulnerabilities), // Used for sorting
    data: {
      library: name,
      current_version: version,
      recommended_version: recommendedVersion,
      cves: safeVulnerabilities.sort((a, b) => b.score - a.score).map((vuln) => ({
        cve_id: vuln.id,
        score: vuln.score,
        score_text: `${vuln.score === 0 ? '0' : vuln.score.toFixed(1)} ${vuln.severity}`,
        summary: vuln.description,
        url: vuln.url || '',
      })),
    },
  };
}

/**
 * Maps a given vulnerability to a suggestion object that provides details
 * @param opportunity
 * @param adminScanResult
 * @returns {Suggestion} A suggestion object based on the admin scan result
 */
export function mapAdminSuggestion(opportunity, adminScanResult) {
  const {
    principal, path, privileges,
  } = adminScanResult;

  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    data: {
      issue: 'Redundant',
      path: principal,
      principal: path,
      permissions: privileges,
      recommended_permissions: ['Remove'],
      rationale: 'Defining access control policies for the administrators group in AEM is redundant, as members inherently possess full privileges, rendering explicit permissions unnecessary and adding avoidable complexity to the authorization configuration.',
    },
  };
}
