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
import { Suggestion as SuggestionModel } from '@adobe/spacecat-shared-data-access';
import { SNAPSHOT_TAG } from '../../src/common/offsite-snapshot.js';
import {
  SNAPSHOT_RETENTION_DAYS,
  findExpiredSnapshots,
  deleteExpiredSnapshots,
  OUTDATED_SUGGESTION_RETENTION_DAYS,
  OUTDATED_SUGGESTION_DELETE_BATCH_SIZE,
  isOutdatedSuggestionExpired,
  deleteExpiredOutdatedSuggestions,
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

  const { STATUSES } = SuggestionModel;

  const buildSuggestion = ({
    id,
    status = STATUSES.OUTDATED,
    updatedAt,
  }) => ({
    getId: () => id,
    getStatus: () => status,
    getUpdatedAt: () => updatedAt,
  });

  describe('SNAPSHOT_RETENTION_DAYS', () => {
    it('is 30 days', () => {
      expect(SNAPSHOT_RETENTION_DAYS).to.equal(30);
    });
  });

  describe('OUTDATED_SUGGESTION_RETENTION_DAYS', () => {
    it('is 30 days, tunable independently of the snapshot window', () => {
      expect(OUTDATED_SUGGESTION_RETENTION_DAYS).to.equal(30);
    });
  });

  describe('isOutdatedSuggestionExpired', () => {
    const retentionCutoff = subDays(new Date(), OUTDATED_SUGGESTION_RETENTION_DAYS);

    it('is true for an OUTDATED suggestion older than the window', () => {
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'expired', updatedAt: daysAgo(31) }),
        retentionCutoff,
      )).to.be.true;
    });

    it('is true one millisecond before the cutoff instant (strict "<" is satisfied)', () => {
      const justOlder = new Date(retentionCutoff.getTime() - 1).toISOString();
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'just-expired', updatedAt: justOlder }),
        retentionCutoff,
      )).to.be.true;
    });

    it('is false exactly at the cutoff instant (predicate is strict "<", not "<=")', () => {
      const atCutoff = new Date(retentionCutoff.getTime()).toISOString();
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'at-cutoff', updatedAt: atCutoff }),
        retentionCutoff,
      )).to.be.false;
    });

    it('is false for an OUTDATED suggestion younger than the window', () => {
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'recent', updatedAt: daysAgo(1) }),
        retentionCutoff,
      )).to.be.false;
    });

    it('retains (never deletes) an OUTDATED row with a null updated_at', () => {
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'null-timestamp', updatedAt: null }),
        retentionCutoff,
      )).to.be.false;
    });

    it('retains (never deletes) an OUTDATED row with an undefined updated_at', () => {
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'missing-timestamp', updatedAt: undefined }),
        retentionCutoff,
      )).to.be.false;
    });

    it('retains (never deletes) an OUTDATED row with an unparseable updated_at', () => {
      expect(isOutdatedSuggestionExpired(
        buildSuggestion({ id: 'invalid-timestamp', updatedAt: 'not-a-date' }),
        retentionCutoff,
      )).to.be.false;
    });

    it('is false for any non-OUTDATED status even when old', () => {
      [
        STATUSES.NEW, STATUSES.PENDING_VALIDATION, STATUSES.IN_PROGRESS,
        STATUSES.APPROVED, STATUSES.FIXED, STATUSES.SKIPPED, STATUSES.REJECTED,
        STATUSES.ERROR,
      ].forEach((status) => {
        expect(isOutdatedSuggestionExpired(
          buildSuggestion({ id: `protected-${status}`, status, updatedAt: daysAgo(99) }),
          retentionCutoff,
        ), status).to.be.false;
      });
    });
  });

  const buildOpportunity = ({ id = 'evergreen-1', suggestions = [], getSuggestions } = {}) => ({
    getId: () => id,
    getSuggestions: getSuggestions || sandbox.stub().resolves(suggestions),
  });

  describe('deleteExpiredOutdatedSuggestions', () => {
    it('deletes only the OUTDATED suggestions older than the window, in one bulk call', async () => {
      const expiredOutdatedSuggestion = buildSuggestion({
        id: 'old', updatedAt: daysAgo(31),
      });
      const recentOutdatedSuggestion = buildSuggestion({
        id: 'fresh', updatedAt: daysAgo(2),
      });
      const activeSuggestion = buildSuggestion({
        id: 'active', status: STATUSES.NEW, updatedAt: daysAgo(99),
      });
      const removeByIds = sandbox.stub().resolves();
      const dataAccess = { Suggestion: { removeByIds } };

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess,
        opportunity: buildOpportunity({
          suggestions: [
            expiredOutdatedSuggestion,
            recentOutdatedSuggestion,
            activeSuggestion,
          ],
        }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds).to.have.been.calledOnceWithExactly(['old']);
      expect(retentionSummary).to.deep.equal({
        scanned: 3, eligible: 1, deleted: 1, failed: 0,
      });
    });

    it('deletes ALL eligible rows (not just the first) in one bulk call, mixed with ineligible', async () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      sandbox.useFakeTimers(now);
      const retentionCutoff = subDays(now, OUTDATED_SUGGESTION_RETENTION_DAYS);
      const firstExpiredSuggestion = buildSuggestion({
        id: 'expired-1', updatedAt: daysAgo(31),
      });
      const secondExpiredSuggestion = buildSuggestion({
        id: 'expired-2', updatedAt: daysAgo(45),
      });
      const boundaryExpiredSuggestion = buildSuggestion({
        id: 'expired-boundary',
        updatedAt: new Date(retentionCutoff.getTime() - 1).toISOString(),
      });
      const recentOutdatedSuggestion = buildSuggestion({
        id: 'young', updatedAt: daysAgo(2),
      });
      const cutoffSuggestion = buildSuggestion({
        id: 'at-cutoff', updatedAt: retentionCutoff.toISOString(),
      });
      const activeSuggestion = buildSuggestion({
        id: 'new', status: STATUSES.NEW, updatedAt: daysAgo(99),
      });
      const fixedSuggestion = buildSuggestion({
        id: 'fixed', status: STATUSES.FIXED, updatedAt: daysAgo(99),
      });
      const approvedSuggestion = buildSuggestion({
        id: 'approved', status: STATUSES.APPROVED, updatedAt: daysAgo(99),
      });

      const removeByIds = sandbox.stub().resolves();
      const opportunitySuggestions = [
        recentOutdatedSuggestion,
        firstExpiredSuggestion,
        activeSuggestion,
        secondExpiredSuggestion,
        fixedSuggestion,
        cutoffSuggestion,
        boundaryExpiredSuggestion,
        approvedSuggestion,
      ];

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: opportunitySuggestions }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds).to.have.been.calledOnce;
      const suggestionIds = removeByIds.firstCall.args[0];
      expect([...suggestionIds].sort())
        .to.deep.equal(['expired-1', 'expired-2', 'expired-boundary']);
      expect(retentionSummary).to.deep.equal({
        scanned: 8, eligible: 3, deleted: 3, failed: 0,
      });
    });

    it('retains a suggestion newly marked OUTDATED during this refresh', async () => {
      // Sync refreshes updatedAt when changing status to OUTDATED, making the row recent.
      const now = new Date('2026-02-01T00:00:00.000Z');
      sandbox.useFakeTimers(now);

      let freshUpdatedAt = subDays(now, 120).toISOString();
      const freshlyOutdatedSuggestion = {
        getId: () => 'freshly-outdated',
        getStatus: () => STATUSES.OUTDATED,
        getUpdatedAt: () => freshUpdatedAt,
      };
      const expiredOutdatedSuggestion = buildSuggestion({
        id: 'stale-outdated',
        updatedAt: subDays(now, 90).toISOString(),
      });

      freshUpdatedAt = now.toISOString();

      const removeByIds = sandbox.stub().resolves();
      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({
          suggestions: [freshlyOutdatedSuggestion, expiredOutdatedSuggestion],
        }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds).to.have.been.calledOnceWithExactly(['stale-outdated']);
      expect(retentionSummary).to.deep.equal({
        scanned: 2, eligible: 1, deleted: 1, failed: 0,
      });
    });

    it('protects every non-OUTDATED status and keeps younger OUTDATED rows', async () => {
      const recentOutdatedSuggestion = buildSuggestion({ id: 'kept', updatedAt: daysAgo(5) });
      const fixedSuggestion = buildSuggestion({
        id: 'fixed', status: STATUSES.FIXED, updatedAt: daysAgo(99),
      });
      const skippedSuggestion = buildSuggestion({
        id: 'skipped', status: STATUSES.SKIPPED, updatedAt: daysAgo(99),
      });
      const removeByIds = sandbox.stub().resolves();

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({
          suggestions: [recentOutdatedSuggestion, fixedSuggestion, skippedSuggestion],
        }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds).to.not.have.been.called;
      expect(retentionSummary).to.deep.equal({
        scanned: 3, eligible: 0, deleted: 0, failed: 0,
      });
    });

    it('is a no-op (never calls removeByIds) when nothing is eligible', async () => {
      const removeByIds = sandbox.stub().rejects(new Error('should not be called with []'));
      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: [] }),
        siteId,
        auditType,
        log,
      });
      expect(removeByIds).to.not.have.been.called;
      expect(retentionSummary.deleted).to.equal(0);
      expect(retentionSummary.scanned).to.equal(0);
      expect(log.info).to.have.been.calledWith(sinon.match(
        /Expired OUTDATED suggestion deletion summary .*scanned=0 eligible=0 deleted=0 failed=0/,
      ));
    });

    it('treats a falsy getSuggestions result as an empty set', async () => {
      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds: sandbox.stub() } },
        opportunity: buildOpportunity({ getSuggestions: sandbox.stub().resolves(null) }),
        siteId,
        auditType,
        log,
      });
      expect(retentionSummary.scanned).to.equal(0);
    });

    it('logs identifiers and returns a zeroed summary when reading suggestions fails', async () => {
      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds: sandbox.stub() } },
        opportunity: buildOpportunity({
          getSuggestions: sandbox.stub().rejects(new Error('read fail')),
        }),
        siteId,
        auditType,
        log,
      });
      expect(retentionSummary).to.deep.equal({
        scanned: 0, eligible: 0, deleted: 0, failed: 0,
      });
      expect(log.error).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Failed to read suggestions for expired OUTDATED suggestion deletion opportunityId=evergreen-1 siteId=site-1 auditType=cited-analysis error=read fail/,
      ));
    });

    it('records a failed batch without logging its suggestions as deleted', async () => {
      const expiredOutdatedSuggestion = buildSuggestion({
        id: 'old', updatedAt: daysAgo(31),
      });
      const removeByIds = sandbox.stub().rejects(new Error('DELETE failed'));

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: [expiredOutdatedSuggestion] }),
        siteId,
        auditType,
        log,
      });

      expect(retentionSummary).to.deep.equal({
        scanned: 1, eligible: 1, deleted: 0, failed: 1,
      });
      expect(log.error).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Failed to delete 1 expired OUTDATED suggestion\(s\) opportunityId=evergreen-1 siteId=site-1 auditType=cited-analysis error=DELETE failed/,
      ));
      expect(log.info).to.not.have.been.calledWith(
        sinon.match(/Deleted expired OUTDATED suggestion/),
      );
    });

    it('never passes a missing/invalid updated_at row to removeByIds (retained end-to-end)', async () => {
      const missingTimestampSuggestion = buildSuggestion({
        id: 'null-dated', updatedAt: null,
      });
      const invalidTimestampSuggestion = buildSuggestion({
        id: 'invalid-dated', updatedAt: 'garbage',
      });
      const expiredOutdatedSuggestion = buildSuggestion({
        id: 'genuinely-old', updatedAt: daysAgo(60),
      });
      const removeByIds = sandbox.stub().resolves();

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({
          suggestions: [
            missingTimestampSuggestion,
            invalidTimestampSuggestion,
            expiredOutdatedSuggestion,
          ],
        }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds).to.have.been.calledOnceWithExactly(['genuinely-old']);
      expect(retentionSummary).to.deep.equal({
        scanned: 3, eligible: 1, deleted: 1, failed: 0,
      });
    });

    it('chunks a large eligible set into <= batch-size removeByIds calls covering every id once', async () => {
      const suggestionCount = OUTDATED_SUGGESTION_DELETE_BATCH_SIZE * 2 + 7;
      const opportunitySuggestions = Array.from(
        { length: suggestionCount },
        (_, index) => buildSuggestion({
          id: `old-${index}`,
          updatedAt: daysAgo(40),
        }),
      );
      const removeByIds = sandbox.stub().resolves();

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: opportunitySuggestions }),
        siteId,
        auditType,
        log,
      });

      const expectedBatchCount = Math.ceil(
        suggestionCount / OUTDATED_SUGGESTION_DELETE_BATCH_SIZE,
      );
      expect(removeByIds.callCount).to.equal(expectedBatchCount);
      removeByIds.getCalls().forEach((call) => {
        expect(call.args[0].length).to.be.at.most(OUTDATED_SUGGESTION_DELETE_BATCH_SIZE);
      });
      const deletedSuggestionIds = removeByIds.getCalls()
        .flatMap((call) => call.args[0]);
      expect(deletedSuggestionIds).to.have.lengthOf(suggestionCount);
      expect(new Set(deletedSuggestionIds).size).to.equal(suggestionCount);
      const expectedSuggestionIds = opportunitySuggestions
        .map((suggestion) => suggestion.getId())
        .sort();
      expect([...new Set(deletedSuggestionIds)].sort()).to.deep.equal(expectedSuggestionIds);
      expect(retentionSummary).to.deep.equal({
        scanned: suggestionCount,
        eligible: suggestionCount,
        deleted: suggestionCount,
        failed: 0,
      });
    });

    it('isolates a failed batch and omits successful logs for its suggestions', async () => {
      const suggestionCount = OUTDATED_SUGGESTION_DELETE_BATCH_SIZE + 5;
      const opportunitySuggestions = Array.from(
        { length: suggestionCount },
        (_, index) => buildSuggestion({
          id: `old-${index}`,
          updatedAt: daysAgo(40),
        }),
      );
      const failedSuggestionId = `old-${suggestionCount - 1}`;
      const removeByIds = sandbox.stub().callsFake(async (suggestionIds) => {
        if (suggestionIds.includes(failedSuggestionId)) {
          throw new Error('batch DELETE failed');
        }
      });

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: opportunitySuggestions }),
        siteId,
        auditType,
        log,
      });

      expect(removeByIds.callCount).to.equal(2);
      expect(retentionSummary).to.deep.equal({
        scanned: suggestionCount,
        eligible: suggestionCount,
        deleted: OUTDATED_SUGGESTION_DELETE_BATCH_SIZE,
        failed: suggestionCount - OUTDATED_SUGGESTION_DELETE_BATCH_SIZE,
      });
      expect(log.error).to.have.been.calledWith(sinon.match(
        /Failed to delete 5 expired OUTDATED suggestion\(s\).*error=batch DELETE failed/,
      ));
      expect(log.info).to.not.have.been.calledWith(
        sinon.match(
          new RegExp(`Deleted expired OUTDATED suggestion suggestionId=${failedSuggestionId}\\b`),
        ),
      );
    });

    it('logs each deletion only after its batch succeeds and emits a summary', async () => {
      const expiredOutdatedSuggestion = buildSuggestion({
        id: 'old',
        updatedAt: daysAgo(40),
      });
      const removeByIds = sandbox.stub().resolves();

      const retentionSummary = await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: [expiredOutdatedSuggestion] }),
        siteId,
        auditType,
        log,
      });

      expect(retentionSummary).to.deep.equal({
        scanned: 1, eligible: 1, deleted: 1, failed: 0,
      });
      expect(removeByIds).to.have.been.calledBefore(log.info);
      expect(log.info).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Deleted expired OUTDATED suggestion suggestionId=old opportunityId=evergreen-1 siteId=site-1 auditType=cited-analysis suggestionAgeDays=40/,
      ));
      expect(log.info).to.have.been.calledWith(sinon.match(
        /\[Offsite\]\[Retention\] Expired OUTDATED suggestion deletion summary opportunityId=evergreen-1 siteId=site-1 auditType=cited-analysis scanned=1 eligible=1 deleted=1 failed=0/,
      ));
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
