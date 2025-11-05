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

import { DATA_SOURCES } from '../common/constants.js';

/**
 * @typedef {import('./vulnerability-report.d.ts').VulnerabilityReport} VulnerabilityReport
 */

/**
 * Creates an object representing opportunity properties based on the vulnerability report.
 *
 * @param {VulnerabilityReport} vulnReport - The vulnerability report containing summary data.
 *
 * @return {Object} An object containing main metrics and categorized vulnerability counts.
 */
export function createOpportunityProps(vulnReport) {
  const total = vulnReport.summary.totalComponents;
  const high = vulnReport.summary.highVulnerabilities + vulnReport.summary.criticalVulnerabilities;
  const medium = vulnReport.summary.mediumVulnerabilities;
  const low = vulnReport.summary.lowVulnerabilities;

  return {
    mainMetric: {
      name: 'Vulnerabilities',
      value: total,
    },
    metrics: {
      high_risk_vulnerabilities: high,
      medium_risk_vulnerabilities: medium,
      low_risk_vulnerabilities: low,
    },
  };
}

/**
 * Creates an opportunity data object containing details about 3rd-party library vulnerabilities.
 *
 * @param {Object} props - An object containing main metrics and categorized vulnerability counts.
 * @return {Object} An object containing details about the vulnerabilities, how to fix them, and
 *                  other metadata.
 */
export function createOpportunityData(props) {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
    origin: 'AUTOMATION',
    title: '3rd-party libraries in application code have known vulnerabilities',
    description: 'The application code is using 3rd party libraries which have known vulnerabilities.\n\nThese vulnerabilities could be exploited by a malicious attacker, increasing the risk and decreasing the security posture of your website.\n\nIt is highly recommended to always upgrade them to the latest compatible versions, as new vulnerabilities are discovered.',
    tags: ['Vulnerabilities'],
    data: {
      howToFix: 'Apply a code patch which upgrades the versions of the 3rd-party libraries in the application code.\n\nReview all suggested fixes below before applying. Entries can be dismissed or edited as needed.',
      dataSources: [DATA_SOURCES.SITE],
      securityType: 'CS-VULN-SBOM',
      ...props,
    },
  };
}
