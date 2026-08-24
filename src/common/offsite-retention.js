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

import { subDays } from 'date-fns';
import { Opportunity as Oppty, Suggestion as Sugg } from '@adobe/spacecat-shared-data-access';
import { isOffsiteSnapshot } from './offsite-snapshot.js';
import {
  createOffsiteLogger, errorField, AUDIT, PEER,
} from '../utils/offsite-logging.js';

// See docs/decisions/004-offsite-snapshot-retention-window.md for the rationale.
export const SNAPSHOT_RETENTION_DAYS = 30;

// Bounds the blast radius of a single invocation — e.g. a dormant site's first refresh after
// months, when many snapshots become eligible at once. findExpiredSnapshots sorts oldest-first,
// so any remainder beyond this cap drains across subsequent refreshes rather than all at once.
export const MAX_DELETIONS_PER_RUN = 50;

// Mirrors the mapping in offsite-snapshot.js — kept local to avoid a cross-module circular import.
const AUDIT_SLUG_BY_TYPE = {
  'cited-analysis': AUDIT.CITED,
  'reddit-analysis': AUDIT.REDDIT,
  'youtube-analysis': AUDIT.YOUTUBE,
};

/**
 * Finds managed offsite snapshots older than the retention cutoff, oldest first.
 */
export async function findExpiredSnapshots({
  dataAccess, siteId, auditType, log,
}) {
  const { Opportunity } = dataAccess;
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });

  let ignoredOpportunities;

  try {
    ignoredOpportunities = await Opportunity
      .allBySiteIdAndStatus(siteId, Oppty.STATUSES.IGNORED);
  } catch (error) {
    olog.failure('audit_housekeeping_opportunities_found', `Failed to find snapshots for auditType ${auditType}`, {
      peer: PEER.POSTGRES, direction: 'inbound', ...errorField(error),
    });
    return [];
  }

  const retentionCutoff = subDays(new Date(), SNAPSHOT_RETENTION_DAYS);

  return (ignoredOpportunities || [])
    .filter((opportunity) => isOffsiteSnapshot(opportunity, auditType)
      && new Date(opportunity.getCreatedAt()) < retentionCutoff)
    .sort((firstOpportunity, secondOpportunity) => (
      new Date(firstOpportunity.getCreatedAt()) - new Date(secondOpportunity.getCreatedAt())
    ));
}

/**
 * Deletes expired snapshots without interrupting the refresh that invoked retention.
 *
 * Deletion is batched (bulk `removeByIds`) rather than per-record, per CLAUDE.md's N+1 rule:
 * a concurrent `Promise.all` over individual `.remove()` calls would fan out to
 * `expired * (1 + suggestionsPerSnapshot)` concurrent requests against the shared connection
 * pool — worst-case exactly when a dormant site resumes refreshing after an accumulated
 * backlog. Suggestions are read sequentially (not concurrently) ahead of the bulk removes to
 * avoid a similar read-side fan-out; batch sizes are bounded by MAX_DELETIONS_PER_RUN.
 *
 * This trades per-record failure isolation for the bulk pattern: a failure here throws and is
 * caught by the caller (retention must not fail an otherwise successful refresh), rather than
 * reporting a partial success/failure count.
 */
export async function deleteExpiredSnapshots({
  dataAccess, siteId, auditType, log,
}) {
  const { Opportunity, Suggestion } = dataAccess;
  const olog = createOffsiteLogger(log, { audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId });

  const allExpiredSnapshots = await findExpiredSnapshots({
    dataAccess, siteId, auditType, log,
  });
  const expiredSnapshots = allExpiredSnapshots.slice(0, MAX_DELETIONS_PER_RUN);

  if (expiredSnapshots.length === 0) {
    return 0;
  }

  const suggestionIds = [];
  for (const snapshot of expiredSnapshots) {
    // Sequential by design — see function doc.
    // eslint-disable-next-line no-await-in-loop
    const suggestions = await snapshot.getSuggestions();
    suggestionIds.push(...suggestions.map((suggestion) => suggestion.getId()));
  }

  if (suggestionIds.length > 0) {
    await Suggestion.removeByIds(suggestionIds);
  }

  const snapshotIds = expiredSnapshots.map((snapshot) => snapshot.getId());
  await Opportunity.removeByIds(snapshotIds);

  olog.success('audit_housekeeping_opportunities_removed', `Deleted ${snapshotIds.length} expired snapshot(s) for auditType ${auditType}`, {
    peer: PEER.POSTGRES, direction: 'outbound', eligible: allExpiredSnapshots.length, deleted: snapshotIds.length,
  });

  return snapshotIds.length;
}

