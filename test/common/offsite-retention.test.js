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

import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import chaiAsPromised from 'chai-as-promised';
import { subDays } from 'date-fns';
import { SNAPSHOT_TAG } from '../../src/common/offsite-snapshot.js';
import {
  SNAPSHOT_RETENTION_DAYS,
  findExpiredSnapshots,
  deleteExpiredSnapshots,
} from '../../src/common/offsite-retention.js';

use(sinonChai);
use(chaiAsPromised);

describe('offsite-retention', () => {
  let sandbox;
  let log;

  const siteId = 'site-1';
  const auditType = 'cited-analysis';

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: sandbox.spy(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  const daysAgo = (days) => subDays(new Date(), days).toISOString();

  const buildSnapshotOpportunity = ({
    id,
    type = auditType,
    tags = [SNAPSHOT_TAG],
    snapshot = { kind: 'superseded-refresh', triggerAuditId: `trigger-${id}` },
    createdAt,
    remove,
  }) => ({
    getId: () => id,
    getType: () => type,
    getTags: () => tags,
    getData: () => ({ snapshot }),
    getCreatedAt: () => createdAt,
    remove: remove || sandbox.stub().resolves(),
  });

  describe('SNAPSHOT_RETENTION_DAYS', () => {
    it('is 30 days', () => {
      expect(SNAPSHOT_RETENTION_DAYS).to.equal(30);
    });
  });

  describe('findExpiredSnapshots', () => {
    it('includes only opportunities that are past the cutoff AND pass isOffsiteSnapshot', async () => {
      const oldTagged = buildSnapshotOpportunity({ id: 'old-tagged', createdAt: daysAgo(45) });
      const youngTagged = buildSnapshotOpportunity({ id: 'young-tagged', createdAt: daysAgo(5) });
      const oldWrongType = buildSnapshotOpportunity({
        id: 'old-wrong-type', type: 'reddit-analysis', createdAt: daysAgo(45),
      });
      const oldUntagged = buildSnapshotOpportunity({
        id: 'old-untagged', tags: [], createdAt: daysAgo(45),
      });
      // null prevents the helper's default metadata from being used.
      const oldNoSnapshotData = buildSnapshotOpportunity({
        id: 'old-no-data', snapshot: null, createdAt: daysAgo(45),
      });

      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([
            oldTagged, youngTagged, oldWrongType, oldUntagged, oldNoSnapshotData,
          ]),
        },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots.map((opportunity) => opportunity.getId())).to.deep.equal([
        'old-tagged',
        'old-no-data',
      ]);
    });

    it('queries IGNORED opportunities for the given siteId', async () => {
      const allBySiteIdAndStatus = sandbox.stub().resolves([]);
      const dataAccess = { Opportunity: { allBySiteIdAndStatus } };

      await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(allBySiteIdAndStatus).to.have.been.calledWith(siteId, 'IGNORED');
    });

    it('returns [] and logs (does not throw) when the lookup rejects', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')) },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots).to.deep.equal([]);
      expect(log.error).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Failed to find snapshots siteId=site-1 auditType=cited-analysis error=DB down/,
      ));
    });

    it('returns [] when the lookup resolves to null/undefined', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves(null) },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots).to.deep.equal([]);
    });

    it('sorts the result oldest-first', async () => {
      const older = buildSnapshotOpportunity({ id: 'older', createdAt: daysAgo(90) });
      const middle = buildSnapshotOpportunity({ id: 'middle', createdAt: daysAgo(60) });
      const newer = buildSnapshotOpportunity({ id: 'newer', createdAt: daysAgo(40) });

      const dataAccess = {
        Opportunity: {
          // Deliberately unsorted input order.
          allBySiteIdAndStatus: sandbox.stub().resolves([middle, newer, older]),
        },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots.map((opportunity) => opportunity.getId()))
        .to.deep.equal(['older', 'middle', 'newer']);
    });

    it('retains a snapshot created exactly 30 days ago', async () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      sandbox.useFakeTimers(now);
      const exactlyAtCutoff = buildSnapshotOpportunity({
        id: 'at-cutoff',
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([exactlyAtCutoff]),
        },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots).to.deep.equal([]);
    });

    it('expires a snapshot created one millisecond beyond 30 days ago', async () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      sandbox.useFakeTimers(now);
      const beyondCutoff = buildSnapshotOpportunity({
        id: 'beyond-cutoff',
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1).toISOString(),
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([beyondCutoff]),
        },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots).to.deep.equal([beyondCutoff]);
    });
  });

  describe('deleteExpiredSnapshots', () => {
    it('deletes every expired snapshot and returns the deleted count', async () => {
      const firstExpiredSnapshot = buildSnapshotOpportunity({
        id: 'first-expired', createdAt: daysAgo(45),
      });
      const secondExpiredSnapshot = buildSnapshotOpportunity({
        id: 'second-expired', createdAt: daysAgo(60),
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([
            firstExpiredSnapshot, secondExpiredSnapshot,
          ]),
        },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(2);
      expect(firstExpiredSnapshot.remove).to.have.been.calledOnce;
      expect(secondExpiredSnapshot.remove).to.have.been.calledOnce;
      expect(log.info).to.have.been.calledWith(sinon.match(
        /Snapshot deletion summary siteId=site-1 auditType=cited-analysis eligible=2 deleted=2 failed=0/,
      ));
    });

    it('continues after one deletion fails and counts only successful deletions', async () => {
      const failingSnapshot = buildSnapshotOpportunity({
        id: 'failing',
        createdAt: daysAgo(45),
        remove: sandbox.stub().rejects(new Error('FK violation')),
      });
      const firstDeletedSnapshot = buildSnapshotOpportunity({
        id: 'deleted-1', createdAt: daysAgo(50),
      });
      const secondDeletedSnapshot = buildSnapshotOpportunity({
        id: 'deleted-2', createdAt: daysAgo(55),
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([
            failingSnapshot, firstDeletedSnapshot, secondDeletedSnapshot,
          ]),
        },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(2);
      expect(failingSnapshot.remove).to.have.been.calledOnce;
      expect(firstDeletedSnapshot.remove).to.have.been.calledOnce;
      expect(secondDeletedSnapshot.remove).to.have.been.calledOnce;
      expect(log.error).to.have.been.calledWith(
        sinon.match(
          /\[Offsite\]\[Retention\] Failed to delete snapshot opportunityId=failing siteId=site-1 auditType=cited-analysis triggerAuditId=trigger-failing snapshotAgeDays=45 error=FK violation/,
        ),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(
          /Snapshot deletion summary siteId=site-1 auditType=cited-analysis eligible=3 deleted=2 failed=1/,
        ),
      );
    });

    it('audit-logs each successful deletion with snapshot identity and age', async () => {
      const snapshot = buildSnapshotOpportunity({
        id: 'snap-1',
        snapshot: { kind: 'superseded-refresh', triggerAuditId: 'audit-xyz' },
        createdAt: daysAgo(45),
      });
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]) },
      };

      await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(log.info).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Deleted snapshot opportunityId=snap-1 siteId=site-1 auditType=cited-analysis triggerAuditId=audit-xyz snapshotAgeDays=45/,
      ));
    });

    it('logs unknown when triggerAuditId metadata is missing', async () => {
      const snapshot = buildSnapshotOpportunity({
        id: 'snap-no-trigger',
        snapshot: null,
        createdAt: daysAgo(45),
      });
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]) },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(1);
      expect(log.info).to.have.been.calledWith(sinon.match(/triggerAuditId=unknown/));
    });

    it('returns 0 and logs a zero-candidate summary when nothing is expired', async () => {
      const youngSnapshot = buildSnapshotOpportunity({ id: 'young', createdAt: daysAgo(5) });
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([youngSnapshot]) },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(0);
      expect(youngSnapshot.remove).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith(sinon.match(
        /Snapshot deletion summary siteId=site-1 auditType=cited-analysis eligible=0 deleted=0 failed=0/,
      ));
    });

    it('returns 0 and logs a summary when finding snapshots fails', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')) },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(0);
      expect(log.info).to.have.been.calledWith(sinon.match(
        /Snapshot deletion summary siteId=site-1 auditType=cited-analysis eligible=0 deleted=0 failed=0/,
      ));
    });
  });
});
