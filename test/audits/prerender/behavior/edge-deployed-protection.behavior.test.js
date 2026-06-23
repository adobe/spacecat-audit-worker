/*
 * Copyright 2025 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * Behavior tests for edge-deployed suggestion protection in the prerender handler.
 *
 * Enforces the constraint that suggestions with edgeDeployed set are never marked
 * OUTDATED by a subsequent audit run, even when the URL is absent from the new
 * audit results. This protection lives in handleOutdatedSuggestions in data-access.js
 * and these tests verify it holds through the full handler flow.
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

const BASE_URL = 'https://example.com';

function makeUrlSuggestion(id, url, initialStatus, extraData = {}) {
  let currentStatus = initialStatus;
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: sinon.stub().returns({ url, isDomainWide: false, ...extraData }),
    setData: sinon.stub(),
  };
}

/**
 * Runs processOpportunityAndSuggestions. auditResult hits /page1 only.
 * No scrapedUrlsSet is passed so all non-newData suggestions are OUTDATED candidates —
 * the strongest test for the edgeDeployed guard.
 */
async function runAudit(sandbox, existingSuggestions) {
  const bulkUpdateStatusStub = sandbox.stub().resolves();

  const mockOpportunity = {
    getId: () => 'test-opp-id',
    getSiteId: () => 'test-site-id',
    getType: () => 'prerender',
    getSuggestions: sandbox.stub().resolves(existingSuggestions),
    addSuggestions: sandbox.stub().resolves({ errorItems: [], createdItems: [] }),
  };

  const handler = await esmock('../../../../src/prerender/handler.js', {
    '../../../../src/common/opportunity.js': {
      convertToOpportunity: sandbox.stub().resolves(mockOpportunity),
    },
  });

  const auditData = {
    siteId: 'test-site',
    auditId: 'audit-123',
    scrapeJobId: 'job-123',
    auditResult: {
      urlsNeedingPrerender: 1,
      results: [{
        url: `${BASE_URL}/page1`,
        needsPrerender: true,
        contentGainRatio: 2.0,
        wordCountBefore: 100,
        wordCountAfter: 200,
      }],
    },
    // No scrapedUrlsSet — all non-newData suggestions are OUTDATED candidates
  };

  const context = {
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: {
      Suggestion: {
        saveMany: sandbox.stub().resolves(),
        bulkUpdateStatus: bulkUpdateStatusStub,
        STATUSES: Suggestion.STATUSES,
      },
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
    },
    site: {
      getId: () => 'test-site-id',
      getBaseURL: () => BASE_URL,
      requiresValidation: false,
    },
  };

  await handler.processOpportunityAndSuggestions(BASE_URL, auditData, context, true);

  return { bulkUpdateStatusStub };
}

describe('Prerender edge-deployed suggestion protection (behavior)', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('edgeDeployed suggestion not in audit results is excluded from bulkUpdateStatus', async () => {
    const deployed = makeUrlSuggestion(
      'sug-deployed',
      `${BASE_URL}/deployed-page`,
      Suggestion.STATUSES.NEW,
      { edgeDeployed: Date.now() },
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [deployed]);

    // bulkUpdateStatus should not be called with the deployed suggestion
    const outdatedCandidates = bulkUpdateStatusStub.args.flat(2);
    expect(outdatedCandidates).not.to.include(deployed);
  });

  it('non-edgeDeployed NEW suggestion absent from audit results is passed to bulkUpdateStatus', async () => {
    const notDeployed = makeUrlSuggestion(
      'sug-not-deployed',
      `${BASE_URL}/old-page`,
      Suggestion.STATUSES.NEW,
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [notDeployed]);

    expect(bulkUpdateStatusStub).to.have.been.called;
    const outdatedCandidates = bulkUpdateStatusStub.firstCall.args[0];
    expect(outdatedCandidates).to.include(notDeployed);
  });

  it('edgeDeployed and non-deployed coexist: only non-deployed is passed to bulkUpdateStatus', async () => {
    const deployed = makeUrlSuggestion(
      'sug-deployed',
      `${BASE_URL}/deployed-page`,
      Suggestion.STATUSES.NEW,
      { edgeDeployed: Date.now() },
    );
    const stale = makeUrlSuggestion(
      'sug-stale',
      `${BASE_URL}/old-page`,
      Suggestion.STATUSES.NEW,
    );

    const { bulkUpdateStatusStub } = await runAudit(sandbox, [deployed, stale]);

    const outdatedCandidates = bulkUpdateStatusStub.firstCall.args[0];
    expect(outdatedCandidates).to.include(stale);
    expect(outdatedCandidates).not.to.include(deployed);
  });
});
