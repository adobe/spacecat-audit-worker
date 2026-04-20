/*
 * Copyright 2026 Adobe. All rights reserved.
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
 * Creates a traffic audit logger with consistent formatting.
 * @param {Object} log - The logger instance from context
 * @param {string} prefix - Log prefix (e.g., '[paid-audit]', '[email-audit]')
 * @param {string} guidanceType - The type of guidance (e.g., 'guidance:traffic-analysis')
 * @returns {Object} Logger methods for traffic audit operations
 */
export function createTrafficLogger(log, prefix, guidanceType) {
  const formatSuffix = (siteId, url, auditId) => `for site: ${siteId}, url: ${url}, audit: ${auditId}`;

  return {
    received: (siteId, url, auditId) => log.info(
      `${prefix} Received ${guidanceType} message ${formatSuffix(siteId, url, auditId)}`,
    ),

    failed: (reason, siteId, url, auditId) => log.warn(
      `${prefix} Failed ${guidanceType}: ${reason} ${formatSuffix(siteId, url, auditId)}`,
    ),

    skipping: (reason, siteId, url, auditId) => log.info(
      `${prefix} Skipping ${guidanceType}: ${reason} ${formatSuffix(siteId, url, auditId)}`,
    ),

    creatingOpportunity: (siteId, url, auditId) => log.info(
      `${prefix} Creating ${guidanceType} opportunity ${formatSuffix(siteId, url, auditId)}`,
    ),

    createdOpportunity: (siteId, url, auditId) => log.info(
      `${prefix} Created ${guidanceType} opportunity ${formatSuffix(siteId, url, auditId)}`,
    ),

    createdSuggestion: (opportunityId, siteId, url, auditId) => log.info(
      `${prefix} Created ${guidanceType} suggestion for opportunity: ${opportunityId}, site: ${siteId}, url: ${url}, audit: ${auditId}`,
    ),

    markedIgnored: (opportunityId, siteId, url, auditId) => log.info(
      `${prefix} Marked ${guidanceType} opportunity ${opportunityId} as IGNORED ${formatSuffix(siteId, url, auditId)}`,
    ),
  };
}
