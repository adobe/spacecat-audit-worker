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

import { Opportunity as Oppty, Audit } from '@adobe/spacecat-shared-data-access';
import { DATA_SOURCES, OFFSITE_AUDIT_TYPES } from './constants.js';
import { checkGoogleConnection } from './opportunity-utils.js';
import {
  createOffsiteLogger, errorField, AUDIT, PEER, OUTCOME,
} from '../utils/offsite-logging.js';

// This module is shared by all three offsite guidance handlers, so it does not know the audit
// slug at module scope. Derive it from the audit type passed by the caller so the emitted lines
// carry the correct `audit=` token.
const AUDIT_SLUG_BY_TYPE = {
  [Audit.AUDIT_TYPES.CITED_ANALYSIS]: AUDIT.CITED,
  [Audit.AUDIT_TYPES.REDDIT_ANALYSIS]: AUDIT.REDDIT,
  [Audit.AUDIT_TYPES.YOUTUBE_ANALYSIS]: AUDIT.YOUTUBE,
};

/**
 * Validates the payload shape and rejects a declared opportunity type that differs from
 * the handler-owned audit type.
 *
 * @param {*} analysisData - The parsed analysis payload (inline or fetched from S3).
 * @param {string} expectedType - The calling handler's own audit type (e.g. 'cited-analysis').
 * @returns {boolean} true if the payload is well-formed enough to process.
 */
export function isValidOffsiteAnalysis(analysisData, expectedType) {
  if (!analysisData || typeof analysisData !== 'object' || Array.isArray(analysisData)) {
    return false;
  }
  const { opportunity } = analysisData;
  if (opportunity !== undefined
      && (typeof opportunity !== 'object' || opportunity === null || Array.isArray(opportunity))) {
    return false;
  }
  if (opportunity?.type !== undefined && opportunity.type !== expectedType) {
    return false;
  }
  return true;
}

/**
 * Creates or refreshes an offsite opportunity using an explicitly resolved target.
 *
 * @param {string} auditUrl - Site URL used for data-source filtering.
 * @param {Object} auditData - Audit identity containing siteId and id.
 * @param {Object} context - Audit-worker context containing dataAccess and log.
 * @param {Function} createOpportunityData - Offsite opportunity mapper.
 * @param {string} auditType - Handler-owned offsite audit type.
 * @param {Object} options - Mapper input plus the pre-resolved target.
 * @param {Object} options.opportunityData - Incoming Mystique opportunity data.
 * @param {Object|null} options.opportunityToUpdate - Persistence target, or null to create.
 * @returns {Promise<Object>} The created or refreshed opportunity.
 */
export async function persistOffsiteOpportunity(
  auditUrl,
  auditData,
  context,
  createOpportunityData,
  auditType,
  options,
) {
  if (!OFFSITE_AUDIT_TYPES.has(auditType)) {
    throw new Error(`Unsupported offsite audit type: ${auditType}`);
  }
  if (!options || !Object.prototype.hasOwnProperty.call(options, 'opportunityToUpdate')) {
    throw new Error('opportunityToUpdate must be explicitly provided');
  }
  const { opportunityToUpdate } = options;
  if (opportunityToUpdate !== null
      && (typeof opportunityToUpdate !== 'object' || Array.isArray(opportunityToUpdate))) {
    throw new Error('opportunityToUpdate must be an opportunity or null');
  }

  const mappedOpportunity = createOpportunityData(options);
  const { dataAccess, log } = context;
  const { Opportunity } = dataAccess;
  // auditType is guaranteed to be in OFFSITE_AUDIT_TYPES (and therefore mapped) by the
  // guard above, so the slug is always defined here — no fallback needed.
  const olog = createOffsiteLogger(log, {
    audit: AUDIT_SLUG_BY_TYPE[auditType], siteId: auditData.siteId, auditId: auditData.id,
  });

  const hasGoogleConnection = await checkGoogleConnection(auditUrl, context);
  if (!hasGoogleConnection && mappedOpportunity.data?.dataSources) {
    mappedOpportunity.data.dataSources = mappedOpportunity.data.dataSources
      .filter((source) => source !== DATA_SOURCES.GSC);
  }

  try {
    if (opportunityToUpdate === null) {
      const created = await Opportunity.create({
        siteId: auditData.siteId,
        auditId: auditData.id,
        runbook: mappedOpportunity.runbook,
        type: auditType,
        origin: mappedOpportunity.origin,
        title: mappedOpportunity.title,
        description: mappedOpportunity.description,
        guidance: mappedOpportunity.guidance,
        tags: mappedOpportunity.tags,
        data: mappedOpportunity.data,
        ...(mappedOpportunity.status ? { status: mappedOpportunity.status } : {}),
      });
      olog.success('audit_persistence_evergreen_opportunity_write', 'Created opportunity', {
        peer: PEER.POSTGRES,
        direction: 'outbound',
        opportunityId: created.getId(),
        auditType,
        status: mappedOpportunity.status,
        writeAction: 'created',
      });
      return created;
    }

    opportunityToUpdate.setAuditId(auditData.id);
    opportunityToUpdate.setData({ ...mappedOpportunity.data });
    opportunityToUpdate.setUpdatedBy('system');
    await opportunityToUpdate.save();

    olog.success('audit_persistence_evergreen_opportunity_write', 'Refreshed evergreen opportunity', {
      peer: PEER.POSTGRES,
      direction: 'outbound',
      opportunityId: opportunityToUpdate.getId(),
      auditType,
      status: mappedOpportunity.status,
      writeAction: 'refreshed',
    });
    return opportunityToUpdate;
  } catch (error) {
    // The sharpest edge: a silent DB write failure here strands the run. Log loudly and
    // structured, THEN rethrow unchanged so the caller's error handling is preserved.
    olog.failure('audit_persistence_evergreen_opportunity_write', 'Failed to persist opportunity', {
      peer: PEER.POSTGRES,
      direction: 'outbound',
      reason: 'opportunity_write_failed',
      writeAction: 'write_failed',
      ...errorField(error),
    });
    throw error;
  }
}

