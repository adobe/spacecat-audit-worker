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
  MAX_DELETIONS_PER_RUN,
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
    suggestions = [],
  }) => ({
    getId: () => id,
    getType: () => type,
    getTags: () => tags,
    getData: () => ({ snapshot }),
    getCreatedAt: () => createdAt,
    getSuggestions: sandbox.stub().resolves(suggestions),
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
    it('emits audit=unknown when the auditType is not in the slug map (defensive fallback)', async () => {
      const removeByIds = sandbox.stub().resolves();
      const expiredOutdatedSuggestion = buildSuggestion({ id: 'old', updatedAt: daysAgo(31) });

      await deleteExpiredOutdatedSuggestions({
        dataAccess: { Suggestion: { removeByIds } },
        opportunity: buildOpportunity({ suggestions: [expiredOutdatedSuggestion] }),
        siteId,
        auditType: 'not-a-real-audit',
        log,
      });

      expect(log.info).to.have.been.calledWith(sinon.match(/audit=unknown/));
    });

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
      expect(log.info).to.have.been.calledWith(
        sinon.match(/event=audit_housekeeping_suggestions_removal_summary/)
          .and(sinon.match(/outcome=success/))
          .and(sinon.match(/scanned=0/))
          .and(sinon.match(/eligible=0/))
          .and(sinon.match(/deleted=0/))
          .and(sinon.match(/failed=0/)),
      );
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
      expect(log.error).to.have.been.calledWith(
        sinon.match(/event=audit_housekeeping_suggestions_found/)
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/opportunityId=evergreen-1/))
          .and(sinon.match(/siteId=site-1/))
          .and(sinon.match(/audit=cited/))
          .and(sinon.match(/errorMessage="read fail"/)),
      );
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
      expect(log.error).to.have.been.calledWith(
        sinon.match(/event=audit_housekeeping_suggestions_removed/)
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(/opportunityId=evergreen-1/))
          .and(sinon.match(/siteId=site-1/))
          .and(sinon.match(/errorMessage="DELETE failed"/)),
      );
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
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to delete expired OUTDATED suggestion batch/)
          .and(sinon.match(/batchSize=5/))
          .and(sinon.match(/errorMessage="batch DELETE failed"/)),
      );
      expect(log.info).to.not.have.been.calledWith(
        sinon.match(new RegExp(`suggestionIds=.*\\b${failedSuggestionId}\\b`)),
      );
      // A partial failure must surface at outcome=failure on the summary, not success — an
      // alerting query keyed on outcome=failure must not miss a partial-batch failure.
      expect(log.error).to.have.been.calledWith(
        sinon.match(/event=audit_housekeeping_suggestions_removal_summary/)
          .and(sinon.match(/outcome=failure/))
          .and(sinon.match(`failed=${suggestionCount - OUTDATED_SUGGESTION_DELETE_BATCH_SIZE}`)),
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
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Deleted expired OUTDATED suggestions/)
          .and(sinon.match(/event=audit_housekeeping_suggestions_removed/))
          .and(sinon.match(/outcome=success/))
          .and(sinon.match(/opportunityId=evergreen-1/))
          .and(sinon.match(/siteId=site-1/))
          .and(sinon.match(/suggestionIds=old/)),
      );
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Expired OUTDATED suggestion deletion summary/)
          .and(sinon.match(/event=audit_housekeeping_suggestions_removal_summary/))
          .and(sinon.match(/outcome=success/))
          .and(sinon.match(/opportunityId=evergreen-1/))
          .and(sinon.match(/siteId=site-1/))
          .and(sinon.match(/scanned=1/))
          .and(sinon.match(/eligible=1/))
          .and(sinon.match(/deleted=1/))
          .and(sinon.match(/failed=0/)),
      );
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
        sinon.match(/event=audit_housekeeping_opportunities_found/)
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

    it('retains (does not expire) a snapshot with a missing getCreatedAt() value', async () => {
      // `new Date(undefined) < cutoff` is false, so a malformed/missing createdAt is retained
      // forever rather than expired. The datastore always populates createdAt in practice, so
      // this pins the known (accepted) behavior rather than asserting it is desirable.
      const missingCreatedAt = buildSnapshotOpportunity({ id: 'missing-created-at', createdAt: undefined });
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([missingCreatedAt]),
        },
      };

      const expiredSnapshots = await findExpiredSnapshots({
        dataAccess, siteId, auditType, log,
      });

      expect(expiredSnapshots).to.deep.equal([]);
    });
  });

  describe('deleteExpiredSnapshots', () => {
    // Pin the clock so daysAgo()-derived fixtures can't flake by straddling a real-clock
    // day boundary (e.g. a snapshot built as "45 days ago" resolving to 44 or 46 depending
    // on exactly when the test runs).
    beforeEach(() => {
      sandbox.useFakeTimers(new Date('2026-01-15T12:00:00.000Z'));
    });

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
        sinon.match(/event=audit_housekeeping_opportunities_removed/)
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
