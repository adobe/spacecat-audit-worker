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
import {
  SNAPSHOT_TAG,
  SNAPSHOT_KINDS,
  buildSnapshotData,
  findSnapshotByTriggerAuditId,
  prepareSuppressedRunSnapshot,
  prepareSupersededRunSnapshot,
} from '../../src/common/offsite-snapshot.js';

use(sinonChai);
use(chaiAsPromised);

describe('offsite-snapshot', () => {
  let sandbox;
  let log;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    log = {
      info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: sandbox.spy(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  const makeSnapshotOpportunity = ({
    id = 'snapshot-1',
    type = 'cited-analysis',
    tags = [SNAPSHOT_TAG],
    snapshot = { triggerAuditId: 'audit-1' },
  } = {}) => ({
    getId: () => id,
    getType: () => type,
    getTags: () => tags,
    getData: () => ({ snapshot }),
  });

  const makeEvergreenOpportunity = ({
    suggestions = [],
    scopeType,
    scopeId,
    tags = ['existing-tag'],
    data = { sentiment: { score: 0.8 } },
  } = {}) => ({
    getId: () => 'evergreen-1',
    getSiteId: () => 'site-1',
    getAuditId: () => 'source-audit-1',
    getType: () => 'cited-analysis',
    getOrigin: () => 'AUTOMATION',
    getTitle: () => 'Cited analysis opportunity',
    getDescription: () => 'description',
    getRunbook: () => '',
    getGuidance: () => undefined,
    getTags: () => tags,
    getData: () => data,
    getScopeType: () => scopeType,
    getScopeId: () => scopeId,
    getSuggestions: sandbox.stub().resolves(suggestions),
  });

  describe('buildSnapshotData', () => {
    it('adds snapshot metadata to plain nested source data without mutation', () => {
      const sourceData = { sentiment: { score: 0.8 } };

      const result = buildSnapshotData(sourceData, {
        evergreenOpportunityId: 'evergreen-1',
        kind: SNAPSHOT_KINDS.SUPERSEDED_REFRESH,
        triggerAuditId: 'audit-1',
      });

      expect(result).to.deep.equal({
        sentiment: { score: 0.8 },
        snapshot: {
          evergreenOpportunityId: 'evergreen-1',
          kind: SNAPSHOT_KINDS.SUPERSEDED_REFRESH,
          triggerAuditId: 'audit-1',
        },
      });
      expect(sourceData).to.deep.equal({ sentiment: { score: 0.8 } });
    });

    it('omits absent evergreenOpportunityId and triggerAuditId', () => {
      const result = buildSnapshotData(
        { qa: 'suppressed' },
        { kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH },
      );

      expect(result).to.deep.equal({
        qa: 'suppressed',
        snapshot: { kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH },
      });
      expect(result.snapshot).to.not.have.property('evergreenOpportunityId');
      expect(result.snapshot).to.not.have.property('triggerAuditId');
    });
  });

  describe('findSnapshotByTriggerAuditId', () => {
    it('returns null when no IGNORED opportunities exist', async () => {
      const dataAccess = { Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([]) } };

      const result = await findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      });

      expect(result).to.be.null;
    });

    it('logs and rethrows lookup failures', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')) },
      };

      await expect(findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      })).to.be.rejectedWith('DB down');
      expect(log.error).to.have.been.calledWith(
        sinon.match(/Failed to look up existing auditType cited-analysis snapshots/),
      );
    });

    it('returns null when the lookup resolves to a falsy value', async () => {
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves(null) },
      };

      const result = await findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      });

      expect(result).to.be.null;
    });

    it('matches type, managed tag, and triggerAuditId', async () => {
      const wrongType = makeSnapshotOpportunity({ type: 'youtube-analysis' });
      const untagged = makeSnapshotOpportunity({ tags: [] });
      const wrongAudit = makeSnapshotOpportunity({
        snapshot: { triggerAuditId: 'audit-999' },
      });
      const matching = makeSnapshotOpportunity();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([
            wrongType, untagged, wrongAudit, matching,
          ]),
        },
      };

      const result = await findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      });

      expect(result).to.equal(matching);
    });

    it('ignores an opportunity without a tags array', async () => {
      const untagged = makeSnapshotOpportunity({ tags: null });
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([untagged]) },
      };

      const result = await findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      });

      expect(result).to.be.null;
    });

    it('reuses an unlinked snapshot despite a new evergreen link', async () => {
      const unlinked = makeSnapshotOpportunity({
        snapshot: {
          kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH,
          triggerAuditId: 'audit-1',
        },
      });
      const dataAccess = {
        Opportunity: { allBySiteIdAndStatus: sandbox.stub().resolves([unlinked]) },
      };

      const result = await findSnapshotByTriggerAuditId({
        dataAccess, siteId: 'site-1', auditType: 'cited-analysis', triggerAuditId: 'audit-1', log,
      });

      expect(result).to.equal(unlinked);
    });
  });

  describe('prepareSuppressedRunSnapshot', () => {
    it('builds managed mapper input and reuses a snapshot for the trigger audit', async () => {
      const existingSuppressedRunSnapshot = makeSnapshotOpportunity();
      const dataAccess = {
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([existingSuppressedRunSnapshot]),
        },
      };
      const opportunityData = {
        status: 'IGNORED',
        tags: ['custom-tag'],
        data: { qa: 'suppressed' },
      };

      const result = await prepareSuppressedRunSnapshot({
        dataAccess,
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData,
        evergreenOpportunity: { getId: () => 'evergreen-1' },
        log,
      });

      expect(result).to.deep.equal({
        opportunityData: {
          status: 'IGNORED',
          tags: ['custom-tag', SNAPSHOT_TAG],
          data: {
            qa: 'suppressed',
            snapshot: {
              evergreenOpportunityId: 'evergreen-1',
              kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH,
              triggerAuditId: 'audit-1',
            },
          },
        },
        opportunityToUpdate: existingSuppressedRunSnapshot,
      });
      expect(opportunityData).to.deep.equal({
        status: 'IGNORED',
        tags: ['custom-tag'],
        data: { qa: 'suppressed' },
      });
      expect(log.info).to.have.been.calledWith(sinon.match(/Reusing suppressed-refresh snapshot snapshot-1/));
    });

    it('builds a managed snapshot without lookup when triggerAuditId is missing', async () => {
      const allBySiteIdAndStatus = sandbox.stub();

      const result = await prepareSuppressedRunSnapshot({
        dataAccess: { Opportunity: { allBySiteIdAndStatus } },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: undefined,
        opportunityData: { status: 'IGNORED', data: { qa: 'suppressed' } },
        evergreenOpportunity: { getId: () => 'evergreen-1' },
        log,
      });

      expect(result).to.deep.equal({
        opportunityData: {
          status: 'IGNORED',
          tags: [SNAPSHOT_TAG],
          data: {
            qa: 'suppressed',
            snapshot: {
              evergreenOpportunityId: 'evergreen-1',
              kind: SNAPSHOT_KINDS.SUPPRESSED_REFRESH,
            },
          },
        },
        opportunityToUpdate: null,
      });
      expect(allBySiteIdAndStatus).to.not.have.been.called;
      expect(log.warn).to.have.been.calledWith(sinon.match(/idempotency.*traceability/i));
      expect(log.info).to.have.been.calledWith(sinon.match(/Preparing new suppressed-refresh snapshot/));
    });

    it('does not duplicate an existing snapshot tag', async () => {
      const result = await prepareSuppressedRunSnapshot({
        dataAccess: {},
        siteId: 'site-1',
        auditType: 'cited-analysis',
        opportunityData: { status: 'IGNORED', tags: [SNAPSHOT_TAG] },
        evergreenOpportunity: null,
        log,
      });

      expect(result.opportunityData.tags).to.deep.equal([SNAPSHOT_TAG]);
    });
  });

  describe('prepareSupersededRunSnapshot', () => {
    it('creates no snapshot and targets creation when no evergreen exists', async () => {
      const lookup = sandbox.stub();
      const create = sandbox.stub();
      const opportunityData = { status: 'NEW' };

      const result = await prepareSupersededRunSnapshot({
        dataAccess: { Opportunity: { allBySiteIdAndStatus: lookup, create } },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData,
        evergreenOpportunity: null,
        log,
      });

      expect(result).to.deep.equal({ opportunityData, opportunityToUpdate: null });
      expect(lookup).to.not.have.been.called;
      expect(create).to.not.have.been.called;
      expect(log.debug).to.have.been.calledWith(sinon.match(/no superseded-refresh snapshot is needed/i));
    });

    it('reuses an existing superseded snapshot and targets the evergreen refresh', async () => {
      const existingSupersededRunSnapshot = makeSnapshotOpportunity();
      const evergreenOpportunity = { getId: () => 'evergreen-1' };
      const create = sandbox.stub();
      const opportunityData = { status: 'NEW' };

      const result = await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([existingSupersededRunSnapshot]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData,
        evergreenOpportunity,
        log,
      });

      expect(result).to.deep.equal({
        opportunityData,
        opportunityToUpdate: evergreenOpportunity,
      });
      expect(create).to.not.have.been.called;
      expect(log.info).to.have.been.calledWith(sinon.match(/Reusing superseded-refresh snapshot snapshot-1/));
    });

    it('creates an IGNORED managed snapshot preserving fields, scope, and data', async () => {
      const evergreenOpportunity = makeEvergreenOpportunity({
        scopeType: 'brand',
        scopeId: 'brand-1',
      });
      const created = {
        getId: () => 'snapshot-1',
        addSuggestions: sandbox.stub().resolves({ errorItems: [] }),
      };
      const create = sandbox.stub().resolves(created);
      const opportunityData = { status: 'NEW' };

      const result = await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData,
        evergreenOpportunity,
        log,
      });

      expect(result).to.deep.equal({
        opportunityData,
        opportunityToUpdate: evergreenOpportunity,
      });
      expect(create).to.have.been.calledWith({
        siteId: 'site-1',
        auditId: 'source-audit-1',
        type: 'cited-analysis',
        origin: 'AUTOMATION',
        title: 'Cited analysis opportunity',
        description: 'description',
        runbook: '',
        guidance: undefined,
        tags: ['existing-tag', SNAPSHOT_TAG],
        status: 'IGNORED',
        scopeType: 'brand',
        scopeId: 'brand-1',
        data: {
          sentiment: { score: 0.8 },
          snapshot: {
            evergreenOpportunityId: 'evergreen-1',
            kind: SNAPSHOT_KINDS.SUPERSEDED_REFRESH,
            triggerAuditId: 'audit-1',
          },
        },
      });
      expect(log.info).to.have.been.calledWith(
        sinon.match(/Created superseded-refresh snapshot snapshot-1 from evergreen opportunity evergreen-1/),
      );
    });

    it('omits scope fields for an unscoped evergreen and deduplicates the snapshot tag', async () => {
      const evergreenOpportunity = makeEvergreenOpportunity({ tags: [SNAPSHOT_TAG] });
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions: sandbox.stub(),
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: { status: 'NEW' },
        evergreenOpportunity,
        log,
      });

      const [payload] = create.firstCall.args;
      expect(payload.tags).to.deep.equal([SNAPSHOT_TAG]);
      expect(payload).to.not.have.property('scopeType');
      expect(payload).to.not.have.property('scopeId');
    });

    it('adds the snapshot tag when the evergreen has no tags array', async () => {
      const evergreenOpportunity = makeEvergreenOpportunity({ tags: null });
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions: sandbox.stub(),
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity,
        log,
      });

      expect(create.firstCall.args[0].tags).to.deep.equal([SNAPSHOT_TAG]);
    });

    it('copies suggestion fields exactly', async () => {
      const suggestion = {
        getType: () => 'CONTENT_UPDATE',
        getRank: () => 1,
        getData: () => ({ suggestionValue: 'value' }),
        getStatus: () => 'SKIPPED',
        getKpiDeltas: () => ({ trafficLift: 0.1 }),
        getSkipReason: () => 'not-applicable',
        getSkipDetail: () => 'Reviewed and dismissed',
      };
      const evergreenOpportunity = makeEvergreenOpportunity({ suggestions: [suggestion] });
      const addSuggestions = sandbox.stub().resolves({ errorItems: [] });
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions,
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity,
        log,
      });

      expect(addSuggestions).to.have.been.calledWith([{
        type: 'CONTENT_UPDATE',
        rank: 1,
        data: { suggestionValue: 'value' },
        status: 'SKIPPED',
        kpiDeltas: { trafficLift: 0.1 },
        skipReason: 'not-applicable',
        skipDetail: 'Reviewed and dismissed',
      }]);
    });

    it('omits absent optional suggestion fields', async () => {
      const suggestion = {
        getType: () => 'CONTENT_UPDATE',
        getRank: () => 1,
        getData: () => ({ suggestionValue: 'value' }),
        getStatus: () => 'FIXED',
        getKpiDeltas: () => undefined,
        getSkipReason: () => undefined,
        getSkipDetail: () => undefined,
      };
      const evergreenOpportunity = makeEvergreenOpportunity({ suggestions: [suggestion] });
      const addSuggestions = sandbox.stub().resolves({ errorItems: [] });
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions,
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity,
        log,
      });

      expect(addSuggestions).to.have.been.calledWith([{
        type: 'CONTENT_UPDATE',
        rank: 1,
        data: { suggestionValue: 'value' },
        status: 'FIXED',
      }]);
    });

    it('skips suggestion persistence when the evergreen has no suggestions', async () => {
      const evergreenOpportunity = makeEvergreenOpportunity();
      const addSuggestions = sandbox.stub();
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions,
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity,
        log,
      });

      expect(addSuggestions).to.not.have.been.called;
    });

    it('logs partial suggestion copy failures without throwing', async () => {
      const suggestion = {
        getType: () => 'CONTENT_UPDATE',
        getRank: () => 1,
        getData: () => ({}),
        getStatus: () => 'NEW',
        getKpiDeltas: () => undefined,
        getSkipReason: () => undefined,
        getSkipDetail: () => undefined,
      };
      const evergreenOpportunity = makeEvergreenOpportunity({ suggestions: [suggestion] });
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions: sandbox.stub().resolves({ errorItems: [{}] }),
      });

      await prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create,
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity,
        log,
      });

      expect(log.error).to.have.been.calledWith(sinon.match(/1 suggestion\(s\) failed to copy/));
    });

    it('creates a managed snapshot without trigger metadata when auditId is missing', async () => {
      const evergreenOpportunity = makeEvergreenOpportunity();
      const create = sandbox.stub().resolves({
        getId: () => 'snapshot-1',
        addSuggestions: sandbox.stub(),
      });

      const result = await prepareSupersededRunSnapshot({
        dataAccess: { Opportunity: { create } },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: undefined,
        opportunityData: { status: 'NEW' },
        evergreenOpportunity,
        log,
      });

      expect(result.opportunityToUpdate).to.equal(evergreenOpportunity);
      expect(create.firstCall.args[0].data.snapshot).to.deep.equal({
        evergreenOpportunityId: 'evergreen-1',
        kind: SNAPSHOT_KINDS.SUPERSEDED_REFRESH,
      });
      expect(log.warn).to.have.been.calledWith(sinon.match(/idempotency.*traceability/i));
    });

    it('propagates idempotency lookup failures', async () => {
      await expect(prepareSupersededRunSnapshot({
        dataAccess: {
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().rejects(new Error('DB down')),
          },
        },
        siteId: 'site-1',
        auditType: 'cited-analysis',
        triggerAuditId: 'audit-1',
        opportunityData: {},
        evergreenOpportunity: { getId: () => 'evergreen-1' },
        log,
      })).to.be.rejectedWith('DB down');
    });
  });
});
