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

/* eslint-env mocha */

/**
 * Behavioural tests for path-level prerender suggestions.
 *
 * Tests the new behaviors introduced by feat/path-level-prerender-suggestions:
 * - mergePathSuggestionData preserves deployment state across re-scoring
 * - markSuggestionsAsCoveredByPaths coverage marking for per-URL and path suggestions
 * - resolvePathSuggestions skip conditions (disabled, domain-wide deployed)
 * - Stale coverage ref cleanup
 */

import sinon from 'sinon';
import { expect, use } from 'chai';
import sinonChai from 'sinon-chai';
import {
  markSuggestionsAsCoveredByPaths,
  mergePathSuggestionData,
  resolvePathSuggestions,
} from '../../../../src/prerender/path-suggestions/main.js';

use(sinonChai);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuggestion(id, data, status = 'NEW') {
  let currentData = { ...data };
  let currentStatus = status;
  return {
    getId: () => id,
    getStatus: () => currentStatus,
    setStatus: sinon.stub().callsFake((s) => { currentStatus = s; }),
    getData: () => currentData,
    setData: sinon.stub().callsFake((d) => { currentData = d; }),
  };
}

function makeOpportunity(sandbox, suggestions) {
  return {
    getId: () => 'opp-1',
    getSuggestions: sandbox.stub().resolves(suggestions),
  };
}

function makeContext(sandbox) {
  const saveMany = sandbox.stub().resolves();
  return {
    log: {
      info: sandbox.stub(),
      debug: sandbox.stub(),
      warn: sandbox.stub(),
      error: sandbox.stub(),
    },
    dataAccess: { Suggestion: { saveMany } },
    site: { getId: () => 'site-1', getBaseURL: () => 'https://example.com' },
    saveMany, // expose for assertions
  };
}

// ---------------------------------------------------------------------------
// mergePathSuggestionData — deployment-state preservation
// ---------------------------------------------------------------------------

describe('[prerender][path-suggestions] mergePathSuggestionData', () => {
  it('preserves edgeDeployed from existingData when newData omits it', () => {
    const existingData = { pathScore: 1.0, edgeDeployed: 'some-timestamp', url: '/blog/*' };
    const newData = { pathScore: 2.0, url: '/blog/*' };

    const result = mergePathSuggestionData(existingData, newData);

    expect(result.edgeDeployed).to.equal('some-timestamp');
    expect(result.pathScore).to.equal(2.0);
  });

  it('preserves coveredByDomainWide from existingData when newData omits it', () => {
    const existingData = { pathScore: 1.0, coveredByDomainWide: 'dw-id', url: '/blog/*' };
    const newData = { pathScore: 2.0, url: '/blog/*' };

    const result = mergePathSuggestionData(existingData, newData);

    expect(result.coveredByDomainWide).to.equal('dw-id');
    expect(result.pathScore).to.equal(2.0);
  });

  it('does not carry over arbitrary existing fields — newData wins for everything else', () => {
    const existingData = { pathScore: 1.0, aiSummary: 'old summary' };
    const newData = { pathScore: 2.0 };

    const result = mergePathSuggestionData(existingData, newData);

    expect(result.pathScore).to.equal(2.0);
    expect(result).to.not.have.property('aiSummary');
  });
});

// ---------------------------------------------------------------------------
// resolvePathSuggestions — skip conditions
// ---------------------------------------------------------------------------

describe('[prerender][path-suggestions] resolvePathSuggestions — skip conditions', () => {
  let sandbox;
  let context;
  let opportunity;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    context = makeContext(sandbox);
    opportunity = makeOpportunity(sandbox, []);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('returns empty arrays when pathSuggestionsEnabled is false', async () => {
    const result = await resolvePathSuggestions({
      pathSuggestionsEnabled: false,
      domainWideDeployed: false,
      preRenderSuggestions: [],
      opportunity,
      site: context.site,
      context,
      auditUrl: 'https://example.com',
      siteId: 'site-1',
    });

    expect(result.preservablePaths).to.deep.equal([]);
    expect(result.newPathSuggestions).to.deep.equal([]);
  });

  it('returns empty arrays when domainWideDeployed is true', async () => {
    const result = await resolvePathSuggestions({
      pathSuggestionsEnabled: true,
      domainWideDeployed: true,
      preRenderSuggestions: [],
      opportunity,
      site: context.site,
      context,
      auditUrl: 'https://example.com',
      siteId: 'site-1',
    });

    expect(result.preservablePaths).to.deep.equal([]);
    expect(result.newPathSuggestions).to.deep.equal([]);
  });
});

