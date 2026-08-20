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
  MAX_DELETIONS_PER_RUN,
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
    suggestions = [],
  }) => ({
    getId: () => id,
    getType: () => type,
    getTags: () => tags,
    getData: () => ({ snapshot }),
    getCreatedAt: () => createdAt,
    getSuggestions: sandbox.stub().resolves(suggestions),
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
      expect(log.error).to.have.been.calledWith(
        sinon.match(/event=retention_lookup/)
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/audit=cited/))
          .and(sinon.match(/errorMessage="DB down"/)),
      );
    });

    it('emits audit=unknown when the auditType is not in the slug map (defensive fallback)', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')) },
      };

      await findExpiredSnapshots({
        dataAccess, siteId, auditType: 'not-a-real-audit', log,
      });

      expect(log.error).to.have.been.calledWith(sinon.match(/audit=unknown/));
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
    it('bulk-removes suggestions then snapshots, and returns the deleted count', async () => {
      const firstSuggestion = { getId: () => 'sugg-1' };
      const secondSuggestion = { getId: () => 'sugg-2' };
      const firstExpiredSnapshot = buildSnapshotOpportunity({
        id: 'first-expired', createdAt: daysAgo(45), suggestions: [firstSuggestion],
      });
      const secondExpiredSnapshot = buildSnapshotOpportunity({
        id: 'second-expired', createdAt: daysAgo(60), suggestions: [secondSuggestion],
      });
      const removeByIdsSuggestion = sandbox.stub().resolves();
      const removeByIdsOpportunity = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([
            firstExpiredSnapshot, secondExpiredSnapshot,
          ]),
          removeByIds: removeByIdsOpportunity,
        },
        Suggestion: { removeByIds: removeByIdsSuggestion },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(2);
      // Oldest-first ordering from findExpiredSnapshots is preserved into the bulk call.
      expect(removeByIdsSuggestion).to.have.been.calledOnceWith(['sugg-2', 'sugg-1']);
      expect(removeByIdsOpportunity).to.have.been.calledOnceWith(['second-expired', 'first-expired']);
      expect(log.info).to.have.been.calledWith(
        sinon.match(/event=retention_delete/)
          .and(sinon.match(/outcome=success/))
          .and(sinon.match(/eligible=2/))
          .and(sinon.match(/deleted=2/)),
      );
    });

    it('skips the suggestion bulk-remove when no expired snapshot has suggestions', async () => {
      const snapshot = buildSnapshotOpportunity({ id: 'no-suggestions', createdAt: daysAgo(45) });
      const removeByIdsSuggestion = sandbox.stub().resolves();
      const removeByIdsOpportunity = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]),
          removeByIds: removeByIdsOpportunity,
        },
        Suggestion: { removeByIds: removeByIdsSuggestion },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(1);
      expect(removeByIdsSuggestion).to.not.have.been.called;
      expect(removeByIdsOpportunity).to.have.been.calledOnceWith(['no-suggestions']);
    });

    it('returns 0, calls no removeByIds, and does not log when nothing is expired', async () => {
      const youngSnapshot = buildSnapshotOpportunity({ id: 'young', createdAt: daysAgo(5) });
      const removeByIdsSuggestion = sandbox.stub().resolves();
      const removeByIdsOpportunity = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([youngSnapshot]),
          removeByIds: removeByIdsOpportunity,
        },
        Suggestion: { removeByIds: removeByIdsSuggestion },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(0);
      expect(removeByIdsSuggestion).to.not.have.been.called;
      expect(removeByIdsOpportunity).to.not.have.been.called;
      expect(log.info).to.not.have.been.called;
    });

    it('returns 0 without calling removeByIds when the lookup fails', async () => {
      const removeByIdsOpportunity = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')),
          removeByIds: removeByIdsOpportunity,
        },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(0);
      expect(removeByIdsOpportunity).to.not.have.been.called;
    });

    it('emits audit=unknown when the auditType is not in the slug map (defensive fallback)', async () => {
      const snapshot = buildSnapshotOpportunity({
        id: 'snap-1', type: 'not-a-real-audit', createdAt: daysAgo(45),
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]),
          removeByIds: sandbox.stub().resolves(),
        },
        Suggestion: { removeByIds: sandbox.stub().resolves() },
      };

      await deleteExpiredSnapshots({
        dataAccess, siteId, auditType: 'not-a-real-audit', log,
      });

      expect(log.info).to.have.been.calledWith(sinon.match(/audit=unknown/));
    });

    it('propagates errors from Suggestion.removeByIds (retention must not silently succeed)', async () => {
      const snapshot = buildSnapshotOpportunity({
        id: 'snap-1', createdAt: daysAgo(45), suggestions: [{ getId: () => 'sugg-1' }],
      });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]),
          removeByIds: sandbox.stub().resolves(),
        },
        Suggestion: { removeByIds: sandbox.stub().rejects(new Error('FK violation')) },
      };

      await expect(deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      })).to.be.rejectedWith('FK violation');
    });

    it('propagates errors from Opportunity.removeByIds (retention must not silently succeed)', async () => {
      const snapshot = buildSnapshotOpportunity({ id: 'snap-1', createdAt: daysAgo(45) });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([snapshot]),
          removeByIds: sandbox.stub().rejects(new Error('DB down')),
        },
        Suggestion: { removeByIds: sandbox.stub().resolves() },
      };

      await expect(deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      })).to.be.rejectedWith('DB down');
    });

    it('caps deletions per run at MAX_DELETIONS_PER_RUN, deleting the oldest first', async () => {
      const totalExpired = MAX_DELETIONS_PER_RUN + 5;
      // Oldest (largest daysAgo) first, matching findExpiredSnapshots' sort.
      const expiredSnapshots = Array.from({ length: totalExpired }, (_, index) => (
        buildSnapshotOpportunity({
          id: `snap-${totalExpired - index}`,
          createdAt: daysAgo(45 + (totalExpired - index)),
        })
      ));
      const removeByIdsOpportunity = sandbox.stub().resolves();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves(expiredSnapshots),
          removeByIds: removeByIdsOpportunity,
        },
        Suggestion: { removeByIds: sandbox.stub().resolves() },
      };

      const deletedSnapshotCount = await deleteExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(deletedSnapshotCount).to.equal(MAX_DELETIONS_PER_RUN);
      const deletedIds = removeByIdsOpportunity.firstCall.args[0];
      expect(deletedIds).to.have.lengthOf(MAX_DELETIONS_PER_RUN);
      // The oldest snapshot (snap-<totalExpired>, daysAgo(45 + totalExpired)) must be included.
      expect(deletedIds).to.include(`snap-${totalExpired}`);
      // The newest of the expired set (snap-1) is left for a later run.
      expect(deletedIds).to.not.include('snap-1');
      expect(log.info).to.have.been.calledWith(
        sinon.match(`eligible=${totalExpired}`).and(sinon.match(`deleted=${MAX_DELETIONS_PER_RUN}`)),
      );
    });
  });
});
