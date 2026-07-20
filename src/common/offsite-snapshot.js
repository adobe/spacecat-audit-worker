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

export const SNAPSHOT_TAG = 'offsite-snapshot';

export const SNAPSHOT_KINDS = {
  // Previous evergreen state preserved before a surfaced refresh replaces it.
  SUPERSEDED_REFRESH: 'superseded-refresh',
  // Suppressed audit run retained as an inert snapshot.
  SUPPRESSED_REFRESH: 'suppressed-refresh',
};

/** Returns true for a managed snapshot of the requested audit type. */
export function isOffsiteSnapshot(opportunity, auditType) {
  return opportunity.getType() === auditType
    && (opportunity.getTags() || []).includes(SNAPSHOT_TAG);
}

/**
 * Finds a snapshot by (siteId, auditType, triggerAuditId).
 * Lookup failures propagate to avoid duplicate creation.
 */
export async function findSnapshotByTriggerAuditId({
  dataAccess, siteId, auditType, triggerAuditId, log,
}) {
  const { Opportunity } = dataAccess;
  let opportunities;

  try {
    opportunities = await Opportunity.allBySiteIdAndStatus(siteId, Oppty.STATUSES.IGNORED);
  } catch (e) {
    log.error(`[Offsite][Snapshot] Failed to look up existing auditType ${auditType} snapshots for siteId ${siteId}: ${e.message}`);
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
    log.warn('[Offsite][Snapshot] Missing auditId; snapshot idempotency and traceability are unavailable');
  }

  const existingSuppressedRunSnapshot = triggerAuditId
    ? await findSnapshotByTriggerAuditId({
      dataAccess, siteId, auditType, triggerAuditId, log,
    })
    : null;

  if (existingSuppressedRunSnapshot) {
    log.info(`[Offsite][Snapshot] Reusing suppressed-refresh snapshot ${existingSuppressedRunSnapshot.getId()} for siteId ${siteId}, auditType ${auditType}, triggerAuditId ${triggerAuditId}`);
  } else {
    log.info(`[Offsite][Snapshot] Preparing new suppressed-refresh snapshot for siteId ${siteId}, auditType ${auditType}, triggerAuditId ${triggerAuditId || 'unknown'}`);
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
  if (!evergreenOpportunity) {
    // First surfaced run: there is no previous evergreen state to preserve.
    log.debug(`[Offsite][Snapshot] No evergreen opportunity exists; no superseded-refresh snapshot is needed for siteId ${siteId}, auditType ${auditType}`);
    return { opportunityData, opportunityToUpdate: null };
  }

  if (!triggerAuditId) {
    log.warn('[Offsite][Snapshot] Missing auditId; snapshot idempotency and traceability are unavailable');
  }

  const existingSupersededRunSnapshot = triggerAuditId
    ? await findSnapshotByTriggerAuditId({
      dataAccess, siteId, auditType, triggerAuditId, log,
    })
    : null;

  if (existingSupersededRunSnapshot) {
    log.info(`[Offsite][Snapshot] Reusing superseded-refresh snapshot ${existingSupersededRunSnapshot.getId()} for siteId ${siteId}, auditType ${auditType}, triggerAuditId ${triggerAuditId}`);
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
        log.error(`[Offsite][Snapshot] ${errorItems.length} suggestion(s) failed to copy onto snapshot ${snapshot.getId()}`);
      }
    }

    log.info(`[Offsite][Snapshot] Created superseded-refresh snapshot ${snapshot.getId()} from evergreen opportunity ${evergreenOpportunity.getId()} for siteId ${siteId}, auditType ${auditType}, triggerAuditId ${triggerAuditId || 'unknown'}`);
  }

  return { opportunityData, opportunityToUpdate: evergreenOpportunity };
}
