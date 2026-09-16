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
import esmock from 'esmock';

use(sinonChai);

// Focused wiring test for the evergreen -> snapshot topic-vector copy hooked into
// prepareSupersededRunSnapshot. Broader snapshot behavior lives in offsite-snapshot.test.js;
// here we only assert the copy fires (with the right ids) exactly on new-snapshot creation.
describe('offsite-snapshot topic vector copy wiring', () => {
  const sandbox = sinon.createSandbox();
  let copyStub;
  let prepareSupersededRunSnapshot;
  let SNAPSHOT_TAG;
  let log;

  const makeEvergreen = (suggestions = []) => ({
    getId: () => 'evergreen-1',
    getSiteId: () => 'site-1',
    getAuditId: () => 'source-audit-1',
    getType: () => 'cited-analysis',
    getOrigin: () => 'AUTOMATION',
    getTitle: () => 'Cited analysis opportunity',
    getDescription: () => 'description',
    getRunbook: () => '',
    getGuidance: () => undefined,
    getTags: () => ['existing-tag'],
    getData: () => ({ sentiment: { score: 0.8 } }),
    getScopeType: () => undefined,
    getScopeId: () => undefined,
    getSuggestions: sandbox.stub().resolves(suggestions),
  });

  beforeEach(async () => {
    copyStub = sandbox.stub().resolves();
    log = {
      info: sandbox.spy(), error: sandbox.spy(), warn: sandbox.spy(), debug: sandbox.spy(),
    };
    ({ prepareSupersededRunSnapshot, SNAPSHOT_TAG } = await esmock('../../src/common/offsite-snapshot.js', {
      '../../src/common/offsite-lookup-index.js': { copyOffsiteOpportunityTopicVectors: copyStub },
    }));
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('copies the evergreen topic vectors to the new snapshot id when a snapshot is created', async () => {
    const dataAccess = {
      Opportunity: {
        allBySiteIdAndStatus: sandbox.stub().resolves([]),
        create: sandbox.stub().resolves({
          getId: () => 'snapshot-1',
          addSuggestions: sandbox.stub().resolves({ errorItems: [] }),
        }),
      },
    };

    await prepareSupersededRunSnapshot({
      dataAccess,
      siteId: 'site-1',
      auditType: 'cited-analysis',
      triggerAuditId: 'audit-1',
      opportunityData: { status: 'NEW' },
      evergreenOpportunity: makeEvergreen(),
      log,
    });

    expect(copyStub).to.have.been.calledOnce;
    expect(copyStub.firstCall.args[0]).to.include({
      dataAccess,
      siteId: 'site-1',
      fromEntityId: 'evergreen-1',
      toEntityId: 'snapshot-1',
    });
    expect(copyStub.firstCall.args[0].olog).to.be.an('object');
  });

  it('does not copy when there is no evergreen to preserve', async () => {
    await prepareSupersededRunSnapshot({
      dataAccess: { Opportunity: { create: sandbox.stub() } },
      siteId: 'site-1',
      auditType: 'cited-analysis',
      triggerAuditId: 'audit-1',
      opportunityData: { status: 'NEW' },
      evergreenOpportunity: null,
      log,
    });

    expect(copyStub).to.not.have.been.called;
  });

  it('does not copy when an existing snapshot is reused', async () => {
    const existingSnapshot = {
      getId: () => 'existing-snap',
      getType: () => 'cited-analysis',
      getTags: () => [SNAPSHOT_TAG],
      getData: () => ({ snapshot: { triggerAuditId: 'audit-1' } }),
    };
    const dataAccess = {
      Opportunity: {
        allBySiteIdAndStatus: sandbox.stub().resolves([existingSnapshot]),
        create: sandbox.stub(),
      },
    };

    await prepareSupersededRunSnapshot({
      dataAccess,
      siteId: 'site-1',
      auditType: 'cited-analysis',
      triggerAuditId: 'audit-1',
      opportunityData: { status: 'NEW' },
      evergreenOpportunity: makeEvergreen(),
      log,
    });

    expect(dataAccess.Opportunity.create).to.not.have.been.called;
    expect(copyStub).to.not.have.been.called;
  });
});
