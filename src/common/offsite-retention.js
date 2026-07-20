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
import { Opportunity as Oppty } from '@adobe/spacecat-shared-data-access';
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
