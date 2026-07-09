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

import { Suggestion as SuggestionDataAccess } from '@adobe/spacecat-shared-data-access';
import { defaultMergeStatusFunction } from '../utils/data-access.js';

/**
 * @typedef {import('./permission-report.js').TooStrongPermission} TooStrongPermission
 * @typedef {import('./permission-report.js').PermissionsReport} PermissionsReport
 */

/**
 * Transforms a raw too-strong-permission entry into the canonical suggestion data
 * shape. This is the single place where the raw scan fields get reshaped into the
 * fields a suggestion actually stores. Running this transform on every incoming item
 * *before* syncSuggestions means both the stored suggestion data and the
 * freshly-fetched data are always in the same shape, so matching suggestions get
 * properly overwritten on merge instead of accumulating stale/duplicate raw fields.
 *
 * @param {TooStrongPermission} tooStrongPermission - The raw too-strong-permission entry.
 * @return {Object} The suggestion data in its canonical (stored) shape.
 */
export function toTooStrongSuggestionData(tooStrongPermission) {
  const {
    principal, path, permissions,
  } = tooStrongPermission;

  return {
    issue: 'Insecure',
    path,
    principal,
    permissions,
    recommended_permissions: ['jcr:read', 'jcr:write '],
    rationale: 'Granting jcr:all permissions to a user in AEM is ill-advised, as it provides unrestricted access, thereby increasing the risk of accidental or malicious modifications that could jeopardize the system’s security, stability, and performance.',
  };
}

/**
 * Maps already-transformed suggestion data (see toTooStrongSuggestionData) to a
 * suggestion object. Performs no further data transformation - the data is passed
 * through as-is.
 *
 * @param {Object} opportunity - The opportunity object
 * @param {Object} suggestionData - Suggestion data in its canonical shape
 * (see toTooStrongSuggestionData)
 * @return {Object} A suggestion object providing a structured representation of the issue
 */
export function mapTooStrongSuggestion(opportunity, suggestionData) {
  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 0,
    data: { ...suggestionData },
  };
}

/**
 * Transforms a raw admin-permission entry into the canonical suggestion data shape.
 * See toTooStrongSuggestionData for why this transform exists.
 *
 * @param {AdminPermission} adminPermission - The raw admin-permission entry.
 * @return {Object} The suggestion data in its canonical (stored) shape.
 */
export function toAdminSuggestionData(adminPermission) {
  const {
    principal, path, permissions,
  } = adminPermission;

  return {
    issue: 'Redundant',
    path,
    principal,
    permissions,
    recommended_permissions: ['Remove'],
    rationale: 'Defining access control policies for the administrators group in AEM is redundant, as members inherently possess full privileges, rendering explicit permissions unnecessary and adding avoidable complexity to the authorization configuration.',
  };
}

/**
 * Maps already-transformed suggestion data (see toAdminSuggestionData) to a
 * suggestion object. Performs no further data transformation - the data is passed
 * through as-is.
 *
 * @param opportunity
 * @param {Object} suggestionData - Suggestion data in its canonical shape
 * (see toAdminSuggestionData)
 * @returns {Suggestion} A suggestion object based on the admin scan result
 */
export function mapAdminSuggestion(opportunity, suggestionData) {
  return {
    opportunityId: opportunity.getId(),
    type: 'CONTENT_UPDATE',
    rank: 0,
    data: { ...suggestionData },
  };
}

/**
 * When the existing suggestion is in FIXED status, it will be
 * transitioned to PENDING_VALIDATION or NEW depending on site configuration.
 * @param existing Suggestion previously stored in DB
 * @param newDataItem New suggestion data item
 * @param ctx Context object
 * @returns {string|null} New status or fallback to default merge function
 */
export function mergeSuggestionStatus(existing, newDataItem, ctx) {
  const { log, site } = ctx;
  const currentStatus = existing.getStatus();

  if (currentStatus === SuggestionDataAccess.STATUSES.FIXED) {
    log.warn('Resolved suggestion found in audit. Possible regression.');
    const requiresValidation = Boolean(site?.requiresValidation);
    return requiresValidation
      ? SuggestionDataAccess.STATUSES.PENDING_VALIDATION
      : SuggestionDataAccess.STATUSES.NEW;
  }

  return defaultMergeStatusFunction(existing, newDataItem, ctx);
}
