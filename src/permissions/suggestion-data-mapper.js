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
 * @typedef {import('./permission-report.js').TooStrongPermission} TooStrongPermission
 * @typedef {import('./permission-report.js').PermissionsReport} PermissionsReport
 */

/**
 * Maps a given vulnerability to a suggestion object that provides details
 * on updating vulnerable libraries to recommended versions and includes CVE information.
 *
 * @param {Object} opportunity - The opportunity object
 * @param {TooStrongPermission} tooStrongPermission - The vulnerability object
 * @return {Object} A suggestion object providing a structured representation of the vulnerability
 */
export function mapTooStrongSuggestion(opportunity, tooStrongPermission) {
  const {
    principal, path, permissions,
  } = tooStrongPermission;

  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 0,
    data: {
      issue: 'Insecure',
      path,
      principal,
      permissions,
      recommended_permissions: ['jcr:read', 'jcr:write '],
      rationale: 'Granting jcr:all permissions to a user in AEM is ill-advised, as it provides unrestricted access, thereby increasing the risk of accidental or malicious modifications that could jeopardize the system’s security, stability, and performance.',
    },
  };
}

/**
 * Maps a given vulnerability to a suggestion object that provides details
 * @param opportunity
 * @param {AdminPermission} adminPermission
 * @returns {Suggestion} A suggestion object based on the admin scan result
 */
export function mapAdminSuggestion(opportunity, adminPermission) {
  const {
    principal, path, permissions,
  } = adminPermission;

  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 0,
    data: {
      issue: 'Redundant',
      path,
      principal,
      permissions,
      recommended_permissions: ['Remove'],
      rationale: 'Defining access control policies for the administrators group in AEM is redundant, as members inherently possess full privileges, rendering explicit permissions unnecessary and adding avoidable complexity to the authorization configuration.',
    },
  };
}
