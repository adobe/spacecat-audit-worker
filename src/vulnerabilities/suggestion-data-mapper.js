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

import { isNonEmptyArray } from '@adobe/spacecat-shared-utils';

/**
 * Calculates and returns the highest score from a list of vulnerabilities.
 *
 * @param {Array<Vulnerability>} vulnerabilities - An array of vulnerability objects.
 * @return {number} The highest score found among the vulnerabilities.
 */
function highestScore(vulnerabilities) {
  if (!isNonEmptyArray(vulnerabilities)) {
    return 0;
  }

  return Math.max(...vulnerabilities.map((vuln) => vuln.score));
}

/**
 * Transforms a raw vulnerable component (as reported by the scan) into the canonical
 * suggestion data shape. This is the single place where the raw report fields
 * (name/version/dependencyTree/...) are renamed/reshaped into the fields a suggestion
 * actually stores (library/current_version/dependency_tree/...). Running this
 * transform on every incoming item *before* syncSuggestions means both the stored
 * suggestion data and the freshly-fetched data are always in the same shape, so
 * matching suggestions get properly overwritten on merge instead of accumulating
 * stale/duplicate raw fields.
 *
 * @param {VulnerableComponent} component - The raw vulnerable component from the report.
 * @return {Object} The suggestion data in its canonical (stored) shape.
 */
export function toSuggestionData(component) {
  const {
    name, version, recommendedVersion, vulnerabilities, dependencyTree,
  } = component;

  // Handle null/undefined vulnerabilities
  const safeVulnerabilities = vulnerabilities || [];

  return {
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
    dependency_tree: dependencyTree || [],
  };
}

/**
 * Maps already-transformed suggestion data (see toSuggestionData) to a suggestion
 * object. Performs no further data transformation - the data is passed through as-is.
 *
 * @param {Object} opportunity - The opportunity object
 * @param {Object} suggestionData - Suggestion data in its canonical shape
 * (see toSuggestionData)
 * @return {Object} A suggestion object providing a structured representation of the vulnerability
 */
export function mapVulnerabilityToSuggestion(opportunity, suggestionData) {
  return {
    opportunityId: opportunity.getId(),
    type: 'CODE_CHANGE',
    rank: highestScore(suggestionData.cves), // Used for sorting
    data: { ...suggestionData },
  };
}