/**
 * Resolves the evergreen offsite opportunity (status NEW).
 *
 * If duplicates exist, keeps the most recently updated one and retires the rest to IGNORED.
 *
 * @param {Object} params
 * @param {Object} params.dataAccess - The data access object (from audit-worker context).
 * @param {string} params.siteId - The site ID.
 * @param {string} params.auditType - The opportunity type to resolve (e.g. 'cited-analysis').
 * @param {Object} params.log - Logger instance.
 * @returns {Promise<Object|null>} The evergreen offsite opportunity, or null when none exists.
 * @throws {Error} When lookup or duplicate retirement fails.
 */
export async function resolveEvergreenOffsiteOpportunity({
  dataAccess, siteId, auditType, log,
}) {
  const { Opportunity } = dataAccess;
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });
  let opportunities;
  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(siteId, Oppty.STATUSES.NEW);
  } catch (e) {
    olog.failure('audit_persistence_evergreen_opportunity_read', 'Failed to fetch opportunities', {
      peer: PEER.POSTGRES, direction: 'inbound', reason: 'lookup', ...errorField(e),
    });
    throw e;
  }

  olog.success('audit_persistence_evergreen_opportunity_read', 'Fetched opportunities', {
    peer: PEER.POSTGRES, direction: 'inbound', count: (opportunities || []).length,
  });

  const matchingOpportunities = (opportunities || [])
    .filter((opportunity) => opportunity.getType() === auditType);
  if (matchingOpportunities.length === 0) {
    return null;
  }
  if (matchingOpportunities.length === 1) {
    return matchingOpportunities[0];
  }

  const [evergreenOpportunity, ...duplicates] = [...matchingOpportunities].sort(
    (a, b) => new Date(b.getUpdatedAt()) - new Date(a.getUpdatedAt()),
  );

  olog.warn('audit_persistence_opportunity_retired', 'Duplicate opportunities found; retiring extras', {
    peer: PEER.POSTGRES, direction: 'outbound', found: matchingOpportunities.length, retired: duplicates.length, kept: evergreenOpportunity.getId(), outcome: OUTCOME.DEGRADED,
  });

  duplicates.forEach((duplicate) => {
    duplicate.setStatus(Oppty.STATUSES.IGNORED);
    duplicate.setUpdatedBy('system');
  });
  // Retirement must finish before the caller updates the chosen evergreen opportunity.
  await Opportunity.saveMany(duplicates);

  return evergreenOpportunity;
}

/**
 * Returns true when a suppressed run must be stored separately from the evergreen opportunity.
 * Snapshot lookup makes suppressed-run redelivery idempotent when auditId is available.
 *
 * @param {string} incomingStatus - The status carried by the incoming run
 *   ('NEW' when surfaced, 'IGNORED' when suppressed).
 * @returns {boolean} Whether the run requires a new opportunity.
 */
export function isSuppressedRun(incomingStatus) {
  return incomingStatus === Oppty.STATUSES.IGNORED;
}
