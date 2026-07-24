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
import { applyScopeToOpportunity as realApplyScopeToOpportunity } from '../../src/utils/brand-resolver.js';
import { MockContextBuilder } from '../shared.js';

use(sinonChai);

// Exercises the real cited handler, snapshot helpers, mapper, and persistence helper.
describe('offsite-snapshot real-composition integration (cited-analysis)', () => {
  let sandbox;
  let handler;
  let syncSuggestionsStub;
  let resolveBrandResultForSiteStub;
  let checkGoogleConnectionStub;
  let context;

  const siteId = 'test-site-id';
  const auditId = 'trigger-audit-1';
  const baseURL = 'https://example.com';

  // Stateful fake matching model getter/setter behavior.
  function makeMutableOpportunity({
    id, type = 'cited-analysis', tags = [], data = {}, status = 'NEW',
  }) {
    const state = { tags: [...tags], data: { ...data }, status };
    return {
      getId: () => id,
      getType: () => type,
      getTags: () => state.tags,
      getData: () => state.data,
      getStatus: () => state.status,
      getScopeType: () => state.scopeType,
      getScopeId: () => state.scopeId,
      setTags: sandbox.stub().callsFake((t) => { state.tags = t; }),
      setData: sandbox.stub().callsFake((d) => { state.data = d; }),
      setStatus: sandbox.stub().callsFake((s) => { state.status = s; }),
      setScopeType: sandbox.stub().callsFake((t) => { state.scopeType = t; }),
      setScopeId: sandbox.stub().callsFake((i) => { state.scopeId = i; }),
      setAuditId: sandbox.stub(),
      setUpdatedBy: sandbox.stub(),
      save: sandbox.stub().resolves(),
      getSuggestions: sandbox.stub().resolves([]),
      addSuggestions: sandbox.stub().resolves({ errorItems: [] }),
    };
  }

  const buildMessage = ({ status = 'IGNORED' } = {}) => ({
    siteId,
    auditId,
    data: {
      companyName: 'Acme',
      analysis: {
        opportunity: { status, type: 'cited-analysis' },
        suggestions: [{
          id: 'suggestion-1', type: 'CONTENT_UPDATE', rank: 1, data: {},
        }],
      },
    },
  });

  beforeEach(async () => {
    sandbox = sinon.createSandbox();

    syncSuggestionsStub = sandbox.stub().resolves();
    // Brand resolution hits PostgREST in production; stub it so the test never touches the
    // network, but keep the REAL applyScopeToOpportunity so scope-setter composition is
    // still exercised end-to-end.
    resolveBrandResultForSiteStub = sandbox.stub().resolves({ brand: null, resolved: true });
    // GoogleClient.createFrom makes a real external call; stub only this leaf so the real
    // convertToOpportunity (imported transitively, unmocked) never reaches the network.
    checkGoogleConnectionStub = sandbox.stub().resolves(true);

    handler = await esmock('../../src/cited-analysis/guidance-handler.js', {
      '../../src/utils/data-access.js': {
        syncSuggestions: syncSuggestionsStub,
      },
      '../../src/utils/brand-resolver.js': {
        resolveBrandResultForSite: resolveBrandResultForSiteStub,
        applyScopeToOpportunity: realApplyScopeToOpportunity,
      },
      '../../src/common/opportunity-utils.js': {
        checkGoogleConnection: checkGoogleConnectionStub,
      },
    });

    context = new MockContextBuilder()
      .withSandbox(sandbox)
      .withOverrides({
        dataAccess: {
          Site: {
            findById: sandbox.stub().resolves({
              getId: () => siteId,
              getBaseURL: () => baseURL,
              getOrganizationId: () => 'org-1',
            }),
          },
          Audit: {
            findById: sandbox.stub().resolves({
              getId: () => auditId,
              getAuditResult: () => ({}),
            }),
          },
          Opportunity: {
            allBySiteIdAndStatus: sandbox.stub().resolves([]),
            create: sandbox.stub(),
          },
        },
      })
      .build();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('initial-create identity: the very first Opportunity.create() call for a suppressed run with no pre-existing evergreen already carries status IGNORED, the offsite-snapshot tag, and data.snapshot', async () => {
    // No NEW evergreen and no IGNORED snapshot exist yet for this site/type — genuine
    // first-ever suppressed run.
    context.dataAccess.Opportunity.allBySiteIdAndStatus.resolves([]);
    context.dataAccess.Opportunity.create.callsFake(async (payload) => makeMutableOpportunity({
      id: 'snapshot-created-1',
      type: payload.type,
      tags: payload.tags,
      data: payload.data,
      status: payload.status,
    }));

    const result = await handler.default(buildMessage({ status: 'IGNORED' }), context);

    expect(result.status).to.equal(200);
    expect(context.dataAccess.Opportunity.create).to.have.been.calledOnce;

    const [payload] = context.dataAccess.Opportunity.create.firstCall.args;
    // These fields must already be correct on THIS call — no separate later save() is
    // required to make the row identifiable as a managed snapshot.
    expect(payload.status).to.equal('IGNORED');
    expect(payload.tags).to.include('offsite-snapshot');
    expect(payload.data.snapshot).to.deep.equal({
      kind: 'suppressed-refresh',
      triggerAuditId: auditId,
    });
    // No evergreen existed yet, so there is nothing to link to.
    expect(payload.data.snapshot).to.not.have.property('evergreenOpportunityId');

    // syncSuggestions still runs against the real created+saved opportunity — confirms the
    // real composition didn't short-circuit before reaching the suggestion-sync step.
    expect(syncSuggestionsStub).to.have.been.calledOnce;
  });

  it('unlinked -> linked redelivery: reusing a previously-unlinked snapshot on redelivery after an evergreen now exists persists evergreenOpportunityId via save(), without a duplicate Opportunity.create()', async () => {
    const unlinkedSnapshot = makeMutableOpportunity({
      id: 'snapshot-1',
      tags: ['offsite-snapshot'],
      data: { snapshot: { kind: 'suppressed-refresh', triggerAuditId: auditId } },
      status: 'IGNORED',
    });
    const evergreenOpportunity = makeMutableOpportunity({
      id: 'evergreen-1',
      tags: [],
      data: { dashboard: { sov: 0.4 } },
      status: 'NEW',
    });

    context.dataAccess.Opportunity.allBySiteIdAndStatus.callsFake(async (_siteId, status) => (
      status === 'NEW' ? [evergreenOpportunity] : [unlinkedSnapshot]
    ));

    const result = await handler.default(buildMessage({ status: 'IGNORED' }), context);

    expect(result.status).to.equal(200);
    // The relink must be a reuse, not a second creation.
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
    expect(unlinkedSnapshot.save).to.have.been.called;

    // The persisted state (read back via getData(), not the constructor args) now carries
    // the evergreen linkage — proving the relink was actually applied to the object that
    // gets saved, not merely computed and discarded.
    const persistedData = unlinkedSnapshot.getData();
    expect(persistedData.snapshot).to.deep.equal({
      evergreenOpportunityId: 'evergreen-1',
      kind: 'suppressed-refresh',
      triggerAuditId: auditId,
    });

    // The evergreen opportunity itself is untouched by the suppressed run's relink.
    expect(evergreenOpportunity.save).to.not.have.been.called;
  });
});
