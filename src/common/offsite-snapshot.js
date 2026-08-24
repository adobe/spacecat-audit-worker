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

import { Opportunity as Oppty } from '@adobe/spacecat-shared-data-access';
import {
  createOffsiteLogger, errorField, AUDIT, PEER,
} from '../utils/offsite-logging.js';

export const SNAPSHOT_TAG = 'offsite-snapshot';

export const SNAPSHOT_KINDS = {
  // Previous evergreen state preserved before a surfaced refresh replaces it.
  SUPERSEDED_REFRESH: 'superseded-refresh',
  // Suppressed audit run retained as an inert snapshot.
  SUPPRESSED_REFRESH: 'suppressed-refresh',
};

// Mirrors the mapping in offsite-refresh.js — kept local to avoid a cross-module circular import.
const AUDIT_SLUG_BY_TYPE = {
  'cited-analysis': AUDIT.CITED,
  'reddit-analysis': AUDIT.REDDIT,
  'youtube-analysis': AUDIT.YOUTUBE,
};

/** Returns true for a managed snapshot of the requested audit type. */
export function isOffsiteSnapshot(opportunity, auditType) {
  return opportunity.getType() === auditType
    && (opportunity.getTags() || []).includes(SNAPSHOT_TAG);
}

/**
 * Finds a snapshot by (siteId, auditType, triggerAuditId).
 * Lookup failures propagate to avoid duplicate creation.
 *
 * NOTE: This fetches ALL IGNORED opportunities for a site from the DB and filters in-memory.
 * Since every refresh creates a snapshot, the working set grows over time (one per refresh across
 * all audit types). For active sites this can reach hundreds of records within months. A
 * server-side filtered query in the data-access layer would close this gap.
 * TODO(LLMO-6154 or follow-up): push type+tag filtering to PostgREST.
 */
export async function findSnapshotByTriggerAuditId({
  dataAccess, siteId, auditType, triggerAuditId, log,
}) {
  const { Opportunity } = dataAccess;
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });
  let opportunities;

  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(siteId, Oppty.STATUSES.IGNORED);
  } catch (e) {
    olog.failure('audit_persistence_snapshot_resolved', 'Failed to look up existing snapshots', {
      peer: PEER.POSTGRES, direction: 'inbound', auditType, ...errorField(e),
    });
    throw e;
  }

  return (opportunities || []).find((opportunity) => {
    const snapshotMetadata = opportunity.getData()?.snapshot;

    return isOffsiteSnapshot(opportunity, auditType)
      && snapshotMetadata?.triggerAuditId === triggerAuditId;
  }) || null;
}

/**
 * Adds snapshot metadata to plain opportunity data.
 */
export function buildSnapshotData(
  sourceData,
  { evergreenOpportunityId, kind, triggerAuditId },
) {
  return {
    ...sourceData,
    snapshot: {
      ...(evergreenOpportunityId ? { evergreenOpportunityId } : {}),
      kind,
      ...(triggerAuditId ? { triggerAuditId } : {}),
    },
  };
}

/**
 * Adds snapshot tag to existing tags.
 */
function buildSnapshotTags(existingTags) {
  return [...new Set([...(existingTags || []), SNAPSHOT_TAG])];
}

/**
 * Prepares persistence options for a suppressed audit-run snapshot.
 */
export async function prepareSuppressedRunSnapshot({
  dataAccess,
  siteId,
  auditType,
  triggerAuditId,
  opportunityData,
  evergreenOpportunity,
  log,
}) {
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });

  // The suppressed run itself becomes the snapshot; the evergreen remains unchanged.
  const suppressedRunSnapshotData = {
    ...opportunityData,
    tags: buildSnapshotTags(opportunityData.tags),
    data: buildSnapshotData(opportunityData.data || {}, {
      evergreenOpportunityId: evergreenOpportunity?.getId(),
      kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH,
      triggerAuditId,
    }),
  };

  if (!triggerAuditId) {
    olog.warn('audit_persistence_snapshot_prepared', 'Missing auditId; snapshot idempotency and traceability are unavailable', {
      reason: 'missing_audit_id',
      reasonCategory: 'infra',
    });
  }

  const existingSuppressedRunSnapshot = triggerAuditId
    ? await findSnapshotByTriggerAuditId({
      dataAccess, siteId, auditType, triggerAuditId, log,
    })
    : null;

  if (existingSuppressedRunSnapshot) {
    // triggerAuditId is provably truthy here: existingSuppressedRunSnapshot can only be set
    // by the lookup above, which only runs when triggerAuditId is truthy.
    olog.success('audit_persistence_snapshot_prepared', 'Reusing suppressed-refresh snapshot', {
      peer: PEER.POSTGRES,
      snapshotId: existingSuppressedRunSnapshot.getId(),
      triggerAuditId,
      snapshotAction: 'reused',
    });
  } else {
    olog.start('audit_persistence_snapshot_prepared', 'Preparing new suppressed-refresh snapshot', {
      triggerAuditId: triggerAuditId || undefined,
      snapshotAction: 'creating',
    });
  }

  return {
    opportunityData: suppressedRunSnapshotData,
    opportunityToUpdate: existingSuppressedRunSnapshot,
  };
}