// ---------------------------------------------------------------------------
// markSuggestionsAsCoveredByPaths — per-URL coverage marking
// ---------------------------------------------------------------------------

describe('[prerender][path-suggestions] markSuggestionsAsCoveredByPaths', () => {
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('sets coveredByPattern on per-URL suggestions under a deployed path, leaves others untouched', async () => {
    const deployedPathSuggestion = makeSuggestion(
      'path-sug-1',
      { allowedRegexPatterns: ['/blog/*'], edgeDeployed: String(Date.now()) },
      'NEW',
    );

    const blogPost = makeSuggestion(
      'url-sug-blog',
      { url: 'https://example.com/blog/post-1' },
      'NEW',
    );
    const productItem = makeSuggestion(
      'url-sug-products',
      { url: 'https://example.com/products/item' },
      'NEW',
    );

    const suggestions = [deployedPathSuggestion, blogPost, productItem];
    const context = makeContext(sandbox);
    const opportunity = makeOpportunity(sandbox, suggestions);

    await markSuggestionsAsCoveredByPaths(opportunity, context);

    // Blog post is under /blog/* — must be marked
    expect(blogPost.setData).to.have.been.calledOnce;
    const [calledWithData] = blogPost.setData.firstCall.args;
    expect(calledWithData.coveredByPattern).to.equal('path-sug-1');

    // Products item is NOT under /blog/* — must not be marked
    const productCallsWithCoverage = productItem.setData.args.filter(
      ([d]) => d.coveredByPattern !== undefined,
    );
    expect(productCallsWithCoverage).to.have.length(0);
  });

  it('marks path suggestions with coveredByDomainWide when domain-wide is deployed', async () => {
    const domainWideSuggestion = makeSuggestion(
      'dw-sug-1',
      { isDomainWide: true, edgeDeployed: String(Date.now()) },
      'NEW',
    );

    const pathSuggestion = makeSuggestion(
      'path-sug-2',
      { allowedRegexPatterns: ['/blog/*'] },
      'NEW',
    );

    const suggestions = [domainWideSuggestion, pathSuggestion];
    const context = makeContext(sandbox);
    const opportunity = makeOpportunity(sandbox, suggestions);

    await markSuggestionsAsCoveredByPaths(opportunity, context);

    expect(pathSuggestion.setData).to.have.been.calledOnce;
    const [calledWithData] = pathSuggestion.setData.firstCall.args;
    expect(calledWithData.coveredByDomainWide).to.equal('dw-sug-1');
  });

  it('clears stale coveredByPattern refs when the referenced path suggestion no longer exists', async () => {
    // A per-URL suggestion referencing a path that is no longer deployed / no longer exists
    const stalePerUrl = makeSuggestion(
      'url-sug-stale',
      { url: 'https://example.com/blog/old-post', coveredByPattern: 'old-path-id' },
      'NEW',
    );

    // No deployed path suggestions in this run
    const suggestions = [stalePerUrl];
    const context = makeContext(sandbox);
    const opportunity = makeOpportunity(sandbox, suggestions);

    await markSuggestionsAsCoveredByPaths(opportunity, context);

    // setData must have been called to remove coveredByPattern
    expect(stalePerUrl.setData).to.have.been.called;
    const lastCallData = stalePerUrl.setData.lastCall.args[0];
    expect(lastCallData).to.not.have.property('coveredByPattern');

    // saveMany must have been invoked with the stale suggestion
    expect(context.saveMany).to.have.been.calledWith(
      sinon.match((arr) => arr.some((s) => s.getId() === 'url-sug-stale')),
    );
  });
});