export const OUTDATED_SUGGESTION_RETENTION_DAYS = 30;

// Bounds the PostgREST DELETE-IN request URL.
export const OUTDATED_SUGGESTION_DELETE_BATCH_SIZE = 100;

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/**
 * Returns true only for an OUTDATED suggestion with a valid updatedAt before the cutoff.
 * Invalid timestamps are retained because deletion cannot be proven safe.
 */
export function isOutdatedSuggestionExpired(suggestion, retentionCutoff) {
  if (suggestion.getStatus() !== Sugg.STATUSES.OUTDATED) {
    return false;
  }
  const updatedAt = suggestion.getUpdatedAt();
  if (!updatedAt) {
    return false;
  }
  const updatedAtTime = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedAtTime)) {
    return false;
  }
  return updatedAtTime < retentionCutoff.getTime();
}

/**
 * Deletes expired OUTDATED suggestions in bounded batches without interrupting refresh.
 */
export async function deleteExpiredOutdatedSuggestions({
  dataAccess, opportunity, siteId, auditType, log,
}) {
  const { Suggestion } = dataAccess;
  const emptyRetentionSummary = {
    scanned: 0, eligible: 0, deleted: 0, failed: 0,
  };
  const opportunityId = opportunity.getId();
  const olog = createOffsiteLogger(log, {
    audit: AUDIT_SLUG_BY_TYPE[auditType] ?? 'unknown', siteId, opportunityId,
  });

  let opportunitySuggestions;
  try {
    opportunitySuggestions = await opportunity.getSuggestions() || [];
  } catch (error) {
    olog.failure('audit_housekeeping_suggestions_found', `Failed to read suggestions for expired OUTDATED suggestion deletion, auditType ${auditType}`, {
      peer: PEER.POSTGRES, direction: 'inbound', ...errorField(error),
    });
    return emptyRetentionSummary;
  }

  const retentionCutoff = subDays(new Date(), OUTDATED_SUGGESTION_RETENTION_DAYS);
  const expiredOutdatedSuggestions = opportunitySuggestions
    .filter((suggestion) => isOutdatedSuggestionExpired(suggestion, retentionCutoff));
  const suggestionBatches = chunk(
    expiredOutdatedSuggestions,
    OUTDATED_SUGGESTION_DELETE_BATCH_SIZE,
  );

  const batchResults = await Promise.all(
    suggestionBatches.map(async (suggestionBatch) => {
      const suggestionIds = suggestionBatch.map((suggestion) => suggestion.getId());
      try {
        // Dependent fix-entity rows cascade-delete with their suggestions.
        await Suggestion.removeByIds(suggestionIds);
        olog.success('audit_housekeeping_suggestions_removed', `Deleted ${suggestionIds.length} expired OUTDATED suggestion(s) for auditType ${auditType}`, {
          peer: PEER.POSTGRES, direction: 'outbound', suggestionIds,
        });
        return { deleted: suggestionBatch.length, failed: 0 };
      } catch (error) {
        olog.failure('audit_housekeeping_suggestions_removed', `Failed to delete ${suggestionBatch.length} expired OUTDATED suggestion(s), auditType ${auditType}`, {
          peer: PEER.POSTGRES, direction: 'outbound', ...errorField(error),
        });
        return { deleted: 0, failed: suggestionBatch.length };
      }
    }),
  );
  const deletionTotals = batchResults.reduce(
    (summary, batchResult) => ({
      deleted: summary.deleted + batchResult.deleted,
      failed: summary.failed + batchResult.failed,
    }),
    { deleted: 0, failed: 0 },
  );
  const retentionSummary = {
    scanned: opportunitySuggestions.length,
    eligible: expiredOutdatedSuggestions.length,
    ...deletionTotals,
  };

  const summaryFields = {
    peer: PEER.POSTGRES,
    direction: 'outbound',
    scanned: retentionSummary.scanned,
    eligible: retentionSummary.eligible,
    deleted: retentionSummary.deleted,
    failed: retentionSummary.failed,
  };
  if (retentionSummary.failed > 0) {
    olog.failure('audit_housekeeping_suggestions_removal_summary', `Expired OUTDATED suggestion deletion summary for auditType ${auditType}`, summaryFields);
  } else {
    olog.success('audit_housekeeping_suggestions_removal_summary', `Expired OUTDATED suggestion deletion summary for auditType ${auditType}`, summaryFields);
  }

  return retentionSummary;
}
