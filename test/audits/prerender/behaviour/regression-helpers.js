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
 * Shared helpers for prerender regression behavioural tests.
 *
 * These helpers support the esmock-based tests that call processOpportunityAndSuggestions
 * directly with only the convertToOpportunity boundary mocked.
 */

import esmock from 'esmock';
import sinon from 'sinon';
import { Suggestion } from '@adobe/spacecat-shared-data-access';

export const BASE_URL = 'https://example.com';

export function makeSuggestion(id, url, status = 'NEW', extraData = {}) {
  let currentStatus = status;
  let currentData = { url, ...extraData };
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    setUpdatedBy: sinon.stub(),
    getData: () => currentData,
    setData: sinon.stub().callsFake((d) => { currentData = d; }),
  };
}

/**
 * Builds a mock opportunity and runs processOpportunityAndSuggestions.
 */
export async function runAudit(sandbox, existingSuggestions, opts = {}) {
  const {
    siteConfig = null,
    scrapeJobId = 'job-123',
    auditResults = [{
      url: `${BASE_URL}/page1`,
      needsPrerender: true,
      contentGainRatio: 2.0,
      wordCountBefore: 100,
      wordCountAfter: 200,
    }],
  } = opts;

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
    scrapeJobId,
    auditResult: {
      urlsNeedingPrerender: auditResults.length,
      results: auditResults,
    },
  };

  const saveManyStub = sandbox.stub().resolves();
  const bulkUpdateStatusStub = sandbox.stub().resolves();

  const context = {
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: {
      Suggestion: {
        saveMany: saveManyStub,
        bulkUpdateStatus: bulkUpdateStatusStub,
        STATUSES: Suggestion.STATUSES,
      },
      SiteTopPage: { allBySiteIdAndSourceAndGeo: sandbox.stub().resolves([]) },
    },
    site: {
      getId: () => 'test-site-id',
      getBaseURL: () => BASE_URL,
      getConfig: () => ({
        getHandlerConfig: () => siteConfig,
        getLlmoCdnlogsFilter: () => null,
      }),
      requiresValidation: false,
    },
  };

  const result = await handler.processOpportunityAndSuggestions(BASE_URL, auditData, context, true);

  return {
    addSuggestionsStub,
    saveManyStub,
    bulkUpdateStatusStub,
    result,
    mockOpportunity,
  };
}
