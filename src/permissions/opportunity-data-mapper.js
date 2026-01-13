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

import { OPPORTUNITY_TYPES, mergeTagsWithHardcodedTags } from '@adobe/spacecat-shared-utils';
import { DATA_SOURCES } from '../common/constants.js';

/**
 * @typedef {import('./permissions-report.d.ts').TooStrongPermission} TooStrongPermission
 */

/**
 * Creates an object representing opportunity properties based on the vulnerability report.
 *
 * @param {TooStrongPermission[]} permissions - The vulnerability report containing summary data.
 *
 * @return {Object} An object containing main metrics and categorized vulnerability counts.
 */
export function createTooStrongMetrics(permissions) {
  const total = permissions.length;

  return {
    mainMetric: {
      name: 'Issues',
      value: total,
    },
    metrics: {
      insecure_permissions: total,
      redundant_permissions: 0,
    },
  };
}

/**
 * Creates an object representing opportunity data for too-strong permissions.
 * @param props
 * @returns {Object} An object containing opportunity details and remediation steps.
 */
export function createTooStrongOpportunityData(props) {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
    origin: 'AUTOMATION',
    title: 'Protect sensitive data and user trust — recommendations for optimized permission settings ready for review',
    tags: mergeTagsWithHardcodedTags(OPPORTUNITY_TYPES.SECURITY_PERMISSIONS, []),
    description: 'Overly broad permissions risk data exposure — tightening access enhances privacy and compliance confidence.',
    data: {
      howToFix: 'Edit your user or group permissions in the AEM Security Permissions console, or in your code repository if applicable.\n'
        + 'For service users, evaluate their usage in your application code and evaluate what access they actually need and to what paths in the repository. Consider creating multiple service users with restricted permissions on child paths, if the service user is used in multiple places. Delete any unused service user or remove their permissions.',
      dataSources: [DATA_SOURCES.SITE],
      securityType: 'CS-ACL-ALL',
      securityScoreImpact: 4,
      ...props,
    },
  };
}

export function createAdminMetrics(permissions) {
  const total = permissions.length;

  return {
    mainMetric: {
      name: 'Issues',
      value: total,
    },
    metrics: {
      insecure_permissions: 0,
      redundant_permissions: total,
    },
  };
}

/**
 * Creates an object representing opportunity data for redundant admin permissions.
 * @param props
 * @return {Object} An object containing opportunity details and remediation steps.
 */
export function createAdminOpportunityData(props) {
  return {
    runbook: 'https://wiki.corp.adobe.com/display/WEM/Security+Success',
    origin: 'AUTOMATION',
    title: 'Your website defines unnecessary permissions for admin / administrators',
    tags: mergeTagsWithHardcodedTags(OPPORTUNITY_TYPES.SECURITY_PERMISSIONS_REDUNDANT, []),
    description: 'Your configuration defines unnecessary rules for the admin user or administrators related groups. These permissions are not taken into consideration for those principals, It creates a false sense of security.\n'
      + 'According to the OWASP Top 10 (A05:2021 – Security Misconfiguration), redundant or excessive privileges increase the risk of misconfiguration.\n'
      + 'Review and optimize permissions to maintain clarity and least privilege.',
    data: {
      howToFix: 'Edit your user or group permissions in the AEM Security Permissions console, or in your code repository if applicable.\n'
        + 'Delete any permissions defined for the admin user or the administrators group or any other principle defined as Administrative Principals  under `org.apache.jackrabbit.oak.security.authorization.AuthorizationConfigurationImpl`\n'
        + 'Review all suggested fixes below before applying.',
      dataSources: [DATA_SOURCES.SITE],
      securityType: 'CS-ACL-ADMIN',
      securityScoreImpact: 2,
      ...props,
    },
  };
}
