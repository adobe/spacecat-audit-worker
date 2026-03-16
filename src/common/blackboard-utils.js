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

/**
 * Shared utilities for publishing audit metrics as blackboard facts.
 * These utilities handle versioning, supersession, and bulk operations.
 */

/**
 * Supersedes an existing fact by marking it obsolete.
 * @param {Object} dataAccess - Data access layer
 * @param {string} factKey - Fact key to supersede
 * @param {string} organizationId - Organization UUID
 * @param {string} websiteId - Website ID
 * @returns {Promise<Object|null>} - Previous fact if found, null otherwise
 */
export async function supersedePreviousFact(dataAccess, factKey, organizationId, websiteId) {
  const { BlackboardFact } = dataAccess;

  // Find most recent non-obsolete fact with matching scope
  const existingFacts = await BlackboardFact.all(
    (attrs, op) => op.and(
      op.eq(attrs.key, factKey),
      op.eq(attrs.organizationId, organizationId),
      op.eq(attrs.websiteId, websiteId),
      op.is(attrs.pageId, null),
      op.eq(attrs.isObsolete, false),
    ),
  );

  if (!existingFacts || existingFacts.length === 0) {
    return null;
  }

  // Should only be one non-obsolete fact per key/scope
  const previousFact = existingFacts[0];

  // Mark obsolete
  previousFact.setIsObsolete(true);
  previousFact.setObsoleteReason('superseded by newer audit');
  previousFact.setObsoletedAt(new Date().toISOString());
  await previousFact.save();

  return previousFact;
}

/**
 * Creates a blackboard fact data object.
 * @param {Object} params - Fact parameters
 * @returns {Object} - Fact data for BlackboardFact.create()
 */
export function createFactData({
  key,
  value,
  source,
  organizationId,
  websiteId,
  eventTime,
  version = 1,
  supersedesFactId = null,
}) {
  return {
    key,
    value,
    factType: 'metric',
    confidence: 1.0, // Audit data is authoritative
    source,
    organizationId,
    websiteId,
    pageId: null, // Most audits are site-wide
    isGlobal: false,
    eventTime,
    version,
    supersedesFactId,
    isObsolete: false,
  };
}

/**
 * Publishes facts to the blackboard in bulk.
 * @param {Object} dataAccess - Data access layer
 * @param {Array} factsToCreate - Array of fact data objects
 * @param {Object} log - Logger
 * @param {string} auditType - Audit type for logging
 * @param {string} websiteId - Website ID for logging
 */
export async function publishFactsToBlackboard(
  dataAccess,
  factsToCreate,
  log,
  auditType,
  websiteId,
) {
  const { BlackboardFact } = dataAccess;

  if (!BlackboardFact) {
    log.warn('BlackboardFact not available in dataAccess - skipping blackboard publish');
    return;
  }

  if (factsToCreate.length === 0) {
    log.debug(`No blackboard facts to publish for ${auditType} audit of ${websiteId}`);
    return;
  }

  // Bulk create facts
  await BlackboardFact.createMany(factsToCreate);
  log.info(`Published ${factsToCreate.length} blackboard facts for ${auditType} audit of ${websiteId}`);
}