/**
 * Preserves the previous evergreen state and prepares its surfaced refresh.
 */
export async function prepareSupersededRunSnapshot({
  dataAccess,
  siteId,
  auditType,
  triggerAuditId,
  opportunityData,
  evergreenOpportunity,
  log,
}) {
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });

  if (!evergreenOpportunity) {
    // First surfaced run: there is no previous evergreen state to preserve.
    olog.debug('audit_persistence_snapshot_prepared', 'No evergreen opportunity exists; no superseded-refresh snapshot is needed', {
      snapshotAction: 'skipped',
    });
    return { opportunityData, opportunityToUpdate: null };
  }

  if (!triggerAuditId) {
    olog.warn('audit_persistence_snapshot_prepared', 'Missing auditId; snapshot idempotency and traceability are unavailable', {
      reason: 'missing_audit_id',
      reasonCategory: 'infra',
    });
  }

  const existingSupersededRunSnapshot = triggerAuditId
    ? await findSnapshotByTriggerAuditId({
      dataAccess, siteId, auditType, triggerAuditId, log,
    })
    : null;

  if (existingSupersededRunSnapshot) {
    // triggerAuditId is provably truthy here: existingSupersededRunSnapshot can only be set
    // by the lookup above, which only runs when triggerAuditId is truthy.
    olog.success('audit_persistence_snapshot_prepared', 'Reusing superseded-refresh snapshot', {
      peer: PEER.POSTGRES,
      snapshotId: existingSupersededRunSnapshot.getId(),
      triggerAuditId,
      snapshotAction: 'reused',
    });
  }

  if (!existingSupersededRunSnapshot) {
    // Preserve the evergreen before its data and suggestions are refreshed.
    const { Opportunity } = dataAccess;

    const scopeType = evergreenOpportunity.getScopeType();
    const scopeId = evergreenOpportunity.getScopeId();

    const snapshot = await Opportunity.create({
      siteId: evergreenOpportunity.getSiteId(),
      auditId: evergreenOpportunity.getAuditId(),
      type: evergreenOpportunity.getType(),
      origin: evergreenOpportunity.getOrigin(),
      title: evergreenOpportunity.getTitle(),
      description: evergreenOpportunity.getDescription(),
      runbook: evergreenOpportunity.getRunbook(),
      guidance: evergreenOpportunity.getGuidance(),
      tags: buildSnapshotTags(evergreenOpportunity.getTags()),
      status: Oppty.STATUSES.IGNORED,
      ...(scopeType && scopeId ? { scopeType, scopeId } : {}),
      data: buildSnapshotData(evergreenOpportunity.getData(), {
        evergreenOpportunityId: evergreenOpportunity.getId(),
        kind: SNAPSHOT_KINDS.SUPERSEDED_REFRESH,
        triggerAuditId,
      }),
    });

    // Copy suggestion statuses and review metadata exactly as observed.
    const suggestions = await evergreenOpportunity.getSuggestions();

    if (suggestions.length > 0) {
      try {
        const { errorItems } = await snapshot.addSuggestions(suggestions.map((suggestion) => ({
          type: suggestion.getType(),
          rank: suggestion.getRank(),
          data: suggestion.getData(),
          status: suggestion.getStatus(),
          ...(suggestion.getKpiDeltas() ? { kpiDeltas: suggestion.getKpiDeltas() } : {}),
          ...(suggestion.getSkipReason() ? { skipReason: suggestion.getSkipReason() } : {}),
          ...(suggestion.getSkipDetail() ? { skipDetail: suggestion.getSkipDetail() } : {}),
        })));
        if (errorItems?.length > 0) {
          olog.failure('audit_persistence_snapshot_suggestions_copied', 'Suggestions failed to copy onto snapshot', {
            peer: PEER.POSTGRES, opportunityId: snapshot.getId(), failed: errorItems.length,
          });
        }
      } catch (err) {
        // addSuggestions threw entirely — the snapshot record already exists but has no
        // suggestions. Delete the orphan so the next delivery recreates the snapshot cleanly.
        olog.failure('audit_persistence_snapshot_suggestions_copied', 'addSuggestions threw for snapshot; deleting orphan and rethrowing', {
          peer: PEER.POSTGRES, opportunityId: snapshot.getId(), ...errorField(err),
        });
        try {
          await snapshot.remove();
        } catch (removeErr) {
          olog.failure('audit_persistence_snapshot_cleaned_up', 'Failed to delete orphan snapshot', {
            peer: PEER.POSTGRES, opportunityId: snapshot.getId(), ...errorField(removeErr),
          });
        }
        throw err;
      }
    }

    olog.success('audit_persistence_snapshot_prepared', 'Created superseded-refresh snapshot from evergreen opportunity', {
      peer: PEER.POSTGRES,
      opportunityId: snapshot.getId(),
      evergreenOpportunityId: evergreenOpportunity.getId(),
      triggerAuditId: triggerAuditId || undefined,
      snapshotAction: 'created',
    });
  }

  return { opportunityData, opportunityToUpdate: evergreenOpportunity };
}
