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

describe('offsite refresh handler composition', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('composes the cited handler, mapper, and persistence helper', async () => {
    const siteId = 'site-1';
    const auditId = 'audit-2';
    const state = {
      data: {
        staleField: 'remove-me',
        dashboard: { score: 1 },
      },
      status: 'NEW',
    };
    const evergreenOpportunity = {
      getId: () => 'evergreen-1',
      getType: () => 'cited-analysis',
      getData: () => state.data,
      getUpdatedAt: () => '2026-07-01T00:00:00.000Z',
      setAuditId: sandbox.stub(),
      setData: sandbox.stub().callsFake((data) => {
        state.data = data;
      }),
      setUpdatedBy: sandbox.stub(),
      setStatus: sandbox.stub().callsFake((status) => {
        state.status = status;
      }),
      save: sandbox.stub().resolves(),
    };
    const syncSuggestions = sandbox.stub().resolves();
    const checkGoogleConnection = sandbox.stub().resolves(true);
    const log = {
      info: sandbox.spy(),
      error: sandbox.spy(),
      warn: sandbox.spy(),
      debug: sandbox.spy(),
    };
    const site = {
      getBaseURL: () => 'https://example.com',
    };
    const audit = {
      getAuditResult: () => ({}),
    };
    const context = {
      log,
      dataAccess: {
        Site: {
          findById: sandbox.stub().resolves(site),
        },
        Audit: {
          findById: sandbox.stub().resolves(audit),
        },
        Opportunity: {
          allBySiteIdAndStatus: sandbox.stub().resolves([evergreenOpportunity]),
          saveMany: sandbox.stub().resolves(),
          create: sandbox.stub(),
        },
      },
    };

    const handler = await esmock('../../src/cited-analysis/guidance-handler.js', {
      '../../src/common/opportunity-utils.js': {
        checkGoogleConnection,
      },
      '../../src/utils/data-access.js': {
        syncSuggestions,
      },
      '../../src/utils/brand-resolver.js': {
        resolveBrandResultForSite: sandbox.stub().resolves({ brand: null, resolved: true }),
        applyScopeToOpportunity: sandbox.stub(),
      },
      '../../src/utils/slack-utils.js': {
        postMessageOptional: sandbox.stub(),
      },
    });

    const response = await handler.default({
      siteId,
      auditId,
      data: {
        companyName: 'Example',
        analysis: {
          opportunity: {
            status: 'NEW',
            data: {
              dashboard: { score: 2 },
            },
          },
          suggestions: [
            {
              id: 'suggestion-1',
              type: 'CONTENT_UPDATE',
              rank: 1,
              data: { title: 'Update content' },
            },
          ],
        },
      },
    }, context);

    expect(response.status).to.equal(200);
    expect(evergreenOpportunity.setAuditId).to.have.been.calledWith(auditId);
    expect(evergreenOpportunity.setData.firstCall.args[0]).to.deep.equal({
      dashboard: { score: 2 },
      dataSources: ['Site', 'Page'],
    });
    expect(evergreenOpportunity.setData.firstCall.args[0]).to.not.have.property('staleField');
    expect(evergreenOpportunity.save).to.have.been.calledTwice;
    expect(evergreenOpportunity.save.secondCall.callId)
      .to.be.lessThan(syncSuggestions.firstCall.callId);
    expect(syncSuggestions).to.have.been.calledOnce;
    expect(context.dataAccess.Opportunity.create).to.not.have.been.called;
  });
});
