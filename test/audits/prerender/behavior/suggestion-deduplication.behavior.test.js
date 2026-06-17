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
 * Behavior tests for domain-wide suggestion deduplication in the prerender handler.
 *
 * These tests run the real handler logic (findPreservableDomainWideSuggestion +
 * syncSuggestions) with only I/O boundaries mocked. They enforce the business constraint
 * that an existing NEW domain-wide suggestion is always preserved across audit runs,
 * and that case-variant URLs resolve to the same suggestion key.
 */

import esmock from 'esmock';
import { expect, use } from 'chai';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

use(sinonChai);

const BASE_URL = 'https://example.com';
const DOMAIN_WIDE_URL = `${BASE_URL}/* (All Domain URLs)`;

/**
 * Creates a mock suggestion that tracks status mutations so assertions can read final state.
 */
function makeDomainWide(id, initialStatus) {
  let currentStatus = initialStatus;
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: sinon.stub().returns({ isDomainWide: true, url: DOMAIN_WIDE_URL }),
    setData: sinon.stub(),
  };
}

function makeUrlSuggestion(id, url, initialStatus = 'NEW') {
  let currentStatus = initialStatus;
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: sinon.stub().returns({ url, isDomainWide: false }),
    setData: sinon.stub(),
  };
}

/**
 * Runs processOpportunityAndSuggestions with the given pre-existing suggestions.
 * The auditResult always includes one URL-level hit so the audit produces suggestions.
 */
async function runAudit(sandbox, existingSuggestions, auditUrl = BASE_URL) {
  const addSuggestionsStub = sandbox.stub().resolves({ errorItems: [], createdItems: [] });

  const mockOpportunity = {
    getId: () => 'test-opp-id',
    getSiteId: () => 'test-site-id',
    getType: () => 'prerender',
    getSuggestions: sandbox.stub().resolves(existingSuggestions),
    addSuggestions: addSuggestionsStub,
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
        url: `${auditUrl}/page1`,
        needsPrerender: true,
        contentGainRatio: 2.0,
        wordCountBefore: 100,
        wordCountAfter: 200,
      }],
    },
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
        bulkUpdateStatus: sandbox.stub().resolves(),
        STATUSES: Suggestion.STATUSES,
      },
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
      PageCitability: { allBySiteId: sandbox.stub().resolves([]) },
    },
    site: {
      getId: () => 'test-site-id',
      getBaseURL: () => auditUrl,
      requiresValidation: false,
    },
  };

  await handler.processOpportunityAndSuggestions(auditUrl, auditData, context, true);

  return { addSuggestionsStub, context };
}

describe('Prerender domain-wide suggestion deduplication (behavior)', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => sandbox.restore());

  it('single NEW: audit preserves it unchanged — no new domain-wide is created', async () => {
    const dw = makeDomainWide('dw-1', 'NEW');

    const { addSuggestionsStub } = await runAudit(sandbox, [dw]);

    expect(dw.getStatus()).to.equal(Suggestion.STATUSES.NEW);
    // Since a preservable exists, no domain-wide should be added via addSuggestions
    const allAdded = addSuggestionsStub.args.flat(2);
    const domainWideAdded = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(domainWideAdded).to.have.lengthOf(0);
  });

  it('1 NEW + OUTDATED domain-wide: audit preserves the NEW, no new domain-wide created', async () => {
    const newDw = makeDomainWide('dw-new', 'NEW');
    const outdatedDw = makeDomainWide('dw-out', 'OUTDATED');

    const { addSuggestionsStub } = await runAudit(sandbox, [newDw, outdatedDw]);

    expect(newDw.getStatus()).to.equal(Suggestion.STATUSES.NEW);
    const allAdded = addSuggestionsStub.args.flat(2);
    const domainWideAdded = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(domainWideAdded).to.have.lengthOf(0);
  });

  it('no domain-wide suggestions: audit creates exactly 1 NEW domain-wide', async () => {
    const { addSuggestionsStub } = await runAudit(sandbox, []);

    const allAdded = addSuggestionsStub.args.flat(2);
    const domainWideAdded = allAdded.filter((s) => s?.data?.isDomainWide === true);
    expect(domainWideAdded).to.have.lengthOf(1);
  });

  it('case-variant URL: /Page1 and /page1 resolve to the same suggestion key — no duplicate created', async () => {
    // Existing suggestion stored with mixed-case URL
    const existing = makeUrlSuggestion('sug-1', `${BASE_URL}/Page1`, 'NEW');

    const { addSuggestionsStub } = await runAudit(sandbox, [existing]);

    // The incoming audit result has /page1 (lowercase). After case normalization they share
    // the same key so syncSuggestions should update the existing one, not add a new one.
    const allAdded = addSuggestionsStub.args.flat(2);
    const pageSuggestionAdded = allAdded.filter(
      (s) => s?.data?.url?.toLowerCase().includes('/page1') && s?.data?.isDomainWide !== true,
    );
    expect(pageSuggestionAdded).to.have.lengthOf(0);
  });
});
