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

import { subDays, differenceInDays } from 'date-fns';
import { Opportunity as Oppty, Suggestion as Sugg } from '@adobe/spacecat-shared-data-access';
import { isOffsiteSnapshot } from './offsite-snapshot.js';

export const SNAPSHOT_RETENTION_DAYS = 30;

/**
 * Finds managed offsite snapshots older than the retention cutoff, oldest first.
 */
export async function findExpiredSnapshots({
  dataAccess, siteId, auditType, log,
}) {
  const { Opportunity } = dataAccess;

  let ignoredOpportunities;

  try {
    ignoredOpportunities = await Opportunity
      .allBySiteIdAndStatus(siteId, Oppty.STATUSES.IGNORED);
  } catch (error) {
    log.error(`[Offsite][Retention] Failed to find snapshots siteId=${siteId} auditType=${auditType} error=${error.message}`);
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
 */
export async function deleteExpiredSnapshots({
  dataAccess, siteId, auditType, log,
}) {
  const expiredSnapshots = await findExpiredSnapshots({
    dataAccess, siteId, auditType, log,
  });

  const deletionResults = await Promise.all(expiredSnapshots.map(async (snapshot) => {
    const snapshotAgeDays = differenceInDays(new Date(), new Date(snapshot.getCreatedAt()));
    const triggerAuditId = snapshot.getData()?.snapshot?.triggerAuditId || 'unknown';

    try {
      // Dependent suggestions cascade-delete with the snapshot opportunity.
      await snapshot.remove();

      log.info(`[Offsite][Retention] Deleted snapshot opportunityId=${snapshot.getId()} `
        + `siteId=${siteId} auditType=${auditType} triggerAuditId=${triggerAuditId} `
        + `snapshotAgeDays=${snapshotAgeDays}`);

      return true;
    } catch (error) {
      log.error(`[Offsite][Retention] Failed to delete snapshot opportunityId=${snapshot.getId()} `
        + `siteId=${siteId} auditType=${auditType} triggerAuditId=${triggerAuditId} `
        + `snapshotAgeDays=${snapshotAgeDays} error=${error.message}`);

      return false;
    }
  }));

  const deletedSnapshotCount = deletionResults.filter(Boolean).length;
  const failedSnapshotCount = expiredSnapshots.length - deletedSnapshotCount;

  log.info(`[Offsite][Retention] Snapshot deletion summary siteId=${siteId} `
    + `auditType=${auditType} eligible=${expiredSnapshots.length} `
    + `deleted=${deletedSnapshotCount} failed=${failedSnapshotCount}`);

  return deletedSnapshotCount;
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

  let opportunitySuggestions;
  try {
    opportunitySuggestions = await opportunity.getSuggestions() || [];
  } catch (error) {
    log.error('[Offsite][Retention] Failed to read suggestions for expired OUTDATED '
      + `suggestion deletion opportunityId=${opportunityId} `
      + `siteId=${siteId} auditType=${auditType} error=${error.message}`);
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
        suggestionBatch.forEach((suggestion) => {
          const suggestionAgeDays = differenceInDays(
            new Date(),
            new Date(suggestion.getUpdatedAt()),
          );
          log.info('[Offsite][Retention] Deleted expired OUTDATED suggestion '
            + `suggestionId=${suggestion.getId()} `
            + `opportunityId=${opportunityId} siteId=${siteId} auditType=${auditType} `
            + `suggestionAgeDays=${suggestionAgeDays}`);
        });
        return { deleted: suggestionBatch.length, failed: 0 };
      } catch (error) {
        log.error(`[Offsite][Retention] Failed to delete ${suggestionBatch.length} `
          + `expired OUTDATED suggestion(s) opportunityId=${opportunityId} `
          + `siteId=${siteId} auditType=${auditType} error=${error.message}`);
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

  log.info('[Offsite][Retention] Expired OUTDATED suggestion deletion summary '
    + `opportunityId=${opportunityId} siteId=${siteId} auditType=${auditType} `
    + `scanned=${retentionSummary.scanned} eligible=${retentionSummary.eligible} `
    + `deleted=${retentionSummary.deleted} failed=${retentionSummary.failed}`);

  return retentionSummary;
}
